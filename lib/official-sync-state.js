// Pure queue policy shared by the scheduled crawler and regression tests.
const sources = ['user', 'festa'];
const validPage = page => Number.isSafeInteger(page) && page >= 1;

// The former combined list's cursor cannot address either source's pagination.
// Retain its pending/retry queue while starting each independent list at page 1.
export function initializeSourceState(state) {
    state.sourcePages = Object.fromEntries(sources.map(source =>
        [source, validPage(state.sourcePages?.[source]) ? state.sourcePages[source] : 1]));
    if (!sources.includes(state.nextSource)) state.nextSource = sources[0];
    state.page = state.sourcePages[state.nextSource];
    return state;
}

// Each run revisits both recent pages before using remaining requests to resume
// old pages. A one-page run rotates sources without increasing its page budget.
export function nextDiscoveryPage(state, visitedRecent, pageBudget, detailLimit, now = Date.now()) {
    if (pageBudget < 1) return null;
    const ordered = [state.nextSource, ...sources.filter(source => source !== state.nextSource)];
    const recent = ordered.find(source => !visitedRecent.has(source));
    if (recent) return { source: recent, page: 1 };
    if (dueEntries(state, detailLimit, now).length >= detailLimit) return null;
    const older = ordered.find(source => state.sourcePages[source] > 1);
    return older ? { source: older, page: state.sourcePages[older] } : null;
}

export function advanceSourcePage(state, source, page, next, allOld) {
    if (allOld || (page === 1 && !next)) state.sourcePages[source] = 1;
    else if (page === state.sourcePages[source]) state.sourcePages[source] = validPage(next) ? next : 1;
    state.nextSource = sources.find(other => other !== source);
    state.page = state.sourcePages[state.nextSource];
}

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
