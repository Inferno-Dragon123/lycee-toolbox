import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPdf } from '../lib/pdf.js';
import { byCode } from '../lib/catalog.js';

const pageCount = buffer => [...buffer.toString('latin1').matchAll(/\/Type \/Page\b/g)].length;
test('PDF footer stays on the content page and missing images preserve a readable card table', async () => {
    const card = byCode.get('LO-6826');
    const result = await renderPdf({ name: '中文卡表', cards: { [card.code]: 4 } }, [card], new Map());
    assert.equal(result.buffer.subarray(0, 5).toString(), '%PDF-');
    assert.equal(pageCount(result.buffer), 1, 'footer must not create an extra blank page');
    assert.equal(result.missingImages, 1);
});
test('long effects continue over multiple pages without a fixed-height truncation', async () => {
    const card = { ...byCode.get('LO-6826'), effectZh: '用于验证长效果跨页的中文文本。\n'.repeat(150) };
    const result = await renderPdf({ name: '长效果卡表', cards: { [card.code]: 1 } }, [card], new Map());
    const pages = pageCount(result.buffer);
    assert(pages >= 3 && pages <= 5, `unexpected page count: ${pages}`);
});
