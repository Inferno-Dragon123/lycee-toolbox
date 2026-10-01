"""Regression tests for the translation/alignment pipeline; no paid API calls."""
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import update_and_translate as u
import check_translation_quality as quality


def card(code, text='日文'):
    return {'code': code, 'cid': '', 'name': '卡名', 'japaneseText': text}


class PipelineTests(unittest.TestCase):
    def test_quality_check_accepts_translated_ability_markers_and_matches_full_width_terms(self):
        jp = '[サイドステップ:[0]][誘発] 本文。[コスト] [無]:本文。'
        zh = '[横向侧移:[0]][诱发] 中文。[COST] [无]:中文。'
        self.assertEqual(quality.check_format_markers(jp, zh), [])
        self.assertEqual(quality.check_format_markers(jp, zh.replace('[COST]', '[COST能力]')), [])
        self.assertEqual(quality.check_terminology(jp, zh), [])
        self.assertTrue(quality.check_terminology('[ステップ:[0]]', '[未翻译:[0]]'))
        self.assertTrue(quality.check_format_markers('[宣言] [0]:本文', '[0]:中文'))

    def test_translated_cost_heading_and_colorless_glyph_are_not_new_costs(self):
        self.assertEqual(u.validate_translation('[コスト] [無無]:本文', '[COST] [无无]:中文'), '[COST] [無無]:中文')
        with self.assertRaises(ValueError):
            u.validate_translation('[無無]:本文', '[无]:中文')

    def test_env_file_loads_quotes_without_overriding_environment(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'EXISTING': 'keep'}, clear=True):
            p = Path(tmp) / '.env'
            p.write_text('DEEPSEEK_API_KEY="test-key"\nEXISTING=replace\n# COMMENT=ignore\n', encoding='utf-8')
            u.load_env(p)
            self.assertEqual(os.environ['DEEPSEEK_API_KEY'], 'test-key')
            self.assertEqual(os.environ['EXISTING'], 'keep')
            self.assertNotIn('COMMENT', os.environ)

    def test_api_checks_truncation_and_symbols_and_closes_response(self):
        def response(reason='stop', text='[C1]:译文'):
            return io.BytesIO(json.dumps({'choices': [{'finish_reason': reason, 'message': {'content': text}}]}).encode())
        good = response()
        with patch.object(u, 'urlopen', return_value=good):
            self.assertEqual(u.call_deepseek('[C1]:日文', 'fake'), '[C1]:译文')
        self.assertTrue(good.closed)
        for reason, text in [('length', '译文'), ('stop', ''), ('stop', '[C2]:译文')]:
            with self.subTest(reason=reason, text=text), patch.object(u, 'urlopen', return_value=response(reason, text)):
                with self.assertRaises(ValueError):
                    u.call_deepseek('[C1]:日文', 'fake', max_retries=1)

    def test_retry_temporary_but_not_credentials_error(self):
        success = io.BytesIO(json.dumps({'choices':[{'finish_reason':'stop','message':{'content':'译文'}}]}).encode())
        with patch.object(u, 'urlopen', side_effect=[HTTPError('https://test', 429, 'busy', {}, None), success]) as api, patch.object(u.time, 'sleep'):
            self.assertEqual(u.call_deepseek('日文', 'fake'), '译文')
            self.assertEqual(api.call_count, 2)
        with patch.object(u, 'urlopen', side_effect=HTTPError('https://test', 401, 'bad', {}, None)) as api:
            with self.assertRaises(u.PermanentAPIError):
                u.call_deepseek('日文', 'fake')
            self.assertEqual(api.call_count, 1)

    def test_cache_reuses_identical_variants_and_retries_only_failures(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(u.time, 'sleep'):
            cards = [card('LO-0002'), card('LO-0002-A'), card('LO-0001', '別の日文')]
            with patch.object(u, 'call_deepseek', side_effect=['译文', TimeoutError('interrupted')]) as api:
                good, bad = u.translate_cards(cards, 'fake', Path(tmp))
                self.assertEqual(api.call_count, 2)
                self.assertEqual([c['code'] for c in good], ['LO-0002', 'LO-0002-A'])
                self.assertEqual(bad[0]['code'], 'LO-0001')
            with patch.object(u, 'call_deepseek', return_value='第二译文') as api:
                good, bad = u.translate_cards(cards, 'fake', Path(tmp))
                self.assertEqual(api.call_count, 1)
                self.assertEqual(len(good), 3)
                self.assertFalse(bad)
            changed = card('LO-0002', '新しい日文')
            self.assertNotEqual(u.translation_key(changed), u.translation_key(cards[0]))

    def test_merge_keeps_curated_text_and_legacy_aliases(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'zh.json'
            original = [card('LO-0001', '精翻'), dict(card('LO-0001', '精翻'), cid='alias')]
            path.write_bytes(json.dumps({'cards': original, 'totalCards': 2}, ensure_ascii=False, indent=1).replace('\n', '\r\n').encode('utf-8'))
            with patch.object(u, 'CHINESE_DATABASE', path):
                self.assertTrue(u.merge_chinese_database([card('LO-0001', '覆盖'), card('LO-0002-A'), card('LO-0002'), card('LO-0002')]))
            data = u.load_json(path)
            self.assertEqual([c['code'] for c in data['cards']], ['LO-0002', 'LO-0002-A', 'LO-0001', 'LO-0001'])
            self.assertEqual(data['cards'][2:], original)
            self.assertTrue(path.read_bytes().startswith(b'{\r\n "cards"'))
            self.assertEqual(u.load_json(path.with_suffix('.json.bak'))['cards'], original)

    def test_skip_crawl_finds_historical_missing_without_latest_report(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(u.time, 'sleep'):
            root = Path(tmp); jp = root / 'jp.json'; zh = root / 'zh.json'
            u.save_json(jp, {'cards': [card('LO-0002'), card('LO-0001')], 'totalCards': 2})
            u.save_json(zh, {'cards': [card('LO-0001', '旧精翻')], 'totalCards': 1})
            with patch.multiple(u, DATABASE=jp, CHINESE_DATABASE=zh, WORK=root / 'work'), patch.object(u, 'call_deepseek', return_value='新翻译') as api, patch.dict(os.environ, {'DEEPSEEK_API_KEY': 'fake'}):
                self.assertEqual(u.main(['--skip-crawl', '--env-file', str(root / 'none')]), 0)
                self.assertEqual(api.call_count, 1)
                self.assertEqual(u.align_databases()['missingChinese'], [])
                before = zh.read_bytes()
                self.assertEqual(u.main(['--skip-crawl']), 0)
                self.assertEqual(zh.read_bytes(), before)
            self.assertEqual(u.load_json(zh)['cards'][1]['japaneseText'], '旧精翻')

    def test_dry_run_does_not_translate_or_touch_databases(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); jp=root/'jp.json'; zh=root/'zh.json'
            u.save_json(jp, {'cards':[card('LO-0001')], 'totalCards':1})
            u.save_json(zh, {'cards':[], 'totalCards':0})
            before = (jp.read_bytes(), zh.read_bytes())
            with patch.multiple(u, DATABASE=jp, CHINESE_DATABASE=zh, WORK=root/'work'), patch.object(u, 'call_deepseek') as api:
                self.assertEqual(u.main(['--skip-crawl', '--dry-run']), 0)
                api.assert_not_called()
            self.assertEqual((jp.read_bytes(), zh.read_bytes()), before)

    def test_empty_effect_still_aligns_without_api_call(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(u, 'call_deepseek') as api:
            good, bad = u.translate_cards([card('LO-0001', '')], None, Path(tmp))
            self.assertEqual(good[0]['japaneseText'], '')
            self.assertFalse(bad)
            api.assert_not_called()

    def test_automation_can_publish_japanese_fallback_after_permanent_api_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); jp = root / 'jp.json'; zh = root / 'zh.json'
            u.save_json(jp, {'cards': [card('LO-0002'), card('LO-0001')], 'totalCards': 2})
            u.save_json(zh, {'cards': [card('LO-0001', '已有中文')], 'totalCards': 1})
            with patch.multiple(u, DATABASE=jp, CHINESE_DATABASE=zh, WORK=root / 'work'), \
                    patch.object(u, 'translate_cards', side_effect=u.PermanentAPIError('DeepSeek HTTP 402')):
                result = u.main(['--skip-crawl', '--allow-missing-translations'])
            self.assertEqual(result, 0)
            report = u.load_json(root / 'work' / 'alignment' / 'report.json')
            self.assertEqual(report['missingChinese'], ['LO-0002'])
            self.assertEqual(report['failures'][0]['error'], 'DeepSeek HTTP 402')
            self.assertEqual(u.load_json(zh)['totalCards'], 1)

if __name__ == '__main__':
    unittest.main()
