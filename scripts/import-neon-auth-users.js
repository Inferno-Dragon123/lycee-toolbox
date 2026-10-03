import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import pg from 'pg';
import { guardAuthDatabase, validatedAuthUsers, importAuthUsers, authUsersDigest } from '../lib/auth-migration.js';

const { values } = parseArgs({ options: { 'env-file': { type: 'string' }, 'expect-host': { type: 'string' },
    input: { type: 'string' }, 'source-expect-host': { type: 'string' }, 'expect-sha256': { type: 'string' },
    apply: { type: 'boolean', default: false } } });
if (!values.input) throw new Error('Private --input file is required');
if (values['env-file']) dotenv.config({ path: values['env-file'], override: true, quiet: true });
const url = process.env.LOCAL_AUTH_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
guardAuthDatabase(url, values['expect-host']);
const bytes = await fs.readFile(values.input);
const digest = createHash('sha256').update(bytes).digest('hex');
const doc = JSON.parse(bytes);
if (!values['source-expect-host'] || doc.sourceHost !== values['source-expect-host']) throw new Error('Source auth host guard failed');
if (values.apply && digest !== values['expect-sha256']) throw new Error('--apply requires exact exported --expect-sha256');
const users = validatedAuthUsers(doc);
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000, statement_timeout: 20000 });
try {
    await client.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(191912, 3)');
    const totals = await importAuthUsers(client, users);
    // Missing business owners would silently strand uploads/nicknames after the cutover.
    const missing = (await client.query(`SELECT count(*)::int AS n FROM (
        SELECT owner_id AS user_id FROM toolbox_publications WHERE owner_id IS NOT NULL
        UNION SELECT user_id FROM toolbox_profiles) owners
        LEFT JOIN toolbox_auth_users u ON u.id = owners.user_id WHERE u.id IS NULL`)).rows[0].n;
    if (missing) throw new Error('Business owner has no imported identity; entire import refused');
    await client.query(values.apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ mode: values.apply ? 'applied' : 'dry-run', users: users.length, ...totals,
        verified: users.filter(u => u.emailVerified).length, banned: users.filter(u => u.banned).length,
        identityDigest: authUsersDigest(users), sessionsImported: 0, businessOwnersMissing: missing }));
} catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('Auth identity import failed:', e.code || e.name); process.exitCode = 1; }
finally { await client.end(); }
