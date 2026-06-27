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

    const PEDIDO_STATUS_LABELS = {
        ABIERTO: 'Abierto',
        FINALIZADO: 'Finalizado',
        COBRADO: 'Cobrado',
    };

    const PEDIDO_PAYMENT_OPTIONS = [
        { value: 'EFECTIVO', label: 'Efectivo' },
        { value: 'TRANSFERENCIA', label: 'Transferencia' },
        { value: 'NEQUI', label: 'Nequi' },
        { value: 'DAVIPLATA', label: 'Daviplata' },
        { value: 'MIXTO', label: 'Mixto' },
        { value: 'OTRO', label: 'Otro' },
    ];

    const ALWAYS_AVAILABLE_MENU_CATEGORIES = new Set(['desayunos', 'parrillas']);

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
        pedidos: [],
        pedidosLoading: false,
        pedidoActualId: null,
        pedidoActualCodigo: '',
        pedidoActualEstado: 'NUEVO',
        nextItemId: 1,
        orderMeta: {
            fecha_servicio: todayLocal(),
            mesa: '',
            cliente: '',
            modo_entrega: 'SERVIDO',
        },
        guests: [defaultGuest(1)],
        cobroDialog: {
            open: false,
            pedidoId: null,
            forma_pago: 'EFECTIVO',
            valor_pagado: '',
            pago_referencia: '',
            pago_observaciones: '',
        },
    };
    window._saborArtesanalPedidosState = state;
    let pedidoAutosaveTimer = null;

    function menusContext() {
        return window._saborArtesanalMenusState || {};
    }

    async function pedidoRequest(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'include',
            ...options,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 404 && String(url || '').includes('/api/sabor-artesanal/pedidos')) {
                throw new Error('La ventana actual todavia no cargo el modulo nuevo de pedidos. Reinicia PREVENT y recarga la pagina.');
            }
            throw new Error(result.error || `Error ${response.status}`);
        }
        return result;
    }

    function findCategoryConfig(categoryKey) {
        return ORDER_CATEGORY_CONFIG.find(item => item.key === categoryKey) || null;
    }

    function isDailyCategory(categoryKey) {
        return findCategoryConfig(categoryKey)?.source === 'daily';
    }

    function categoryUsesAlwaysAvailableMenus(categoryKey) {
        return ALWAYS_AVAILABLE_MENU_CATEGORIES.has(String(categoryKey || '').trim().toLowerCase());
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

    function pedidoStatusLabel(status) {
        return PEDIDO_STATUS_LABELS[String(status || '').toUpperCase()] || status || 'Nuevo';
    }

    function hasPedidoContent() {
        return Boolean(
            String(state.orderMeta?.mesa || '').trim()
            || String(state.orderMeta?.cliente || '').trim()
            || (state.guests || []).some(guest => (guest.items || []).length > 0 || String(guest.observacion || '').trim())
        );
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

    function principioMixtoCatalogOption() {
        const principles = menusContext().tablasCatalogo?.principios?.items || [];
        const item = principles.find(parent => String(parent?.nombre || '').trim().toLowerCase() === 'mixto' && parent?.activo !== false);
        if (!item) return null;
        return {
            tabla_categoria: 'principios',
            tabla_item_id: String(item.id),
            parent_item_id: '',
            principal_nombre: item.nombre,
            item_nombre: item.nombre,
            grupo_codigo: 'mixto',
            grupo_label: item.nombre,
            cantidad: '1',
            unidad: 'porcion',
            presentacion: '',
            acompanamiento: '',
            observaciones: '',
            seleccion_default: false,
            label: item.nombre,
        };
    }

    function mergePrincipioMixtoOption(block) {
        if (String(block?.codigo || '').trim().toLowerCase() !== 'principios') return block;
        const existing = Array.isArray(block?.opciones) ? block.opciones : [];
        const alreadyPresent = existing.some(option => {
            const principal = String(option?.principal_nombre || '').trim().toLowerCase();
            const itemName = String(option?.item_nombre || '').trim().toLowerCase();
            const group = String(option?.grupo_codigo || option?.grupo_label || '').trim().toLowerCase();
            return principal === 'mixto' || itemName === 'mixto' || group === 'mixto';
        });
        if (alreadyPresent) return block;
        const mixto = principioMixtoCatalogOption();
        if (!mixto) return block;
        return {
            ...block,
            opciones: [...existing, mixto],
        };
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

    function alwaysAvailableMenusFor(categoryKey) {
        return (menusContext().menus || [])
            .filter(item =>
                String(item?.categoria_codigo || '').trim().toLowerCase() === String(categoryKey || '').trim().toLowerCase()
                && item?.activo !== false
            )
            .map(item => ({
                id: `menu-base-${item.id}`,
                ref_id: Number(item.id),
                category_key: categoryKey,
                title: item.nombre,
                subtitle: item.categoria_nombre || '',
                detail: item.descripcion || item.instrucciones || '',
                price: Number(item.precio_venta || 0),
                source_type: 'daily_menu',
                componentes: Array.isArray(item.componentes) ? item.componentes : [],
            }));
    }

    function categoryOptions(categoryKey) {
        const config = findCategoryConfig(categoryKey);
        if (!config) return [];
        return config.source === 'daily'
            ? (categoryUsesAlwaysAvailableMenus(categoryKey)
                ? alwaysAvailableMenusFor(categoryKey)
                : programmedMenusFor(categoryKey))
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

    function resetCobroDialog() {
        state.cobroDialog = {
            open: false,
            pedidoId: null,
            forma_pago: 'EFECTIVO',
            valor_pagado: '',
            pago_referencia: '',
            pago_observaciones: '',
        };
    }

    function resetPedidoState(preserveDate = true) {
        if (pedidoAutosaveTimer) {
            clearTimeout(pedidoAutosaveTimer);
            pedidoAutosaveTimer = null;
        }
        const currentDate = preserveDate ? (state.orderMeta.fecha_servicio || todayLocal()) : todayLocal();
        state.stage = 'setup';
        state.selectedCategory = 'desayunos';
        state.selectedGuestId = 1;
        state.selectedMenus = {};
        state.activeBuilder = null;
        state.pedidoActualId = null;
        state.pedidoActualCodigo = '';
        state.pedidoActualEstado = 'NUEVO';
        state.nextItemId = 1;
        resetCobroDialog();
        state.orderMeta = {
            fecha_servicio: currentDate,
            mesa: '',
            cliente: '',
            modo_entrega: 'SERVIDO',
        };
        state.guests = [defaultGuest(1)];
        ensureSelectedCategory();
    }

    function isPedidoEditable() {
        return !state.pedidoActualId || String(state.pedidoActualEstado || 'NUEVO').toUpperCase() === 'ABIERTO' || state.pedidoActualEstado === 'NUEVO';
    }

    function computeNextItemIdFromGuests(guests) {
        let maxId = 0;
        (guests || []).forEach(guest => {
            (guest.items || []).forEach(item => {
                const match = String(item.line_id || '').match(/pedido-item-(\d+)/);
                if (match) {
                    maxId = Math.max(maxId, Number(match[1]) || 0);
                }
            });
        });
        return maxId + 1;
    }

    function pedidoPayloadFromState() {
        return {
            fecha_servicio: state.orderMeta.fecha_servicio,
            mesa: state.orderMeta.mesa,
            cliente: state.orderMeta.cliente,
            modo_entrega: state.orderMeta.modo_entrega,
            selectedCategory: state.selectedCategory,
            selectedMenus: state.selectedMenus || {},
            guests: state.guests || [],
        };
    }

    function hydratePedidoStateFromRecord(pedido, goToCapture = false, options = {}) {
        const snapshot = pedido?.snapshot || {};
        const guests = Array.isArray(snapshot.guests) && snapshot.guests.length
            ? snapshot.guests.map((guest, guestIndex) => ({
                id: Number(guest.id) || (guestIndex + 1),
                label: String(guest.label || (guestIndex + 1)),
                observacion: String(guest.observacion || ''),
                items: Array.isArray(guest.items) ? guest.items.map(item => ({ ...item })) : [],
            }))
            : [defaultGuest(1)];

        state.pedidoActualId = Number(pedido?.id) || null;
        state.pedidoActualCodigo = pedido?.codigo || '';
        state.pedidoActualEstado = pedido?.estado || 'ABIERTO';
        state.selectedCategory = snapshot.selectedCategory || 'almuerzos';
        state.selectedMenus = snapshot.selectedMenus || {};
        state.activeBuilder = options.preserveActiveBuilder ? (options.activeBuilder || null) : null;
        const preferredGuestId = Number(options.preferredGuestId || 0);
        const matchingGuest = preferredGuestId
            ? guests.find(guest => Number(guest.id) === preferredGuestId)
            : null;
        state.selectedGuestId = Number(matchingGuest?.id || guests[0]?.id) || 1;
        state.nextItemId = computeNextItemIdFromGuests(guests);
        resetCobroDialog();
        state.orderMeta = {
            fecha_servicio: pedido?.fecha_servicio || state.orderMeta.fecha_servicio || todayLocal(),
            mesa: pedido?.mesa || '',
            cliente: pedido?.cliente || '',
            modo_entrega: pedido?.modo_entrega || 'SERVIDO',
        };
        state.guests = guests;
        state.stage = goToCapture ? 'capture' : 'setup';
        ensureSelectedCategory();
    }

    function syncCurrentPedidoMetaFromRecord(pedido) {
        if (!pedido) return;
        state.pedidoActualId = Number(pedido.id) || state.pedidoActualId || null;
        state.pedidoActualCodigo = pedido.codigo || state.pedidoActualCodigo || '';
        state.pedidoActualEstado = pedido.estado || state.pedidoActualEstado || 'ABIERTO';
        state.orderMeta = {
            fecha_servicio: pedido.fecha_servicio || state.orderMeta.fecha_servicio || todayLocal(),
            mesa: pedido.mesa || state.orderMeta.mesa || '',
            cliente: pedido.cliente || state.orderMeta.cliente || '',
            modo_entrega: pedido.modo_entrega || state.orderMeta.modo_entrega || 'SERVIDO',
        };
    }

    async function cargarPedidosSaborArtesanal(force = false) {
        if (state.pedidosLoading) return;
        if (!state.orderMeta.fecha_servicio) return;

        state.pedidosLoading = true;
        if (force) renderPedidoScreen();
        try {
            const result = await pedidoRequest(`/api/sabor-artesanal/pedidos?fecha_servicio=${encodeURIComponent(state.orderMeta.fecha_servicio)}`);
            state.pedidos = Array.isArray(result.pedidos) ? result.pedidos : [];
        } catch (error) {
            if (String(error.message || '').includes('404')) {
                try {
                    const fallback = await pedidoRequest(`/api/sabor-artesanal/menus/contexto?fecha_servicio=${encodeURIComponent(state.orderMeta.fecha_servicio)}`);
                    state.pedidos = Array.isArray(fallback.pedidos) ? fallback.pedidos : [];
                } catch (fallbackError) {
                    notifyError(fallbackError.message || 'No se pudieron cargar los pedidos del dia.');
                }
            } else {
                notifyError(error.message || 'No se pudieron cargar los pedidos del dia.');
            }
        } finally {
            state.pedidosLoading = false;
            renderPedidoScreen();
        }
    }

    async function persistCurrentPedido({ silent = false } = {}) {
        const payload = pedidoPayloadFromState();
        const hasContent = String(payload.mesa || '').trim() || String(payload.cliente || '').trim() || (payload.guests || []).some(guest => (guest.items || []).length > 0);
        if (!hasContent) {
            if (!silent) notifyError('Debes indicar la mesa o agregar al menos un producto para guardar el pedido.');
            return null;
        }

        const previousStage = state.stage;
        const previousSelectedGuestId = Number(state.selectedGuestId) || 1;
        const previousActiveBuilder = state.activeBuilder || null;
        const hadPedidoId = Boolean(state.pedidoActualId);
        const url = state.pedidoActualId
            ? `/api/sabor-artesanal/pedidos/${Number(state.pedidoActualId)}`
            : '/api/sabor-artesanal/pedidos';
        const method = state.pedidoActualId ? 'PUT' : 'POST';
        const result = await pedidoRequest(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const pedido = result.pedido || null;
        if (pedido) {
            if (silent && hadPedidoId) {
                syncCurrentPedidoMetaFromRecord(pedido);
                state.selectedGuestId = previousSelectedGuestId;
                state.activeBuilder = previousActiveBuilder;
            } else {
                hydratePedidoStateFromRecord(pedido, previousStage === 'capture', {
                    preferredGuestId: previousSelectedGuestId,
                    preserveActiveBuilder: Boolean(previousActiveBuilder) && silent,
                    activeBuilder: previousActiveBuilder,
                });
            }
            await cargarPedidosSaborArtesanal(false);
        }
        if (!silent) notifySuccess(result.mensaje || 'Pedido guardado correctamente.');
        return pedido;
    }

    function schedulePedidoAutosave() {
        if (!state.pedidoActualId || !isPedidoEditable()) return;
        if (pedidoAutosaveTimer) clearTimeout(pedidoAutosaveTimer);
        pedidoAutosaveTimer = setTimeout(async () => {
            pedidoAutosaveTimer = null;
            try {
                await persistCurrentPedido({ silent: true });
            } catch (error) {
                notifyError(error.message || 'No se pudo actualizar el pedido.');
            }
        }, 500);
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

    function builderSummaryLines(builder) {
        return (builder?.blocks || []).map(block => {
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
            return {
                key: block.key,
                label: block.label,
                value,
            };
        }).filter(Boolean);
    }

    function renderPedidosActivosStrip() {
        const pedidosActivos = (state.pedidos || []).filter(item => String(item.estado || '').toUpperCase() !== 'COBRADO');
        if (!pedidosActivos.length) return '';

        return `
            <section class="sabor-pedidos-active-strip">
                <div class="sabor-pedidos-summary-head">
                    <strong>Mesas y pedidos activos</strong>
                    <span>${pedidosActivos.length} abierto(s)</span>
                </div>
                <div class="sabor-pedidos-active-list">
                    ${pedidosActivos.map(pedido => `
                        <button
                            type="button"
                            class="sabor-pedidos-active-chip ${Number(state.pedidoActualId) === Number(pedido.id) ? 'active' : ''}"
                            onclick="abrirSaborPedidoGuardado(${Number(pedido.id)})"
                        >
                            <strong>${escapeValue(pedido.mesa || pedido.codigo || `Pedido ${pedido.id}`)}</strong>
                            <span>${escapeValue(pedidoStatusLabel(pedido.estado))} · ${money(pedido.total || 0)}</span>
                        </button>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderCobroDialog() {
        if (!state.cobroDialog?.open) return '';
        const pedido = (state.pedidos || []).find(item => Number(item.id) === Number(state.cobroDialog.pedidoId)) || null;
        if (!pedido) return '';

        return `
            <div class="sabor-pedidos-modal-backdrop" onclick="cancelarCobroSaborPedido()">
                <div class="sabor-pedidos-modal-card" onclick="event.stopPropagation()">
                    <div class="sabor-pedidos-modal-head">
                        <div>
                            <strong>Registrar cobro</strong>
                            <span>${escapeValue(pedido.codigo || `Pedido ${pedido.id}`)} · Mesa ${escapeValue(pedido.mesa || '-')}</span>
                        </div>
                        <button type="button" class="btn btn-secondary sabor-tabla-mini-btn" onclick="cancelarCobroSaborPedido()">Cerrar</button>
                    </div>
                    <div class="sabor-pedidos-modal-total">
                        <small>Total a cobrar</small>
                        <strong>${money(pedido.total || 0)}</strong>
                    </div>
                    <div class="sabor-pedidos-payment-grid">
                        ${PEDIDO_PAYMENT_OPTIONS.map(option => `
                            <button
                                type="button"
                                class="sabor-pedidos-payment-option ${state.cobroDialog.forma_pago === option.value ? 'is-selected' : ''}"
                                onclick="setCobroSaborPedidoField('forma_pago', '${option.value}')"
                            >
                                ${escapeValue(option.label)}
                            </button>
                        `).join('')}
                    </div>
                    <div class="sabor-pedidos-payment-fields">
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value="${escapeValue(state.cobroDialog.valor_pagado || '')}"
                            placeholder="Valor pagado"
                            onchange="setCobroSaborPedidoField('valor_pagado', this.value)"
                        >
                        <input
                            type="text"
                            value="${escapeValue(state.cobroDialog.pago_referencia || '')}"
                            placeholder="Referencia, comprobante o nota corta"
                            onchange="setCobroSaborPedidoField('pago_referencia', this.value)"
                        >
                        <textarea
                            rows="3"
                            placeholder="Observacion del pago"
                            onchange="setCobroSaborPedidoField('pago_observaciones', this.value)"
                        >${escapeValue(state.cobroDialog.pago_observaciones || '')}</textarea>
                    </div>
                    <div class="sabor-pedidos-modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="cancelarCobroSaborPedido()">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="confirmarCobroSaborPedido()">Confirmar cobro</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderBuilderDraftPreview(builder) {
        const lines = builderSummaryLines(builder);
        if (!builder) return '';
        return `
            <aside class="sabor-pedidos-builder-preview">
                <div class="sabor-pedidos-builder-preview-head">
                    <strong>Seleccion actual</strong>
                    <span>${money(builder.price || 0)}</span>
                </div>
                ${lines.length === 0 ? `
                    <div class="sabor-pedidos-builder-preview-empty">Todavia no has marcado opciones para este plato.</div>
                ` : `
                    <div class="sabor-pedidos-builder-preview-list">
                        ${lines.map(line => `
                            <div class="sabor-pedidos-builder-preview-line">
                                <small>${escapeValue(line.label)}</small>
                                <strong>${escapeValue(line.value)}</strong>
                            </div>
                        `).join('')}
                    </div>
                `}
                <div class="sabor-pedidos-builder-preview-note">Este borrador se agrega al comensal cuando pulses "Agregar al comensal".</div>
                <div class="sabor-pedidos-builder-actions">
                    <button type="button" class="btn btn-primary" onclick="addActiveSaborPedidoBuilderToGuest()">Agregar al comensal</button>
                </div>
            </aside>
        `;
    }

    function renderGuestDraftPreview(guest) {
        if (!guest || Number(guest.id) !== Number(state.selectedGuestId) || !state.activeBuilder) return '';
        const lines = builderSummaryLines(state.activeBuilder);
        return `
            <div class="sabor-pedidos-draft-card">
                <div class="sabor-pedidos-draft-head">
                    <strong>Borrador actual</strong>
                    <span>${money(state.activeBuilder.price || 0)}</span>
                </div>
                ${lines.length === 0 ? `
                    <div class="sabor-pedidos-empty-mini">Empieza a marcar opciones del plato a la derecha.</div>
                ` : `
                    ${lines.map(line => `
                        <div class="sabor-pedidos-draft-line">
                            <small>${escapeValue(line.label)}</small>
                            <strong>${escapeValue(line.value)}</strong>
                        </div>
                    `).join('')}
                `}
            </div>
        `;
    }

    function renderGuestSummary(guest) {
        const itemLines = guest.items.map(item => `
            <div class="sabor-pedidos-item-line read-only">
                <div class="sabor-pedidos-item-copy">
                    <strong>${escapeValue(item.qty)} x ${escapeValue(item.title)}</strong>
                    ${itemDetailLines(item).map(line => `<span>${escapeValue(line)}</span>`).join('')}
                </div>
                <div class="sabor-pedidos-item-side">
                    <div class="sabor-pedidos-item-total">${money((Number(item.price || 0) * Number(item.qty || 0)))}</div>
                    ${isPedidoEditable() ? `
                        <div class="sabor-pedidos-item-actions">
                            <button type="button" class="btn btn-secondary sabor-tabla-mini-btn" onclick="changeSaborPedidoItemQty(${Number(guest.id)}, '${escapeValue(item.line_id)}', -1)">-</button>
                            <button type="button" class="btn btn-secondary sabor-tabla-mini-btn" onclick="changeSaborPedidoItemQty(${Number(guest.id)}, '${escapeValue(item.line_id)}', 1)">+</button>
                            <button type="button" class="btn btn-danger sabor-tabla-mini-btn" onclick="removeSaborPedidoItem(${Number(guest.id)}, '${escapeValue(item.line_id)}')">Quitar</button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `).join('');
        const draftPreview = renderGuestDraftPreview(guest);

        if (!itemLines && !draftPreview) {
            return '<div class="sabor-pedidos-empty-mini">Sin productos.</div>';
        }

        return `${itemLines}${draftPreview}`;
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
        const blocks = menuBlocksForBuilder(menu).map((rawBlock, blockIndex) => {
            const block = mergePrincipioMixtoOption(rawBlock);
            const rawSelectorType = block.selector_tipo || 'single';
            const selectorType = rawSelectorType;
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

    function builderBlockAllowsEmptySelection(block) {
        const blockKey = String(block?.key || '').trim().toLowerCase();
        return blockKey === 'entradas' || blockKey === 'principios';
    }

    function builderBlockHasSelection(block) {
        return (block?.options || []).some(item => item.selected !== false);
    }

    function capturePedidoRenderPosition() {
        const optionsScroll = document.querySelector('#sabor_artesanalView .sabor-pedidos-options-scroll');
        const builderGroups = document.querySelector('#sabor_artesanalView .sabor-pedidos-builder-groups');
        return {
            windowY: window.scrollY || 0,
            optionsScrollTop: optionsScroll ? optionsScroll.scrollTop : 0,
            builderGroupsTop: builderGroups ? builderGroups.scrollTop : 0,
        };
    }

    function restorePedidoRenderPosition(position) {
        if (!position) return;
        const apply = () => {
            const optionsScroll = document.querySelector('#sabor_artesanalView .sabor-pedidos-options-scroll');
            const builderGroups = document.querySelector('#sabor_artesanalView .sabor-pedidos-builder-groups');
            window.scrollTo(0, Number(position.windowY || 0));
            if (optionsScroll) optionsScroll.scrollTop = Number(position.optionsScrollTop || 0);
            if (builderGroups) builderGroups.scrollTop = Number(position.builderGroupsTop || 0);
        };
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(apply);
            return;
        }
        apply();
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
        const isAlwaysAvailable = categoryUsesAlwaysAvailableMenus(category.key);
        return `
            <div class="sabor-pedidos-options-header">
                <strong>${escapeValue(category.label)}</strong>
                <span>${escapeValue(isAlwaysAvailable ? 'Disponible todos los dias' : 'Selecciona el menu y ajusta el plato abajo')}</span>
            </div>
            <div class="sabor-pedidos-menu-picker">
                <label for="saborPedidoMenuSelectorActual">${escapeValue(isAlwaysAvailable ? 'Opcion disponible' : 'Menu del dia')}</label>
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
                <div class="sabor-pedidos-builder-layout">
                    <div class="sabor-pedidos-builder-groups">
                        ${groups.length === 0 ? '<div class="placeholder">Este menu no tiene componentes configurados.</div>' : groups.map(group => `
                            <section class="sabor-pedidos-builder-group">
                                <div class="sabor-pedidos-builder-group-title">
                                    <span>${escapeValue(group.label)}</span>
                                    <small style="margin-left:8px; font-weight:400; text-transform:none; letter-spacing:0;">${escapeValue(group.selectorType === 'multi' ? 'Marca una o varias alternativas' : (builderBlockAllowsEmptySelection(group) ? 'Marca una alternativa o dejalo vacio' : (group.selectorType === 'grouped_single' ? 'Marca una alternativa por grupo' : 'Marca una alternativa')))}</small>
                                    ${builderBlockAllowsEmptySelection(group) && builderBlockHasSelection(group) ? `<button type="button" class="btn btn-secondary sabor-tabla-mini-btn" style="margin-left:auto;" onclick="clearSaborPedidoBuilderBlock('${escapeValue(group.key)}')">Quitar</button>` : ''}
                                </div>
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
                    </div>
                    ${renderBuilderDraftPreview(builder)}
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
            return `<div class="placeholder">No hay opciones para ${escapeValue(category.label)}${categoryUsesAlwaysAvailableMenus(category.key) ? '.' : ' en esta fecha.'}</div>`;
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

    function renderPedidosGuardados() {
        if (state.pedidosLoading) {
            return '<div class="placeholder">Cargando pedidos del dia...</div>';
        }
        if (!state.pedidos.length) {
            return '<div class="placeholder">Todavia no hay pedidos guardados para esta fecha.</div>';
        }

        return `
            <div class="sabor-pedidos-saved-list">
                ${state.pedidos.map(pedido => `
                    <article class="sabor-pedidos-saved-card ${Number(state.pedidoActualId) === Number(pedido.id) ? 'is-active' : ''}">
                        <div class="sabor-pedidos-saved-top">
                            <strong>${escapeValue(pedido.codigo || `Pedido ${pedido.id}`)}</strong>
                            <span class="sabor-pedidos-saved-status status-${String(pedido.estado || '').toLowerCase()}">${escapeValue(pedidoStatusLabel(pedido.estado))}</span>
                        </div>
                        <div class="sabor-pedidos-saved-meta">
                            <span><b>Mesa:</b> ${escapeValue(pedido.mesa || '-')}</span>
                            <span><b>Cliente:</b> ${escapeValue(pedido.cliente || 'General')}</span>
                            <span><b>Entrega:</b> ${escapeValue(pedido.modo_entrega || 'SERVIDO')}</span>
                            <span><b>Items:</b> ${escapeValue(pedido.items_count || 0)}</span>
                            <span><b>Total:</b> ${money(pedido.total || 0)}</span>
                        </div>
                        <div class="sabor-pedidos-saved-actions">
                            <button type="button" class="btn btn-secondary sabor-tabla-mini-btn" onclick="abrirSaborPedidoGuardado(${Number(pedido.id)})">Abrir</button>
                            ${String(pedido.estado || '').toUpperCase() === 'ABIERTO' ? `<button type="button" class="btn btn-primary sabor-tabla-mini-btn" onclick="finalizarSaborPedidoGuardado(${Number(pedido.id)})">Finalizar</button>` : ''}
                            ${String(pedido.estado || '').toUpperCase() === 'FINALIZADO' ? `<button type="button" class="btn btn-primary sabor-tabla-mini-btn" onclick="abrirCobroSaborPedidoGuardado(${Number(pedido.id)})">Cobrar</button>` : ''}
                            ${String(pedido.estado || '').toUpperCase() === 'FINALIZADO' ? `<button type="button" class="btn btn-secondary sabor-tabla-mini-btn" onclick="reabrirSaborPedidoGuardado(${Number(pedido.id)})">Reabrir</button>` : ''}
                            ${String(pedido.estado || '').toUpperCase() !== 'COBRADO' ? `<button type="button" class="btn btn-danger sabor-tabla-mini-btn" onclick="eliminarSaborPedidoGuardado(${Number(pedido.id)})">Borrar</button>` : ''}
                        </div>
                    </article>
                `).join('')}
            </div>
        `;
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
            <div class="sabor-pedidos-header-actions">
                <button type="button" class="btn btn-secondary sabor-tabla-back-btn" onclick="goToSaborPedidoSetup()">Volver a datos</button>
                <button type="button" class="btn btn-secondary sabor-tabla-back-btn" onclick="prepararNuevoSaborPedido()">Nuevo pedido</button>
                <button type="button" class="btn btn-secondary sabor-tabla-back-btn" onclick="guardarSaborPedidoActual()">Guardar pedido</button>
                ${String(state.pedidoActualEstado || '').toUpperCase() === 'ABIERTO' ? '<button type="button" class="btn btn-primary sabor-tabla-back-btn" onclick="finishSaborPedidoPreview()">Finalizar pedido</button>' : ''}
                ${String(state.pedidoActualEstado || '').toUpperCase() === 'FINALIZADO' ? '<button type="button" class="btn btn-secondary sabor-tabla-back-btn" onclick="reabrirSaborPedidoGuardado()">Reabrir pedido</button>' : ''}
                ${String(state.pedidoActualEstado || '').toUpperCase() === 'FINALIZADO' ? '<button type="button" class="btn btn-primary sabor-tabla-back-btn" onclick="abrirCobroSaborPedidoGuardado()">Cobrar pedido</button>' : ''}
                <button type="button" class="btn btn-secondary sabor-tabla-back-btn" onclick="resetSaborPedidoActual()">Limpiar pedido</button>
            </div>
            <div class="sabor-pedidos-header-fields">
                <div class="sabor-pedidos-header-field">
                    <small>Pedido</small>
                    <strong>${escapeValue(state.pedidoActualCodigo || 'Nuevo')}</strong>
                </div>
                <div class="sabor-pedidos-header-field">
                    <small>Estado</small>
                    <strong>${escapeValue(pedidoStatusLabel(state.pedidoActualEstado))}</strong>
                </div>
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
                    <div class="sabor-pedidos-header-actions">
                        <button type="button" class="btn btn-secondary sabor-tabla-back-btn" onclick="volverMenuPrincipalDesdeSaborArtesanal()">Volver al menu anterior</button>
                        <button type="button" class="btn btn-secondary sabor-tabla-back-btn" onclick="resetSaborPedidoActual()">Limpiar pedido</button>
                    </div>
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
                        <div class="sabor-pedidos-header-actions">
                            <button type="button" class="btn btn-secondary" onclick="guardarSaborPedidoActual()">Guardar pedido</button>
                            <button type="button" class="btn btn-primary" onclick="goToSaborPedidoCapture()">Tomar pedido</button>
                        </div>
                    </div>
                </div>
                <div class="sabor-pedidos-saved-shell">
                    <div class="sabor-pedidos-summary-head">
                        <strong>Pedidos de la fecha</strong>
                        <span>${state.pedidos.length} registrado(s)</span>
                    </div>
                    ${renderPedidosGuardados()}
                </div>
                ${renderCobroDialog()}
            </div>
        `;
    }

    function renderCaptureScreen() {
        const currentGuest = activeGuest();
        return `
            <div class="sabor-pedidos-shell">
                ${renderPedidosActivosStrip()}
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
                            <textarea id="saborPedidoObservacionActual" rows="2" placeholder="Observaciones del comensal ${escapeValue(currentGuest?.label || '1')}" oninput="setSaborPedidoGuestObservation(this.value)" ${isPedidoEditable() ? '' : 'disabled'}>${escapeValue(currentGuest?.observacion || '')}</textarea>
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
                        <button type="button" class="btn btn-secondary" onclick="addSaborPedidoGuest()" ${isPedidoEditable() ? '' : 'disabled'}>OTRO</button>
                        ${String(state.pedidoActualEstado || '').toUpperCase() === 'FINALIZADO'
                            ? '<button type="button" class="btn btn-secondary" onclick="reabrirSaborPedidoGuardado()">REABRIR</button>'
                            : `<button type="button" class="btn btn-primary" onclick="finishSaborPedidoPreview()" ${String(state.pedidoActualEstado || '').toUpperCase() === 'ABIERTO' ? '' : 'disabled'}>TERMINAR</button>`}
                    </div>
                </div>
                ${renderCobroDialog()}
            </div>
        `;
    }

    function renderPedidoScreen() {
        const panel = ventasPanel();
        if (!panel || panel.dataset.initializedPedidos !== 'true') return;
        const scrollPosition = capturePedidoRenderPosition();
        ensureSelectedCategory();
        panel.innerHTML = state.stage === 'capture' ? renderCaptureScreen() : renderSetupScreen();
        renderHeaderContext();
        restorePedidoRenderPosition(scrollPosition);
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
            await cargarPedidosSaborArtesanal(force);
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
            await cargarPedidosSaborArtesanal(force);
        } catch (error) {
            notifyError(error.message || 'No se pudo cargar el contexto para tomar pedidos.');
        } finally {
            state.loading = false;
            renderPedidoScreen();
        }
    };

    window.goToSaborPedidoSetup = function goToSaborPedidoSetup() {
        if (!isPedidoEditable()) {
            resetPedidoState(true);
        }
        state.stage = 'setup';
        resetActiveBuilder();
        renderPedidoScreen();
    };

    window.resetSaborPedidoActual = function resetSaborPedidoActual() {
        resetPedidoState(true);
        notifySuccess('El pedido actual se limpio. Ya puedes empezar a registrar lo vendido de hoy.');
        renderPedidoScreen();
    };

    window.prepararNuevoSaborPedido = async function prepararNuevoSaborPedido() {
        try {
            if (state.stage === 'capture' && isPedidoEditable() && hasPedidoContent()) {
                await persistCurrentPedido({ silent: true });
            }
        } catch (error) {
            notifyError(error.message || 'No se pudo guardar el pedido actual antes de abrir uno nuevo.');
            return;
        }
        resetPedidoState(true);
        state.stage = 'setup';
        renderPedidoScreen();
    };

    window.goToSaborPedidoCapture = async function goToSaborPedidoCapture() {
        if (!state.orderMeta.fecha_servicio) {
            notifyError('Debes seleccionar la fecha del pedido.');
            return;
        }
        if (!String(state.orderMeta.mesa || '').trim()) {
            notifyError('Debes indicar la mesa o numero del pedido.');
            return;
        }
        try {
            if (!state.pedidoActualId) {
                await persistCurrentPedido({ silent: true });
            } else if (isPedidoEditable()) {
                await persistCurrentPedido({ silent: true });
            }
        } catch (error) {
            notifyError(error.message || 'No se pudo preparar el pedido.');
            return;
        }
        state.stage = 'capture';
        ensureSelectedCategory();
        renderPedidoScreen();
    };

    window.setSaborPedidoMetaField = function setSaborPedidoMetaField(field, value) {
        if (field === 'fecha_servicio') {
            resetPedidoState(true);
            state.orderMeta.fecha_servicio = value || todayLocal();
            ensureSelectedCategory();
            resetActiveBuilder();
            cargarPedidosSaborArtesanal(true);
            renderPedidoScreen();
            return;
        }

        state.orderMeta[field] = value;
        if (state.pedidoActualId) {
            schedulePedidoAutosave();
        }
        renderPedidoScreen();
    };

    window.selectSaborPedidoGuest = function selectSaborPedidoGuest(guestId) {
        if (Number(state.selectedGuestId) !== Number(guestId)) {
            resetActiveBuilder();
        }
        state.selectedGuestId = Number(guestId) || 1;
        renderPedidoScreen();
    };

    window.addSaborPedidoGuest = function addSaborPedidoGuest() {
        if (!isPedidoEditable()) {
            notifyError('Debes reabrir el pedido para seguir agregando comensales.');
            return;
        }
        const nextId = (state.guests[state.guests.length - 1]?.id || 0) + 1;
        resetActiveBuilder();
        state.guests.push(defaultGuest(nextId));
        state.selectedGuestId = nextId;
        schedulePedidoAutosave();
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
        if (!isPedidoEditable()) {
            notifyError('Este pedido esta cerrado. Reabrelo para hacer cambios.');
            return;
        }
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
        if (!isPedidoEditable()) {
            notifyError('Este pedido esta cerrado. Reabrelo para hacer cambios.');
            return;
        }
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
        if (!isPedidoEditable()) {
            notifyError('Este pedido esta cerrado. Reabrelo para hacer cambios.');
            return;
        }
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
            const shouldClearGroup = builderBlockAllowsEmptySelection(block) && row.selected !== false;
            (block.options || []).forEach((item, index) => {
                if (builderOptionGroupKey(item, index) === targetGroupKey) {
                    item.selected = shouldClearGroup ? false : String(item.local_id) === String(localId);
                }
            });
        } else {
            const shouldClearSelection = builderBlockAllowsEmptySelection(block) && row.selected !== false;
            (block.options || []).forEach(item => {
                item.selected = shouldClearSelection ? false : String(item.local_id) === String(localId);
            });
        }
        renderPedidoScreen();
    };

    window.clearSaborPedidoBuilderBlock = function clearSaborPedidoBuilderBlock(blockKey) {
        if (!isPedidoEditable()) {
            notifyError('Este pedido esta cerrado. Reabrelo para hacer cambios.');
            return;
        }
        const builder = state.activeBuilder;
        if (!builder) return;
        const block = (builder.blocks || []).find(item => String(item.key) === String(blockKey));
        if (!block) return;
        (block.options || []).forEach(item => {
            item.selected = false;
        });
        renderPedidoScreen();
    };

    window.addActiveSaborPedidoBuilderToGuest = function addActiveSaborPedidoBuilderToGuest() {
        if (!isPedidoEditable()) {
            notifyError('Este pedido esta cerrado. Reabrelo para hacer cambios.');
            return;
        }
        const guest = activeGuest();
        const builder = state.activeBuilder;
        if (!guest || !builder) return;

        const componentsSummary = builderSummaryLines(builder).map(line => `${line.label}: ${line.value}`);
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
        schedulePedidoAutosave();
        renderPedidoScreen();
    };

    window.addSaborPedidoOption = function addSaborPedidoOption(categoryKey, optionId) {
        if (!isPedidoEditable()) {
            notifyError('Este pedido esta cerrado. Reabrelo para hacer cambios.');
            return;
        }
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
        schedulePedidoAutosave();
        renderPedidoScreen();
    };

    window.changeSaborPedidoItemQty = function changeSaborPedidoItemQty(guestId, lineId, delta) {
        if (!isPedidoEditable()) {
            notifyError('Este pedido esta cerrado. Reabrelo para hacer cambios.');
            return;
        }
        const guest = (state.guests || []).find(item => Number(item.id) === Number(guestId));
        const orderItem = guest?.items?.find(item => String(item.line_id) === String(lineId));
        if (!guest || !orderItem) return;
        orderItem.qty = Math.max(1, Number(orderItem.qty || 1) + Number(delta || 0));
        schedulePedidoAutosave();
        renderPedidoScreen();
    };

    window.removeSaborPedidoItem = function removeSaborPedidoItem(guestId, lineId) {
        if (!isPedidoEditable()) {
            notifyError('Este pedido esta cerrado. Reabrelo para hacer cambios.');
            return;
        }
        const guest = (state.guests || []).find(item => Number(item.id) === Number(guestId));
        if (!guest) return;
        guest.items = (guest.items || []).filter(item => String(item.line_id) !== String(lineId));
        schedulePedidoAutosave();
        renderPedidoScreen();
    };

    window.setSaborPedidoGuestObservation = function setSaborPedidoGuestObservation(value) {
        if (!isPedidoEditable()) {
            notifyError('Este pedido esta cerrado. Reabrelo para editar observaciones.');
            return;
        }
        const guest = activeGuest();
        if (!guest) return;
        guest.observacion = value;
        syncObservationPreview(guest);
        schedulePedidoAutosave();
    };

    window.guardarSaborPedidoActual = async function guardarSaborPedidoActual() {
        try {
            await persistCurrentPedido({ silent: false });
        } catch (error) {
            notifyError(error.message || 'No se pudo guardar el pedido.');
        }
    };

    window.abrirSaborPedidoGuardado = function abrirSaborPedidoGuardado(pedidoId) {
        const pedido = (state.pedidos || []).find(item => Number(item.id) === Number(pedidoId));
        if (!pedido) {
            notifyError('No se encontro el pedido seleccionado.');
            return;
        }
        hydratePedidoStateFromRecord(pedido, true);
        renderPedidoScreen();
    };

    window.finalizarSaborPedidoGuardado = async function finalizarSaborPedidoGuardado(pedidoId = state.pedidoActualId) {
        const targetId = Number(pedidoId || 0);
        if (!targetId) {
            notifyError('Primero guarda el pedido antes de finalizarlo.');
            return;
        }
        try {
            const finalizeCurrentPedido = Number(state.pedidoActualId) === targetId;
            if (Number(state.pedidoActualId) === targetId && isPedidoEditable()) {
                await persistCurrentPedido({ silent: true });
            }
            const result = await pedidoRequest(`/api/sabor-artesanal/pedidos/${targetId}/finalizar`, { method: 'POST' });
            await cargarPedidosSaborArtesanal(true);
            if (finalizeCurrentPedido && result.pedido) {
                hydratePedidoStateFromRecord(result.pedido, false);
            }
            if (finalizeCurrentPedido) {
                resetPedidoState(true);
                state.stage = 'setup';
            }
            notifySuccess(result.mensaje || 'Pedido finalizado correctamente.');
            renderPedidoScreen();
        } catch (error) {
            notifyError(error.message || 'No se pudo finalizar el pedido.');
        }
    };

    window.reabrirSaborPedidoGuardado = async function reabrirSaborPedidoGuardado(pedidoId = state.pedidoActualId) {
        const targetId = Number(pedidoId || 0);
        if (!targetId) return;
        try {
            const result = await pedidoRequest(`/api/sabor-artesanal/pedidos/${targetId}/reabrir`, { method: 'POST' });
            await cargarPedidosSaborArtesanal(true);
            if (Number(state.pedidoActualId) === targetId && result.pedido) {
                hydratePedidoStateFromRecord(result.pedido, true);
            }
            notifySuccess(result.mensaje || 'Pedido reabierto correctamente.');
            renderPedidoScreen();
        } catch (error) {
            notifyError(error.message || 'No se pudo reabrir el pedido.');
        }
    };

    window.eliminarSaborPedidoGuardado = async function eliminarSaborPedidoGuardado(pedidoId) {
        const targetId = Number(pedidoId || 0);
        if (!targetId) return;
        if (!window.confirm('Confirma eliminar este pedido.')) return;
        try {
            const result = await pedidoRequest(`/api/sabor-artesanal/pedidos/${targetId}`, { method: 'DELETE' });
            if (Number(state.pedidoActualId) === targetId) {
                resetPedidoState(true);
            }
            await cargarPedidosSaborArtesanal(true);
            notifySuccess(result.mensaje || 'Pedido eliminado correctamente.');
            renderPedidoScreen();
        } catch (error) {
            notifyError(error.message || 'No se pudo eliminar el pedido.');
        }
    };

    window.cobrarSaborPedidoGuardado = async function cobrarSaborPedidoGuardado(pedidoId = state.pedidoActualId) {
        const targetId = Number(pedidoId || 0);
        const pedido = (state.pedidos || []).find(item => Number(item.id) === targetId) || null;
        if (!targetId || !pedido) {
            notifyError('No se encontro el pedido a cobrar.');
            return;
        }

        try {
            const result = await pedidoRequest(`/api/sabor-artesanal/pedidos/${targetId}/cobrar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    forma_pago: state.cobroDialog.forma_pago,
                    valor_pagado: state.cobroDialog.valor_pagado || pedido.total,
                    pago_referencia: state.cobroDialog.pago_referencia,
                    pago_observaciones: state.cobroDialog.pago_observaciones,
                }),
            });
            await cargarPedidosSaborArtesanal(true);
            if (Number(state.pedidoActualId) === targetId && result.pedido) {
                hydratePedidoStateFromRecord(result.pedido, false);
            }
            resetCobroDialog();
            notifySuccess(result.mensaje || 'Cobro registrado correctamente.');
            renderPedidoScreen();
        } catch (error) {
            notifyError(error.message || 'No se pudo registrar el cobro.');
        }
    };

    window.abrirCobroSaborPedidoGuardado = function abrirCobroSaborPedidoGuardado(pedidoId = state.pedidoActualId) {
        const targetId = Number(pedidoId || 0);
        const pedido = (state.pedidos || []).find(item => Number(item.id) === Number(targetId)) || null;
        if (!targetId || !pedido) {
            notifyError('No se encontro el pedido a cobrar.');
            return;
        }
        state.cobroDialog = {
            open: true,
            pedidoId: targetId,
            forma_pago: String(pedido.forma_pago || 'EFECTIVO').toUpperCase(),
            valor_pagado: String(pedido.valor_pagado || pedido.total || ''),
            pago_referencia: pedido.pago_referencia || '',
            pago_observaciones: pedido.pago_observaciones || '',
        };
        renderPedidoScreen();
    };

    window.cancelarCobroSaborPedido = function cancelarCobroSaborPedido() {
        resetCobroDialog();
        renderPedidoScreen();
    };

    window.setCobroSaborPedidoField = function setCobroSaborPedidoField(field, value) {
        if (!state.cobroDialog) resetCobroDialog();
        state.cobroDialog[field] = value;
        renderPedidoScreen();
    };

    window.confirmarCobroSaborPedido = async function confirmarCobroSaborPedido() {
        if (!state.cobroDialog?.pedidoId) {
            notifyError('No se encontro el pedido a cobrar.');
            return;
        }
        await window.cobrarSaborPedidoGuardado(state.cobroDialog.pedidoId);
    };

    window.finishSaborPedidoPreview = async function finishSaborPedidoPreview() {
        await window.finalizarSaborPedidoGuardado(state.pedidoActualId);
    };

    window.syncSaborPedidoChrome = function syncSaborPedidoChrome() {
        renderHeaderContext();
    };
})();
