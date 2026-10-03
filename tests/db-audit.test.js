import test from 'node:test';
import assert from 'node:assert/strict';
import { tableFingerprint, differences } from '../scripts/db-audit.js';

test('transfer fingerprints ignore row/object order but detect ownership and snapshot changes', () => {
    const original = [{ id: 'one', owner_id: 'user1', cards: { b: 2, a: 1 }, created_at: new Date('2026-01-01Z') }, { id: 'two' }];
    const reordered = [{ id: 'two' }, { created_at: new Date('2026-01-01Z'), cards: { a: 1, b: 2 }, owner_id: 'user1', id: 'one' }];
    const a = { tables: { toolbox_decks: tableFingerprint(original) } };
    const b = { tables: { toolbox_decks: tableFingerprint(reordered) } };
    assert.deepEqual(differences(a, b), []);
    b.tables.toolbox_decks = tableFingerprint([{ ...original[0], owner_id: 'user2' }, original[1]]);
    assert.deepEqual(differences(a, b), ['toolbox_decks']);
    assert.deepEqual(differences(a, { tables: {} }), ['toolbox_decks']);
});
