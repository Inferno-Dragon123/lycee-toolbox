"""Incrementally import cards actually listed by the official Lycee catalog.

Python 3.10+, standard library only. Examples from the repository root:
    python scripts/update_japanese_database.py
    python scripts/update_japanese_database.py --resume
    python scripts/update_japanese_database.py --dry-run

Data paths resolve relative to the script, independently of the working directory.
Never infers cards from numeric gaps; never edits the Chinese database.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
from http.client import HTTPException
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / 'lycee-japanese-database-final.json'
WORK = ROOT / 'temp' / 'lycee-official-update'
BASE_URL = 'https://lycee-tcg.com/card/'
CODE = re.compile(r'LO-(\d+)(?:-?([A-Z]+))?')
TABLE_START = r'''<table\b(?=[^>]*\bid\s*=\s*["']cardtable["'])([^>]*)>'''
TABLE = re.compile(TABLE_START + r'(.*?)</table\s*>', re.I | re.S)
CELL = re.compile(r'<td\b([^>]*)>(.*?)</td\s*>', re.I | re.S)


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


class Attributes(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.attrs = {}
        self.feed('<x ' + source + '>')

    def handle_starttag(self, tag, attrs):
        self.attrs = dict(attrs)


class Text(HTMLParser):
    """Keep effect line breaks and image alt text; omit deck-search UI."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.ignored = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if self.ignored:
            return
        if tag in ('script', 'style') or (tag == 'a' and 'deck_search.pl' in attrs.get('href', '')):
            self.ignored = tag
        elif tag in ('br', 'div', 'p'):
            self.parts.append('\n')
        elif tag == 'img':
            alt = attrs.get('alt', '').strip()
            if not alt:
                raise ValueError('Text contains an image without alt text; inspect manually')
            self.parts.append(alt)

    def handle_endtag(self, tag):
        if self.ignored:
            if tag == self.ignored:
                self.ignored = None
        elif tag in ('div', 'p'):
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.ignored:
            self.parts.append(data)


def plain_text(fragment):
    parser = Text()
    parser.feed(fragment)
    parser.close()
    lines = [re.sub(r'[\t \u00a0]+', ' ', line).strip()
             for line in ''.join(parser.parts).splitlines()]
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)).strip()


def sort_key(card):
    match = CODE.fullmatch(card['code'])
    if not match:
        raise ValueError('Unexpected card code: ' + str(card.get('code')))
    return -int(match[1]), match[2] or ''


def parse_catalog(html, page):
    """Extract only official card tables, not recommendations or deck buttons."""
    cards = []
    for attrs, table in TABLE.findall(html):
        if Attributes(attrs).attrs.get('id') != 'cardtable':
            continue
        cells = [(Attributes(a).attrs, content) for a, content in CELL.findall(table)]
        codes = [content.strip() for _, content in cells if CODE.fullmatch(content.strip())]
        if len(codes) != 1:
            raise ValueError(f'Page {page}: card table has no unique card-number cell')
        code = codes[0]
        names = []
        for anchor_attrs, content in re.findall(r'<a\b([^>]*)>(.*?)</a\s*>', table, re.I | re.S):
            href = Attributes(anchor_attrs).attrs.get('href', '')
            url = urlparse(urljoin(BASE_URL, href))
            if url.path == '/card/card_detail.pl' and parse_qs(url.query).get('cardno') == [code]:
                names.append(plain_text(content))
        effects = [content for a, content in cells if a.get('colspan') == '10' and 'height' in a]
        if len(names) != 1 or not names[0] or len(effects) != 1:
            raise ValueError(f'Page {page}: {code} missing name/effect cell; site format may have changed')
        effect = plain_text(effects[0])
        if '\ufffd' in names[0] + effect:
            raise ValueError(f'Page {page}: {code} contains invalid Unicode')
        # The official site has no Moetcg cid. Keep the existing schema, without inventing an ID.
        cards.append({'code': code, 'cid': '', 'name': names[0], 'japaneseText': effect})
    if len(cards) != len(re.findall(TABLE_START, html, re.I)):
        raise ValueError(f'Page {page}: incomplete card table markup')
    if not cards or len(cards) > 200:
        raise ValueError(f'Page {page}: expected 1..200 card tables, got {len(cards)}')
    if len({c['code'] for c in cards}) != len(cards):
        raise ValueError(f'Page {page}: duplicate card tables')
    page_numbers = set()
    # The site still renders a >> button on its last page. Only numbered
    # buttons establish that another page exists; the arrow alone does not.
    for attrs, label in re.findall(r'<button\b([^>]*)>(.*?)</button\s*>', html, re.I | re.S):
        a = Attributes(attrs).attrs
        label = plain_text(label)
        if a.get('name') == 'page' and a.get('value', '').isdigit() and label == a['value']:
            page_numbers.add(int(a['value']))
    if page not in page_numbers:
        raise ValueError(f'Page {page}: pagination marker missing')
    return cards, any(n > page for n in page_numbers)


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_bytes(data)
    temp.replace(path)


def save_json(path, data):
    atomic_write(path, (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))


def merge_database(database, discovered):
    existing = {card['code'] for card in database['cards']}
    additions = sorted((c for code, c in discovered.items() if code not in existing), key=sort_key)
    result = {**database, 'cards': sorted(database['cards'] + additions, key=sort_key)}
    result['totalCards'] = len(result['cards'])
    if additions:
        result['updatedAt'] = now()
    # Preserve all existing entries, including duplicates and their relative precedence.
    encode = lambda c: json.dumps(c, ensure_ascii=False, sort_keys=True)
    retained = [c for c in result['cards'] if c['code'] in existing]
    if Counter(map(encode, retained)) != Counter(map(encode, database['cards'])):
        raise ValueError('Merge unexpectedly changed existing cards')
    retained_by_code = {c['code']: c for c in retained}
    for code, card in {c['code']: c for c in database['cards']}.items():
        if retained_by_code[code] != card:
            raise ValueError('Merge changed duplicate-card precedence')
    return result, additions


class Downloader:
    def __init__(self, delay, timeout, retries):
        self.delay = max(10, delay)  # Official robots.txt general crawl delay: 10 seconds.
        self.timeout = timeout
        self.retries = retries
        self.last_request = 0

    def get(self, url):
        for attempt in range(1, self.retries + 1):
            time.sleep(max(0, self.delay - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            try:
                req = Request(url, headers={'User-Agent': 'LyceeToolbox/1.0 (personal card database updater)',
                                            'Accept': 'text/html', 'Accept-Language': 'ja'})
                with urlopen(req, timeout=self.timeout) as response:
                    if urlparse(response.url).hostname != 'lycee-tcg.com':
                        raise ValueError('Unexpected redirect away from the official site')
                    raw = response.read()
                    encoding = response.headers.get_content_charset() or 'utf-8'
                    return raw.decode(encoding)
            except (HTTPError, URLError, TimeoutError, OSError, HTTPException) as exc:
                if isinstance(exc, HTTPError) and exc.code < 500 and exc.code not in (408, 429):
                    raise
                if attempt == self.retries:
                    raise
                print(f'  Request failed ({attempt}/{self.retries}): {exc}; retrying', flush=True)
                time.sleep(min(60, self.delay * attempt))


def crawl(args, existing):
    checkpoint = WORK / 'checkpoint.json'
    if args.resume:
        if not checkpoint.exists():
            raise ValueError('No checkpoint found; run without --resume first')
        state = json.loads(checkpoint.read_text(encoding='utf-8'))
        if state.get('source') != BASE_URL or state.get('schema') != 1:
            raise ValueError('Incompatible checkpoint')
        run_dir = Path(state['runDirectory'])
    else:
        run_dir = WORK / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        run_dir.mkdir(parents=True, exist_ok=False)
        state = {'schema': 1, 'source': BASE_URL, 'startedAt': now(),
                 'runDirectory': str(run_dir), 'pages': [], 'complete': False}
        save_json(checkpoint, state)

    discovered = {}
    signatures = set()
    has_next = True

    def accept(html, page):
        nonlocal has_next
        cards, has_next = parse_catalog(html, page)
        signature = tuple(c['code'] for c in cards)
        if signature in signatures:
            raise ValueError(f'Page {page}: repeated page; refusing an incomplete catalog')
        signatures.add(signature)
        for card in cards:
            if card['code'] in discovered:
                raise ValueError(f'Page {page}: overlapping card {card["code"]}; restart a fresh scan')
            discovered[card['code']] = card
        return len(cards)

    for page, entry in enumerate(state['pages'], 1):
        raw = (run_dir / entry['file']).read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry['sha256']:
            raise ValueError(f'Cached page {page} failed checksum')
        accept(raw.decode('utf-8'), page)
    if args.resume:
        print(f'Resumed {len(state["pages"])} cached pages ({len(discovered)} cards)', flush=True)

    downloader = Downloader(args.delay, args.timeout, args.retries)
    while has_next:
        page = len(state['pages']) + 1
        if page > args.max_pages:
            raise ValueError('Reached --max-pages while more pages exist; database was not modified')
        url = BASE_URL + '?' + urlencode({'sort': 'dcno', 'limit': 200, 'view': 'default', 'page': page})
        html = downloader.get(url)
        count = accept(html, page)
        filename = f'page-{page:03d}.html'
        raw = html.encode('utf-8')
        atomic_write(run_dir / filename, raw)
        state['pages'].append({'file': filename, 'url': url, 'sha256': hashlib.sha256(raw).hexdigest()})
        state['complete'] = not has_next
        save_json(checkpoint, state)
        pending = len(discovered.keys() - existing)
        print(f'Page {page}: {count} cards; catalog {len(discovered)}; new {pending}', flush=True)
    state['complete'] = True
    save_json(checkpoint, state)
    return discovered, run_dir, state


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--resume', action='store_true', help='Reuse saved scan pages, including a completed dry run')
    parser.add_argument('--dry-run', action='store_true', help='Scan and write a report, without updating the database')
    parser.add_argument('--delay', type=float, default=10, help='Minimum request interval in seconds (at least 10)')
    parser.add_argument('--timeout', type=float, default=45, help='Request timeout in seconds')
    parser.add_argument('--retries', type=int, default=3)
    parser.add_argument('--max-pages', type=int, default=200, help='Safety limit; hitting it aborts the merge')
    parser.add_argument('--catalog', action='store_true', help='Also rebuild searchable metadata after merging')
    args = parser.parse_args(argv)
    if args.timeout <= 0 or args.retries < 1 or args.max_pages < 1 or args.delay < 0:
        parser.error('timeout, retries, max-pages must be positive; delay must be nonnegative')
    original = DATABASE.read_bytes()
    database = json.loads(original)
    for card in database['cards']:
        sort_key(card)
    print(f'Existing database: {len(database["cards"])} records; scanning official catalog', flush=True)
    discovered, run_dir, state = crawl(args, {c['code'] for c in database['cards']})
    result, additions = merge_database(database, discovered)
    report = {'source': BASE_URL, 'checkedAt': now(), 'pages': len(state['pages']),
              'officialCards': len(discovered), 'previousRecords': len(database['cards']),
              'addedCount': len(additions), 'resultRecords': len(result['cards']),
              'dryRun': args.dry_run, 'addedCodes': [c['code'] for c in additions],
              'existingOnlyCodes': sorted({c['code'] for c in database['cards']} - discovered.keys()),
              'newCardsFile': str(run_dir / 'new-cards.json'), 'databaseWritten': False}
    save_json(run_dir / 'new-cards.json', {'cards': additions})
    if not args.dry_run and result != database:
        if DATABASE.read_bytes() != original:
            raise ValueError('Database changed during the scan; rerun with --resume to merge against the latest file')
        backup = run_dir / (DATABASE.name + '.bak')
        atomic_write(backup, original)
        newline = '\r\n' if b'\r\n' in original else '\n'
        encoded = json.dumps(result, ensure_ascii=False, indent=2).replace('\n', newline)
        if original.endswith(b'\n'):
            encoded += newline
        atomic_write(DATABASE, encoded.encode('utf-8'))
        report.update(databaseWritten=True, backup=str(backup))
    save_json(run_dir / 'report.json', report)
    save_json(WORK / 'latest-report.json', report)
    print(f'Completed: {len(additions)} new cards; {len(result["cards"])} total records', flush=True)
    print(f'Report: {WORK / "latest-report.json"}', flush=True)
    if args.dry_run:
        print('Dry run: database unchanged. Use --resume to merge this scan.', flush=True)
    elif not report['databaseWritten']:
        print('Database already up to date; no write needed.', flush=True)
    if args.catalog and not args.dry_run:
        from build_catalog import build
        build()
    return report


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        print(f'Update stopped: {exc}\nCompleted pages are saved. Retry with --resume.', file=sys.stderr)
        sys.exit(1)
