(function () {
    const ORDER_CATEGORY_CONFIG = [
        { key: 'desayunos', label: 'Desayunos', source: 'daily' },
        { key: 'almuerzos', label: 'Almuerzos', source: 'daily' },
        { key: 'especiales', label: 'Especiales', source: 'daily' },
        { key: 'parrillas', label: 'Parrillas', source: 'daily' },
        { key: 'adicionales', label: 'Adicionales', source: 'catalog' },
        { key: 'paquetes', label: 'Paquetes', source: 'catalog' },
        { key: 'bebidas', label: 'Bebidas', source: 'catalog' },
    ];

    const defaultGuest = (index = 1) => ({
        id: index,
        label: String(index),
        items: [],
        observacion: '',
    });

    const todayLocal = () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const state = window._saborArtesanalPedidosState || {
        initialized: false,
        loaded: false,
        loading: false,
        stage: 'setup',
        selectedCategory: 'desayunos',
        selectedGuestId: 1,
        selectedMenus: {},
        activeBuilder: null,
        nextItemId: 1,
        orderMeta: {
            fecha_servicio: todayLocal(),
            mesa: '',
            cliente: '',
            modo_entrega: 'SERVIDO',
        },
        guests: [defaultGuest(1)],
    };
    window._saborArtesanalPedidosState = state;

    function menusContext() {
        return window._saborArtesanalMenusState || {};
    }

    function findCategoryConfig(categoryKey) {
        return ORDER_CATEGORY_CONFIG.find(item => item.key === categoryKey) || null;
    }

    function isDailyCategory(categoryKey) {
        return findCategoryConfig(categoryKey)?.source === 'daily';
    }

    function escapeValue(value) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(value);
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function money(value) {
        const amount = Number(value || 0);
        if (typeof window.formatCurrency === 'function') return window.formatCurrency(amount);
        return `$ ${amount.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    }

    function notifySuccess(message) {
        if (typeof window.showSuccess === 'function') window.showSuccess(message);
    }

    function notifyError(message) {
        if (typeof window.showError === 'function') window.showError(message);
    }

    function ventasPanel() {
        return document.getElementById('saborArtesanalVentasDiaPanel');
    }

    function headerContextNode() {
        return document.getElementById('saborArtesanalHeaderContext');
    }

    function topNavNode() {
        return document.querySelector('#sabor_artesanalView .sabor-artesanal-top-nav');
    }

    function activeGuest() {
        return state.guests.find(guest => Number(guest.id) === Number(state.selectedGuestId)) || state.guests[0] || null;
    }

    function findMenuById(menuId) {
        return (menusContext().menus || []).find(item => Number(item.id) === Number(menuId)) || null;
    }

    function normalizeLegacyMenuBlocks(menu) {
        const grouped = new Map();
        (menu?.componentes || []).forEach(component => {
            const code = component.bloque_codigo || component.tabla_categoria || 'otros';
            if (!grouped.has(code)) {
                grouped.set(code, {
                    codigo: code,
                    label: component.bloque_label || component.tabla_label || code,
                    selector_tipo: component.selector_tipo || 'single',
                    opciones: [],
                });
            }
            grouped.get(code).opciones.push(component);
        });
        return [...grouped.values()];
    }

    function menuBlocksForBuilder(menu) {
        if (Array.isArray(menu?.bloques) && menu.bloques.length > 0) {
            return menu.bloques;
        }
        return normalizeLegacyMenuBlocks(menu);
    }

    function formattedDateLabel(value) {
        if (!value) return '';
        const [year, month, day] = String(value).split('-');
        if (!year || !month || !day) return String(value);
        return `${day}/${month}/${year}`;
    }

    function orderMetaSummary() {
        const parts = [];
        if (state.orderMeta.fecha_servicio) parts.push(formattedDateLabel(state.orderMeta.fecha_servicio));
        if (state.orderMeta.mesa) parts.push(`Mesa ${state.orderMeta.mesa}`);
        if (state.orderMeta.cliente) parts.push(state.orderMeta.cliente);
        if (state.orderMeta.modo_entrega) parts.push(state.orderMeta.modo_entrega);
        return parts.join(' | ');
    }

    function orderHeaderFields() {
        return [
            { label: 'Fecha', value: formattedDateLabel(state.orderMeta.fecha_servicio) || 'Sin fecha' },
            { label: 'Mesa/Pedido', value: state.orderMeta.mesa || 'Sin dato' },
            { label: 'Cliente', value: state.orderMeta.cliente || 'General' },
            { label: 'Entrega', value: state.orderMeta.modo_entrega || 'SERVIDO' },
        ];
    }

    function flatCatalogItems(categoryKey) {
        const catalog = menusContext().tablasCatalogo || {};
        const flatten = items => (items || []).flatMap(parent => {
            const children = Array.isArray(parent.children) ? parent.children : [];
            if (children.length > 0) {
                return children.map(child => ({
                    id: `tabla-${child.id}`,
                    ref_id: Number(child.id),
                    category_key: categoryKey,
                    title: child.nombre,
                    subtitle: parent.nombre,
                    detail: child.descripcion || '',
                    price: Number(child.precio_venta || 0),
                    source_type: 'catalog',
                }));
            }
            return [{
                id: `tabla-${parent.id}`,
                ref_id: Number(parent.id),
                category_key: categoryKey,
                title: parent.nombre,
                subtitle: '',
                detail: parent.descripcion || '',
                price: Number(parent.precio_venta || 0),
                source_type: 'catalog',
            }];
        });

        if (categoryKey === 'bebidas') {
            return [
                ...flatten(catalog.bebidas_frias?.items || []).map(item => ({ ...item, subtitle: item.subtitle ? `Fria | ${item.subtitle}` : 'Fria' })),
                ...flatten(catalog.bebidas_calientes?.items || []).map(item => ({ ...item, subtitle: item.subtitle ? `Caliente | ${item.subtitle}` : 'Caliente' })),
            ];
        }

        return flatten(catalog[categoryKey]?.items || []);
    }

    function programmedMenusFor(categoryKey) {
        const context = menusContext();
        const selectedDate = state.orderMeta.fecha_servicio;
        return (context.programaciones || [])
            .filter(item => item.fecha_servicio === selectedDate && item.categoria_codigo === categoryKey)
            .map(item => {
                const menu = findMenuById(item.menu_id);
                return {
                    id: `menu-${item.menu_id}-${selectedDate}`,
                    ref_id: Number(item.menu_id),
                    category_key: categoryKey,
                    title: item.menu_nombre,
                    subtitle: item.categoria_nombre || '',
                    detail: menu?.descripcion || item.observaciones || '',
                    price: Number(menu?.precio_venta || 0),
                    source_type: 'daily_menu',
                    componentes: Array.isArray(menu?.componentes) ? menu.componentes : [],
                };
            });
    }

    function categoryOptions(categoryKey) {
        const config = findCategoryConfig(categoryKey);
        if (!config) return [];
        return config.source === 'daily'
            ? programmedMenusFor(categoryKey)
            : flatCatalogItems(categoryKey);
    }

    function findOptionById(categoryKey, optionId) {
        return categoryOptions(categoryKey).find(item => String(item.id) === String(optionId)) || null;
    }

    function ensureSelectedCategory() {
        const available = ORDER_CATEGORY_CONFIG.filter(item => {
            const optionCount = categoryOptions(item.key).length;
            return optionCount > 0 || item.source === 'daily';
        });
        if (!available.some(item => item.key === state.selectedCategory)) {
            state.selectedCategory = available[0]?.key || 'desayunos';
        }
    }

    function nextGuestItemLineId() {
        const nextId = Number(state.nextItemId || 1);
        state.nextItemId = nextId + 1;
        return `pedido-item-${nextId}`;
    }

    function selectedMenuOptionForCategory(categoryKey) {
        if (!isDailyCategory(categoryKey)) return null;
        const options = categoryOptions(categoryKey);
        if (!options.length) {
            delete state.selectedMenus[categoryKey];
            return null;
        }

        const selectedOptionId = state.selectedMenus[categoryKey];
        const option = options.find(item => String(item.id) === String(selectedOptionId)) || options[0];
        state.selectedMenus[categoryKey] = option.id;
        return option;
    }

    function resetActiveBuilder() {
        state.activeBuilder = null;
    }

    function ensureDailyBuilder(categoryKey) {
        const option = selectedMenuOptionForCategory(categoryKey);
        if (!option) {
            if (state.activeBuilder?.categoryKey === categoryKey) resetActiveBuilder();
            return null;
        }

        const shouldRebuild = !state.activeBuilder
            || state.activeBuilder.categoryKey !== categoryKey
            || String(state.activeBuilder.optionId) !== String(option.id);

        if (shouldRebuild) {
            state.activeBuilder = buildBuilderFromOption(categoryKey, option);
        }
        return state.activeBuilder;
    }

    function upsertGuestItem(guest, draft, matcher) {
        const existing = (guest.items || []).find(matcher);
        if (existing) {
            existing.qty += Number(draft.qty || 1);
            return existing;
        }

        guest.items.push({
            line_id: nextGuestItemLineId(),
            ...draft,
        });
        return guest.items[guest.items.length - 1];
    }

    function guestTotal(guest) {
        return (guest.items || []).reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.qty || 0)), 0);
    }

    function orderTotal() {
        return state.guests.reduce((sum, guest) => sum + guestTotal(guest), 0);
    }

    function componentLineLabel(component) {
        const principal = String(component.principal_nombre || '').trim();
        const item = String(component.item_nombre || '').trim();
        if (principal && item && principal.toLowerCase() !== item.toLowerCase()) {
            return `${principal}: ${item}`;
        }
        return item || principal || 'Opcion';
    }

    function componentLineMeta(component) {
        const amount = component.cantidad_texto || component.cantidad || '1';
        const parts = [`${amount} ${component.unidad || 'porcion'}`];
        if (component.presentacion && String(component.presentacion).trim().toLowerCase() !== String(component.item_nombre || '').trim().toLowerCase()) {
            parts.push(`Presentacion: ${component.presentacion}`);
        }
        if (component.acompanamiento) parts.push(`Acompanamiento: ${component.acompanamiento}`);
        if (component.observaciones) parts.push(component.observaciones);
        return parts.join(' | ');
    }

    function itemDetailLines(item) {
        const lines = [];
        if (item.category_label) lines.push(item.category_label);
        if (Array.isArray(item.components_summary) && item.components_summary.length > 0) {
            lines.push(...item.components_summary);
        } else {
            const fallback = [item.detail || item.subtitle || ''];
            lines.push(...fallback.filter(Boolean));
        }
        return lines.filter((line, index) => line && lines.indexOf(line) === index);
    }

    function renderGuestSummary(guest) {
        if (!guest.items.length) {
            return '<div class="sabor-pedidos-empty-mini">Sin productos.</div>';
        }

        return guest.items.map(item => `
            <div class="sabor-pedidos-item-line read-only">
                <div class="sabor-pedidos-item-copy">
                    <strong>${escapeValue(item.qty)} x ${escapeValue(item.title)}</strong>
                    ${itemDetailLines(item).map(line => `<span>${escapeValue(line)}</span>`).join('')}
                </div>
                <div class="sabor-pedidos-item-total">${money((Number(item.price || 0) * Number(item.qty || 0)))}</div>
            </div>
        `).join('');
    }

    function syncObservationPreview(guest) {
        const panel = ventasPanel();
        if (!panel || !guest) return;
        const card = panel.querySelector(`.sabor-pedidos-guest-card[data-guest-id="${guest.id}"] .sabor-pedidos-observacion`);
        if (!card) return;
        card.textContent = guest.observacion || '';
        card.style.display = guest.observacion ? '' : 'none';
    }

    function renderCategoryTabs() {
        return ORDER_CATEGORY_CONFIG.map(category => {
            const optionsCount = categoryOptions(category.key).length;
            const isDisabled = optionsCount === 0 && category.source === 'daily';
            return `
                <button
                    type="button"
                    class="sabor-pedidos-category-tab ${state.selectedCategory === category.key ? 'active' : ''}"
                    ${isDisabled ? 'disabled' : ''}
                    onclick="selectSaborPedidoCategory('${category.key}')"
                >
                    <strong>${escapeValue(category.label)}</strong>
                    <span>${isDisabled ? '0' : optionsCount}</span>
                </button>
            `;
        }).join('');
    }

    function buildBuilderFromOption(categoryKey, option) {
        const menu = findMenuById(option.ref_id);
        const category = findCategoryConfig(categoryKey);
        const blocks = menuBlocksForBuilder(menu).map((block, blockIndex) => {
            const rawSelectorType = block.selector_tipo || 'single';
            const selectorType = rawSelectorType === 'single' && String(block.codigo || '').toLowerCase() === 'principios'
                ? 'grouped_single'
                : rawSelectorType;
            const defaultsByGroup = {};
            (block.opciones || []).forEach((item, optionIndex) => {
                const groupKey = String(item.grupo_codigo || item.grupo_label || `group-${optionIndex + 1}`).trim().toLowerCase();
                if (item.seleccion_default === true && typeof defaultsByGroup[groupKey] === 'undefined') {
                    defaultsByGroup[groupKey] = optionIndex;
                }
            });
            (block.opciones || []).forEach((item, optionIndex) => {
                const groupKey = String(item.grupo_codigo || item.grupo_label || `group-${optionIndex + 1}`).trim().toLowerCase();
                if (typeof defaultsByGroup[groupKey] === 'undefined') {
                    defaultsByGroup[groupKey] = optionIndex;
                }
            });
            const selectedDefaultIndex = (block.opciones || []).findIndex(item => item.seleccion_default === true);
            return {
                key: block.codigo || `bloque-${blockIndex + 1}`,
                label: block.label || block.codigo || `Bloque ${blockIndex + 1}`,
                selectorType,
                options: (block.opciones || []).map((component, optionIndex) => ({
                    local_id: `${option.ref_id}-${block.codigo || blockIndex}-${component.tabla_item_id || optionIndex}`,
                    selected: selectorType === 'multi'
                        ? component.seleccion_default === true
                        : (selectorType === 'grouped_single'
                            ? (typeof defaultsByGroup[String(component.grupo_codigo || component.grupo_label || `group-${optionIndex + 1}`).trim().toLowerCase()] !== 'undefined'
                                ? defaultsByGroup[String(component.grupo_codigo || component.grupo_label || `group-${optionIndex + 1}`).trim().toLowerCase()] === optionIndex
                                : true)
                            : (selectedDefaultIndex >= 0 ? selectedDefaultIndex === optionIndex : optionIndex === 0)),
                    ...component,
                })),
            };
        });
        return {
            categoryKey,
            categoryLabel: category?.label || categoryKey,
            optionId: option.id,
            menuId: option.ref_id,
            menuName: option.title,
            menuSubtitle: option.subtitle || '',
            price: Number(option.price || 0),
            blocks,
        };
    }

    function builderOptionGroupKey(option, fallbackIndex = 0) {
        return String(option?.grupo_codigo || option?.grupo_label || `group-${fallbackIndex + 1}`).trim().toLowerCase();
    }

    function builderBlockSections(block) {
        if (block.selectorType !== 'grouped_single') {
            return [{
                key: block.key,
                label: block.label,
                selectorType: block.selectorType,
                options: block.options || [],
            }];
        }

        const grouped = new Map();
        (block.options || []).forEach((option, optionIndex) => {
            const groupKey = builderOptionGroupKey(option, optionIndex);
            if (!grouped.has(groupKey)) {
                grouped.set(groupKey, {
                    key: `${block.key}-${groupKey}`,
                    label: option.grupo_label || groupKey,
                    selectorType: 'single',
                    options: [],
                });
            }
            grouped.get(groupKey).options.push(option);
        });
        return [...grouped.values()];
    }

    function groupBuilderSelections(builder) {
        return (builder?.blocks || []).map(block => ({
            ...block,
            sections: builderBlockSections(block),
        }));
    }

    function selectedBuilderComponents(builder) {
        return (builder?.blocks || []).flatMap(block =>
            (block.options || []).filter(item => item.selected !== false).map(item => ({
                ...item,
                block_key: block.key,
                block_label: block.label,
                selector_type: block.selectorType,
            }))
        );
    }

    function builderSignature(builder) {
        return (builder?.blocks || []).map(block => {
            const selected = (block.options || [])
                .filter(item => item.selected !== false)
                .map(item => String(item.local_id))
                .sort()
                .join(',');
            return `${block.key}:${selected}`;
        }).join('|');
    }

    function renderDailyMenuSelector(category, options, selectedOption) {
        return `
            <div class="sabor-pedidos-options-header">
                <strong>${escapeValue(category.label)}</strong>
                <span>Selecciona el menu y ajusta el plato abajo</span>
            </div>
            <div class="sabor-pedidos-menu-picker">
                <label for="saborPedidoMenuSelectorActual">Menu del dia</label>
                <select id="saborPedidoMenuSelectorActual" onchange="selectSaborPedidoDailyMenu('${category.key}', this.value)">
                    ${options.map(option => `
                        <option value="${escapeValue(option.id)}" ${String(selectedOption?.id) === String(option.id) ? 'selected' : ''}>
                            ${escapeValue(option.title || '')}
                        </option>
                    `).join('')}
                </select>
                <div class="sabor-pedidos-menu-picker-meta">
                    <strong>${money(selectedOption?.price || 0)}</strong>
                    <span>${escapeValue(selectedOption?.detail || selectedOption?.subtitle || 'Menu del dia')}</span>
                </div>
            </div>
        `;
    }

    function renderBuilderPanel(category, builder) {
        const groups = groupBuilderSelections(builder);
        return `
            <div class="sabor-pedidos-options-header">
                <strong>${escapeValue(builder.menuName)}</strong>
                <span>${money(builder.price || 0)}</span>
            </div>
            <div class="sabor-pedidos-builder-shell">
                <div class="sabor-pedidos-builder-head">
                    <div>
                        <strong>${escapeValue(category.label)}</strong>
                        <small>${escapeValue(builder.menuSubtitle || 'Personaliza el plato con las opciones definidas en este menu.')}</small>
                    </div>
                </div>
                ${groups.length === 0 ? '<div class="placeholder">Este menu no tiene componentes configurados.</div>' : groups.map(group => `
                    <section class="sabor-pedidos-builder-group">
                        <div class="sabor-pedidos-builder-group-title">${escapeValue(group.label)} <small style="margin-left:8px; font-weight:400; text-transform:none; letter-spacing:0;">${escapeValue(group.selectorType === 'multi' ? 'Marca una o varias alternativas' : (group.selectorType === 'grouped_single' ? 'Marca una alternativa por grupo' : 'Marca una alternativa'))}</small></div>
                        ${group.sections.map(section => `
                            <div class="sabor-pedidos-builder-subgroup">
                                ${group.sections.length > 1 ? `<div class="sabor-pedidos-builder-subgroup-title">${escapeValue(section.label)}</div>` : ''}
                                <div class="sabor-pedidos-builder-group-options">
                                    ${section.options.map(item => `
                                        <button
                                            type="button"
                                            class="sabor-pedidos-builder-option ${item.selected !== false ? 'is-selected' : ''}"
                                            onclick="toggleSaborPedidoBuilderComponent('${escapeValue(item.local_id)}')"
                                        >
                                            <span class="sabor-pedidos-builder-check">${item.selected !== false ? 'X' : ''}</span>
                                            <span class="sabor-pedidos-builder-copy">
                                                <strong>${escapeValue(componentLineLabel(item))}</strong>
                                                <small>${escapeValue(componentLineMeta(item))}</small>
                                            </span>
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </section>
                `).join('')}
                <div class="sabor-pedidos-builder-actions">
                    <button type="button" class="btn btn-primary" onclick="addActiveSaborPedidoBuilderToGuest()">Agregar al comensal</button>
                </div>
            </div>
        `;
    }

    function renderCatalogSelector(category, options) {
        return `
            <div class="sabor-pedidos-options-header">
                <strong>${escapeValue(category.label)}</strong>
                <span>${options.length} opcion(es)</span>
            </div>
            <div class="sabor-pedidos-options-list">
                ${options.map(option => `
                    <button type="button" class="sabor-pedidos-option-row" onclick="addSaborPedidoOption('${state.selectedCategory}', '${escapeValue(option.id)}')">
                        <span class="sabor-pedidos-option-main">
                            <strong>${escapeValue(option.title || '')}</strong>
                            <small>${escapeValue(option.subtitle || category.label)}${option.detail ? ` | ${escapeValue(option.detail)}` : ''}</small>
                        </span>
                        <span class="sabor-pedidos-option-side">
                            <em>${money(option.price || 0)}</em>
                            <b>Agregar</b>
                        </span>
                    </button>
                `).join('')}
            </div>
        `;
    }

    function renderCurrentCategoryOptions() {
        const category = findCategoryConfig(state.selectedCategory);
        const options = categoryOptions(state.selectedCategory);
        if (!category) return '<div class="placeholder">Selecciona una categoria.</div>';
        if (state.loading) {
            return '<div class="placeholder">Cargando opciones...</div>';
        }
        if (!options.length) {
            return `<div class="placeholder">No hay opciones para ${escapeValue(category.label)} en esta fecha.</div>`;
        }

        if (isDailyCategory(state.selectedCategory)) {
            const selectedOption = selectedMenuOptionForCategory(state.selectedCategory);
            const builder = ensureDailyBuilder(state.selectedCategory);
            return `
                ${renderDailyMenuSelector(category, options, selectedOption)}
                ${builder ? renderBuilderPanel(category, builder) : '<div class="placeholder">Selecciona un menu para continuar.</div>'}
            `;
        }

        return renderCatalogSelector(category, options);
    }

    function renderHeaderContext() {
        const header = headerContextNode();
        const topNav = topNavNode();
        const panel = ventasPanel();
        const isActive = window._saborArtesanalSeccionActual === 'ventas_dia' && state.stage === 'capture';
        if (!header) return;

        if (!isActive) {
            header.style.display = 'none';
            header.innerHTML = '';
            if (topNav) topNav.style.display = '';
            if (panel) panel.classList.remove('is-pedidos-capture');
            return;
        }

        header.style.display = '';
        header.innerHTML = `
            <button type="button" class="btn btn-secondary sabor-tabla-back-btn" onclick="goToSaborPedidoSetup()">Volver a datos</button>
            <div class="sabor-pedidos-header-fields">
                ${orderHeaderFields().map(field => `
                    <div class="sabor-pedidos-header-field">
                        <small>${escapeValue(field.label)}</small>
                        <strong>${escapeValue(field.value)}</strong>
                    </div>
                `).join('')}
            </div>
            <div class="sabor-pedidos-top-total">${money(orderTotal())}</div>
        `;

        if (topNav) topNav.style.display = 'none';
        if (panel) panel.classList.add('is-pedidos-capture');
    }

    function renderSetupScreen() {
        return `
            <div class="sabor-pedidos-shell sabor-pedidos-shell-setup">
                <div class="sabor-artesanal-panel-head">
                    <button type="button" class="btn btn-secondary sabor-tabla-back-btn" onclick="volverMenuPrincipalDesdeSaborArtesanal()">Volver al menu anterior</button>
                </div>
                <div class="sabor-pedidos-setup-card">
                    <div class="sabor-pedidos-setup-grid">
                        <input type="date" value="${escapeValue(state.orderMeta.fecha_servicio || '')}" onchange="setSaborPedidoMetaField('fecha_servicio', this.value)">
                        <input type="text" placeholder="Mesa o pedido" value="${escapeValue(state.orderMeta.mesa || '')}" oninput="setSaborPedidoMetaField('mesa', this.value)">
                        <input type="text" placeholder="Cliente o referencia" value="${escapeValue(state.orderMeta.cliente || '')}" oninput="setSaborPedidoMetaField('cliente', this.value)">
                        <select onchange="setSaborPedidoMetaField('modo_entrega', this.value)">
                            <option value="SERVIDO" ${state.orderMeta.modo_entrega === 'SERVIDO' ? 'selected' : ''}>Servido</option>
                            <option value="ICOPOR" ${state.orderMeta.modo_entrega === 'ICOPOR' ? 'selected' : ''}>Icopor</option>
                            <option value="DOMICILIO" ${state.orderMeta.modo_entrega === 'DOMICILIO' ? 'selected' : ''}>Domicilio</option>
                        </select>
                    </div>
                    <div class="sabor-pedidos-setup-actions">
                        <div class="sabor-pedidos-toolbar-total">Total pedido: <strong>${money(orderTotal())}</strong></div>
                        <button type="button" class="btn btn-primary" onclick="goToSaborPedidoCapture()">Tomar pedido</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderCaptureScreen() {
        const currentGuest = activeGuest();
        return `
            <div class="sabor-pedidos-shell">
                <div class="sabor-pedidos-category-strip sabor-pedidos-category-strip-main">
                    ${renderCategoryTabs()}
                </div>
                <div class="sabor-pedidos-capture-body">
                    <section class="sabor-pedidos-summary-panel">
                        <div class="sabor-pedidos-summary-head">
                            <strong>Comensales</strong>
                            <span>${state.guests.length} activo(s)</span>
                        </div>
                        <div class="sabor-pedidos-guest-list compact">
                            ${state.guests.map(guest => `
                                <article class="sabor-pedidos-guest-card ${Number(guest.id) === Number(state.selectedGuestId) ? 'is-active' : ''}" data-guest-id="${guest.id}">
                                    <div class="sabor-pedidos-guest-top">
                                        <strong>${escapeValue(guest.label)}.</strong>
                                        <span>${money(guestTotal(guest))}</span>
                                    </div>
                                    <div class="sabor-pedidos-guest-body">
                                        ${renderGuestSummary(guest)}
                                        <div class="sabor-pedidos-observacion" ${guest.observacion ? '' : 'style="display:none;"'}>${escapeValue(guest.observacion || '')}</div>
                                    </div>
                                </article>
                            `).join('')}
                        </div>
                    </section>
                    <section class="sabor-pedidos-catalog-panel sabor-pedidos-options-panel">
                        <div class="sabor-pedidos-options-scroll">
                            <div class="sabor-pedidos-options-wrap">
                                ${renderCurrentCategoryOptions()}
                            </div>
                        </div>
                        <div class="sabor-pedidos-observation-box compact">
                            <textarea id="saborPedidoObservacionActual" rows="2" placeholder="Observaciones del comensal ${escapeValue(currentGuest?.label || '1')}" oninput="setSaborPedidoGuestObservation(this.value)">${escapeValue(currentGuest?.observacion || '')}</textarea>
                        </div>
                    </section>
                </div>
                <div class="sabor-pedidos-bottom-bar">
                    <div class="sabor-pedidos-bottom-guest-tabs">
                        ${state.guests.map(guest => `
                            <button type="button" class="sabor-pedidos-guest-chip ${Number(guest.id) === Number(state.selectedGuestId) ? 'active' : ''}" onclick="selectSaborPedidoGuest(${guest.id})">${escapeValue(guest.label)}</button>
                        `).join('')}
                    </div>
                    <div class="sabor-pedidos-bottom-actions">
                        <button type="button" class="btn btn-secondary" onclick="addSaborPedidoGuest()">OTRO</button>
                        <button type="button" class="btn btn-primary" onclick="finishSaborPedidoPreview()">TERMINAR</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderPedidoScreen() {
        const panel = ventasPanel();
        if (!panel || panel.dataset.initializedPedidos !== 'true') return;
        ensureSelectedCategory();
        panel.innerHTML = state.stage === 'capture' ? renderCaptureScreen() : renderSetupScreen();
        renderHeaderContext();
    }

    window.ensureSaborArtesanalPedidosUI = function ensureSaborArtesanalPedidosUI() {
        const panel = ventasPanel();
        if (!panel || panel.dataset.initializedPedidos === 'true') return;
        panel.dataset.initializedPedidos = 'true';
        renderPedidoScreen();
    };

    window.cargarContextoPedidosSaborArtesanal = async function cargarContextoPedidosSaborArtesanal(force = false) {
        if (state.loading) return;
        if (menusContext().loaded && !force) {
            state.loaded = true;
            renderPedidoScreen();
            return;
        }

        state.loading = true;
        renderPedidoScreen();
        try {
            if (typeof window.cargarContextoMenusSaborArtesanal === 'function') {
                await window.cargarContextoMenusSaborArtesanal(force);
            }
            state.loaded = true;
        } catch (error) {
            notifyError(error.message || 'No se pudo cargar el contexto para tomar pedidos.');
        } finally {
            state.loading = false;
            renderPedidoScreen();
        }
    };

    window.goToSaborPedidoSetup = function goToSaborPedidoSetup() {
        state.stage = 'setup';
        resetActiveBuilder();
        renderPedidoScreen();
    };

    window.goToSaborPedidoCapture = function goToSaborPedidoCapture() {
        if (!state.orderMeta.fecha_servicio) {
            notifyError('Debes seleccionar la fecha del pedido.');
            return;
        }
        state.stage = 'capture';
        ensureSelectedCategory();
        renderPedidoScreen();
    };

    window.setSaborPedidoMetaField = function setSaborPedidoMetaField(field, value) {
        state.orderMeta[field] = value;
        if (field === 'fecha_servicio') {
            ensureSelectedCategory();
            resetActiveBuilder();
        }
        renderPedidoScreen();
    };

    window.selectSaborPedidoGuest = function selectSaborPedidoGuest(guestId) {
        state.selectedGuestId = Number(guestId) || 1;
        renderPedidoScreen();
    };

    window.addSaborPedidoGuest = function addSaborPedidoGuest() {
        const nextId = (state.guests[state.guests.length - 1]?.id || 0) + 1;
        state.guests.push(defaultGuest(nextId));
        state.selectedGuestId = nextId;
        renderPedidoScreen();
    };

    window.selectSaborPedidoCategory = function selectSaborPedidoCategory(categoryKey) {
        state.selectedCategory = categoryKey;
        if (state.activeBuilder?.categoryKey !== categoryKey) {
            resetActiveBuilder();
        }
        renderPedidoScreen();
    };

    window.openSaborPedidoMenuBuilder = function openSaborPedidoMenuBuilder(categoryKey, optionId) {
        const option = findOptionById(categoryKey, optionId);
        if (!option) {
            notifyError('No se encontro el menu seleccionado.');
            return;
        }
        state.selectedMenus[categoryKey] = option.id;
        state.activeBuilder = buildBuilderFromOption(categoryKey, option);
        renderPedidoScreen();
    };

    window.selectSaborPedidoDailyMenu = function selectSaborPedidoDailyMenu(categoryKey, optionId) {
        const option = findOptionById(categoryKey, optionId);
        if (!option) {
            notifyError('No se encontro el menu seleccionado.');
            return;
        }
        state.selectedCategory = categoryKey;
        state.selectedMenus[categoryKey] = option.id;
        state.activeBuilder = buildBuilderFromOption(categoryKey, option);
        renderPedidoScreen();
    };

    window.closeSaborPedidoMenuBuilder = function closeSaborPedidoMenuBuilder() {
        resetActiveBuilder();
        renderPedidoScreen();
    };

    window.toggleSaborPedidoBuilderComponent = function toggleSaborPedidoBuilderComponent(localId) {
        const builder = state.activeBuilder;
        if (!builder) return;
        const block = (builder.blocks || []).find(item => (item.options || []).some(option => String(option.local_id) === String(localId)));
        if (!block) return;
        const row = (block.options || []).find(item => String(item.local_id) === String(localId));
        if (!row) return;
        if (block.selectorType === 'multi') {
            row.selected = row.selected === false;
        } else if (block.selectorType === 'grouped_single') {
            const targetGroupKey = builderOptionGroupKey(row);
            (block.options || []).forEach((item, index) => {
                if (builderOptionGroupKey(item, index) === targetGroupKey) {
                    item.selected = String(item.local_id) === String(localId);
                }
            });
        } else {
            (block.options || []).forEach(item => {
                item.selected = String(item.local_id) === String(localId);
            });
        }
        renderPedidoScreen();
    };

    window.addActiveSaborPedidoBuilderToGuest = function addActiveSaborPedidoBuilderToGuest() {
        const guest = activeGuest();
        const builder = state.activeBuilder;
        if (!guest || !builder) return;

        const componentsSummary = (builder.blocks || []).map(block => {
            const selected = (block.options || []).filter(item => item.selected !== false);
            if (!selected.length) return null;
            let value = '';
            if (block.selectorType === 'multi') {
                value = selected.map(item => componentLineLabel(item)).join(', ');
            } else if (block.selectorType === 'grouped_single') {
                value = selected
                    .map(item => `${item.grupo_label || 'Grupo'}: ${componentLineLabel(item)}`)
                    .join(', ');
            } else {
                value = componentLineLabel(selected[0]);
            }
            return `${block.label}: ${value}`;
        }).filter(Boolean);
        const signature = builderSignature(builder);

        upsertGuestItem(guest, {
            option_id: `${builder.optionId}::${signature || 'base'}`,
            ref_id: builder.menuId,
            category_key: builder.categoryKey,
            category_label: builder.categoryLabel,
            title: builder.menuName,
            subtitle: builder.menuSubtitle || builder.categoryLabel,
            detail: componentsSummary.join(' | '),
            components_summary: componentsSummary,
            source_type: 'daily_menu',
            builder_signature: signature,
            price: Number(builder.price || 0),
            qty: 1,
        }, item =>
            item.source_type === 'daily_menu'
            && item.category_key === builder.categoryKey
            && Number(item.ref_id) === Number(builder.menuId)
            && String(item.builder_signature || '') === signature
        );

        resetActiveBuilder();
        renderPedidoScreen();
    };

    window.addSaborPedidoOption = function addSaborPedidoOption(categoryKey, optionId) {
        if (isDailyCategory(categoryKey)) {
            window.openSaborPedidoMenuBuilder(categoryKey, optionId);
            return;
        }

        const guest = activeGuest();
        if (!guest) return;
        const category = findCategoryConfig(categoryKey);
        const option = findOptionById(categoryKey, optionId);
        if (!option || !category) {
            notifyError('No se encontro la opcion seleccionada.');
            return;
        }

        upsertGuestItem(guest, {
            option_id: option.id,
            ref_id: option.ref_id,
            category_key: categoryKey,
            category_label: category.label,
            title: option.title,
            subtitle: option.subtitle,
            detail: option.detail,
            components_summary: [],
            source_type: option.source_type,
            price: Number(option.price || 0),
            qty: 1,
        }, item =>
            item.source_type === option.source_type
            && item.category_key === categoryKey
            && String(item.option_id) === String(option.id)
        );
        renderPedidoScreen();
    };

    window.changeSaborPedidoItemQty = function changeSaborPedidoItemQty() {};
    window.removeSaborPedidoItem = function removeSaborPedidoItem() {};

    window.setSaborPedidoGuestObservation = function setSaborPedidoGuestObservation(value) {
        const guest = activeGuest();
        if (!guest) return;
        guest.observacion = value;
        syncObservationPreview(guest);
    };

    window.finishSaborPedidoPreview = function finishSaborPedidoPreview() {
        const totalItems = state.guests.reduce((sum, guest) => sum + guest.items.length, 0);
        notifySuccess(`Vista de pedidos lista: ${state.guests.length} comensal(es), ${totalItems} item(s), total ${money(orderTotal())}.`);
    };

    window.syncSaborPedidoChrome = function syncSaborPedidoChrome() {
        renderHeaderContext();
    };
})();
