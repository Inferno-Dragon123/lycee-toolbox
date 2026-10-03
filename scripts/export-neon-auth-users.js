// Export only identity fields for OTP migration. Never export accounts, passwords, tokens, or sessions.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import pg from 'pg';
import { guardAuthDatabase, validatedAuthUsers, authUsersDigest } from '../lib/auth-migration.js';

const { values } = parseArgs({ options: { 'env-file': { type: 'string' }, 'expect-host': { type: 'string' }, output: { type: 'string' } } });
if (!values['env-file'] || !values.output) throw new Error('--env-file and private --output are required');
const env = dotenv.parse(await fs.readFile(values['env-file']));
const url = env.DATABASE_URL_UNPOOLED;
const sourceHost = guardAuthDatabase(url, values['expect-host'], { source: true });
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, statement_timeout: 15000 });
try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const users = (await client.query(`SELECT id::text, name, email, "emailVerified", image, "createdAt", "updatedAt",
        role, COALESCE(banned, false) AS banned, "banReason", "banExpires" FROM neon_auth."user" ORDER BY id`)).rows;
    const doc = { schemaVersion: 1, sourceHost, exportedAt: new Date().toISOString(), userCount: users.length, users };
    const normalized = validatedAuthUsers(doc);
    await client.query('ROLLBACK');
    const bytes = JSON.stringify(doc, null, 2) + '\n';
    await fs.writeFile(values.output, bytes, { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ users: users.length, verified: normalized.filter(u => u.emailVerified).length,
        banned: normalized.filter(u => u.banned).length, idsPreserved: true, sessionsExported: 0,
        identityDigest: authUsersDigest(normalized), fileSha256: createHash('sha256').update(bytes).digest('hex') }));
} catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('Auth identity export failed:', e.code || e.name); process.exitCode = 1; }
finally { await client.end(); }
