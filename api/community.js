import { currentUser, checkOrigin } from '../lib/community-auth.js';
import { createPublication, updatePublication, listPublications, getPublication, getProfile, setProfile } from '../lib/community-store.js';
import { PUBLICATION_ID, sourceLabels, publicationInput, selectedCodes, validateNickname } from '../public/community-format.js';
import { byCode, hydrate } from '../lib/catalog.js';
import { body, method, fail } from '../lib/http.js';
import { compositionSeries } from '../lib/deck-composition.js';
import { parseDeckSearch } from '../lib/deck-search.js';

const invalid = message => Object.assign(new Error(message), { status: 400 });
export function communityHandler({ identify = currentUser, store = { createPublication, updatePublication, listPublications, getPublication, getProfile, setProfile } } = {}) {
    return async (req, res) => {
        if (!method(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
        res.setHeader('Cache-Control', 'no-store');
        try {
            const params = new URL(req.url, 'http://localhost').searchParams;
            if (req.method === 'GET') {
                if (params.get('facets') === '1') return res.status(200).json({ series: compositionSeries });
                if (params.has('session')) {
                    const user = await identify(req, res);
                    return res.status(200).json({ authenticated: Boolean(user), admin: Boolean(user?.admin), verified: Boolean(user?.emailVerified), profile: user ? await store.getProfile(user) : null });
                }
                const mine = params.get('mine') === '1', moderation = params.get('moderation') === '1';
                const user = await identify(req, res, mine || moderation);
                if (moderation && !user?.admin) throw Object.assign(new Error('需要管理员权限'), { status: 403 });
                if (params.has('id')) {
                    const id = params.get('id');
                    if (!PUBLICATION_ID.test(id)) throw invalid('无效发布 ID');
                    const item = await store.getPublication(id, user);
                    const missing = Object.keys(item.cards).filter(code => !byCode.has(code));
                    return res.status(200).json({ ...item, missing, cardInfo: Object.keys(item.cards).filter(code => byCode.has(code)).map(code => byCode.get(code)) });
                }
                const page = Number(params.get('page') || 1), source = params.get('source'), match = params.get('match') || 'all';
                if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw invalid('无效页码');
                if (source && !Object.hasOwn(sourceLabels, source)) throw invalid('无效来源');
                if (!['all', 'any'].includes(match)) throw invalid('无效匹配方式');
                let codes;
                try { codes = selectedCodes([...params.getAll('code'), ...params.getAll('codes').flatMap(value => value.split(','))]); }
                catch (e) { throw invalid(e.message); }
                return res.status(200).json(await store.listPublications({ page, codes, match, source, mine, moderation, user, ...parseDeckSearch(params) }));
            }
            checkOrigin(req);
            const user = await identify(req, res, true);
            if (!user.emailVerified) throw Object.assign(new Error('请使用邮箱验证码完成验证后发布或管理卡组'), { status: 403 });
            let input;
            try { input = body(req); } catch (e) { throw invalid(e.message); }
            if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('无效请求');
            const action = req.method === 'DELETE' ? 'delete' : input.action;
            if (req.method === 'PATCH' && action === 'profile') {
                let nickname;
                try { nickname = validateNickname(input.nickname); } catch (e) { throw invalid(e.message); }
                return res.status(200).json({ profile: await store.setProfile(user, nickname) });
            }
            let validated;
            if (req.method === 'POST' || action === 'edit') {
                try { validated = publicationInput(input); } catch (e) { throw invalid(e.message); }
                hydrate(Object.keys(validated.deck.cards));
            }
            if (req.method === 'POST') return res.status(201).json(await store.createPublication(user, validated));
            if (!PUBLICATION_ID.test(input.id || '') || !Number.isSafeInteger(input.version) || input.version < 1) throw invalid('无效发布 ID 或版本');
            if (!['edit', 'publish', 'unpublish', 'delete', 'hide', 'unhide'].includes(action)) throw invalid('无效操作');
            return res.status(200).json(await store.updatePublication(user, input.id, input.version, action, validated));
        } catch (e) { return fail(res, e); }
    };
}
export default communityHandler();
