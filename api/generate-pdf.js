import { validateDeck } from '../public/deck-format.js';
import { hydrate } from '../lib/catalog.js';
import { method, body, fail } from '../lib/http.js';
import { downloadImages, renderPdf } from '../lib/pdf.js';

export default async function handler(req, res) {
    if (!method(req, res, ['POST'])) return;
    try {
        let deck;
        try {
            let input = body(req);
            // Support previously opened pages while using canonical server card data.
            if (Array.isArray(input?.cards)) {
                const cards = {};
                for (const card of input.cards) {
                    if (Object.hasOwn(cards, card.code)) throw new Error('卡号重复');
                    cards[card.code] = card.num;
                }
                input = { name: input.name, cards };
            }
            deck = validateDeck(input);
        } catch (e) { e.status ||= 400; throw e; }
        const cards = hydrate(Object.keys(deck.cards));
        const images = await downloadImages(cards);
        const { buffer, missingImages } = await renderPdf(deck, cards, images);
        if (buffer.length > 4 * 1024 * 1024) throw Object.assign(new Error('卡表文件过大，请减少卡牌种类后重试'), { status: 413 });
        // Blob downloads should not be intercepted as direct PDF navigations (e.g. IDM).
        const binary = req.headers.accept === 'application/octet-stream';
        res.setHeader('Content-Type', binary ? 'application/octet-stream' : 'application/pdf');
        if (!binary) res.setHeader('Content-Disposition', 'attachment; filename="lycee-deck.pdf"');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Missing-Images', String(missingImages));
        return res.status(200).send(buffer);
    } catch (e) { return fail(res, e); }
}
