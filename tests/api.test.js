import test from 'node:test';
import assert from 'node:assert/strict';
import cardHandler from '../api/cards.js';
import deckHandler from '../api/decks.js';
import importHandler from '../api/import-deck.js';
import pdfHandler from '../api/generate-pdf.js';
import imageHandler from '../api/image-proxy.js';

async function call(handler, req) {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; }, end() {}, send(value) { this.value = value; } };
    await handler({ headers: {}, query: {}, ...req }, res);
    return res;
}
test('cards endpoint returns translated metadata and handles invalid input', async () => {
    const res = await call(cardHandler, { method: 'GET', url: '/api/cards?codes=LO-6826,LO-6826-A' });
    assert.equal(res.statusCode, 200); assert.equal(res.value.cards.length, 2);
    assert(res.value.cards.every(c => c.name && c.img && c.effect));
    assert.equal((await call(cardHandler, { method: 'GET', url: '/api/cards?limit=1000' })).statusCode, 400);
    assert.equal((await call(cardHandler, { method: 'POST', url: '/api/cards' })).statusCode, 405);
});
test('deck API rejects invalid or unknown cards before touching storage', async () => {
    for (const cards of [{ 'LO-6826': 0 }, {}, { 'LO-6826': '4' }]) {
        assert.equal((await call(deckHandler, { method: 'POST', body: { cards } })).statusCode, 400);
    }
    assert.equal((await call(deckHandler, { method: 'POST', body: { cards: { 'LO-9999': 4 } } })).statusCode, 422);
    assert.equal((await call(deckHandler, { method: 'GET', url: '/api/decks?id=bad' })).statusCode, 400);
    assert.equal((await call(deckHandler, { method: 'POST', body: '{bad JSON' })).statusCode, 400);
});
test('import and PDF reject invalid input rather than making upstream requests', async () => {
    assert.equal((await call(importHandler, { method: 'GET', url: '/api/import-deck?type=official&id=../../secret' })).statusCode, 400);
    assert.equal((await call(pdfHandler, { method: 'POST', body: { cards: { 'LO-9999': 4 } } })).statusCode, 422);
    assert.equal((await call(pdfHandler, { method: 'POST', body: { cards: [] } })).statusCode, 400);
    assert.equal((await call(pdfHandler, { method: 'GET' })).statusCode, 405);
});
test('image proxy rejects lookalike domains, credentials, ports, and non-HTTP schemes', async () => {
    for (const url of ['https://lycee-tcg.com.evil.test/a.png', 'https://evil-lycee-tcg.com/a.png', 'file://lycee-tcg.com/a', 'https://u:p@lycee-tcg.com/a', 'https://lycee-tcg.com:1234/a']) {
        const res = await call(imageHandler, { method: 'GET', query: { url } });
        assert([400, 403].includes(res.statusCode));
    }
});
