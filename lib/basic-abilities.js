// Terms supplied in the project's 基本能力.md. Match only innate leading
// ability blocks, never references or granted abilities in the effect body.
export const basicAbilityTerms = [
    ['step', 'ステップ', '移动'], ['side-step', 'サイドステップ', '横向侧移'],
    ['order-step', 'オーダーステップ', '纵向移动'], ['order-change', 'オーダーチェンジ', '位置交换'],
    ['jump', 'ジャンプ', '跳跃'], ['penalty', 'ペナルティ', '离场惩罚'],
    ['aggressive', 'アグレッシブ', '进取心'], ['assist', 'アシスト', '辅助'],
    ['engage', 'エンゲージ', '结合'], ['recovery', 'リカバリー', '补正'],
    ['guts', 'ガッツ', '斗志'], ['leader', 'リーダー', '领导'],
    ['supporter', 'サポーター', '支援者'], ['bonus', 'ボーナス', '奖励'],
    ['charge', 'チャージ', '充能'], ['turn-recovery', 'ターンリカバリー', '回合补正'],
    ['principal', 'プリンシパル', '主演'], ['surprise', 'サプライズ', '突袭'],
    ['convert', 'コンバート', '换装']
].map(([id, japanese, label]) => ({ id, japanese, label }));

// Remove only a wrapper enclosing the entire parameter. Internal cost/effect
// brackets remain intact, so [D2][宙宙宙] is not confused with [D2宙宙宙].
function unwrapDetail(detail) {
    while (detail.startsWith('[') && detail.endsWith(']')) {
        let depth = 0, enclosed = true;
        for (let i = 0; i < detail.length; i++) {
            if (detail[i] === '[') depth++;
            if (detail[i] === ']') depth--;
            if (depth === 0 && i < detail.length - 1) { enclosed = false; break; }
        }
        if (!enclosed || depth !== 0) break;
        detail = detail.slice(1, -1).trim();
    }
    return detail;
}

export function extractBasicAbilities(input, chinese = false) {
    const text = String(input || '').normalize('NFKC');
    const terms = new Map(basicAbilityTerms.map(t => [chinese ? t.label : t.japanese, t]));
    const result = [];
    let position = 0;
    while (position < text.length) {
        while (/[\s|]/.test(text[position] || '') && position < text.length) position++;
        if (text[position] !== '[') break;
        const start = ++position;
        let depth = 1;
        while (position < text.length && depth) {
            if (text[position] === '[') depth++;
            if (text[position] === ']') depth--;
            position++;
        }
        if (depth) break;
        const content = text.slice(start, position - 1), colon = content.indexOf(':');
        const name = (colon < 0 ? content : content.slice(0, colon)).trim();
        const term = terms.get(name);
        if (!term) break;
        let detail = (colon < 0 ? '' : content.slice(colon + 1)).trim().replace(/\s+/g, ' ');
        const unwrapped = unwrapDetail(detail);
        // Costs retain their familiar brackets in the menu and API. Numeric
        // charge and text effects use a single form regardless of old wrappers.
        detail = term.id === 'charge' || !/^(?:[CD]?\d+|[雪月花宙日無]+)$/.test(unwrapped)
            ? unwrapped : `[${unwrapped}]`;
        if (!unwrapped) detail = '';
        result.push({ id: term.id, detail, value: term.id + ':' + detail });
    }
    return result;
}

export function buildAbilityIndex(cards) {
    const index = new Map(), groups = new Map(basicAbilityTerms.map(t => [t.id, new Map()])), labelDates = new Map();
    for (const card of cards) {
        const abilities = extractBasicAbilities(card.effect);
        const translated = extractBasicAbilities(card.effectZh, true);
        index.set(card.code, abilities);
        for (const ability of new Map(abilities.map(a => [a.value, a])).values()) {
            const variants = groups.get(ability.id);
            const existing = variants.get(ability.value);
            // Use Chinese only when the full leading ability order matches.
            const aligned = abilities.length === translated.length && abilities.every((a, i) => a.id === translated[i].id);
            const label = aligned ? translated[abilities.findIndex(a => a.value === ability.value)].detail : '';
            const date = Date.parse(card.translatedAt) || 0;
            if (existing) existing.count++;
            else variants.set(ability.value, { value: ability.value, label: ability.detail || '无附加代价／效果', original: ability.detail, count: 1 });
            if (label && (!labelDates.has(ability.value) || date > labelDates.get(ability.value))) {
                variants.get(ability.value).label = label;
                labelDates.set(ability.value, date);
            }
        }
    }
    const facets = basicAbilityTerms.map(t => ({ value: t.id, label: t.label, japanese: t.japanese,
        options: [...groups.get(t.id).values()].sort((a, b) => a.original.localeCompare(b.original, 'ja', { numeric: true }))
    }));
    return { index, facets };
}
