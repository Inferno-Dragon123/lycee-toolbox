import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PGliteDialect } from 'kysely';
import { getMigrations } from 'better-auth/db/migration';
import { createLocalAuth, isUserBanned, configuredSiteOrigin, authMailTableSql, reserveMailRequest } from '../lib/local-auth.js';
import { requestOrigin, checkOrigin, sessionUser, authRequestHeaders } from '../lib/community-auth.js';
import { authInput } from '../api/auth.js';
import { guardAuthDatabase, validatedAuthUsers, importAuthUsers } from '../lib/auth-migration.js';
import { smtpOptions, smtpConfigured } from '../lib/auth-mail.js';
import { createSiteAuthClient } from '../public/auth-client.js';

test('fixed SITE_ORIGIN survives TLS proxy and rejects untrusted origins and headers', () => {
    const previous = process.env.SITE_ORIGIN;
    try {
        process.env.SITE_ORIGIN = 'https://cards.example.com';
        const req = { headers: { host: 'localhost:3000', origin: 'https://cards.example.com', 'content-type': 'application/json',
            'x-forwarded-proto': 'http', 'x-forwarded-host': 'evil.test', 'x-lycee-client-ip': '8.8.8.8' },
            socket: { remoteAddress: '127.0.0.1' }, clientIp: '192.0.2.1' };
        assert.equal(requestOrigin(req), 'https://cards.example.com');
        assert.doesNotThrow(() => checkOrigin(req));
        assert.equal(authRequestHeaders(req).get('x-lycee-client-ip'), '192.0.2.1');
        assert.throws(() => checkOrigin({ ...req, headers: { ...req.headers, origin: 'https://evil.test' } }), { status: 403 });
        assert.throws(() => configuredSiteOrigin({ SITE_ORIGIN: 'https://user:pass@example.com/path' }), { status: 503 });
    } finally { if (previous === undefined) delete process.env.SITE_ORIGIN; else process.env.SITE_ORIGIN = previous; }
});

test('only OTP sign-in bodies accepted, with no security fields or other OTP purposes', () => {
    assert.deepEqual(authInput('sign-in/email-otp', { email: ' User@Example.com ', otp: '123456' }), { email: 'user@example.com', otp: '123456' });
    assert.throws(() => authInput('email-otp/send-verification-otp', { email: 'u@example.com', type: 'forget-password' }), { status: 400 });
    assert.throws(() => authInput('sign-in/email-otp', { email: 'u@example.com', otp: '123456', banned: false }), { status: 400 });
    assert.throws(() => authInput('sign-in/email-otp', { email: 'u@example.com', otp: '000' }), { status: 400 });
    assert.deepEqual(authInput('sign-out', {}), {});
});

test('migration host guards and identity validation reject ambiguity', () => {
    assert.throws(() => guardAuthDatabase('postgres://u:p@ep-prod.neon.tech/db', 'ep-prod.neon.tech'));
    assert.throws(() => guardAuthDatabase('postgres://u:p@localhost/db', 'other'));
    assert.equal(guardAuthDatabase('postgres://u:p@localhost/db', 'localhost'), 'localhost');
    const user = legacyUser();
    assert.equal(validatedAuthUsers({ schemaVersion: 1, userCount: 1, users: [user] })[0].id, user.id);
    assert.throws(() => validatedAuthUsers({ schemaVersion: 1, userCount: 2, users: [user, { ...user, id: '22222222-2222-4222-8222-222222222222', email: user.email.toUpperCase() }] }));
});

test('ban expiry and session revocation are checked without trusting cached cookies', () => {
    assert.equal(isUserBanned({ banned: true }), true);
    assert.equal(isUserBanned({ banned: true, banExpires: new Date(Date.now() - 1000) }), false);
    assert.equal(isUserBanned({ banned: true, banExpires: 'invalid' }), true);
    const data = { user: { id: 'legacy', emailVerified: true }, session: { expiresAt: new Date(Date.now() + 50000) } };
    assert.equal(sessionUser(data).id, 'legacy');
    assert.equal(sessionUser({ ...data, user: { ...data.user, banned: true } }), null);
    assert.throws(() => sessionUser({ ...data, session: { expiresAt: 'invalid' } }, true), { status: 401 });
});

test('SMTP defaults require TLS, never log message data, and remain unconfigured without secrets', () => {
    assert.equal(smtpConfigured({}), false);
    assert.throws(() => smtpOptions({}), { status: 503 });
    const options = smtpOptions({ SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'auth@example.com', SMTP_USER: 'test', SMTP_PASS: 'private', SMTP_PORT: '587' });
    assert.equal(options.requireTLS, true); assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.debug, false);
});

test('same-origin browser auth preserves session/error interface for both providers', async () => {
    const calls = [];
    const client = createSiteAuthClient('/api/auth', async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify(url.endsWith('get-session') ? { user: { id: 'legacy' } } : { success: true }));
    });
    assert.equal((await client.getSession()).data.user.id, 'legacy');
    await client.signOut();
    assert.equal(calls[0].options.credentials, 'same-origin');
    assert.equal(calls[1].options.method, 'POST');
    const unavailable = createSiteAuthClient('/api/auth', async () => new Response(JSON.stringify({ message: 'mail unavailable' }), { status: 503 }));
    assert.equal((await unavailable.emailOtp.sendVerificationOtp({ email: 'test@example.com', type: 'sign-in' })).error.status, 503);
});

function legacyUser() {
    return { id: '11111111-1111-4111-8111-111111111111', email: 'existing@example.com', name: '旧用户',
        emailVerified: true, banned: false, role: null, banReason: null, banExpires: null, image: null,
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
}

test('real Better Auth/Postgres flow preserves imported ID, hashes OTP, rejects bans, expires attempts and revokes sign-out', async () => {
    const pg = new PGlite();
    const kysely = new Kysely({ dialect: new PGliteDialect({ pglite: pg }) });
    const sent = new Map();
    let failMail = false;
    const origin = 'https://cards.example.com';
    const options = { database: { db: kysely, type: 'postgres' }, origin,
        secret: randomBytes(32).toString('hex'), sendOtp: async data => {
            if (failMail) throw new Error('synthetic delivery failure');
            sent.set(data.email, data.otp);
        } };
    try {
        const bootstrap = createLocalAuth({ ...options, validateSchema: false });
        const plan = await getMigrations(bootstrap.options);
        await pg.exec(await plan.compileMigrations());
        await pg.exec(authMailTableSql);
        const auth = createLocalAuth(options);
        const users = validatedAuthUsers({ schemaVersion: 1, userCount: 1, users: [legacyUser()] });
        assert.deepEqual(await importAuthUsers(pg, users), { inserted: 1, unchanged: 0 });
        assert.deepEqual(await importAuthUsers(pg, users), { inserted: 0, unchanged: 1 });
        await assert.rejects(importAuthUsers(pg, [{ ...users[0], email: 'different@example.com' }]), /conflict/);
        let ipCounter = 1;
        const call = (path, data, cookie) => auth.handler(new Request(`${origin}/api/auth/${path}`, {
            method: data === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json',
                'x-lycee-client-ip': `192.0.2.${ipCounter++}`, ...(cookie ? { cookie } : {}) },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }) }));
        assert.equal((await call('email-otp/send-verification-otp', { email: users[0].email, type: 'sign-in' })).status, 200);
        const otp = sent.get(users[0].email);
        assert.match(otp, /^\d{6}$/);
        const verification = (await pg.query('SELECT value FROM toolbox_auth_verifications')).rows;
        assert.ok(verification.every(row => !row.value.startsWith(otp)));
        const login = await call('sign-in/email-otp', { email: users[0].email, otp });
        assert.equal(login.status, 200);
        const logged = await login.json();
        assert.equal(logged.user.id, users[0].id); assert.equal(logged.user.emailVerified, true);
        const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
        assert.ok(login.headers.getSetCookie().some(value => value.includes('HttpOnly') && value.includes('Secure')));
        assert.equal((await (await call('get-session?disableCookieCache=true', undefined, cookie)).json()).user.id, users[0].id);
        assert.equal((await call('sign-out', {}, cookie)).status, 200);
        assert.equal(await (await call('get-session?disableCookieCache=true', undefined, cookie)).json(), null);

        await pg.query('UPDATE toolbox_auth_users SET banned=true WHERE id=$1', [users[0].id]);
        const before = sent.size;
        assert.equal((await call('email-otp/send-verification-otp', { email: users[0].email, type: 'sign-in' })).status, 403);
        assert.equal(sent.size, before);
        await pg.query('UPDATE toolbox_auth_users SET banned=false WHERE id=$1', [users[0].id]);
        await call('email-otp/send-verification-otp', { email: users[0].email, type: 'sign-in' });
        const correct = sent.get(users[0].email), wrong = correct === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i++) assert.notEqual((await call('sign-in/email-otp', { email: users[0].email, otp: wrong })).status, 200);
        assert.notEqual((await call('sign-in/email-otp', { email: users[0].email, otp: correct })).status, 200);
        await call('email-otp/send-verification-otp', { email: users[0].email, type: 'sign-in' });
        const expired = sent.get(users[0].email);
        await pg.exec('UPDATE toolbox_auth_verifications SET "expiresAt" = now() - interval \'1 second\'');
        assert.notEqual((await call('sign-in/email-otp', { email: users[0].email, otp: expired })).status, 200);
        await reserveMailRequest(pg, users[0].email);
        await assert.rejects(reserveMailRequest(pg, users[0].email.toUpperCase()), { status: 429 });
        await pg.exec("UPDATE toolbox_auth_mail_limits SET last_sent=now()-interval '61 seconds', count=10");
        await assert.rejects(reserveMailRequest(pg, users[0].email), { status: 429 });
        await pg.exec("UPDATE toolbox_auth_mail_limits SET window_started=now()-interval '61 minutes'");
        await assert.doesNotReject(reserveMailRequest(pg, users[0].email));
        for (let i = 0; i < 4; i++) {
            const rate = await auth.handler(new Request(`${origin}/api/auth/email-otp/send-verification-otp`, {
                method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-lycee-client-ip': '198.51.100.1' },
                body: JSON.stringify({ email: `ratelimit${i}@example.com`, type: 'sign-in' }) }));
            assert.equal(rate.status, i < 3 ? 200 : 429);
        }
        failMail = true;
        assert.equal((await call('email-otp/send-verification-otp', { email: 'failure@example.com', type: 'sign-in' })).status, 503);
        const future = await getMigrations(auth.options);
        assert.equal(future.toBeCreated.length + future.toBeAdded.length + future.toBeAddedIndexes.length, 0);
    } finally { await kysely.destroy(); }
});
