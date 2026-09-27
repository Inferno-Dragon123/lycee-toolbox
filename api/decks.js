import { validateDeck, DECK_ID } from '../public/deck-format.js';
import { hydrate } from '../lib/catalog.js';
import { saveDeck, loadDeck } from '../lib/deck-store.js';
import { method, body, fail } from '../lib/http.js';

export default async function handler(req, res) {
    if (!method(req, res, ['GET', 'POST'])) return;
    res.setHeader('Cache-Control', 'no-store');
    try {
        if (req.method === 'GET') {
            const id = new URL(req.url, 'http://localhost').searchParams.get('id');
            if (!DECK_ID.test(id || '')) throw Object.assign(new Error('无效的卡组 ID'), { status: 400 });
            const deck = await loadDeck(id);
            if (!deck) throw Object.assign(new Error('未找到该卡组'), { status: 404 });
            return res.status(200).json({ ...deck, schemaVersion: 1, cardInfo: hydrate(Object.keys(deck.cards)) });
        }
        let deck;
        try { deck = validateDeck(body(req)); } catch (e) { e.status ||= 400; throw e; }
        hydrate(Object.keys(deck.cards));
        const saved = await saveDeck(deck);
        return res.status(201).json({ ...saved, name: deck.name });
    } catch (e) { return fail(res, e); }
}
