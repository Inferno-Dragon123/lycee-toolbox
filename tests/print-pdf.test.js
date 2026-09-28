import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createPrintPdf, printSlots } from '../public/print-pdf.js';

test('A4 grid paginates physical copies and preserves artwork codes at exact millimetre positions', () => {
    const slots = printSlots({ cards: { 'LO-6826': 6, 'LO-6826-A': 4 } });
    assert.equal(slots.length, 10);
    assert.deepEqual(slots[0], { code: 'LO-6826', page: 0, x: 7, y: 7 });
    assert.deepEqual(slots[2], { code: 'LO-6826', page: 0, x: 135, y: 7 });
    assert.deepEqual(slots[8], { code: 'LO-6826-A', page: 0, x: 135, y: 185 });
    assert.deepEqual(slots[9], { code: 'LO-6826-A', page: 1, x: 7, y: 7 });
    assert.equal(printSlots({ cards: { 'LO-6826': 60 } }).at(-1).page, 6);
    assert.throws(() => printSlots({ cards: {} }));
});

test('all copies reuse downloaded artwork; a missing image aborts the print document', async () => {
    const image = 'data:image/jpeg;base64,' + (await sharp({ create: { width: 126, height: 176, channels: 3, background: '#123456' } }).jpeg().toBuffer()).toString('base64');
    const deck = { name: '测试打印', cards: { 'LO-6826': 6, 'LO-6826-A': 4 } };
    const cards = Object.keys(deck.cards).map(code => ({ code, img: 'https://lycee-tcg.com/card/image/' + code + '.png' }));
    let calls = 0;
    const result = await createPrintPdf(deck, cards, { loadImage: async () => { calls++; return image; } });
    assert.equal(calls, 2); assert.equal(result.pages, 2); assert.equal(result.count, 10);
    const bytes = Buffer.from(await result.blob.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.match(bytes.toString('latin1'), /\/PrintScaling \/None/);
    await assert.rejects(createPrintPdf(deck, cards, { loadImage: async card => {
        if (card.code.endsWith('-A')) throw new Error('offline'); return image;
    } }), /LO-6826-A/);
    await assert.rejects(createPrintPdf(deck, []), /缺少卡图资料/);
});
