// Targeted UI test: mock only identity/profile transport; recommendations use the development DB.
// No new accounts or email are created. Store/API authorization is covered by community.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { createServer } from '../scripts/dev-server.js';
import { baseCode } from '../public/community-format.js';
import { getPool } from '../lib/deck-store.js';

const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    const listing = await (await fetch(origin + '/api/community?source=official')).json();
    assert(listing.items?.length, 'Seed k0PjKL before running this test');
    const deck = await (await fetch(origin + '/api/community?id=' + listing.items[0].id)).json();
    const codes = [...new Set(Object.keys(deck.cards).map(baseCode))].slice(0, 2);
    const expected = await (await fetch(origin + '/api/community?codes=' + codes.join(','))).json();
    assert(expected.items.some(item => item.id === deck.id));
    browser = await puppeteer.launch({ headless: true, args: ['--no-proxy-server'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let profile = { nickname: '', displayName: '玩家 test1234', playerTag: '玩家 test1234' };
    await page.setRequestInterception(true);
    page.on('request', req => {
        const url = new URL(req.url());
        const json = data => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname === '/api/auth/get-session') return json({ user: { id: 'fixture', email: 'ui@example.invalid', emailVerified: true }, session: { id: 'fixture', userId: 'fixture', expiresAt: new Date(Date.now() + 3600000).toISOString() } });
        if (url.pathname === '/api/community' && url.searchParams.has('session')) return json({ authenticated: true, verified: true, admin: false, profile });
        if (url.pathname === '/api/community' && req.method() === 'PATCH') {
            const input = JSON.parse(req.postData());
            assert.equal(input.action, 'profile');
            profile = { ...profile, nickname: input.nickname, displayName: input.nickname }; return json({ profile });
        }
        return req.continue();
    });
    await page.setViewport({ width: 1400, height: 1000 });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#profileBtn').hidden);
    await page.click('#profileBtn'); await page.type('#profileNickname', '<b>测试玩家</b>'); await page.click('#saveProfile');
    await page.waitForFunction(() => !document.querySelector('#profileDialog').open && document.querySelector('#accountLabel').textContent.includes('<b>测试玩家</b>'));
    assert.equal(await page.$('#accountLabel b'), null);
    await page.click('#recommendEnabled');
    await page.type('#recommendCodesInput', `${codes[0]}-A,${codes[0]},${codes[1]}`);
    await page.click('#recommendForm button');
    await page.waitForFunction(count => document.querySelectorAll('#selectedRecommendations button').length === 2 && document.querySelectorAll('.community-item').length === count, {}, expected.items.length);
    assert.equal(await page.$eval('#recommendMatch', e => e.value), 'all');
    await page.type('#recommendCodesInput', 'LO-9999'); await page.click('#recommendForm button');
    await page.waitForFunction(() => document.querySelectorAll('#selectedRecommendations button').length === 3 && !document.querySelectorAll('.community-item').length && document.querySelector('#communityResults').textContent.includes('暂无'));
    await page.select('#recommendMatch', 'any'); await page.waitForSelector('.community-item');
    await page.click('[data-remove-recommend="LO-9999"]');
    await page.waitForFunction(() => document.querySelectorAll('#selectedRecommendations button').length === 2);
    await fs.mkdir('temp/community', { recursive: true });
    await page.$('#communityPanel').then(el => el.screenshot({ path: 'temp/community/multicard-desktop.png' }));
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.$('#communityPanel').then(el => el.screenshot({ path: 'temp/community/multicard-mobile.png' }));
    await page.click('#clearRecommendations');
    await page.waitForFunction(() => document.querySelectorAll('#selectedRecommendations button').length === 0 && document.querySelectorAll('.community-item').length === 0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#accountLabel').textContent.includes('<b>测试玩家</b>'));
    assert.deepEqual(errors, []);
    console.log('PASS: nickname UI/escaping/restoration (mock identity), multi-card AND/OR (real DB), artwork dedup, remove/clear, mobile layout. No email sent.');
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await getPool().end();
}
