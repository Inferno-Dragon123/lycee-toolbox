const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ranges = [['costTotal', '费用'], ['ap', 'AP'], ['dp', 'DP'], ['sp', 'SP'], ['dmg', 'DMG']];

export function initSearchFilters(root, selectedBar, { facets, abilityFacets }) {
    const selections = new Map(), labels = new Map(), fieldLabels = new Map();
    const groups = [{ key: 'attribute', label: '属性（包含任一）', options: [...'雪月花宙日無'].map(value => ({ value, label: value })) }, ...facets];
    for (const group of groups) {
        selections.set(group.key, new Set()); fieldLabels.set(group.key, group.label);
        labels.set(group.key, new Map(group.options.map(o => [o.value, o.label])));
    }
    selections.set('ability', new Set()); fieldLabels.set('ability', '基本能力');
    labels.set('ability', new Map(abilityFacets.flatMap(f => [[f.value, f.label + '（任意代价／效果）'],
        ...f.options.map(o => [o.value, f.label + '：' + o.label])])));
    function input(key, label) {
        fieldLabels.set(key, label);
        const placeholder = key === 'code' ? '如 6826 或 LO-6826-A' : label;
        return `<div class="filter-item"><label for="field_${key}">${label}</label><input id="field_${key}" data-key="${key}" maxlength="200" placeholder="${placeholder}"></div>`;
    }
    const dropdown = (key, label) => `<div class="filter-item"><label id="label_${key}">${label}</label><button type="button" id="field_${key}" class="filter-trigger" data-filter="${key}" aria-haspopup="dialog" aria-controls="searchFilterPopup" aria-expanded="false" aria-labelledby="label_${key} field_${key}">全部 <span aria-hidden="true">▾</span></button></div>`;
    root.innerHTML = input('q', '关键词（中日文）') + input('code', '卡号') + groups.map(g => dropdown(g.key, g.label)).join('') +
        dropdown('ability', '基本能力') + input('effect', '效果关键词') + input('trait', '类型关键词') + input('illustrator', '画师') +
        ranges.map(([key, label]) => {
            fieldLabels.set(key, label);
            return `<div class="filter-item"><label>${label} 范围</label><div class="filter-range"><input id="field_${key}_min" data-key="${key}_min" type="number" min="0" max="100" placeholder="下限" aria-label="${label} 下限"><span>～</span><input id="field_${key}_max" data-key="${key}_max" type="number" min="0" max="100" placeholder="上限" aria-label="${label} 上限"></div></div>`;
        }).join('');
    const popup = document.createElement('div');
    popup.className = 'filter-popup'; popup.id = 'searchFilterPopup'; popup.hidden = true;
    popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', '筛选选项');
    document.body.append(popup);
    let active = null, activeAbility = null, applied = '';
    const getParams = () => {
        const params = new URLSearchParams();
        for (const element of root.querySelectorAll('[data-key]')) if (element.value.trim()) params.set(element.dataset.key, element.value.trim());
        for (const [key, values] of selections) for (const value of [...values].sort()) params.append(key, value);
        return params;
    };
    function close(focus = false) {
        if (!active) return;
        const button = root.querySelector(`[data-filter="${active}"]`);
        button.setAttribute('aria-expanded', 'false');
        popup.hidden = true; active = null;
        if (focus) button.focus();
    }
    function positionPopup() {
        const box = root.querySelector(`[data-filter="${active}"]`).getBoundingClientRect();
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
        const viewportWidth = viewport?.width || innerWidth, viewportHeight = viewport?.height || innerHeight;
        const width = Math.min(active === 'ability' ? 650 : 390, viewportWidth - 24);
        popup.style.width = width + 'px';
        popup.style.left = Math.max(left + 12, Math.min(box.left, left + viewportWidth - width - 12)) + 'px';
        const below = top + viewportHeight - box.bottom - 12, above = box.top - top - 12;
        const upwards = below < 220 && above > below;
        const height = Math.min(450, Math.max(160, upwards ? above : below), viewportHeight - 24);
        popup.style.maxHeight = height + 'px';
        const targetTop = upwards ? box.top - popup.offsetHeight - 6 : box.bottom + 6;
        popup.style.top = Math.max(top + 12, Math.min(targetTop, top + viewportHeight - popup.offsetHeight - 12)) + 'px';
    }
    function updateSelectionView() {
        for (const [key, values] of selections) {
            const button = root.querySelector(`[data-filter="${key}"]`);
            const text = values.size ? [...values].map(v => labels.get(key).get(v)).join('、') : '全部';
            button.innerHTML = `<span class="filter-trigger-text">${escape(text)}</span><span aria-hidden="true">▾</span>`;
            button.title = text; button.classList.toggle('has-selection', Boolean(values.size));
        }
        const chips = [];
        const removeButton = (key, value, label) => `<button type="button" class="filter-chip" data-remove-key="${key}" data-remove-value="${escape(value)}" aria-label="移除 ${escape(label)}">${escape(label)} <span aria-hidden="true">×</span></button>`;
        for (const element of root.querySelectorAll('input[data-key]')) {
            const key = element.dataset.key;
            if (key.endsWith('_min') || key.endsWith('_max')) continue;
            if (element.value.trim()) chips.push(removeButton(key, '', `${fieldLabels.get(key)}：${element.value.trim()}`));
        }
        for (const [key, label] of ranges) {
            const min = root.querySelector(`[data-key="${key}_min"]`).value, max = root.querySelector(`[data-key="${key}_max"]`).value;
            if (min !== '' || max !== '') chips.push(removeButton(key, '', `${label}：${min || '不限'}～${max || '不限'}`));
        }
        for (const [key, values] of selections) for (const value of values) chips.push(removeButton(key, value, `${fieldLabels.get(key)}：${labels.get(key).get(value)}`));
        selectedBar.innerHTML = `<div class="selected-filter-heading"><strong>已选筛选条件</strong><span class="text-muted" id="filterApplyState">${getParams().toString() === applied ? '已应用' : '待应用 · 点击搜索'}</span></div><div class="filter-chips">${chips.join('') || '<span class="text-muted">暂无筛选条件</span>'}</div>`;
        if (active) refreshPressed();
    }
    function refreshPressed() {
        for (const button of popup.querySelectorAll('[data-option]')) {
            const selected = selections.get(active).has(button.dataset.option);
            button.setAttribute('aria-pressed', String(selected));
            button.classList.toggle('is-selected', selected);
        }
        for (const row of popup.querySelectorAll('[data-ability-row]')) {
            const family = row.dataset.abilityRow;
            const count = [...selections.get('ability')].filter(v => v === family || v.startsWith(family + ':')).length;
            row.querySelector('.ability-count').textContent = count ? `已选 ${count}` : '›';
        }
    }
    function option(value, text, original = '') {
        return `<button type="button" class="filter-option" data-option="${escape(value)}" aria-pressed="false"><span class="option-check" aria-hidden="true">✓</span><span>${escape(text)}${original && original !== text ? `<small>${escape(original)}</small>` : ''}</span></button>`;
    }
    function showAbility(id) {
        activeAbility = id;
        const family = abilityFacets.find(f => f.value === id);
        for (const row of popup.querySelectorAll('[data-ability-row]')) {
            row.classList.toggle('is-active', row.dataset.abilityRow === id);
            row.querySelector('[data-open-ability]').setAttribute('aria-expanded', String(row.dataset.abilityRow === id));
        }
        popup.querySelector('.ability-variants').innerHTML = `<div class="ability-variant-title">${escape(family.label)} · 代价／效果</div>` +
            option(family.value, '任意代价／效果') + family.options.map(o => option(o.value, o.label, o.original)).join('');
        refreshPressed();
    }
    function open(key, focusOptions) {
        if (active === key) { close(); return; }
        close(); active = key;
        const isAbility = key === 'ability';
        popup.innerHTML = `<div class="filter-popup-header"><strong>${escape(fieldLabels.get(key))}</strong><button type="button" class="btn btn-outline btn-sm" data-close>完成</button></div>` +
            (isAbility ? `<p class="filter-help">悬浮或点击能力查看代价／效果；再次点击选项取消。</p><div class="ability-cascade"><div class="ability-families">${abilityFacets.map(f => `<div class="ability-row" data-ability-row="${f.value}"><button type="button" data-open-ability="${f.value}" aria-expanded="false">${escape(f.label)}<small>${escape(f.japanese)}</small><span class="ability-count">›</span></button></div>`).join('')}</div><div class="ability-variants"></div></div>` :
                `<input class="filter-option-search" type="search" placeholder="查找选项" aria-label="查找${escape(fieldLabels.get(key))}选项"><div class="filter-options">${groups.find(g => g.key === key).options.map(o => option(o.value, o.label)).join('')}</div>`);
        popup.hidden = false;
        root.querySelector(`[data-filter="${key}"]`).setAttribute('aria-expanded', 'true');
        if (isAbility) showAbility(activeAbility || abilityFacets[0].value); else refreshPressed();
        positionPopup();
        // Touch users can open the option search themselves without immediately raising the keyboard.
        if (focusOptions) (popup.querySelector('input') || popup.querySelector('[data-open-ability]')).focus({ preventScroll: true });
    }
    root.addEventListener('click', event => {
        const button = event.target.closest('[data-filter]');
        if (button) open(button.dataset.filter, event.detail === 0 || event.pointerType === 'mouse' || (!event.pointerType && matchMedia('(hover: hover) and (pointer: fine)').matches));
    });
    root.addEventListener('input', updateSelectionView);
    popup.addEventListener('input', event => {
        const query = event.target.value.normalize('NFKC').toLowerCase().trim();
        for (const button of popup.querySelectorAll('[data-option]')) button.hidden = !button.textContent.normalize('NFKC').toLowerCase().includes(query);
    });
    popup.addEventListener('pointerover', event => {
        const row = event.target.closest('[data-ability-row]');
        if (row && event.pointerType === 'mouse' && activeAbility !== row.dataset.abilityRow) showAbility(row.dataset.abilityRow);
    });
    popup.addEventListener('click', event => {
        if (event.target.closest('[data-close]')) return close(true);
        const family = event.target.closest('[data-open-ability]');
        if (family) { showAbility(family.dataset.openAbility); return; }
        const button = event.target.closest('[data-option]');
        if (!button) return;
        const values = selections.get(active), value = button.dataset.option;
        if (values.has(value)) values.delete(value);
        else {
            if (active === 'ability') {
                const family = value.split(':')[0];
                if (value === family) for (const v of values) { if (v.startsWith(family + ':')) values.delete(v); }
                else values.delete(family);
            }
            values.add(value);
        }
        updateSelectionView();
    });
    selectedBar.addEventListener('click', event => {
        const button = event.target.closest('[data-remove-key]'); if (!button) return;
        const key = button.dataset.removeKey;
        if (selections.has(key)) selections.get(key).delete(button.dataset.removeValue);
        else if (ranges.some(([range]) => range === key)) for (const suffix of ['min', 'max']) root.querySelector(`[data-key="${key}_${suffix}"]`).value = '';
        else root.querySelector(`[data-key="${key}"]`).value = '';
        updateSelectionView();
    });
    document.addEventListener('pointerdown', event => { if (active && !popup.contains(event.target) && !event.target.closest('[data-filter]')) close(); });
    document.addEventListener('keydown', event => { if (active && event.key === 'Escape') { event.preventDefault(); close(true); } });
    // A mobile keyboard or browser toolbar can resize/scroll the viewport after opening.
    const reposition = () => { if (active) positionPopup(); };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', event => { if (!popup.contains(event.target)) reposition(); }, true);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    updateSelectionView();
    return { getParams, markApplied(params) { applied = params.toString(); updateSelectionView(); },
        clear() { close(); for (const values of selections.values()) values.clear(); for (const input of root.querySelectorAll('input')) input.value = ''; updateSelectionView(); } };
}
