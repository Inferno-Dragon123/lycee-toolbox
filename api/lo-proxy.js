// api/lo-proxy.js - 代理萌卡社 LO 卡组接口,绕过浏览器 CORS 限制
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

    const { did } = req.query;
    if (!did) {
        return res.status(400).json({ error: 'Missing did parameter' });
    }

    const upstreamUrl = `https://www.moetcg.club/cardBuilder/makeTtsByLo/did/${did}.html`;
    console.log(`[LO Proxy] 请求上游: ${upstreamUrl}`);

    try {
        const response = await axios.get(upstreamUrl, {
            headers: {
                'Referer': 'https://www.moetcg.club/cardBuilder/tts.html',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000,
            httpsAgent: new (await import('https')).Agent({
                rejectUnauthorized: false
            })
        });

        console.log(`[LO Proxy] 上游响应: ${response.status} ${response.statusText}`);
        console.log(`[LO Proxy] 成功解析 JSON,对象数量: ${response.data.ObjectStates?.[0]?.ContainedObjects?.length || 0}`);

        return res.status(200).json(response.data);
    } catch (error) {
        console.error('[LO Proxy] 错误:', error.message);
        if (error.response) {
            console.error('[LO Proxy] 上游响应状态:', error.response.status);
            console.error('[LO Proxy] 上游响应数据:', error.response.data);
        }
        return res.status(500).json({ error: 'Proxy failed', details: error.message });
    }
}
