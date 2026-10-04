import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cards, byCode, search, hydrate } from '../lib/catalog.js';
import { validateDeck, compareCodes, parseDeckReference, makeTts } from '../public/deck-format.js';
import { parseOfficialDeck, parseLegacyDeck } from '../lib/deck-import.js';

test('catalog contains every source code, preserves exact translations and art variants', () => {
    const root = new URL('../', import.meta.url);
    const ja = JSON.parse(fs.readFileSync(new URL('lycee-japanese-database-final.json', root))).cards;
    const zh = new Map(JSON.parse(fs.readFileSync(new URL('lycee-chinese-database-final.json', root))).cards.map(c => [c.code, c.japaneseText]));
    assert.equal(cards.length, new Set(ja.map(c => c.code)).size);
    for (const c of cards) assert.equal(c.effectZh, zh.get(c.code) || '');
    assert(byCode.has('LO-6826')); assert(byCode.has('LO-6826-A'));
    assert.equal(byCode.get('LO-6971').translated, Boolean(zh.get('LO-6971')));
    assert.deepEqual(['LO-0001A', 'LO-6826-K', 'LO-6826-A', 'LO-6826'].sort(compareCodes), ['LO-6826', 'LO-6826-A', 'LO-6826-K', 'LO-0001A']);
});
test('search paginates, intersects filters, searches Chinese and respects numeric zero', () => {
    const first = search(new URLSearchParams('limit=10'));
    const second = search(new URLSearchParams('limit=10&page=2'));
    assert.equal(first.total, cards.length); assert.equal(first.cards.length, 10);
    assert(!first.cards.some(c => second.cards.some(d => d.code === c.code)));
    const c = cards.find(c => c.translated && c.ex === 2 && c.attribute === '日');
    const q = new URLSearchParams({ code: c.code, ex: '2', attribute: '日', effect: c.effectZh.slice(0, 15) });
    assert(search(q).cards.some(d => c.code === d.code));
    assert(search(new URLSearchParams('costTotal_min=0&costTotal_max=0')).cards.every(c => c.costTotal === 0));
    assert.throws(() => search(new URLSearchParams('page=-1')));
    assert.throws(() => search(new URLSearchParams('ap_min=5&ap_max=1')));
    assert.throws(() => hydrate(['LO-9999']), /尚未收录/);
});
test('deck validation rejects malformed and dangerous quantities without dropping cards', () => {
    for (const quantity of [0, -1, 1.5, '4', null, 61, Infinity]) assert.throws(() => validateDeck({ cards: { 'LO-6826': quantity } }));
    assert.throws(() => validateDeck({ cards: { '__proto__': 1 } }));
    assert.throws(() => validateDeck({ name: 'x'.repeat(101), cards: { 'LO-6826': 1 } }));
    assert.throws(() => validateDeck({ schemaVersion: 2, cards: { 'LO-6826': 1 } }));
    assert.deepEqual(validateDeck({ cards: { 'lo-6826': 4, 'LO-6826-A': 1 } }).cards, { 'LO-6826': 4, 'LO-6826-A': 1 });
});
test('supported links have exact host allowlists and distinct ID formats', () => {
    assert.deepEqual(parseDeckReference('https://lycee-tcg.com/d/?d=k0PjKL'), { type: 'official', id: 'k0PjKL' });
    assert.deepEqual(parseDeckReference('https://lyc.ee/dk0PjKL'), { type: 'official', id: 'k0PjKL' });
    assert.equal(parseDeckReference('https://lycee-toolbox.top/?deck=d_' + 'a'.repeat(22)).type, 'local');
    assert.equal(parseDeckReference('https://lycee-toolbox.top/?id=' + 'a'.repeat(32)).type, 'legacy');
    for (const url of ['https://lycee-tcg.com.evil.test/d/?d=k0PjKL', 'https://evil.test/?id=' + 'a'.repeat(32), 'file:///d/?d=x']) assert.throws(() => parseDeckReference(url));
});
test('official import uses only the card table and checks totals', () => {
    const html = `<div id="contents">合計:5<table><tr><th>デッキ名</th><td>测试</td></tr></table>
        <table><tr><th>枚数</th><th>カード番号</th></tr><tr><td>4枚</td><td>LO-6826</td></tr><tr><td>1枚</td><td>LO-6826-A</td></tr></table>
        <p>LO-6826 4枚 LO-6826-A 1枚</p></div>`;
    const deck = parseOfficialDeck(html);
    assert.deepEqual(deck.cards, { 'LO-6826': 4, 'LO-6826-A': 1 });
    assert.throws(() => parseOfficialDeck(html.replace('合計:5', '合計:60')), /总张数/);
    assert.throws(() => parseOfficialDeck(html.replace('4枚', 'x枚')));
    assert.throws(() => parseOfficialDeck('<html>not found</html>'));
});
test('legacy imports use full codes and validate quantities', () => {
    const d = parseLegacyDeck({ code: 1, data: [{ code: 'LO-6826-A', num: '4' }] });
    assert.equal(d.cards['LO-6826-A'], 4);
    assert.throws(() => parseLegacyDeck({ code: 1, data: [{ code: 'LO-6826', num: 'junk' }] }));
});
test('TTS exports every copy with the matching artwork and handles a single card', () => {
    const tts = makeTts({ cards: { 'LO-6826': 4, 'LO-6826-A': 1 } }, byCode).ObjectStates[0];
    assert.equal(tts.DeckIDs.length, 5); assert.equal(tts.ContainedObjects.length, 5);
    assert.equal(Object.keys(tts.CustomDeck).length, 2);
    assert.equal(tts.ContainedObjects[4].CustomDeck[101].FaceURL, byCode.get('LO-6826-A').img);
    assert.equal(makeTts({ cards: { 'LO-6826': 1 } }, byCode).ObjectStates[0].Name, 'CardCustom');
});
test('TTS preserves the confirmed Lycee card size for decks, contained cards and single cards', () => {
    // Dimensions from the user-provided tts.test/正确大小示例.json.
    const expected = { scaleX: 2.484764, scaleY: 1, scaleZ: 2.484764 };
    const assertSize = object => {
        const { scaleX, scaleY, scaleZ } = object.Transform;
        assert.deepEqual({ scaleX, scaleY, scaleZ }, expected);
    };
    const deck = makeTts({ cards: { 'LO-6826': 4, 'LO-6826-A': 1 } }, byCode).ObjectStates[0];
    assertSize(deck);
    deck.ContainedObjects.forEach(assertSize);
    assertSize(makeTts({ cards: { 'LO-6826': 1 } }, byCode).ObjectStates[0]);
});
