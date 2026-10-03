import 'dotenv/config';
import http from 'node:http';
import { isIP } from 'node:net';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { getPool, closePool } from '../lib/deck-store.js';
import { cards, byCode } from '../lib/catalog.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = path.join(root, 'public');
const routes = new Set(['cards', 'auth', 'admin-stats', 'decks', 'community', 'generate-pdf',
    'translate', 'translate-test', 'translate-from-json', 'lo-proxy', 'import-deck', 'image-proxy']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

export async function readiness() {
    if (!cards.length) throw new Error('Catalog unavailable');
    if (process.env.REQUIRE_DATABASE !== '0') {
        await getPool().query('SELECT 1');
        const result = await getPool().query(`SELECT count(*)::int AS total FROM toolbox_migrations
            WHERE name IN ('001_decks.sql', '002_community.sql', '003_profiles.sql', '004_merge_official_source.sql', '005_publication_compositions.sql')`);
        await getPool().query('SELECT id FROM toolbox_publications LIMIT 0');
        await getPool().query('SELECT publication_id FROM toolbox_publication_compositions LIMIT 0');
        if (result.rows[0].total !== 5) throw new Error('Business migrations unavailable');
    }
    if (process.env.AUTH_PROVIDER === 'better-auth') {
        const local = await import('../lib/local-auth.js');
        await local.localAuthReady();
    } else if (process.env.REQUIRE_AUTH === '1') {
        const { authConfig } = await import('../lib/community-auth.js');
        authConfig();
    }
}

function respond(res) {
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(value));
    };
    res.send = data => res.end(data);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

async function readBody(req) {
    const length = req.headers['content-length'];
    if (length && (!/^\d+$/.test(length) || Number(length) > 32768)) {
        throw Object.assign(new Error('请求内容过大'), { status: 413 });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 32768) throw Object.assign(new Error('请求内容过大'), { status: 413 });
        chunks.push(chunk);
    }
    if (!size) return;
    try { req.body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw Object.assign(new Error('无效的 JSON 请求'), { status: 400 }); }
}

async function serveStatic(req, res, directory, relative, cache) {
    if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).end();
    }
    const filename = path.resolve(directory, '.' + relative);
    if (!filename.startsWith(path.resolve(directory) + path.sep)
        || relative.split('/').some(part => part.startsWith('.'))) return res.status(404).end();
    const [actual, base] = await Promise.all([realpath(filename), realpath(directory)]);
    if (!actual.startsWith(base + path.sep)) return res.status(404).end();
    const info = await stat(actual);
    if (!info.isFile()) return res.status(404).end();
    const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
    res.setHeader('Content-Type', types[path.extname(actual).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', cache);
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', info.mtime.toUTCString());
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.setHeader('Content-Length', String(info.size));
    if (req.method === 'HEAD') return res.end();
    await pipeline(createReadStream(actual), res);
}

export function createProductionServer({ checkReady = readiness } = {}) {
    let stopping = false;
    const server = http.createServer(async (req, res) => {
        respond(res);
        const peer = req.socket.remoteAddress;
        const forwarded = req.headers['x-real-ip'];
        req.clientIp = process.env.TRUST_PROXY === 'loopback'
            && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)
            && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : peer;
        try {
            if (stopping) return res.status(503).json({ error: '服务正在重启' });
            const url = new URL(req.url, 'http://localhost');
            if (url.pathname === '/healthz' || url.pathname === '/api/health') {
                res.setHeader('Cache-Control', 'no-store');
                if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
                if (url.pathname === '/api/health') {
                    try { await checkReady(); }
                    catch (error) {
                        console.error('Readiness failed:', error.code || error.name);
                        return res.status(503).json({ status: 'unavailable' });
                    }
                }
                if (req.method === 'HEAD') return res.end();
                return res.json({ status: 'ok', revision: process.env.DEPLOY_REVISION || 'local', cards: cards.length });
            }
            if (url.pathname.startsWith('/api/')) {
                res.setHeader('Cache-Control', 'no-store');
                const auth = /^\/api\/auth\/[a-z/-]+$/.test(url.pathname);
                const name = auth ? 'auth' : url.pathname.slice(5);
                if (!routes.has(name)) return res.status(404).json({ error: '接口不存在' });
                req.query = Object.fromEntries(url.searchParams);
                await readBody(req);
                const { default: handler } = await import(new URL(`../api/${name}.js`, import.meta.url));
                return await handler(req, res);
            }
            const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
            if (relative.startsWith('/images/')) {
                if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
                const { parseImagePath, readStoredImage, imageKeyForSource, CARD_BACK_SOURCE } = await import('../lib/card-images.js');
                const image = parseImagePath(relative);
                if (!image) return res.status(404).end();
                const stored = await readStoredImage(image.code, image.variant);
                if (!stored) {
                    const card = byCode.get(image.code);
                    const source = image.code === 'card-back' ? CARD_BACK_SOURCE : card?.sourceImg || card?.img;
                    if (!source) return res.status(404).end();
                    imageKeyForSource(source);
                    res.setHeader('Cache-Control', 'no-store');
                    res.setHeader('Location', '/api/image-proxy?url=' + encodeURIComponent(source));
                    return res.status(302).end();
                }
                res.setHeader('Content-Type', stored.contentType);
                res.setHeader('Cache-Control', 'public, max-age=3600');
                res.setHeader('ETag', stored.etag);
                res.setHeader('Last-Modified', stored.lastModified instanceof Date ? stored.lastModified.toUTCString() : stored.lastModified);
                if (req.headers['if-none-match'] === stored.etag) return res.status(304).end();
                res.setHeader('Content-Length', String(stored.buffer.length));
                return res.end(req.method === 'HEAD' ? undefined : stored.buffer);
            }
            return await serveStatic(req, res, publicDir, relative, 'public, max-age=0, must-revalidate');
        } catch (error) {
            if (res.destroyed) return;
            const missing = ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code);
            const status = error.status || (missing ? 404 : error instanceof URIError ? 400 : 500);
            if (status >= 500) console.error('Request failed:', error.code || error.name);
            if (!res.headersSent) {
                if (status === 413) res.setHeader('Connection', 'close');
                res.status(status).json({ error: status === 404 ? '未找到页面' : status < 500 ? error.message : '服务暂时不可用' });
            } else res.destroy();
        }
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 5000;
    server.setTimeout(125000);
    server.beginShutdown = () => { stopping = true; };
    return server;
}

async function main() {
    const host = process.env.HOST || '127.0.0.1';
    const port = Number(process.env.PORT || 3000);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
    const server = createProductionServer();
    server.listen(port, host, () => console.log(`Lycee Toolbox listening on ${host}:${port}`));
    const stop = () => {
        server.beginShutdown();
        server.closeIdleConnections();
        const deadline = setTimeout(() => process.exit(1), 130000);
        deadline.unref();
        server.close(async () => {
            await closePool();
            if (process.env.AUTH_PROVIDER === 'better-auth') {
                const local = await import('../lib/local-auth.js');
                await local.closeLocalAuth();
            }
            clearTimeout(deadline);
            process.exit(0);
        });
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error('Server startup failed:', error.code || error.name); process.exitCode = 1; });
}
