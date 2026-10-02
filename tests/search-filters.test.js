import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBasicAbilities, buildAbilityIndex } from '../lib/basic-abilities.js';
import { cards, facets, abilityFacets, search } from '../lib/catalog.js';

test('innate abilities include nested costs and effects but exclude granted abilities and body references', () => {
    const abilities = extractBasicAbilities(' [ｻｲﾄﾞｽﾃｯﾌﾟ:[０]] | [エンゲージ:[破棄キャラを回復する。]][チャージ:２]\n[常時] [アグレッシブ]を得る。');
    assert.deepEqual(abilities.map(a => [a.id, a.detail]), [['side-step', '[0]'], ['engage', '破棄キャラを回復する。'], ['charge', '2']]);
    assert.deepEqual(extractBasicAbilities('[常時] 味方キャラは[ステップ:[0]]を得る。'), []);
    assert.deepEqual(extractBasicAbilities('[ステップ:[0]'), []);
    const index = buildAbilityIndex([{ code: 'LO-0001', effect: '[チャージ:２]', effectZh: '[充能:2]' }]);
    assert.equal(index.facets.find(f => f.value === 'charge').options[0].value, 'charge:2');
});

test('equivalent wrappers merge while different costs and mandatory/optional effects stay separate', () => {
    const wrapped = extractBasicAbilities('[チャージ:[３]][ペナルティ:[１枚ドローする。]][エンゲージ:[自分にシールド＋１できる。]]');
    const bare = extractBasicAbilities('[チャージ:3][ペナルティ:1枚ドローする。][エンゲージ:自分にシールド+1できる。]');
    assert.deepEqual(wrapped, bare);
    assert.notEqual(extractBasicAbilities('[ガッツ:[D2][宙宙宙]]')[0].value, extractBasicAbilities('[ガッツ:[D2宙宙宙]]')[0].value);
    assert.notEqual(extractBasicAbilities('[ペナルティ:[1枚ドローする。]]')[0].value, extractBasicAbilities('[ペナルティ:[1枚ドローできる。]]')[0].value);
    assert.equal(extractBasicAbilities('[サイドステップ:0]')[0].value, 'side-step:[0]');
});

test('menu labels prefer actual translation dates over card order and untranslated entries', () => {
    const examples = [
        { code: 'LO-9000', effect: '[ペナルティ:[1枚ドローする。]]', effectZh: '' },
        { code: 'LO-8000', effect: '[ペナルティ:1枚ドローする。]', effectZh: '[离场惩罚:抽1张牌。]', translatedAt: '2026-08-04T00:00:00Z' },
        { code: 'LO-0001', effect: '[ペナルティ:[1枚ドローする。]]', effectZh: '[离场惩罚:[抽1张卡。]]', translatedAt: '2026-09-28T00:00:00Z' }
    ];
    for (const order of [examples, [...examples].reverse()]) {
        const data = buildAbilityIndex(order), options = data.facets.find(f => f.value === 'penalty').options;
        assert.equal(options.length, 1);
        assert.equal(options[0].label, '抽1张卡。');
        assert.equal(options[0].count, 3);
        for (const c of examples) assert.equal(data.index.get(c.code)[0].value, options[0].value);
    }
});

test('real catalog has a single charge 3 form covering the formerly bracketed card', () => {
    const options = abilityFacets.find(f => f.value === 'charge').options;
    assert.equal(options.filter(o => /3/.test(o.original)).length, 1);
    const wrappedCard = cards.find(c => /チャージ:\[3\]/.test(c.effect.normalize('NFKC')));
    assert(wrappedCard);
    assert.equal(search(new URLSearchParams({ code: wrappedCard.code, ability: 'charge:3' })).total, 1);
});

test('multi-select facets combine alternatives within a field and intersect different fields', () => {
    const values = facets.find(f => f.key === 'category').options.slice(0, 2).map(o => o.value);
    const params = new URLSearchParams();
    for (const value of values) params.append('category', value);
    for (const value of ['雪', '月']) params.append('attribute', value);
    params.set('ex', '2');
    assert.equal(search(params).total, cards.filter(c => values.includes(c.category) && (c.attribute.includes('雪') || c.attribute.includes('月')) && c.ex === 2).length);
    assert.throws(() => search(new URLSearchParams('category=unknown')), /无效/);
    assert.throws(() => search(new URLSearchParams('ability=unknown')), /无效/);
    assert.throws(() => search(new URLSearchParams('attribute=invalid')), /无效/);
});

test('ability families and exact variants filter independently and combine with zero numeric ranges', () => {
    assert.equal(abilityFacets.length, 18);
    const family = abilityFacets.find(f => f.value === 'charge');
    const variant = family.options.find(o => o.value === 'charge:2');
    assert(variant);
    const exact = new URLSearchParams({ ability: variant.value, costTotal_min: '0', costTotal_max: '0' });
    const expected = cards.filter(c => c.costTotal === 0 && extractBasicAbilities(c.effect).some(a => a.value === variant.value));
    assert.equal(search(exact).total, expected.length);
    assert(search(new URLSearchParams({ ability: family.value })).total > search(new URLSearchParams({ ability: variant.value })).total);
    const bodyOnly = cards.find(c => c.effect.includes('[アグレッシブ]') && !extractBasicAbilities(c.effect).some(a => a.id === 'aggressive'));
    assert(bodyOnly);
    assert.equal(search(new URLSearchParams({ code: bodyOnly.code, ability: 'aggressive' })).total, 0);
    const union = new URLSearchParams(); union.append('ability', 'charge:1'); union.append('ability', 'charge:2');
    assert.equal(search(union).total, cards.filter(c => extractBasicAbilities(c.effect).some(a => ['charge:1', 'charge:2'].includes(a.value))).length);
});
