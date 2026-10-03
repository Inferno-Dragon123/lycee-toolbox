// Opt-in: real local PostgreSQL queries and UI, without cloud writes or email.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from '../scripts/dev-server.js';
import { communityHandler } from '../api/community.js';
import { publicationInput } from '../public/community-format.js';
import { createPublication, updatePublication, upsertOfficial, listPublications, getPublication } from '../lib/community-store.js';

const pg = new PGlite();
const db = {
    async query(sql, params) { return sql.includes('pg_advisory_xact_lock') ? { rows: [] } : pg.query(sql, params); },
    async connect() { return { query: this.query, release() {} }; }
};
const owner = { id: 'browser-test', emailVerified: true };
let server, browser;
try {
    const migrationDir = new URL('../migrations/', import.meta.url);
    for (const file of (await fs.readdir(migrationDir)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
        await pg.exec(await fs.readFile(new URL(file, migrationDir), 'utf8'));
    }
    for (let i = 0; i < 24; i++) {
        await upsertOfficial({ key: `browser-flower-${i}`, source: 'official_user',
            deck: publicationInput({ name: `官网花单 ${i + 1}`, cards: { 'LO-6000': 60 } }).deck }, db);
    }
    for (let i = 0; i < 4; i++) {
        await createPublication(owner, publicationInput({ name: `混成 ${i + 1}`, cards: { 'LO-4000': 30, 'LO-6000': 30 } }), db);
    }
    await createPublication(owner, publicationInput({ name: '雪单', cards: { 'LO-4000': 60 } }), db);
    const hidden = await createPublication(owner, publicationInput({ name: '已下架花单', cards: { 'LO-6000': 60 } }), db);
    await updatePublication(owner, hidden.id, 1, 'unpublish', null, db);

    const handler = communityHandler({ identify: async () => null, store: {
        listPublications: params => listPublications(params, db), getPublication: (id, user) => getPublication(id, user, db)
    } });
    server = createServer();
    const staticHandler = server.listeners('request')[0];
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
        if (new URL(req.url, 'http://localhost').pathname !== '/api/community') return staticHandler(req, res);
        res.status = code => { res.statusCode = code; return res; };
        res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
        return handler(req, res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const query = async params => {
        const response = await fetch(`${origin}/api/community?${params}`);
        assert.equal(response.status, 200);
        return response.json();
    };
    const all = await query('page=1');
    assert.equal(all.total, 29); assert.equal(all.pages, 2); assert.equal(all.items.length, 20);
    assert(!all.items.some(item => item.id === hidden.id));
    assert.equal((await query('codes=LO-4000,LO-6000&match=all')).total, 4);
    assert.equal((await query('codes=LO-4000,LO-6000&match=any')).total, 29);

    const output = path.resolve('temp/community');
    await fs.mkdir(output, { recursive: true });
    browser = await puppeteer.launch({ headless: true, args: ['--no-proxy-server'] });
    const page = await browser.newPage(), errors = [], requests = [];
    let holdNext = false, releaseHeld;
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/auth')) return request.respond({ contentType: 'application/json', body: 'null' });
        if (url.pathname === '/api/image-proxy') return request.abort();
        if (url.pathname === '/api/community' && !['facets', 'session', 'id'].some(key => url.searchParams.has(key))) {
            requests.push(url.searchParams);
            if (holdNext) { holdNext = false; new Promise(resolve => { releaseHeld = resolve; }).then(() => request.continue()); return; }
        }
        return request.continue();
    });
    await page.setViewport({ width: 1400, height: 1000 });
    await page.goto(origin, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.community-item');
    const settled = async () => page.waitForFunction(() => !document.querySelector('#communityPageJump').disabled && !document.querySelector('#communityStatus').textContent.includes('正在'));
    const click = async selector => {
        await page.$eval(selector, element => element.scrollIntoView({ block: 'center' }));
        await page.click(selector);
    };
    const fill = async (selector, value) => page.$eval(selector, (element, text) => {
        element.value = text; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    const search = async () => { await click('#showRecommendations'); await settled(); };
    const clear = async () => { await click('#communityClearFilters'); await settled(); };
    const jump = async (value, enter = false) => {
        await fill('#communityPageInput', value);
        if (enter) { await page.focus('#communityPageInput'); await page.keyboard.press('Enter'); }
        else await click('#communityPageJump');
    };
    assert.equal(await page.$eval('#communityPageInput', element => element.max), '2');
    assert.equal(await page.$$eval('.community-item', elements => elements.length), 20);
    assert(await page.$eval('.community-item', element => element.textContent.includes('雪：') && element.textContent.includes('花：')));
    assert.equal(await page.$eval('#communitySelectedFilters', element => element.textContent), '暂无筛选条件');
    assert(await page.$$eval('.community-title[href^="https://lycee-tcg.com/d/"]', elements => elements.length > 0 && elements.every(element => element.target === '_blank' && element.relList.contains('noopener') && element.relList.contains('noreferrer'))));
    assert(await page.$$eval('.community-title', elements => elements.some(element => element.href.includes('/?publication=') && !element.target)));
    assert(await page.$$eval('.community-item', elements => elements.every(element => !element.textContent.includes('官网原链接') && element.querySelectorAll('a').length === 1 && element.querySelector('[data-action="preview"]') && element.querySelector('[data-action="import"]'))));

    holdNext = true;
    await click('#communityLast');
    await page.waitForFunction(() => document.querySelector('#communityPageJump').disabled);
    assert(await page.$$eval('#communityPrev,#communityNext,#communityLast,#communityPageInput,#communityPageJump', elements => elements.every(element => element.disabled)));
    releaseHeld(); await settled();
    assert.equal(requests.at(-1).get('page'), '2');
    assert.equal(await page.$$eval('.community-item', elements => elements.length), 9);
    assert(await page.$eval('#communityLast', element => element.disabled));
    const beforeInvalid = requests.length;
    for (const value of ['', '0', '2.5', '3']) {
        await jump(value);
        assert(await page.$eval('#communityStatus', element => element.textContent.includes('请输入 1～2 的整数页码')));
    }
    assert.equal(requests.length, beforeInvalid);
    await jump('1', true); await settled();
    assert.equal(requests.at(-1).get('page'), '1');

    await click('#communityDeckTypeTrigger');
    await click('[data-deck-filter="deckType"][data-value="single"]');
    await click('[data-deck-filter="deckType"][data-value="mix"]');
    assert.equal(await page.$$eval('[data-deck-filter="deckType"][aria-pressed="true"]', elements => elements.length), 2);
    assert.equal(await page.$$eval('[data-remove-community-filter="deckType"]', elements => elements.length), 2);
    await page.keyboard.press('Escape');
    await click('[data-remove-community-filter="deckType"][data-value="mix"]');
    assert.equal(await page.$$eval('[data-deck-filter="deckType"][aria-pressed="true"]', elements => elements.length), 1);
    await search();
    assert.equal((await query(requests.at(-1))).total, 25);
    assert.equal(await page.$$eval('.community-item', elements => elements.length), 20);
    // Editing a draft condition must not alter subsequent pagination requests.
    const beforeDraft = requests.length;
    await page.select('#communitySource', 'community');
    assert.equal(requests.length, beforeDraft);
    assert.equal(await page.$eval('[data-remove-community-filter="source"]', element => element.textContent), '来源：本站投稿×');
    assert(await page.$eval('#communitySelectedFiltersHint', element => element.textContent.includes('上次检索条件')));
    await click('#communityLast'); await settled();
    assert.equal(requests.at(-1).get('source'), null);
    assert.equal((await query(requests.at(-1))).total, 25);
    assert(await page.$eval('#communityFilterState', element => element.textContent.includes('待检索')));
    assert(await page.$('[data-remove-community-filter="source"]'));
    await search();
    assert.equal((await query(requests.at(-1))).total, 1);
    assert.equal(await page.$$eval('.community-item', elements => elements.length), 1);
    assert(await page.$eval('#communityFilterState', element => element.textContent.includes('已应用')));
    const beforeRemoveSource = requests.length;
    await click('[data-remove-community-filter="source"]');
    assert.equal(requests.length, beforeRemoveSource);
    assert.equal(await page.$eval('#communitySource', element => element.value), '');
    await clear();
    assert.equal(await page.$eval('#communitySelectedFilters', element => element.textContent), '暂无筛选条件');

    await click('#communitySeriesTrigger');
    await click('[data-deck-filter="series"][data-value="NAV"]');
    await click('[data-deck-filter="series"][data-value="AL"]');
    assert.equal(await page.$$eval('[data-deck-filter="series"][aria-pressed="true"]', elements => elements.length), 2);
    assert.equal(await page.$$eval('[data-remove-community-filter="series"]', elements => elements.length), 2);
    await page.keyboard.press('Escape'); await search();
    assert.equal((await query(requests.at(-1))).total, 25);
    await clear();

    await click('#communityAttributeTrigger');
    await click('[data-deck-filter="attribute"][data-value="雪"]');
    await page.keyboard.press('Escape'); await search();
    assert.equal((await query(requests.at(-1))).total, 5);
    await click('[data-remove-community-filter="attribute"][data-value="雪"]');
    assert.equal(await page.$eval('[data-deck-filter="attribute"][data-value="雪"]', element => element.getAttribute('aria-pressed')), 'false');
    await clear();
    await click('.community-range-details summary');
    await fill('#communityAttr雪min', '0'); await fill('#communityAttr雪max', '0');
    await search();
    assert.equal((await query(requests.at(-1))).total, 24);
    assert.equal(requests.at(-1).get('attr_雪_min'), '0');
    assert.equal(requests.at(-1).get('attr_雪_max'), '0');
    assert.equal(await page.$eval('[data-remove-community-filter="range"][data-value="雪"]', element => element.textContent), '雪数量：0～0×');
    await click('[data-remove-community-filter="range"][data-value="雪"]');
    assert(await page.$$eval('#communityAttr雪min,#communityAttr雪max', elements => elements.every(element => element.value === '')));
    await clear();

    await fill('#recommendCodesInput', 'LO-4000, LO-6000');
    await page.$eval('#recommendForm', element => element.requestSubmit());
    await search();
    assert.equal((await query(requests.at(-1))).total, 4);
    assert.equal(requests.at(-1).get('match'), 'all');
    assert.equal(await page.$$eval('[data-remove-community-filter="code"]', elements => elements.length), 2);
    assert.equal(await page.$eval('.community-filter-chip-static', element => element.textContent), '匹配方式：全部包含');
    await page.select('#recommendMatch', 'any'); await search();
    assert.equal((await query(requests.at(-1))).total, 29);
    assert.equal(await page.$eval('[data-remove-community-filter="match"]', element => element.textContent), '匹配方式：任意包含×');
    await click('[data-remove-community-filter="match"]');
    assert.equal(await page.$eval('#recommendMatch', element => element.value), 'all');
    await click('#communityRefresh'); await settled();
    assert.equal(requests.at(-1).get('match'), 'any');
    assert(await page.$eval('#communityFilterState', element => element.textContent.includes('待检索')));
    await search();
    assert.equal((await query(requests.at(-1))).total, 4);
    await click('[data-remove-community-filter="code"][data-value="LO-4000"]');
    assert.equal(await page.$eval('#recommendCount', element => element.textContent), '1 / 10');
    assert.equal(await page.$$eval('[data-remove-recommend]', elements => elements.length), 1);
    await page.screenshot({ path: path.join(output, 'deck-search-desktop.png') });
    await clear();

    await fill('#recommendCodesInput', 'LO-0001');
    await page.$eval('#recommendForm', element => element.requestSubmit());
    await click('#showRecommendations');
    await page.waitForFunction(() => document.querySelector('#communityResults').textContent.includes('暂无'));
    assert.equal((await query(requests.at(-1))).total, 0);
    assert(await page.$$eval('#communityPrev,#communityNext,#communityLast,#communityPageInput,#communityPageJump', elements => elements.every(element => element.disabled)));
    await clear();

    await page.setViewport({ width: 390, height: 844 });
    await page.select('#communitySource', 'official_user');
    await fill('#recommendCodesInput', 'LO-4000, LO-6000');
    await page.$eval('#recommendForm', element => element.requestSubmit());
    await click('#communityDeckTypeTrigger');
    await click('[data-deck-filter="deckType"][data-value="single"]');
    await page.keyboard.press('Escape');
    await fill('#communityAttr雪min', '0'); await fill('#communityAttr雪max', '60');
    assert(await page.$$eval('#communitySelectedFilters .community-filter-chip', elements => elements.length === 6 && elements.every(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth; })));
    await click('[data-remove-community-filter="code"][data-value="LO-4000"]');
    assert.equal(await page.$eval('#recommendCount', element => element.textContent), '1 / 10');
    await click('#communitySeriesTrigger');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await page.$eval('#communitySeriesOptions', element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth; }));
    await page.keyboard.press('Escape');
    await page.$('#recommendControls').then(element => element.screenshot({ path: path.join(output, 'deck-search-mobile.png') }));
    assert.deepEqual(errors, []);
    console.log('Deck search SQL + UI: selected filter chips and removal, official title links, composition, multi-select, counts, cards all/any, hidden exclusion, last/jump/invalid/empty pages, applied condition snapshot and mobile viewport passed');
} finally {
    if (browser) await browser.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await pg.close();
}
