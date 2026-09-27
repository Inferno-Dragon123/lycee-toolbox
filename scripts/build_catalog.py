"""Build searchable metadata from a complete, checksum-verified official crawl.

Run after update_japanese_database.py. No network or translation calls.
The Japanese/Chinese final files remain the source of effect text.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urljoin

from update_japanese_database import (ROOT, WORK, BASE_URL, TABLE, CELL, Attributes,
                                     plain_text, parse_catalog, sort_key, save_json)


def number(value):
    if value in ('', '-'):
        return None
    if not value.isdigit():
        raise ValueError('Unexpected numeric stat: ' + value)
    return int(value)


def parse_metadata(html, page):
    parsed, _ = parse_catalog(html, page)
    result = []
    for (_, table), original in zip(TABLE.findall(html), parsed, strict=True):
        rows = [[(Attributes(a).attrs, body) for a, body in CELL.findall(row)]
                for row in re.findall(r'<tr\b[^>]*>(.*?)</tr\s*>', table, re.I | re.S)]
        if [len(r) for r in rows] not in ([5, 9, 9, 1, 3], [5, 9, 9, 1, 1, 3]):
            raise ValueError('Unexpected metadata layout for ' + original['code'])
        first, stats, last = rows[0], rows[2], rows[-1]
        values = [plain_text(body) for _, body in stats]
        images = [Attributes(a).attrs.get('src', '')
                  for a in re.findall(r'<img\b([^>]*)>', first[0][1], re.I)]
        images = [urljoin(BASE_URL, src) for src in images if '/image/' in src]
        if len(images) != 1 or not images[0].startswith(BASE_URL + 'image/'):
            raise ValueError('Missing official card image: ' + original['code'])
        cost = values[2]
        if cost not in ('', '-') and not re.fullmatch('[雪月花宙日無]+', cost):
            raise ValueError('Unknown cost: ' + cost)
        result.append({
            'code': original['code'], 'name': original['name'], 'img': images[0],
            'category': plain_text(first[3][1]), 'rarity': plain_text(first[4][1]),
            'attribute': values[0], 'ex': number(values[1]), 'cost': cost,
            'costTotal': None if cost == '-' else len(cost), 'position': values[3],
            'ap': number(values[4]), 'dp': number(values[5]), 'sp': number(values[6]),
            'dmg': number(values[7]), 'trait': values[8],
            'version': re.sub(r'^Version\s*:\s*', '', plain_text(last[0][1])),
            'brand': plain_text(last[1][1]),
            'illustrator': re.sub(r'^illust\s*:\s*', '', plain_text(last[2][1])),
            'team': plain_text(rows[4][0][1]) if len(rows) == 6 else '',
        })
    return result


def build(checkpoint=WORK / 'checkpoint.json', output=ROOT / 'data' / 'catalog.json'):
    state = json.loads(Path(checkpoint).read_text(encoding='utf-8'))
    if not state.get('complete') or state.get('source') != BASE_URL:
        raise ValueError('A complete official crawl is required')
    run = Path(state['runDirectory'])
    cards = []
    for page, entry in enumerate(state['pages'], 1):
        raw = (run / entry['file']).read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry['sha256']:
            raise ValueError('Crawl checksum mismatch')
        cards.extend(parse_metadata(raw.decode('utf-8'), page))
    codes = {c['code'] for c in cards}
    japanese = json.loads((ROOT / 'lycee-japanese-database-final.json').read_text(encoding='utf-8'))
    source_codes = {c['code'] for c in japanese['cards']}
    if len(codes) != len(cards) or codes != source_codes:
        raise ValueError('Catalog and final Japanese codes differ; update Japanese JSON first')
    result = {'schemaVersion': 1, 'totalCards': len(cards), 'source': BASE_URL,
              'cards': sorted(cards, key=sort_key)}
    save_json(Path(output), result)
    print(f'Built catalog: {len(cards)} unique cards -> {output}')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', type=Path, default=WORK / 'checkpoint.json')
    args = parser.parse_args()
    build(args.checkpoint)
