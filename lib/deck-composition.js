import { byCode } from './catalog.js';
import { normalizeCode } from '../public/deck-format.js';

const attributes = ['雪', '月', '花', '宙', '日', '他'];
const emptyCounts = () => Object.fromEntries(attributes.map(attribute => [attribute, 0]));

function brandTokens(brand) {
    const tokens = String(brand ?? '').normalize('NFKC').trim().toUpperCase().split(/\s+/);
    if (tokens.some(token => !/^[A-Z][A-Z0-9]*$/.test(token))) return [];
    return [...new Set(tokens)];
}

export const compositionSeries = [...new Set([...byCode.values()].flatMap(card => brandTokens(card.brand)))]
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map(value => ({ value, label: value }));

// A card with several brand tokens qualifies for every one of those series.
// A whole deck is a series deck only if one qualification is shared by all cards.
export function deckComposition(cards, catalog = byCode) {
    const counts = emptyCounts();
    let shared = null, unknown = false;
    for (const [rawCode, quantity] of Object.entries(cards || {})) {
        if (!Number.isSafeInteger(quantity) || quantity < 1) {
            unknown = true;
            continue;
        }
        const code = normalizeCode(rawCode);
        // Unlisted artworks can share the base card's metadata. Do not replace
        // an existing artwork's metadata or infer metadata from nearby numbers.
        const baseCode = /^LO-\d{4}(?=-?[A-Z]+$)/.exec(code)?.[0];
        const card = catalog.get(code) || (baseCode ? catalog.get(baseCode) : null);
        const attribute = String(card?.attribute ?? '').normalize('NFKC').trim();
        if (attributes.slice(0, 5).includes(attribute)) counts[attribute] += quantity;
        else if (/^[雪月花宙日無]+$/.test(attribute)) counts['他'] += quantity;
        const brands = brandTokens(card?.brand);
        if (!brands.length) {
            unknown = true;
            continue;
        }
        shared = shared === null ? new Set(brands) : new Set(brands.filter(brand => shared.has(brand)));
    }
    const series = unknown || shared === null ? [] : [...shared].sort((a, b) => a.localeCompare(b, 'en'));
    return { type: unknown || shared === null ? 'unknown' : series.length ? 'single' : 'mix', series, counts };
}

// The official listing's color columns overlap: a snow/moon cost contributes
// to both columns. Colorless (including zero) costs contribute to Other.
export function officialCostCounts(cards, catalog = byCode) {
    const counts = emptyCounts();
    let complete = Boolean(Object.keys(cards || {}).length);
    for (const [rawCode, quantity] of Object.entries(cards || {})) {
        const code = normalizeCode(rawCode);
        const card = catalog.get(code) || catalog.get(code.slice(0, 7));
        if (!Number.isSafeInteger(quantity) || quantity < 1 || !card || typeof card.cost !== 'string') {
            complete = false; continue;
        }
        const cost = card.cost.normalize('NFKC');
        const colors = attributes.slice(0, 5).filter(color => cost.includes(color));
        for (const color of colors.length ? colors : ['他']) counts[color] += quantity;
    }
    return { counts, complete };
}

export function compatibleOfficialComposition(cards, composition) {
    if (!composition || !['single', 'mix'].includes(composition.type) || !Array.isArray(composition.series) ||
        (composition.type === 'single' ? !composition.series.length : composition.series.length !== 0) ||
        composition.series.some(s => typeof s !== 'string' || !/^[A-Z][A-Z0-9]*$/.test(s))) return false;
    const total = Object.values(cards).reduce((sum, n) => sum + n, 0);
    if (!Number.isSafeInteger(total) || total < 1 || total > 200) return false;
    const counts = attributes.map(attribute => composition.counts?.[attribute]);
    if (counts.some(n => !Number.isSafeInteger(n) || n < 0 || n > total)) return false;
    const sum = counts.reduce((a, b) => a + b, 0);
    // Every card contributes to at least one and at most five color columns.
    if (sum < total || sum > total * 5) return false;
    // Complete local costs also detect stale listing tags from a changed deck.
    const expected = officialCostCounts(cards);
    return !expected.complete || attributes.every(attribute => expected.counts[attribute] === composition.counts[attribute]);
}
