import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionServer } from '../scripts/server.js';
import { createLimiter } from '../lib/resource-limit.js';
import { method } from '../lib/http.js';

async function withServer(checkReady, run) {
    const server = createProductionServer({ checkReady });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try { await run(`http://127.0.0.1:${server.address().port}`, server); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('production routes serve live catalog and static conditional responses while denying private paths', async () => {
    await withServer(async () => {}, async base => {
        const health = await fetch(base + '/api/health');
        assert.equal(health.status, 200);
        assert.equal((await health.json()).status, 'ok');
        const response = await fetch(base + '/api/cards?code=6826');
        assert.equal(response.status, 200);
        const result = await response.json();
        assert(result.cards.some(card => card.code === 'LO-6826'));
        const page = await fetch(base + '/');
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-type'), /text\/html/);
        assert.equal((await fetch(base + '/', { headers: { 'If-None-Match': page.headers.get('etag') } })).status, 304);
        const head = await fetch(base + '/', { method: 'HEAD' });
        assert.equal(await head.text(), '');
        assert(Number(head.headers.get('content-length')) > 0);
        for (const forbidden of ['/.env', '/%2eenv', '/api/deck-store', '/api/../lib/deck-store.js', '/%ZZ']) {
            assert([400, 404].includes((await fetch(base + forbidden)).status), forbidden);
        }
    });
});

test('readiness failure, draining and bounded input fail without exposing internal diagnostics', async () => {
    await withServer(async () => { throw new Error('private connection string'); }, async (base, server) => {
        const readiness = await fetch(base + '/api/health');
        assert.equal(readiness.status, 503);
        assert.deepEqual(await readiness.json(), { status: 'unavailable' });
        assert.equal((await fetch(base + '/healthz')).status, 200);
        assert.equal((await fetch(base + '/api/generate-pdf', { method: 'POST', body: '{' })).status, 400);
        assert.equal((await fetch(base + '/api/generate-pdf', { method: 'POST', body: 'x'.repeat(32769) })).status, 413);
        server.beginShutdown();
        assert.equal((await fetch(base + '/healthz')).status, 503);
    });
});

test('PDF resource slots release once and refuse concurrent image-decoding work', () => {
    const limit = createLimiter(1);
    const release = limit.acquire();
    assert.equal(limit.active, 1);
    assert.equal(limit.acquire(), null);
    release(); release();
    assert.equal(limit.active, 0);
    assert.equal(typeof limit.acquire(), 'function');
    assert.throws(() => createLimiter(3));
});

test('migration read-only gate covers legacy and self-hosted database and auth writes', () => {
    const old = process.env.MIGRATION_READ_ONLY;
    process.env.MIGRATION_READ_ONLY = '1';
    try {
        const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
        for (const url of ['/api/decks', '/api/community?id=x', '/api/auth?path=sign-in/email-otp', '/api/auth/sign-out']) {
            assert.equal(method({ method: 'POST', url }, response, ['POST']), false);
            assert.equal(response.code, 503);
        }
        assert.equal(method({ method: 'POST', url: '/api/generate-pdf' }, response, ['POST']), true);
        assert.equal(method({ method: 'GET', url: '/api/community' }, response, ['GET']), true);
    } finally { if (old === undefined) delete process.env.MIGRATION_READ_ONLY; else process.env.MIGRATION_READ_ONLY = old; }
});
