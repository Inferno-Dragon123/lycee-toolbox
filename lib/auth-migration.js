import { createHash } from 'node:crypto';

export function guardAuthDatabase(connectionString, expectedHost, { source = false } = {}) {
    let url;
    try { url = new URL(connectionString); } catch { throw new Error('Database URL missing or invalid'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !expectedHost || url.hostname !== expectedHost || url.hostname.includes('-pooler')) {
        throw new Error('Exact database hostname guard failed');
    }
    if (!source && (url.hostname === 'neon.tech' || url.hostname.endsWith('.neon.tech'))) {
        throw new Error('Local auth tools never write to a Neon database');
    }
    return url.hostname;
}

export function validatedAuthUsers(document) {
    if (document.schemaVersion !== 1 || !Array.isArray(document.users) || document.users.length !== document.userCount) throw new Error('Invalid auth export format');
    const ids = new Set(), emails = new Set();
    return document.users.map(user => {
        if (typeof user.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) throw new Error('Invalid legacy user ID');
        if (typeof user.email !== 'string' || user.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) throw new Error('Invalid legacy email');
        const email = user.email.trim().toLowerCase();
        if (ids.has(user.id) || emails.has(email)) throw new Error('Duplicate legacy identity; import refused');
        ids.add(user.id); emails.add(email);
        if (typeof user.emailVerified !== 'boolean' || typeof user.banned !== 'boolean' || typeof user.name !== 'string') throw new Error('Invalid legacy security fields');
        const date = value => {
            if (value === null || value === undefined) return null;
            const parsed = new Date(value);
            if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid legacy identity timestamp');
            return parsed.toISOString();
        };
        const createdAt = date(user.createdAt), updatedAt = date(user.updatedAt);
        if (!createdAt || !updatedAt) throw new Error('Missing legacy identity timestamps');
        for (const field of ['image', 'role', 'banReason']) if (user[field] != null && typeof user[field] !== 'string') throw new Error('Invalid legacy identity fields');
        return { id: user.id, name: user.name, email, emailVerified: user.emailVerified, image: user.image ?? null,
            createdAt, updatedAt, role: user.role ?? null, banned: user.banned,
            banReason: user.banReason ?? null, banExpires: date(user.banExpires) };
    });
}

export function authUsersDigest(users) {
    // Safe audit fingerprint: no identity values printed in the report.
    return createHash('sha256').update(JSON.stringify([...users].sort((a, b) => a.id.localeCompare(b.id)))).digest('hex');
}

export async function importAuthUsers(client, users) {
    let inserted = 0, unchanged = 0;
    for (const user of users) {
        const matches = (await client.query(`SELECT id, email, "emailVerified", banned, "banReason", "banExpires", role
            FROM toolbox_auth_users WHERE id = $1 OR lower(email) = $2 FOR UPDATE`, [user.id, user.email])).rows;
        if (matches.length) {
            const match = matches[0];
            const expiry = match.banExpires ? new Date(match.banExpires).toISOString() : null;
            if (matches.length !== 1 || match.id !== user.id || match.email !== user.email
                || match.emailVerified !== user.emailVerified || Boolean(match.banned) !== user.banned
                || (match.banReason ?? null) !== user.banReason || (match.role ?? null) !== user.role || expiry !== user.banExpires) {
                throw new Error('Existing identity or security-state conflict; entire import refused');
            }
            unchanged++;
            continue;
        }
        await client.query(`INSERT INTO toolbox_auth_users
            (id, name, email, "emailVerified", image, "createdAt", "updatedAt", role, banned, "banReason", "banExpires")
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [user.id, user.name, user.email, user.emailVerified, user.image, user.createdAt, user.updatedAt,
            user.role, user.banned, user.banReason, user.banExpires]);
        inserted++;
    }
    return { inserted, unchanged };
}
