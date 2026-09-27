// Opt-in end-to-end test: uses the running local server and its Neon development DB.
// Run: node tests/browser-smoke.js
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const output = path.resolve('temp/migration/browser');
await fs.mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-proxy-server'] });
const failures = [], upstreamRequests = [];
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1050 });
    page.on('pageerror', e => failures.push(e.message));
    page.on('request', req => { if (req.url().includes('moetcg.club')) upstreamRequests.push(req.url()); });
    // Observe the actual download blobs, independent of native download-manager hooks.
    await page.evaluateOnNewDocument(() => {
        window.testBlobs = new Map(); window.testDownloads = [];
        const create = URL.createObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); window.testBlobs.set(url, blob); return url; };
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
            if (this.download) window.testDownloads.push({ name: this.download, url: this.href });
            return click.call(this);
        };
    });
    async function downloaded(name, binary = false) {
        await page.waitForFunction(name => window.testDownloads.some(d => d.name === name), {}, name);
        const data = await page.evaluate(async ({ name, binary }) => {
            const entry = window.testDownloads.find(d => d.name === name), blob = window.testBlobs.get(entry.url);
            if (!binary) return blob.text();
            return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
        }, { name, binary });
        return binary ? Buffer.from(data, 'base64') : data;
    }
    const session = await page.createCDPSession();
    await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output });
    await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.search-card');
    assert.match(await page.$eval('#resultCount', e => e.textContent), /9952/);
    await page.type('#field_code', 'LO-6826');
    await page.click('#searchBtn');
    await page.waitForFunction(() => document.querySelector('#resultCount').textContent === '共 2 张');
    assert.equal(await page.$$eval('.search-card', e => e.length), 2);
    await page.click('.search-card [data-delta="1"]');
    assert.equal(await page.$eval('#deckTotal', e => e.textContent), '1 张');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#statusDisplay').textContent.includes('已恢复本机草稿'));
    assert.equal(await page.$eval('#deckTotal', e => e.textContent), '1 张');

    await page.type('#loadDeckInput', 'https://lycee-tcg.com/d/?d=k0PjKL');
    await page.click('#loadDeckBtn');
    await page.waitForFunction(() => /已加载|加载失败/.test(document.querySelector('#statusDisplay').textContent), { timeout: 30000 });
    assert.equal(await page.$eval('#deckTotal', e => e.textContent), '60 张', await page.$eval('#statusDisplay', e => e.textContent));
    assert.equal(await page.$eval('#deckNameInput', e => e.value), 'WP日');
    assert.equal(await page.$$eval('.deck-item', e => e.length), 17);
    // The test writes an explicitly named snapshot only to the development database.
    await page.$eval('#deckNameInput', e => { e.value = '开发验证 WP日'; e.dispatchEvent(new Event('input')); });
    await page.click('#saveDeckBtn');
    await page.waitForFunction(() => /卡组已保存|保存失败/.test(document.querySelector('#statusDisplay').textContent), { timeout: 25000 });
    const href = await page.$eval('#shareInfo a', e => e.href);
    assert.match(href, /\?deck=d_/);
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#deckTotal').textContent === '60 张', { timeout: 25000 });
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });

    const pdfResponse = page.waitForResponse(r => r.url().endsWith('/api/generate-pdf') && r.request().method() === 'POST', { timeout: 60000 });
    await page.click('#exportPdfBtn');
    const pdf = await pdfResponse;
    assert.equal(pdf.status(), 200);
    await page.waitForFunction(() => /PDF.*已导出|PDF 下载|PDF 生成/.test(document.querySelector('#statusDisplay').textContent) && !document.querySelector('#exportPdfBtn').disabled, { timeout: 60000 });
    const buffer = await downloaded('开发验证 WP日.pdf', true);
    assert(buffer.toString('ascii', 0, 5).startsWith('%PDF-'));
    await fs.writeFile(path.join(output, 'official-deck.pdf'), buffer);
    await page.click('#exportTtsBtn');
    await page.click('#exportJsonBtn');
    const ttsText = await downloaded('开发验证 WP日-tts.json');
    const tts = JSON.parse(ttsText);
    await fs.writeFile(path.join(output, 'official-deck-tts.json'), ttsText);
    assert.equal(tts.ObjectStates[0].ContainedObjects.length, 60);
    const deckFile = path.join(output, '开发验证 WP日.lycee.json');
    const deckText = await downloaded('开发验证 WP日.lycee.json');
    await fs.writeFile(deckFile, deckText);
    const exported = JSON.parse(deckText);
    assert.equal(Object.keys(exported.cards).length, 17);
    await page.click('#clearDeckBtn');
    await (await page.$('#deckFileInput')).uploadFile(deckFile);
    await page.waitForFunction(() => document.querySelector('#deckTotal').textContent === '60 张');
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile overflow');
    assert.deepEqual(upstreamRequests, [], 'normal app flow contacted Moetcg');
    assert.deepEqual(failures, [], 'browser exceptions');
    console.log(JSON.stringify({ savedDeck: new URL(href).searchParams.get('deck'), officialUnique: 17, total: 60,
        pdfBytes: buffer.length, missingImages: pdf.headers()['x-missing-images'], browserErrors: failures.length, moetcgRequests: upstreamRequests.length }));
} finally { await browser.close(); }
