import { CODE, normalizeCode, validateDeck } from './deck-format.js';

export const PUBLICATION_ID = /^p_[A-Za-z0-9_-]{22}$/;
export const sourceLabels = { community: '本站投稿', official_tournament: '官网赛事', official_user: '官网玩家', official: '官网卡组' };
export function baseCode(value) {
    const code = normalizeCode(value);
    if (!CODE.test(code)) throw new Error('请输入有效卡号');
    return code.slice(0, 7);
}
export function publicationInput(input) {
    const deck = validateDeck(input);
    if (Object.values(deck.cards).reduce((a, b) => a + b, 0) !== 60) throw new Error('公开发布的卡组须为 60 张；未完成的卡组可以保存分享或导出文件');
    if (!input.name?.trim()) throw new Error('请填写卡组名称');
    const description = input.description ?? '';
    if (typeof description !== 'string' || description.length > 2000) throw new Error('卡组说明最多 2000 个字符');
    return { deck, description: description.trim() };
}
