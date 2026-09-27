import { handleAuthProxyRequest } from '@neondatabase/auth/server';
import { authConfig, checkOrigin, requestOrigin } from '../lib/community-auth.js';
import { body, fail, method } from '../lib/http.js';

// Only the email OTP session flow is exposed; no arbitrary upstream proxy.
const routes = { 'get-session': 'GET', 'email-otp/send-verification-otp': 'POST', 'sign-in/email-otp': 'POST', 'sign-out': 'POST' };
export default async function handler(req, res) {
    if (!method(req, res, ['GET', 'POST'])) return;
    res.setHeader('Cache-Control', 'no-store');
    try {
        const url = new URL(req.url, requestOrigin(req));
        const path = url.pathname.startsWith('/api/auth/') ? url.pathname.slice(10) : url.searchParams.get('path');
        if (!Object.hasOwn(routes, path || '') || routes[path] !== req.method) return res.status(404).json({ error: '登录入口不存在' });
        if (req.method === 'POST') checkOrigin(req);
        const headers = new Headers();
        for (const key of ['cookie', 'origin', 'referer', 'content-type', 'user-agent']) if (req.headers[key]) headers.set(key, req.headers[key]);
        const request = new Request(url, { method: req.method, headers,
            ...(req.method === 'POST' ? { body: JSON.stringify(body(req)) } : {}), signal: AbortSignal.timeout(20000) });
        const response = await handleAuthProxyRequest({ request, path, ...authConfig() });
        res.status(response.status);
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader('Set-Cookie', cookies);
        return res.send(Buffer.from(await response.arrayBuffer()));
    } catch (e) { return fail(res, e); }
}
