"""Repair support/convert terms against Japanese originals, without API calls.

Defaults to dry-run. --apply writes only confidently identified corrections,
preserving all records, metadata, ordering, separators and file formatting.
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path

from translation_terms import normalize_translation_terms
from update_and_translate import CHINESE_DATABASE, DATABASE, WORK, now_iso, save_database, save_json
from update_japanese_database import atomic_write


def repair_database(japanese, chinese, corrected_at):
    originals = defaultdict(set)
    for card in japanese['cards']:
        originals[card['code']].add(card['japaneseText'])
    changes, unresolved = [], []
    for card in chinese['cards']:
        candidates = originals.get(card['code'], set())
        if len(candidates) != 1:
            unresolved.append({'code': card['code'], 'issues': ['日文原文缺失或同编号原文冲突']})
            continue
        before = card['japaneseText']
        after, replacements, issues = normalize_translation_terms(next(iter(candidates)), before)
        if issues:
            unresolved.append({'code': card['code'], 'issues': issues})
        if after != before:
            # Verify only targeted words changed, keeping all delimiters/costs.
            assert before.count('|') == after.count('|')
            assert before.count('\n') == after.count('\n')
            card['japaneseText'] = after
            card['translatedAt'] = corrected_at
            changes.append({'code': card['code'], 'cid': card.get('cid', ''), 'changes': replacements})
    if changes:
        chinese['updatedAt'] = corrected_at
    semantic = [{'code': c['code'], 'changes': [change for change in c['changes'] if change.startswith('语义修正')]} for c in changes]
    semantic = [c for c in semantic if c['changes']]
    return {'changedRecords': len(changes), 'termReplacements': sum(sum(not t.startswith('语义修正') for t in c['changes']) for c in changes),
            'semanticCorrections': len(semantic), 'semanticChanges': semantic,
            'changes': changes, 'unresolved': unresolved}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--japanese', type=Path, default=DATABASE)
    parser.add_argument('--chinese', type=Path, default=CHINESE_DATABASE)
    parser.add_argument('--report', type=Path, default=WORK / 'alignment' / 'terminology-repair.json')
    args = parser.parse_args(argv)
    original = args.chinese.read_bytes()
    chinese = json.loads(original)
    japanese = json.loads(args.japanese.read_bytes())
    report = repair_database(japanese, chinese, now_iso())
    report['mode'] = 'apply' if args.apply else 'dry-run'
    if args.apply and report['changedRecords']:
        if args.chinese.read_bytes() != original:
            raise ValueError('Chinese database changed during terminology repair')
        atomic_write(args.chinese.with_suffix('.json.bak'), original)
        save_database(args.chinese, chinese, original)
    save_json(args.report, report)
    print(json.dumps({key: value for key, value in report.items() if key not in ('changes', 'unresolved', 'semanticChanges')}, ensure_ascii=False))
    print(f'Unresolved records: {len(report["unresolved"])}; report: {args.report}')
    return 1 if report['unresolved'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
