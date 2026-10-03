import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { randomBytes, createHash } from 'node:crypto';

let pool;
export function getPool() {
    if (!process.env.DATABASE_URL) throw Object.assign(new Error('卡组云端保存尚未配置；仍可导出文件并在本机保留草稿'), { status: 503, expose: true });
    if (!pool) {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3,
            idleTimeoutMillis: 5000, connectionTimeoutMillis: 12000, statement_timeout: 10000 });
        pool.on('error', e => console.error('Database pool error:', e.code || e.name));
        if (process.env.VERCEL) attachDatabasePool(pool);
    }
    return pool;
}

export async function closePool() {
    const current = pool;
    pool = undefined;
    if (current) await current.end();
}

// Immutable, content-addressed snapshots: repeated saves reuse their existing ID.
export async function saveDeck(deck, db = getPool()) {
    const hash = createHash('sha256').update(JSON.stringify(deck)).digest('hex');
    const existing = await db.query('SELECT id, created_at FROM toolbox_decks WHERE content_hash = $1', [hash]);
    if (existing.rows[0]) return existing.rows[0];
    const id = 'd_' + randomBytes(16).toString('base64url');
    const result = await db.query(`INSERT INTO toolbox_decks (id, name, cards, content_hash)
        VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (content_hash) DO NOTHING RETURNING id, created_at`,
        [id, deck.name, JSON.stringify(deck.cards), hash]);
    if (result.rows[0]) return result.rows[0];
    return (await db.query('SELECT id, created_at FROM toolbox_decks WHERE content_hash = $1', [hash])).rows[0];
}

export async function loadDeck(id, db = getPool()) {
    const result = await db.query('SELECT id, name, cards, created_at FROM toolbox_decks WHERE id = $1', [id]);
    return result.rows[0] || null;
}
