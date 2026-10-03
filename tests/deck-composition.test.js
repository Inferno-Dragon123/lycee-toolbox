import test from 'node:test';
import assert from 'node:assert/strict';
import { deckComposition, compositionSeries } from '../lib/deck-composition.js';
import { parseOfficialComposition, parseOfficialList } from '../lib/official-deck-list.js';

const counts = (values = {}) => ({ 雪: 0, 月: 0, 花: 0, 宙: 0, 日: 0, 他: 0, ...values });
const catalog = new Map([
    ['LO-0001', { brand: 'VA TW', attribute: '雪' }],
    ['LO-0002', { brand: 'SP VA', attribute: '月' }],
    ['LO-0003', { brand: 'SP HOK SME ASA', attribute: '月花' }],
    ['LO-0004', { brand: 'VA', attribute: '無' }],
    ['LO-0005', { brand: '-', attribute: '日' }],
    ['LO-0006', { brand: '', attribute: '宙' }],
    ['LO-0001-B', { brand: 'TW', attribute: '花' }]
]);

test('series deck uses common company eligibility, preserving quantities and artworks', () => {
    assert.deepEqual(deckComposition({ 'LO-0001': 25, 'LO-0001-A': 5, 'LO-0002': 30 }, catalog), {
        type: 'single', series: ['VA'], counts: counts({ 雪: 30, 月: 30 })
    });
    assert.deepEqual(deckComposition({ 'LO-0001': 30, 'LO-0001-B': 30 }, catalog), {
        type: 'single', series: ['TW'], counts: counts({ 雪: 30, 花: 30 })
    });
    assert.deepEqual(deckComposition({ 'LO-0001': 60 }, catalog).series, ['TW', 'VA']);
});

test('company intersections apply to every card and multicolor/colorless belong to other', () => {
    assert.deepEqual(deckComposition({ 'LO-0001': 20, 'LO-0002': 20, 'LO-0003': 20 }, catalog), {
        type: 'mix', series: [], counts: counts({ 雪: 20, 月: 20, 他: 20 })
    });
    assert.deepEqual(deckComposition({ 'LO-0002': 30, 'LO-0004': 30 }, catalog), {
        type: 'single', series: ['VA'], counts: counts({ 月: 30, 他: 30 })
    });
});

test('missing metadata or unknown companies cannot falsely prove a series or mixed deck', () => {
    for (const unknownCode of ['LO-0005', 'LO-0006', 'LO-9999-A']) {
        const result = deckComposition({ 'LO-0001': 30, [unknownCode]: 30 }, catalog);
        assert.equal(result.type, 'unknown');
        assert.deepEqual(result.series, []);
        assert.equal(Object.values(result.counts).reduce((sum, n) => sum + n, 0), unknownCode === 'LO-9999-A' ? 30 : 60);
    }
    assert.equal(deckComposition({ 'LO-0001': 20, 'LO-0003': 20, 'LO-0005': 20 }, catalog).type, 'unknown');
    assert.equal(deckComposition({}, catalog).type, 'unknown');
    const incomplete = new Map([['LO-0001', { brand: 'VA', attribute: '' }]]);
    assert.deepEqual(deckComposition({ 'LO-0001': 60 }, incomplete).counts, counts());
});

test('series facets contain separate company qualifications and exclude unknown markers', () => {
    assert.ok(compositionSeries.some(option => option.value === 'TW'));
    assert.ok(compositionSeries.some(option => option.value === 'VA'));
    assert.ok(compositionSeries.every(option => /^[A-Z][A-Z0-9]*$/.test(option.value)));
    assert.equal(new Set(compositionSeries.map(option => option.value)).size, compositionSeries.length);
});

test('official tags parse a complete composition and support multiple series qualifications', () => {
    assert.deepEqual(parseOfficialComposition('[MIX] 雪:0 月:0 花:60 宙:0 日:0 他:0'), {
        type: 'mix', series: [], counts: counts({ 花: 60 })
    });
    assert.deepEqual(parseOfficialComposition('[NIT] 雪:６０ 月:0 花:0 宙:0 日:0 他:0'), {
        type: 'single', series: ['NIT'], counts: counts({ 雪: 60 })
    });
    assert.deepEqual(parseOfficialComposition('[VA][TW] 雪:0 月:56 花:0 宙:0 日:0 他:4'), {
        type: 'single', series: ['TW', 'VA'], counts: counts({ 月: 56, 他: 4 })
    });
    assert.deepEqual(parseOfficialComposition('[SP VA] 雪:0 月:0 花:0 宙:0 日:60 他:0').series, ['SP', 'VA']);
});

test('official tags reject partial, ambiguous, duplicate, noninteger, negative and overflowing counts', () => {
    const valid = '[MIX] 雪:0 月:0 花:60 宙:0 日:0 他:0';
    for (const invalid of [valid.replace(' 他:0', ''), valid.replace('他:0', '花:0'),
        valid.replace('花:60', '花:-1'), valid.replace('花:60', '花:2.5'),
        valid.replace('花:60', '花:201'), valid.replace('花:60', '花:199 日:2'),
        valid.replace('[MIX]', '[MIX][VA]'), valid.replace('[MIX]', ''), valid + ' extra',
        valid.replace('雪:0 月:0', '雪:200 月:1')]) {
        assert.equal(parseOfficialComposition(invalid), null, invalid);
    }
});

test('list extraction stores valid adjacent tags without changing entries without metadata', () => {
    const html = `<table><tr><td><a href="/d/?d=mix">混成</a><div>[MIX] 雪:0 月:0 花:60 宙:0 日:0 他:0</div></td><td>2026/10/03</td></tr>
        <tr><td><a href="/d/?d=plain">old fixture</a></td><td>2026/10/02</td></tr>
        <tr><td><a href="/d/?d=bad">invalid counts</a><div>[NIT] 雪:60</div></td><td>2026/10/01</td></tr></table>`;
    const { entries } = parseOfficialList(html, 'https://lycee-tcg.com/deck/');
    assert.equal(entries[0].composition.type, 'mix');
    assert.deepEqual(entries[1], { key: 'plain', source: 'official_user', date: '2026-10-02' });
    assert.ok(!Object.hasOwn(entries[2], 'composition'));
});
