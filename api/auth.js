import { handleAuthProxyRequest } from '@neondatabase/auth/server';
import { authConfig, authProvider, authRequestHeaders, applyAuthCookies, checkOrigin, requestOrigin } from '../lib/community-auth.js';
import { getLocalAuth, prepareOtpDelivery, isUserBanned } from '../lib/local-auth.js';
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
        const input = req.method === 'POST' ? authInput(path, body(req)) : undefined;
        const local = authProvider() === 'better-auth';
        if (local && path === 'email-otp/send-verification-otp') await prepareOtpDelivery(input.email);
        const target = new URL(`/api/auth/${path}`, requestOrigin(req));
        if (path === 'get-session') target.searchParams.set('disableCookieCache', 'true');
        const request = new Request(target, { method: req.method, headers: authRequestHeaders(req),
            ...(req.method === 'POST' ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(20000) });
        const response = local ? await getLocalAuth().handler(request)
            : await handleAuthProxyRequest({ request, path, ...authConfig() });
        res.status(response.status);
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
        applyAuthCookies(res, response);
        if (local && path === 'get-session' && response.ok) {
            const data = await response.json();
            return res.json(isUserBanned(data?.user) ? null : data);
        }
        return res.send(Buffer.from(await response.arrayBuffer()));
    } catch (e) { return fail(res, e); }
}

export function authInput(path, input) {
    const invalid = () => { throw Object.assign(new Error('无效登录请求'), { status: 400 }); };
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
    const allowed = path === 'email-otp/send-verification-otp' ? ['email', 'type']
        : path === 'sign-in/email-otp' ? ['email', 'otp'] : [];
    if (Object.keys(input).some(key => !allowed.includes(key))) invalid();
    if (path === 'sign-out') return {};
    if (typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) invalid();
    const email = input.email.trim().toLowerCase();
    if (path === 'email-otp/send-verification-otp') {
        if (input.type !== 'sign-in') invalid();
        return { email, type: 'sign-in' };
    }
    if (typeof input.otp !== 'string' || !/^\d{6}$/.test(input.otp.trim())) invalid();
    return { email, otp: input.otp.trim() };
}
