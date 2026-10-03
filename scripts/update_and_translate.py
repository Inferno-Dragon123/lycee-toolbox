"""Crawl, translate missing Chinese entries, sort and report alignment.

Defaults to local writes only. --dry-run never calls DeepSeek or writes databases.
Use --skip-crawl for historical missing translations; --push explicitly enables Git.
"""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).parent))
from update_japanese_database import main as update_japanese_main, ROOT, WORK, DATABASE, sort_key, atomic_write
from translation_terms import normalize_translation_terms

CHINESE_DATABASE = ROOT / 'lycee-chinese-database-final.json'
DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'
DEEPSEEK_MODEL = 'deepseek-chat'

SYSTEM_PROMPT = """你是一个专业的日文卡牌游戏效果翻译专家。请将输入的日文卡牌效果文本，翻译成准确、通顺、符合卡牌游戏术语习惯的中文。

翻译要求：
1. 保持卡牌游戏术语的准确性，以下术语必须按指定方式翻译：
   ｽﾃｯﾌﾟ → 移动
   ｻｲﾄﾞｽﾃｯﾌﾟ → 横向侧移
   ｵｰﾀﾞｰｽﾃｯﾌﾟ → 纵向移动
   ｵｰﾀﾞｰﾁｪﾝｼﾞ → 位置交换
   ｼﾞｬﾝﾌﾟ → 跳跃
   ﾍﾟﾅﾙﾃｨ → 离场惩罚
   ｱｸﾞﾚｯｼﾌﾞ → 进取心
   ｱｼｽﾄ → 辅助
   ｴﾝｹﾞｰｼﾞ → 结合
   ﾘｶﾊﾞﾘｰ → 补正
   ｶﾞｯﾂ → 斗志
   ﾘｰﾀﾞｰ → 领导
   ｻﾎﾟｰﾀｰ → 支援者
   ﾎﾞｰﾅｽ → 奖励
   ﾁｬｰｼﾞ → 充能
   ﾀｰﾝﾘｶﾊﾞﾘｰ → 回合补正
   ﾌﾟﾘﾝｼﾊﾟﾙ → 主演
   ｻﾌﾟﾗｲｽﾞ → 突袭
   ｺｽﾄ → COST能力
   ｴﾘｱ → 场地
   サポート → 支援
   コンバート → 换装

2. 保留原文的格式符号（如：[宣言]、[诱发]、[COST]、[切札]等）
3. 保持原文的分隔符（|）结构，不要改变其位置
4. 除了卡牌效果和能力之外涉及到的其他专有名称（如角色名、作品名、技能名等）保持原文不翻译
5. 所有角色、单位等战斗单位的数量量词统一用「个」，不使用「体」。"""


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def load_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(path, (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))


def save_database(path, data, original=None):
    """Keep the repository file's indentation and line endings to avoid noisy diffs."""
    text = original.decode('utf-8') if original else ''
    indentation = re.search(r'\n([ \t]+)"', text)
    indent = indentation[1] if indentation else '  '
    newline = '\r\n' if '\r\n' in text else '\n'
    content = json.dumps(data, ensure_ascii=False, indent=indent).replace('\n', newline)
    if not original or text.endswith('\n'):
        content += newline
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(path, content.encode('utf-8'))


def load_env(path):
    """Read simple dotenv assignments without executing/interpolating their contents."""
    if path.exists():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            match = re.fullmatch(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*', line)
            if match:
                value = match[2]
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                else:
                    value = value.split(' #', 1)[0].rstrip()
                os.environ.setdefault(match[1], value)


class PermanentAPIError(ValueError):
    pass


def validate_translation(original, translated):
    if not isinstance(translated, str) or not translated.strip():
        raise ValueError('Empty translation')
    if translated.strip().startswith('```') or original.count('|') != translated.count('|'):
        raise ValueError('Translation changed the required format')
    # Chinese 无 and Japanese 無 denote the same colorless-cost symbol.
    # Restore that glyph only inside cost brackets, leaving ordinary Chinese alone.
    translated = re.sub(r'\[[雪月花宙日無无]+\]', lambda m: m[0].replace('无', '無'), translated)
    # These are effect/cost symbols, not translatable ability headings.
    tokens = lambda s: [t for t in re.findall(r'\[(?:[A-Z]+\d*|\d+|[雪月花宙日無]+)\]', unicodedata.normalize('NFKC', s)) if t != '[COST]']
    if tokens(original) != tokens(translated):
        raise ValueError('Translation changed effect/cost symbols')
    translated, _, issues = normalize_translation_terms(original, translated)
    if issues:
        raise ValueError('Translation terminology cannot be safely aligned: ' + '; '.join(issues))
    return translated.strip()


def call_deepseek(text, api_key, max_retries=3):
    for attempt in range(max_retries):
        try:
            payload = json.dumps({'model': os.environ.get('DEEPSEEK_MODEL', DEEPSEEK_MODEL),
                'messages': [{'role': 'system', 'content': SYSTEM_PROMPT + '\n术语表同样适用于全角片假名。保留方括号内的数字、费用符号、英文代码。只输出翻译结果，不要添加任何解释或注释。'},
                             {'role': 'user', 'content': text}],
                'temperature': 0.3, 'thinking': {'type': 'disabled'}, 'max_tokens': 4096}).encode('utf-8')
            request = Request(DEEPSEEK_API_URL, data=payload, headers={
                'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'})
            # urllib respects system / environment proxies; responses close on every path.
            with urlopen(request, timeout=90) as response:
                choice = json.load(response)['choices'][0]
            if choice.get('finish_reason') != 'stop':
                raise ValueError('Incomplete translation: ' + str(choice.get('finish_reason')))
            return validate_translation(text, choice['message']['content'])
        except HTTPError as exc:
            exc.close()
            if exc.code < 500 and exc.code not in (408, 429):
                raise PermanentAPIError(f'DeepSeek HTTP {exc.code}; check key, balance or model') from None
            failure = RuntimeError(f'DeepSeek HTTP {exc.code}')
        except (URLError, TimeoutError, OSError, ValueError, KeyError, IndexError) as exc:
            failure = exc
        if attempt + 1 == max_retries:
            raise failure
        time.sleep(2 ** (attempt + 1))


def translation_key(card):
    base = re.match(r'LO-\d+', card['code'])[0]
    return hashlib.sha256(json.dumps([base, card['japaneseText'], SYSTEM_PROMPT,
        os.environ.get('DEEPSEEK_MODEL', DEEPSEEK_MODEL), 2], ensure_ascii=False).encode('utf-8')).hexdigest()


def translate_cards(new_cards, api_key, work_dir, workers=1, reuse=None, reuse_dates=None):
    """Checkpoint each text group; identical variants keep their own code/name/cid."""
    cache_dir = work_dir / 'translation-cache'
    cache_dir.mkdir(parents=True, exist_ok=True)
    groups = defaultdict(list)
    for card in new_cards:
        groups[translation_key(card)].append(card)
    reuse = reuse or {}
    reuse_dates = reuse_dates or {}

    def translate_group(item):
        key, cards = item
        original = cards[0]['japaneseText'] or ''
        cache_file = cache_dir / (key + '.json')
        try:
            translated_at = now_iso()
            if not original.strip():
                text = ''  # A card with no effect still needs a matching Chinese record.
            elif key in reuse:
                text = validate_translation(original, reuse[key])
                # Copying an old translation to another card face isn't a new translation.
                translated_at = reuse_dates.get(key) if text == reuse[key] else now_iso()
            elif cache_file.exists():
                cached = load_json(cache_file)
                text = validate_translation(original, cached['text'])
                translated_at = cached.get('translatedAt') if text == cached['text'] else now_iso()
                if text != cached['text']:
                    save_json(cache_file, {'text': text, 'sourceHash': key, 'translatedAt': translated_at})
            else:
                if not api_key:
                    raise PermanentAPIError('DEEPSEEK_API_KEY is required for missing translations')
                text = call_deepseek(original, api_key)
                translated_at = now_iso()
                save_json(cache_file, {'text': text, 'sourceHash': key, 'translatedAt': translated_at})
                time.sleep(1)
            return [dict(c, japaneseText=text, **({'translatedAt': translated_at} if translated_at else {})) for c in cards], []
        except PermanentAPIError:
            raise
        except Exception as exc:
            return [], [{'code': c['code'], 'error': str(exc)} for c in cards]

    translated, failed = [], []
    # Bounded batches also bound how many calls can start after a credentials error.
    with ThreadPoolExecutor(max_workers=workers) as executor:
        items = list(groups.items())
        for start in range(0, len(items), workers):
            for good, bad in executor.map(translate_group, items[start:start + workers]):
                translated.extend(good)
                failed.extend(bad)
                save_json(work_dir / 'translation-result.json', {'translatedAt': now_iso(),
                    'successful': len(translated), 'failed': len(failed), 'cards': translated, 'failures': failed})
            print(f'Translated groups {min(start + workers, len(items))}/{len(items)}; cards {len(translated)}; failed {len(failed)}', flush=True)
    return translated, failed


def merge_chinese_database(new_translations):
    if not new_translations:
        return False
    original = CHINESE_DATABASE.read_bytes() if CHINESE_DATABASE.exists() else None
    db = json.loads(original) if original else {'generatedAt': now_iso(), 'cards': []}
    codes = {c['code'] for c in db['cards']}
    additions = []
    for card in new_translations:
        if card['code'] not in codes:
            additions.append(card)
            codes.add(card['code'])
    if not additions:
        return False
    db['cards'] = sorted(db['cards'] + additions, key=sort_key)
    db['totalCards'] = len(db['cards'])
    db['updatedAt'] = now_iso()
    if original is not None:
        if CHINESE_DATABASE.read_bytes() != original:
            raise ValueError('Chinese database changed during merge')
        atomic_write(CHINESE_DATABASE.with_suffix('.json.bak'), original)
    save_database(CHINESE_DATABASE, db, original)
    return True


def align_databases():
    """Preserve old records, including legacy duplicate cid aliases, and only sort."""
    databases = []
    for path in (DATABASE, CHINESE_DATABASE):
        original = path.read_bytes()
        db = json.loads(original)
        cards = sorted(db['cards'], key=sort_key)
        if cards != db['cards'] or db.get('totalCards') != len(cards):
            atomic_write(path.with_suffix('.json.bak'), original)
            db.update(cards=cards, totalCards=len(cards))
            save_database(path, db, original)
        databases.append(db)
    jp, zh = ({c['code'] for c in d['cards']} for d in databases)
    return {'japaneseRecords': len(databases[0]['cards']), 'chineseRecords': len(databases[1]['cards']),
            'japaneseUnique': len(jp), 'chineseUnique': len(zh),
            'missingChinese': sorted(jp - zh), 'chineseOnly': sorted(zh - jp)}


def git_commit_and_push(files, message):
    # Refuse to sweep unrelated staged files into an automated data commit.
    if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=ROOT).returncode != 0:
        raise ValueError('Git index is not empty; commit staged work separately')
    paths = [str(p.relative_to(ROOT)) for p in files]
    subprocess.run(['git', 'add', '--', *paths], cwd=ROOT, check=True)
    if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=ROOT).returncode == 0:
        return False
    subprocess.run(['git', 'commit', '-m', message], cwd=ROOT, check=True)
    subprocess.run(['git', 'push'], cwd=ROOT, check=True)
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('resume', 'dry-run', 'skip-crawl', 'no-git', 'push', 'catalog', 'allow-missing-translations'):
        parser.add_argument('--' + flag, action='store_true')
    parser.add_argument('--env-file', type=Path, default=ROOT / '.env')
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--delay', type=float, default=10)
    parser.add_argument('--timeout', type=float, default=45)
    parser.add_argument('--retries', type=int, default=3)
    parser.add_argument('--max-pages', type=int, default=200)
    args = parser.parse_args(argv)
    if not 1 <= args.workers <= 4:
        parser.error('--workers must be between 1 and 4')
    if args.no_git and args.push:
        parser.error('--no-git and --push cannot be combined')
    load_env(args.env_file)
    jp = load_json(DATABASE)
    if not args.skip_crawl:
        crawl_args = [f'--{k}' for k in ('resume', 'dry-run', 'catalog') if getattr(args, k.replace('-', '_'))]
        for key in ('delay', 'timeout', 'retries', 'max-pages'):
            crawl_args.extend(['--' + key, str(getattr(args, key.replace('-', '_')))])
        report = update_japanese_main(crawl_args)
        jp = load_json(DATABASE)
        if args.dry_run:
            jp['cards'].extend(load_json(Path(report['newCardsFile']))['cards'])
    elif args.catalog and not args.dry_run:
        from build_catalog import build
        build()
    zh = load_json(CHINESE_DATABASE) if CHINESE_DATABASE.exists() else {'cards': []}
    originals = {c['code']: c for c in jp['cards']}
    existing = {c['code']: c for c in zh['cards']}
    missing = sorted([c for code, c in originals.items() if code not in existing], key=sort_key)
    reuse_values = defaultdict(set)
    reuse_dates = {}
    for code, card in existing.items():
        if code in originals and card.get('japaneseText'):
            try:
                reusable = validate_translation(originals[code]['japaneseText'], card['japaneseText'])
            except ValueError:
                continue  # Do not copy an uncertain legacy translation to a new card face.
            reuse_values[translation_key(originals[code])].add(reusable)
            key = translation_key(originals[code])
            date = card.get('translatedAt') if reusable == card['japaneseText'] else now_iso()
            if date and (not reuse_dates.get(key) or date > reuse_dates[key]):
                reuse_dates[key] = date
    reuse = {key: next(iter(values)) for key, values in reuse_values.items() if len(values) == 1}
    print(f'Missing Chinese: {len(missing)} cards, {len({translation_key(c) for c in missing})} text groups', flush=True)
    work_dir = WORK / 'alignment'
    if args.dry_run:
        save_json(work_dir / 'dry-run.json', {'checkedAt': now_iso(), 'missingChinese': [c['code'] for c in missing]})
        print('Dry run: no translation API calls, database writes or Git operations.')
        return 0
    # Detect edits made while long-running translation requests were in flight.
    before = {p: p.read_bytes() for p in (DATABASE, CHINESE_DATABASE) if p.exists()}
    try:
        translated, failed = translate_cards(missing, os.environ.get('DEEPSEEK_API_KEY'), work_dir, args.workers, reuse, reuse_dates)
    except PermanentAPIError as exc:
        if not args.allow_missing_translations:
            raise
        translated = []
        failed = [{'code': card['code'], 'error': str(exc)} for card in missing]
        save_json(work_dir / 'translation-result.json', {'translatedAt': now_iso(),
            'successful': 0, 'failed': len(failed), 'cards': [], 'failures': failed})
    if any(p.read_bytes() != contents for p, contents in before.items()):
        raise ValueError('Database changed during translation; rerun to reuse the cached results')
    merge_chinese_database(translated)
    alignment = align_databases()
    save_json(work_dir / 'report.json', dict(alignment, checkedAt=now_iso(), failures=failed))
    print(json.dumps(alignment, ensure_ascii=False), flush=True)
    if alignment['chineseOnly']:
        return 1
    if failed or alignment['missingChinese']:
        if not args.allow_missing_translations:
            return 1
        print(f'Translations deferred for {len(alignment["missingChinese"])} cards; '
              'Japanese text will be used until a later run succeeds.', file=sys.stderr, flush=True)
    if args.push:
        git_commit_and_push([DATABASE, CHINESE_DATABASE, ROOT / 'data/catalog.json'],
                            f'feat: align card databases (+{len(translated)} translated cards)')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print('Interrupted; completed translations are cached.', file=sys.stderr)
        sys.exit(130)
    except Exception as exc:
        print(f'Update failed: {exc}', file=sys.stderr)
        sys.exit(1)
