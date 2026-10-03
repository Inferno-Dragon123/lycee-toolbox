import { validateDeck, compareCodes, parseDeckReference, makeTts } from './deck-format.js';
import { initCommunity } from './community.bundle.js';
import { initSearchFilters } from './search-filters.js';

const $ = id => document.getElementById(id);
const info = new Map();
const DRAFT_KEY = 'lycee-toolbox:draft:v1';
let deck = {}, revision = 0, searchPage = 1, searchPages = 0, searchSerial = 0, loadSerial = 0;
let searchParams = new URLSearchParams();
let searchLoading = false;
let printExporting = false;
let searchFilters;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const total = () => Object.values(deck).reduce((a, b) => a + b, 0);
function status(message, error = false) {
    $('statusDisplay').textContent = message;
    $('statusDisplay').className = 'status' + (error ? ' error' : '');
}
async function request(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
    return data;
}
function remember(cards) { for (const card of cards) info.set(card.code, card); }
function snapshot() { return validateDeck({ name: $('deckNameInput').value, cards: deck }); }
function persist() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ schemaVersion: 1, name: $('deckNameInput').value, cards: deck })); }
    catch { status('浏览器无法保存草稿，请导出卡组文件留存', true); }
}
function changed() {
    revision++;
    $('shareInfo').style.display = 'none';
    const url = new URL(location.href);
    if (url.searchParams.has('deck') || url.searchParams.has('id')) {
        url.searchParams.delete('deck'); url.searchParams.delete('id'); url.searchParams.delete('kid');
        history.replaceState(null, '', url);
    }
    persist(); renderDeck(); updateCounts();
}
function modify(code, delta) {
    if (!info.has(code)) return;
    const count = (deck[code] || 0) + delta;
    if (delta > 0 && (total() >= 200 || count > 60)) { status('卡组最多 200 张，单卡最多 60 张', true); return; }
    if (count <= 0) delete deck[code]; else deck[code] = count;
    changed();
}
function updateCounts() {
    for (const row of $('searchResultArea').querySelectorAll('[data-card]')) {
        const count = deck[row.dataset.card] || 0;
        row.querySelector('.deck-actions span').textContent = count;
        row.querySelector('[data-delta="-1"]').disabled = count === 0;
    }
}
function renderDeck() {
    $('deckTotal').textContent = `${total()} 张`;
    for (const id of ['exportTtsBtn', 'exportPdfBtn', 'exportJsonBtn']) $(id).disabled = !total();
    $('exportPrintPdfBtn').disabled = printExporting || !total();
    $('deckArea').innerHTML = Object.keys(deck).sort(compareCodes).map(code => `
        <div class="deck-item">
            <span class="d-code">${escapeHtml(code)}</span>
            <span class="d-name" title="${escapeHtml(info.get(code)?.name)}">${escapeHtml(info.get(code)?.name || code)}</span>
            <span class="d-count">${deck[code]}</span>
            <button class="btn btn-outline btn-sm" data-code="${code}" data-delta="-1" aria-label="减少 ${code}">−</button>
            <button class="btn btn-outline btn-sm" data-code="${code}" data-delta="1" aria-label="增加 ${code}">+</button>
            <button class="btn btn-outline btn-sm related-card" data-recommend="${code}">加入检索</button>
        </div>`).join('') || '<div class="text-muted" style="padding:20px;text-align:center">卡组为空</div>';
}
function renderResults(cards) {
    $('searchResultArea').innerHTML = cards.map(card => {
        const count = deck[card.code] || 0;
        const stats = [`${card.attribute} / ${card.category} / ${card.rarity}`, `EX ${card.ex ?? '—'}`, `费用 ${card.cost || '0'}`,
            ...['ap', 'dp', 'sp', 'dmg'].filter(k => card[k] !== null).map(k => `${k.toUpperCase()} ${card[k]}`)].join(' · ');
        const effect = (card.effectZh || card.effect || '无效果').replace(/\|/g, '\n');
        return `<div class="search-card" data-card="${card.code}">
            <div class="card-left">
                <a href="${escapeHtml(card.originalImg || card.img)}" target="_blank" rel="noopener"><img src="${escapeHtml(card.thumbnailImg || '/api/image-proxy?url=' + encodeURIComponent(card.img))}" loading="lazy" alt="${escapeHtml(card.name)}"></a>
                <div class="deck-actions">
                    <button class="btn btn-outline btn-sm" data-code="${card.code}" data-delta="1" aria-label="增加 ${card.code}">+</button>
                    <span>${count}</span><button class="btn btn-outline btn-sm" data-code="${card.code}" data-delta="-1" ${count ? '' : 'disabled'} aria-label="减少 ${card.code}">−</button>
                </div>
            </div>
            <div class="card-right">
                <div class="card-header"><span class="card-name">${escapeHtml(card.name)}</span><span class="card-code">${card.code}</span></div>
                <button class="btn btn-outline btn-sm related-card" data-recommend="${card.code}">加入检索</button>
                <div class="text-muted">${escapeHtml(stats)}</div>
                <div class="text-muted">${escapeHtml(card.version)}${card.trait ? ' · ' + escapeHtml(card.trait) : ''}</div>
                ${card.translated ? '' : '<div class="text-muted">暂无中文译文，显示日文原文</div>'}
                <div class="card-effect">${escapeHtml(effect)}</div>
                ${card.team ? `<div class="card-effect">${escapeHtml(card.team)}</div>` : ''}
                <details><summary class="text-muted">日文原文与资料</summary><div class="original-text">${escapeHtml(card.effect)}\n${escapeHtml(card.position)}\n画师：${escapeHtml(card.illustrator)}</div></details>
            </div>
        </div>`;
    }).join('') || '<div class="text-muted" style="padding:24px;text-align:center">未找到卡牌</div>';
    $('searchResultArea').scrollTop = 0;
}
function updateSearchPagination() {
    $('prevPage').disabled = searchLoading || !searchPages || searchPage <= 1;
    $('nextPage').disabled = $('lastPage').disabled = searchLoading || !searchPages || searchPage >= searchPages;
    $('pageJumpInput').disabled = $('pageJumpBtn').disabled = searchLoading || !searchPages;
    $('pageJumpInput').max = searchPages || 1;
}
async function performSearch(page = 1, newSearch = true) {
    const requestedFilters = newSearch ? searchFilters.getParams() : searchParams;
    const serial = ++searchSerial;
    const params = new URLSearchParams(requestedFilters);
    params.set('page', page);
    status('搜索中…');
    searchLoading = true;
    updateSearchPagination();
    try {
        const data = await request(`/api/cards?${params}`);
        if (serial !== searchSerial) return;
        searchParams = requestedFilters;
        searchFilters.markApplied(searchParams);
        remember(data.cards); renderResults(data.cards);
        searchPage = data.page; searchPages = data.pages;
        $('resultCount').textContent = `共 ${data.total} 张`;
        $('pageInfo').textContent = searchPages ? `${searchPage} / ${searchPages} 页` : '0 页';
        $('pageJumpInput').value = searchPages ? searchPage : '';
        $('pageJumpInput').setCustomValidity('');
        status(`找到 ${data.total} 张卡牌`);
    } catch (e) { if (serial === searchSerial) status(`搜索失败：${e.message}`, true); }
    finally { if (serial === searchSerial) { searchLoading = false; updateSearchPagination(); } }
}
async function loadFilters() {
    const data = await request('/api/cards?facets=1');
    searchFilters = initSearchFilters($('filterForm'), $('selectedFilters'), data);
}
async function applyDeck(input, cardInfo, expectedRevision, serial) {
    const next = validateDeck(input);
    if (!cardInfo) cardInfo = (await request('/api/cards?codes=' + encodeURIComponent(Object.keys(next.cards).join(',')))).cards;
    if (revision !== expectedRevision || serial !== loadSerial) throw new Error('卡组已在加载期间改变，请重新加载');
    if (Object.keys(next.cards).some(code => !cardInfo.some(c => c.code === code))) throw new Error('卡牌资料不完整，未替换当前卡组');
    remember(cardInfo); deck = next.cards; $('deckNameInput').value = next.name; changed();
}
function showShare(id) {
    const url = new URL(location.pathname, location.origin); url.searchParams.set('deck', id);
    $('shareInfo').innerHTML = `卡组已保存。分享链接：<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener">${escapeHtml(url.href)}</a>`;
    $('shareInfo').style.display = 'block';
    history.replaceState(null, '', url);
}
async function loadReference(raw) {
    const before = revision, serial = ++loadSerial;
    try {
        const ref = parseDeckReference(raw, location.origin);
        status(ref.type === 'legacy' ? '正在从萌卡社导入旧卡组…' : '正在加载卡组…');
        const url = ref.type === 'local' ? `/api/decks?id=${ref.id}` : ref.type === 'community' ? `/api/community?id=${ref.id}` : `/api/import-deck?type=${ref.type}&id=${ref.id}`;
        const data = await request(url);
        await applyDeck(data, data.cardInfo, before, serial);
        if (ref.type === 'local') showShare(ref.id);
        status(`已加载「${data.name}」，${Object.keys(deck).length} 种，共 ${total()} 张`);
    } catch (e) { status(`加载失败：${e.message}`, true); }
}
async function save() {
    $('saveDeckBtn').disabled = true;
    const before = revision;
    try {
        const data = snapshot(); status('正在保存卡组…');
        const saved = await request('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (before === revision) { showShare(saved.id); status('卡组已保存，可以分享链接'); }
        else status('保存完成；你在保存期间修改了卡组，请再次保存以分享最新内容');
    } catch (e) { status(`保存失败：${e.message}`, true); }
    finally { $('saveDeckBtn').disabled = false; }
}
function download(blob, filename) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function filename(name) { return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'); }
async function exportPdf() {
    $('exportPdfBtn').disabled = true;
    try {
        const data = snapshot(); status('正在生成 PDF 卡表…');
        const response = await fetch('/api/generate-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/octet-stream' }, body: JSON.stringify(data) });
        if (response.status !== 200) throw new Error((await response.json().catch(() => ({}))).error || 'PDF 下载响应异常，请稍后重试');
        const blob = await response.blob();
        if (!blob.size) throw new Error('PDF 下载为空，请稍后重试');
        download(new Blob([blob], { type: 'application/pdf' }), filename(data.name) + '.pdf');
        status(response.headers.get('X-Missing-Images') !== '0' ? 'PDF 已导出，部分卡图下载失败，已保留文字卡表' : 'PDF 卡表已导出');
    } catch (e) { status(e.message, true); }
    finally { $('exportPdfBtn').disabled = !total(); }
}

async function exportPrintPdf() {
    if (printExporting) return;
    printExporting = true;
    $('exportPrintPdfBtn').disabled = true;
    try {
        const data = snapshot();
        status('正在准备打印卡图…');
        const [{ createPrintPdf }, result] = await Promise.all([
            import('./print-pdf.bundle.js'),
            request('/api/cards?' + new URLSearchParams({ codes: Object.keys(data.cards).join(',') }))
        ]);
        const output = await createPrintPdf(data, result.cards, {
            onProgress: (done, count) => status(`正在准备打印卡图 ${done}/${count}…`)
        });
        download(output.blob, filename(data.name) + '-打印卡图.pdf');
        status(`打印 PDF 已导出：${output.count} 张卡，${output.pages} 页。请用 A4 纸，选择“实际大小／100%”打印。`);
    } catch (e) { status(e.message || '打印 PDF 导出失败，请重试', true); }
    finally { printExporting = false; $('exportPrintPdfBtn').disabled = !total(); }
}

for (const id of ['searchResultArea', 'deckArea']) $(id).addEventListener('click', e => {
    const button = e.target.closest('button[data-delta]');
    if (button) modify(button.dataset.code, Number(button.dataset.delta));
});
$('searchBtn').addEventListener('click', () => performSearch());
$('filterForm').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) performSearch(); });
$('clearSearchBtn').addEventListener('click', () => {
    searchFilters?.clear();
    performSearch();
});
$('prevPage').addEventListener('click', () => performSearch(searchPage - 1, false));
$('nextPage').addEventListener('click', () => performSearch(searchPage + 1, false));
$('lastPage').addEventListener('click', () => performSearch(searchPages, false));
$('pageJumpInput').addEventListener('input', () => $('pageJumpInput').setCustomValidity(''));
$('pageJumpForm').addEventListener('submit', e => {
    e.preventDefault();
    if (searchLoading || !searchPages) return;
    const input = $('pageJumpInput'), raw = input.value.trim(), page = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(page) || page < 1 || page > searchPages) {
        input.setCustomValidity(`请输入 1～${searchPages} 之间的整数页码`);
        input.reportValidity();
        return;
    }
    if (page !== searchPage) performSearch(page, false);
});
$('deckNameInput').addEventListener('input', changed);
$('clearDeckBtn').addEventListener('click', () => { deck = {}; $('deckNameInput').value = ''; changed(); status('卡组已清空'); });
$('saveDeckBtn').addEventListener('click', save);
$('restoreBeforeImport').addEventListener('click', async () => {
    try {
        const raw = localStorage.getItem('lycee-toolbox:before-community-import');
        if (!raw) throw new Error('暂无导入前草稿');
        if (total() && !confirm('恢复会替换当前组卡器，是否继续？')) return;
        const previous = JSON.parse(raw);
        if (!Object.keys(previous.cards || {}).length) { deck = {}; $('deckNameInput').value = previous.name || ''; changed(); }
        else await applyDeck(previous, null, revision, ++loadSerial);
        status('已恢复导入前草稿');
    } catch (e) { status(e.message, true); }
});
$('loadDeckBtn').addEventListener('click', () => loadReference($('loadDeckInput').value));
$('loadDeckInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('loadDeckBtn').click(); });
$('exportPdfBtn').addEventListener('click', exportPdf);
$('exportPrintPdfBtn').addEventListener('click', exportPrintPdf);
$('exportTtsBtn').addEventListener('click', () => {
    try { const data = snapshot(); download(new Blob([JSON.stringify(makeTts(data, info), null, 2)], { type: 'application/json' }), filename(data.name) + '-tts.json'); status('TTS 文件已导出'); }
    catch (e) { status(e.message, true); }
});
$('exportJsonBtn').addEventListener('click', () => {
    try { const data = snapshot(); download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename(data.name) + '.lycee.json'); status('卡组文件已导出'); }
    catch (e) { status(e.message, true); }
});
$('importJsonBtn').addEventListener('click', () => $('deckFileInput').click());
$('deckFileInput').addEventListener('change', async e => {
    const file = e.target.files[0], before = revision, serial = ++loadSerial;
    if (!file) return;
    try {
        if (file.size > 32768) throw new Error('文件过大，请选择本站导出的 .lycee.json 卡组文件');
        await applyDeck(JSON.parse(await file.text()), null, before, serial);
        status(`已导入卡组文件，共 ${total()} 张`);
    } catch (err) { status(`导入失败：${err.message}`, true); }
    finally { e.target.value = ''; }
});

async function init() {
    renderDeck();
    try { await loadFilters(); await performSearch(); } catch (e) { status(`初始化失败：${e.message}，请刷新重试`, true); }
    const params = new URLSearchParams(location.search);
    if (params.has('deck') || params.has('id')) { await loadReference(location.href); return; }
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw) {
            const draft = JSON.parse(raw);
            if (Object.keys(draft.cards || {}).length) {
                await applyDeck(draft, null, revision, ++loadSerial);
                status(`已恢复本机草稿，共 ${total()} 张`);
            } else if (typeof draft.name === 'string') $('deckNameInput').value = draft.name;
        }
    } catch (e) { status(`草稿恢复失败：${e.message}。原草稿仍保留在浏览器中`, true); }
}
init().then(() => initCommunity({ snapshot, async importDeck(input) {
    if (total() && !confirm('导入会替换当前组卡器。是否继续？原草稿会保留为可恢复备份。')) throw new Error('已取消导入，当前卡组保持不变');
    try { localStorage.setItem('lycee-toolbox:before-community-import', JSON.stringify({ schemaVersion: 1, name: $('deckNameInput').value, cards: deck })); }
    catch { throw new Error('无法备份当前草稿，请先导出卡组文件'); }
    await applyDeck(input, input.cardInfo, revision, ++loadSerial);
    status(`已导入「${input.name}」。原草稿可通过“恢复导入前草稿”找回。`);
} })).catch(e => status(`社区初始化失败：${e.message}`, true));
