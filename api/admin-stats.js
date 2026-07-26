// api/admin-stats.js - 管理后台统计 API
import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // 初始化 Redis
        const redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });

        // 获取 Redis 缓存统计
        let translationStats = {
            exists: false,
            count: 0
        };

        try {
            const keys = await redis.keys('trans:*');
            translationStats = {
                exists: true,
                count: keys.length,
                redisConnected: true
            };
        } catch (e) {
            console.error('[Admin Stats] Redis 错误:', e.message);
            translationStats.redisConnected = false;
            translationStats.error = e.message;
        }

        // 系统信息
        const systemInfo = {
            nodeVersion: process.version,
            platform: process.platform,
            uptime: process.uptime(),
            uptimeFormatted: Math.floor(process.uptime() / 60) + ' 分钟',
            memory: {
                used: process.memoryUsage().heapUsed,
                usedFormatted: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
                total: process.memoryUsage().heapTotal,
                totalFormatted: (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2) + ' MB'
            },
            timestamp: new Date().toISOString()
        };

        return res.status(200).json({
            translation: translationStats,
            system: systemInfo
        });
    } catch (error) {
        console.error('[Admin Stats] 错误:', error);
        return res.status(500).json({ error: error.message });
    }
}
