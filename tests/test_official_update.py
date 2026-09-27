import copy
from http.client import IncompleteRead
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from scripts import update_japanese_database as updater


def card(code, text='[宣言] １枚ドローする。', cid=''):
    return {'code': code, 'cid': cid, 'name': 'カード名', 'japaneseText': text}


def table(code='LO-6826', effect='[宣言] １枚ドローする。'):
    return f'''<table id="cardtable"><tr><td>{code}</td>
    <td><a href="./card_detail.pl?cardno={code}">肩書き &amp; カード名</a></td></tr>
    <tr><td colspan="10" height="60px">{effect}</td></tr></table>'''


def page(content, number=1, next_page=None):
    buttons = f"<button name='page' value='{number}'>{number}</button>"
    if next_page:
        buttons += f"<button name='page' value='{next_page}'>{next_page}</button>"
    buttons += f"<button name='page' value='{number + 1}'>&gt;&gt;</button>"
    return buttons + content


class ParsingTests(unittest.TestCase):
    def test_nested_layout_keeps_first_card(self):
        html = page('<table class="layout"><tr><td>' + table() + table('LO-6825') + '</td></tr></table>', next_page=2)
        cards, more = updater.parse_catalog(html, 1)
        self.assertEqual([c['code'] for c in cards], ['LO-6826', 'LO-6825'])
        self.assertEqual(cards[0]['name'], '肩書き & カード名')
        self.assertEqual(cards[0]['cid'], '')
        self.assertTrue(more)

    def test_effect_symbols_newlines_and_provenance(self):
        text = updater.plain_text(' [宣言] &lt;対象&gt;<br>[C1] &#38634;'
                                  '<img alt="[T]" src="cost.png">'
                                  '<DIV>初出 : 景品<br><a href="/card/deck_search.pl?word=LO-1">検索する</a></DIV>')
        self.assertEqual(text, '[宣言] <対象>\n[C1] 雪[T]\n初出 : 景品')

    def test_unlabelled_effect_image_is_not_silently_lost(self):
        with self.assertRaises(ValueError):
            updater.plain_text('[宣言]<img src="cost.png">')

    def test_empty_effect_is_valid_but_missing_cell_is_not(self):
        cards, more = updater.parse_catalog(page(table(effect='')), 1)
        self.assertEqual(cards[0]['japaneseText'], '')
        self.assertFalse(more)
        with self.assertRaises(ValueError):
            updater.parse_catalog(page(table().replace('height="60px"', '')), 1)

    def test_missing_pagination_or_duplicate_table_fails(self):
        for html in (table(), page(table() + table())):
            with self.assertRaises(ValueError):
                updater.parse_catalog(html, 1)

    def test_mismatched_detail_link_fails(self):
        with self.assertRaises(ValueError):
            updater.parse_catalog(page(table().replace('cardno=LO-6826', 'cardno=LO-1111')), 1)

    def test_truncated_card_table_is_not_skipped(self):
        with self.assertRaisesRegex(ValueError, 'incomplete card table'):
            updater.parse_catalog(page(table() + '<table id="cardtable"><tr><td>LO-6825'), 1)

    def test_last_page_arrow_does_not_create_another_page(self):
        cards, more = updater.parse_catalog(page(table(), number=50), 50)
        self.assertEqual(len(cards), 1)
        self.assertFalse(more)


class MergeTests(unittest.TestCase):
    def test_sort_suffixes_and_keep_existing_duplicates(self):
        database = {'generatedAt': 'original', 'totalCards': 4, 'custom': 'keep', 'cards': [
            card('LO-0001K'), card('LO-0001', 'first', '1'),
            card('LO-0001', 'last', '2'), card('LO-0001A')]}
        snapshot = copy.deepcopy(database)
        result, added = updater.merge_database(database, {'LO-0002': card('LO-0002'),
            'LO-0001': card('LO-0001', 'do not overwrite'), 'LO-0001-B': card('LO-0001-B')})
        self.assertEqual([c['code'] for c in result['cards']],
                         ['LO-0002', 'LO-0001', 'LO-0001', 'LO-0001A', 'LO-0001-B', 'LO-0001K'])
        self.assertEqual(result['cards'][1:3], database['cards'][1:3])
        self.assertEqual(result['generatedAt'], 'original')
        self.assertEqual(result['custom'], 'keep')
        self.assertEqual(result['totalCards'], 6)
        self.assertEqual(len(added), 2)
        self.assertEqual(database, snapshot)
        again, additions = updater.merge_database(result, {'LO-0002': card('LO-0002')})
        self.assertEqual(again, result)
        self.assertEqual(additions, [])

    def test_numeric_gaps_are_not_invented(self):
        database = {'cards': [card('LO-0003'), card('LO-0001')], 'totalCards': 2}
        result, additions = updater.merge_database(database, {'LO-0004': card('LO-0004')})
        self.assertEqual([c['code'] for c in additions], ['LO-0004'])
        self.assertNotIn('LO-0002', [c['code'] for c in result['cards']])


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.db = root / 'japanese.json'
        self.db.write_bytes(json.dumps({'generatedAt': 'original', 'totalCards': 1,
                                       'cards': [card('LO-0001')]}).encode())
        self.original = self.db.read_bytes()
        self.work = root / 'work'
        for name, value in [('DATABASE', self.db), ('WORK', self.work)]:
            p = patch.object(updater, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_failed_scan_resume_dry_run_merge_and_idempotence(self):
        first = page(table('LO-0003'), next_page=2)
        last = page(table('LO-0001'), number=2)
        with patch.object(updater.Downloader, 'get', side_effect=[first, OSError('offline')]):
            with self.assertRaises(OSError):
                updater.main([])
        self.assertEqual(self.db.read_bytes(), self.original)
        with patch.object(updater.Downloader, 'get', return_value=last) as fetch:
            report = updater.main(['--resume', '--dry-run'])
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(report['addedCodes'], ['LO-0003'])
        self.assertEqual(self.db.read_bytes(), self.original)
        with patch.object(updater.Downloader, 'get', side_effect=AssertionError('No network expected')):
            report = updater.main(['--resume'])
            self.assertEqual(Path(report['backup']).read_bytes(), self.original)
            updated = self.db.read_bytes()
            report = updater.main(['--resume'])
            self.assertFalse(report['databaseWritten'])
            self.assertEqual(self.db.read_bytes(), updated)

    def test_repeated_page_aborts_without_database_write(self):
        with patch.object(updater.Downloader, 'get', side_effect=[
                page(table(), next_page=2), page(table(), number=2)]):
            with self.assertRaisesRegex(ValueError, 'repeated page'):
                updater.main([])
        self.assertEqual(self.db.read_bytes(), self.original)

    def test_page_limit_never_merges_partial_scan(self):
        with patch.object(updater.Downloader, 'get', return_value=page(table(), next_page=2)):
            with self.assertRaisesRegex(ValueError, 'max-pages'):
                updater.main(['--max-pages', '1'])
        self.assertEqual(self.db.read_bytes(), self.original)

    def test_concurrent_database_edit_is_preserved(self):
        changed = self.original + b'\n'

        def concurrent_edit(url):
            self.db.write_bytes(changed)
            return page(table())

        with patch.object(updater.Downloader, 'get', side_effect=concurrent_edit):
            with self.assertRaisesRegex(ValueError, 'Database changed'):
                updater.main([])
        self.assertEqual(self.db.read_bytes(), changed)


class DownloadTests(unittest.TestCase):
    def test_incomplete_response_retries(self):
        with patch.object(updater, 'urlopen', side_effect=IncompleteRead(b'partial')), \
                patch.object(updater.time, 'sleep'), patch.object(updater.time, 'monotonic', return_value=100):
            with self.assertRaises(IncompleteRead):
                updater.Downloader(10, 45, 3).get(updater.BASE_URL)
            self.assertEqual(updater.urlopen.call_count, 3)

    def test_not_found_is_not_retried(self):
        error = HTTPError(updater.BASE_URL, 404, 'Not found', {}, None)
        with patch.object(updater, 'urlopen', side_effect=error), \
                patch.object(updater.time, 'sleep'), patch.object(updater.time, 'monotonic', return_value=100):
            with self.assertRaises(HTTPError):
                updater.Downloader(10, 45, 3).get(updater.BASE_URL)
            self.assertEqual(updater.urlopen.call_count, 1)


if __name__ == '__main__':
    unittest.main()
