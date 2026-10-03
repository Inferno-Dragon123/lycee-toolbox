import { facets, abilityFacets, hydrate, search, cards } from '../lib/catalog.js';
import { normalizeCode, CODE } from '../public/deck-format.js';
import { method, fail } from '../lib/http.js';
import { withCardImageUrls } from '../lib/card-images.js';

export default function handler(req, res) {
    if (!method(req, res, ['GET'])) return;
    try {
        const params = new URL(req.url, 'http://localhost').searchParams;
        let result;
        if (params.get('facets') === '1') result = { facets, abilityFacets, total: cards.length };
        else if (params.has('codes')) {
            const codes = [...new Set(params.get('codes').split(',').map(normalizeCode))];
            if (codes.length > 200 || codes.some(c => !CODE.test(c))) throw Object.assign(new Error('无效的卡号列表'), { status: 400 });
            result = { cards: hydrate(codes) };
        } else result = search(params);
        if (result.cards) result.cards = result.cards.map(card => withCardImageUrls(card));
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
        return res.status(200).json(result);
    } catch (e) { return fail(res, e); }
}
