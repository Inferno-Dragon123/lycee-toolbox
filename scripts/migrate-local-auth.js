import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import pg from 'pg';
import { getMigrations } from 'better-auth/db/migration';
import { createLocalAuth, configuredSiteOrigin, authTables, authMailTableSql } from '../lib/local-auth.js';
import { guardAuthDatabase } from '../lib/auth-migration.js';

const { values } = parseArgs({ options: { 'env-file': { type: 'string' }, 'expect-host': { type: 'string' },
    apply: { type: 'boolean', default: false }, 'sql-output': { type: 'string' } } });
if (values['env-file']) dotenv.config({ path: values['env-file'], override: true, quiet: true });
const url = process.env.LOCAL_AUTH_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
guardAuthDatabase(url, values['expect-host']);
const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 20000 });
try {
    const auth = createLocalAuth({ database: pool, origin: configuredSiteOrigin(), secret: process.env.BETTER_AUTH_SECRET, validateSchema: false });
    const plan = await getMigrations(auth.options);
    if (plan.unsafeChanges.length || plan.schemaProblems.length) throw new Error('Unsafe auth schema migration refused');
    const sql = `${await plan.compileMigrations()}\n${authMailTableSql};`;
    if (values['sql-output']) await fs.writeFile(values['sql-output'], sql, { mode: 0o600 });
    if (values.apply) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(191912, 2)');
            await client.query(sql);
            await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
    }
    console.log(JSON.stringify({ mode: values.apply ? 'applied' : 'dry-run',
        tables: Object.values(authTables), create: plan.toBeCreated.length, alter: plan.toBeAdded.length,
        indexes: plan.toBeAddedIndexes.length, mailLimitTable: true }));
} catch (e) { console.error('Local auth migration failed:', e.code || e.name); process.exitCode = 1; }
finally { await pool.end(); }
