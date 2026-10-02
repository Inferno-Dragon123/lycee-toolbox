import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBasicAbilities, buildAbilityIndex } from '../lib/basic-abilities.js';
import { cards, facets, abilityFacets, search } from '../lib/catalog.js';

test('innate abilities include nested costs and effects but exclude granted abilities and body references', () => {
    const abilities = extractBasicAbilities(' [ｻｲﾄﾞｽﾃｯﾌﾟ:[０]] | [エンゲージ:[破棄キャラを回復する。]][チャージ:２]\n[常時] [アグレッシブ]を得る。');
    assert.deepEqual(abilities.map(a => [a.id, a.detail]), [['side-step', '[0]'], ['engage', '[破棄キャラを回復する。]'], ['charge', '2']]);
    assert.deepEqual(extractBasicAbilities('[常時] 味方キャラは[ステップ:[0]]を得る。'), []);
    assert.deepEqual(extractBasicAbilities('[ステップ:[0]'), []);
    const index = buildAbilityIndex([{ code: 'LO-0001', effect: '[チャージ:２]', effectZh: '[充能:2]' }]);
    assert.equal(index.facets.find(f => f.value === 'charge').options[0].value, 'charge:2');
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
