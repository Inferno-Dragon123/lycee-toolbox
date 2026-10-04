// Opt-in touch regression checks. Local search API; community requests are fixtures.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { createServer } from '../scripts/dev-server.js';

const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ headless: true, args: ['--no-proxy-server'] });
try {
    const page = await browser.newPage(), errors = [];
    let releaseFacets;
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/auth')) return request.respond({ contentType: 'application/json', body: 'null' });
        if (url.pathname === '/api/image-proxy') return request.abort();
        if (url.pathname === '/api/community') {
            const respond = data => request.respond({ contentType: 'application/json', body: JSON.stringify(data) });
            if (url.searchParams.has('facets')) {
                releaseFacets = () => respond({ series: Array.from({ length: 40 }, (_, i) => ({ value: `TEST${i}`, label: `测试会社 ${i}` })) });
                return;
            }
            return respond(url.searchParams.has('session') ? { authenticated: false, profile: null } : { items: [], page: 1, pages: 0, total: 0, hasMore: false });
        }
        return request.continue();
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#field_attribute');
    await page.waitForSelector('#communitySeriesTrigger');
    const settle = async () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const tap = async selector => {
        await page.$eval(selector, element => element.scrollIntoView({ block: 'center' }));
        await settle();
        await page.tap(selector);
        await settle();
    };
    const expanded = selector => page.$eval(selector, element => element.getAttribute('aria-expanded'));
    const visiblePopup = () => page.$eval('#searchFilterPopup', element => !element.hidden);
    const popupFits = () => page.$eval('#searchFilterPopup', element => {
        const bounds = element.getBoundingClientRect(), viewport = window.visualViewport;
        return bounds.left >= viewport.offsetLeft && bounds.top >= viewport.offsetTop &&
            bounds.right <= viewport.offsetLeft + viewport.width && bounds.bottom <= viewport.offsetTop + viewport.height;
    });
    await page.evaluate(() => {
        window.touchCount = 0;
        document.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') window.touchCount++; });
    });

    await tap('#field_attribute');
    assert(await visiblePopup(), 'touch opening must keep the card filter open');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('filter-option-search')), false,
        'touch opening must not summon the keyboard by focusing the option search');
    await tap('.filter-option-search');
    await page.type('.filter-option-search', '雪');
    // Headless touch emulation cannot display an OS keyboard; reproduce its viewport resize explicitly.
    await page.setViewport({ width: 390, height: 520, isMobile: true, hasTouch: true });
    await settle();
    assert(await visiblePopup(), 'opening the keyboard must not dismiss the filter');
    assert.equal(await expanded('#field_attribute'), 'true');
    assert(await popupFits(), 'the filter must fit the reduced visible viewport');
    await page.evaluate(() => window.scrollBy(0, 20));
    await settle();
    assert(await visiblePopup(), 'focus-related page scrolling must not dismiss the filter');
    assert(await popupFits(), 'the filter must remain inside the visible viewport after scrolling');
    await tap('[data-option="雪"]');
    assert.equal(await page.$eval('[data-option="雪"]', element => element.getAttribute('aria-pressed')), 'true');
    assert(await visiblePopup(), 'selecting an option keeps multi-select open');
    await tap('[data-option="雪"]');
    assert.equal(await page.$eval('[data-option="雪"]', element => element.getAttribute('aria-pressed')), 'false');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await settle();
    assert(await visiblePopup(), 'closing the keyboard must not dismiss the filter');
    await tap('[data-close]');
    assert.equal(await expanded('#field_attribute'), 'false');

    await tap('#field_version');
    assert(await visiblePopup());
    await page.$eval('.filter-options', element => { element.scrollTop = 120; });
    await settle();
    assert(await visiblePopup(), 'scrolling inside card options keeps them open');
    assert(await page.$eval('.filter-options', element => element.scrollTop > 0));
    await page.tap('#field_version');
    assert.equal(await expanded('#field_version'), 'false', 'tapping the same trigger closes it');
    await tap('#field_ability');
    await tap('[data-open-ability="convert"]');
    await tap('[data-option="convert"]');
    assert.equal(await page.$eval('[data-option="convert"]', element => element.getAttribute('aria-pressed')), 'true');
    assert(await visiblePopup(), 'touch ability cascades keep the filter open');
    await tap('#field_q');
    assert.equal(await expanded('#field_ability'), 'false', 'outside touch dismisses card filters');

    await tap('#communitySeriesTrigger');
    assert.equal(await expanded('#communitySeriesTrigger'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('community-filter-option')), false);
    await releaseFacets();
    await page.waitForSelector('[data-deck-filter="series"][data-value="TEST0"]');
    assert.equal(await expanded('#communitySeriesTrigger'), 'true', 'late facet responses preserve the open menu');
    assert.equal(await page.$eval('#communitySeriesOptions', element => element.hidden), false);
    await page.setViewport({ width: 390, height: 760, isMobile: true, hasTouch: true });
    await settle();
    assert.equal(await expanded('#communitySeriesTrigger'), 'true');
    await tap('[data-deck-filter="series"][data-value="TEST0"]');
    assert.equal(await page.$eval('[data-deck-filter="series"][data-value="TEST0"]', element => element.getAttribute('aria-pressed')), 'true');
    assert.equal(await expanded('#communitySeriesTrigger'), 'true');
    await tap('[data-deck-filter="series"][data-value="TEST0"]');
    assert.equal(await page.$eval('[data-deck-filter="series"][data-value="TEST0"]', element => element.getAttribute('aria-pressed')), 'false');
    await page.$eval('#communitySeriesOptions', element => { element.scrollTop = 120; });
    await settle();
    assert.equal(await expanded('#communitySeriesTrigger'), 'true', 'scrolling inside community options keeps them open');
    assert(await page.$eval('#communitySeriesOptions', element => element.scrollTop > 0));
    await tap('#communityAttributeTrigger');
    assert.equal(await expanded('#communitySeriesTrigger'), 'false', 'switching community filters closes the previous menu');
    assert.equal(await expanded('#communityAttributeTrigger'), 'true');
    await tap('[data-deck-filter="attribute"][data-value="雪"]');
    assert.equal(await expanded('#communityAttributeTrigger'), 'true');
    await tap('#communityDeckTypeTrigger');
    await tap('[data-deck-filter="deckType"][data-value="single"]');
    assert.equal(await expanded('#communityDeckTypeTrigger'), 'true');
    await tap('#communitySource');
    assert.equal(await expanded('#communityDeckTypeTrigger'), 'false', 'outside touch dismisses community filters');
    // Native selects have no custom dismissal handlers. Verify both remain usable on the touch page.
    await page.select('#communitySource', 'community');
    assert.equal(await page.$eval('#communitySource', element => element.value), 'community');
    await tap('#recommendMatch');
    await page.select('#recommendMatch', 'any');
    assert.equal(await page.$eval('#recommendMatch', element => element.value), 'any');
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => window.touchCount > 15), 'the checks must dispatch genuine touch pointer events');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    await page.setViewport({ width: 1400, height: 1000, isMobile: false, hasTouch: false });
    await page.waitForSelector('#field_attribute');
    await page.$eval('#field_attribute', element => element.scrollIntoView({ block: 'center' }));
    await settle();
    await page.focus('#field_attribute');
    await page.keyboard.press('Enter');
    assert(await visiblePopup());
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('filter-option-search')), true,
        'keyboard activation still focuses the option search');
    await page.keyboard.press('Escape');
    assert.equal(await expanded('#field_attribute'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'field_attribute');
    await page.$eval('#communityDeckTypeTrigger', element => element.scrollIntoView({ block: 'center' }));
    await settle();
    await page.focus('#communityDeckTypeTrigger');
    await page.keyboard.press('Enter');
    assert.equal(await expanded('#communityDeckTypeTrigger'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('community-filter-option')), true);
    await page.keyboard.press('Escape');
    assert.equal(await expanded('#communityDeckTypeTrigger'), 'false');
    assert.deepEqual(errors, []);
    console.log('Mobile dropdown touch checks passed: focus, keyboard viewport resize, delayed facets, multi-select, abilities, scrolling, outside dismissal, native selects and desktop keyboard access');
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
