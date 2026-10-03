import { compositionSeries } from './deck-composition.js';

export const deckAttributes = ['雪', '月', '花', '宙', '日', '他'];
const invalid = message => Object.assign(new Error(message), { status: 400 });
function options(values, allowed, name) {
    if (!Array.isArray(values) || values.length > 100 || values.some(v => !allowed.includes(v))) throw invalid(`无效的${name}筛选`);
    return [...new Set(values)];
}
export function validateDeckSearch({ deckTypes = [], series = [], attributes = [], attributeRanges = {} } = {}) {
    deckTypes = options(deckTypes, ['single', 'mix'], '卡组类型');
    series = options(series, compositionSeries.map(s => s.value), '系列单会社');
    attributes = options(attributes, deckAttributes, '属性');
    const ranges = {};
    for (const attribute of deckAttributes) {
        const range = attributeRanges[attribute] || {};
        const min = range.min ?? null, max = range.max ?? null;
        if ([min, max].some(v => v !== null && (!Number.isSafeInteger(v) || v < 0 || v > 200))) throw invalid('属性张数须为 0～200 的整数');
        if (min !== null && max !== null && min > max) throw invalid('属性张数下限不能大于上限');
        if (min !== null || max !== null) ranges[attribute] = { min, max };
    }
    return { deckTypes, series, attributes, attributeRanges: ranges };
}
export function parseDeckSearch(params) {
    const attributeRanges = {};
    for (const attribute of deckAttributes) {
        const range = {};
        for (const side of ['min', 'max']) {
            const raw = params.get(`attr_${attribute}_${side}`);
            if (raw === null || raw === '') continue;
            if (!/^\d+$/.test(raw)) throw invalid('属性张数须为 0～200 的整数');
            range[side] = Number(raw);
        }
        attributeRanges[attribute] = range;
    }
    return validateDeckSearch({ deckTypes: params.getAll('deckType'), series: params.getAll('series'), attributes: params.getAll('attribute'), attributeRanges });
}
