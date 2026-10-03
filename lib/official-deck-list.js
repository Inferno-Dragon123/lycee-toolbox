import { load } from 'cheerio';

export function parseOfficialComposition(text) {
    const normalized = String(text ?? '').normalize('NFKC').trim();
    const match = /^((?:\[[A-Z][A-Z0-9]*(?:\s+[A-Z][A-Z0-9]*)*\]\s*)+)((?:[雪月花宙日他]\s*:\s*\d+\s*){6})$/.exec(normalized);
    if (!match) return null;
    const tags = [...new Set(match[1].match(/[A-Z][A-Z0-9]*/g))];
    if (tags.includes('MIX') && tags.length !== 1) return null;
    const counts = Object.fromEntries(['雪', '月', '花', '宙', '日', '他'].map(attribute => [attribute, 0]));
    const seen = new Set();
    for (const [, attribute, rawQuantity] of match[2].matchAll(/([雪月花宙日他])\s*:\s*(\d+)/g)) {
        const quantity = Number(rawQuantity);
        if (seen.has(attribute) || !Number.isSafeInteger(quantity) || quantity > 200) return null;
        seen.add(attribute);
        counts[attribute] = quantity;
    }
    if (seen.size !== 6) return null;
    return { type: tags[0] === 'MIX' ? 'mix' : 'single',
        series: tags[0] === 'MIX' ? [] : tags.sort((a, b) => a.localeCompare(b, 'en')), counts };
}

export function parseOfficialList(html, pageUrl) {
    const $ = load(html), entries = new Map();
    $('a[href]').each((_, element) => {
        const anchor = $(element);
        let url;
        try { url = new URL(anchor.attr('href'), pageUrl); } catch { return; }
        if (url.origin !== 'https://lycee-tcg.com' || url.pathname !== '/d/') return;
        const key = url.searchParams.get('d');
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(key || '')) return;
        const row = anchor.closest('tr'), icon = row.find('.topicicon');
        const source = icon.hasClass('festa') ? 'official_tournament' : 'official_user';
        const date = /(20\d{2})\/(\d{2})\/(\d{2})/.exec(row.children('td').last().text());
        const composition = parseOfficialComposition(anchor.next().text());
        entries.set(key, { key, source, date: date ? `${date[1]}-${date[2]}-${date[3]}` : null,
            ...(composition ? { composition } : {}) });
    });
    if (!entries.size) throw new Error('官网列表未解析到独立卡组，保留现有数据，请检查页面或检索条件');
    const current = Number(new URL(pageUrl).searchParams.get('page') || 1);
    let next = null;
    $('a[href]').each((_, element) => {
        try {
            const url = new URL($(element).attr('href'), pageUrl);
            if (url.origin === 'https://lycee-tcg.com' && url.pathname === '/deck/' && Number(url.searchParams.get('page')) === current + 1) next = current + 1;
        } catch { /* unrelated link */ }
    });
    return { entries: [...entries.values()], next };
}
