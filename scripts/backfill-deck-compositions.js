// Read existing snapshots and derive search tags; never fetch decks or send mail.
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import pg from 'pg';
import { indexComposition } from '../lib/community-store.js';
import { deckComposition, compatibleOfficialComposition } from '../lib/deck-composition.js';
import { parseOfficialList } from '../lib/official-deck-list.js';

const { values } = parseArgs({ options: {
    'env-file': { type: 'string' }, 'expect-host': { type: 'string' },
    'official-list': { type: 'string' }, apply: { type: 'boolean', default: false }
} });
if (values['env-file']) dotenv.config({ path: values['env-file'], quiet: true });
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url || new URL(url).hostname.includes('-pooler')) throw new Error('Direct DATABASE_URL_UNPOOLED required');
if (values.apply && new URL(url).hostname !== values['expect-host']) throw new Error('--apply requires the exact --expect-host to guard environment selection');
const listing = values['official-list'] ? parseOfficialList(await fs.readFile(values['official-list'], 'utf8'), 'https://lycee-tcg.com/deck/') : { entries: [] };
const official = new Map(listing.entries.filter(e => e.composition).map(e => [e.key, e.composition]));
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, statement_timeout: 15000 });
try {
    await client.connect();
    await client.query('BEGIN');
    const rows = (await client.query(`SELECT p.id, p.snapshot_id, p.source, p.source_key, d.cards FROM toolbox_publications p
        JOIN toolbox_decks d ON d.id = p.snapshot_id WHERE p.status <> 'deleted' ${values.apply ? 'FOR UPDATE OF p' : ''}`)).rows;
    const totals = { single: 0, mix: 0, unknown: 0, official: 0 };
    for (const row of rows) {
        const tag = official.get(row.source_key);
        const validTag = compatibleOfficialComposition(row.cards, tag) ? tag : null;
        const composition = validTag || deckComposition(row.cards);
        totals[composition.type]++;
        if (validTag) totals.official++;
        if (values.apply) await indexComposition(client, row.id, row.cards, row.snapshot_id, validTag, row.source !== 'community');
    }
    await client.query(values.apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ mode: values.apply ? 'applied' : 'dry-run', publications: rows.length, ...totals }));
} catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Composition backfill failed:', e.code || e.name);
    process.exitCode = 1;
} finally { await client.end(); }
