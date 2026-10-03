import 'dotenv/config';
import pg from 'pg';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export function assertPreviewTarget(sourceUrl, targetUrl, kind) {
    const source = new URL(sourceUrl), target = new URL(targetUrl);
    if (kind !== 'preview' || !/^\/lycee_preview_[a-f0-9]{12}$/.test(target.pathname)) throw new Error('Preview target guard failed');
    if (source.hostname === target.hostname && (source.port || '5432') === (target.port || '5432')
        && source.pathname === target.pathname) throw new Error('Source and target must be different databases');
}

// This deliberately excludes community posts, private snapshots, user identities,
// profiles, auth state, moderation data, limits and crawler state.
export async function seedPreview(source, target) {
    const data = {};
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
        data.toolbox_publications = (await source.query(`SELECT * FROM toolbox_publications
            WHERE source IN ('official_tournament', 'official_user', 'official')
                AND status = 'public' AND NOT moderated AND owner_id IS NULL`)).rows;
        const ids = data.toolbox_publications.map(row => row.id);
        data.toolbox_decks = (await source.query(`SELECT d.* FROM toolbox_decks d
            WHERE d.id = ANY($1::text[])`, [[...new Set(data.toolbox_publications.map(row => row.snapshot_id))]])).rows;
        data.toolbox_publication_cards = (await source.query(`SELECT * FROM toolbox_publication_cards
            WHERE publication_id = ANY($1::text[])`, [ids])).rows;
        data.toolbox_publication_compositions = (await source.query(`SELECT * FROM toolbox_publication_compositions
            WHERE publication_id = ANY($1::text[])`, [ids])).rows;
        await source.query('COMMIT');
    } catch (error) { await source.query('ROLLBACK'); throw error; }
    await target.query('BEGIN');
    try {
        await target.query('SELECT pg_advisory_xact_lock(191912, 9)');
        const existing = (await target.query(`SELECT (SELECT count(*) FROM toolbox_decks)
            + (SELECT count(*) FROM toolbox_publications) + (SELECT count(*) FROM toolbox_profiles) AS total`)).rows[0];
        if (Number(existing.total)) throw new Error('Only an empty preview database can be seeded');
        for (const name of ['toolbox_decks', 'toolbox_publications', 'toolbox_publication_cards', 'toolbox_publication_compositions']) {
            if (data[name].length) await target.query(`INSERT INTO public.${name}
                SELECT item.* FROM jsonb_populate_recordset(NULL::public.${name}, $1::jsonb) AS item`, [JSON.stringify(data[name])]);
        }
        await target.query('COMMIT');
        return Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length]));
    } catch (error) { await target.query('ROLLBACK'); throw error; }
}

async function main() {
    const { values } = parseArgs({ options: { 'expect-source-host': { type: 'string' } } });
    const sourceUrl = process.env.SOURCE_DATABASE_URL, targetUrl = process.env.DATABASE_URL_UNPOOLED;
    if (!sourceUrl || !targetUrl || !values['expect-source-host']) throw new Error('Source, target and expected source host are required');
    assertPreviewTarget(sourceUrl, targetUrl, process.env.DEPLOYMENT_KIND);
    if (new URL(sourceUrl).hostname !== values['expect-source-host']) throw new Error('Source host guard failed');
    const source = new pg.Client({ connectionString: sourceUrl, connectionTimeoutMillis: 15000, statement_timeout: 30000 });
    const target = new pg.Client({ connectionString: targetUrl, connectionTimeoutMillis: 15000, statement_timeout: 30000 });
    try {
        await source.connect();
        await target.connect();
        console.log(JSON.stringify({ seeded: await seedPreview(source, target) }));
    } finally { await Promise.allSettled([source.end(), target.end()]); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error('Preview seed failed:', error.code || error.name); process.exitCode = 1; });
}
