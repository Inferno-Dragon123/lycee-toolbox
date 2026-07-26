// api/admin-stats.js - 管理后台统计 API
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
        const fs = await import('fs');
        const path = await import('path');

        // 读取翻译缓存
        const translationPath = path.join(process.cwd(), 'data/translations.json');
        let translationStats = {
            exists: false,
            count: 0,
            size: 0,
            lastModified: null
        };

        if (fs.existsSync(translationPath)) {
            const stats = fs.statSync(translationPath);
            const content = JSON.parse(fs.readFileSync(translationPath, 'utf-8'));
            translationStats = {
                exists: true,
                count: Object.keys(content).length,
                size: stats.size,
                sizeFormatted: `${(stats.size / 1024).toFixed(2)} KB`,
                lastModified: stats.mtime
            };
        }

        // 系统信息
        const systemInfo = {
            nodeVersion: process.version,
            platform: process.platform,
            uptime: process.uptime(),
            uptimeFormatted: `${Math.floor(process.uptime() / 60)} 分钟`,
            memory: {
                used: process.memoryUsage().heapUsed,
                usedFormatted: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
                total: process.memoryUsage().heapTotal,
                totalFormatted: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`
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
