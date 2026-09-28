import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { communityHandler } from '../api/community.js';
import { baseCode, publicationInput, validateNickname, selectedCodes } from '../public/community-format.js';
import { createPublication, updatePublication, listPublications, getPublication, upsertOfficial, getProfile, setProfile } from '../lib/community-store.js';
import { parseOfficialList } from '../lib/official-deck-list.js';
import { checkOrigin, currentUser } from '../lib/community-auth.js';
import authHandler from '../api/auth.js';

const input = publicationInput({ name: '测试卡组', cards: { 'LO-6826': 30, 'LO-6826-A': 30 }, description: '测试说明' });
const alice = { id: 'test-alice', emailVerified: true }, bob = { id: 'test-bob', emailVerified: true };
test('publication validation groups artworks without mutating saved card identities', () => {
    assert.equal(baseCode('lo-0001a'), 'LO-0001'); assert.equal(baseCode('LO-6826-K'), 'LO-6826');
    assert.throws(() => baseCode('LO-12345'));
    assert.throws(() => publicationInput({ name: 'unfinished', cards: { 'LO-6826': 1 } }), /60/);
    assert.throws(() => publicationInput({ cards: { 'LO-6826': 60 } }), /名称/);
    assert.deepEqual(input.deck.cards, { 'LO-6826': 30, 'LO-6826-A': 30 });
    assert.deepEqual(selectedCodes(['LO-6826', 'LO-6826-A', 'lo-0001a']), ['LO-6826', 'LO-0001']);
    assert.throws(() => selectedCodes(Array.from({ length: 11 }, (_, i) => `LO-${String(i).padStart(4, '0')}`)), /10/);
    assert.equal(validateNickname('  玩家🍀  '), '玩家🍀');
    assert.equal(validateNickname('🍀'.repeat(24)), '🍀'.repeat(24));
    for (const name of ['', '   ', 'a'.repeat(25), '玩家\n名字', '玩家\u200b名字', null]) assert.throws(() => validateNickname(name));
});
test('SQL publication lifecycle preserves independent ownership, visibility, versions and indexes', async () => {
    const pg = new PGlite();
    for (const file of ['001_decks.sql', '002_community.sql', '003_profiles.sql']) await pg.exec(await fs.readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'));
    // PGlite executes serially in one session; cloud integration covers real pg locking.
    const db = { async query(sql, params) { if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }; return pg.query(sql, params); }, async connect() { return { query: this.query, release() {} }; } };
    try {
        const first = await createPublication(alice, input, db), second = await createPublication(bob, input, db);
        assert.notEqual(first.id, second.id);
        await setProfile(alice, '新的昵称', db);
        assert.equal((await getPublication(first.id, null, db)).author_name, '新的昵称');
        assert.notEqual((await getPublication(second.id, null, db)).author_name, '新的昵称');
        await setProfile(bob, '新的昵称', db);
        assert.notEqual((await getProfile(alice, db)).playerTag, (await getProfile(bob, db)).playerTag);
        await setProfile(alice, '再次改名', db);
        assert.equal((await listPublications({ mine: true, user: alice }, db)).items[0].author_name, '再次改名');
        assert.equal((await pg.query('SELECT count(*)::int n FROM toolbox_decks')).rows[0].n, 1);
        assert.equal((await listPublications({ code: 'LO-6826-K' }, db)).items.length, 2);
        await assert.rejects(updatePublication(bob, first.id, 1, 'delete', null, db), { status: 404 });
        await assert.rejects(createPublication(alice, input, db), { status: 409 });
        await updatePublication(alice, first.id, 1, 'unpublish', null, db);
        await assert.rejects(getPublication(first.id, null, db), { status: 404 });
        await assert.rejects(getPublication(first.id, bob, db), { status: 404 });
        assert.equal((await getPublication(first.id, alice, db)).status, 'unlisted');
        assert.equal((await listPublications({ code: 'LO-6826' }, db)).items.length, 1);
        await assert.rejects(updatePublication(alice, first.id, 1, 'publish', null, db), { status: 409 });
        const edited = publicationInput({ name: '另一张卡', cards: { 'LO-0001': 60 } });
        await updatePublication(alice, first.id, 2, 'edit', edited, db);
        await updatePublication(alice, first.id, 3, 'publish', null, db);
        assert.equal((await listPublications({ code: 'LO-0001A' }, db)).items[0].id, first.id);
        assert.equal((await listPublications({ code: 'LO-6826' }, db)).items.length, 1);
        const admin = { ...bob, admin: true };
        await updatePublication(admin, first.id, 4, 'hide', null, db);
        await assert.rejects(updatePublication(alice, first.id, 5, 'publish', null, db), { status: 403 });
        await assert.rejects(getPublication(first.id, null, db), { status: 404 });
        await updatePublication(admin, first.id, 5, 'unhide', null, db);
        await updatePublication(alice, first.id, 6, 'delete', null, db);
        await assert.rejects(getPublication(first.id, alice, db), { status: 404 });
        assert.equal((await getPublication(second.id, bob, db)).name, input.deck.name);
        assert.equal((await pg.query('SELECT count(*)::int n FROM toolbox_decks')).rows[0].n, 2);
        const official = { key: 'k0PjKL', source: 'official_user', deck: input.deck };
        const id = await upsertOfficial(official, db);
        assert.equal(await upsertOfficial(official, db), id);
        assert.equal(await upsertOfficial({ ...official, source: 'official' }, db), id);
        const synced = await getPublication(id, null, db);
        assert.equal(synced.source, 'official_user');
        assert.equal(synced.version, 1);
        await upsertOfficial({ ...official, deck: { ...input.deck, name: '官网更新后的名称' } }, db);
        assert.equal((await getPublication(id, null, db)).version, 2);
        assert.equal((await pg.query('SELECT sum(quantity)::int n FROM toolbox_publication_cards WHERE publication_id = $1', [id])).rows[0].n, 60);
        await assert.rejects(updatePublication(alice, id, 1, 'delete', null, db), { status: 404 });
        assert.equal((await listPublications({ source: 'official_user' }, db)).items.length, 1);
        const combo = await createPublication(alice, publicationInput({ name: '双卡组合', cards: { 'LO-6826': 30, 'LO-0001': 30 } }), db);
        const filtered = await listPublications({ codes: ['LO-6826-A', 'LO-0001A', 'LO-6826'], match: 'all' }, db);
        assert.deepEqual(filtered.items.map(x => x.id), [combo.id]);
        const any = await listPublications({ codes: ['LO-6826', 'LO-0001'], match: 'any' }, db);
        assert(any.items.some(x => x.id === second.id)); assert(any.items.some(x => x.id === combo.id));
        await updatePublication(alice, combo.id, 1, 'unpublish', null, db);
        assert.equal((await listPublications({ codes: ['LO-6826', 'LO-0001'] }, db)).items.length, 0);
        await pg.query(`INSERT INTO toolbox_community_limits VALUES ('create:test-quota', date_trunc('hour', now()), 20)`);
        await assert.rejects(createPublication({ id: 'test-quota' }, input, db), { status: 429 });
    } finally { await pg.close(); }
});
async function call(handler, req) {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; },
        status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; }, end() {}, send(data) { this.data = data; } };
    await handler({ url: '/api/community', method: 'GET', headers: {}, ...req }, res); return res;
}
test('API rejects anonymous writes, cross-site requests, forged owners and malformed input', async () => {
    const req = { method: 'POST', headers: { host: 'localhost:3100', origin: 'http://localhost:3100', 'content-type': 'application/json' }, body: { ...input.deck, owner_id: bob.id } };
    const anonymous = communityHandler();
    assert.equal((await call(anonymous, req)).statusCode, 401);
    assert.equal((await call(anonymous, { ...req, headers: { ...req.headers, origin: 'https://attacker.test' } })).statusCode, 403);
    assert.equal((await call(anonymous, { url: '/api/community?mine=1' })).statusCode, 401);
    let owner;
    const signed = communityHandler({ identify: async () => alice, store: { createPublication: async user => { owner = user.id; return { id: 'created' }; } } });
    assert.equal((await call(signed, req)).statusCode, 201); assert.equal(owner, alice.id);
    assert.equal((await call(signed, { ...req, body: { name: 'missing', cards: { 'LO-9999': 60 } } })).statusCode, 422);
    assert.equal((await call(signed, { ...req, body: '{oops' })).statusCode, 400);
    assert.equal((await call(signed, { url: '/api/community?source=toString' })).statusCode, 400);
    assert.equal((await call(signed, { url: '/api/community?moderation=1' })).statusCode, 403);
    const unverified = communityHandler({ identify: async () => ({ ...alice, emailVerified: false }) });
    assert.equal((await call(unverified, req)).statusCode, 403);
    const profileHandler = communityHandler({ identify: async () => alice, store: { setProfile: async (user, nickname) => ({ owner: user.id, nickname }) } });
    const profile = await call(profileHandler, { ...req, method: 'PATCH', body: { action: 'profile', owner_id: bob.id, nickname: '  昵称  ' } });
    assert.deepEqual(profile.data.profile, { owner: alice.id, nickname: '昵称' });
    assert.equal((await call(anonymous, { ...req, method: 'PATCH', body: { action: 'profile', nickname: '昵称' } })).statusCode, 401);
    assert.equal((await call(profileHandler, { ...req, method: 'PATCH', body: { action: 'profile', nickname: '\u200b' } })).statusCode, 400);
    const listHandler = communityHandler({ identify: async () => null, store: { listPublications: async input => input } });
    assert.deepEqual((await call(listHandler, { url: '/api/community?code=LO-6826&codes=LO-6826-A,LO-0001A&match=all' })).data.codes, ['LO-6826', 'LO-0001']);
    assert.equal((await call(listHandler, { url: '/api/community?codes=LO-6826,bad' })).statusCode, 400);
    assert.equal((await call(listHandler, { url: '/api/community?match=invalid' })).statusCode, 400);
});
test('auth transport is same-origin and does not expose other managed auth routes', async () => {
    assert.throws(() => checkOrigin({ headers: { host: 'localhost', origin: 'https://evil.test' } }), { status: 403 });
    assert.equal(await currentUser({ headers: {} }, {}), null);
    for (const path of ['admin/create-user', '../sign-in/email', 'token', 'sign-up/email']) {
        const response = await call(authHandler, { url: '/api/auth?path=' + encodeURIComponent(path), headers: { host: 'localhost' } });
        assert.equal(response.statusCode, 404);
    }
});
test('official list discovers independent decks, classifies sources, and refuses offsite URLs', () => {
    const html = `<table><tr><td><div class="topicicon user">ユーザー</div><a href="/d/?d=k0PjKL">name</a></td><td>2026/09/27 10:00</td></tr>
        <tr><td><div class="topicicon festa">公式大会</div><a href="/d/?d=1608038000306">tournament</a></td><td>2026/09/26</td></tr>
        <tr><td><a href="https://evil.test/d/?d=bad">bad</a><a href="/blog/article.php?number=4503">article</a></td></tr></table>
        <a href="?page=2&limit=100">2</a>`;
    const result = parseOfficialList(html, 'https://lycee-tcg.com/deck/?page=1');
    assert.equal(result.entries.length, 2); assert.equal(result.next, 2);
    assert.equal(result.entries[0].source, 'official_user'); assert.equal(result.entries[0].date, '2026-09-27');
    assert.equal(result.entries[1].source, 'official_tournament');
    assert.throws(() => parseOfficialList('<html>maintenance</html>', 'https://lycee-tcg.com/deck/'));
});
