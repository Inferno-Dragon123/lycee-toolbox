import { load } from 'cheerio';

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
        const source = icon.hasClass('festa') ? 'official_tournament' : icon.hasClass('user') ? 'official_user' : 'official';
        const date = /(20\d{2})\/(\d{2})\/(\d{2})/.exec(row.children('td').last().text());
        entries.set(key, { key, source, date: date ? `${date[1]}-${date[2]}-${date[3]}` : null });
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
