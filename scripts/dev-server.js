import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = path.join(root, 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.pdf': 'application/pdf', '.ttf': 'font/ttf' };
export function createServer() {
    return http.createServer(async (req, res) => {
        res.status = code => { res.statusCode = code; return res; };
        res.json = value => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
        res.send = data => res.end(data);
        try {
            const url = new URL(req.url, 'http://localhost');
            req.query = Object.fromEntries(url.searchParams);
            if (url.pathname.startsWith('/api/')) {
                if (!/^\/api\/[a-z-]+$/.test(url.pathname) && !/^\/api\/auth\/[a-z/-]+$/.test(url.pathname)) return res.status(404).end();
                let data = '', size = 0;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > 32768) return res.status(413).json({ error: '请求内容过大' });
                    data += chunk;
                }
                if (data) { try { req.body = JSON.parse(data); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
                const file = path.join(root, url.pathname.startsWith('/api/auth/') ? 'api/auth.js' : url.pathname.slice(1) + '.js');
                const { default: handler } = await import(pathToFileURL(file));
                await handler(req, res);
            } else {
                if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
                const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
                const file = path.resolve(publicDir, '.' + relative);
                if (!file.startsWith(publicDir + path.sep)) return res.status(403).end();
                const data = await fs.readFile(file);
                res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
                res.setHeader('Cache-Control', 'no-store');
                res.end(req.method === 'HEAD' ? undefined : data);
            }
        } catch (e) {
            const missing = ['ENOENT', 'ERR_MODULE_NOT_FOUND', 'EISDIR'].includes(e.code);
            if (!missing) console.error('Local request failed:', e.code || e.name);
            if (!res.headersSent) res.status(missing ? 404 : 500).json({ error: missing ? 'Not found' : 'Local server error' });
            else res.end();
        }
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.env.PORT || 3000);
    createServer().listen(port, '127.0.0.1', () => console.log(`Lycee Toolbox: http://localhost:${port}`));
}
