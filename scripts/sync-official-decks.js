import 'dotenv/config';
import axios from 'axios';
import pg from 'pg';
import robotsParser from 'robots-parser';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { parseOfficialList } from '../lib/official-deck-list.js';
import { parseOfficialDeck } from '../lib/deck-import.js';
import { upsertOfficial } from '../lib/community-store.js';
import { baseCode } from '../public/community-format.js';

const { values } = parseArgs({ options: { limit: { type: 'string', default: '30' }, pages: { type: 'string', default: '2' },
    code: { type: 'string' }, id: { type: 'string' }, days: { type: 'string', default: '365' }, 'dry-run': { type: 'boolean', default: false } } });
for (const key of ['limit', 'pages', 'days']) if (!/^\d+$/.test(values[key]) || Number(values[key]) < 1 || Number(values[key]) > (key === 'days' ? 3650 : 100)) throw new Error(`Invalid --${key}`);
if (values.id && !/^[A-Za-z0-9_-]{1,40}$/.test(values.id)) throw new Error('Invalid --id');
const code = values.code ? baseCode(values.code) : '';
const userAgent = 'LyceeToolboxDeckSync/1.0';
const origin = 'https://lycee-tcg.com';
let lastRequest = 0, interval = 10000, robots;
async function fetchPage(url) {
    const target = new URL(url);
    if (target.origin !== origin || (robots && robots.isAllowed(url, userAgent) === false)) throw new Error('URL forbidden by crawler policy');
    await delay(Math.max(0, interval - (Date.now() - lastRequest)));
    lastRequest = Date.now();
    const { data } = await axios.get(url, { timeout: 20000, maxRedirects: 0, maxContentLength: 2000000, responseType: 'text', headers: { 'User-Agent': userAgent } });
    return data;
}
let db, lock;
try {
    const policy = await fetchPage(origin + '/robots.txt');
    robots = robotsParser(origin + '/robots.txt', policy);
    interval = Math.max(10000, (robots.getCrawlDelay(userAgent) || 10) * 1000);
    let state = { page: 1, pending: [] };
    const stateKey = 'official-crawl:' + (code || 'recent') + ':' + values.days;
    if (!values['dry-run']) {
        const url = process.env.DATABASE_URL_UNPOOLED;
        if (!url || new URL(url).hostname.includes('-pooler')) throw new Error('Sync requires DATABASE_URL_UNPOOLED (direct connection)');
        db = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15000, statement_timeout: 15000 });
        lock = await db.connect();
        const result = await lock.query('SELECT pg_try_advisory_lock(191912, 2) AS acquired');
        if (!result.rows[0].acquired) throw new Error('Another official deck sync is already running');
        if (!values.id) state = (await db.query('SELECT value FROM toolbox_sync_state WHERE key = $1', [stateKey])).rows[0]?.value || state;
    }
    const persist = async () => {
        if (db && !values.id) await db.query(`INSERT INTO toolbox_sync_state (key, value) VALUES ($1, $2::jsonb)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`, [stateKey, JSON.stringify(state)]);
    };
    const cutoff = new Date(Date.now() - Number(values.days) * 86400000).toISOString().slice(0, 10);
    if (values.id) state.pending = [{ key: values.id, source: 'official' }];
    // Revisit page 1 each run for new submissions, then resume older pages.
    let pages = 0;
    const discover = async page => {
        const url = new URL('/deck/', origin);
        url.search = new URLSearchParams({ _festa: '1', _user: '1', limit: '100', page, ...(code ? { word: code } : {}) }).toString();
        const listing = parseOfficialList(await fetchPage(url.href), url.href);
        pages++;
        for (const entry of listing.entries) {
            if (entry.date && entry.date < cutoff) continue;
            if (state.pending.some(item => item.key === entry.key)) continue;
            const existing = db ? (await db.query('SELECT synced_at FROM toolbox_publications WHERE source_key = $1', [entry.key])).rows[0] : null;
            if (existing && Date.now() - new Date(existing.synced_at).getTime() < 7 * 86400000) continue;
            state.pending.push(entry);
        }
        const allOld = listing.entries.every(entry => entry.date && entry.date < cutoff);
        if (page === state.page) state.page = allOld ? 1 : listing.next || 1;
        await persist();
    };
    if (!values.id) {
        await discover(1);
        while (pages < Number(values.pages) && state.pending.length < Number(values.limit) && state.page > 1) await discover(state.page);
    }
    const batch = state.pending.slice(0, Number(values.limit));
    let successes = 0, failures = 0;
    for (const entry of batch) {
        try {
            const deck = parseOfficialDeck(await fetchPage(`${origin}/d/?d=${entry.key}`));
            if (code && !Object.keys(deck.cards).some(c => baseCode(c) === code)) throw new Error('Search result does not contain requested card');
            if (db) await upsertOfficial({ ...entry, deck }, db);
            state.pending = state.pending.filter(item => item.key !== entry.key);
            successes++;
            console.log(`${values['dry-run'] ? 'Validated' : 'Synced'} ${entry.key}: ${Object.keys(deck.cards).length} types, ${Object.values(deck.cards).reduce((a, b) => a + b, 0)} cards`);
        } catch (e) {
            failures++;
            // Retry on later runs without permanently blocking the queue's head.
            state.pending = [...state.pending.filter(item => item.key !== entry.key), entry];
            console.error(`Failed ${entry.key}: ${e.isAxiosError ? e.code || e.response?.status : e.message}`);
        }
        await persist();
    }
    console.log(JSON.stringify({ successes, failures, pending: state.pending.length, nextPage: state.page, dryRun: values['dry-run'] }));
    if (failures) process.exitCode = 1;
} catch (e) { console.error('Official sync failed:', e.isAxiosError ? e.code || e.response?.status : e.message); process.exitCode = 1; }
finally {
    if (lock) { await lock.query('SELECT pg_advisory_unlock(191912, 2)').catch(() => {}); lock.release(); }
    if (db) await db.end();
}
