import { importDeck } from '../lib/deck-import.js';
import { hydrate } from '../lib/catalog.js';
import { method, fail } from '../lib/http.js';
import { withCardImageUrls } from '../lib/card-images.js';

export default async function handler(req, res) {
    if (!method(req, res, ['GET'])) return;
    try {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const deck = await importDeck(params.get('type'), params.get('id') || '');
        const cardInfo = hydrate(Object.keys(deck.cards)).map(card => withCardImageUrls(card));
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
        return res.status(200).json({ ...deck, cardInfo });
    } catch (e) { return fail(res, e); }
}
