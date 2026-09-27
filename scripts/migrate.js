import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url || new URL(url).hostname.includes('-pooler')) throw new Error('Set DATABASE_URL_UNPOOLED to a direct connection for migrations');
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, statement_timeout: 20000 });
try {
    await client.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(191912, 1)');
    await client.query('CREATE TABLE IF NOT EXISTS toolbox_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = new URL('../migrations/', import.meta.url);
    for (const file of (await fs.readdir(directory)).filter(f => f.endsWith('.sql')).sort()) {
        if ((await client.query('SELECT 1 FROM toolbox_migrations WHERE name = $1', [file])).rowCount) continue;
        await client.query(await fs.readFile(new URL(file, directory), 'utf8'));
        await client.query('INSERT INTO toolbox_migrations (name) VALUES ($1)', [file]);
        console.log(`Applied ${file}`);
    }
    await client.query('COMMIT');
    console.log('Database migrations complete');
} catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration failed:', e.code || e.name);
    process.exitCode = 1;
} finally { await client.end(); }
