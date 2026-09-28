import { createAuthClient } from '@neondatabase/auth';
import { baseCode, sourceLabels, publicationInput, PUBLICATION_ID, selectedCodes, validateNickname } from './community-format.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ownLink = id => `${location.origin}/?publication=${encodeURIComponent(id)}`;
async function request(url, options) {
    const response = await fetch(url, options), data = await response.json();
    if (!response.ok) throw new Error(data.error || data.message || '请求失败，请稍后重试');
    return data;
}
export async function initCommunity(editor) {
    const auth = createAuthClient(`${location.origin}/api/auth`);
    let user = null, profile = null, admin = false, mode = 'public', page = 1, selected = [], serial = 0, previewSerial = 0;
    let items = [], editing = null, publishing = null, preview = null, otpUntil = 0;
    const message = (text, error = false) => {
        $('communityStatus').textContent = text;
        $('communityStatus').className = 'status' + (error ? ' error' : '');
    };
    function enabled() { return $('recommendEnabled').checked; }
    function openLogin() { $('loginMessage').textContent = ''; $('loginDialog').showModal(); }
    function setMode(next) { mode = next; page = 1; return refresh(); }
    function renderSelection() {
        $('recommendControls').hidden = !enabled();
        $('selectedRecommendations').innerHTML = selected.map(code => `<button class="btn btn-outline btn-sm" data-remove-recommend="${code}" aria-label="移除 ${code}">${code} ×</button>`).join('') || '<span class="text-muted">尚未选择卡牌</span>';
        $('recommendCount').textContent = `${selected.length} / 10`;
    }
    function showAccount() {
        $('accountLabel').textContent = user ? `已登录：${profile?.displayName || '玩家'}` : '未登录';
        $('profileBtn').hidden = !user;
    }
    async function refresh() {
        const version = ++serial;
        $('communityResults').scrollTop = 0;
        $('communityHeading').textContent = { public: '公开卡组', mine: '我的上传', recommend: `包含${$('recommendMatch').value === 'all' ? '全部' : '任意'}所选卡牌的卡组`, moderation: '管理公开内容' }[mode];
        $('communityPrev').disabled = $('communityNext').disabled = true;
        if ((mode === 'mine' || mode === 'moderation') && !user) { $('communityResults').textContent = '登录后查看和管理自己的上传。'; return; }
        if (mode === 'recommend' && (!enabled() || !selected.length)) { $('communityResults').textContent = '点击卡牌旁的“加入推荐”，或输入卡号添加筛选条件。'; $('communityPage').textContent = ''; message('可选择多张卡，默认查找同时包含所有所选卡牌的卡组。'); return; }
        const params = new URLSearchParams({ page });
        if (mode === 'mine') params.set('mine', '1');
        if (mode === 'moderation') params.set('moderation', '1');
        if (mode === 'recommend') { params.set('codes', selected.join(',')); params.set('match', $('recommendMatch').value); }
        if ($('communitySource').value) params.set('source', $('communitySource').value);
        message('正在读取卡组…');
        try {
            const data = await request(`/api/community?${params}`);
            if (version !== serial) return;
            items = data.items;
            $('communityResults').innerHTML = items.map(item => `<article class="community-item" data-publication="${item.id}">
                <div><a class="community-title" href="${ownLink(item.id)}">${escape(item.name)}</a>
                <p class="text-muted">${escape(sourceLabels[item.source])} · ${escape(item.author_name)}${item.author_tag && item.author_tag !== item.author_name ? `（${escape(item.author_tag)}）` : ''} · ${new Date(item.updated_at).toLocaleDateString('zh-CN')}${item.status !== 'public' ? ' · 已下架' : ''}${item.moderated ? ' · 管理员下架' : ''}</p>
                ${item.description ? `<p class="community-description">${escape(item.description)}</p>` : ''}</div>
                <div class="flex-wrap"><a href="${escape(item.source_url || ownLink(item.id))}" target="_blank" rel="noopener">${item.source_url ? '官网原链接' : '卡组链接'}</a>
                <button class="btn btn-outline" data-action="preview">预览</button><button class="btn btn-primary" data-action="import">导入卡组</button>
                ${mode === 'mine' ? `<button class="btn btn-outline" data-action="edit">编辑</button><button class="btn btn-outline" data-action="${item.status === 'public' ? 'unpublish' : 'publish'}">${item.status === 'public' ? '下架' : '重新公开'}</button><button class="btn btn-danger" data-action="delete">删除</button>` : ''}
                ${admin ? `<button class="btn btn-outline" data-action="${item.moderated ? 'unhide' : 'hide'}">${item.moderated ? '解除管理下架' : '管理下架'}</button>` : ''}</div></article>`).join('') || '<p class="text-muted">暂无卡组。官网资料正在逐步收录，当前结果不代表官网全部卡组。</p>';
            $('communityPage').textContent = `第 ${page} 页`;
            $('communityResults').scrollTop = 0;
            $('communityPrev').disabled = page <= 1;
            $('communityNext').disabled = !data.hasMore;
            message(mode === 'recommend' ? '按基础卡号匹配，同编号不同卡面均包含在结果中。' : '卡组由玩家公开发布，官网来源单独标注。');
        } catch (e) { if (version === serial) { $('communityResults').textContent = ''; message(e.message, true); } }
    }
    async function updateSession() {
        const result = await auth.getSession();
        if (result.error) throw new Error('登录服务暂时不可用，请稍后重试');
        user = result.data?.user || null;
        const session = user ? await request('/api/community?session=1') : { admin: false };
        admin = Boolean(session.admin);
        profile = session.profile || null; showAccount();
        $('loginBtn').hidden = Boolean(user); $('logoutBtn').hidden = !user; $('moderationBtn').hidden = !admin;
    }
    async function detail(id) { return request('/api/community?id=' + encodeURIComponent(id)); }
    async function importItem(item) {
        if (item.missing?.length) throw new Error(`本地卡库缺少 ${item.missing.join('、')}，请等待卡库更新后导入`);
        await editor.importDeck(item);
        message(`已导入「${item.name}」`);
    }
    async function showPreview(id) {
        const version = ++previewSerial;
        preview = null; $('previewTitle').textContent = '正在加载…'; $('previewCards').textContent = ''; $('previewDescription').textContent = '';
        $('previewImport').disabled = true;
        if (!$('previewDialog').open) $('previewDialog').showModal();
        try {
            const item = await detail(id);
            if (version !== previewSerial || !$('previewDialog').open) return;
            preview = item;
            $('previewTitle').textContent = `${item.name} · ${Object.values(item.cards).reduce((a, b) => a + b, 0)} 张`;
            $('previewDescription').textContent = item.description || '';
            const info = new Map(item.cardInfo.map(card => [card.code, card]));
            $('previewCards').innerHTML = Object.entries(item.cards).map(([code, quantity]) => {
                const card = info.get(code);
                return `<div class="preview-card">${card ? `<img loading="lazy" src="/api/image-proxy?url=${encodeURIComponent(card.img)}" alt="${escape(card.name)}">` : '<div class="preview-missing">卡库暂未收录</div>'}<strong>${escape(code)} × ${quantity}</strong><span>${escape(card?.name || '')}</span></div>`;
            }).join('');
            $('previewNote').textContent = item.missing.length ? `缺少卡牌资料：${item.missing.join('、')}，暂不可导入。` : '预览不会更改当前组卡器。';
            $('previewImport').disabled = Boolean(item.missing.length);
        } catch (e) { $('previewTitle').textContent = '无法预览'; $('previewNote').textContent = e.message; }
    }
    function showPublish(input, existing = null) {
        if (!user) { openLogin(); return; }
        editing = existing; publishing = input;
        $('publishTitle').textContent = existing ? '编辑已发布卡组' : '发布当前卡组';
        $('publicationName').value = input.name === '未命名卡组' ? '' : input.name;
        $('publicationDescription').value = existing?.description || '';
        $('replacePublishedCards').checked = false; $('replacePublishedLabel').hidden = !existing;
        $('publishMessage').textContent = `${Object.values(input.cards).reduce((a, b) => a + b, 0)} 张。发布后其他用户可以查看和导入。`;
        $('publishDialog').showModal();
    }
    async function mutate(item, action) {
        if (!confirm(action === 'delete' ? '删除这条发布记录？已有分享快照和他人导入的副本不受影响。' : '确认更改这条卡组的公开状态？')) return;
        await request('/api/community', { method: action === 'delete' ? 'DELETE' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, version: item.version, action }) });
        await refresh();
    }
    $('communityResults').addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const item = items.find(item => item.id === button.closest('[data-publication]').dataset.publication);
        if (!item) return;
        button.disabled = true;
        try {
            if (button.dataset.action === 'preview') await showPreview(item.id);
            else if (button.dataset.action === 'import') await importItem(await detail(item.id));
            else if (button.dataset.action === 'edit') { const data = await detail(item.id); showPublish(data, data); }
            else await mutate(item, button.dataset.action);
        } catch (e) { message(e.message, true); }
        finally { button.disabled = false; }
    });
    for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => $(button.dataset.closeDialog).close());
    $('previewDialog').addEventListener('close', () => { previewSerial++; preview = null; });
    $('previewImport').addEventListener('click', async () => {
        if (!preview) return;
        $('previewImport').disabled = true;
        try { await importItem(preview); $('previewDialog').close(); }
        catch (e) { $('previewNote').textContent = e.message; }
        finally { $('previewImport').disabled = Boolean(preview?.missing.length); }
    });
    $('publishDeckBtn').addEventListener('click', () => { try { showPublish(editor.snapshot()); } catch (e) { message(e.message, true); } });
    $('publishForm').addEventListener('submit', async event => {
        event.preventDefault(); $('confirmPublish').disabled = true;
        try {
            const input = { ...(editing && $('replacePublishedCards').checked ? editor.snapshot() : publishing), name: $('publicationName').value, description: $('publicationDescription').value };
            publicationInput(input);
            const saved = await request('/api/community', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editing ? { ...input, id: editing.id, version: editing.version, action: 'edit' } : input) });
            $('publishDialog').close(); $('communitySource').value = ''; await setMode('mine'); message(`卡组已${editing ? '更新' : '公开发布'}，可在“我的上传”管理。`);
            $('communityPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { $('publishMessage').textContent = e.message; }
        finally { $('confirmPublish').disabled = false; }
    });
    $('loginBtn').addEventListener('click', openLogin);
    $('profileBtn').addEventListener('click', () => {
        $('profileNickname').value = profile?.nickname || '';
        $('profileMessage').textContent = profile?.playerTag || '';
        $('profileDialog').showModal();
    });
    $('profileForm').addEventListener('submit', async event => {
        event.preventDefault(); $('saveProfile').disabled = true;
        try {
            const nickname = validateNickname($('profileNickname').value);
            const result = await request('/api/community', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'profile', nickname }) });
            profile = result.profile; showAccount(); $('profileDialog').close(); await refresh(); message('昵称已更新，过去发布的卡组也会显示新昵称。');
        } catch (e) { $('profileMessage').textContent = e.message; }
        finally { $('saveProfile').disabled = false; }
    });
    $('sendOtp').addEventListener('click', async () => {
        if (!$('loginEmail').reportValidity() || Date.now() < otpUntil) return;
        $('sendOtp').disabled = true;
        try {
            const result = await auth.emailOtp.sendVerificationOtp({ email: $('loginEmail').value.trim(), type: 'sign-in' });
            if (result.error) throw new Error(result.error.message || '验证码发送失败');
            otpUntil = Date.now() + 60000;
            $('loginMessage').textContent = '验证码已发送，请检查收件箱或垃圾邮件；60 秒后可重新发送。';
            setTimeout(() => { $('sendOtp').disabled = false; }, 60000);
            $('loginOtp').focus();
        } catch (e) { $('loginMessage').textContent = e.message; $('sendOtp').disabled = false; }
    });
    $('loginForm').addEventListener('submit', async event => {
        event.preventDefault(); $('verifyOtp').disabled = true;
        try {
            const result = await auth.signIn.emailOtp({ email: $('loginEmail').value.trim(), otp: $('loginOtp').value.trim() });
            if (result.error) throw new Error(result.error.message || '验证码错误或已过期');
            await updateSession(); $('loginOtp').value = ''; $('loginDialog').close(); await refresh(); message('登录成功，可以发布和管理卡组。');
        } catch (e) { $('loginMessage').textContent = e.message; }
        finally { $('verifyOtp').disabled = false; }
    });
    $('logoutBtn').addEventListener('click', async () => {
        try { const result = await auth.signOut(); if (result.error) throw new Error('退出失败，请重试'); await updateSession(); await setMode('public'); }
        catch (e) { message(e.message, true); }
    });
    $('browseDecksBtn').addEventListener('click', () => setMode('public'));
    $('myUploadsBtn').addEventListener('click', () => { if (!user) openLogin(); else { $('communitySource').value = ''; setMode('mine'); } });
    $('moderationBtn').addEventListener('click', () => setMode('moderation'));
    $('communitySource').addEventListener('change', () => { page = 1; refresh(); });
    $('communityRefresh').addEventListener('click', refresh);
    $('communityPrev').addEventListener('click', () => { page--; refresh(); });
    $('communityNext').addEventListener('click', () => { page++; refresh(); });
    $('recommendEnabled').addEventListener('change', () => {
        document.body.classList.toggle('recommend-enabled', enabled());
        renderSelection();
        try { localStorage.setItem('lycee:recommend', enabled() ? '1' : '0'); } catch { /* optional preference */ }
        setMode(enabled() ? 'recommend' : 'public');
    });
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-recommend]');
        if (!button || !enabled()) return;
        try { selected = selectedCodes([...selected, button.dataset.recommend]); renderSelection(); setMode('recommend'); }
        catch (e) { message(e.message, true); }
    });
    $('selectedRecommendations').addEventListener('click', event => {
        const button = event.target.closest('[data-remove-recommend]');
        if (!button) return;
        selected = selected.filter(code => code !== button.dataset.removeRecommend); renderSelection(); setMode('recommend');
    });
    $('recommendForm').addEventListener('submit', event => {
        event.preventDefault();
        try { selected = selectedCodes([...selected, ...$('recommendCodesInput').value.split(/[\s,，]+/).filter(Boolean)]); $('recommendCodesInput').value = ''; renderSelection(); setMode('recommend'); }
        catch (e) { message(e.message, true); }
    });
    $('clearRecommendations').addEventListener('click', () => { selected = []; renderSelection(); setMode('recommend'); });
    $('recommendMatch').addEventListener('change', () => setMode('recommend'));
    $('showRecommendations').addEventListener('click', () => setMode('recommend'));
    try { $('recommendEnabled').checked = localStorage.getItem('lycee:recommend') === '1'; } catch { /* optional preference */ }
    document.body.classList.toggle('recommend-enabled', enabled());
    renderSelection();
    try { await updateSession(); } catch (e) { message(e.message, true); }
    await refresh();
    const linked = new URLSearchParams(location.search).get('publication');
    if (linked && PUBLICATION_ID.test(linked)) await showPreview(linked);
}
