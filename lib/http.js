export function fail(res, error) {
    const status = error.status || 500;
    if (status >= 500) console.error('API error:', error.code || error.name);
    return res.status(status).json({ error: status < 500 || error.expose ? error.message : '服务暂时不可用，请稍后重试' });
}
export function body(req) {
    const value = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (JSON.stringify(value || '').length > 32768) throw Object.assign(new Error('请求内容过大'), { status: 413 });
    return value;
}
export function method(req, res, allowed) {
    if (req.method === 'OPTIONS') { res.status(204).end(); return false; }
    if (!allowed.includes(req.method)) {
        res.setHeader('Allow', allowed.join(', '));
        res.status(405).json({ error: 'Method not allowed' }); return false;
    }
    if (process.env.MIGRATION_READ_ONLY === '1' && ['POST', 'PATCH', 'DELETE'].includes(req.method)
        && /^\/api\/(?:decks|community|auth)(?:[/?]|$)/.test(req.url || '')) {
        res.setHeader('Retry-After', '300');
        res.setHeader('Cache-Control', 'no-store');
        res.status(503).json({ error: '服务器迁移中，暂时暂停保存和登录，请稍后重试' });
        return false;
    }
    return true;
}
