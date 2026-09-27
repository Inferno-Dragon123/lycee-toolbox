// Opt-in: real Neon development sessions + browser. No OTP emails are sent.
// Only this isolated branch is allowed; synthetic users and their publications are removed afterwards.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import puppeteer from 'puppeteer';
import { createAuthServer } from '@neondatabase/auth/server';
import { byCode } from '../lib/catalog.js';
import { baseCode } from '../public/community-format.js';

if (process.env.NEON_BRANCH !== 'dev-community-decks') throw new Error('This test only runs against dev-community-decks');
const origin = process.env.TEST_ORIGIN || 'http://localhost:3100';
if (!/^http:\/\/localhost:\d+$/.test(origin)) throw new Error('Use a local development server');
const prefix = 'community-e2e-' + randomUUID();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED, connectionTimeoutMillis: 15000 });
await db.connect();
const users = [], errors = [];
let browser;
try {
    for (const label of ['alice', 'bob']) {
        const cookies = new Map();
        const server = createAuthServer({ baseUrl: process.env.NEON_AUTH_BASE_URL, cookieSecret: process.env.NEON_AUTH_COOKIE_SECRET,
            context: () => ({ getCookies: () => [...cookies].map(([name, value]) => `${name}=${value.value}`).join('; '),
                setCookie: (name, value, options) => cookies.set(name, { value, ...options }),
                getHeader: () => null, getOrigin: () => origin, getFramework: () => 'lycee-test' }) });
        const { data, error } = await server.signUp.email({ email: `${prefix}-${label}@example.invalid`, name: `测试 ${label}`, password: randomUUID() + randomUUID() });
        assert(!error, error?.message); assert(data?.user?.id);
        users.push({ id: data.user.id, cookies });
        // This verifies application permissions, not email delivery. Only synthetic accounts are verified.
        await db.query('UPDATE neon_auth."user" SET "emailVerified" = true WHERE id = $1 AND email = $2', [data.user.id, `${prefix}-${label}@example.invalid`]);
    }
    console.log('Synthetic development sessions ready');
    browser = await puppeteer.launch({ headless: true, args: ['--no-proxy-server'] });
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1400, height: 1000 });
    await page.goto(origin, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.community-item');
    console.log('Public community loaded');
    // Anonymous preview never touches the editor.
    await page.click('.search-card [data-delta="1"]');
    await page.click('.community-item [data-action="preview"]');
    await page.waitForSelector('.preview-card');
    assert.equal(await page.$eval('#deckTotal', e => e.textContent), '1 张');
    await page.click('[data-close-dialog="previewDialog"]');
    page.on('dialog', d => d.accept());
    await page.click('.community-item [data-action="import"]');
    await page.waitForFunction(() => document.querySelector('#deckTotal').textContent === '60 张');
    await page.click('#restoreBeforeImport');
    await page.waitForFunction(() => document.querySelector('#deckTotal').textContent === '1 张');
    await page.click('.community-item [data-action="import"]');
    await page.waitForFunction(() => document.querySelector('#deckTotal').textContent === '60 张');
    console.log('Anonymous preview/import/restore passed');
    await browser.setCookie(...[...users[0].cookies].filter(([name]) => name.includes('session')).map(([name, cookie]) => ({ name, value: cookie.value, url: origin, path: '/', httpOnly: true, secure: cookie.secure ?? true, sameSite: 'Lax' })));
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => !document.querySelector('#logoutBtn').hidden);
    console.log('Browser session restored');
    await page.click('#publishDeckBtn');
    await page.$eval('#publicationName', (el, name) => { el.value = name; }, prefix + ' <script>');
    await page.type('#publicationDescription', '<img src=x onerror=alert(1)>');
    await page.click('#confirmPublish');
    await page.waitForFunction(() => !document.querySelector('#publishDialog').open, { timeout: 30000 });
    await page.waitForSelector('.community-item [data-action="edit"]');
    console.log('Publication created');
    const id = await page.$eval('.community-item', e => e.dataset.publication);
    assert(await page.$eval('.community-item', e => e.textContent.includes('<img src=x onerror=alert(1)>')));
    const aliceCookie = [...users[0].cookies].map(([name, c]) => `${name}=${c.value}`).join('; ');
    const bobCookie = [...users[1].cookies].map(([name, c]) => `${name}=${c.value}`).join('; ');
    const call = async (cookie, method, input) => fetch(origin + '/api/community', { method, headers: { cookie, origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal((await call(bobCookie, 'DELETE', { id, version: 1 })).status, 404);
    assert.equal((await fetch(`${origin}/api/community?id=${id}`)).status, 200);
    await page.click('.community-item [data-action="edit"]');
    await page.waitForSelector('#publishDialog[open]');
    await page.$eval('#publicationDescription', el => { el.value = '编辑已验证'; });
    await page.click('#confirmPublish');
    await page.waitForFunction(() => !document.querySelector('#publishDialog').open);
    assert.equal((await call(aliceCookie, 'PATCH', { id, version: 1, action: 'unpublish' })).status, 409);
    await page.click('.community-item [data-action="unpublish"]');
    await page.waitForSelector('.community-item [data-action="publish"]');
    assert.equal((await fetch(`${origin}/api/community?id=${id}`)).status, 404);
    await page.click('.community-item [data-action="publish"]');
    await page.waitForSelector('.community-item [data-action="unpublish"]');
    await page.click('#recommendEnabled');
    const published = await (await fetch(`${origin}/api/community?id=${id}`)).json();
    const bases = new Set(Object.keys(published.cards).map(baseCode));
    const variant = [...byCode.keys()].find(code => code.length > 7 && bases.has(baseCode(code)));
    assert(variant, 'Fixture must have an alternate artwork in the catalog');
    await page.type('#field_code', variant); await page.click('#searchBtn');
    await page.waitForFunction(code => { const rows = document.querySelectorAll('#searchResultArea .search-card'); return rows.length === 1 && rows[0].dataset.card === code; }, {}, variant);
    await page.click(`#searchResultArea [data-recommend="${variant}"]`);
    await page.waitForFunction(base => document.querySelector('#communityHeading').textContent.includes(base) && document.querySelectorAll('.community-item').length >= 2, {}, baseCode(variant));
    await fs.mkdir('temp/community', { recursive: true });
    await page.screenshot({ path: 'temp/community/verified-desktop.png', fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'temp/community/verified-mobile.png', fullPage: true });
    await page.click('#logoutBtn');
    await page.waitForFunction(() => !document.querySelector('#loginBtn').hidden);
    assert.equal((await call(aliceCookie, 'DELETE', { id, version: 4 })).status, 401);
    assert.deepEqual(errors, []);
    console.log('PASS: real sessions, publish/edit/ownership, revocation, unpublish, variant recommendations, preview/import/restore, desktop/mobile. OTP delivery NOT tested.');
} catch (e) {
    console.error('Live smoke failed:', e.message);
    if (browser) { const pages = await browser.pages(); const page = pages.at(-1); console.log(await page.evaluate(() => ({ status: document.querySelector('#statusDisplay')?.textContent, community: document.querySelector('#communityStatus')?.textContent, publish: document.querySelector('#publishMessage')?.textContent }))); await page.screenshot({ path: 'temp/community/failure.png', fullPage: true }); }
    throw e;
} finally {
    if (browser) await browser.close();
    const ids = users.map(u => u.id);
    if (ids.length) {
        await db.query('DELETE FROM toolbox_publications WHERE owner_id = ANY($1::text[])', [ids]);
        await db.query('DELETE FROM toolbox_community_limits WHERE subject = ANY($1::text[])', [ids.flatMap(id => ['create:' + id, 'edit:' + id])]);
        await db.query('DELETE FROM neon_auth."user" WHERE id::text = ANY($1::text[]) AND email LIKE $2', [ids, prefix + '%@example.invalid']);
        await db.query('DELETE FROM toolbox_decks d WHERE name LIKE $1 AND NOT EXISTS (SELECT 1 FROM toolbox_publications p WHERE p.snapshot_id = d.id)', [prefix + '%']);
    }
    await db.end();
}
