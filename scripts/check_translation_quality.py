#!/usr/bin/env python3
"""Translation quality checker for lycee-toolbox

This script validates translations against the terminology rules and formatting requirements.
Use it to check translation quality before deploying updates.

Usage:
    python scripts/check_translation_quality.py
    python scripts/check_translation_quality.py --codes LO-6826 LO-6827
    python scripts/check_translation_quality.py --sample 20
"""

import argparse
import json
import random
import re
import unicodedata
from pathlib import Path
from collections import defaultdict
from update_and_translate import validate_translation

ROOT = Path(__file__).resolve().parents[1]
JAPANESE_DB = ROOT / 'lycee-japanese-database-final.json'
CHINESE_DB = ROOT / 'lycee-chinese-database-final.json'

# Terminology mapping from system prompt
TERMINOLOGY = {
    'ｽﾃｯﾌﾟ': '移动',
    'ｻｲﾄﾞｽﾃｯﾌﾟ': '横向侧移',
    'ｵｰﾀﾞｰｽﾃｯﾌﾟ': '纵向移动',
    'ｵｰﾀﾞｰﾁｪﾝｼﾞ': '位置交换',
    'ｼﾞｬﾝﾌﾟ': '跳跃',
    'ﾍﾟﾅﾙﾃｨ': '离场惩罚',
    'ｱｸﾞﾚｯｼﾌﾞ': '进取心',
    'ｱｼｽﾄ': '辅助',
    'ｴﾝｹﾞｰｼﾞ': '结合',
    'ﾘｶﾊﾞﾘｰ': '补正',
    'ｶﾞｯﾂ': '斗志',
    'ﾘｰﾀﾞｰ': '领导',
    'ｻﾎﾟｰﾀｰ': '支援者',
    'ﾎﾞｰﾅｽ': '奖励',
    'ﾁｬｰｼﾞ': '充能',
    'ﾀｰﾝﾘｶﾊﾞﾘｰ': '回合补正',
    'ﾌﾟﾘﾝｼﾊﾟﾙ': '主演',
    'ｻﾌﾟﾗｲｽﾞ': '突袭',
    'ｺｽﾄ': 'COST能力',
    'ｴﾘｱ': '场地',
}

# Format markers that should be preserved
FORMAT_MARKERS = ['[宣言]', '[诱发]', '[COST]', '[切札]', '[永続]', '[自動]', '[起動]']


def load_databases():
    """Load both Japanese and Chinese databases."""
    japanese_data = json.loads(JAPANESE_DB.read_text(encoding='utf-8'))
    chinese_data = json.loads(CHINESE_DB.read_text(encoding='utf-8'))

    japanese_map = {card['code']: card for card in japanese_data['cards']}
    chinese_map = {card['code']: card for card in chinese_data['cards']}

    return japanese_map, chinese_map


def check_terminology(japanese_text, chinese_text):
    """Check if terminology is correctly translated."""
    issues = []

    remaining = unicodedata.normalize('NFKC', japanese_text)
    # Match complete ability headings, rather than a substring of another ability
    # (サイドステップ contains ステップ) or an ordinary occurrence of コスト.
    headings = re.findall(r'\[([^\[\]:]+)(?=:|\])', remaining)
    for jp_term, cn_term in TERMINOLOGY.items():
        jp_term = unicodedata.normalize('NFKC', jp_term)
        if jp_term in headings:
            if jp_term == 'コスト' and '[COST]' in chinese_text:
                continue
            if cn_term not in chinese_text:
                issues.append(f"术语未正确翻译: {jp_term} → {cn_term}")

    return issues


def check_format_markers(japanese_text, chinese_text):
    """Check if format markers are preserved."""
    issues = []

    headings = {'宣言': '宣言', '誘発': '诱发', '常時': '常时', 'コスト': 'COST',
                '切札': '切札', '永続': '永续', '自動': '自动', '起動': '起动'}
    for jp, zh in headings.items():
        before = japanese_text.count(f'[{jp}]')
        aliases = {jp, zh} | ({'COST能力'} if jp == 'コスト' else set())
        after = sum(chinese_text.count(f'[{name}]') for name in aliases)
        if before != after:
            issues.append(f'能力标记数量不匹配: [{jp}] → [{zh}]')
    if japanese_text.strip():
        try:
            validate_translation(japanese_text, chinese_text)
        except ValueError as exc:
            issues.append('格式符号检查: ' + str(exc))

    return issues


def check_separators(japanese_text, chinese_text):
    """Check if separators (|) are preserved in the same positions."""
    issues = []

    jp_sep_count = japanese_text.count('|')
    cn_sep_count = chinese_text.count('|')

    if jp_sep_count != cn_sep_count:
        issues.append(f"分隔符数量不匹配: 日文 {jp_sep_count} 个，中文 {cn_sep_count} 个")

    return issues


def check_quantity_words(chinese_text):
    """Check if quantity words use '个' instead of '体'."""
    issues = []

    # Check for '体' usage (should not be used for units)
    if re.search(r'\d+体', chinese_text):
        issues.append("量词使用错误: 应使用「个」而非「体」")

    return issues


def check_empty_translation(chinese_text):
    """Check if translation is empty."""
    if not chinese_text or not chinese_text.strip():
        return ["翻译为空"]
    return []


def check_card_quality(code, japanese_card, chinese_card):
    """Check translation quality for a single card."""
    if not chinese_card:
        return {
            'code': code,
            'status': 'missing',
            'issues': ['中文翻译缺失'],
            'severity': 'high'
        }

    jp_text = japanese_card['japaneseText']
    cn_text = chinese_card['japaneseText']

    all_issues = []

    # Run all checks
    if jp_text.strip():
        all_issues.extend(check_empty_translation(cn_text))
    all_issues.extend(check_terminology(jp_text, cn_text))
    all_issues.extend(check_format_markers(jp_text, cn_text))
    all_issues.extend(check_separators(jp_text, cn_text))
    all_issues.extend(check_quantity_words(cn_text))

    if not all_issues:
        return {
            'code': code,
            'status': 'good',
            'issues': [],
            'severity': 'none'
        }

    # Determine severity
    severity = 'low'
    if any('缺失' in issue or '为空' in issue for issue in all_issues):
        severity = 'high'
    elif any('不匹配' in issue or '错误' in issue for issue in all_issues):
        severity = 'medium'

    return {
        'code': code,
        'status': 'issues',
        'issues': all_issues,
        'severity': severity
    }


def print_card_result(result, verbose=False):
    """Print result for a single card."""
    code = result['code']
    status = result['status']

    if status == 'good':
        if verbose:
            print(f"✅ {code}: 翻译质量良好")
    elif status == 'missing':
        print(f"❌ {code}: 中文翻译缺失")
    else:
        severity_icons = {'low': '⚠️ ', 'medium': '⚠️ ', 'high': '❌'}
        icon = severity_icons.get(result['severity'], '⚠️ ')
        print(f"{icon} {code}: {len(result['issues'])} 个问题")
        for issue in result['issues']:
            print(f"     - {issue}")


def main():
    parser = argparse.ArgumentParser(
        description='Check translation quality for lycee cards',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--codes', nargs='+', help='Specific card codes to check')
    parser.add_argument('--sample', type=int, help='Check a random sample of N cards')
    parser.add_argument('--all', action='store_true', help='Check all translated cards')
    parser.add_argument('--verbose', '-v', action='store_true', help='Show results for good translations too')

    args = parser.parse_args()

    print("=" * 70)
    print("Translation Quality Checker")
    print("=" * 70)
    print()

    # Load databases
    print("Loading databases...", end=" ")
    japanese_map, chinese_map = load_databases()
    print(f"✅ ({len(japanese_map)} Japanese, {len(chinese_map)} Chinese)")
    print()

    # Determine which cards to check
    if args.codes:
        codes_to_check = args.codes
        print(f"Checking {len(codes_to_check)} specified cards")
    elif args.sample:
        translated_codes = [code for code in japanese_map.keys() if code in chinese_map]
        sample_size = min(args.sample, len(translated_codes))
        codes_to_check = random.sample(translated_codes, sample_size)
        print(f"Checking random sample of {sample_size} cards")
    elif args.all:
        codes_to_check = list(japanese_map.keys())
        print(f"Checking all {len(codes_to_check)} cards")
    else:
        # Default: check most recent 50 translated cards
        translated_codes = [code for code in japanese_map.keys() if code in chinese_map]
        codes_to_check = translated_codes[:50]
        print(f"Checking most recent 50 translated cards (use --all for complete check)")

    print()
    print("-" * 70)
    print()

    # Check each card
    results = []
    for code in codes_to_check:
        japanese_card = japanese_map.get(code)
        chinese_card = chinese_map.get(code)

        if not japanese_card:
            print(f"⚠️  {code}: 日文卡牌不存在")
            continue

        result = check_card_quality(code, japanese_card, chinese_card)
        results.append(result)

        if result['status'] != 'good' or args.verbose:
            print_card_result(result, args.verbose)

    # Summary
    print()
    print("=" * 70)
    print("Summary")
    print("=" * 70)

    status_counts = defaultdict(int)
    severity_counts = defaultdict(int)

    for result in results:
        status_counts[result['status']] += 1
        severity_counts[result['severity']] += 1

    total = len(results)
    if not total:
        print('No matching cards to check.')
        return 1
    good = status_counts.get('good', 0)
    issues = status_counts.get('issues', 0)
    missing = status_counts.get('missing', 0)

    print(f"Total checked: {total}")
    print(f"  ✅ Good: {good} ({good/total*100:.1f}%)")
    print(f"  ⚠️  Issues: {issues} ({issues/total*100:.1f}%)")
    if missing > 0:
        print(f"  ❌ Missing: {missing} ({missing/total*100:.1f}%)")

    if issues > 0:
        print()
        print("Issue severity:")
        print(f"  High: {severity_counts.get('high', 0)}")
        print(f"  Medium: {severity_counts.get('medium', 0)}")
        print(f"  Low: {severity_counts.get('low', 0)}")

    print()

    # Exit code
    if missing > 0 or severity_counts.get('high', 0) > 0:
        print("❌ Quality check failed: critical issues found")
        return 1
    elif issues > 0:
        print("⚠️  Quality check passed with warnings")
        return 0
    else:
        print("✅ All translations passed quality check")
        return 0


if __name__ == '__main__':
    import sys
    sys.exit(main())
