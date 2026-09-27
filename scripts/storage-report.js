// Read-only against Neon. Optional capacity simulation uses local in-memory Postgres only.
import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs/promises';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL, connectionTimeoutMillis: 15000, statement_timeout: 20000 });
const report = { measuredAt: new Date().toISOString(), branch: process.env.NEON_BRANCH, relations: [], files: [] };
const quote = s => '"' + s.replaceAll('"', '""') + '"';
try {
    await db.connect();
    report.databaseBytes = Number((await db.query('SELECT pg_database_size(current_database())::text AS bytes')).rows[0].bytes);
    const tables = (await db.query(`SELECT n.nspname AS schema, c.relname AS name, pg_table_size(c.oid)::text AS table_bytes,
        pg_indexes_size(c.oid)::text AS index_bytes, pg_total_relation_size(c.oid)::text AS total_bytes
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'neon_auth') AND c.relkind = 'r' ORDER BY n.nspname, c.relname`)).rows;
    for (const table of tables) {
        const stats = (await db.query(`SELECT count(*)::int AS rows, COALESCE(avg(pg_column_size(t)), 0)::numeric(12,1) AS average_row_bytes FROM ${quote(table.schema)}.${quote(table.name)} t`)).rows[0];
        report.relations.push({ ...table, ...stats });
    }
} finally { await db.end(); }
for (const path of ['data/catalog.json', 'lycee-japanese-database-final.json', 'lycee-chinese-database-final.json']) report.files.push({ path, bytes: (await fs.stat(new URL('../' + path, import.meta.url))).size });
if (process.argv.includes('--estimate')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const local = new PGlite();
    try {
        for (const file of ['001_decks.sql', '002_community.sql', '003_profiles.sql']) await local.exec(await fs.readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'));
        const cards = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`LO-${String(6600 + i).padStart(4, '0')}`, i < 9 ? 4 : 3]));
        const size = async table => Number((await local.query('SELECT pg_total_relation_size($1::regclass)::text AS bytes', [table])).rows[0].bytes);
        report.simulation = { engine: 'local PGlite/PostgreSQL', decks: 10000, distinctCardsPerDeck: 17, snapshotsPerDeck: 1, cases: [] };
        for (const descriptionChars of [0, 200]) {
            await local.exec('TRUNCATE toolbox_publication_cards, toolbox_publications, toolbox_decks');
            const description = Array.from({ length: descriptionChars }, (_, i) => String.fromCharCode(19968 + ((i * 97) % 5000))).join('');
            await local.query(`INSERT INTO toolbox_decks (id, name, cards, content_hash)
                SELECT 'd_' || lpad(i::text, 22, '0'), '容量评估卡组名称' || i::text, $1::jsonb, lpad(i::text, 64, '0') FROM generate_series(1,10000) i`, [JSON.stringify(cards)]);
            await local.query(`INSERT INTO toolbox_publications (id, snapshot_id, owner_id, author_name, description, source)
                SELECT 'p_' || lpad(i::text, 22, '0'), 'd_' || lpad(i::text, 22, '0'), md5((i%1000)::text), '玩家 abcd1234', $1, 'community' FROM generate_series(1,10000) i`, [description]);
            await local.query(`INSERT INTO toolbox_publication_cards SELECT 'p_' || lpad(i::text,22,'0'), code, quantity::integer
                FROM generate_series(1,10000) i CROSS JOIN jsonb_each_text($1::jsonb) AS c(code, quantity)`, [JSON.stringify(cards)]);
            const tables = {};
            for (const table of ['toolbox_decks', 'toolbox_publications', 'toolbox_publication_cards']) tables[table] = await size(table);
            report.simulation.cases.push({ descriptionChineseCharacters: descriptionChars, tables, totalBytes: Object.values(tables).reduce((a, b) => a + b, 0) });
        }
        await local.query(`INSERT INTO toolbox_profiles (user_id, nickname) SELECT md5(i::text), $1 || lpad(i::text, 5, '0') FROM generate_series(1,10000) i`, ['昵称'.repeat(9)]);
        report.simulation.profiles = { count: 10000, nicknameCharacters: 23, totalBytes: await size('toolbox_profiles') };
        report.simulation.excludes = ['additional immutable versions and anonymous shares', 'Auth user/account/session growth', 'branch deltas/history', 'future table bloat and longer descriptions'];
    } finally { await local.close(); }
}
console.log(JSON.stringify(report, null, 2));
