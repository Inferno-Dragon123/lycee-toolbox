// api/image-proxy.js - 代理图片请求，绕过浏览器 CORS 限制
import axios from 'axios';

export default async function handler(req, res) {
    // CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // 只允许 GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    // 只允许 lycee-tcg.com 和 moetcg.club 的图片
    const allowedDomains = ['lycee-tcg.com', 'moetcg.club'];
    let hostname;
    try {
        hostname = new URL(url).hostname;
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    if (!allowedDomains.some(domain => hostname.includes(domain))) {
        return res.status(403).json({ error: 'Domain not allowed' });
    }

    try {
        console.log(`[Image Proxy] 请求: ${url}`);
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://lycee-tcg.com/',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        });

        // 设置缓存头（1小时）
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Content-Type', response.headers['content-type'] || 'image/png');

        return res.send(Buffer.from(response.data));
    } catch (error) {
        console.error('[Image Proxy] 错误:', error.message);
        // 返回 1x1 透明 PNG 作为占位符
        const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
        res.setHeader('Content-Type', 'image/png');
        return res.send(transparentPng);
    }
}
