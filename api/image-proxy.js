import axios from 'axios';
import { imageKeyForSource, readStoredImage, inspectImage, MAX_IMAGE_BYTES } from '../lib/card-images.js';
import { method, fail } from '../lib/http.js';

export function imageProxyHandler({ readImage = readStoredImage, fetchImage = (url, options) => axios.get(url, options) } = {}) {
return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (!method(req, res, ['GET'])) return;
    res.setHeader('Cache-Control', 'no-store');
    try {
        const url = req.query?.url || new URL(req.url, 'http://localhost').searchParams.get('url');
        const code = imageKeyForSource(url);
        const local = await readImage(code);
        if (local) {
            res.setHeader('Content-Type', local.contentType);
            res.setHeader('ETag', local.etag);
            res.setHeader('Last-Modified', local.lastModified);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.status(200).send(local.buffer);
        }
        // A partial mirror falls back to the fixed official source, never to
        // /images/. Only the paced mirror command stores validated originals.
        const response = await fetchImage(url, { responseType: 'arraybuffer', timeout: 10000,
            maxRedirects: 0, maxContentLength: MAX_IMAGE_BYTES,
            headers: { 'User-Agent': 'LyceeToolbox/1.0', Referer: 'https://lycee-tcg.com/' } });
        const buffer = Buffer.from(response.data);
        await inspectImage(buffer, code);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.status(200).send(buffer);
    } catch (e) {
        if (!e.status) e = Object.assign(new Error('卡图暂不可用，请稍后重试'), { status: 502, expose: true });
        return fail(res, e);
    }
}
}
export default imageProxyHandler();
