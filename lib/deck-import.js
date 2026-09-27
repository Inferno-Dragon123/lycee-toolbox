import axios from 'axios';
import { load } from 'cheerio';
import { validateDeck, normalizeCode, CODE } from '../public/deck-format.js';

export function parseOfficialDeck(html) {
    const $ = load(html);
    const tables = $('table').filter((_, table) => {
        const headings = $(table).find('th').map((_, h) => $(h).text().trim()).get();
        return headings.includes('枚数') && headings.includes('カード番号');
    });
    if (tables.length !== 1) throw new Error('官网卡组不存在或页面格式已改变');
    const cards = {};
    tables.find('tr').each((_, row) => {
        const cells = $(row).children('td');
        if (!cells.length) return;
        const code = normalizeCode(cells.eq(1).text());
        const quantity = /^(\d+)枚$/.exec(cells.eq(0).text().trim());
        if (!CODE.test(code) || !quantity || Object.hasOwn(cards, code)) throw new Error('官网卡组卡号或数量无法完整解析');
        cards[code] = Number(quantity[1]);
    });
    const total = /合計\s*[:：]\s*(\d+)/.exec($('#contents').text());
    if (!total || Number(total[1]) !== Object.values(cards).reduce((a, b) => a + b, 0)) {
        throw new Error('官网卡组总张数校验失败，未导入任何卡牌');
    }
    const nameRow = $('tr').filter((_, row) => $(row).children('th').first().text().trim() === 'デッキ名').first();
    return validateDeck({ name: nameRow.children('td').first().text().trim(), cards });
}

export function parseLegacyDeck(data) {
    if (data?.code !== 1 || !Array.isArray(data.data)) throw new Error('旧卡组不存在或萌卡社未返回卡牌列表');
    const cards = {};
    for (const card of data.data) {
        const code = normalizeCode(card.code);
        if (!CODE.test(code) || !/^\d+$/.test(String(card.num))) throw new Error('旧卡组包含无效卡号或数量');
        cards[code] = (cards[code] || 0) + Number(card.num);
    }
    return validateDeck({ name: typeof data.deckName === 'string' ? data.deckName : '导入的旧卡组', cards });
}

export async function importDeck(type, id) {
    let url;
    if (type === 'official' && /^[A-Za-z0-9_-]{1,40}$/.test(id)) url = `https://lycee-tcg.com/d/?d=${encodeURIComponent(id)}`;
    else if (type === 'legacy' && /^[a-f0-9]{32}$/i.test(id)) url = `https://www.moetcg.club/Api/showDeck?id=${id}`;
    else throw Object.assign(new Error('无效的导入链接'), { status: 400 });
    try {
        const { data } = await axios.get(url, { timeout: 18000, maxRedirects: 0, maxContentLength: 2000000,
            responseType: type === 'official' ? 'text' : 'json',
            headers: { 'User-Agent': 'LyceeToolbox/1.0', Referer: type === 'official' ? 'https://lycee-tcg.com/' : 'https://www.moetcg.club/' } });
        return type === 'official' ? parseOfficialDeck(data) : parseLegacyDeck(data);
    } catch (e) {
        const message = e.isAxiosError ? '暂时无法读取卡组来源，请稍后重试' : e.message;
        throw Object.assign(new Error(message), { status: 502, expose: true });
    }
}
