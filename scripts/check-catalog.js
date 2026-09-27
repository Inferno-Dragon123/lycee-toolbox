import { cards, facets } from '../lib/catalog.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';

for (const card of cards) {
    assert(card.name, `Missing name: ${card.code}`);
    assert(card.img.startsWith('https://lycee-tcg.com/card/image/'), `Invalid image: ${card.code}`);
    assert.equal(typeof card.effect, 'string');
}
assert(fs.existsSync(new URL('../public/fonts/NotoSansSC.ttf', import.meta.url)), 'Missing PDF font');
console.log(`Catalog verified: ${cards.length} cards, ${cards.filter(c => c.translated).length} translated; ${facets.length} facet groups`);
