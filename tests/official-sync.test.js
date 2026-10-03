import test from 'node:test';
import assert from 'node:assert/strict';
import { queueEntries, dueEntries, failEntry, initializeSourceState, nextDiscoveryPage, advanceSourcePage } from '../lib/official-sync-state.js';

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

const now = Date.parse('2026-10-03T00:00:00Z');
function planRun(state, budget, limit = 30, response = () => ({ next: 2, allOld: false })) {
    initializeSourceState(state);
    const recent = new Set(), requests = [];
    let request;
    while ((request = nextDiscoveryPage(state, recent, budget - requests.length, limit, now))) {
        requests.push(request);
        const { next, allOld } = response(request);
        if (request.page === 1) recent.add(request.source);
        advanceSourcePage(state, request.source, request.page, next, allOld);
    }
    return requests;
}

test('independent cursors restart legacy pagination while preserving the pending and retry queue', () => {
    const pending = [{ key: 'old' }, { key: 'failed', attempts: 2, retryAt: '2026-10-04T00:00:00Z' }];
    const state = { page: 73, pending };
    assert.equal(initializeSourceState(state), state);
    assert.deepEqual(state.sourcePages, { user: 1, festa: 1 });
    assert.equal(state.nextSource, 'user');
    assert.equal(state.pending, pending);
    assert.deepEqual(dueEntries(state, 30, now), [pending[0]]);
});

test('a one-page budget alternates recent user and tournament lists across runs', () => {
    const state = { pending: [{ key: 'already-due' }] };
    assert.deepEqual(planRun(state, 1, 1), [{ source: 'user', page: 1 }]);
    assert.deepEqual(planRun(state, 1, 1), [{ source: 'festa', page: 1 }]);
    assert.deepEqual(planRun(state, 1, 1), [{ source: 'user', page: 1 }]);
    assert.deepEqual(state.sourcePages, { user: 2, festa: 2 });
});

test('a three-page budget visits both recent lists then fairly advances older independent cursors', () => {
    const state = { pending: [] };
    const response = ({ page }) => ({ next: page + 1, allOld: false });
    assert.deepEqual(planRun(state, 3, 30, response), [
        { source: 'user', page: 1 }, { source: 'festa', page: 1 }, { source: 'user', page: 2 }
    ]);
    assert.deepEqual(state.sourcePages, { user: 3, festa: 2 });
    assert.deepEqual(planRun(state, 3, 30, response), [
        { source: 'festa', page: 1 }, { source: 'user', page: 1 }, { source: 'festa', page: 2 }
    ]);
    assert.deepEqual(state.sourcePages, { user: 3, festa: 3 });
});

test('persisted source cursors resume separately and recent scans do not overwrite older progress', () => {
    const state = { page: 99, sourcePages: { user: 12, festa: 7 }, nextSource: 'festa', pending: [] };
    assert.deepEqual(planRun(state, 4, 30, ({ page }) => ({ next: page + 1, allOld: false })), [
        { source: 'festa', page: 1 }, { source: 'user', page: 1 },
        { source: 'festa', page: 7 }, { source: 'user', page: 12 }
    ]);
    assert.deepEqual(state.sourcePages, { user: 13, festa: 8 });
    assert.equal(state.nextSource, 'festa');
    assert.equal(state.page, 8);
});

test('recent pages still refresh when the detail queue is full while older discovery stops', () => {
    const state = { sourcePages: { user: 5, festa: 9 }, pending: [{ key: 'due' }] };
    assert.deepEqual(planRun(state, 3, 1), [{ source: 'user', page: 1 }, { source: 'festa', page: 1 }]);
    assert.deepEqual(state.sourcePages, { user: 5, festa: 9 });
});

test('all-old or exhausted source lists reset only their own cursor and stop older discovery', () => {
    const state = { sourcePages: { user: 6, festa: 4 }, pending: [] };
    assert.deepEqual(planRun(state, 3, 30, ({ source }) => ({ next: source === 'user' ? 2 : null, allOld: source === 'user' })), [
        { source: 'user', page: 1 }, { source: 'festa', page: 1 }
    ]);
    assert.deepEqual(state.sourcePages, { user: 1, festa: 1 });
    const resumed = { sourcePages: { user: 6, festa: 4 }, pending: [] };
    initializeSourceState(resumed);
    advanceSourcePage(resumed, 'festa', 4, null, false);
    assert.deepEqual(resumed.sourcePages, { user: 6, festa: 1 });
    advanceSourcePage(resumed, 'user', 6, 7, true);
    assert.deepEqual(resumed.sourcePages, { user: 1, festa: 1 });
});
