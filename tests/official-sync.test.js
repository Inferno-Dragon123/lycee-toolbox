import test from 'node:test';
import assert from 'node:assert/strict';
import { queueEntries, dueEntries, failEntry } from '../lib/official-sync-state.js';

test('discovery deduplicates pages, skips recent syncs and preserves failed queue state', () => {
    const now = Date.parse('2026-09-28T00:00:00Z');
    const failed = { key: 'retry', attempts: 1, retryAt: '2026-09-29T00:00:00Z' };
    const state = { pending: [failed] };
    queueEntries(state, ['new', 'new', 'fresh', 'stale', 'retry'].map(key => ({ key })),
        new Map([['fresh', new Date(now - 60000)], ['stale', new Date(now - 8 * 86400000)]]), now);
    assert.deepEqual(state.pending.map(e => e.key), ['retry', 'new', 'stale']);
    assert.deepEqual(state.pending[0], failed);
    assert.deepEqual(dueEntries(state, 1, now).map(e => e.key), ['new']);
});

test('failed requests do not starve the queue and receive capped retry backoff', () => {
    const now = Date.parse('2026-09-28T00:00:00Z');
    const entry = { key: 'bad' }, state = { pending: [entry, { key: 'good' }] };
    failEntry(state, entry, 'HTTP 503', now);
    assert.deepEqual(dueEntries(state, 10, now).map(e => e.key), ['good']);
    assert.equal(state.pending[1].attempts, 1);
    assert.equal(Date.parse(state.pending[1].retryAt), now + 3600000);
    failEntry(state, { ...state.pending[1], attempts: 999 }, 'still failing', now);
    assert.equal(Date.parse(state.pending[1].retryAt), now + 7 * 86400000);
    assert.equal(dueEntries(state, 10, now + 8 * 86400000).length, 2);
});
