import { createAuthServer, extractNeonAuthCookies, serializeSetCookie } from '@neondatabase/auth/server';
import { isIP } from 'node:net';
import { getLocalAuth, configuredSiteOrigin, isUserBanned } from './local-auth.js';

export function authProvider() {
    const provider = process.env.AUTH_PROVIDER || 'neon';
    if (!['neon', 'better-auth'].includes(provider)) throw Object.assign(new Error('无效登录服务配置'), { status: 503, expose: true });
    return provider;
}

export function authRequestHeaders(req) {
    const headers = new Headers();
    for (const key of ['cookie', 'origin', 'referer', 'content-type', 'user-agent']) {
        if (typeof req.headers[key] === 'string') headers.set(key, req.headers[key]);
    }
    const ip = req.clientIp || req.socket?.remoteAddress;
    if (typeof ip === 'string' && isIP(ip)) headers.set('x-lycee-client-ip', ip);
    return headers;
}

export function applyAuthCookies(res, response) {
    const cookies = response.headers.getSetCookie();
    if (!cookies.length) return;
    const previous = res.getHeader?.('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : [previous]), ...cookies]);
}

export function authConfig() {
    if (!process.env.NEON_AUTH_BASE_URL || !process.env.NEON_AUTH_COOKIE_SECRET) {
        throw Object.assign(new Error('登录服务尚未配置，暂时无法发布卡组'), { status: 503, expose: true });
    }
    return { baseUrl: process.env.NEON_AUTH_BASE_URL, cookieSecret: process.env.NEON_AUTH_COOKIE_SECRET, sessionDataTtl: 60, sameSite: 'lax' };
}
export function requestOrigin(req) {
    // The reverse proxy terminates TLS. Never derive authority from arbitrary proxy headers.
    if (process.env.SITE_ORIGIN) return configuredSiteOrigin();
    const host = req.headers.host;
    if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host)) throw Object.assign(new Error('无效请求来源'), { status: 400 });
    return `${process.env.VERCEL || req.socket?.encrypted ? 'https' : 'http'}://${host}`;
}
export function checkOrigin(req) {
    if (req.headers.origin !== requestOrigin(req) || req.headers['sec-fetch-site'] === 'cross-site') {
        throw Object.assign(new Error('请从本站页面提交操作'), { status: 403 });
    }
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
        throw Object.assign(new Error('请使用 JSON 请求'), { status: 415 });
    }
}
export async function currentUser(req, res, required = false) {
    if (authProvider() === 'better-auth') {
        if (!req.headers.cookie) {
            if (required) throw Object.assign(new Error('请先登录'), { status: 401 });
            return null;
        }
        let data;
        try {
            const response = await getLocalAuth().api.getSession({ headers: authRequestHeaders(req),
                query: { disableCookieCache: true }, asResponse: true });
            applyAuthCookies(res, response);
            if (!response.ok) throw new Error('Session validation failed');
            data = await response.json();
        } catch {
            throw Object.assign(new Error('登录验证暂时失败，请稍后重试'), { status: 503, expose: true });
        }
        return sessionUser(data, required);
    }
    const cookie = extractNeonAuthCookies(req.headers.cookie || '');
    if (!cookie) {
        if (required) throw Object.assign(new Error('请先登录'), { status: 401 });
        return null;
    }
    const server = createAuthServer({ ...authConfig(), context: () => ({
        getCookies: () => cookie,
        setCookie: (name, value, options) => {
            const previous = res.getHeader('Set-Cookie') || [];
            res.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : [previous]), serializeSetCookie({ name, value, ...options })]);
        },
        getHeader: name => req.headers[name.toLowerCase()] ?? null,
        getOrigin: () => requestOrigin(req),
        getFramework: () => 'lycee-vercel'
    }) });
    // Always validate protected operations upstream, including revoked sessions.
    const { data, error } = await server.getSession({ query: { disableCookieCache: 'true' } });
    if (error) throw Object.assign(new Error('登录验证暂时失败，请稍后重试'), { status: 503, expose: true });
    return sessionUser(data, required);
}

export function sessionUser(data, required = false) {
    const user = data?.user;
    if (!user?.id || isUserBanned(user) || !data?.session || !Number.isFinite(new Date(data.session.expiresAt).getTime()) || new Date(data.session.expiresAt).getTime() <= Date.now()) {
        if (required) throw Object.assign(new Error('登录已过期，请重新登录'), { status: 401 });
        return null;
    }
    return { id: user.id, emailVerified: user.emailVerified === true,
        admin: (process.env.COMMUNITY_ADMIN_IDS || '').split(',').map(s => s.trim()).includes(user.id) };
}
