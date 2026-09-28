// Pure queue policy shared by the scheduled crawler and regression tests.
export function queueEntries(state, entries, existing, now = Date.now()) {
    const queued = new Set(state.pending.map(entry => entry.key));
    for (const entry of entries) {
        if (queued.has(entry.key)) continue;
        const synced = existing.get(entry.key);
        if (synced && now - new Date(synced).getTime() < 7 * 86400000) continue;
        state.pending.push(entry);
        queued.add(entry.key);
    }
}

export function dueEntries(state, limit, now = Date.now()) {
    return state.pending.filter(entry => !entry.retryAt || Date.parse(entry.retryAt) <= now).slice(0, limit);
}

export function failEntry(state, entry, message, now = Date.now()) {
    const attempts = (entry.attempts || 0) + 1;
    const retryAt = new Date(now + Math.min(7 * 86400000, 3600000 * 2 ** Math.min(attempts - 1, 8))).toISOString();
    state.pending = [...state.pending.filter(item => item.key !== entry.key),
        { ...entry, attempts, retryAt, error: String(message).slice(0, 300) }];
}
