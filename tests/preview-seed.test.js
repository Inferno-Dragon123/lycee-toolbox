import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPreviewTarget, seedPreview } from '../scripts/seed-preview.js';

test('preview seed cannot target production or reuse its source database', () => {
    const source = 'postgres://localhost/lycee_production';
    assertPreviewTarget(source, 'postgres://localhost/lycee_preview_012345abcdef', 'preview');
    assert.throws(() => assertPreviewTarget(source, source, 'preview'));
    assert.throws(() => assertPreviewTarget(source, 'postgres://localhost/lycee_preview_012345abcdef', 'production'));
    assert.throws(() => assertPreviewTarget('postgres://user@localhost/lycee_preview_012345abcdef', 'postgres://other@localhost/lycee_preview_012345abcdef', 'preview'));
});

test('preview seeds only approved official rows and refuses to replace existing preview data', async () => {
    const sourceQueries = [], targetQueries = [];
    const source = { async query(sql) {
        sourceQueries.push(sql);
        if (sql.includes('SELECT * FROM toolbox_publications')) return { rows: [{ id: 'p_official', snapshot_id: 'd_official', owner_id: null, source: 'official_user' }] };
        if (sql.includes('SELECT d.*')) return { rows: [{ id: 'd_official' }] };
        return { rows: [] };
    } };
    const target = { async query(sql) {
        targetQueries.push(sql);
        if (sql.includes('AS total')) return { rows: [{ total: '1' }] };
        return { rows: [] };
    } };
    await assert.rejects(seedPreview(source, target), /empty preview/);
    assert(sourceQueries.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
    assert(sourceQueries.some(sql => sql.includes('AND status = \'public\' AND NOT moderated AND owner_id IS NULL')));
    assert(!sourceQueries.some(sql => /SELECT.*(?:toolbox_profiles|toolbox_auth_|neon_auth|toolbox_sync_state)/.test(sql)));
    assert(!targetQueries.some(sql => sql.startsWith('INSERT') || sql.includes('DELETE')));
    assert(targetQueries.includes('ROLLBACK'));
});
