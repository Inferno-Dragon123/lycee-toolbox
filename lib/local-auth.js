import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import { sendLoginOtp, smtpConfigured, closeAuthMail } from './auth-mail.js';

let auth, pool;
export const authTables = Object.freeze({ user: 'toolbox_auth_users', session: 'toolbox_auth_sessions',
    account: 'toolbox_auth_accounts', verification: 'toolbox_auth_verifications', rateLimit: 'toolbox_auth_rate_limits' });
export const authMailTableSql = `CREATE TABLE IF NOT EXISTS toolbox_auth_mail_limits
    (key text PRIMARY KEY, last_sent timestamptz NOT NULL, window_started timestamptz NOT NULL, count integer NOT NULL)`;

export function configuredSiteOrigin(env = process.env) {
    let url;
    try { url = new URL(env.SITE_ORIGIN); } catch { throw Object.assign(new Error('SITE_ORIGIN 尚未正确配置'), { status: 503, expose: true }); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw Object.assign(new Error('SITE_ORIGIN 必须是完整站点来源地址'), { status: 503, expose: true });
    }
    return url.origin;
}

export function isUserBanned(user, now = Date.now()) {
    if (user?.banned !== true) return false;
    if (!user.banExpires) return true;
    const expiry = new Date(user.banExpires).getTime();
    return !Number.isFinite(expiry) || expiry > now;
}

export function createLocalAuth({ database, origin, secret, sendOtp = sendLoginOtp, logger = { disabled: true }, validateSchema = true }) {
    if (!secret || secret.length < 32) throw Object.assign(new Error('BETTER_AUTH_SECRET 必须至少 32 个字符'), { status: 503, expose: true });
    const failedDeliveries = new WeakSet();
    return betterAuth({
        appName: 'Lycee 工具箱', database, baseURL: origin, basePath: '/api/auth', secret,
        trustedOrigins: [origin], logger, telemetry: { enabled: false },
        user: { modelName: authTables.user, additionalFields: {
            banned: { type: 'boolean', required: false, defaultValue: false, input: false },
            banReason: { type: 'string', required: false, input: false },
            banExpires: { type: 'date', required: false, input: false },
            role: { type: 'string', required: false, input: false }
        } },
        session: { modelName: authTables.session, expiresIn: 60 * 60 * 24 * 7,
            updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
        account: { modelName: authTables.account },
        verification: { modelName: authTables.verification },
        rateLimit: { enabled: true, storage: 'database', modelName: authTables.rateLimit,
            window: 60, max: 60, customRules: { '/sign-in/email-otp': { window: 60, max: 10 } } },
        advanced: { useSecureCookies: origin.startsWith('https:'), cookiePrefix: 'lycee',
            ipAddress: { ipAddressHeaders: ['x-lycee-client-ip'] }, database: { generateId: () => randomUUID(), validateSchema } },
        hooks: {
            before: createAuthMiddleware(async context => {
                if (!['/email-otp/send-verification-otp', '/sign-in/email-otp'].includes(context.path)) return;
                const email = typeof context.body?.email === 'string' ? context.body.email.trim().toLowerCase() : '';
                const identity = email ? await context.context.internalAdapter.findUserByEmail(email) : null;
                if (isUserBanned(identity?.user)) throw new APIError('FORBIDDEN', { message: '该账户暂时无法登录' });
            }),
            after: createAuthMiddleware(async context => {
                // Better Auth intentionally catches errors from mail/background tasks.
                // Surface delivery failure for this request without storing SMTP details.
                if (context.request && failedDeliveries.has(context.request)) {
                    failedDeliveries.delete(context.request);
                    throw new APIError('SERVICE_UNAVAILABLE', { message: '验证码邮件发送失败，请稍后再试' });
                }
            })
        },
        databaseHooks: { session: { create: { before: async (session, context) => {
            const user = await context.context.internalAdapter.findUserById(session.userId);
            if (isUserBanned(user)) throw new APIError('FORBIDDEN', { message: '该账户暂时无法登录' });
            return { data: session };
        } } } },
        plugins: [emailOTP({ otpLength: 6, expiresIn: 300, allowedAttempts: 5,
            storeOTP: 'hashed', rateLimit: { window: 60, max: 3 },
            sendVerificationOTP: async (data, context) => {
                if (data.type !== 'sign-in') throw new APIError('BAD_REQUEST', { message: '不支持的验证码类型' });
                try { await sendOtp(data); }
                catch {
                    if (context.request) failedDeliveries.add(context.request);
                    throw new APIError('SERVICE_UNAVAILABLE', { message: '验证码邮件发送失败，请稍后再试' });
                }
            }
        })]
    });
}

export function localAuthDatabaseUrl(env = process.env) {
    const url = env.LOCAL_AUTH_DATABASE_URL || env.DATABASE_URL;
    if (!url) throw Object.assign(new Error('本机登录数据库尚未配置'), { status: 503, expose: true });
    return url;
}

export function getLocalAuth() {
    if (!auth) {
        const origin = configuredSiteOrigin();
        if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
            throw Object.assign(new Error('BETTER_AUTH_SECRET 必须至少 32 个字符'), { status: 503, expose: true });
        }
        pool = new pg.Pool({ connectionString: localAuthDatabaseUrl(), max: 4,
            connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, statement_timeout: 15000 });
        pool.on('error', e => console.error('Auth database pool error:', e.code || e.name));
        auth = createLocalAuth({ database: pool, origin, secret: process.env.BETTER_AUTH_SECRET });
    }
    return auth;
}

export async function prepareOtpDelivery(email) {
    if (!smtpConfigured()) throw Object.assign(new Error('验证码邮件尚未配置，请稍后再试'), { status: 503, expose: true });
    getLocalAuth();
    await reserveMailRequest(pool, email);
}

export async function reserveMailRequest(db, email) {
    const key = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    const reserved = await db.query(`INSERT INTO toolbox_auth_mail_limits (key, last_sent, window_started, count)
        VALUES ($1, now(), now(), 1) ON CONFLICT (key) DO UPDATE SET last_sent = now(),
        window_started = CASE WHEN toolbox_auth_mail_limits.window_started < now() - interval '1 hour' THEN now() ELSE toolbox_auth_mail_limits.window_started END,
        count = CASE WHEN toolbox_auth_mail_limits.window_started < now() - interval '1 hour' THEN 1 ELSE toolbox_auth_mail_limits.count + 1 END
        WHERE toolbox_auth_mail_limits.last_sent < now() - interval '60 seconds'
        AND (toolbox_auth_mail_limits.window_started < now() - interval '1 hour' OR toolbox_auth_mail_limits.count < 10)
        RETURNING key`, [key]);
    if (!reserved.rows.length) throw Object.assign(new Error('验证码请求过于频繁，请稍后再试'), { status: 429 });
}

export async function localAuthReady() {
    const instance = getLocalAuth();
    const context = await instance.$context;
    await context.explicitSchemaCheck?.();
    const migrations = await getMigrations(instance.options);
    if (migrations.toBeCreated.length || migrations.toBeAdded.length || migrations.toBeAddedIndexes.length || migrations.schemaProblems.length) {
        throw Object.assign(new Error('本机登录数据库结构尚未就绪'), { status: 503, expose: true });
    }
    await pool.query('SELECT key, last_sent, window_started, count FROM toolbox_auth_mail_limits LIMIT 0');
    return { provider: 'better-auth', ready: true, mailConfigured: smtpConfigured() };
}

export async function closeLocalAuth() {
    auth = undefined;
    const previous = pool; pool = undefined;
    closeAuthMail();
    await previous?.end();
}
