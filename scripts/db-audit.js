import 'dotenv/config';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export function canonical(value) {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}
export function tableFingerprint(rows) {
    const hash = createHash('sha256');
    const ordered = rows.map(row => JSON.stringify(canonical(row))).sort();
    for (const row of ordered) hash.update(row).update('\n');
    return { rows: rows.length, sha256: hash.digest('hex') };
}
export function differences(source, target) {
    const names = new Set([...Object.keys(source.tables), ...Object.keys(target.tables)]);
    return [...names].sort().filter(name => {
        const a = source.tables[name], b = target.tables[name];
        return !a || !b || a.rows !== b.rows || a.sha256 !== b.sha256;
    });
}

export async function audit(client) {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
        await client.query("SET LOCAL timezone TO 'UTC'");
        const metadata = (await client.query(`SELECT current_setting('server_version') AS postgres,
            pg_database_size(current_database())::text AS bytes`)).rows[0];
        const names = (await client.query(`SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)).rows
            .map(row => row.table_name).filter(name => /^toolbox_[a-z_]+$/.test(name) && !name.startsWith('toolbox_auth_'));
        const tables = {};
        for (const name of names) tables[name] = tableFingerprint((await client.query(`SELECT * FROM public."${name}"`)).rows);
        const missing = (await client.query(`SELECT count(*)::int AS total FROM toolbox_publications p
            LEFT JOIN toolbox_publication_compositions c ON c.publication_id = p.id
            WHERE p.status <> 'deleted' AND (c.publication_id IS NULL OR c.snapshot_id <> p.snapshot_id)`)).rows[0].total;
        const publications = (await client.query(`SELECT source, status, count(*)::int AS total
            FROM toolbox_publications GROUP BY source, status ORDER BY source, status`)).rows;
        await client.query('COMMIT');
        return { recordedAt: new Date().toISOString(), postgres: metadata.postgres, databaseBytes: Number(metadata.bytes),
            tables, missingOrStaleCompositions: missing, publications };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function main() {
    const { values } = parseArgs({ options: { 'expect-host': { type: 'string' }, report: { type: 'string' }, compare: { type: 'string' } } });
    const connectionString = process.env.DATABASE_URL_UNPOOLED;
    if (!connectionString || !values['expect-host']) throw new Error('DATABASE_URL_UNPOOLED and --expect-host are required');
    const source = new URL(connectionString);
    if (source.hostname !== values['expect-host'] || source.hostname.includes('-pooler')) throw new Error('Database host guard failed');
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000, statement_timeout: 30000 });
    try {
        await client.connect();
        const report = await audit(client);
        if (values.report) {
            await mkdir(dirname(values.report), { recursive: true });
            await writeFile(values.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
        }
        let changed = [];
        if (values.compare) changed = differences(JSON.parse(await readFile(values.compare, 'utf8')), report);
        console.log(JSON.stringify({ postgres: report.postgres, databaseBytes: report.databaseBytes,
            tables: Object.fromEntries(Object.entries(report.tables).map(([name, entry]) => [name, entry.rows])),
            missingOrStaleCompositions: report.missingOrStaleCompositions, changedTables: changed }));
        if (changed.length || report.missingOrStaleCompositions) process.exitCode = 1;
    } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error('Database audit failed:', error.code || error.name); process.exitCode = 1; });
}
