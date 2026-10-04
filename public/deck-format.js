// Shared by the browser and API. Full card codes identify individual artworks.
export const CODE = /^LO-\d{4}(?:-?[A-Z]+)?$/;
export const DECK_ID = /^d_[A-Za-z0-9_-]{22}$/;
export const normalizeCode = value => String(value).normalize('NFKC').trim().toUpperCase();
export function compareCodes(a, b) {
    const parts = code => /^LO-(\d+)(?:-?([A-Z]+))?$/.exec(code);
    const x = parts(a), y = parts(b);
    return Number(y[1]) - Number(x[1]) || (x[2] || '').localeCompare(y[2] || '');
}
export function validateDeck(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的卡组格式');
    if (input.schemaVersion !== undefined && input.schemaVersion !== 1) throw new Error('不支持此卡组文件版本');
    if (input.name !== undefined && typeof input.name !== 'string') throw new Error('卡组名称必须是文字');
    const name = input.name?.trim() || '未命名卡组';
    if (name.length > 100) throw new Error('卡组名称最多 100 个字符');
    if (!input.cards || typeof input.cards !== 'object' || Array.isArray(input.cards)) throw new Error('无效的卡牌清单');
    const entries = Object.entries(input.cards);
    if (!entries.length || entries.length > 200) throw new Error('卡组须包含 1～200 种卡牌');
    const cards = {};
    let total = 0;
    for (const [raw, quantity] of entries) {
        const code = normalizeCode(raw);
        if (!CODE.test(code)) throw new Error(`无效卡号：${raw}`);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 60) throw new Error(`${code} 数量须为 1～60 的整数`);
        if (Object.hasOwn(cards, code)) throw new Error(`卡号重复：${code}`);
        cards[code] = quantity;
        total += quantity;
    }
    if (total > 200) throw new Error('单个卡组最多保存 200 张卡');
    return { schemaVersion: 1, name, cards: Object.fromEntries(Object.entries(cards).sort(([a], [b]) => compareCodes(a, b))) };
}

export function parseDeckReference(raw, ownOrigin) {
    raw = String(raw).trim();
    if (DECK_ID.test(raw)) return { type: 'local', id: raw };
    if (/^[a-f0-9]{32}$/i.test(raw)) return { type: 'legacy', id: raw };
    let url;
    try { url = new URL(raw); } catch { throw new Error('请输入本站分享链接、Lycee 官网卡组链接或旧卡组 ID'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('无效的卡组链接');
    if (['lycee-tcg.com', 'www.lycee-tcg.com'].includes(url.hostname) && /^\/d\/?$/.test(url.pathname)) {
        const id = url.searchParams.get('d');
        if (/^[A-Za-z0-9_-]{1,40}$/.test(id || '')) return { type: 'official', id };
    }
    if (url.hostname === 'lyc.ee' && /^\/d[A-Za-z0-9_-]{1,40}$/.test(url.pathname)) {
        return { type: 'official', id: url.pathname.slice(2) };
    }
    const own = url.origin === ownOrigin || url.hostname === 'lycee-toolbox.top' || url.hostname === 'www.lycee-toolbox.top';
    const publication = url.searchParams.get('publication');
    if (own && /^p_[A-Za-z0-9_-]{22}$/.test(publication || '')) return { type: 'community', id: publication };
    const id = url.searchParams.get('deck');
    if (own && DECK_ID.test(id || '')) return { type: 'local', id };
    const legacy = url.searchParams.get('id');
    if ((own || ['moetcg.club', 'www.moetcg.club'].includes(url.hostname)) && /^[a-f0-9]{32}$/i.test(legacy || '')) {
        return { type: 'legacy', id: legacy };
    }
    throw new Error('不支持此卡组链接');
}

export function makeTts(input, info) {
    const deck = validateDeck(input);
    const custom = {}, objects = [];
    // Match the established Lycee TTS card size for both the stack and every card.
    const transform = { posX: 0, posY: 1, posZ: 0, rotX: 0, rotY: 180, rotZ: 180, scaleX: 2.484764, scaleY: 1, scaleZ: 2.484764 };
    let index = 100;
    for (const [code, quantity] of Object.entries(deck.cards)) {
        const card = info.get(code);
        if (!(card?.originalImg || card?.img)) throw new Error(`${code} 缺少卡牌资料`);
        const absoluteImage = value => {
            let url;
            try { url = new URL(value); } catch { throw new Error('TTS 卡图须使用公开的 HTTPS 绝对地址'); }
            if (url.protocol !== 'https:' || url.username || url.password || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('TTS 卡图须使用公开的 HTTPS 绝对地址');
            return url.href;
        };
        const face = { FaceURL: absoluteImage(card.originalImg || card.img), BackURL: absoluteImage(card.backImg || 'https://lycee-tcg.com/about/images/card.png'),
            NumWidth: 1, NumHeight: 1, BackIsHidden: true, UniqueBack: false, Type: 0 };
        custom[index] = face;
        for (let n = 0; n < quantity; n++) objects.push({ Name: 'CardCustom', Transform: { ...transform },
            Nickname: code, Description: card.name, CardID: index * 100, CustomDeck: { [index]: face },
            Hands: true, SidewaysCard: false });
        index++;
    }
    return { SaveName: deck.name, GameMode: '', Date: '', ObjectStates: objects.length === 1 ? objects : [{
        Name: 'DeckCustom', Nickname: deck.name, Transform: transform, Hands: true,
        DeckIDs: objects.map(o => o.CardID), CustomDeck: custom, ContainedObjects: objects
    }] };
}
