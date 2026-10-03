// Opt-in UI verification. Real local search API; no database writes or emails.
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from '../scripts/dev-server.js';
import { search } from '../lib/catalog.js';

const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const output = path.resolve('temp/search-filters');
await fs.mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-proxy-server'] });
try {
    const page = await browser.newPage(), errors = [], requests = [];
    let holdSearch = false, releaseSearch, failSearch = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/api/community') return request.respond({ contentType: 'application/json', body: JSON.stringify(url.searchParams.has('session') ? { authenticated: false, profile: null } : url.searchParams.has('facets') ? { series: [] } : { items: [], page: 1, pages: 0, total: 0, hasMore: false }) });
        if (url.pathname.startsWith('/api/auth')) return request.respond({ contentType: 'application/json', body: 'null' });
        if (url.pathname === '/api/image-proxy') return request.abort();
        if (url.pathname === '/api/cards' && !url.searchParams.has('facets')) {
            requests.push(url.searchParams);
            if (failSearch) { failSearch = false; return request.respond({ status: 500, contentType: 'application/json', body: '{"error":"test failure"}' }); }
            if (holdSearch) { holdSearch = false; new Promise(resolve => { releaseSearch = resolve; }).then(() => request.continue()); return; }
        }
        request.continue();
    });
    await page.setViewport({ width: 1400, height: 1000 });
    await page.goto(origin, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.search-card');
    const openFilter = async selector => {
        await page.$eval(selector, e => e.scrollIntoView({ block: 'center' }));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.click(selector);
    };
    const last = search(requests.at(-1)).pages;
    holdSearch = true;
    await page.click('#lastPage');
    await page.waitForFunction(() => document.querySelector('#pageJumpBtn').disabled);
    assert(await page.$$eval('#prevPage, #nextPage, #lastPage, #pageJumpInput, #pageJumpBtn', elements => elements.every(e => e.disabled)));
    releaseSearch();
    await page.waitForFunction(last => document.querySelector('#pageInfo').textContent === `${last} / ${last} 页`, {}, last);
    assert.equal(requests.at(-1).get('page'), String(last));
    assert(await page.$eval('#lastPage', e => e.disabled));
    const jump = async (value, enter = false) => {
        await page.$eval('#pageJumpInput', (e, value) => { e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })); }, value);
        if (enter) { await page.focus('#pageJumpInput'); await page.keyboard.press('Enter'); }
        else await page.click('#pageJumpBtn');
    };
    const beforeInvalid = requests.length;
    for (const value of ['', '0', '2.5', String(last + 1)]) {
        await jump(value);
        assert(await page.$eval('#pageJumpInput', e => !e.validity.valid));
    }
    assert.equal(requests.length, beforeInvalid);
    await jump('2', true);
    await page.waitForFunction(last => document.querySelector('#pageInfo').textContent === `2 / ${last} 页`, {}, last);
    assert.equal(await page.$eval('.search-card', e => e.dataset.card), search(requests.at(-1)).cards[0].code);
    // A failed page request leaves the current result and pagination usable.
    failSearch = true;
    await page.click('#nextPage');
    await page.waitForFunction(() => document.querySelector('#statusDisplay').textContent.includes('test failure'));
    assert.equal(await page.$eval('#pageInfo', e => e.textContent), `2 / ${last} 页`);
    assert(await page.$eval('#pageJumpBtn', e => !e.disabled));
    await openFilter('#field_attribute');
    await page.click('[data-option="雪"]'); await page.click('[data-option="月"]');
    assert.equal(await page.$$eval('#searchFilterPopup [aria-pressed="true"]', elements => elements.length), 2);
    await page.click('[data-option="雪"]');
    assert.equal(await page.$$eval('#searchFilterPopup [aria-pressed="true"]', elements => elements.length), 1);
    await page.click('[data-option="雪"]'); await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#field_attribute', e => e.getAttribute('aria-expanded')), 'false');
    await page.click('#searchBtn');
    await page.waitForFunction(() => document.querySelector('#filterApplyState').textContent === '已应用');
    assert.equal(requests.at(-1).getAll('attribute').length, 2);
    assert.equal(await page.$eval('#resultCount', e => e.textContent), `共 ${search(requests.at(-1)).total} 张`);
    await page.type('#field_ap_min', '0'); await page.type('#field_ap_max', '0');
    assert(await page.$eval('#selectedFilters', e => e.textContent.includes('AP：0～0')));
    await page.click('[data-remove-key="ap"]');
    assert.equal(await page.$eval('#field_ap_min', e => e.value), '');
    await page.click('#clearSearchBtn');
    await page.waitForFunction(() => document.querySelector('#filterApplyState').textContent === '已应用');
    await openFilter('#field_ability');
    await page.hover('[data-open-ability="charge"]');
    await page.waitForSelector('[data-option="charge:2"]');
    await page.click('[data-option="charge:2"]');
    await page.click('[data-option="charge:1"]');
    assert.equal(await page.$$eval('#searchFilterPopup [aria-pressed="true"]', e => e.length), 2);
    await page.screenshot({ path: path.join(output, 'desktop-ability.png') });
    await page.click('[data-close]'); await page.click('#searchBtn');
    await page.waitForFunction(() => document.querySelector('#filterApplyState').textContent === '已应用');
    assert.equal(requests.at(-1).getAll('ability').length, 2);
    assert.equal(await page.$eval('#resultCount', e => e.textContent), `共 ${search(requests.at(-1)).total} 张`);
    await page.click('[data-remove-value="charge:1"]');
    assert.equal(await page.$$eval('[data-remove-key="ability"]', e => e.length), 1);
    await jump('2');
    await page.waitForFunction(() => document.querySelector('#pageJumpInput').value === '2' && !document.querySelector('#pageJumpBtn').disabled);
    assert.deepEqual(requests.at(-1).getAll('ability'), ['charge:1', 'charge:2']);
    assert(await page.$eval('#filterApplyState', e => e.textContent.startsWith('待应用')));
    await page.setViewport({ width: 390, height: 844 });
    await openFilter('#field_ability'); await page.click('[data-open-ability="penalty"]');
    await page.waitForSelector('[data-option="penalty"]');
    await page.click('[data-option="penalty"]');
    assert(await page.$eval('[data-option="penalty"]', e => e.getAttribute('aria-pressed') === 'true'));
    await page.screenshot({ path: path.join(output, 'mobile-ability.png') });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await page.$eval('#searchFilterPopup', e => { const r=e.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; }));
    await page.click('[data-close]'); await page.click('#clearSearchBtn');
    await page.waitForFunction(() => document.querySelector('#filterApplyState').textContent === '已应用');
    assert.equal(await page.$$eval('.filter-chip', e => e.length), 0);
    assert.equal(requests.at(-1).getAll('ability').length, 0);
    await page.$eval('#pageJumpForm', e => e.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(output, 'mobile-pagination.png') });
    await page.type('#field_code', 'LO-9999'); await page.click('#searchBtn');
    await page.waitForFunction(() => document.querySelector('#pageInfo').textContent === '0 页');
    assert(await page.$$eval('#prevPage, #nextPage, #lastPage, #pageJumpInput, #pageJumpBtn', elements => elements.every(e => e.disabled)));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('Search UI: filters, merged abilities, jump/last page, invalid pages, applied conditions, failure recovery, empty results and mobile viewport passed');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
