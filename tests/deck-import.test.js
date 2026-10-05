import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficialDeck } from '../lib/deck-import.js';

// Reduced from official deck d1548027024118, whose LO-6186 appears on three rows.
const duplicateRows = `
    <tr><td>1枚</td><td>LO-6186</td><td> 『意志』</td><td>アイテム</td><td>日</td><td>日日</td><td>CAB</td></tr>
    <tr><td>1枚</td><td>LO-6186</td><td> 『意志』</td><td>アイテム</td><td>日</td><td>日日</td><td>CAB</td></tr>
    <tr><td>1枚</td><td>LO-6186</td><td> 『意志』</td><td>アイテム</td><td>日</td><td>日日</td><td>CAB</td></tr>`;

function officialDeck(rows, total) {
    return `<div id="contents">合計:${total}
        <table><tr><th>デッキ名</th><td>重复行卡组</td></tr></table>
        <table><tr><th>枚数</th><th>カード番号</th><th>カード名</th><th>種類</th><th>属性</th><th>使用代償</th><th>作品</th></tr>
        ${rows}</table></div>`;
}

test('official import combines every occurrence of a repeated card code', () => {
    const deck = parseOfficialDeck(officialDeck(duplicateRows, 3));
    assert.equal(deck.name, '重复行卡组');
    assert.deepEqual(deck.cards, { 'LO-6186': 3 });
});

test('official repeated rows preserve distinct artwork codes and check the complete total', () => {
    const rows = duplicateRows.replace('LO-6186', 'LO-6186-A');
    assert.deepEqual(parseOfficialDeck(officialDeck(rows, 3)).cards, { 'LO-6186': 2, 'LO-6186-A': 1 });
    assert.throws(() => parseOfficialDeck(officialDeck(duplicateRows, 1)), /总张数/);
    assert.throws(() => parseOfficialDeck(officialDeck(duplicateRows, 4)), /总张数/);
});

test('official repeated rows do not conceal invalid card codes, quantities or incomplete rows', () => {
    for (const quantity of ['x枚', '1.5枚', '-1枚', '0枚', '61枚', '9007199254740992枚']) {
        const rows = duplicateRows.replace('1枚', quantity);
        assert.throws(() => parseOfficialDeck(officialDeck(rows, 2)), /卡号或数量无法完整解析/, quantity);
    }
    assert.throws(() => parseOfficialDeck(officialDeck(duplicateRows.replace('LO-6186', 'LO-6186-123'), 3)), /卡号或数量无法完整解析/);
    assert.throws(() => parseOfficialDeck(officialDeck(`${duplicateRows}<tr><td>1枚</td></tr>`, 4)), /卡号或数量无法完整解析/);
});

test('official repeated rows still enforce the maximum quantity after combining', () => {
    const rows = '<tr><td>30枚</td><td>LO-6186</td></tr><tr><td>31枚</td><td>LO-6186</td></tr>';
    assert.throws(() => parseOfficialDeck(officialDeck(rows, 61)), /数量须为 1～60/);
});
