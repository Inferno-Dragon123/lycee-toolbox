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
import normalize_translation_terms as repair
from translation_terms import normalize_translation_terms


def card(code, text='日文'):
    return {'code': code, 'cid': '', 'name': '卡名', 'japaneseText': text}


class PipelineTests(unittest.TestCase):
    def test_support_convert_repairs_keep_assist_supporter_names_and_costs(self):
        jp = '[アシスト][サポーター:[花花]][コンバート:[C4]:→「コンバートのサポート」]\n[誘発] 味方キャラでサポートをしたとき、サポート能力値にする。'
        zh = '[辅助][支援者:[花花]][コンバート:[C4]:→「コンバートのサポート」]\n[诱发] 当用我方角色进行辅助时，将辅助能力值变为原值。'
        fixed, changes, unresolved = normalize_translation_terms(jp, zh)
        self.assertEqual(fixed, '[辅助][支援者:[花花]][换装:[C4]:→「コンバートのサポート」]\n[诱发] 当用我方角色进行支援时，将支援能力值变为原值。')
        self.assertEqual(len(changes), 3)
        self.assertEqual(unresolved, [])
        self.assertEqual(normalize_translation_terms(jp, fixed), (fixed, [], []))
        self.assertEqual(quality.check_terminology(jp, fixed), [])
        self.assertTrue(quality.check_terminology(jp, zh))

    def test_ambiguous_terms_are_reported_without_guessing_or_modifying(self):
        jp = '[誘発] このキャラでサポートをしたとき、本文。'
        for zh in ('[诱发] 支援者进行辅助和支持。', '[诱发]\n进行辅助。'):
            with self.subTest(zh=zh):
                fixed, changes, unresolved = normalize_translation_terms(jp, zh)
                self.assertEqual(fixed, zh)
                self.assertEqual(changes, [])
                self.assertTrue(unresolved)
                with self.assertRaises(ValueError):
                    u.validate_translation(jp, zh)

    def test_receiving_support_trigger_is_fixed_without_reversing_giving_support(self):
        for trigger, expected in [('に', '当这个角色受到支援时'), ('で', '当这个角色进行支援时')]:
            jp = f'[誘発] このキャラ{trigger}サポートをしたとき、このキャラにAP+2する。'
            zh = '[诱发] 当这个角色进行辅助时，这个角色获得AP+2。'
            fixed, changes, unresolved = normalize_translation_terms(jp, zh)
            self.assertIn(expected, fixed)
            self.assertEqual(sum(c.startswith('语义修正') for c in changes), int(trigger == 'に'))
            self.assertEqual(unresolved, [])
        correct = '[诱发] 当这个角色被支援时，这个角色获得AP+2。'
        self.assertEqual(normalize_translation_terms('[誘発] このキャラにサポートをしたとき、このキャラにAP+2する。', correct), (correct, [], []))

    def test_database_repair_keeps_aliases_and_metadata_and_is_idempotent(self):
        jp = {'cards': [card('LO-0001', '[コンバート:[花花]:→「角色」]')]}
        records = [dict(card('LO-0001', '[コンバート:[花花]:→「角色」]'), translatedAt='old'),
                   dict(card('LO-0001', '[换装:[花花]:→「角色」]'), cid='alias', translatedAt='keep')]
        zh = {'cards': records, 'totalCards': 2, 'generatedAt': 'keep'}
        report = repair.repair_database(jp, zh, 'new')
        self.assertEqual(report['changedRecords'], 1)
        self.assertEqual([c['cid'] for c in zh['cards']], ['', 'alias'])
        self.assertEqual([c['translatedAt'] for c in zh['cards']], ['new', 'keep'])
        self.assertEqual((zh['totalCards'], zh['generatedAt']), (2, 'keep'))
        self.assertEqual(repair.repair_database(jp, zh, 'newer')['changedRecords'], 0)

    def test_current_prompt_invalidates_old_cache_and_legacy_reuse_cannot_restore_old_terms(self):
        original = card('LO-0001', '[コンバート:[0]:→「角色」]\n[誘発] このキャラでサポートをしたとき、本文。')
        translated = '[コンバート:[0]:→「角色」]\n[诱发] 当这个角色进行辅助时，中文。'
        key = u.translation_key(original)
        with patch.object(u, 'SYSTEM_PROMPT', u.SYSTEM_PROMPT + '\nold-prompt'):
            self.assertNotEqual(key, u.translation_key(original))
        with tempfile.TemporaryDirectory() as tmp, patch.object(u, 'call_deepseek') as api:
            reused, failures = u.translate_cards([original], None, Path(tmp), reuse={key: translated}, reuse_dates={key: 'old'})
            self.assertEqual(failures, [])
            self.assertIn('[换装:[0]', reused[0]['japaneseText'])
            self.assertIn('进行支援时', reused[0]['japaneseText'])
            self.assertNotEqual(reused[0]['translatedAt'], 'old')
            u.save_json(Path(tmp) / 'translation-cache' / (key + '.json'), {'text': translated, 'translatedAt': 'old'})
            with patch.object(u, 'now_iso', return_value='2026-10-04T00:00:00Z'):
                cached, failures = u.translate_cards([original], None, Path(tmp))
            self.assertEqual(failures, [])
            self.assertEqual(cached[0]['japaneseText'], reused[0]['japaneseText'])
            with patch.object(u, 'now_iso', return_value='2026-10-05T00:00:00Z'):
                later, failures = u.translate_cards([original], None, Path(tmp))
            self.assertEqual(later[0]['translatedAt'], cached[0]['translatedAt'])
            api.assert_not_called()

    def test_full_width_unit_quantity_is_reported(self):
        self.assertTrue(quality.check_quantity_words('１体角色'))
        self.assertEqual(quality.check_quantity_words('1个角色，体力3。'), [])

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

    def test_translation_dates_survive_cache_and_reused_card_faces(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(u.time, 'sleep'):
            original = card('LO-0001')
            with patch.object(u, 'call_deepseek', return_value='译文'), patch.object(u, 'now_iso', return_value='2026-09-28T00:00:00Z'):
                good, _ = u.translate_cards([original], 'fake', Path(tmp))
            self.assertEqual(good[0]['translatedAt'], '2026-09-28T00:00:00Z')
            with patch.object(u, 'call_deepseek') as api, patch.object(u, 'now_iso', return_value='2026-10-03T00:00:00Z'):
                cached, _ = u.translate_cards([original], 'fake', Path(tmp))
                key = u.translation_key(original)
                reused, _ = u.translate_cards([original], 'fake', Path(tmp), reuse={key: '译文'}, reuse_dates={key: good[0]['translatedAt']})
                legacy, _ = u.translate_cards([original], 'fake', Path(tmp), reuse={key: '旧译文'})
                api.assert_not_called()
            self.assertEqual(cached[0]['translatedAt'], good[0]['translatedAt'])
            self.assertEqual(reused[0]['translatedAt'], good[0]['translatedAt'])
            self.assertNotIn('translatedAt', legacy[0])

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
