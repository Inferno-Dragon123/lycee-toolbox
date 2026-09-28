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
import { queueEntries, dueEntries, failEntry } from '../lib/official-sync-state.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const { values } = parseArgs({ options: { limit: { type: 'string', default: '30' }, pages: { type: 'string', default: '2' },
    code: { type: 'string' }, id: { type: 'string' }, days: { type: 'string', default: '365' },
    report: { type: 'string', default: 'temp/community/official-sync-report.json' },
    'dry-run': { type: 'boolean', default: false } } });
for (const key of ['limit', 'pages', 'days']) if (!/^\d+$/.test(values[key]) || Number(values[key]) < (key === 'days' ? 0 : 1) || Number(values[key]) > (key === 'days' ? 3650 : 100)) throw new Error(`Invalid --${key}`);
if (values.id && !/^[A-Za-z0-9_-]{1,40}$/.test(values.id)) throw new Error('Invalid --id');
const code = values.code ? baseCode(values.code) : '';
const userAgent = 'LyceeToolboxDeckSync/1.0';
const origin = 'https://lycee-tcg.com';
let lastRequest = 0, interval = 10000, robots;
async function fetchPage(url) {
    const target = new URL(url);
    if (target.origin !== origin || (robots && robots.isAllowed(url, userAgent) === false)) throw new Error('URL forbidden by crawler policy');
    for (let attempt = 1; attempt <= 3; attempt++) {
        await delay(Math.max(0, interval - (Date.now() - lastRequest)));
        lastRequest = Date.now();
        try {
            const { data } = await axios.get(url, { timeout: 20000, maxRedirects: 0, maxContentLength: 2000000, responseType: 'text', headers: { 'User-Agent': userAgent } });
            return data;
        } catch (e) {
            const status = e.response?.status;
            if (attempt === 3 || (status && status < 500 && ![408, 429].includes(status))) throw e;
            const retryAfter = e.response?.headers?.['retry-after'];
            const retryMs = /^\d+$/.test(retryAfter || '') ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
            if (retryMs > 0) await delay(Math.min(retryMs, 120000));
        }
    }
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
    const cutoff = Number(values.days) ? new Date(Date.now() - Number(values.days) * 86400000).toISOString().slice(0, 10) : '';
    if (values.id) state.pending = [{ key: values.id, source: 'official' }];
    // Revisit page 1 each run for new submissions, then resume older pages.
    let pages = 0;
    const discover = async page => {
        const url = new URL('/deck/', origin);
        url.search = new URLSearchParams({ _festa: '1', _user: '1', limit: '100', page, ...(code ? { word: code } : {}) }).toString();
        const listing = parseOfficialList(await fetchPage(url.href), url.href);
        pages++;
        const entries = listing.entries.filter(entry => !entry.date || entry.date >= cutoff);
        const existing = new Map(db ? (await db.query('SELECT source_key, synced_at FROM toolbox_publications WHERE source_key = ANY($1::text[])',
            [entries.map(entry => entry.key)])).rows.map(row => [row.source_key, row.synced_at]) : []);
        queueEntries(state, entries, existing);
        const allOld = cutoff && listing.entries.every(entry => entry.date && entry.date < cutoff);
        if (page === state.page) state.page = allOld ? 1 : listing.next || 1;
        await persist();
    };
    if (!values.id) {
        await discover(1);
        while (pages < Number(values.pages) && dueEntries(state, Number(values.limit)).length < Number(values.limit) && state.page > 1) await discover(state.page);
    }
    const batch = dueEntries(state, Number(values.limit));
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
            const message = e.isAxiosError ? e.response?.status || e.code : e.message;
            failEntry(state, entry, message);
            console.error(`Failed ${entry.key}: ${message}`);
        }
        await persist();
    }
    const report = { completedAt: new Date().toISOString(), successes, failures, pages,
        pending: state.pending.length, nextPage: state.page, days: Number(values.days), dryRun: values['dry-run'],
        retrying: state.pending.filter(entry => entry.attempts).map(({ key, attempts, retryAt, error }) => ({ key, attempts, retryAt, error })) };
    state.lastRun = report;
    await persist();
    await mkdir(dirname(values.report), { recursive: true });
    await writeFile(values.report, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    if (failures) process.exitCode = 1;
} catch (e) { console.error('Official sync failed:', e.isAxiosError ? e.code || e.response?.status : e.message); process.exitCode = 1; }
finally {
    if (lock) { await lock.query('SELECT pg_advisory_unlock(191912, 2)').catch(() => {}); lock.release(); }
    if (db) await db.end();
}
