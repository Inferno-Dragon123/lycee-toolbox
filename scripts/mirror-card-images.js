import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import axios from 'axios';
import robotsParser from 'robots-parser';
import sharp from 'sharp';
import { SOURCE_ORIGIN, CARD_BACK_SOURCE, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS,
    imageStorageDirectory, imageRelativePath, imageKeyForSource, inspectImage, readStoredImage } from '../lib/card-images.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const USER_AGENT = 'LyceeToolboxImageMirror/1.0';
const hash = buffer => createHash('sha256').update(buffer).digest('hex');

export async function atomicStore(file, buffer) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.' + randomBytes(8).toString('hex') + '.tmp';
    try { await fs.writeFile(temporary, buffer, { flag: 'wx', mode: 0o640 }); await fs.rename(temporary, file); }
    finally { await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
async function saveState(directory, state) {
    await atomicStore(path.join(directory, '.mirror-state.json'), Buffer.from(JSON.stringify(state, null, 2) + '\n'));
}
async function loadState(directory) {
    try {
        const value = JSON.parse(await fs.readFile(path.join(directory, '.mirror-state.json'), 'utf8'));
        if (value.schemaVersion !== 1 || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) throw new Error('Invalid image mirror state');
        return value;
    } catch (e) { if (e.code !== 'ENOENT') throw e; return { schemaVersion: 1, entries: {}, lastRequestAt: 0 }; }
}
async function acquireLock(directory) {
    const file = path.join(directory, '.mirror.lock');
    const token = randomBytes(16).toString('hex');
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const handle = await fs.open(file, 'wx', 0o640);
            await handle.writeFile(JSON.stringify({ pid: process.pid, host: os.hostname(), token, startedAt: new Date().toISOString() }));
            await handle.close();
            return async () => {
                const current = JSON.parse(await fs.readFile(file, 'utf8'));
                if (current.token === token) await fs.unlink(file);
            };
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            const owner = JSON.parse(await fs.readFile(file, 'utf8'));
            if (owner.host !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('Another image mirror owns the lock');
            try { process.kill(owner.pid, 0); throw new Error('Another image mirror is running'); }
            catch (check) { if (check.code !== 'ESRCH') throw check; }
            await fs.unlink(file);
        }
    }
    throw new Error('Could not acquire image mirror lock');
}
export function createOfficialClient({ state, persist, delay = 10000, retries = 3, timeout = 45000,
    now = Date.now, wait = sleep, request = async (url, image) => axios.get(url, {
        timeout, maxRedirects: 0, maxContentLength: image ? MAX_IMAGE_BYTES : 1000000,
        responseType: image ? 'arraybuffer' : 'text', headers: { 'User-Agent': USER_AGENT, Referer: SOURCE_ORIGIN + '/' }
    }) } = {}) {
    if (!Number.isFinite(delay) || delay < 10000 || !Number.isInteger(retries) || retries < 1 || retries > 5) throw new Error('Image requests require at least 10 seconds between starts and 1–5 retries');
    let robots, interval = delay;
    async function get(url, image) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            const pause = interval - (now() - (state.lastRequestAt || 0));
            if (pause > 0) await wait(pause);
            state.lastRequestAt = now();
            await persist(); // The interval survives interruption and a new process.
            try {
                const response = await request(url, image);
                if (response.status && (response.status < 200 || response.status >= 300)) throw Object.assign(new Error('Unexpected HTTP status'), { response });
                return response;
            } catch (e) {
                const status = e.response?.status;
                if (attempt === retries || (status && status < 500 && ![408, 429].includes(status))) throw e;
                const retryAfter = e.response?.headers?.['retry-after'];
                const retryMs = /^\d+$/.test(retryAfter || '') ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now();
                if (retryMs > 0) await wait(retryMs);
            }
        }
    }
    return {
        async getImage(url) {
            imageKeyForSource(url);
            if (!robots) {
                const policy = await get(SOURCE_ORIGIN + '/robots.txt', false);
                robots = robotsParser(SOURCE_ORIGIN + '/robots.txt', String(policy.data));
                interval = Math.max(delay, 10000, (robots.getCrawlDelay(USER_AGENT) || 0) * 1000);
            }
            if (robots.isAllowed(url, USER_AGENT) === false) throw new Error('Official robots.txt forbids this image');
            const response = await get(url, true);
            if (response.headers?.['content-type'] && !/^image\/png(?:;|$)/i.test(response.headers['content-type'])) throw new Error('Official image response is not PNG');
            return Buffer.from(response.data);
        }
    };
}
export async function verifiedEntry(directory, code, entry, sourceUrl) {
    if (entry?.sourceUrl !== sourceUrl || !entry.sha256 || !entry.thumbSha256) return false;
    try {
        const original = await readStoredImage(code, 'original', { directory });
        const thumbnail = await readStoredImage(code, 'thumb', { directory });
        return Boolean(original && thumbnail && hash(original.buffer) === entry.sha256 && original.buffer.length === entry.bytes &&
            hash(thumbnail.buffer) === entry.thumbSha256 && thumbnail.buffer.length === entry.thumbBytes && entry.width >= 32 && entry.height >= 32);
    } catch { return false; }
}
export async function mirrorImages({ directory, catalog, limit = 100, all = false, dryRun = false,
    refreshCodes = [], refreshAll = false, refreshRevision, retryNow = false, delay = 10000, retries = 3, timeout = 45000,
    now = Date.now, clientFactory = createOfficialClient, log = console.log } = {}) {
    if (!directory || !path.isAbsolute(directory)) throw new Error('Set an absolute IMAGE_STORAGE_DIR');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20000 || delay < 10000) throw new Error('Invalid limit or delay (minimum 10 seconds)');
    if ((refreshAll || refreshCodes.length) && !/^[A-Za-z0-9._-]{1,80}$/.test(refreshRevision || '')) throw new Error('Explicit refresh requires --refresh-revision (a stable revision name for resume)');
    const sources = new Map();
    for (const card of catalog.cards) {
        if (imageKeyForSource(card.img) !== card.code) throw new Error('Catalog image does not match full card code: ' + card.code);
        sources.set(card.code, card.img);
    }
    sources.set('card-back', CARD_BACK_SOURCE);
    if (refreshCodes.some(code => !sources.has(code))) throw new Error('Unknown --refresh-code');
    const refresh = new Set(refreshCodes);
    let release;
    if (!dryRun) { await fs.mkdir(directory, { recursive: true }); release = await acquireLock(directory); }
    try {
        const state = await loadState(directory);
        const report = { total: sources.size, verified: 0, downloaded: 0, failed: 0, deferred: 0, pending: 0, planned: 0, dryRun };
        const persist = () => saveState(directory, state);
        const client = dryRun ? null : clientFactory({ state, persist, delay, retries, timeout, now });
        let processed = 0;
        for (const [code, sourceUrl] of sources) {
            const entry = state.entries[code];
            const refreshNeeded = (refreshAll || refresh.has(code)) && entry?.refreshRevision !== refreshRevision;
            if (!refreshNeeded && entry?.status === 'verified' && await verifiedEntry(directory, code, entry, sourceUrl)) { report.verified++; continue; }
            if (!retryNow && entry?.retryAt && Date.parse(entry.retryAt) > now()) { report.deferred++; continue; }
            if (!all && processed >= limit) { report.pending++; continue; }
            processed++; report.planned++;
            if (dryRun) continue;
            try {
                const original = await client.getImage(sourceUrl);
                const info = await inspectImage(original, code);
                const thumb = await sharp(original, { limitInputPixels: MAX_IMAGE_PIXELS }).resize({ width: 320, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
                await atomicStore(path.join(directory, imageRelativePath(code)), original);
                await atomicStore(path.join(directory, imageRelativePath(code, 'thumb')), thumb);
                state.entries[code] = { status: 'verified', sourceUrl, ...info, thumbSha256: hash(thumb), thumbBytes: thumb.length,
                    verifiedAt: new Date(now()).toISOString(), ...(refreshNeeded ? { refreshRevision } : entry?.refreshRevision ? { refreshRevision: entry.refreshRevision } : {}) };
                report.downloaded++;
                log(`Mirrored ${code}: ${info.bytes} bytes, ${info.width}x${info.height}`);
            } catch (e) {
                const attempts = (entry?.attempts || 0) + 1;
                state.entries[code] = { ...entry, status: 'failed', sourceUrl, attempts,
                    retryAt: new Date(now() + Math.min(86400000, 3600000 * 2 ** Math.min(attempts - 1, 5))).toISOString(),
                    error: String(e.response?.status || e.code || e.message).slice(0, 300) };
                report.failed++;
                log(`Failed ${code}: ${state.entries[code].error}`);
            }
            await persist();
        }
        if (!dryRun) { state.lastRun = { ...report, completedAt: new Date(now()).toISOString() }; await persist(); }
        return report;
    } finally { if (release) await release(); }
}
export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({ args, options: {
        catalog: { type: 'string', default: path.join(root, 'data/catalog.json') }, directory: { type: 'string' },
        limit: { type: 'string', default: '100' }, all: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
        delay: { type: 'string', default: '10' }, retries: { type: 'string', default: '3' }, timeout: { type: 'string', default: '45' },
        'refresh-code': { type: 'string', multiple: true }, 'refresh-all': { type: 'boolean' },
        'refresh-revision': { type: 'string' }, 'retry-now': { type: 'boolean' }
    } });
    for (const name of ['limit', 'delay', 'retries', 'timeout']) if (!/^\d+$/.test(values[name])) throw new Error('Invalid --' + name);
    const catalog = JSON.parse(await fs.readFile(values.catalog, 'utf8'));
    const report = await mirrorImages({ catalog, directory: values.directory || imageStorageDirectory(), limit: Number(values.limit),
        all: values.all, dryRun: values['dry-run'], delay: Number(values.delay) * 1000,
        retries: Number(values.retries), timeout: Number(values.timeout) * 1000,
        refreshCodes: values['refresh-code'] || [], refreshAll: values['refresh-all'], refreshRevision: values['refresh-revision'], retryNow: values['retry-now'] });
    console.log(JSON.stringify(report));
    return report.failed ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().then(code => { process.exitCode = code; }).catch(e => { console.error('Image mirror failed:', e.message); process.exitCode = 1; });
}
