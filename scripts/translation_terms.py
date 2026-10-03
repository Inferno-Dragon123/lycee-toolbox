"""Conservative, offline corrections for the support/convert terminology update.

Align effect lines with their Japanese originals. Never rewrite quoted names or
the separate assist/supporter abilities. Uncertain alignments are reported.
"""
import re
import unicodedata


QUOTED = re.compile(r'「[^」]*」|『[^』]*』|“[^”]*”')
CONVERT = re.compile(r'(?<=\[)(?:コンバート|ｺﾝﾊﾞｰﾄ|换装)(?=[:：\]])')
SUPPORT = re.compile(r'辅助|支持|援助|サポート(?!ー)|ｻﾎﾟｰﾄ(?!ｰ)|支援(?!者)')
ASSIST_HEADING = re.compile(r'(?<=\[)辅助(?=[:：\]])')


def mask_names(text):
    return QUOTED.sub(lambda m: ' ' * len(m[0]), text)


def normalize_translation_terms(japanese_text, chinese_text):
    """Return corrected text, change descriptions, and unresolved diagnostics."""
    source = unicodedata.normalize('NFKC', japanese_text)
    jp_lines, zh_lines = source.split('\n'), chinese_text.split('\n')
    source_has_terms = bool(re.search(r'サポート(?!ー)|コンバート', mask_names(source)))
    if len(jp_lines) != len(zh_lines):
        return chinese_text, [], (['术语修正需要中日文逐行对应'] if source_has_terms else [])

    changes, unresolved = [], []
    for index, (jp, zh) in enumerate(zip(jp_lines, zh_lines)):
        jp = mask_names(jp)
        visible = mask_names(zh)
        for term, pattern, japanese_pattern in (
            ('换装', CONVERT, r'(?<=\[)コンバート(?=[:：\]])'),
            ('支援', SUPPORT, r'サポート(?!ー)'),
        ):
            expected = len(re.findall(japanese_pattern, jp))
            if not expected:
                continue
            searchable = visible
            if term == '支援':
                searchable = ASSIST_HEADING.sub(lambda m: ' ' * len(m[0]), searchable)
            found = list(pattern.finditer(searchable))
            if len(found) != expected:
                unresolved.append(f'第{index + 1}行{term}对应数量不明确: 日文{expected}，中文{len(found)}')
                continue
            for match in reversed(found):
                if match[0] != term:
                    zh = zh[:match.start()] + term + zh[match.end():]
                    changes.append(f'第{index + 1}行: {match[0]} → {term}')
            visible = mask_names(zh)
        # Precisely identified legacy mistranslation: に is the recipient of
        # support. The で/using-this-character trigger must retain its direction.
        if 'このキャラにサポートをしたとき' in jp and '当这个角色进行支援时' in mask_names(zh):
            wrong = '当这个角色进行支援时'
            right = '当这个角色受到支援时'
            matches = list(re.finditer(wrong, mask_names(zh)))
            for match in reversed(matches):
                zh = zh[:match.start()] + right + zh[match.end():]
                changes.append(f'语义修正，第{index + 1}行: {wrong} → {right}')
        zh_lines[index] = zh
    return '\n'.join(zh_lines), changes, unresolved


def term_issues(japanese_text, chinese_text):
    _, changes, unresolved = normalize_translation_terms(japanese_text, chinese_text)
    return ['术语未正确翻译: ' + change for change in changes] + unresolved
