import { createSiteAuthClient } from './auth-client.js';
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
    const auth = createSiteAuthClient();
    let user = null, profile = null, admin = false, mode = 'public', page = 1, pages = 0, total = 0, selected = [], serial = 0, previewSerial = 0;
    let items = [], editing = null, publishing = null, preview = null, otpUntil = 0;
    let loading = false, appliedFilters = new URLSearchParams();
    const attributes = ['雪', '月', '花', '宙', '日', '他'];
    const filters = new Map();
    const message = (text, error = false) => {
        $('communityStatus').textContent = text;
        $('communityStatus').className = 'status' + (error ? ' error' : '');
    };
    function openLogin() { $('loginMessage').textContent = ''; $('loginDialog').showModal(); }
    function setMode(next) { return applySearch(next); }
    function renderSelection() {
        $('selectedRecommendations').innerHTML = selected.map(code => `<button class="btn btn-outline btn-sm" data-remove-recommend="${code}" aria-label="移除 ${code}">${code} ×</button>`).join('') || '<span class="text-muted">尚未选择卡牌</span>';
        $('recommendCount').textContent = `${selected.length} / 10`;
    }
    function updateFilterState() {
        try { $('communityFilterState').textContent = readFilters(false).toString() === appliedFilters.toString() ? '已应用' : '待检索'; }
        catch { $('communityFilterState').textContent = '待检索'; }
        renderSelectedFilters();
        $('communitySelectedFiltersHint').textContent = $('communityFilterState').textContent === '待检索'
            ? '条件已修改，点击“检索”应用；翻页和刷新仍使用上次检索条件。'
            : '当前结果使用以下条件；点击 × 移除后，再点击“检索”应用。';
    }
    function renderSelectedFilters() {
        const chips = [];
        const chip = (name, value, label) => chips.push(`<button type="button" class="community-filter-chip" data-remove-community-filter="${escape(name)}" data-value="${escape(value)}" aria-label="移除${escape(label)}">${escape(label)}<span aria-hidden="true">×</span></button>`);
        const source = $('communitySource');
        if (source.value) chip('source', source.value, `来源：${source.selectedOptions[0].textContent}`);
        for (const state of filters.values()) {
            for (const option of state.options) if (state.selected.has(option.value)) chip(state.name, option.value, `${state.label}：${option.label}`);
        }
        for (const attribute of attributes) {
            const lower = $(`communityAttr${attribute}min`).value.trim(), upper = $(`communityAttr${attribute}max`).value.trim();
            if (lower || upper) chip('range', attribute, `${attribute}数量：${lower || '不限'}～${upper || '不限'}`);
        }
        for (const code of selected) chip('code', code, `卡牌：${code}`);
        if (selected.length) {
            if ($('recommendMatch').value === 'any') chip('match', 'any', '匹配方式：任意包含');
            else chips.push('<span class="community-filter-chip community-filter-chip-static">匹配方式：全部包含</span>');
        }
        $('communitySelectedFilters').innerHTML = chips.join('') || '<span class="text-muted">暂无筛选条件</span>';
    }
    function multiSelect(id, name, label, options) {
        const host = $(id), state = { name, label, options, selected: new Set(), host };
        filters.set(name, state);
        function render() {
            const labels = state.options.filter(option => state.selected.has(option.value)).map(option => option.label);
            const expanded = host.querySelector('.community-filter-trigger')?.getAttribute('aria-expanded') === 'true';
            host.innerHTML = `<span class="community-filter-label" id="${id}Label">${escape(label)}</span><button id="${id}Trigger" type="button" class="community-filter-trigger${labels.length ? ' has-selection' : ''}" aria-labelledby="${id}Label ${id}TriggerText" aria-expanded="${expanded}" aria-controls="${id}Options"><span id="${id}TriggerText">${escape(labels.join('、') || '全部')}</span><span aria-hidden="true">▾</span></button><div id="${id}Options" class="community-filter-options" role="group" aria-label="${escape(label)}，可多选"${expanded ? '' : ' hidden'}>${state.options.map(option => `<button type="button" class="community-filter-option" data-deck-filter="${name}" data-value="${escape(option.value)}" aria-pressed="${state.selected.has(option.value)}"><span aria-hidden="true">✓</span>${escape(option.label)}</button>`).join('') || '<span class="community-filter-empty">正在读取选项…</span>'}</div>`;
        }
        state.render = render;
        state.updateOptions = options => { state.options = options; render(); };
        host.addEventListener('click', event => {
            const option = event.target.closest('[data-deck-filter]');
            const trigger = $(`${id}Trigger`), list = $(`${id}Options`);
            if (option) {
                const value = option.dataset.value;
                if (state.selected.has(value)) state.selected.delete(value); else state.selected.add(value);
                option.setAttribute('aria-pressed', String(state.selected.has(value)));
                const labels = state.options.filter(option => state.selected.has(option.value)).map(option => option.label);
                $(`${id}TriggerText`).textContent = labels.join('、') || '全部';
                trigger.classList.toggle('has-selection', Boolean(labels.length));
                updateFilterState();
            } else if (event.target.closest(`#${id}Trigger`)) {
                const open = list.hidden;
                closeDropdowns(); list.hidden = !open; trigger.setAttribute('aria-expanded', String(open));
                if (open && (event.detail === 0 || event.pointerType === 'mouse' || (!event.pointerType && matchMedia('(hover: hover) and (pointer: fine)').matches))) list.querySelector('button')?.focus({ preventScroll: true });
            }
        });
        host.addEventListener('keydown', event => {
            if (event.key === 'Escape') { closeDropdowns(); $(`${id}Trigger`).focus(); }
        });
        render();
        return state;
    }
    function closeDropdowns() {
        for (const state of filters.values()) {
            state.host.querySelector('.community-filter-options').hidden = true;
            state.host.querySelector('.community-filter-trigger').setAttribute('aria-expanded', 'false');
        }
    }
    function readFilters(validate = true) {
        const params = new URLSearchParams();
        if ($('communitySource').value) params.set('source', $('communitySource').value);
        for (const state of filters.values()) for (const option of state.options) if (state.selected.has(option.value)) params.append(state.name, option.value);
        for (const attribute of attributes) {
            const bounds = {};
            for (const bound of ['min', 'max']) {
                const input = $(`communityAttr${attribute}${bound}`), raw = input.value.trim();
                if (validate) input.setCustomValidity('');
                if (!raw && !input.validity.badInput) continue;
                if (!/^\d+$/.test(raw) || Number(raw) > 200) {
                    const error = `${attribute}属性${bound === 'min' ? '下限' : '上限'}须为 0～200 的整数`;
                    if (validate) { input.setCustomValidity(error); input.reportValidity(); }
                    throw new Error(error);
                }
                bounds[bound] = Number(raw); params.set(`attr_${attribute}_${bound}`, String(bounds[bound]));
            }
            if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max) {
                const input = $(`communityAttr${attribute}max`), error = `${attribute}属性的下限不能大于上限`;
                if (validate) { input.setCustomValidity(error); input.reportValidity(); }
                throw new Error(error);
            }
        }
        if (selected.length) { params.set('codes', selected.join(',')); params.set('match', $('recommendMatch').value); }
        return params;
    }
    async function applySearch(nextMode = mode) {
        try { await refresh(1, readFilters(), nextMode); }
        catch (e) { message(e.message, true); }
    }
    function clearFilters() {
        selected = []; $('communitySource').value = ''; $('recommendMatch').value = 'all'; $('recommendCodesInput').value = '';
        for (const state of filters.values()) { state.selected.clear(); state.render(); }
        for (const input of $('communityAttributeRanges').querySelectorAll('input')) { input.value = ''; input.setCustomValidity(''); }
        renderSelection(); updateFilterState();
    }
    function updatePagination() {
        const empty = pages < 1;
        $('communityPrev').disabled = loading || empty || page <= 1;
        $('communityNext').disabled = $('communityLast').disabled = loading || empty || page >= pages;
        $('communityPageInput').disabled = $('communityPageJump').disabled = loading || empty;
        $('communityPageInput').max = String(Math.max(1, pages));
        $('communityRefresh').disabled = $('showRecommendations').disabled = loading;
    }
    function compositionMarkup(composition) {
        if (!composition) return '';
        const type = { single: '系列单', mix: '混成', unknown: '系列资料不足' }[composition.type] || '系列资料不足';
        const series = composition.type === 'single' && composition.series?.length ? ` · ${composition.series.map(escape).join('、')}` : '';
        const counts = composition.attributesKnown === false ? '<span>属性资料不全</span>' : attributes.map(attribute => `<span>${attribute}：${Number(composition.counts?.[attribute]) || 0}</span>`).join('');
        return `<div class="community-composition"><strong>[${type}${series}]</strong>${counts}</div>`;
    }
    function titleMarkup(item) {
        let officialUrl = null;
        if (item.source !== 'community' && item.source_url) {
            try {
                const url = new URL(item.source_url);
                if (url.protocol === 'https:' && url.hostname === 'lycee-tcg.com' && !url.username && !url.password) officialUrl = url.href;
            } catch { /* Invalid source links fall back to the local preview. */ }
        }
        return `<a class="community-title" href="${escape(officialUrl || ownLink(item.id))}"${officialUrl ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escape(item.name)}</a>`;
    }
    function showAccount() {
        $('accountLabel').textContent = user ? `已登录：${profile?.displayName || '玩家'}` : '未登录';
        $('profileBtn').hidden = !user;
    }
    async function refresh(targetPage = page, queryFilters = appliedFilters, targetMode = mode) {
        if ((targetMode === 'mine' || targetMode === 'moderation') && !user) { openLogin(); return; }
        const version = ++serial;
        loading = true; updatePagination();
        const params = new URLSearchParams(queryFilters); params.set('page', targetPage);
        if (targetMode === 'mine') params.set('mine', '1');
        if (targetMode === 'moderation') params.set('moderation', '1');
        message('正在读取卡组…');
        try {
            const data = await request(`/api/community?${params}`);
            if (version !== serial) return;
            mode = targetMode; appliedFilters = new URLSearchParams(queryFilters);
            page = data.page || targetPage; pages = data.pages ?? (data.items.length ? page + (data.hasMore ? 1 : 0) : 0); total = data.total ?? data.items.length;
            items = data.items;
            $('communityHeading').textContent = { public: '公开卡组检索结果', mine: '我的上传检索结果', moderation: '管理公开内容' }[mode];
            $('browseDecksBtn').className = 'btn ' + (mode === 'public' ? 'btn-primary' : 'btn-outline');
            $('myUploadsBtn').className = 'btn ' + (mode === 'mine' ? 'btn-primary' : 'btn-outline');
            $('communityResults').innerHTML = items.map(item => `<article class="community-item" data-publication="${item.id}">
                <div>${titleMarkup(item)}
                <p class="text-muted">${escape(sourceLabels[item.source])} · ${escape(item.author_name)}${item.author_tag && item.author_tag !== item.author_name ? `（${escape(item.author_tag)}）` : ''} · ${new Date(item.updated_at).toLocaleDateString('zh-CN')}${item.status !== 'public' ? ' · 已下架' : ''}${item.moderated ? ' · 管理员下架' : ''}</p>
                ${compositionMarkup(item.composition)}
                ${item.description ? `<p class="community-description">${escape(item.description)}</p>` : ''}</div>
                <div class="flex-wrap"><button class="btn btn-outline" data-action="preview">预览</button><button class="btn btn-primary" data-action="import">导入卡组</button>
                ${mode === 'mine' ? `<button class="btn btn-outline" data-action="edit">编辑</button><button class="btn btn-outline" data-action="${item.status === 'public' ? 'unpublish' : 'publish'}">${item.status === 'public' ? '下架' : '重新公开'}</button><button class="btn btn-danger" data-action="delete">删除</button>` : ''}
                ${admin ? `<button class="btn btn-outline" data-action="${item.moderated ? 'unhide' : 'hide'}">${item.moderated ? '解除管理下架' : '管理下架'}</button>` : ''}</div></article>`).join('') || '<p class="text-muted">暂无卡组。官网资料正在逐步收录，当前结果不代表官网全部卡组。</p>';
            $('communityPage').textContent = `共 ${total} 套 · ${pages ? page : 0} / ${pages} 页`;
            $('communityPageInput').value = pages ? String(page) : '';
            $('communityResults').scrollTop = 0;
            updateFilterState();
            message(appliedFilters.has('codes') ? '按基础卡号检索，同编号不同卡面均包含在结果中。' : '卡组由玩家公开发布，官网来源单独标注。');
        } catch (e) { if (version === serial) message(e.message, true); }
        finally { if (version === serial) { loading = false; updatePagination(); } }
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
                return `<div class="preview-card">${card ? `<img loading="lazy" src="${escape(card.thumbnailImg || '/api/image-proxy?url=' + encodeURIComponent(card.img))}" alt="${escape(card.name)}">` : '<div class="preview-missing">卡库暂未收录</div>'}<strong>${escape(code)} × ${quantity}</strong><span>${escape(card?.name || '')}</span></div>`;
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
    $('communitySource').addEventListener('change', updateFilterState);
    $('communityRefresh').addEventListener('click', () => refresh());
    $('communityPrev').addEventListener('click', () => refresh(page - 1));
    $('communityNext').addEventListener('click', () => refresh(page + 1));
    $('communityLast').addEventListener('click', () => refresh(pages));
    $('communityPageForm').addEventListener('submit', event => {
        event.preventDefault();
        if (loading || !pages) return;
        const input = $('communityPageInput'), raw = input.value.trim(), target = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isInteger(target) || target < 1 || target > pages) {
            message(`请输入 1～${pages} 的整数页码。`, true); return;
        }
        refresh(target);
    });
    document.addEventListener('click', event => {
        if (!event.target.closest('.community-multiselect')) closeDropdowns();
        const button = event.target.closest('[data-recommend]');
        if (!button) return;
        try { selected = selectedCodes([...selected, button.dataset.recommend]); renderSelection(); updateFilterState(); message(`已加入检索：${baseCode(button.dataset.recommend)}。点击卡组检索的“检索”应用条件。`); }
        catch (e) { message(e.message, true); }
    });
    $('selectedRecommendations').addEventListener('click', event => {
        const button = event.target.closest('[data-remove-recommend]');
        if (!button) return;
        selected = selected.filter(code => code !== button.dataset.removeRecommend); renderSelection(); updateFilterState();
    });
    $('recommendForm').addEventListener('submit', event => {
        event.preventDefault();
        try { selected = selectedCodes([...selected, ...$('recommendCodesInput').value.split(/[\s,，]+/).filter(Boolean)]); $('recommendCodesInput').value = ''; renderSelection(); updateFilterState(); }
        catch (e) { message(e.message, true); }
    });
    $('clearRecommendations').addEventListener('click', () => { selected = []; renderSelection(); updateFilterState(); });
    $('communitySelectedFilters').addEventListener('click', event => {
        const button = event.target.closest('[data-remove-community-filter]');
        if (!button) return;
        const name = button.dataset.removeCommunityFilter, value = button.dataset.value;
        if (name === 'source') $('communitySource').value = '';
        else if (name === 'range') {
            for (const bound of ['min', 'max']) { const input = $(`communityAttr${value}${bound}`); input.value = ''; input.setCustomValidity(''); }
        } else if (name === 'code') { selected = selected.filter(code => code !== value); renderSelection(); }
        else if (name === 'match') $('recommendMatch').value = 'all';
        else { const state = filters.get(name); state.selected.delete(value); state.render(); }
        updateFilterState();
    });
    $('communityClearFilters').addEventListener('click', () => { clearFilters(); applySearch(); });
    $('recommendMatch').addEventListener('change', updateFilterState);
    $('showRecommendations').addEventListener('click', () => applySearch());
    multiSelect('communityDeckType', 'deckType', '卡组类型', [{ value: 'single', label: '系列单' }, { value: 'mix', label: '混成' }]);
    const seriesFilter = multiSelect('communitySeries', 'series', '系列单会社', []);
    multiSelect('communityAttribute', 'attribute', '属性构成', attributes.map(value => ({ value, label: value })));
    $('communityAttributeRanges').innerHTML = attributes.map(attribute => `<label class="community-attribute-range"><span>${attribute}</span><input id="communityAttr${attribute}min" type="number" min="0" max="200" step="1" inputmode="numeric" aria-label="${attribute}属性数量下限" placeholder="下限"><span>～</span><input id="communityAttr${attribute}max" type="number" min="0" max="200" step="1" inputmode="numeric" aria-label="${attribute}属性数量上限" placeholder="上限"></label>`).join('');
    $('communityAttributeRanges').addEventListener('input', event => { event.target.setCustomValidity(''); updateFilterState(); });
    document.body.classList.add('recommend-enabled');
    renderSelection(); updateFilterState();
    await Promise.allSettled([
        updateSession().catch(e => message(e.message, true)),
        request('/api/community?facets=1').then(data => seriesFilter.updateOptions(data.series || [])).catch(() => {
            $('communitySeriesOptions').innerHTML = '<span class="community-filter-empty">无法读取会社选项，请刷新页面重试。</span>';
        })
    ]);
    await refresh();
    const linked = new URLSearchParams(location.search).get('publication');
    if (linked && PUBLICATION_ID.test(linked)) await showPreview(linked);
}
