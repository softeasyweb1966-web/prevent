(function () {
    const MENU_SECTION_TEMPLATES = [
        {
            codigo: 'entradas',
            label: 'Sopa / Entrada',
            selector_tipo: 'single',
            helper: 'Trae las sopas o entradas definidas en Tablas para el menu del dia.',
            categorias: ['entradas'],
        },
        {
            codigo: 'principios',
            label: 'Principio',
            selector_tipo: 'grouped_single',
            helper: 'Selecciona una opcion de Granos y otra de Verduras desde Tablas.',
            categorias: ['principios'],
        },
        {
            codigo: 'proteinas',
            label: 'Proteina',
            selector_tipo: 'single',
            helper: 'Puedes definir de 1 a 4 proteinas. En cada fila eliges la proteina y luego su presentacion.',
            categorias: ['proteinas'],
        },
        {
            codigo: 'ensaladas',
            label: 'Ensaladas',
            selector_tipo: 'multi',
            helper: 'Marca las ensaladas disponibles para este almuerzo.',
            categorias: ['ensaladas'],
        },
        {
            codigo: 'complementos',
            label: 'Complementos',
            selector_tipo: 'multi',
            helper: 'Marca los complementos que luego se podran activar o desactivar en ventas.',
            categorias: ['basicos', 'acompanamientos', 'adicionales', 'bebidas_frias', 'bebidas_calientes'],
        },
    ];

    const MENU_CATEGORY_LAYOUTS = {
        almuerzos: {
            label: 'Almuerzo',
            blockCodes: ['entradas', 'principios', 'proteinas', 'ensaladas', 'complementos'],
        },
        default: {
            label: 'Menu del dia',
            blockCodes: ['entradas', 'principios', 'proteinas', 'complementos'],
        },
    };

    const DEFAULT_MENU_FORM = () => ({
        editingId: null,
        categoria_id: '',
        descripcion: '',
        instrucciones: '',
        precio_venta: '',
        activo: true,
        bloques: MENU_SECTION_TEMPLATES.map(template => ({
            codigo: template.codigo,
            label: template.label,
            selector_tipo: template.selector_tipo,
            opciones: [],
        })),
    });

    const DEFAULT_CATEGORIA_FORM = () => ({
        editingId: null,
        nombre: '',
        codigo: '',
        descripcion: '',
        orden: '',
        activo: true,
    });

    const DEFAULT_PROGRAMACION_FORM = () => ({
        editingId: null,
        fecha_servicio: new Date().toISOString().slice(0, 10),
        categoria_id: '',
        menu_id: '',
        observaciones: '',
    });

    const state = window._saborArtesanalMenusState || {
        initialized: false,
        loading: false,
        loaded: false,
        categoriasMenu: [],
        tablasCatalogo: {},
        menus: [],
        programaciones: [],
        menuFilters: {
            categoria_id: 'all',
            search: '',
        },
        programacionFilters: {
            categoria_id: 'all',
            search: '',
        },
        categoriaForm: DEFAULT_CATEGORIA_FORM(),
        menuForm: DEFAULT_MENU_FORM(),
        programacionForm: DEFAULT_PROGRAMACION_FORM(),
    };
    window._saborArtesanalMenusState = state;

    function saborEscape(value) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(value);
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function notifySuccess(message) {
        if (typeof window.showSuccess === 'function') window.showSuccess(message);
    }

    function notifyError(message) {
        if (typeof window.showError === 'function') window.showError(message);
    }

    function panelNode() {
        return document.getElementById('saborArtesanalMenusPanel');
    }

    function categoriasOrdenadas() {
        return [...(state.categoriasMenu || [])].sort((a, b) => {
            if (Number(a.activo) !== Number(b.activo)) return Number(b.activo) - Number(a.activo);
            if (Number(a.orden || 0) !== Number(b.orden || 0)) return Number(a.orden || 0) - Number(b.orden || 0);
            return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
        });
    }

    function menusOrdenados() {
        return [...(state.menus || [])].sort((a, b) => {
            if (Number(a.activo) !== Number(b.activo)) return Number(b.activo) - Number(a.activo);
            return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
        });
    }

    function programacionesOrdenadas() {
        return [...(state.programaciones || [])].sort((a, b) => {
            const dateCompare = String(a.fecha_servicio || '').localeCompare(String(b.fecha_servicio || ''));
            if (dateCompare !== 0) return dateCompare;
            return String(a.categoria_nombre || '').localeCompare(String(b.categoria_nombre || ''), 'es');
        });
    }

    function getCategoriaMenuById(categoriaId) {
        return (state.categoriasMenu || []).find(item => Number(item.id) === Number(categoriaId)) || null;
    }

    function categoriaMenuRequierePrecio(categoriaId) {
        const categoria = getCategoriaMenuById(categoriaId);
        const codigo = String(categoria?.codigo || '').trim().toLowerCase();
        return ['desayunos', 'almuerzos', 'parrillas', 'especiales'].includes(codigo);
    }

    function getMenuById(menuId) {
        return (state.menus || []).find(item => Number(item.id) === Number(menuId)) || null;
    }

    function getCategoriaCodigo(categoriaId) {
        return String(getCategoriaMenuById(categoriaId)?.codigo || '').trim().toLowerCase();
    }

    function currentCategoryLayout(categoriaId) {
        const code = getCategoriaCodigo(categoriaId);
        return MENU_CATEGORY_LAYOUTS[code] || MENU_CATEGORY_LAYOUTS.default;
    }

    function isPrincipiosBlock(blockOrCode) {
        const code = typeof blockOrCode === 'string'
            ? blockOrCode
            : (blockOrCode?.codigo || blockOrCode?.key || '');
        return String(code || '').trim().toLowerCase() === 'principios';
    }

    function isProteinasBlock(blockOrCode) {
        const code = typeof blockOrCode === 'string'
            ? blockOrCode
            : (blockOrCode?.codigo || blockOrCode?.key || '');
        return String(code || '').trim().toLowerCase() === 'proteinas';
    }

    function isEnsaladasBlock(blockOrCode) {
        const code = typeof blockOrCode === 'string'
            ? blockOrCode
            : (blockOrCode?.codigo || blockOrCode?.key || '');
        return String(code || '').trim().toLowerCase() === 'ensaladas';
    }

    function normalizeBlockSelectorType(blockOrCode, selectorType, options = []) {
        const normalized = String(selectorType || '').trim().toLowerCase() || 'single';
        if (normalized === 'grouped_single') return normalized;
        if (isPrincipiosBlock(blockOrCode) && (options || []).some(option => option.grupo_codigo || option.grupo_label)) {
            return 'grouped_single';
        }
        return normalized;
    }

    function groupKeyForOption(option, fallback = 'general') {
        return String(option?.grupo_codigo || option?.grupo_label || fallback).trim().toLowerCase() || fallback;
    }

    function getProgramacionById(programacionId) {
        return (state.programaciones || []).find(item => Number(item.id) === Number(programacionId)) || null;
    }

    function getTablaCatalogo(categoria) {
        return state.tablasCatalogo?.[categoria]?.items || [];
    }

    function getTablaFlatOptions(categoria) {
        return getTablaCatalogo(categoria).flatMap(parent => {
            const children = Array.isArray(parent.children) ? parent.children : [];
            if (children.length > 0) {
                return children.map(child => ({
                    id: child.id,
                    tabla_categoria: categoria,
                    label: `${parent.nombre} / ${child.nombre}${child.precio_venta != null ? ` | ${typeof formatCurrency === 'function' ? formatCurrency(child.precio_venta) : child.precio_venta}` : ''}`,
                    principal_nombre: parent.nombre,
                    item_nombre: child.nombre,
                    grupo_codigo: parent.nombre || '',
                    grupo_label: parent.nombre || '',
                    activo: child.activo !== false,
                }));
            }
            return [{
                id: parent.id,
                tabla_categoria: categoria,
                label: `${parent.nombre}${parent.precio_venta != null ? ` | ${typeof formatCurrency === 'function' ? formatCurrency(parent.precio_venta) : parent.precio_venta}` : ''}`,
                principal_nombre: parent.nombre,
                item_nombre: parent.nombre,
                grupo_codigo: '',
                grupo_label: '',
                activo: parent.activo !== false,
            }];
        });
    }

    function categoriesForBlock(blockOrTemplate, categoriaId = state.menuForm?.categoria_id) {
        const code = String(blockOrTemplate?.codigo || '').trim().toLowerCase();
        const categoriaCodigo = getCategoriaCodigo(categoriaId);
        if (categoriaCodigo === 'almuerzos') {
            if (code === 'ensaladas') return ['ensaladas'];
            if (code === 'complementos') return ['basicos', 'acompanamientos'];
        }
        return Array.isArray(blockOrTemplate?.categorias) ? blockOrTemplate.categorias : [];
    }

    function getProteinParentItems() {
        return getTablaCatalogo('proteinas').filter(item => item.activo !== false);
    }

    function getProteinParentItem(parentId) {
        return getProteinParentItems().find(item => Number(item.id) === Number(parentId)) || null;
    }

    function proteinUsesDefaultPlancha(parentName) {
        const normalized = String(parentName || '').trim().toLowerCase();
        return ['res', 'cerdo', 'pechuga'].includes(normalized);
    }

    function getProteinPresentationOptions(parentId) {
        const parent = getProteinParentItem(parentId);
        if (!parent) return [];
        const children = Array.isArray(parent.children)
            ? parent.children.filter(item => item.activo !== false)
            : [];
        const options = children.map(child => ({
            id: child.id,
            nombre: child.nombre,
            label: child.nombre,
            parent_id: parent.id,
            parent_nombre: parent.nombre,
            isFallback: false,
        }));
        const needsDefaultPlancha = proteinUsesDefaultPlancha(parent.nombre);
        const hasPlancha = options.some(item => String(item.nombre || '').trim().toLowerCase() === 'a la plancha');
        if (needsDefaultPlancha && !hasPlancha) {
            options.unshift({
                id: parent.id,
                nombre: 'A la plancha',
                label: 'A la plancha',
                parent_id: parent.id,
                parent_nombre: parent.nombre,
                isFallback: true,
            });
        }
        if (options.length > 0) {
            return options;
        }
        return [{
            id: parent.id,
            nombre: needsDefaultPlancha ? 'A la plancha' : parent.nombre,
            label: needsDefaultPlancha ? 'A la plancha' : 'Sin presentaciones',
            parent_id: parent.id,
            parent_nombre: parent.nombre,
            isFallback: true,
        }];
    }

    function syncProteinOptionSelection(option) {
        if (!option) return option;
        const fallbackParentId = option.parent_item_id
            || (option.principal_nombre && option.principal_nombre === option.item_nombre ? option.tabla_item_id : '');
        const parent = getProteinParentItem(fallbackParentId || option.parent_id || option.tabla_item_id);
        if (!parent) return option;

        option.parent_item_id = String(parent.id);
        option.principal_nombre = parent.nombre || option.principal_nombre || '';

        const presentationOptions = getProteinPresentationOptions(parent.id);
        const selected = presentationOptions.find(item => Number(item.id) === Number(option.tabla_item_id)) || null;
        if (selected) {
            option.item_nombre = selected.nombre;
            option.presentacion = selected.label || selected.nombre || '';
            option.tabla_item_id = String(selected.id);
        } else if (presentationOptions.length === 1 && presentationOptions[0].isFallback) {
            option.tabla_item_id = String(parent.id);
            option.item_nombre = presentationOptions[0].nombre || parent.nombre;
            option.presentacion = presentationOptions[0].label || presentationOptions[0].nombre || '';
        } else {
            option.tabla_item_id = '';
            option.item_nombre = '';
            option.presentacion = '';
        }
        return option;
    }

    function countTablaDisponibles(categoria) {
        return getTablaFlatOptions(categoria).filter(item => item.activo !== false).length;
    }

    function getCategoriaTablaLabel(categoria) {
        return state.tablasCatalogo?.[categoria]?.label || categoria;
    }

    function getMenuSectionTemplate(blockCode) {
        return MENU_SECTION_TEMPLATES.find(item => item.codigo === blockCode) || null;
    }

    function createDefaultBlock(template) {
        return {
            codigo: template.codigo,
            label: template.label,
            selector_tipo: template.selector_tipo,
            opciones: [],
        };
    }

    function normalizeBlockOption(rawOption, block) {
        const option = {
            tabla_categoria: rawOption.tabla_categoria || '',
            tabla_item_id: String(rawOption.tabla_item_id || rawOption.id || ''),
            parent_item_id: String(rawOption.parent_item_id || rawOption.parent_id || ''),
            principal_nombre: rawOption.principal_nombre || '',
            item_nombre: rawOption.item_nombre || '',
            grupo_codigo: rawOption.grupo_codigo || '',
            grupo_label: rawOption.grupo_label || '',
            cantidad: String(rawOption.cantidad_texto || rawOption.cantidad || '1'),
            unidad: rawOption.unidad || 'porcion',
            presentacion: rawOption.presentacion || '',
            acompanamiento: rawOption.acompanamiento || '',
            observaciones: rawOption.observaciones || '',
            seleccion_default: rawOption.seleccion_default === true,
            label: rawOption.label || rawOption.item_nombre || rawOption.principal_nombre || '',
        };
        if (isProteinasBlock(block)) {
            syncProteinOptionSelection(option);
        }
        return option;
    }

    function ensureSingleBlockDefault(block) {
        if (!block || !['single', 'grouped_single'].includes(block.selector_tipo)) return;
        if (block.selector_tipo === 'grouped_single') {
            const seenGroups = new Set();
            (block.opciones || []).forEach((option, index) => {
                const groupKey = groupKeyForOption(option, `grupo-${index + 1}`);
                if (option.seleccion_default && !seenGroups.has(groupKey)) {
                    seenGroups.add(groupKey);
                    return;
                }
                option.seleccion_default = false;
            });
            (block.opciones || []).forEach((option, index) => {
                const groupKey = groupKeyForOption(option, `grupo-${index + 1}`);
                if (!seenGroups.has(groupKey)) {
                    option.seleccion_default = true;
                    seenGroups.add(groupKey);
                }
            });
            return;
        }
        let found = false;
        (block.opciones || []).forEach((option, index) => {
            if (option.seleccion_default && !found) {
                found = true;
                return;
            }
            option.seleccion_default = false;
            if (!found && index === 0) {
                option.seleccion_default = true;
                found = true;
            }
        });
    }

    function ensureMenuFormBlocks() {
        const currentBlocks = Array.isArray(state.menuForm?.bloques) ? state.menuForm.bloques : [];
        const mergedBlocks = MENU_SECTION_TEMPLATES.map(template => {
            const existing = currentBlocks.find(block => block.codigo === template.codigo);
            const block = existing
                ? {
                    codigo: existing.codigo || template.codigo,
                    label: existing.label || template.label,
                    selector_tipo: normalizeBlockSelectorType(
                        existing.codigo || template.codigo,
                        existing.selector_tipo || template.selector_tipo,
                        existing.opciones || []
                    ),
                    opciones: (existing.opciones || []).map(option => normalizeBlockOption(option, existing)),
                }
                : createDefaultBlock(template);
            ensureSingleBlockDefault(block);
            return block;
        });

        currentBlocks
            .filter(block => !mergedBlocks.some(item => item.codigo === block.codigo))
            .forEach(block => mergedBlocks.push(block));

        state.menuForm.bloques = mergedBlocks;
    }

    function getBlockByCode(blockCode) {
        ensureMenuFormBlocks();
        return (state.menuForm.bloques || []).find(block => block.codigo === blockCode) || null;
    }

    function optionsForBlock(template) {
        return categoriesForBlock(template).flatMap(categoria =>
            getTablaFlatOptions(categoria)
                .filter(item => item.activo !== false)
                .map(item => ({
                    ...item,
                    tabla_label: getCategoriaTablaLabel(categoria),
                }))
        );
    }

    function buildLegacyBlocksFromComponents(componentes = []) {
        const grouped = new Map();
        (componentes || []).forEach(component => {
            const code = component.bloque_codigo || component.tabla_categoria || 'otros';
            if (!grouped.has(code)) {
                grouped.set(code, {
                    codigo: code,
                    label: component.bloque_label || component.tabla_label || code,
                    selector_tipo: component.selector_tipo || 'single',
                    opciones: [],
                });
            }
            grouped.get(code).opciones.push({
                tabla_categoria: component.tabla_categoria,
                tabla_item_id: String(component.tabla_item_id || ''),
                principal_nombre: component.principal_nombre || '',
                item_nombre: component.item_nombre || '',
                grupo_codigo: component.grupo_codigo || '',
                grupo_label: component.grupo_label || '',
                cantidad: String(component.cantidad_texto || component.cantidad || '1'),
                unidad: component.unidad || 'porcion',
                observaciones: component.observaciones || '',
                seleccion_default: component.seleccion_default === true,
                label: component.item_nombre || component.principal_nombre || '',
            });
        });
        return [...grouped.values()];
    }

    function resetCategoriaForm() {
        state.categoriaForm = DEFAULT_CATEGORIA_FORM();
        renderSaborArtesanalMenus();
    }

    function resetMenuForm() {
        const firstCategoria = categoriasOrdenadas().find(item => item.activo !== false) || categoriasOrdenadas()[0] || null;
        state.menuForm = DEFAULT_MENU_FORM();
        if (firstCategoria) state.menuForm.categoria_id = String(firstCategoria.id);
        ensureMenuFormBlocks();
        renderSaborArtesanalMenus();
    }

    function resetProgramacionForm() {
        const firstCategoria = categoriasOrdenadas().find(item => item.activo !== false) || categoriasOrdenadas()[0] || null;
        state.programacionForm = DEFAULT_PROGRAMACION_FORM();
        if (firstCategoria) state.programacionForm.categoria_id = String(firstCategoria.id);
        syncProgramacionMenuSeleccion();
        renderSaborArtesanalMenus();
    }

    function syncProgramacionMenuSeleccion() {
        const categoriaId = Number(state.programacionForm.categoria_id) || null;
        const menus = menusOrdenados().filter(menu => Number(menu.categoria_id) === categoriaId && menu.activo !== false);
        if (!menus.some(menu => Number(menu.id) === Number(state.programacionForm.menu_id))) {
            state.programacionForm.menu_id = menus[0] ? String(menus[0].id) : '';
        }
    }

    function ensureFormDefaults() {
        if (!state.menuForm?.categoria_id) {
            const firstCategoria = categoriasOrdenadas().find(item => item.activo !== false) || categoriasOrdenadas()[0] || null;
            if (firstCategoria) state.menuForm.categoria_id = String(firstCategoria.id);
        }
        if (!state.programacionForm?.categoria_id) {
            const firstCategoria = categoriasOrdenadas().find(item => item.activo !== false) || categoriasOrdenadas()[0] || null;
            if (firstCategoria) state.programacionForm.categoria_id = String(firstCategoria.id);
        }
        ensureMenuFormBlocks();
        syncProgramacionMenuSeleccion();
    }

    function visibleMenuBlocksForForm() {
        ensureMenuFormBlocks();
        const layout = currentCategoryLayout(state.menuForm?.categoria_id);
        const allowed = new Set(layout.blockCodes || []);
        return (state.menuForm?.bloques || []).filter(block => allowed.has(block.codigo));
    }

    function summarizeMenuBlock(menu, blockCode) {
        const block = (menu?.bloques || []).find(item => item.codigo === blockCode) || null;
        if (!block || !Array.isArray(block.opciones) || block.opciones.length === 0) return '';
        if (blockCode === 'principios') {
            const granos = block.opciones.find(item => groupKeyForOption(item) === 'granos');
            const verduras = block.opciones.find(item => groupKeyForOption(item) === 'verduras');
            const partes = [];
            if (granos?.item_nombre) partes.push(`Granos: ${granos.item_nombre}`);
            if (verduras?.item_nombre) partes.push(`Verduras: ${verduras.item_nombre}`);
            return partes.join(' | ');
        }
        if (blockCode === 'proteinas') {
            return block.opciones
                .map(item => {
                    const principal = String(item.principal_nombre || '').trim();
                    const presentacion = String(item.presentacion || item.item_nombre || '').trim();
                    if (principal && presentacion && principal.toLowerCase() !== presentacion.toLowerCase()) {
                        return `${principal}: ${presentacion}`;
                    }
                    return presentacion || principal;
                })
                .filter(Boolean)
                .join(', ');
        }
        return block.opciones.map(item => item.item_nombre || item.principal_nombre || '').filter(Boolean).join(', ');
    }

    function menuDisplayTitle(menu) {
        if (!menu) return 'Menu';
        const categoria = menu.categoria_nombre || 'Menu';
        const entrada = summarizeMenuBlock(menu, 'entradas');
        const proteina = summarizeMenuBlock(menu, 'proteinas');
        const partes = [categoria];
        if (entrada) partes.push(entrada);
        if (proteina) partes.push(proteina);
        return partes.join(' | ');
    }

    function menuDisplaySubtitle(menu) {
        if (!menu) return '';
        const principios = summarizeMenuBlock(menu, 'principios');
        const ensaladas = summarizeMenuBlock(menu, 'ensaladas');
        const complementos = summarizeMenuBlock(menu, 'complementos');
        const partes = [];
        if (principios) partes.push(principios);
        if (ensaladas) partes.push(`Ensaladas: ${ensaladas}`);
        if (complementos) partes.push(`Complementos: ${complementos}`);
        return partes.join(' | ');
    }

    async function saborRequest(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'include',
            ...options,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Error ${response.status}`);
        }
        return result;
    }

    window.ensureSaborArtesanalMenusUI = function ensureSaborArtesanalMenusUI() {
        const panel = panelNode();
        if (!panel || panel.dataset.initializedMenus === 'true') return;

        panel.innerHTML = `
            <div class="sabor-menus-shell">
                <div class="sabor-artesanal-panel-head">
                    <button type="button" class="btn btn-secondary sabor-tabla-back-btn" onclick="volverMenuPrincipalDesdeSaborArtesanal()">Volver al menu anterior</button>
                    <h3 style="margin:0;">Menus</h3>
                </div>
                <div id="saborMenusStats"></div>
                <div class="sabor-menus-grid sabor-menus-grid-single">
                    <section class="sabor-menus-card" id="saborMenuBuilderCard"></section>
                </div>
                <div class="sabor-menus-grid sabor-menus-grid-bottom">
                    <section class="sabor-menus-card" id="saborMenuListadoCard"></section>
                    <section class="sabor-menus-card" id="saborMenuProgramacionCard"></section>
                </div>
            </div>
        `;
        panel.dataset.initializedMenus = 'true';
        ensureFormDefaults();
        renderSaborArtesanalMenus();
    };

    window.cargarContextoMenusSaborArtesanal = async function cargarContextoMenusSaborArtesanal(force = false) {
        if (state.loading) return;
        if (state.loaded && !force) {
            ensureFormDefaults();
            renderSaborArtesanalMenus();
            return;
        }

        state.loading = true;
        renderSaborArtesanalMenus();
        try {
            const result = await saborRequest('/api/sabor-artesanal/menus/contexto');
            state.categoriasMenu = Array.isArray(result.categorias_menu) ? result.categorias_menu : [];
            state.tablasCatalogo = result.tablas_catalogo || {};
            state.menus = Array.isArray(result.menus) ? result.menus : [];
            state.programaciones = Array.isArray(result.programaciones) ? result.programaciones : [];
            state.loaded = true;
            ensureFormDefaults();
        } catch (error) {
            notifyError(error.message || 'No se pudo cargar el modulo de menus.');
        } finally {
            state.loading = false;
            renderSaborArtesanalMenus();
        }
    };

    window.ensureSaborArtesanalCategoriasMenuUI = function ensureSaborArtesanalCategoriasMenuUI() {
        const workspace = document.getElementById('saborArtesanalTablaWorkspace');
        if (!workspace) return;
        workspace.innerHTML = `
            <div class="sabor-tabla-shell">
                <div class="sabor-tabla-crumbs">
                    <button type="button" class="btn btn-secondary sabor-tabla-mini-btn" onclick="volverATablasSaborArtesanal()">Volver a Tablas</button>
                    <strong>Categorias de Menu</strong>
                </div>
                <section class="sabor-menus-card" id="saborTablaCategoriasMenuCard"></section>
            </div>
        `;
        ensureFormDefaults();
        renderCategoriasCard('saborTablaCategoriasMenuCard', true);
    };

    function renderStats() {
        const node = document.getElementById('saborMenusStats');
        if (!node) return;
        const categorias = categoriasOrdenadas();
        const menus = menusOrdenados();
        const programaciones = programacionesOrdenadas();
        const bloques = menus.reduce((sum, menu) => sum + Number(menu.bloques_count || (menu.bloques || []).length || 0), 0);

        node.innerHTML = `
            <div class="sabor-menus-stats">
                <div class="sabor-menus-stat-card">
                    <strong>${categorias.length}</strong>
                    <span>Categorias</span>
                </div>
                <div class="sabor-menus-stat-card">
                    <strong>${menus.length}</strong>
                    <span>Definiciones guardadas</span>
                </div>
                <div class="sabor-menus-stat-card">
                    <strong>${bloques}</strong>
                    <span>Columnas definidas</span>
                </div>
                <div class="sabor-menus-stat-card">
                    <strong>${programaciones.length}</strong>
                    <span>Asignaciones por dia</span>
                </div>
            </div>
        `;
    }

    function renderCategoriasCard(nodeId = 'saborMenuCategoriasCard', standalone = false) {
        const node = document.getElementById(nodeId);
        if (!node) return;
        const form = state.categoriaForm;
        const categorias = categoriasOrdenadas();

        node.innerHTML = `
            <div class="sabor-menus-card-head">
                <div>
                    <h4>Categorias de menu</h4>
                    <p>${standalone ? 'Define tipos como Desayunos, Almuerzos, Parrillas o las que necesites. Luego se usan al armar menus.' : 'Define tipos como Desayunos, Almuerzos, Parrillas o las que necesites.'}</p>
                </div>
            </div>
            <div class="sabor-menus-inline-form">
                <input type="text" placeholder="Nombre de categoria" value="${saborEscape(form.nombre || '')}" oninput="setSaborMenuCategoriaFormField('nombre', this.value)">
                <input type="text" placeholder="Codigo interno" value="${saborEscape(form.codigo || '')}" oninput="setSaborMenuCategoriaFormField('codigo', this.value)">
                <input type="number" min="0" placeholder="Orden" value="${saborEscape(form.orden || '')}" oninput="setSaborMenuCategoriaFormField('orden', this.value)">
                <label class="sabor-menu-inline-check">
                    <input type="checkbox" ${form.activo !== false ? 'checked' : ''} onchange="setSaborMenuCategoriaFormField('activo', this.checked)">
                    Activa
                </label>
                <textarea rows="2" placeholder="Descripcion" oninput="setSaborMenuCategoriaFormField('descripcion', this.value)">${saborEscape(form.descripcion || '')}</textarea>
                <div class="sabor-menus-actions-row">
                    <button type="button" class="btn btn-secondary sabor-tabla-mini-btn" onclick="resetSaborMenuCategoriaForm()">Limpiar</button>
                    <button type="button" class="btn btn-primary sabor-tabla-mini-btn" onclick="guardarSaborMenuCategoria()">${form.editingId ? 'Guardar cambios' : 'Crear categoria'}</button>
                </div>
            </div>
            <div class="sabor-menus-list-simple">
                ${categorias.length === 0 ? '<div class="placeholder">No hay categorias registradas todavia.</div>' : categorias.map(categoria => `
                    <div class="sabor-menus-list-item">
                        <div>
                            <strong>${saborEscape(categoria.nombre || '')}</strong>
                            <div class="sabor-menus-muted">${saborEscape(categoria.codigo || '')} | ${Number(categoria.menus_count || 0)} menu(s) | ${Number(categoria.programaciones_count || 0)} dia(s)</div>
                            ${categoria.descripcion ? `<div class="sabor-menus-muted">${saborEscape(categoria.descripcion)}</div>` : ''}
                        </div>
                        <div class="sabor-menus-actions-inline">
                            <span class="sabor-tabla-status ${categoria.activo === false ? 'is-inactive' : 'is-active'}">${categoria.activo === false ? 'Inactiva' : 'Activa'}</span>
                            <button type="button" class="btn btn-secondary sabor-tabla-mini-btn" onclick="editarSaborMenuCategoria(${Number(categoria.id)})">Editar</button>
                            <button type="button" class="btn btn-danger sabor-tabla-mini-btn" onclick="eliminarSaborMenuCategoria(${Number(categoria.id)})">Eliminar</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function buildMenuBlockGroups(block) {
        const template = getMenuSectionTemplate(block.codigo) || {
            codigo: block.codigo,
            label: block.label || block.codigo,
            selector_tipo: block.selector_tipo || 'single',
            helper: 'Configura las alternativas de este bloque.',
            categorias: [],
        };
        const availableOptions = optionsForBlock(template);

        if (isPrincipiosBlock(block)) {
            return ['granos', 'verduras'].map(groupCode => ({
                codigo: groupCode,
                label: groupCode === 'granos' ? 'Granos' : 'Verduras',
                options: availableOptions.filter(option => groupKeyForOption(option) === groupCode),
            }));
        }

        if (String(block.codigo || '') === 'complementos') {
            const grouped = new Map();
            availableOptions.forEach(option => {
                const key = option.tabla_categoria || 'complementos';
                if (!grouped.has(key)) {
                    grouped.set(key, {
                        codigo: key,
                        label: getCategoriaTablaLabel(key),
                        options: [],
                    });
                }
                grouped.get(key).options.push(option);
            });
            return [...grouped.values()];
        }

        return [{
            codigo: 'general',
            label: 'Opciones',
            options: availableOptions,
        }];
    }

    function renderSelectedMenuOption(block, option, optionIndex) {
        const title = option.item_nombre || option.principal_nombre || option.label || '';
        const groupLabel = option.grupo_label ? `${option.grupo_label} | ` : '';
        return `
            <div class="sabor-menu-selected-item">
                <div class="sabor-menu-selected-copy">
                    <strong>${saborEscape(title)}</strong>
                    <small>${saborEscape(`${groupLabel}${getCategoriaTablaLabel(option.tabla_categoria) || option.tabla_categoria}`)}</small>
                </div>
                <button type="button" class="btn btn-danger sabor-tabla-mini-btn" onclick="quitarSaborMenuOpcionDeBloque('${saborEscape(block.codigo)}', ${optionIndex})">Quitar</button>
            </div>
        `;
    }

    function renderProteinRow(option, optionIndex) {
        const proteinParents = getProteinParentItems();
        const selectedParentId = String(option.parent_item_id || option.tabla_item_id || '');
        const presentationOptions = getProteinPresentationOptions(selectedParentId);
        const hasChildren = presentationOptions.some(item => item.isFallback === false);
        const selectedPresentationId = String(option.tabla_item_id || '');
        return `
            <div class="sabor-menu-selected-item is-protein-row">
                <div class="sabor-menu-selected-copy">
                    <strong>Proteina ${optionIndex + 1}</strong>
                    <div class="sabor-menu-selected-protein-grid">
                        <label>
                            <span>Proteina</span>
                            <select onchange="setSaborMenuProteinParent(${optionIndex}, this.value)">
                                <option value="">Selecciona una proteina</option>
                                ${proteinParents.map(parent => `
                                    <option value="${Number(parent.id)}" ${String(parent.id) === selectedParentId ? 'selected' : ''}>
                                        ${saborEscape(parent.nombre || '')}
                                    </option>
                                `).join('')}
                            </select>
                        </label>
                        <label>
                            <span>Presentacion</span>
                            <select onchange="setSaborMenuProteinPresentation(${optionIndex}, this.value)" ${selectedParentId ? '' : 'disabled'}>
                                <option value="">${selectedParentId ? (hasChildren ? 'Selecciona una presentacion' : 'Sin presentaciones') : 'Primero elige la proteina'}</option>
                                ${presentationOptions.map(item => `
                                    <option value="${Number(item.id)}" ${String(item.id) === selectedPresentationId ? 'selected' : ''}>
                                        ${saborEscape(item.label || item.nombre || '')}
                                    </option>
                                `).join('')}
                            </select>
                        </label>
                        <label>
                            <span>Acompanamiento</span>
                            <input
                                type="text"
                                placeholder="Opcional"
                                value="${saborEscape(option.acompanamiento || '')}"
                                onchange="setSaborMenuBlockOptionField('proteinas', ${optionIndex}, 'acompanamiento', this.value)"
                            >
                        </label>
                    </div>
                </div>
                <button type="button" class="btn btn-danger sabor-tabla-mini-btn" onclick="quitarSaborMenuOpcionDeBloque('proteinas', ${optionIndex})">Quitar</button>
            </div>
        `;
    }

    function renderProteinasBlock(block, template) {
        const proteinParents = getProteinParentItems();
        return `
            <section class="sabor-menu-definition-column">
                <div class="sabor-menu-definition-head">
                    <h5>${saborEscape(block.label || template.label)}</h5>
                    <p>${saborEscape(template.helper || '')}</p>
                    <span class="sabor-menu-component-pill">Selecciona una alternativa en ventas.</span>
                    <span class="sabor-menu-component-pill">Define de 1 a 4 alternativas.</span>
                </div>
                <div class="sabor-menu-definition-selected">
                    <div class="sabor-menu-definition-selected-title">Proteinas definidas</div>
                    ${proteinParents.length === 0 ? '<div class="sabor-tabla-helper-tip">No hay proteinas cargadas en Tablas.</div>' : ''}
                    ${(block.opciones || []).length === 0
                        ? '<div class="placeholder">Agrega una proteina y luego elige su presentacion.</div>'
                        : (block.opciones || []).map((option, optionIndex) => renderProteinRow(option, optionIndex)).join('')}
                    ${proteinParents.length > 0 ? `
                        <button
                            type="button"
                            class="btn btn-secondary sabor-tabla-mini-btn"
                            onclick="agregarSaborMenuProteina()"
                            ${(block.opciones || []).length >= 4 ? 'disabled' : ''}
                        >
                            ${(block.opciones || []).length >= 4 ? 'Maximo 4 proteinas' : 'Agregar proteina'}
                        </button>
                    ` : ''}
                </div>
            </section>
        `;
    }

    function renderMenuBlock(block) {
        const template = getMenuSectionTemplate(block.codigo) || {
            codigo: block.codigo,
            label: block.label || block.codigo,
            selector_tipo: block.selector_tipo || 'single',
            helper: 'Configura las alternativas de este bloque.',
            categorias: [],
        };
        if (isProteinasBlock(block)) {
            return renderProteinasBlock(block, template);
        }
        const groups = buildMenuBlockGroups(block);
        const selectedKeys = new Set((block.opciones || []).map(option => `${option.tabla_categoria}:${option.tabla_item_id}`));
        const selectorType = normalizeBlockSelectorType(block, block.selector_tipo, block.opciones || []);
        const selectionCopy = selectorType === 'multi'
            ? (isEnsaladasBlock(block) ? 'Puedes marcar varias ensaladas.' : 'Puedes marcar varios complementos.')
            : (selectorType === 'grouped_single'
                ? 'Debes dejar una opcion por grupo.'
                : 'Selecciona una sola alternativa.');

        return `
            <section class="sabor-menu-definition-column">
                <div class="sabor-menu-definition-head">
                    <h5>${saborEscape(block.label || template.label)}</h5>
                    <p>${saborEscape(template.helper || '')}</p>
                    <span class="sabor-menu-component-pill">${saborEscape(selectionCopy)}</span>
                </div>
                <div class="sabor-menu-definition-groups">
                    ${groups.map(group => `
                        <div class="sabor-menu-definition-group">
                            <div class="sabor-menu-definition-group-title">${saborEscape(group.label)}</div>
                            <div class="sabor-menu-definition-options">
                                ${group.options.length === 0 ? '<div class="sabor-tabla-helper-tip">No hay ayudas cargadas en Tablas.</div>' : group.options.map(option => {
                                    const optionKey = `${option.tabla_categoria}:${option.id}`;
                                    const isSelected = selectedKeys.has(optionKey);
                                    const groupCode = groupKeyForOption(option);
                                    const replaceLabel = selectorType === 'grouped_single'
                                        && (block.opciones || []).some(item => groupKeyForOption(item) === groupCode && `${item.tabla_categoria}:${item.tabla_item_id}` !== optionKey)
                                        ? 'Cambiar'
                                        : 'Agregar';
                                    return `
                                        <button
                                            type="button"
                                            class="sabor-menu-definition-option ${isSelected ? 'is-selected' : ''}"
                                            onclick="agregarSaborMenuOpcionABloque('${saborEscape(block.codigo)}', '${saborEscape(option.tabla_categoria)}', ${Number(option.id)})"
                                            ${isSelected ? 'disabled' : ''}
                                        >
                                            <span>
                                                <strong>${saborEscape(option.item_nombre || option.principal_nombre || option.label)}</strong>
                                            </span>
                                            <b>${isSelected ? 'Lista' : replaceLabel}</b>
                                        </button>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="sabor-menu-definition-selected">
                    <div class="sabor-menu-definition-selected-title">Seleccionadas</div>
                    ${(block.opciones || []).length === 0
                        ? '<div class="placeholder">Todavia no has agregado opciones en esta columna.</div>'
                        : (block.opciones || []).map((option, optionIndex) => renderSelectedMenuOption(block, option, optionIndex)).join('')}
                </div>
            </section>
        `;
    }

    function renderMenuBuilderCard() {
        const node = document.getElementById('saborMenuBuilderCard');
        if (!node) return;
        const form = state.menuForm;
        const requierePrecio = categoriaMenuRequierePrecio(form.categoria_id);
        const categoriaCodigo = getCategoriaCodigo(form.categoria_id);
        const layout = currentCategoryLayout(form.categoria_id);
        const visibleBlocks = visibleMenuBlocksForForm();
        ensureMenuFormBlocks();

        node.innerHTML = `
            <div class="sabor-menus-card-head">
                <div>
                    <h4>${form.editingId ? 'Editar definicion del menu' : 'Definir menu del dia'}</h4>
                    <p>La definicion se muestra segun la categoria elegida. Aqui solo ves las ayudas de ${saborEscape(layout.label)}.</p>
                </div>
            </div>
            <div class="sabor-menus-form-grid is-menu-definition">
                <select onchange="setSaborMenuFormField('categoria_id', this.value)">
                    ${buildCategoriaOptions(form.categoria_id, false)}
                </select>
                <input type="number" min="0" step="0.01" placeholder="${requierePrecio ? 'Precio de venta *' : 'Precio de venta'}" value="${saborEscape(form.precio_venta || '')}" oninput="setSaborMenuFormField('precio_venta', this.value)">
                <label class="sabor-menu-inline-check">
                    <input type="checkbox" ${form.activo !== false ? 'checked' : ''} onchange="setSaborMenuFormField('activo', this.checked)">
                    Menu activo
                </label>
            </div>
            <div class="sabor-menu-definition-banner">
                <strong>${saborEscape(getCategoriaMenuById(form.categoria_id)?.nombre || 'Categoria')}</strong>
                <span>${saborEscape(categoriaCodigo === 'almuerzos' ? 'Vista compacta de almuerzo: Sopa del dia, Principio, Proteina, Ensaladas y Complementos.' : 'Solo se muestran los bloques asociados a la categoria seleccionada.')}</span>
            </div>
            <div class="sabor-menus-actions-row">
                <button type="button" class="btn btn-secondary sabor-tabla-mini-btn" onclick="resetSaborMenuForm()">Limpiar</button>
                <button type="button" class="btn btn-primary sabor-tabla-mini-btn" onclick="guardarSaborMenu()">${form.editingId ? 'Guardar cambios' : 'Guardar definicion'}</button>
            </div>
            <div class="sabor-menu-definition-grid">
                ${visibleBlocks.map(block => renderMenuBlock(block)).join('')}
            </div>
        `;
    }

    function renderMenusListadoCard() {
        const node = document.getElementById('saborMenuListadoCard');
        if (!node) return;

        const categoriaFiltro = state.menuFilters.categoria_id;
        const query = String(state.menuFilters.search || '').trim().toLowerCase();
        const menus = menusOrdenados().filter(menu => {
            if (categoriaFiltro !== 'all' && Number(menu.categoria_id) !== Number(categoriaFiltro)) return false;
            if (!query) return true;
            const blockText = (menu.bloques || []).flatMap(block => [
                block.label || '',
                ...(block.opciones || []).map(option => `${option.grupo_label || ''} ${option.item_nombre || ''}`),
            ]).join(' ');
            return `${menuDisplayTitle(menu)} ${menuDisplaySubtitle(menu)} ${menu.descripcion || ''} ${menu.categoria_nombre || ''} ${blockText}`.toLowerCase().includes(query);
        });

        node.innerHTML = `
            <div class="sabor-menus-card-head">
                <div>
                    <h4>Menus guardados</h4>
                    <p>Revisa bloques, alternativas y reutiliza menus para asignarlos por fecha.</p>
                </div>
            </div>
            <div class="sabor-menus-filter-row">
                <select onchange="setFiltroMenusSaborArtesanal('categoria_id', this.value)">
                    <option value="all">Todas las categorias</option>
                    ${buildCategoriaOptions(categoriaFiltro, true)}
                </select>
                <input type="text" placeholder="Buscar menu o alternativa" value="${saborEscape(state.menuFilters.search || '')}" oninput="setFiltroMenusSaborArtesanal('search', this.value)">
            </div>
            <div class="sabor-menus-card-list">
                ${menus.length === 0 ? '<div class="placeholder">No hay menus que coincidan con el filtro actual.</div>' : menus.map(menu => `
                    <article class="sabor-menu-saved-card">
                        <div class="sabor-menu-saved-top">
                            <div>
                                <strong>${saborEscape(menuDisplayTitle(menu))}</strong>
                                <div class="sabor-menus-muted">${menu.precio_venta != null ? saborEscape(typeof formatCurrency === 'function' ? formatCurrency(menu.precio_venta) : String(menu.precio_venta)) + ' | ' : ''}${Number(menu.bloques_count || (menu.bloques || []).length || 0)} columna(s)</div>
                            </div>
                            <span class="sabor-tabla-status ${menu.activo === false ? 'is-inactive' : 'is-active'}">${menu.activo === false ? 'Inactivo' : 'Activo'}</span>
                        </div>
                        <div class="sabor-menus-muted">${saborEscape(menuDisplaySubtitle(menu) || menu.descripcion || 'Definicion lista para programar por fecha.')}</div>
                        <div class="sabor-menu-component-pill-row">
                            ${(menu.bloques || []).map(block => `
                                <span class="sabor-menu-component-pill">${saborEscape(block.label || block.codigo)}: ${(block.opciones || []).length}</span>
                            `).join('')}
                        </div>
                        <div class="sabor-menus-muted">${(menu.programaciones || []).length > 0 ? `Programado: ${(menu.programaciones || []).map(item => item.fecha_servicio).join(', ')}` : 'Aun no tiene dias asignados.'}</div>
                        <div class="sabor-menus-actions-row">
                            <button type="button" class="btn btn-secondary sabor-tabla-mini-btn" onclick="cargarSaborMenuEnFormulario(${Number(menu.id)})">Editar</button>
                            <button type="button" class="btn btn-danger sabor-tabla-mini-btn" onclick="eliminarSaborMenu(${Number(menu.id)})">Eliminar</button>
                        </div>
                    </article>
                `).join('')}
            </div>
        `;
    }

    function renderProgramacionCard() {
        const node = document.getElementById('saborMenuProgramacionCard');
        if (!node) return;
        syncProgramacionMenuSeleccion();
        const form = state.programacionForm;
        const categoriaId = Number(form.categoria_id) || null;
        const menusCategoria = menusOrdenados().filter(menu => Number(menu.categoria_id) === categoriaId && menu.activo !== false);
        const query = String(state.programacionFilters.search || '').trim().toLowerCase();
        const categoriaFiltro = state.programacionFilters.categoria_id;
        const programaciones = programacionesOrdenadas().filter(item => {
            if (categoriaFiltro !== 'all' && Number(item.categoria_id) !== Number(categoriaFiltro)) return false;
            if (!query) return true;
            return `${item.fecha_servicio || ''} ${item.menu_nombre || ''} ${item.categoria_nombre || ''}`.toLowerCase().includes(query);
        });

        node.innerHTML = `
            <div class="sabor-menus-card-head">
                <div>
                    <h4>Asignar menu por dia</h4>
                    <p>La programacion tambien sigue la categoria activa para que no mezcles Almuerzos con otras definiciones.</p>
                </div>
            </div>
            <div class="sabor-menus-form-grid">
                <input type="date" value="${saborEscape(form.fecha_servicio || '')}" onchange="setSaborProgramacionFormField('fecha_servicio', this.value)">
                <select onchange="setSaborProgramacionFormField('categoria_id', this.value)">
                    ${buildCategoriaOptions(form.categoria_id, false)}
                </select>
                <select onchange="setSaborProgramacionFormField('menu_id', this.value)">
                    <option value="">Selecciona un menu...</option>
                    ${menusCategoria.map(menu => `
                        <option value="${Number(menu.id)}" ${Number(menu.id) === Number(form.menu_id) ? 'selected' : ''}>${saborEscape(menuDisplayTitle(menu))}</option>
                    `).join('')}
                </select>
                <textarea rows="2" placeholder="Observaciones del dia" oninput="setSaborProgramacionFormField('observaciones', this.value)">${saborEscape(form.observaciones || '')}</textarea>
            </div>
            <div class="sabor-menus-actions-row">
                <button type="button" class="btn btn-secondary sabor-tabla-mini-btn" onclick="resetSaborProgramacionForm()">Limpiar</button>
                <button type="button" class="btn btn-primary sabor-tabla-mini-btn" onclick="guardarSaborProgramacion()">${form.editingId ? 'Guardar cambios' : 'Asignar dia'}</button>
            </div>
            <div class="sabor-menus-filter-row">
                <select onchange="setFiltroProgramacionSaborArtesanal('categoria_id', this.value)">
                    <option value="all">Todas las categorias</option>
                    ${buildCategoriaOptions(categoriaFiltro, true)}
                </select>
                <input type="text" placeholder="Buscar fecha o menu" value="${saborEscape(state.programacionFilters.search || '')}" oninput="setFiltroProgramacionSaborArtesanal('search', this.value)">
            </div>
            <div class="sabor-menus-card-list">
                ${programaciones.length === 0 ? '<div class="placeholder">Todavia no hay menus asignados por fecha.</div>' : programaciones.map(item => `
                    <article class="sabor-menu-saved-card is-slim">
                        <div class="sabor-menu-saved-top">
                            <div>
                                <strong>${saborEscape(item.fecha_servicio || '')}</strong>
                                <div class="sabor-menus-muted">${saborEscape(item.categoria_nombre || '')} | ${saborEscape(item.menu_nombre || '')}</div>
                            </div>
                            <span class="sabor-tabla-status ${item.menu_activo === false ? 'is-inactive' : 'is-active'}">${item.menu_activo === false ? 'Menu inactivo' : 'Programado'}</span>
                        </div>
                        ${item.observaciones ? `<div class="sabor-menus-muted">${saborEscape(item.observaciones)}</div>` : ''}
                        <div class="sabor-menus-actions-row">
                            <button type="button" class="btn btn-secondary sabor-tabla-mini-btn" onclick="cargarSaborProgramacionEnFormulario(${Number(item.id)})">Editar</button>
                            <button type="button" class="btn btn-danger sabor-tabla-mini-btn" onclick="eliminarSaborProgramacion(${Number(item.id)})">Eliminar</button>
                        </div>
                    </article>
                `).join('')}
            </div>
        `;
    }

    function buildCategoriaOptions(selectedId, includeAll) {
        return categoriasOrdenadas()
            .filter(item => includeAll || item.activo !== false || Number(item.id) === Number(selectedId))
            .map(categoria => `
                <option value="${Number(categoria.id)}" ${Number(categoria.id) === Number(selectedId) ? 'selected' : ''}>${saborEscape(categoria.nombre || '')}</option>
            `).join('');
    }

    function renderSaborArtesanalMenus() {
        if (panelNode() && panelNode().dataset.initializedMenus === 'true') {
            renderStats();
            renderMenuBuilderCard();
            renderMenusListadoCard();
            renderProgramacionCard();
        }
        renderCategoriasCard('saborTablaCategoriasMenuCard', true);
    }

    window.setSaborMenuCategoriaFormField = function setSaborMenuCategoriaFormField(field, value) {
        state.categoriaForm[field] = value;
    };

    window.resetSaborMenuCategoriaForm = function resetSaborMenuCategoriaForm() {
        resetCategoriaForm();
    };

    window.editarSaborMenuCategoria = function editarSaborMenuCategoria(categoriaId) {
        const categoria = getCategoriaMenuById(categoriaId);
        if (!categoria) return;
        state.categoriaForm = {
            editingId: categoria.id,
            nombre: categoria.nombre || '',
            codigo: categoria.codigo || '',
            descripcion: categoria.descripcion || '',
            orden: categoria.orden ?? '',
            activo: categoria.activo !== false,
        };
        renderSaborArtesanalMenus();
    };

    window.guardarSaborMenuCategoria = async function guardarSaborMenuCategoria() {
        const form = state.categoriaForm;
        if (!String(form.nombre || '').trim()) {
            notifyError('Debes escribir el nombre de la categoria.');
            return;
        }

        const payload = {
            nombre: form.nombre,
            codigo: form.codigo,
            descripcion: form.descripcion,
            orden: form.orden || 0,
            activo: form.activo !== false,
        };

        try {
            const url = form.editingId
                ? `/api/sabor-artesanal/menu-categorias/${Number(form.editingId)}`
                : '/api/sabor-artesanal/menu-categorias';
            await saborRequest(url, {
                method: form.editingId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            notifySuccess(form.editingId ? 'Categoria actualizada correctamente.' : 'Categoria creada correctamente.');
            resetCategoriaForm();
            await window.cargarContextoMenusSaborArtesanal(true);
        } catch (error) {
            notifyError(error.message || 'No se pudo guardar la categoria.');
        }
    };

    window.eliminarSaborMenuCategoria = async function eliminarSaborMenuCategoria(categoriaId) {
        const categoria = getCategoriaMenuById(categoriaId);
        if (!categoria) return;
        if (!window.confirm(`Confirma eliminar la categoria "${categoria.nombre}".`)) return;

        try {
            await saborRequest(`/api/sabor-artesanal/menu-categorias/${Number(categoriaId)}`, {
                method: 'DELETE',
            });
            notifySuccess('Categoria eliminada correctamente.');
            if (Number(state.categoriaForm.editingId) === Number(categoriaId)) resetCategoriaForm();
            await window.cargarContextoMenusSaborArtesanal(true);
        } catch (error) {
            notifyError(error.message || 'No se pudo eliminar la categoria.');
        }
    };

    window.setSaborMenuFormField = function setSaborMenuFormField(field, value) {
        state.menuForm[field] = value;
        if (field === 'categoria_id') {
            ensureMenuFormBlocks();
            state.menuFilters.categoria_id = String(value || 'all');
            state.programacionFilters.categoria_id = String(value || 'all');
            state.programacionForm.categoria_id = String(value || '');
            syncProgramacionMenuSeleccion();
        }
        renderSaborArtesanalMenus();
    };

    window.agregarSaborMenuProteina = function agregarSaborMenuProteina() {
        const block = getBlockByCode('proteinas');
        if (!block) return;
        if ((block.opciones || []).length >= 4) {
            notifyError('En Proteina solo puedes dejar hasta 4 alternativas.');
            return;
        }
        block.opciones.push({
            tabla_categoria: 'proteinas',
            tabla_item_id: '',
            parent_item_id: '',
            principal_nombre: '',
            item_nombre: '',
            grupo_codigo: '',
            grupo_label: '',
            cantidad: '1',
            unidad: 'porcion',
            presentacion: '',
            acompanamiento: '',
            observaciones: '',
            seleccion_default: (block.opciones || []).length === 0,
            label: '',
        });
        ensureSingleBlockDefault(block);
        renderSaborArtesanalMenus();
    };

    window.setSaborMenuProteinParent = function setSaborMenuProteinParent(optionIndex, parentId) {
        const block = getBlockByCode('proteinas');
        const option = block?.opciones?.[optionIndex];
        const parent = getProteinParentItem(parentId);
        if (!option) return;
        if (!parent) {
            option.parent_item_id = '';
            option.tabla_item_id = '';
            option.principal_nombre = '';
            option.item_nombre = '';
            option.presentacion = '';
            renderSaborArtesanalMenus();
            return;
        }

        option.tabla_categoria = 'proteinas';
        option.parent_item_id = String(parent.id);
        option.principal_nombre = parent.nombre || '';
        option.label = parent.nombre || '';
        option.presentacion = '';
        option.observaciones = option.observaciones || '';

        const presentations = getProteinPresentationOptions(parent.id);
        const defaultPresentation = presentations.find(item => item.isFallback && String(item.label || item.nombre || '').trim().toLowerCase() === 'a la plancha')
            || (presentations.length === 1 && presentations[0].isFallback ? presentations[0] : null);
        if (defaultPresentation) {
            option.tabla_item_id = String(defaultPresentation.id);
            option.item_nombre = defaultPresentation.nombre || parent.nombre || '';
            option.presentacion = defaultPresentation.label || defaultPresentation.nombre || '';
        } else {
            option.tabla_item_id = '';
            option.item_nombre = '';
            option.presentacion = '';
        }
        renderSaborArtesanalMenus();
    };

    window.setSaborMenuProteinPresentation = function setSaborMenuProteinPresentation(optionIndex, itemId) {
        const block = getBlockByCode('proteinas');
        const option = block?.opciones?.[optionIndex];
        const parent = getProteinParentItem(option?.parent_item_id);
        if (!option || !parent) return;
        if (!String(itemId || '').trim()) {
            option.tabla_item_id = '';
            option.item_nombre = '';
            option.presentacion = '';
            renderSaborArtesanalMenus();
            return;
        }
        if ((block.opciones || []).some((item, index) => index !== optionIndex && Number(item.tabla_item_id) === Number(itemId))) {
            notifyError('Esa presentacion ya fue agregada en otra proteina.');
            return;
        }

        const selected = getProteinPresentationOptions(parent.id).find(item => Number(item.id) === Number(itemId));
        if (!selected) return;

        option.tabla_item_id = String(selected.id);
        option.item_nombre = selected.nombre || '';
        option.presentacion = selected.label || selected.nombre || '';
        option.principal_nombre = parent.nombre || option.principal_nombre || '';
        renderSaborArtesanalMenus();
    };

    window.agregarSaborMenuOpcionABloque = function agregarSaborMenuOpcionABloque(blockCode, tablaCategoria, itemId) {
        const block = getBlockByCode(blockCode);
        if (!block) return;
        const helperOption = optionsForBlock(getMenuSectionTemplate(blockCode))
            .find(option => option.tabla_categoria === tablaCategoria && Number(option.id) === Number(itemId));
        if (!helperOption) {
            notifyError('No se encontro la opcion seleccionada en las ayudas.');
            return;
        }
        if ((block.opciones || []).some(option => option.tabla_categoria === tablaCategoria && Number(option.tabla_item_id) === Number(itemId))) {
            return;
        }
        if (isProteinasBlock(block) && (block.opciones || []).length >= 4) {
            notifyError('En Proteina solo puedes dejar hasta 4 alternativas.');
            return;
        }

        const normalizedSelector = normalizeBlockSelectorType(block, block.selector_tipo, block.opciones || []);
        const helperGroupKey = groupKeyForOption(helperOption, `${blockCode}-${itemId}`);
        if (normalizedSelector === 'grouped_single') {
            block.opciones = (block.opciones || []).filter(option => groupKeyForOption(option, `${blockCode}-${option.tabla_item_id}`) !== helperGroupKey);
        }

        block.opciones.push({
            tabla_categoria: tablaCategoria,
            tabla_item_id: String(helperOption.id),
            parent_item_id: '',
            principal_nombre: helperOption.principal_nombre || '',
            item_nombre: helperOption.item_nombre || helperOption.principal_nombre || '',
            grupo_codigo: helperOption.grupo_codigo || '',
            grupo_label: helperOption.grupo_label || '',
            cantidad: '1',
            unidad: 'porcion',
            presentacion: '',
            acompanamiento: '',
            observaciones: '',
            seleccion_default: normalizedSelector !== 'multi',
            label: helperOption.label || helperOption.item_nombre || '',
        });
        block.selector_tipo = normalizedSelector;
        ensureSingleBlockDefault(block);
        renderSaborArtesanalMenus();
    };

    window.quitarSaborMenuOpcionDeBloque = function quitarSaborMenuOpcionDeBloque(blockCode, optionIndex) {
        const block = getBlockByCode(blockCode);
        if (!block) return;
        block.opciones.splice(optionIndex, 1);
        ensureSingleBlockDefault(block);
        renderSaborArtesanalMenus();
    };

    window.setSaborMenuBlockOptionField = function setSaborMenuBlockOptionField(blockCode, optionIndex, field, value) {
        const block = getBlockByCode(blockCode);
        const option = block?.opciones?.[optionIndex];
        if (!option) return;
        option[field] = value;
        const normalizedSelector = normalizeBlockSelectorType(block, block.selector_tipo, block.opciones || []);
        if (field === 'seleccion_default' && value) {
            if (normalizedSelector === 'single') {
                (block.opciones || []).forEach((item, index) => {
                    item.seleccion_default = index === optionIndex;
                });
            } else if (normalizedSelector === 'grouped_single') {
                const groupKey = groupKeyForOption(option, `grupo-${optionIndex + 1}`);
                (block.opciones || []).forEach((item, index) => {
                    if (groupKeyForOption(item, `grupo-${index + 1}`) === groupKey) {
                        item.seleccion_default = index === optionIndex;
                    }
                });
            }
        }
        block.selector_tipo = normalizedSelector;
        ensureSingleBlockDefault(block);
        renderSaborArtesanalMenus();
    };

    window.marcarSaborMenuOpcionPredeterminada = function marcarSaborMenuOpcionPredeterminada(blockCode, optionIndex) {
        const block = getBlockByCode(blockCode);
        if (!block) return;
        const normalizedSelector = normalizeBlockSelectorType(block, block.selector_tipo, block.opciones || []);
        if (normalizedSelector === 'grouped_single') {
            const selectedOption = block.opciones?.[optionIndex];
            const selectedGroupKey = groupKeyForOption(selectedOption, `grupo-${optionIndex + 1}`);
            (block.opciones || []).forEach((option, index) => {
                if (groupKeyForOption(option, `grupo-${index + 1}`) === selectedGroupKey) {
                    option.seleccion_default = index === optionIndex;
                }
            });
        } else {
            (block.opciones || []).forEach((option, index) => {
                option.seleccion_default = index === optionIndex;
            });
        }
        block.selector_tipo = normalizedSelector;
        ensureSingleBlockDefault(block);
        renderSaborArtesanalMenus();
    };

    window.cargarSaborMenuEnFormulario = function cargarSaborMenuEnFormulario(menuId) {
        const menu = getMenuById(menuId);
        if (!menu) return;
        state.menuForm = {
            editingId: menu.id,
            categoria_id: String(menu.categoria_id || ''),
            descripcion: menu.descripcion || '',
            instrucciones: menu.instrucciones || '',
            precio_venta: menu.precio_venta_texto || menu.precio_venta || '',
            activo: menu.activo !== false,
            bloques: Array.isArray(menu.bloques) && menu.bloques.length > 0
                ? menu.bloques.map(block => ({
                    codigo: block.codigo,
                    label: block.label || block.codigo,
                    selector_tipo: normalizeBlockSelectorType(block.codigo, block.selector_tipo || 'single', block.opciones || []),
                    opciones: (block.opciones || []).map(option => normalizeBlockOption(option, block)),
                }))
                : buildLegacyBlocksFromComponents(menu.componentes || []),
        };
        ensureMenuFormBlocks();
        renderSaborArtesanalMenus();
    };

    window.resetSaborMenuForm = function resetSaborMenuForm() {
        resetMenuForm();
    };

    window.guardarSaborMenu = async function guardarSaborMenu() {
        const form = state.menuForm;
        if (!String(form.categoria_id || '').trim()) {
            notifyError('Debes seleccionar la categoria del menu.');
            return;
        }
        if (categoriaMenuRequierePrecio(form.categoria_id) && (String(form.precio_venta || '').trim() === '' || Number(form.precio_venta) < 0)) {
            notifyError('Debes indicar el precio de venta del menu.');
            return;
        }

        ensureMenuFormBlocks();
        const bloquesConOpciones = visibleMenuBlocksForForm().filter(block => Array.isArray(block.opciones) && block.opciones.length > 0);
        if (bloquesConOpciones.length === 0) {
            notifyError('Debes agregar al menos una alternativa en el menu.');
            return;
        }
        const bloquePrincipios = bloquesConOpciones.find(block => isPrincipiosBlock(block));
        if (bloquePrincipios) {
            const selectedGroups = new Set((bloquePrincipios.opciones || []).map(option => groupKeyForOption(option)));
            if (!selectedGroups.has('granos') || !selectedGroups.has('verduras')) {
                notifyError('En Principio debes seleccionar una opcion de Granos y otra de Verduras.');
                return;
            }
        }
        const bloqueProteinas = bloquesConOpciones.find(block => isProteinasBlock(block));
        if (bloqueProteinas) {
            const incompleteProtein = (bloqueProteinas.opciones || []).find(option =>
                !String(option.parent_item_id || '').trim() || !String(option.tabla_item_id || '').trim()
            );
            if (incompleteProtein) {
                notifyError('En Proteina debes elegir la proteina y su presentacion en cada fila.');
                return;
            }
        }

        const payload = {
            categoria_id: form.categoria_id,
            precio_venta: String(form.precio_venta || '').trim() || null,
            activo: form.activo !== false,
            bloques: bloquesConOpciones.map(block => ({
                codigo: block.codigo,
                label: block.label,
                selector_tipo: normalizeBlockSelectorType(block.codigo, block.selector_tipo, block.opciones || []),
                opciones: (block.opciones || []).map(option => ({
                    tabla_categoria: option.tabla_categoria,
                    tabla_item_id: option.tabla_item_id,
                    grupo_codigo: option.grupo_codigo,
                    grupo_label: option.grupo_label,
                    cantidad: option.cantidad,
                    unidad: option.unidad,
                    presentacion: option.presentacion,
                    acompanamiento: option.acompanamiento,
                    observaciones: option.observaciones,
                    seleccion_default: option.seleccion_default === true,
                })),
            })),
        };

        try {
            const url = form.editingId
                ? `/api/sabor-artesanal/menus/${Number(form.editingId)}`
                : '/api/sabor-artesanal/menus';
            await saborRequest(url, {
                method: form.editingId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            notifySuccess(form.editingId ? 'Menu actualizado correctamente.' : 'Menu guardado correctamente.');
            resetMenuForm();
            await window.cargarContextoMenusSaborArtesanal(true);
        } catch (error) {
            notifyError(error.message || 'No se pudo guardar el menu.');
        }
    };

    window.eliminarSaborMenu = async function eliminarSaborMenu(menuId) {
        const menu = getMenuById(menuId);
        if (!menu) return;
        if (!window.confirm(`Confirma eliminar la definicion "${menuDisplayTitle(menu)}".`)) return;

        try {
            await saborRequest(`/api/sabor-artesanal/menus/${Number(menuId)}`, {
                method: 'DELETE',
            });
            notifySuccess('Menu eliminado correctamente.');
            if (Number(state.menuForm.editingId) === Number(menuId)) resetMenuForm();
            await window.cargarContextoMenusSaborArtesanal(true);
        } catch (error) {
            notifyError(error.message || 'No se pudo eliminar el menu.');
        }
    };

    window.setFiltroMenusSaborArtesanal = function setFiltroMenusSaborArtesanal(field, value) {
        state.menuFilters[field] = value;
        renderSaborArtesanalMenus();
    };

    window.setSaborProgramacionFormField = function setSaborProgramacionFormField(field, value) {
        state.programacionForm[field] = value;
        if (field === 'categoria_id') {
            syncProgramacionMenuSeleccion();
        }
        renderSaborArtesanalMenus();
    };

    window.cargarSaborProgramacionEnFormulario = function cargarSaborProgramacionEnFormulario(programacionId) {
        const programacion = getProgramacionById(programacionId);
        if (!programacion) return;
        state.programacionForm = {
            editingId: programacion.id,
            fecha_servicio: programacion.fecha_servicio || '',
            categoria_id: String(programacion.categoria_id || ''),
            menu_id: String(programacion.menu_id || ''),
            observaciones: programacion.observaciones || '',
        };
        renderSaborArtesanalMenus();
    };

    window.resetSaborProgramacionForm = function resetSaborProgramacionForm() {
        resetProgramacionForm();
    };

    window.guardarSaborProgramacion = async function guardarSaborProgramacion() {
        const form = state.programacionForm;
        if (!String(form.fecha_servicio || '').trim()) {
            notifyError('Debes seleccionar la fecha del dia.');
            return;
        }
        if (!String(form.menu_id || '').trim()) {
            notifyError('Debes seleccionar el menu a programar.');
            return;
        }

        const payload = {
            fecha_servicio: form.fecha_servicio,
            menu_id: form.menu_id,
            observaciones: form.observaciones,
        };

        try {
            const url = form.editingId
                ? `/api/sabor-artesanal/menus/programacion/${Number(form.editingId)}`
                : '/api/sabor-artesanal/menus/programacion';
            await saborRequest(url, {
                method: form.editingId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            notifySuccess(form.editingId ? 'Asignacion actualizada correctamente.' : 'Menu asignado correctamente.');
            resetProgramacionForm();
            await window.cargarContextoMenusSaborArtesanal(true);
        } catch (error) {
            notifyError(error.message || 'No se pudo guardar la asignacion.');
        }
    };

    window.eliminarSaborProgramacion = async function eliminarSaborProgramacion(programacionId) {
        const programacion = getProgramacionById(programacionId);
        if (!programacion) return;
        if (!window.confirm(`Confirma eliminar la asignacion del ${programacion.fecha_servicio}.`)) return;

        try {
            await saborRequest(`/api/sabor-artesanal/menus/programacion/${Number(programacionId)}`, {
                method: 'DELETE',
            });
            notifySuccess('Asignacion eliminada correctamente.');
            if (Number(state.programacionForm.editingId) === Number(programacionId)) resetProgramacionForm();
            await window.cargarContextoMenusSaborArtesanal(true);
        } catch (error) {
            notifyError(error.message || 'No se pudo eliminar la asignacion.');
        }
    };

    window.setFiltroProgramacionSaborArtesanal = function setFiltroProgramacionSaborArtesanal(field, value) {
        state.programacionFilters[field] = value;
        renderSaborArtesanalMenus();
    };
})();
