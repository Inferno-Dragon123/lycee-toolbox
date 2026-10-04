import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { CARD_BACK_SOURCE, withCardImageUrls, parseImagePath, imageKeyForSource, inspectImage, readStoredImage } from '../lib/card-images.js';
import { createOfficialClient, mirrorImages, atomicStore, acquireMirrorLock } from '../scripts/mirror-card-images.js';
import { downloadImages } from '../lib/pdf.js';
import { makeTts } from '../public/deck-format.js';
import { imageProxyHandler } from '../api/image-proxy.js';

const source = 'https://lycee-tcg.com/card/image/LO-6826-A.png';
const card = { code: 'LO-6826-A', img: source, name: '异画' };
const png = () => sharp({ create: { width: 126, height: 176, channels: 3, background: '#234567' } }).png().toBuffer();
async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lycee-images-'));
    t.after(async () => {
        assert(directory.startsWith(path.join(os.tmpdir(), 'lycee-images-')));
        await fs.rm(directory, { recursive: true, force: true });
    });
    return directory;
}

test('mirror recovery handles reused PIDs after reboot while excluding a live worker', async t => {
    const directory = await fixture(t), file = path.join(directory, '.mirror.lock');
    await fs.writeFile(file, JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'previous', bootId: 'previous-boot' }));
    const release = await acquireMirrorLock(directory, { bootId: 'current-boot' });
    await assert.rejects(acquireMirrorLock(directory, { bootId: 'current-boot' }), /running/);
    await release();
    await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    await fs.writeFile(file, JSON.stringify({ pid: process.pid, host: 'other-server', token: 'other', bootId: 'previous-boot' }));
    await assert.rejects(acquireMirrorLock(directory, { bootId: 'current-boot' }), /owns the lock/);
});
test('runtime URLs preserve canonical sources, distinguish thumbnails and originals, and export public HTTPS TTS faces and back', () => {
    const mapped = withCardImageUrls(card, { env: { IMAGE_STORAGE_DIR: path.resolve('temp/images'),
        SITE_ORIGIN: 'https://toolbox.example.com', IMAGE_PUBLIC_ORIGIN: 'https://images.example.com' } });
    assert.equal(card.img, source);
    assert.equal(mapped.sourceImg, source);
    assert.equal(mapped.originalImg, 'https://images.example.com/images/original/LO-6826-A.png');
    assert.equal(mapped.img, mapped.originalImg);
    assert.equal(mapped.thumbnailImg, 'https://images.example.com/images/thumb/LO-6826-A.webp');
    const object = makeTts({ cards: { [card.code]: 1 } }, new Map([[card.code, mapped]])).ObjectStates[0];
    assert.equal(object.CustomDeck[100].FaceURL, mapped.originalImg);
    assert.equal(object.CustomDeck[100].BackURL, 'https://images.example.com/images/original/card-back.png');
    assert.equal(withCardImageUrls(card, { env: {} }).thumbnailImg, '/api/image-proxy?url=' + encodeURIComponent(source));
    for (const originalImg of ['/images/original/LO-6826-A.png', 'http://example.com/a.png', 'https://u:p@example.com/a.png', 'https://localhost/a.png']) {
        assert.throws(() => makeTts({ cards: { [card.code]: 1 } }, new Map([[card.code, { ...mapped, originalImg }]])), /HTTPS/);
    }
    assert.throws(() => withCardImageUrls(card, { env: { IMAGE_STORAGE_DIR: path.resolve('temp/images'), SITE_ORIGIN: 'https://u:p@example.com' } }));
});
test('image paths and official sources reject traversal, wrong hosts and variants; local reads return strong hashes', async t => {
    assert.deepEqual(parseImagePath('/images/original/LO-6826-A.png'), { code: card.code, variant: 'original' });
    assert.equal(parseImagePath('/api/cards'), null);
    for (const value of ['/images/original/../.env', '/images/original/%2e%2e.png', '/images/thumb/LO-6826-A.png', '/images/original/lo-6826.png']) assert.throws(() => parseImagePath(value));
    for (const value of ['https://lycee-tcg.com.evil.test/card/image/LO-6826.png', 'http://lycee-tcg.com/card/image/LO-6826.png', 'https://u:p@lycee-tcg.com/card/image/LO-6826.png', 'https://lycee-tcg.com/card/image/LO-6826.png?x=1', 'https://lycee-tcg.com/secret']) assert.throws(() => imageKeyForSource(value));
    assert.equal(imageKeyForSource(CARD_BACK_SOURCE), 'card-back');
    const directory = await fixture(t), image = await png();
    await atomicStore(path.join(directory, 'original', card.code + '.png'), image);
    const stored = await readStoredImage(card.code, 'original', { directory });
    assert.deepEqual(stored.buffer, image); assert.match(stored.etag, /^"[a-f0-9]{64}"$/); assert(Number.isFinite(Date.parse(stored.lastModified)));
    assert.equal(await readStoredImage('LO-9999', 'original', { directory }), null);
    await assert.rejects(readStoredImage('../.env', 'original', { directory }));
    const outside = await fixture(t), linked = await fixture(t);
    await atomicStore(path.join(outside, card.code + '.png'), image);
    try { await fs.symlink(outside, path.join(linked, 'original'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) return; throw e; }
    await assert.rejects(readStoredImage(card.code, 'original', { directory: linked }), /leaves storage/);
});
test('original verification rejects placeholders, HTML and truncated PNG bytes', async () => {
    const original = await png(), info = await inspectImage(original, card.code);
    assert.equal(info.bytes, original.length); assert.equal(info.width, 126); assert.equal(info.height, 176);
    await assert.rejects(inspectImage(await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).png().toBuffer(), card.code));
    await assert.rejects(inspectImage(Buffer.from('<html>error</html>'), card.code));
    await assert.rejects(inspectImage(original.subarray(0, original.length - 30), card.code));
});
test('mirror resumes verified files, repairs corrupt files and refreshes explicit revisions only once', async t => {
    const directory = await fixture(t), image = await png(), calls = [];
    const options = { directory, catalog: { cards: [card] }, all: true, log: () => {}, clientFactory: () => ({ getImage: async url => { calls.push(url); return image; } }) };
    const first = await mirrorImages(options);
    assert.equal(first.downloaded, 2); // Card plus public TTS card back.
    assert.deepEqual((await readStoredImage(card.code, 'original', { directory })).buffer, image);
    const resumed = await mirrorImages(options);
    assert.equal(resumed.verified, 2); assert.equal(resumed.downloaded, 0); assert.equal(calls.length, 2);
    await fs.writeFile(path.join(directory, 'original', card.code + '.png'), 'corrupt');
    assert.equal((await mirrorImages(options)).downloaded, 1);
    const refresh = { ...options, refreshCodes: [card.code], refreshRevision: 'corrected-20261004' };
    assert.equal((await mirrorImages(refresh)).downloaded, 1);
    assert.equal((await mirrorImages(refresh)).downloaded, 0);
    await assert.rejects(mirrorImages({ ...options, refreshAll: true }), /refresh-revision/);
});
test('mirror failures persist backoff and never store placeholders; dry run is offline and creates no directory', async t => {
    const directory = await fixture(t), image = await png(), placeholder = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
    const options = { directory, catalog: { cards: [card] }, all: true, log: () => {}, now: () => 100000,
        clientFactory: () => ({ getImage: async url => url === CARD_BACK_SOURCE ? image : placeholder }) };
    assert.equal((await mirrorImages(options)).failed, 1);
    assert.equal(await readStoredImage(card.code, 'original', { directory }), null);
    const state = JSON.parse(await fs.readFile(path.join(directory, '.mirror-state.json'), 'utf8'));
    assert.equal(state.entries[card.code].attempts, 1); assert(Date.parse(state.entries[card.code].retryAt) > 100000);
    assert.equal((await mirrorImages(options)).deferred, 1);
    assert.equal((await mirrorImages({ ...options, retryNow: true, clientFactory: () => ({ getImage: async () => image }) })).downloaded, 1);
    const absent = path.join(directory, 'not-created');
    const dry = await mirrorImages({ ...options, directory: absent, all: false, limit: 1, dryRun: true, clientFactory: () => { throw new Error('Must remain offline'); } });
    assert.equal(dry.planned, 1); assert.equal(dry.pending, 1);
    await assert.rejects(fs.stat(absent), { code: 'ENOENT' });
});
test('official image client reads current robots, honors crawl delay and persisted pacing across retries, and refuses denied URLs', async () => {
    let clock = 100000, attempts = 0, persisted = 0;
    const times = [], state = { lastRequestAt: 99900 };
    const client = createOfficialClient({ state, persist: async () => { persisted++; }, now: () => clock, wait: async duration => { clock += duration; },
        request: async (url, image) => {
            times.push(clock);
            if (!image) return { data: 'User-agent: *\nCrawl-delay: 12\nDisallow: /card/image/LO-6826-A.png\n', status: 200 };
            if (++attempts === 1) throw Object.assign(new Error('temporary'), { response: { status: 503, headers: {} } });
            return { data: await png(), status: 200, headers: { 'content-type': 'image/png' } };
        } });
    await client.getImage('https://lycee-tcg.com/card/image/LO-6826.png');
    assert.equal(times[0], 109900);
    assert(times.slice(1).every((time, index) => time - times[index] >= 12000));
    assert.equal(persisted, 3);
    await assert.rejects(client.getImage(source), /robots/); assert.equal(times.length, 3);
    await assert.rejects(client.getImage('https://evil.test/a.png'), /source/); assert.equal(times.length, 3);
    assert.throws(() => createOfficialClient({ delay: 9999 }), /10 seconds/);
});
test('PDF reads local original bytes before networking and incomplete mirrors fall back only to canonical sources', async () => {
    const image = await png(), mapped = { ...card, sourceImg: source, img: 'https://example.com/images/original/' + card.code + '.png' };
    let calls = 0;
    const local = await downloadImages([mapped], { readImage: async () => ({ buffer: image }), fetchImage: () => { throw new Error('Local original should avoid networking'); } });
    assert.equal(local.size, 1);
    const remote = await downloadImages([mapped], { readImage: async () => null, fetchImage: async url => { calls++; assert.equal(url, source); return { data: image }; } });
    assert.equal(remote.size, 1); assert.equal(calls, 1);
});
test('image proxy serves local originals and returns uncached errors for invalid remote responses without a redirect loop', async () => {
    const image = await png();
    const call = async handler => {
        const res = { headers: {}, statusCode: 200, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, send(value) { this.value = value; }, json(value) { this.value = value; } };
        await handler({ method: 'GET', query: { url: source }, headers: {} }, res); return res;
    };
    const local = await call(imageProxyHandler({ readImage: async () => ({ buffer: image, contentType: 'image/png', etag: '"hash"', lastModified: new Date().toUTCString() }), fetchImage: () => { throw new Error('Must not fetch'); } }));
    assert.equal(local.statusCode, 200); assert.deepEqual(local.value, image);
    const fallback = await call(imageProxyHandler({ readImage: async () => null, fetchImage: async url => { assert.equal(url, source); return { data: image }; } }));
    assert.equal(fallback.statusCode, 200); assert(!fallback.headers.Location);
    const invalid = await call(imageProxyHandler({ readImage: async () => null, fetchImage: async () => ({ data: '<html>upstream failed</html>' }) }));
    assert.equal(invalid.statusCode, 502); assert.equal(invalid.headers['Cache-Control'], 'no-store'); assert(!Buffer.isBuffer(invalid.value));
});
