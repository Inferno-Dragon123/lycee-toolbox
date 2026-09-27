import { randomBytes, createHash } from 'node:crypto';
import { getPool, saveDeck } from './deck-store.js';
import { baseCode, selectedCodes, validateNickname } from '../public/community-format.js';

const error = (message, status) => Object.assign(new Error(message), { status });
const columns = `p.id, d.name, COALESCE(profile.nickname, p.author_name) AS author_name,
    CASE WHEN p.source = 'community' THEN p.author_name ELSE NULL END AS author_tag, p.description, p.source, p.source_url,
    p.status, p.moderated, p.version, p.created_at, p.updated_at, p.synced_at`;
export const authorName = id => '玩家 ' + createHash('sha256').update(id).digest('hex').slice(0, 8);
export async function getProfile(user, db = getPool()) {
    const nickname = (await db.query('SELECT nickname FROM toolbox_profiles WHERE user_id = $1', [user.id])).rows[0]?.nickname || '';
    return { nickname, displayName: nickname || authorName(user.id), playerTag: authorName(user.id) };
}
export async function setProfile(user, value, db = getPool()) {
    const nickname = validateNickname(value);
    return transaction(db, async client => {
        await limit(client, 'nickname:' + user.id, 10);
        await client.query(`INSERT INTO toolbox_profiles (user_id, nickname) VALUES ($1, $2)
            ON CONFLICT (user_id) DO UPDATE SET nickname = excluded.nickname, updated_at = now()`, [user.id, nickname]);
        return { nickname, displayName: nickname, playerTag: authorName(user.id) };
    });
}
async function transaction(db, work) {
    const client = await db.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
}
async function indexCards(db, id, cards) {
    const counts = new Map();
    for (const [code, n] of Object.entries(cards)) counts.set(baseCode(code), (counts.get(baseCode(code)) || 0) + n);
    await db.query('DELETE FROM toolbox_publication_cards WHERE publication_id = $1', [id]);
    await db.query(`INSERT INTO toolbox_publication_cards (publication_id, base_code, quantity)
        SELECT $1, code, n FROM unnest($2::text[], $3::integer[]) AS t(code, n)`, [id, [...counts.keys()], [...counts.values()]]);
}
async function limit(db, subject, maximum) {
    const result = await db.query(`INSERT INTO toolbox_community_limits (subject, bucket, count)
        VALUES ($1, date_trunc('hour', now()), 1)
        ON CONFLICT (subject, bucket) DO UPDATE SET count = toolbox_community_limits.count + 1 RETURNING count`, [subject]);
    if (result.rows[0].count > maximum) throw error('操作过于频繁，请稍后再试', 429);
    await db.query("DELETE FROM toolbox_community_limits WHERE bucket < now() - interval '2 days'");
}
export async function createPublication(user, input, db = getPool()) {
    return transaction(db, async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['community:' + user.id]);
        await limit(client, 'create:' + user.id, 20);
        const count = await client.query("SELECT count(*)::int AS n FROM toolbox_publications WHERE owner_id = $1 AND status <> 'deleted'", [user.id]);
        if (count.rows[0].n >= 200) throw error('最多保留 200 个发布记录，请先整理我的上传', 429);
        const snapshot = await saveDeck(input.deck, client);
        const duplicate = await client.query("SELECT id FROM toolbox_publications WHERE owner_id = $1 AND snapshot_id = $2 AND status <> 'deleted'", [user.id, snapshot.id]);
        if (duplicate.rows[0]) throw error('你已发布过这个卡组，请在“我的上传”中更新或重新公开', 409);
        const id = 'p_' + randomBytes(16).toString('base64url');
        await client.query(`INSERT INTO toolbox_publications (id, snapshot_id, owner_id, author_name, description, source)
            VALUES ($1, $2, $3, $4, $5, 'community')`, [id, snapshot.id, user.id, authorName(user.id), input.description]);
        await indexCards(client, id, input.deck.cards);
        return { id, version: 1 };
    });
}
export async function updatePublication(user, id, version, action, input, db = getPool()) {
    return transaction(db, async client => {
        const row = (await client.query('SELECT * FROM toolbox_publications WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!row || row.status === 'deleted' || (row.owner_id !== user.id && !user.admin)) throw error('未找到可管理的卡组', 404);
        if (row.version !== version) throw error('卡组已在其他页面更新，请刷新后重试', 409);
        if (['hide', 'unhide'].includes(action)) {
            if (!user.admin) throw error('需要管理员权限', 403);
            await client.query('UPDATE toolbox_publications SET moderated = $2, version = version + 1 WHERE id = $1', [id, action === 'hide']);
        } else {
            if (row.owner_id !== user.id) throw error('只能编辑自己的卡组', 403);
            if (row.moderated && action === 'publish') throw error('该卡组已由管理员下架', 403);
            await limit(client, 'edit:' + user.id, 60);
            if (action === 'edit') {
                const snapshot = await saveDeck(input.deck, client);
                await client.query(`UPDATE toolbox_publications SET snapshot_id = $2, description = $3, version = version + 1,
                    updated_at = now() WHERE id = $1`, [id, snapshot.id, input.description]);
                await indexCards(client, id, input.deck.cards);
            } else {
                const status = { publish: 'public', unpublish: 'unlisted', delete: 'deleted' }[action];
                if (!status) throw error('无效操作', 400);
                await client.query('UPDATE toolbox_publications SET status = $2, version = version + 1, updated_at = now() WHERE id = $1', [id, status]);
            }
        }
        return { id, version: version + 1 };
    });
}
export async function listPublications({ code, codes = [], match = 'all', source, page = 1, mine, moderation, user }, db = getPool()) {
    const values = [], where = [];
    const add = value => { values.push(value); return '$' + values.length; };
    if (mine) where.push(`p.owner_id = ${add(user.id)}`, "p.status <> 'deleted'");
    else if (moderation && user?.admin) where.push("p.status <> 'deleted'");
    else where.push("p.status = 'public'", 'NOT p.moderated');
    if (source) where.push(`p.source = ${add(source)}`);
    const selected = selectedCodes([...codes, ...(code ? [code] : [])]);
    if (!['all', 'any'].includes(match)) throw error('无效匹配方式', 400);
    if (selected.length) {
        const codesParam = add(selected);
        where.push(`p.id IN (SELECT publication_id FROM toolbox_publication_cards WHERE base_code = ANY(${codesParam}::text[])
            ${match === 'all' ? `GROUP BY publication_id HAVING count(*) = ${add(selected.length)}` : ''})`);
    }
    const rows = (await db.query(`SELECT ${columns} FROM toolbox_publications p JOIN toolbox_decks d ON d.id = p.snapshot_id
        LEFT JOIN toolbox_profiles profile ON profile.user_id = p.owner_id
        WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC, p.id LIMIT 21 OFFSET ${add((page - 1) * 20)}`, values)).rows;
    return { items: rows.slice(0, 20), page, hasMore: rows.length > 20 };
}
export async function getPublication(id, user, db = getPool()) {
    const row = (await db.query(`SELECT ${columns}, d.cards, p.owner_id FROM toolbox_publications p
        JOIN toolbox_decks d ON d.id = p.snapshot_id LEFT JOIN toolbox_profiles profile ON profile.user_id = p.owner_id
        WHERE p.id = $1 AND p.status <> 'deleted'
        AND ((p.status = 'public' AND NOT p.moderated) OR p.owner_id = $2 OR $3)`, [id, user?.id || null, Boolean(user?.admin)])).rows[0];
    if (!row) throw error('卡组不存在或已下架', 404);
    const { owner_id, ...result } = row;
    return { ...result, schemaVersion: 1, canEdit: owner_id === user?.id };
}
export async function upsertOfficial({ key, source, deck }, db = getPool()) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(key) || !['official', 'official_tournament', 'official_user'].includes(source)) throw error('无效官网来源', 400);
    return transaction(db, async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['official:' + key]);
        const snapshot = await saveDeck(deck, client);
        const row = (await client.query('SELECT id, snapshot_id FROM toolbox_publications WHERE source_key = $1', [key])).rows[0];
        const id = row?.id || 'p_' + randomBytes(16).toString('base64url');
        if (row) {
            await client.query(`UPDATE toolbox_publications SET snapshot_id = $2, synced_at = now(), source = $3,
                updated_at = CASE WHEN snapshot_id <> $2 THEN now() ELSE updated_at END,
                version = version + CASE WHEN snapshot_id <> $2 THEN 1 ELSE 0 END WHERE id = $1`, [id, snapshot.id, source]);
        } else {
            await client.query(`INSERT INTO toolbox_publications (id, snapshot_id, author_name, source, source_key, source_url, synced_at)
                VALUES ($1, $2, 'Lycee 官网', $3, $4, $5, now())`, [id, snapshot.id, source, key, `https://lycee-tcg.com/d/?d=${key}`]);
        }
        await indexCards(client, id, deck.cards);
        return id;
    });
}
