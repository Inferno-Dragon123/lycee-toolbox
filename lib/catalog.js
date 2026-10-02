import fs from 'node:fs';
import { normalizeCode, compareCodes } from '../public/deck-format.js';
import { buildAbilityIndex } from './basic-abilities.js';

const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const metadata = read('../data/catalog.json');
const japanese = new Map(read('../lycee-japanese-database-final.json').cards.map(c => [c.code, c]));
const chinese = new Map(read('../lycee-chinese-database-final.json').cards.map(c => [c.code, c]));
export const normalizeText = text => String(text ?? '').normalize('NFKC').toLowerCase();
export const cards = metadata.cards.map(c => {
    const ja = japanese.get(c.code);
    if (!ja) throw new Error(`Catalog source missing: ${c.code}`);
    return { ...c, aliases: [...new Set([ja.name, chinese.get(c.code)?.name].filter(Boolean))],
        effect: ja.japaneseText, effectZh: chinese.get(c.code)?.japaneseText || '',
        translatedAt: chinese.get(c.code)?.translatedAt || null,
        translated: Boolean(chinese.get(c.code)?.japaneseText) };
}).sort((a, b) => compareCodes(a.code, b.code));
export const byCode = new Map(cards.map(c => [c.code, c]));
const abilityData = buildAbilityIndex(cards);
export const abilityFacets = abilityData.facets;
const allowedAbilities = new Set(abilityFacets.flatMap(f => [f.value, ...f.options.map(o => o.value)]));
if (byCode.size !== japanese.size || byCode.size !== cards.length) {
    throw new Error('Catalog out of date: run python scripts/build_catalog.py');
}
const searchable = new Map(cards.map(c => [c.code, normalizeText([
    c.code, c.name, ...c.aliases, c.effect, c.effectZh, c.trait, c.team, c.illustrator
].join('\n'))]));

export function hydrate(codes) {
    const missing = codes.filter(code => !byCode.has(code));
    if (missing.length) throw Object.assign(new Error(`卡库尚未收录：${missing.join('、')}。请更新卡库后重试。`), { status: 422 });
    return codes.map(code => byCode.get(code));
}

const facetLabels = { category: '卡牌种类', rarity: '稀有度', version: '版本', brand: '作品简称', ex: 'EX' };
const categoryLabels = { 'キャラクター': '角色', 'イベント': '事件', 'アイテム': '道具', 'エリア': '场地' };
export const facets = Object.entries(facetLabels).map(([key, label]) => ({ key, label,
    options: [...new Set(cards.map(c => c[key]).filter(v => v !== null && v !== ''))]
        .sort((a, b) => String(a).localeCompare(String(b), 'ja', { numeric: true }))
        .map(value => ({ value: String(value), label: categoryLabels[value] || String(value) }))
}));

function integer(params, key, fallback, min, max) {
    const raw = params.get(key);
    if (raw === null || raw === '') return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
        throw Object.assign(new Error(`无效的筛选参数：${key}`), { status: 400 });
    }
    return Number(raw);
}

export function search(params) {
    const page = integer(params, 'page', 1, 1, 10000);
    const limit = integer(params, 'limit', 30, 1, 100);
    const query = normalizeText(params.get('q')).trim().split(/\s+/).filter(Boolean);
    const code = normalizeCode(params.get('code') || '');
    const exact = facets.map(f => ({ key: f.key, values: params.getAll(f.key).filter(Boolean) })).filter(f => f.values.length);
    for (const { key, values } of exact) {
        const allowed = new Set(facets.find(f => f.key === key).options.map(o => o.value));
        if (values.length > 200 || values.some(v => !allowed.has(v))) throw Object.assign(new Error(`无效的筛选参数：${key}`), { status: 400 });
    }
    const abilities = params.getAll('ability').filter(Boolean);
    if (abilities.length > 100 || abilities.some(v => !allowedAbilities.has(v))) throw Object.assign(new Error('无效的基本能力筛选'), { status: 400 });
    const ranges = ['costTotal', 'ap', 'dp', 'sp', 'dmg'].map(key => ({ key,
        min: integer(params, `${key}_min`, null, 0, 100),
        max: integer(params, `${key}_max`, null, 0, 100)
    }));
    for (const { min, max } of ranges) if (min !== null && max !== null && min > max) {
        throw Object.assign(new Error('筛选下限不能大于上限'), { status: 400 });
    }
    const attributes = params.getAll('attribute').filter(Boolean);
    if (attributes.length > 20 || attributes.some(v => !/^[雪月花宙日無]+$/.test(v))) throw Object.assign(new Error('无效的属性筛选'), { status: 400 });
    const effect = normalizeText(params.get('effect')).trim();
    const trait = normalizeText(params.get('trait')).trim();
    const illustrator = normalizeText(params.get('illustrator')).trim();
    const matched = cards.filter(c =>
        (!code || c.code.startsWith(code)) && query.every(q => searchable.get(c.code).includes(q)) &&
        exact.every(({ key, values }) => values.includes(String(c[key]))) &&
        (!attributes.length || attributes.some(value => [...value].every(a => c.attribute.includes(a)))) &&
        (!abilities.length || abilities.some(value => abilityData.index.get(c.code).some(a => a.id === value || a.value === value))) &&
        (!effect || normalizeText(c.effect + '\n' + c.effectZh + '\n' + c.team).includes(effect)) &&
        (!trait || normalizeText(c.trait).includes(trait)) &&
        (!illustrator || normalizeText(c.illustrator).includes(illustrator)) &&
        ranges.every(({key, min, max}) => (min === null && max === null) ||
            (c[key] !== null && (min === null || c[key] >= min) && (max === null || c[key] <= max)))
    );
    return { cards: matched.slice((page - 1) * limit, page * limit), total: matched.length,
        page, pages: Math.ceil(matched.length / limit), limit };
}
