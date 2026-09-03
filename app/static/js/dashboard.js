// Dashboard functionality

let currentUser = null;
let empleadosList = [];
let tiposNovedadList = [];
let rolesData = [];
let menuOptionsData = [];

function loadEmbeddedRoleMenuOptions() {
    const source = document.getElementById('rolePermissionOptions');
    if (!source) return [];

    try {
        const options = JSON.parse(source.textContent || '[]');
        return Array.isArray(options) ? options : [];
    } catch (error) {
        console.error('Error leyendo permisos incorporados para roles:', error);
        return [];
    }
}
// Contexto de período actual por módulo (Mes/Año)
window._comercialPeriodoActual = window._comercialPeriodoActual || null;
window._comisionesPeriodoActual = window._comisionesPeriodoActual || null;
window._comercialSeccionActual = window._comercialSeccionActual || 'inicio';
window._comprasPeriodoActual = window._comprasPeriodoActual || null;
window._ventasPeriodoActual = window._ventasPeriodoActual || null;

function updateCurrentUserDisplay() {
    if (!currentUser) {
        return;
    }

    const userName = document.getElementById('userName');
    const userInfo = document.getElementById('userInfo');
    if (userName) {
        userName.textContent = currentUser.usuario || currentUser.nombre || 'Usuario';
    }
    if (userInfo) {
        userInfo.textContent = `${currentUser.usuario || currentUser.nombre || 'Usuario'} (${currentUser.role || 'Sin rol'})`;
    }
}

function applySidebarAccess() {
    const menuItems = document.querySelectorAll('.menu-item, .menu-subitem');
    const allowedModules = Array.isArray(currentUser?.menu_modules) ? currentUser.menu_modules : [];
    const isAdminUser = currentUser?.role === 'Administrador';

    menuItems.forEach(item => {
        const moduleName = item.dataset.module;
        const visible = !moduleName || isAdminUser || allowedModules.includes(moduleName);
        const container = item.closest('li') || item;
        container.style.display = visible ? '' : 'none';
    });
}

function markSidebarModuleActive(moduleName, section = '') {
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.menu-subitem').forEach(item => item.classList.remove('active'));

    const item = document.querySelector(`.menu-item[data-module="${moduleName}"]`);
    if (item) item.classList.add('active');
}

function getCurrentPermissionNames() {
    if (currentUser?.is_superuser || currentUser?.is_easy) {
        return new Set(['*']);
    }
    if (currentUser?.role === 'Administrador') {
        return new Set(['*']);
    }
    return new Set(Array.isArray(currentUser?.permission_names) ? currentUser.permission_names : []);
}

function hasRolePermission(permissionName) {
    const permissions = getCurrentPermissionNames();
    return permissions.has('*') || permissions.has(permissionName);
}

function getComercialPermissionName(entity, action) {
    return `comercial_${entity}_${action}`;
}

function canManageComercial(entity, action) {
    return hasRolePermission(getComercialPermissionName(entity, action));
}

function getCatalogEntityFromTipoItem(tipoItem) {
    return String(tipoItem || '').toUpperCase() === 'EXAMEN' ? 'examenes' : 'paquetes';
}

async function refreshCurrentUserContext() {
    try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (!response.ok) {
            return;
        }

        const data = await response.json();
        currentUser = data;
        localStorage.setItem('user', JSON.stringify(data));
        updateCurrentUserDisplay();
        applySidebarAccess();
    } catch (error) {
        console.error('Error actualizando contexto del usuario actual:', error);
    }
}

(function initComercialPeriodoFromStorage() {
    try {
        if (!window._comercialPeriodoActual && window.localStorage) {
            const raw = localStorage.getItem('comercialPeriodoActual') || localStorage.getItem('comisionesPeriodoActual');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.mes === 'number' && typeof parsed.anio === 'number') {
                    window._comercialPeriodoActual = parsed;
                    window._comisionesPeriodoActual = parsed;
                }
            }
        }
    } catch (e) {
        console.warn('No se pudo recuperar periodo comercial desde localStorage', e);
    }
    window._comercialPeriodoActual = window._comercialPeriodoActual || null;
    window._comisionesPeriodoActual = window._comercialPeriodoActual;
})();

document.addEventListener('DOMContentLoaded', () => {
    currentUser = checkAuth();
    updateCurrentUserDisplay();
    applySidebarAccess();

    setupMenuNavigation();
    setupLogout();
    setupUsuariosModule();
    setupEstructuraLaboralForms();
    setupModulosPeriodoActual();
    refreshCurrentUserContext();
});

// ==================== TOGGLE PANELES DE PERÍODO POR MÓDULO ====================

// Flujo de quincena para Nómina: al hacer clic en "Quincena" salimos del dashboard
// y entramos a una vista de trabajo por período. Si no hay información previa,
// se solicita Año-Mes-Quincena.

// Configuración y manejo del modal de selección de período de nómina
function toggleComercialMesPanel() {
    if (window._comercialSeccionActual === 'mes') {
        switchComercialSection('inicio', { reload: false, focus: false });
        return;
    }

    switchComercialSection('mes');
}

function scrollToModuleSection(elementId) {
    const target = document.getElementById(elementId);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function focusModuleSection(elementId) {
    const target = document.getElementById(elementId);
    if (!target) return;

    const scrollTarget = target.closest('.table-container, .content-area, .recent-section, .module-header') || target;
    scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (typeof scrollTarget.classList !== 'undefined') {
        scrollTarget.classList.add('section-highlight');
        window.setTimeout(() => scrollTarget.classList.remove('section-highlight'), 1400);
    }
}

function toggleComprasMesPanel() {
    const panel = document.getElementById('comprasMesPanel');
    if (!panel) return;

    const homeHeader = document.getElementById('comprasHomeHeader');
    const isVisible = panel.style.display === 'block';
    if (!isVisible && !window._comprasPeriodoActual) {
        if (typeof openComprasPeriodoSeleccion === 'function') {
            openComprasPeriodoSeleccion();
            return;
        }
    }

    panel.style.display = isVisible ? 'none' : 'block';
    if (homeHeader) {
        homeHeader.style.display = isVisible ? '' : 'none';
    }
}

function toggleVentasMesPanel() {
    const panel = document.getElementById('ventasMesPanel');
    if (!panel) return;

    const homeHeader = document.getElementById('ventasHomeHeader');
    const isVisible = panel.style.display === 'block';
    if (!isVisible && !window._ventasPeriodoActual) {
        if (typeof openVentasPeriodoSeleccion === 'function') {
            openVentasPeriodoSeleccion();
            return;
        }
    }

    panel.style.display = isVisible ? 'none' : 'block';
    if (homeHeader) {
        homeHeader.style.display = isVisible ? '' : 'none';
    }
}

// ==================== PERÍODO ACTUAL POR MÓDULO (Mes/Año) ====================

function setupModulosPeriodoActual() {
    const now = new Date();

    // Comercial
    const formComercial = document.getElementById('comercialPeriodoSeleccionForm');
    if (formComercial && !formComercial.dataset.bound) {
        const yearInput = document.getElementById('comercial_periodo_anio');
        if (yearInput && !yearInput.value) yearInput.value = now.getFullYear();

        formComercial.addEventListener('submit', (e) => {
            e.preventDefault();
            const anio = parseInt(document.getElementById('comercial_periodo_anio').value, 10);
            const mes = parseInt(document.getElementById('comercial_periodo_mes').value, 10);
            if (!anio || !mes) {
                showError('Debe seleccionar mes y año para Comisiones.');
                return;
            }
            window._comercialPeriodoActual = { mes, anio };
            window._comisionesPeriodoActual = window._comercialPeriodoActual;
            try {
                if (window.localStorage) {
                    localStorage.setItem('comercialPeriodoActual', JSON.stringify(window._comercialPeriodoActual));
                }
            } catch (storageError) {
                console.warn('No se pudo guardar periodo de comisiones', storageError);
            }
            actualizarEtiquetaComercialPeriodo();
            closeComercialPeriodoSeleccion();
            loadComercialDashboard();

            const panel = document.getElementById('comercialMesPanel');
            const mesActualPanel = document.getElementById('comercialMesActualPanel');
            window._comercialSeccionActual = 'mes';
            actualizarNavegacionComercial('mes');
            if (panel) panel.style.display = 'block';
            if (mesActualPanel) mesActualPanel.style.display = '';
        });
        formComercial.dataset.bound = 'true';
        actualizarEtiquetaComercialPeriodo();
    }

    // Compras
    const formCompras = document.getElementById('comprasPeriodoSeleccionForm');
    if (formCompras && !formCompras.dataset.bound) {
        const yearInput = document.getElementById('compras_periodo_anio');
        if (yearInput && !yearInput.value) yearInput.value = now.getFullYear();

        formCompras.addEventListener('submit', (e) => {
            e.preventDefault();
            const anio = parseInt(document.getElementById('compras_periodo_anio').value, 10);
            const mes = parseInt(document.getElementById('compras_periodo_mes').value, 10);
            if (!anio || !mes) {
                showError('Debe seleccionar mes y año para Compras.');
                return;
            }
            window._comprasPeriodoActual = { mes, anio };
            actualizarEtiquetaComprasPeriodo();
            closeComprasPeriodoSeleccion();

            const panel = document.getElementById('comprasMesPanel');
            const homeHeader = document.getElementById('comprasHomeHeader');
            if (panel) panel.style.display = 'block';
            if (homeHeader) homeHeader.style.display = 'none';
        });
        formCompras.dataset.bound = 'true';
        actualizarEtiquetaComprasPeriodo();
    }

    // Ventas
    const formVentas = document.getElementById('ventasPeriodoSeleccionForm');
    if (formVentas && !formVentas.dataset.bound) {
        const yearInput = document.getElementById('ventas_periodo_anio');
        if (yearInput && !yearInput.value) yearInput.value = now.getFullYear();

        formVentas.addEventListener('submit', (e) => {
            e.preventDefault();
            const anio = parseInt(document.getElementById('ventas_periodo_anio').value, 10);
            const mes = parseInt(document.getElementById('ventas_periodo_mes').value, 10);
            if (!anio || !mes) {
                showError('Debe seleccionar mes y año para Ventas.');
                return;
            }
            window._ventasPeriodoActual = { mes, anio };
            actualizarEtiquetaVentasPeriodo();
            closeVentasPeriodoSeleccion();

            const panel = document.getElementById('ventasMesPanel');
            const homeHeader = document.getElementById('ventasHomeHeader');
            if (panel) panel.style.display = 'block';
            if (homeHeader) homeHeader.style.display = 'none';
        });
        formVentas.dataset.bound = 'true';
        actualizarEtiquetaVentasPeriodo();
    }
}

function actualizarEtiquetaComercialPeriodo() {
    const label = document.getElementById('comercialMesSeleccionadoLabel');
    const resumen = document.getElementById('comercialMesActual');

    if (!window._comercialPeriodoActual) {
        if (label) label.textContent = 'Período Comisiones (Mes/Año) · selección pendiente';
        if (resumen) resumen.textContent = 'No hay mes en proceso registrado.';
        return;
    }

    const { mes, anio } = window._comercialPeriodoActual;
    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mesNombre = meses[mes] || mes;

    if (label) label.textContent = `Período seleccionado: ${mesNombre} ${anio}`;
    if (resumen) resumen.textContent = `Mes en proceso: ${mesNombre} ${anio}`;
}

function openComercialPeriodoSeleccion() {
    const modal = document.getElementById('comercialPeriodoSeleccionModal');
    if (!modal) return;

    const now = new Date();
    const base = window._comercialPeriodoActual || { mes: now.getMonth() + 1, anio: now.getFullYear() };

    const anioInput = document.getElementById('comercial_periodo_anio');
    const mesSelect = document.getElementById('comercial_periodo_mes');
    if (anioInput) anioInput.value = base.anio;
    if (mesSelect) mesSelect.value = String(base.mes);

    modal.classList.add('active');
}

function closeComercialPeriodoSeleccion() {
    const modal = document.getElementById('comercialPeriodoSeleccionModal');
    if (modal) modal.classList.remove('active');
}

function actualizarEtiquetaComprasPeriodo() {
    const label = document.getElementById('comprasMesSeleccionadoLabel');
    const resumen = document.getElementById('comprasMesActual');

    if (!window._comprasPeriodoActual) {
        if (label) label.textContent = 'Período Compras (Mes/Año) · selección pendiente';
        if (resumen) resumen.textContent = 'No hay mes en proceso registrado.';
        return;
    }

    const { mes, anio } = window._comprasPeriodoActual;
    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mesNombre = meses[mes] || mes;

    if (label) label.textContent = `Período seleccionado: ${mesNombre} ${anio}`;
    if (resumen) resumen.textContent = `Mes en proceso: ${mesNombre} ${anio}`;
}

function openComprasPeriodoSeleccion() {
    const modal = document.getElementById('comprasPeriodoSeleccionModal');
    if (!modal) return;

    const now = new Date();
    const base = window._comprasPeriodoActual || { mes: now.getMonth() + 1, anio: now.getFullYear() };

    const anioInput = document.getElementById('compras_periodo_anio');
    const mesSelect = document.getElementById('compras_periodo_mes');
    if (anioInput) anioInput.value = base.anio;
    if (mesSelect) mesSelect.value = String(base.mes);

    modal.classList.add('active');
}

function closeComprasPeriodoSeleccion() {
    const modal = document.getElementById('comprasPeriodoSeleccionModal');
    if (modal) modal.classList.remove('active');
}

function actualizarEtiquetaVentasPeriodo() {
    const label = document.getElementById('ventasMesSeleccionadoLabel');
    const resumen = document.getElementById('ventasMesActual');

    if (!window._ventasPeriodoActual) {
        if (label) label.textContent = 'Período Ventas (Mes/Año) · selección pendiente';
        if (resumen) resumen.textContent = 'No hay mes en proceso registrado.';
        return;
    }

    const { mes, anio } = window._ventasPeriodoActual;
    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mesNombre = meses[mes] || mes;

    if (label) label.textContent = `Período seleccionado: ${mesNombre} ${anio}`;
    if (resumen) resumen.textContent = `Mes en proceso: ${mesNombre} ${anio}`;
}

function openVentasPeriodoSeleccion() {
    const modal = document.getElementById('ventasPeriodoSeleccionModal');
    if (!modal) return;

    const now = new Date();
    const base = window._ventasPeriodoActual || { mes: now.getMonth() + 1, anio: now.getFullYear() };

    const anioInput = document.getElementById('ventas_periodo_anio');
    const mesSelect = document.getElementById('ventas_periodo_mes');
    if (anioInput) anioInput.value = base.anio;
    if (mesSelect) mesSelect.value = String(base.mes);

    modal.classList.add('active');
}

function closeVentasPeriodoSeleccion() {
    const modal = document.getElementById('ventasPeriodoSeleccionModal');
    if (modal) modal.classList.remove('active');
}

// ==================== FLUJO VISUAL POR PERÍODO (PRE-LIQ / NOVEDADES / PAGOS) ====================

// Pre-liquidación directa de la quincena actualmente seleccionada en la vista de Nómina
function setGenericWorkflowStep(moduleKey, step) {
    const panel = document.getElementById(`${moduleKey}MesPanel`);
    if (!panel) return;

    // Mostrar/ocultar botones de Finalizar según el paso para módulos genéricos
    const prefix = moduleKey.charAt(0).toUpperCase() + moduleKey.slice(1);
    const btnFinalizarNovedades = document.getElementById(`btn${prefix}FinalizarNovedadesPanel`);
    const btnFinalizarPago = document.getElementById(`btn${prefix}FinalizarPagoPanel`);
    if (btnFinalizarNovedades) btnFinalizarNovedades.style.display = (step === 'novedades') ? 'inline-block' : 'none';
    if (btnFinalizarPago) btnFinalizarPago.style.display = (step === 'pagos') ? 'inline-block' : 'none';

    const buttons = panel.querySelectorAll('.period-workflow-steps .btn-step');
    buttons.forEach(btn => btn.classList.remove('active'));
    const target = Array.from(buttons).find(btn => btn.dataset.step === step);
    if (target) target.classList.add('active');

    // Por ahora, solo resaltamos el paso seleccionado y dejamos un mensaje
    const moduloNombre = moduleKey.charAt(0).toUpperCase() + moduleKey.slice(1);
    let etapa = 'Resumen';
    if (step === 'novedades') etapa = 'Novedades';
    else if (step === 'pagos') etapa = 'Pagos';

    if (typeof console !== 'undefined') {
        console.info(`Flujo visual ${moduloNombre}: paso activo -> ${etapa}`);
    }
}

// Helper genérico para botones de módulos aún en desarrollo
function notImplemented(actionLabel) {
    const msgBase = 'Esta funcionalidad aún está en desarrollo.';
    if (actionLabel) {
        alert(`${msgBase}\n\nAcción: ${actionLabel}`);
    } else {
        alert(msgBase);
    }
}

// ==================== HISTORIAL DE NÓMINA ====================
function canReadCatalogoComercial() {
    return canManageComercial('examenes', 'read') || canManageComercial('paquetes', 'read');
}

function canCreateCatalogoComercial() {
    return canManageComercial('examenes', 'create') || canManageComercial('paquetes', 'create');
}

function hasAnyComercialPermission(entity) {
    return ['read', 'create', 'update', 'delete'].some(action => canManageComercial(entity, action));
}

function hasAnyCatalogoPermission() {
    return ['read', 'create', 'update', 'delete'].some(action => (
        canManageComercial('examenes', action) || canManageComercial('paquetes', action)
    ));
}

function hasComercialSectionPermission(section) {
    if (hasRolePermission(`comercial_section_${section}`)) return true;

    // Compatibilidad con los roles creados antes de los permisos por pestana.
    const legacyAccess = {
        vendedores: () => hasAnyComercialPermission('vendedores'),
        examenes: () => hasAnyCatalogoPermission(),
        clientes: () => hasAnyComercialPermission('clientes'),
        gestion_informacion: () => canManageComercial('atenciones', 'read') || canManageComercial('atenciones', 'create'),
        caja: () => canManageComercial('atenciones', 'read') || canManageComercial('atenciones', 'create'),
        registro_atenciones: () => canManageComercial('atenciones', 'read') || canManageComercial('atenciones', 'create'),
        mes: () => hasRolePermission('menu_comercial'),
        comisiones: () => hasAnyComercialPermission('comisiones'),
        inicio: () => hasRolePermission('menu_comercial'),
    };
    return legacyAccess[section] ? legacyAccess[section]() : false;
}

function setComercialElementsVisibility(selector, visible) {
    document.querySelectorAll(selector).forEach(element => {
        element.style.display = visible ? '' : 'none';
    });
}

function syncComercialPermissionUI() {
    setComercialElementsVisibility('#comercialNavVendedores', hasComercialSectionPermission('vendedores'));
    setComercialElementsVisibility('#comercialNavExamenes', hasComercialSectionPermission('examenes'));
    setComercialElementsVisibility('#comercialNavClientes', hasComercialSectionPermission('clientes'));
    setComercialElementsVisibility('#comercialNavCargue', hasComercialSectionPermission('gestion_informacion'));
    setComercialElementsVisibility('#comercialNavCaja', hasComercialSectionPermission('caja'));
    setComercialElementsVisibility('#comercialNavMes', hasComercialSectionPermission('mes'));
    setComercialElementsVisibility('#comercialNavComisiones', hasComercialSectionPermission('comisiones'));
    setComercialElementsVisibility('#comercialNavInicio', hasComercialSectionPermission('inicio'));
    setComercialElementsVisibility('button[onclick="mostrarAgregarVendedor()"]', canManageComercial('vendedores', 'create'));
    setComercialElementsVisibility('button[onclick="consultarComercial(\'vendedores\')"]', canManageComercial('vendedores', 'read'));
    setComercialElementsVisibility('button[onclick="mostrarAgregarItemCatalogoComercial()"]', canCreateCatalogoComercial());
    setComercialElementsVisibility('button[onclick="consultarComercial(\'examenes\')"]', canReadCatalogoComercial());
    setComercialElementsVisibility('button[onclick="mostrarAgregarClienteComercial()"]', canManageComercial('clientes', 'create'));
    setComercialElementsVisibility('button[onclick="consultarComercial(\'clientes\')"]', canManageComercial('clientes', 'read'));
    setComercialElementsVisibility('#clienteSeguimientoMenuAtenciones', canManageComercial('atenciones', 'create'));
    setComercialElementsVisibility('#clienteSeguimientoMenuDocumentos', canManageComercial('documentos', 'create'));
    setComercialElementsVisibility('#clienteSeguimientoMenuPagos', canManageComercial('pagos', 'create'));
    setComercialElementsVisibility('button[onclick="mostrarAgregarAtencionCliente()"]', canManageComercial('atenciones', 'create'));
    setComercialElementsVisibility('button[onclick="abrirNuevaAtencionGestionInformacion()"]', canManageComercial('atenciones', 'create'));
    setComercialElementsVisibility('button[onclick="mostrarAgregarSeguimientoDocumento()"]', canManageComercial('documentos', 'create'));
    setComercialElementsVisibility('button[onclick="mostrarAgregarSeguimientoPago()"]', canManageComercial('pagos', 'create'));

    if (window._comercialSeccionActual === 'vendedores' && !canManageComercial('vendedores', 'read')) {
        switchComercialSection('inicio');
    }
    if (window._comercialSeccionActual === 'examenes' && !canReadCatalogoComercial()) {
        switchComercialSection('inicio');
    }
    if (window._comercialSeccionActual === 'clientes' && !canManageComercial('clientes', 'read')) {
        switchComercialSection('inicio');
    }
}

const _originalRefreshCurrentUserContext = refreshCurrentUserContext;
refreshCurrentUserContext = async function () {
    await _originalRefreshCurrentUserContext();
    syncComercialPermissionUI();
};

const _originalMostrarAgregarVendedor = typeof mostrarAgregarVendedor === 'function' ? mostrarAgregarVendedor : null;
if (_originalMostrarAgregarVendedor) {
    mostrarAgregarVendedor = function (...args) {
        if (!canManageComercial('vendedores', 'create')) {
            showError('No tienes permiso para crear vendedores.');
            return;
        }
        return _originalMostrarAgregarVendedor.apply(this, args);
    };
}

const _originalEditarVendedorConfig = typeof editarVendedorConfig === 'function' ? editarVendedorConfig : null;
if (_originalEditarVendedorConfig) {
    editarVendedorConfig = function (...args) {
        if (!canManageComercial('vendedores', 'update')) {
            showError('Solo el administrador puede modificar vendedores.');
            return;
        }
        return _originalEditarVendedorConfig.apply(this, args);
    };
}

const _originalMostrarAgregarClienteComercial = typeof mostrarAgregarClienteComercial === 'function' ? mostrarAgregarClienteComercial : null;
if (_originalMostrarAgregarClienteComercial) {
    mostrarAgregarClienteComercial = async function (...args) {
        if (!canManageComercial('clientes', 'create')) {
            showError('No tienes permiso para crear clientes comerciales.');
            return;
        }
        return _originalMostrarAgregarClienteComercial.apply(this, args);
    };
}

const _originalEditarClienteComercial = typeof editarClienteComercial === 'function' ? editarClienteComercial : null;
if (_originalEditarClienteComercial) {
    editarClienteComercial = async function (...args) {
        if (!canManageComercial('clientes', 'update')) {
            showError('Solo el administrador puede modificar las condiciones iniciales del cliente.');
            return;
        }
        return _originalEditarClienteComercial.apply(this, args);
    };
}

const _originalMostrarAgregarItemCatalogoComercial = typeof mostrarAgregarItemCatalogoComercial === 'function' ? mostrarAgregarItemCatalogoComercial : null;
if (_originalMostrarAgregarItemCatalogoComercial) {
    mostrarAgregarItemCatalogoComercial = function (...args) {
        if (!canCreateCatalogoComercial()) {
            showError('No tienes permiso para crear examenes o paquetes.');
            return;
        }
        return _originalMostrarAgregarItemCatalogoComercial.apply(this, args);
    };
}

const _originalEditarItemCatalogoComercial = typeof editarItemCatalogoComercial === 'function' ? editarItemCatalogoComercial : null;
if (_originalEditarItemCatalogoComercial) {
    editarItemCatalogoComercial = async function (id, ...args) {
        const item = (catalogoComercialData || []).find(entry => Number(entry.id) === Number(id));
        const entity = getCatalogEntityFromTipoItem(item?.tipo_item);
        if (!canManageComercial(entity, 'update')) {
            showError('No tienes permiso para editar este item comercial.');
            return;
        }
        return _originalEditarItemCatalogoComercial.call(this, id, ...args);
    };
}

const _originalEditarTarifaCliente = typeof editarTarifaCliente === 'function' ? editarTarifaCliente : null;
if (_originalEditarTarifaCliente) {
    editarTarifaCliente = async function (...args) {
        if (!canManageComercial('tarifas', 'update')) {
            showError('No tienes permiso para editar tarifas comerciales.');
            return;
        }
        return _originalEditarTarifaCliente.apply(this, args);
    };
}

const _originalMostrarAgregarTarifaCliente = typeof mostrarAgregarTarifaCliente === 'function' ? mostrarAgregarTarifaCliente : null;
if (_originalMostrarAgregarTarifaCliente) {
    mostrarAgregarTarifaCliente = async function (...args) {
        if (!canManageComercial('tarifas', 'create')) {
            showError('No tienes permiso para crear tarifas comerciales.');
            return;
        }
        return _originalMostrarAgregarTarifaCliente.apply(this, args);
    };
}

const _originalMostrarAgregarAtencionCliente = typeof mostrarAgregarAtencionCliente === 'function' ? mostrarAgregarAtencionCliente : null;
if (_originalMostrarAgregarAtencionCliente) {
    mostrarAgregarAtencionCliente = async function (...args) {
        if (!canManageComercial('atenciones', 'create')) {
            showError('No tienes permiso para registrar atenciones.');
            return;
        }
        return _originalMostrarAgregarAtencionCliente.apply(this, args);
    };
}

const _originalEditarSeguimientoAtencion = typeof editarSeguimientoAtencion === 'function' ? editarSeguimientoAtencion : null;
if (_originalEditarSeguimientoAtencion) {
    editarSeguimientoAtencion = async function (...args) {
        if (!canManageComercial('atenciones', 'update')) {
            showError('No tienes permiso para editar atenciones.');
            return;
        }
        return _originalEditarSeguimientoAtencion.apply(this, args);
    };
}

const _originalMostrarAgregarSeguimientoDocumento = typeof mostrarAgregarSeguimientoDocumento === 'function' ? mostrarAgregarSeguimientoDocumento : null;
if (_originalMostrarAgregarSeguimientoDocumento) {
    mostrarAgregarSeguimientoDocumento = function (...args) {
        if (!canManageComercial('documentos', 'create')) {
            showError('No tienes permiso para registrar documentos comerciales.');
            return;
        }
        return _originalMostrarAgregarSeguimientoDocumento.apply(this, args);
    };
}

const _originalEditarSeguimientoDocumento = typeof editarSeguimientoDocumento === 'function' ? editarSeguimientoDocumento : null;
if (_originalEditarSeguimientoDocumento) {
    editarSeguimientoDocumento = function (...args) {
        if (!canManageComercial('documentos', 'update')) {
            showError('No tienes permiso para editar documentos comerciales.');
            return;
        }
        return _originalEditarSeguimientoDocumento.apply(this, args);
    };
}

const _originalMostrarAgregarSeguimientoPago = typeof mostrarAgregarSeguimientoPago === 'function' ? mostrarAgregarSeguimientoPago : null;
if (_originalMostrarAgregarSeguimientoPago) {
    mostrarAgregarSeguimientoPago = function (...args) {
        if (!canManageComercial('pagos', 'create')) {
            showError('No tienes permiso para registrar pagos.');
            return;
        }
        return _originalMostrarAgregarSeguimientoPago.apply(this, args);
    };
}

const _originalEditarSeguimientoPago = typeof editarSeguimientoPago === 'function' ? editarSeguimientoPago : null;
if (_originalEditarSeguimientoPago) {
    editarSeguimientoPago = function (...args) {
        if (!canManageComercial('pagos', 'update')) {
            showError('No tienes permiso para editar pagos.');
            return;
        }
        return _originalEditarSeguimientoPago.apply(this, args);
    };
}

function renderRoleMenuPermissions(selectedIds = []) {
    const container = document.getElementById('rolMenuPermissions');
    if (!container) return;

    if (!Array.isArray(menuOptionsData) || menuOptionsData.length === 0) {
        container.innerHTML = '<div class="loading">No fue posible cargar los permisos.</div>';
        return;
    }

    const selected = new Set((selectedIds || []).map(id => String(id)));
    // Nombre canonico del permiso, tolerante a los dos formatos posibles.
    const permisoNombreDe = option => option.permiso_nombre || option.permiso || '';
    const nombresPermisoDe = option => {
        const names = Array.isArray(option.permission_names) ? option.permission_names : [];
        return names.length ? names.map(String) : [String(permisoNombreDe(option))];
    };
    const esSubopcionComercial = option => option.category === 'comercial_section';
    const renderOption = option => {
        const nombrePermiso = permisoNombreDe(option);
        const permissionNames = nombresPermisoDe(option);
        const isSelected = permissionNames.some(name => selected.has(name));
        const sectionAttribute = option.section
            ? ` data-role-section="${escapeHtml(option.section)}"`
            : '';
        return `
        <label class="role-menu-option">
            <input type="checkbox" value="${escapeHtml(nombrePermiso)}" data-permission-name="${escapeHtml(nombrePermiso)}" data-permission-names="${escapeHtml(JSON.stringify(permissionNames))}"${sectionAttribute} ${isSelected ? 'checked' : ''}>
            <div>
                <strong>${escapeHtml(option.nombre || option.group || 'Permiso')}</strong>
                <span>${escapeHtml(option.descripcion || '')}</span>
            </div>
        </label>
    `;
    };

    const menuOptions = menuOptionsData.filter(option => option.category === 'menu');
    const commercialSections = menuOptionsData
        .filter(esSubopcionComercial)
        .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0));

    container.innerHTML = `
        <section class="role-permission-section">
            <h4 class="role-permission-group-title">Menus principales</h4>
            <p class="role-permission-group-help">Definen las opciones que aparecen en el menu lateral.</p>
            <div class="role-menu-grid">
                ${menuOptions.map(renderOption).join('')}
            </div>
        </section>
        <section class="role-permission-section" id="rolComercialSubopcionesSection" style="display:none;">
            <h4 class="role-permission-group-title">Vendedores: subopciones</h4>
            <p class="role-permission-group-help">Marca las pestanas que este rol podra usar dentro de Vendedores.</p>
            <label class="role-menu-option">
                <input type="checkbox" data-select-all-commercial>
                <div>
                    <strong>Todas las subopciones</strong>
                    <span>Habilita todas las opciones del menu Vendedores.</span>
                </div>
            </label>
            <div class="role-menu-grid">
                ${commercialSections.map(renderOption).join('')}
            </div>
        </section>
    `;

    const comercialMenu = menuOptions.find(option => option.module === 'comercial');
    const commercialMenuCheckbox = comercialMenu
        ? container.querySelector(`input[value="${comercialMenu.permiso_nombre || comercialMenu.permiso || comercialMenu.permiso_id}"]`)
        : null;
    const commercialOptionCheckboxes = Array.from(
        container.querySelectorAll('input[data-role-section]')
    );
    const selectAllCommercial = container.querySelector('input[data-select-all-commercial]');
    const comercialSubopcionesSection = container.querySelector('#rolComercialSubopcionesSection');

    // El bloque de subopciones de Vendedores solo se muestra cuando el menu
    // Vendedores esta marcado, para que el modal arranque corto y sin ruido.
    const actualizarVisibilidadSubopcionesComercial = () => {
        if (!comercialSubopcionesSection) return;
        const visible = Boolean(commercialMenuCheckbox && commercialMenuCheckbox.checked);
        comercialSubopcionesSection.style.display = visible ? '' : 'none';
    };

    const syncCommercialSelection = () => {
        const selectedCount = commercialOptionCheckboxes.filter(checkbox => checkbox.checked).length;
        if (commercialMenuCheckbox && selectedCount > 0) commercialMenuCheckbox.checked = true;
        if (selectAllCommercial) {
            selectAllCommercial.checked = selectedCount > 0 && selectedCount === commercialOptionCheckboxes.length;
            selectAllCommercial.indeterminate = selectedCount > 0 && selectedCount < commercialOptionCheckboxes.length;
        }
        actualizarVisibilidadSubopcionesComercial();
    };

    commercialOptionCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            syncCommercialSelection();
        });
    });

    if (commercialMenuCheckbox) {
        commercialMenuCheckbox.addEventListener('change', () => {
            if (!commercialMenuCheckbox.checked) {
                commercialOptionCheckboxes.forEach(checkbox => {
                    checkbox.checked = false;
                });
            }
            actualizarVisibilidadSubopcionesComercial();
            syncCommercialSelection();
        });
    }

    if (selectAllCommercial) {
        selectAllCommercial.addEventListener('change', () => {
            commercialOptionCheckboxes.forEach(checkbox => {
                checkbox.checked = selectAllCommercial.checked;
            });
            syncCommercialSelection();
        });
    }

    actualizarVisibilidadSubopcionesComercial();
    syncCommercialSelection();
}

window.setTimeout(syncComercialPermissionUI, 0);


function setupMenuNavigation() {
    const menuItems = document.querySelectorAll('.menu-item, .menu-subitem');
    
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            if (item.dataset.action === 'logout') {
                performLogout();
                return;
            }

            const module = item.dataset.module;
            if (!module) {
                return;
            }
            const section = item.dataset.section || '';
            if (module === 'comercial') {
                // Al entrar al modulo comercial desde el menu lateral siempre
                // abrimos en 'inicio' (sin seccion seleccionada), para no
                // mostrar tarjetas hasta que el usuario elija una pestana.
                window._comercialSeccionActual = section || 'inicio';
            }
            switchModule(module);
        });
    });
}


function switchModule(moduleName) {
    const allowedModules = Array.isArray(currentUser?.menu_modules) ? currentUser.menu_modules : [];
    const isAdminUser = currentUser?.role === 'Administrador';
    if (!isAdminUser && moduleName !== 'dashboard' && moduleName !== 'appBanner' && !allowedModules.includes(moduleName)) {
        showError('No tienes acceso a ese módulo con tu rol actual.');
        return;
    }

    markSidebarModuleActive(moduleName, '');

    // Hide all views
    const views = document.querySelectorAll('.module-view');
    views.forEach(view => view.classList.remove('active'));

    const userMenu = document.querySelector('.user-menu');
    let displayName;
    if (moduleName === 'comercial') {
        displayName = window._comercialSeccionActual === 'vendedores'
            ? 'Vendedores'
            : 'Registro Atenciones';
    } else if (moduleName === 'gestion_informacion') {
        displayName = 'Atenciones';
    } else if (moduleName === 'compras') {
        displayName = 'Gestión de Compras';
    } else if (moduleName === 'ventas') {
        displayName = 'Informacion SIIGO';
    } else {
        displayName = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
    }
    if (userMenu) userMenu.style.display = '';
    document.getElementById('moduleTitle').textContent = displayName;

    // Try to show a full module view if it exists (e.g., comercialView)
    const fullView = document.getElementById(`${moduleName}View`);
    if (fullView) {
        console.debug('switchModule: activating full view', moduleName);
        fullView.classList.add('active');
        // Load module-specific data where available
        if (moduleName === 'usuarios') {
            loadUsuariosManagement();
        } else if (moduleName === 'dashboard') {
            loadDashboardData();
        } else if (moduleName === 'comercial') {
            try {
                const panelMes = document.getElementById('comercialMesPanel');
                const homeHeader = document.getElementById('comercialHomeHeader');
                if (panelMes) panelMes.style.display = 'none';
                if (homeHeader) homeHeader.style.display = '';
                inicializarModuloComercial(window._comercialSeccionActual || 'inicio');
            } catch (e) {
                console.error('Error inicializando modulo Comercial', e);
            }
        } else if (moduleName === 'gestion_informacion') {
            // Abrir directamente el modal de Gestión Información
            try {
                abrirCargueAtencionDia();
            } catch (e) {
                console.error('Error abriendo Gestión Información', e);
            }
        } else if (moduleName === 'ventas') {
            try {
                inicializarVentasSiigo();
            } catch (e) {
                console.error('Error inicializando modulo Ventas/SIIGO', e);
            }
        } else if (moduleName === 'compras') {
            try {
                const panelMes = document.getElementById('comprasMesPanel');
                const homeHeader = document.getElementById('comprasHomeHeader');
                if (panelMes) panelMes.style.display = 'none';
                if (homeHeader) homeHeader.style.display = '';
            } catch (e) {
                console.error('Error inicializando modulo compras', e);
            }
        } else {
            // Attempt to fetch dashboard fragment for other modules
            loadModuleDashboardData(moduleName, fullView);
        }
        return;
    }

    // If no full view exists, create (or show) a lightweight module-dashboard view
    const miniId = `${moduleName}MiniView`;
    let miniView = document.getElementById(miniId);
    if (!miniView) {
        miniView = document.createElement('div');
        miniView.id = miniId;
        miniView.className = 'module-view active';
        miniView.innerHTML = `
            <div class="module-header">
                <div class="button-group">
                    <button class="btn btn-primary" onclick="openModuleFull('${moduleName}')">Abrir gestión</button>
                    <button class="btn btn-secondary" onclick="loadModuleDashboardData('${moduleName}', document.getElementById('${miniId}'))">Actualizar</button>
                    <button class="btn btn-outline" onclick="alert('Función no disponible aún')">Consultar</button>
                </div>
            </div>
            <div class="stats-grid" style="max-width:1100px; margin: 8px 0;">
                <div class="stat-card">
                    <h3>${displayName} — Resumen</h3>
                    <p class="stat-number" id="${moduleName}Mini_count">-</p>
                </div>
                <div class="stat-card">
                    <h3>Estado</h3>
                    <p class="stat-number">✓ OK</p>
                </div>
            </div>
            <div id="${moduleName}Mini_content" style="margin-top:12px; max-width:1100px;"></div>
        `;
        const contentArea = document.querySelector('.content-area');
        contentArea.appendChild(miniView);
    } else {
        miniView.classList.add('active');
    }

    // Try to populate mini dashboard with server data
    loadModuleDashboardData(moduleName, miniView);
}

async function loadModuleDashboardData(moduleName, container) {
    // Special handling for servicios module: fetch catálogo y renderizar
    if (moduleName === 'servicios') {
        try {
            const resp = await fetch('/api/servicios/list', { credentials: 'include' });
            if (!resp.ok) throw new Error('No se pudo cargar el catálogo de servicios');
            const data = await resp.json();
            const servicios = data.servicios || data.data || data.items || [];
            const catalogDiv = container.querySelector('#serviciosCatalogo');
            console.debug('loadModuleDashboardData: servicios data', data);
            if (!catalogDiv) {
                console.warn('loadModuleDashboardData: no se encontró #serviciosCatalogo en container', container);
                return;
            }
            if (!servicios || servicios.length === 0) {
                catalogDiv.innerHTML = `<div class="placeholder"><p>No hay servicios registrados.</p><p><button class="btn btn-primary" onclick="showNewServicioModal()">Crear servicio</button></p></div>`;
                return;
            }
            let html = `<div class="module-actions-row"><button class="btn btn-primary" onclick="showNewServicioModal()">Nuevo Servicio</button></div>`;
            html += `<table class="data-table" style="width:100%; margin-top:8px;"><thead><tr><th>Nombre</th><th>Referencia</th><th>Día pago</th><th>Valor approx.</th><th>Activo</th><th>Acciones</th></tr></thead><tbody>`;
            servicios.forEach(s => {
                html += `<tr><td>${escapeHtml(s.nombre)}</td><td>${escapeHtml(s.referencia_pago || '')}</td><td style="text-align:center;">${s.dia_pago || ''}</td><td style="text-align:right;">${formatCurrency(s.valor_aproximado || 0)}</td><td style="text-align:center;">${s.activo ? 'Sí' : 'No'}</td><td style="text-align:center;"><button class="action-btn" onclick="editServicio(${s.id})">Editar</button> <button class="action-btn" onclick="deleteServicio(${s.id})">Eliminar</button></td></tr>`;
            });
            html += '</tbody></table>';
            catalogDiv.innerHTML = html;
        } catch (err) {
            const catalogDiv = container.querySelector('#serviciosCatalogo');
            if (catalogDiv) catalogDiv.innerHTML = `<p style="color:#e74c3c;">Error cargando servicios: ${err.message}</p>`;
            console.error('Error cargando servicios', err);
        }
        return;
    }

    // Try to fetch /api/dashboard/<moduleName> and render simple stats
    try {
        const resp = await fetch(`/api/dashboard/${moduleName}`, { credentials: 'include' });
        if (!resp.ok) {
            // No specific endpoint, show default placeholder
            const content = container.querySelector(`#${moduleName}Mini_content`);
            if (content) content.innerHTML = `<p style="color:#666;">No hay métricas específicas para ${moduleName}.</p>`;
            return;
        }
        const data = await resp.json();
        const content = container.querySelector(`#${moduleName}Mini_content`);
        if (!content) return;
        // Render simple key/value list
        const keys = Object.keys(data);
        let html = '<div class="module-stats-list">';
        keys.forEach(k => {
            html += `<div style="margin-bottom:6px;"><strong>${k}:</strong> ${JSON.stringify(data[k])}</div>`;
        });
        html += '</div>';
        content.innerHTML = html;
        // Update any summary count element
        const countEl = document.getElementById(`${moduleName}Mini_count`);
        if (countEl && data.total_empleados !== undefined) countEl.textContent = data.total_empleados;
    } catch (err) {
        const content = container.querySelector(`#${moduleName}Mini_content`);
        if (content) content.innerHTML = `<p style="color:#e74c3c;">Error cargando métricas: ${err.message}</p>`;
        console.error('Error cargando dashboard módulo', moduleName, err);
    }
}

// Dashboard específico del módulo de Nómina
function openModuleFull(moduleName) {
    const full = document.getElementById(`${moduleName}View`);
    if (full) {
        // deactivate mini/full views
        document.querySelectorAll('.module-view').forEach(v => v.classList.remove('active'));
        full.classList.add('active');
        // set title and user-menu state similar to switchModule
        const userMenu = document.querySelector('.user-menu');
        document.getElementById('moduleTitle').textContent = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
        if (userMenu) userMenu.style.display = '';
        if (moduleName === 'comercial') {
            document.getElementById('moduleTitle').textContent = 'Registro Atenciones';
        }
        // load module-specific handlers
        if (moduleName === 'usuarios') loadUsuariosManagement();
        else if (moduleName === 'dashboard') loadDashboardData();
        else if (moduleName === 'comercial') {
            const panelMes = document.getElementById('comercialMesPanel');
            const homeHeader = document.getElementById('comercialHomeHeader');
            if (panelMes) panelMes.style.display = 'none';
            if (homeHeader) homeHeader.style.display = '';
            inicializarModuloComercial(window._comercialSeccionActual || 'inicio');
        }
    } else {
        alert('No existe la vista completa para este módulo.');
    }
}

async function performLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        localStorage.removeItem('user');
        window.location.href = '/';
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
        localStorage.removeItem('user');
        window.location.href = '/';
    }
}

function setupLogout() {
    const logoutButtons = [document.getElementById('logoutBtn')].filter(Boolean);

    logoutButtons.forEach(button => {
        if (button.dataset.bound === 'true') {
            return;
        }

        button.addEventListener('click', (event) => {
            event.preventDefault();
            performLogout();
        });
        button.dataset.bound = 'true';
    });
}

async function loadDashboardData() {
    try {
        const response = await fetch('/api/dashboard/stats', {
            credentials: 'include'
        });
        const data = await response.json();
        
        document.getElementById('totalEmpleados').textContent = data.total_empleados || 0;
        document.getElementById('totalUsuarios').textContent = data.total_usuarios || 0;
        
        // Quincena actual
        if (data.quincena_actual) {
            document.getElementById('quincenaActual').textContent = 
                `${data.quincena_actual.numero}/${data.quincena_actual.año}`;
        } else {
            document.getElementById('quincenaActual').textContent = 'N/A';
        }
    } catch (error) {
        console.error('Error cargando dashboard:', error);
    }
}

async function loadComercialDashboard() {
    const vendedoresActivosEl = document.getElementById('comercialVendedoresActivos');
    const clientesActivosEl = document.getElementById('comercialClientesActivos');
    const carteraPendienteEl = document.getElementById('comercialCarteraPendiente');
    const rentabilidadMesEl = document.getElementById('comercialRentabilidadMes');

    try {
        const params = new URLSearchParams();
        if (window._comercialPeriodoActual?.mes) {
            params.set('mes', String(window._comercialPeriodoActual.mes));
        }
        if (window._comercialPeriodoActual?.anio) {
            params.set('anio', String(window._comercialPeriodoActual.anio));
        }
        const url = params.toString() ? `/api/dashboard/comercial?${params.toString()}` : '/api/dashboard/comercial';
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'No se pudo cargar el dashboard comercial');
        }

        const data = await response.json();
        if (vendedoresActivosEl) vendedoresActivosEl.textContent = data.vendedores_activos ?? 0;
        if (clientesActivosEl) clientesActivosEl.textContent = data.clientes_activos ?? 0;
        if (carteraPendienteEl) carteraPendienteEl.textContent = formatCurrency(data.cartera_pendiente || 0);
        if (rentabilidadMesEl) rentabilidadMesEl.textContent = formatCurrency(data.rentabilidad_mes || 0);

        if (data.periodo_actual && !window._comercialPeriodoActual) {
            window._comercialPeriodoActual = data.periodo_actual;
            window._comisionesPeriodoActual = data.periodo_actual;
            actualizarEtiquetaComercialPeriodo();
        }
    } catch (error) {
        console.error('Error cargando dashboard comercial:', error);
        if (vendedoresActivosEl) vendedoresActivosEl.textContent = '-';
        if (clientesActivosEl) clientesActivosEl.textContent = '-';
        if (carteraPendienteEl) carteraPendienteEl.textContent = '$0';
        if (rentabilidadMesEl) rentabilidadMesEl.textContent = '$0';
    }
}

function getComercialSectionConfig(sectionName = window._comercialSeccionActual || 'vendedores') {
    return COMERCIAL_SECTION_CONFIG[sectionName] || COMERCIAL_SECTION_CONFIG.inicio;
}

function actualizarNavegacionComercial(sectionName) {
    document.querySelectorAll('[data-comercial-section]').forEach(button => {
        const isActive = button.dataset.comercialSection === sectionName;
        button.classList.toggle('active', isActive);
        button.classList.toggle('btn-primary', isActive);
        button.classList.toggle('btn-secondary', !isActive);
    });
}

function resetComercialWorkspace() {
    const mesActualPanel = document.getElementById('comercialMesActualPanel');
    const panelMes = document.getElementById('comercialMesPanel');

    if (mesActualPanel) mesActualPanel.style.display = 'none';
    if (panelMes) panelMes.style.display = 'none';

    Object.values(COMERCIAL_SECTION_CONFIG).forEach(section => {
        (section.panels || []).forEach(panelId => {
            const panel = document.getElementById(panelId);
            if (panel) {
                panel.classList.remove('active');
            }
        });
    });
}

function mostrarPanelesComercial(sectionName) {
    const config = getComercialSectionConfig(sectionName);
    const activePanels = new Set(config.panels || []);

    resetComercialWorkspace();

    activePanels.forEach(panelId => {
        const panel = document.getElementById(panelId);
        if (panel) {
            panel.classList.add('active');
        }
    });
}

async function switchComercialSection(sectionName = 'inicio', options = {}) {
    const normalizedSection = COMERCIAL_SECTION_CONFIG[sectionName] ? sectionName : 'inicio';
    const { reload = false, focus = true } = options;
    if (!hasComercialSectionPermission(normalizedSection)) {
        showError('No tienes acceso a esta subopcion de Vendedores.');
        return;
    }
    const panelMes = document.getElementById('comercialMesPanel');
    const homeHeader = document.getElementById('comercialHomeHeader');
    const mesActualPanel = document.getElementById('comercialMesActualPanel');
    const config = getComercialSectionConfig(normalizedSection);

    window._comercialSeccionActual = normalizedSection;
    if (homeHeader) homeHeader.style.display = '';
    actualizarNavegacionComercial(normalizedSection);
    mostrarPanelesComercial(normalizedSection);

    // El panel de bienvenida solo se muestra cuando no hay seccion elegida.
    const inicioPanel = document.getElementById('comercialInicioPanel');
    if (inicioPanel) inicioPanel.style.display = normalizedSection === 'inicio' ? '' : 'none';
    ['vendedores', 'examenes', 'clientes'].forEach(section => {
        if (section !== normalizedSection) {
            resetConsultaComercial(section);
        }
    });

    if (normalizedSection === 'inicio') {
        return;
    }

    if (normalizedSection === 'caja') {
        cargarOpcionesCaja();
        return;
    }

    if (normalizedSection === 'registro_atenciones') {
        try {
            await config.load();
        } catch (error) {
            console.error('Error cargando seccion registro de atenciones:', error);
        }
        if (focus && config.focusId) {
            window.setTimeout(() => focusModuleSection(config.focusId), 120);
        }
        return;
    }

    if (normalizedSection === 'mes') {
        if (mesActualPanel) mesActualPanel.style.display = '';
        if (reload) {
            await config.load();
        }
        if (!window._comercialPeriodoActual) {
            if (typeof openComercialPeriodoSeleccion === 'function') {
                openComercialPeriodoSeleccion();
            }
        } else if (panelMes) {
            panelMes.style.display = 'block';
        }
        if (focus && config.focusId) {
            window.setTimeout(() => focusModuleSection(config.focusId), 120);
        }
        return;
    }

    if (reload) {
        try {
            await config.load();
        } catch (error) {
            console.error(`Error cargando seccion comercial ${normalizedSection}:`, error);
        }
    }

    if (focus) {
        window.setTimeout(() => focusModuleSection(config.focusId), 120);
    }
}

async function inicializarModuloComercial(sectionName = window._comercialSeccionActual || 'inicio', options = {}) {
    const { focus = false } = options;
    actualizarEtiquetaComercialPeriodo();
    await switchComercialSection(sectionName, { reload: sectionName === 'mes', focus });
}

function abrirNuevoComercialActual() {
    const config = getComercialSectionConfig(window._comercialSeccionActual || 'inicio');
    if (typeof config.openNew === 'function') {
        config.openNew();
    }
}

async function consultarComercial(sectionName = window._comercialSeccionActual || 'inicio') {
    await abrirConsultaComercial(sectionName);
}

function renderEstadoLaboralBadge(estadoLaboral, activo) {
    const estado = (estadoLaboral || (activo ? 'ACTIVO' : 'INACTIVO')).toUpperCase();
    if (estado === 'ACTIVO') return '<span class="badge badge-success">Activo</span>';
    if (estado === 'RETIRADO') return '<span class="badge badge-danger">Retirado</span>';
    if (estado === 'INACTIVO') return '<span class="badge badge-warning">Inactivo</span>';
    return `<span class="badge badge-secondary">${escapeHtml(estado)}</span>`;
}

function getEstadoLaboralVigente(empleado) {
    if (!empleado) return 'INACTIVO';
    const estado = String(empleado.estado_laboral || '').trim().toUpperCase();
    if (estado === 'RETIRADO' || empleado.fecha_retiro) return 'RETIRADO';
    if (empleado.activo === false) return 'INACTIVO';
    return estado || 'ACTIVO';
}

let consultaEmpleadosData = [];
let areasConfigData = [];
let cargosConfigData = [];
let asignacionesLaboralesData = [];
let vendedoresConfigData = [];
let vendedorUsuariosAsignablesData = [];
let clientesComercialesData = [];
let catalogoComercialData = [];
let tarifasComercialesData = [];
let clienteComercialTarifaContext = null;
let catalogoComercialComponentesSeleccionados = [];
let catalogoComercialExamenesDisponibles = [];
let catalogoComercialComponentesPendientes = [];
let recepcionClienteActivoId = null;
let clienteSeguimientoContext = {
    clienteId: null,
    cliente: null,
    convenioItems: [],
    atenciones: [],
    documentos: [],
    pagos: [],
    draftDetalles: []
};
window.cargueAtencionesDiaState = {
    page: 1,
    pages: 0,
    perPage: 50,
    total: 0,
    clienteSearchTimer: null,
    convenioSearchTimer: null,
    activeSection: 'inicio',
    records: [],
    draftAtencionRows: [],
    draftAtencionMode: 'create',
    draftAtencionBase: null,
    draftConvenioItems: [],
    draftConvenioLoadedKey: '',
    draftConvenioSelectedItemId: null
};
window.comercialPeriodosCargueState = {
    loaded: false,
    loading: false,
    periodos: []
};
window.anticipoProgramadoState = {
    empresaSearchTimer: null,
    itemSearchTimer: null,
    clienteId: '',
    cliente: null,
    convenioItems: [],
    convenioLoadedKey: '',
    selectedItemId: null,
    draftDetalles: [],
    paymentValueTouched: false
};
window.prefacturaManualState = {
    detalleEditId: null,
    convenioItems: [],
    convenioLoadedKey: ''
};

function updateCargueAtencionesDiaScope(scope, extraMessage = '') {
    const scopeContainer = document.getElementById('cargueAtencionesDiaScope');
    if (!scopeContainer) return;

    let baseMessage = '';
    if (scope === 'admin') {
        baseMessage = 'Vista general: estás viendo todos los registros cargados.';
    } else if (scope === 'vendedor') {
        baseMessage = 'Vista restringida: solo se muestran registros asociados a tus clientes.';
    } else if (scope === 'sin_vendedor_asociado') {
        baseMessage = 'Tu usuario no está asociado a un vendedor comercial, por eso no se pueden mostrar registros.';
    }

    scopeContainer.textContent = [baseMessage, extraMessage].filter(Boolean).join(' ');
}

function applyCargueAtencionesDiaScopeUI(scope) {
    const vendedorWrap = document.getElementById('cargueAtencionesDiaFiltroVendedorWrap');
    const vendedorInput = document.getElementById('cargueAtencionesDiaFiltroVendedor');
    const isAdminScope = scope === 'admin';

    if (vendedorWrap) {
        vendedorWrap.style.display = isAdminScope ? '' : 'none';
    }
    if (!isAdminScope && vendedorInput) {
        vendedorInput.value = '';
    }
}

function resetConsultaAtencionesDia(message = 'Ingresa uno o varios criterios para consultar atenciones cargadas.') {
    const results = document.getElementById('cargueAtencionesDiaResults');
    const resumen = document.getElementById('cargueAtencionesDiaResumen');
    const pageInfo = document.getElementById('cargueAtencionesDiaPageInfo');
    const prevBtn = document.getElementById('cargueAtencionesDiaPrevBtn');
    const nextBtn = document.getElementById('cargueAtencionesDiaNextBtn');

    window.cargueAtencionesDiaState.page = 1;
    window.cargueAtencionesDiaState.pages = 0;
    window.cargueAtencionesDiaState.total = 0;

    if (results) {
        results.innerHTML = `<div class="loading">${escapeHtml(message)}</div>`;
    }
    if (resumen) resumen.textContent = message;
    if (pageInfo) pageInfo.textContent = 'Pagina 0 de 0';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
}

function obtenerFechaBaseCargueAtenciones(item) {
    return String(item?.fecha_creacion_orden || item?.fecha_factura || '').trim();
}

function obtenerFechaComparableCargueAtenciones(item) {
    const base = obtenerFechaBaseCargueAtenciones(item);
    return base ? base.slice(0, 10) : '';
}

function formatearRangoFechasCargueAtenciones(fechas) {
    const valores = Array.isArray(fechas) ? fechas.filter(Boolean).sort() : [];
    if (!valores.length) return 'Sin fecha';
    if (valores[0] === valores[valores.length - 1]) return valores[0];
    return `${valores[0]} a ${valores[valores.length - 1]}`;
}

const cargueAtencionesOrderCollator = new Intl.Collator('es', {
    numeric: true,
    sensitivity: 'base'
});

function compararOrdenCargueAtenciones(a, b) {
    return cargueAtencionesOrderCollator.compare(String(a || ''), String(b || ''));
}

function construirResultadosAgrupadosCargueAtenciones(registros) {
    const gruposMap = new Map();

    (Array.isArray(registros) ? registros : []).forEach(item => {
        const clienteLabel = item.cliente_nombre || item.acuerdo_comercial || item.empresa_mision || 'Sin cliente relacionado';
        const vendedorLabel = item.vendedor_responsable || item.nombre_vendedor || 'Sin vendedor';
        const groupKey = `${item.cliente_id || clienteLabel}::${item.vendedor_id || vendedorLabel}`;

        if (!gruposMap.has(groupKey)) {
            gruposMap.set(groupKey, {
                clienteLabel,
                vendedorLabel,
                fechas: new Set(),
                ordenes: new Map()
            });
        }

        const grupo = gruposMap.get(groupKey);
        const fechaComparable = obtenerFechaComparableCargueAtenciones(item);
        if (fechaComparable) grupo.fechas.add(fechaComparable);

        const orderKey = item.nro_orden || `sin-orden-${item.id || grupo.ordenes.size}`;
        const ordenLabel = item.nro_orden || 'SIN ORDEN';
        if (!grupo.ordenes.has(orderKey)) {
            grupo.ordenes.set(orderKey, {
                ordenLabel,
                detalles: []
            });
        }

        grupo.ordenes.get(orderKey).detalles.push({
            id: Number(item.id || 0),
            clienteId: item.cliente_id || '',
            vendedorId: item.vendedor_id || '',
            esEditable: item.es_editable === true || String(item.estado_gestion || '').toUpperCase() === 'CARGADA',
            fecha: obtenerFechaBaseCargueAtenciones(item) || 'N/A',
            paciente: item.nombre_paciente || 'N/A',
            identificacion: item.nro_identificacion || 'N/A',
            formaPago: item.forma_pago || 'N/A',
            servicio: item.servicio || 'N/A',
            valor: Number(item.precio || 0),
            estado: item.estado_gestion || 'N/A',
            estadoGestion: item.estado_gestion || 'N/A',
            estadoArchivo: item.estado_orden || 'N/A',
            factura: item.nro_factura || 'N/A',
            archivoOrigen: item.archivo_origen || '',
            nroOrden: item.nro_orden || '',
            fechaFactura: item.fecha_factura || '',
            acuerdoComercial: item.acuerdo_comercial || '',
            empresaMision: item.empresa_mision || '',
            sede: item.sede || '',
            nombreVendedor: item.nombre_vendedor || item.vendedor_responsable || '',
            usuarioCreacion: item.usuario_creacion || ''
        });
    });

    const grupos = Array.from(gruposMap.values()).map(grupo => ({
        ...grupo,
        rangoFechas: formatearRangoFechasCargueAtenciones(Array.from(grupo.fechas)),
        ordenes: Array.from(grupo.ordenes.values()).sort((a, b) => compararOrdenCargueAtenciones(a.ordenLabel, b.ordenLabel))
    }));

    if (!grupos.length) {
        return '<div class="loading">No hay registros para mostrar.</div>';
    }

    return grupos.map(grupo => `
        <section class="cargue-atenciones-group-card">
            <div class="cargue-atenciones-group-header">
                <div class="cargue-atenciones-group-pill"><strong>Cliente:</strong> ${escapeHtml(grupo.clienteLabel)}</div>
                <div class="cargue-atenciones-group-pill"><strong>Vendedor:</strong> ${escapeHtml(grupo.vendedorLabel)}</div>
                <div class="cargue-atenciones-group-pill"><strong>Rango de fechas:</strong> ${escapeHtml(grupo.rangoFechas)}</div>
            </div>
            <div class="cargue-atenciones-orders">
                ${grupo.ordenes.map(orden => `
                    <article class="cargue-atenciones-order-card">
                        <div class="cargue-atenciones-order-title">
                            <div class="cargue-atenciones-order-main">
                                <span class="cargue-atenciones-order-main-id">Orden ${escapeHtml(orden.ordenLabel)}</span>
                                <span class="cargue-atenciones-order-main-meta"><strong>Paciente:</strong> ${escapeHtml(orden.detalles[0]?.paciente || 'N/A')}</span>
                                <span class="cargue-atenciones-order-main-meta"><strong>Fecha:</strong> ${escapeHtml(orden.detalles[0]?.fecha || 'N/A')}</span>
                                <span class="cargue-atenciones-order-main-meta"><strong>Forma pago:</strong> ${escapeHtml(orden.detalles[0]?.formaPago || 'N/A')}</span>
                            </div>
                            <div class="cargue-atenciones-order-total">
                                <span>Total orden</span>
                                <strong>${formatCurrency(orden.detalles.reduce((sum, detalle) => sum + Number(detalle.valor || 0), 0))}</strong>
                            </div>
                        </div>
                            <div class="cargue-atenciones-order-body">
                            ${orden.detalles.map((detalle, index) => `
                                <div class="cargue-atenciones-detail-row">
                                    <div class="cargue-atenciones-detail-cell">
                                        ${index === 0 ? '<span>Servicio</span>' : ''}
                                        <strong>${escapeHtml(detalle.servicio)}</strong>
                                        <div style="color:#666; font-size:0.85rem;">${escapeHtml(`${detalle.paciente} · ${detalle.identificacion}`)}</div>
                                        <div style="color:#666; font-size:0.85rem;">${escapeHtml(`Estado gestion: ${detalle.estadoGestion} · Archivo: ${detalle.estadoArchivo} · Factura: ${detalle.factura}`)}</div>
                                    </div>
                                    <div class="cargue-atenciones-detail-cell cargue-atenciones-detail-value">
                                        ${index === 0 ? '<span>Valor</span>' : ''}
                                        <strong>${formatCurrency(detalle.valor)}</strong>
                                        ${(canManageComercial('atenciones', 'update') || canManageComercial('atenciones', 'delete')) ? `
                                            <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:8px; flex-wrap:wrap;">
                                                ${detalle.esEditable && canManageComercial('atenciones', 'update') ? `<button type="button" class="action-btn action-btn-edit" onclick="abrirEditarAtencionGestionInformacion(${detalle.id})">Editar cargada</button>` : ''}
                                                ${detalle.esEditable && canManageComercial('atenciones', 'delete') ? `<button type="button" class="action-btn action-btn-delete" onclick="eliminarAtencionGestionInformacion(${detalle.id})">Eliminar</button>` : ''}
                                                ${!detalle.esEditable ? `<span style="color:#64748b; font-size:0.85rem;">Solo editable en CARGADA</span>` : ''}
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </article>
                `).join('')}
            </div>
        </section>
    `).join('');
}

function hideCargueAtencionesClienteSuggestions() {
    const container = document.getElementById('cargueAtencionesDiaClienteSuggestions');
    if (!container) return;
    container.style.display = 'none';
    container.innerHTML = '';
}

function clearCargueAtencionesClienteSelection(preserveText = true) {
    const clienteIdInput = document.getElementById('cargueAtencionesDiaFiltroClienteId');
    const acuerdoInput = document.getElementById('cargueAtencionesDiaFiltroAcuerdo');
    if (clienteIdInput) clienteIdInput.value = '';
    if (acuerdoInput) {
        acuerdoInput.dataset.selectedLabel = '';
        if (!preserveText) acuerdoInput.value = '';
    }
}

function hasActiveFiltersCargueAtencionesDia() {
    const acuerdoInput = document.getElementById('cargueAtencionesDiaFiltroAcuerdo');
    const clienteIdInput = document.getElementById('cargueAtencionesDiaFiltroClienteId');
    const vendedorWrap = document.getElementById('cargueAtencionesDiaFiltroVendedorWrap');
    const vendedorInput = document.getElementById('cargueAtencionesDiaFiltroVendedor');
    const condicionComercialInput = document.getElementById('cargueAtencionesDiaFiltroCondicionComercial');
    const estadoInput = document.getElementById('cargueAtencionesDiaFiltroEstado');
    const fechaDesdeInput = document.getElementById('cargueAtencionesDiaFechaDesde');
    const fechaHastaInput = document.getElementById('cargueAtencionesDiaFechaHasta');

    return Boolean(
        (clienteIdInput?.value || '').trim()
        || (acuerdoInput?.value || '').trim()
        || ((vendedorWrap?.style.display !== 'none' ? vendedorInput?.value : '') || '').trim()
        || (condicionComercialInput?.value || '').trim()
        || (estadoInput?.value || '').trim()
        || (fechaDesdeInput?.value || '').trim()
        || (fechaHastaInput?.value || '').trim()
    );
}

function buildPeriodoCargueLabel(periodo) {
    if (!periodo) return '';
    const rango = [periodo.fecha_desde, periodo.fecha_hasta].filter(Boolean).join(' al ');
    if (!rango) return '';
    if (!periodo.source) return rango;
    return `${rango} · ${String(periodo.source).toUpperCase()}`;
}

async function cargarPeriodosCargueComercial(forceReload = false) {
    if (!forceReload && window.comercialPeriodosCargueState.loaded) {
        return window.comercialPeriodosCargueState.periodos || [];
    }
    if (window.comercialPeriodosCargueState.loading) {
        return window.comercialPeriodosCargueState.periodos || [];
    }

    window.comercialPeriodosCargueState.loading = true;
    try {
        const response = await fetch('/api/comercial/cargue-atenciones/periodos', { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'No se pudieron cargar los periodos disponibles.');
        }
        window.comercialPeriodosCargueState.loaded = true;
        window.comercialPeriodosCargueState.periodos = Array.isArray(data.periodos) ? data.periodos : [];
        return window.comercialPeriodosCargueState.periodos;
    } finally {
        window.comercialPeriodosCargueState.loading = false;
    }
}

function llenarSelectPeriodoCargue(selectId, placeholder) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const previousValue = select.value || '';
    const periodos = Array.isArray(window.comercialPeriodosCargueState.periodos)
        ? window.comercialPeriodosCargueState.periodos
        : [];

    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
    periodos.forEach(periodo => {
        const option = document.createElement('option');
        option.value = String(periodo.key || `${periodo.fecha_desde || ''}|${periodo.fecha_hasta || ''}`);
        option.textContent = buildPeriodoCargueLabel(periodo);
        option.dataset.fechaDesde = periodo.fecha_desde || '';
        option.dataset.fechaHasta = periodo.fecha_hasta || '';
        option.dataset.source = periodo.source || '';
        select.appendChild(option);
    });

    if (previousValue && Array.from(select.options).some(option => option.value === previousValue)) {
        select.value = previousValue;
    }
}

async function actualizarSelectoresPeriodosComercial(forceReload = false) {
    try {
        await cargarPeriodosCargueComercial(forceReload);
        llenarSelectPeriodoCargue('prefacturaPeriodoSelect', 'Seleccione un periodo...');
        llenarSelectPeriodoCargue('consultaPrefPeriodo', 'Todos');
        llenarSelectPeriodoCargue('cargueAtencionesDiaFiltroPeriodo', 'Todos');
    } catch (error) {
        console.error('Error cargando periodos comerciales:', error);
    }
}

function aplicarPeriodoEnRango(selectId, fechaDesdeId, fechaHastaId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const option = select.options[select.selectedIndex];
    const fechaDesdeInput = document.getElementById(fechaDesdeId);
    const fechaHastaInput = document.getElementById(fechaHastaId);
    if (!fechaDesdeInput || !fechaHastaInput) return;

    if (!option || !option.value) {
        return;
    }

    fechaDesdeInput.value = option.dataset.fechaDesde || '';
    fechaHastaInput.value = option.dataset.fechaHasta || '';
}

function limpiarSeleccionPeriodoSiFechasManual(selectId, fechaDesdeId, fechaHastaId) {
    const select = document.getElementById(selectId);
    const fechaDesde = document.getElementById(fechaDesdeId)?.value || '';
    const fechaHasta = document.getElementById(fechaHastaId)?.value || '';
    if (!select || !select.value) return;

    const option = select.options[select.selectedIndex];
    const matches = option
        && (option.dataset.fechaDesde || '') === fechaDesde
        && (option.dataset.fechaHasta || '') === fechaHasta;
    if (!matches) {
        select.value = '';
    }
}

function normalizarBusquedaBasica(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function renderCargueAtencionesClienteSuggestions(clientes, query = '') {
    const container = document.getElementById('cargueAtencionesDiaClienteSuggestions');
    if (!container) return;

    if (!Array.isArray(clientes) || clientes.length === 0) {
        container.innerHTML = `<div class="cargue-atenciones-suggestion-empty">No se encontraron clientes para "${escapeHtml(query)}".</div>`;
        container.style.display = 'block';
        return;
    }

    container.innerHTML = clientes.map(cliente => {
        const label = cliente.razon_social || cliente.nombre_comercial || 'Cliente sin nombre';
        const secondary = [cliente.nombre_comercial, cliente.nit].filter(Boolean).join(' | ');
        const vendedor = cliente.vendedor_nombre ? `Vendedor: ${cliente.vendedor_nombre}` : '';
        return `
            <button
                type="button"
                class="cargue-atenciones-suggestion-item"
                data-cliente-id="${Number(cliente.id)}"
                data-cliente-label="${escapeHtml(label)}"
                data-cliente-nombre-comercial="${escapeHtml(cliente.nombre_comercial || '')}"
                data-cliente-nit="${escapeHtml(cliente.nit || '')}"
            >
                <strong>${escapeHtml(label)}</strong>
                ${secondary ? `<span>${escapeHtml(secondary)}</span>` : ''}
                ${vendedor ? `<span>${escapeHtml(vendedor)}</span>` : ''}
            </button>
        `;
    }).join('');
    container.style.display = 'block';
}

function seleccionarClienteCargueAtenciones(cliente) {
    const acuerdoInput = document.getElementById('cargueAtencionesDiaFiltroAcuerdo');
    const clienteIdInput = document.getElementById('cargueAtencionesDiaFiltroClienteId');
    if (acuerdoInput) {
        const label = cliente.razon_social || cliente.nombre_comercial || '';
        acuerdoInput.value = label;
        acuerdoInput.dataset.selectedLabel = label;
    }
    if (clienteIdInput) {
        clienteIdInput.value = cliente.id || '';
    }
    hideCargueAtencionesClienteSuggestions();
}

async function cargarClientesSugeridosCargueAtenciones(query) {
    const response = await fetch(`/api/comercial/cargue-atenciones/clientes-sugeridos?q=${encodeURIComponent(query)}`, {
        credentials: 'include'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'No se pudieron cargar los clientes sugeridos');
    }
    applyCargueAtencionesDiaScopeUI(data.scope);
    updateCargueAtencionesDiaScope(data.scope);
    return Array.isArray(data.clientes) ? data.clientes : [];
}

function programarBusquedaClientesCargueAtenciones() {
    const acuerdoInput = document.getElementById('cargueAtencionesDiaFiltroAcuerdo');
    if (!acuerdoInput) return;

    const currentValue = acuerdoInput.value.trim();
    const selectedLabel = (acuerdoInput.dataset.selectedLabel || '').trim();
    if (!currentValue) {
        clearCargueAtencionesClienteSelection(false);
        hideCargueAtencionesClienteSuggestions();
        return;
    }

    if (!selectedLabel || currentValue !== selectedLabel) {
        clearCargueAtencionesClienteSelection(true);
    }

    window.clearTimeout(window.cargueAtencionesDiaState.clienteSearchTimer);
    window.cargueAtencionesDiaState.clienteSearchTimer = window.setTimeout(async () => {
        try {
            const clientes = await cargarClientesSugeridosCargueAtenciones(currentValue);
            renderCargueAtencionesClienteSuggestions(clientes, currentValue);
        } catch (error) {
            console.error('Error cargando sugerencias de clientes para atenciones:', error);
            hideCargueAtencionesClienteSuggestions();
        }
    }, 180);
}

function openCargueAtencionesDiaModal() {
    const modal = document.getElementById('cargueAtencionesDiaModal');
    if (modal) {
        modal.classList.add('active');
    }
}

function setIngresoInformacionSection(section = 'inicio') {
    const normalized = String(section || 'inicio');
    window.cargueAtencionesDiaState.activeSection = normalized;

    const panelMap = {
        inicio: ['ingresoInfoInicioPanel'],
        catalogo: ['ingresoInfoCatalogoPanel'],
        cargue_atenciones: ['ingresoInfoCarguePanel', 'ingresoInfoHistorialPanel'],
        prefacturas: ['ingresoInfoPrefacturasPanel'],
        consulta_prefacturas: ['ingresoInfoConsultaPrefacturasPanel'],
        cartera: ['ingresoInfoCarteraPanel'],
        consulta: ['ingresoInfoConsultaPanel']
    };
    const buttonMap = {
        inicio: 'ingresoInfoNavInicio',
        catalogo: 'ingresoInfoNavCatalogo',
        cargue_atenciones: 'ingresoInfoNavCargueAtenciones',
        prefacturas: 'ingresoInfoNavPrefacturas',
        consulta_prefacturas: 'ingresoInfoNavConsultaPrefacturas',
        cartera: 'ingresoInfoNavCartera',
        consulta: 'ingresoInfoNavConsulta'
    };

    Object.values(panelMap).flat().forEach(id => {
        const panel = document.getElementById(id);
        if (panel) panel.style.display = 'none';
    });
    Object.values(buttonMap).forEach(id => {
        const button = document.getElementById(id);
        if (button) button.classList.remove('active');
    });

    (panelMap[normalized] || panelMap.inicio).forEach(id => {
        const panel = document.getElementById(id);
        if (panel) panel.style.display = '';
    });
    const activeButton = document.getElementById(buttonMap[normalized] || buttonMap.inicio);
    if (activeButton) activeButton.classList.add('active');

    hideCargueAtencionesClienteSuggestions();

    if (normalized === 'inicio') {
        return;
    }

    if (normalized === 'catalogo') {
        cargarTablaCatalogo();
        return;
    }

    if (normalized === 'cargue_atenciones') {
        const canUpload = canManageComercial('atenciones', 'create');
        updateCargueAtencionesDiaScope('', canUpload ? '' : 'Tu perfil puede consultar, pero no cargar archivos.');
        actualizarSelectoresPeriodosComercial();
        cargarHistorialCarguesAtenciones();
        return;
    }

    if (normalized === 'prefacturas' || normalized === 'consulta_prefacturas') {
        actualizarSelectoresPeriodosComercial();
    }

    if (normalized === 'consulta') {
        actualizarSelectoresPeriodosComercial();
        if (!hasActiveFiltersCargueAtencionesDia()) {
            resetConsultaAtencionesDia('Ingresa uno o varios criterios para consultar atenciones cargadas.');
        }
        cargarHistorialCarguesAtenciones();
    }
}

// ---------------------------------------------------------------------------
// PREFACTURAS
// ---------------------------------------------------------------------------
async function generarPrefacturas() {
    const fechaDesde = (document.getElementById('prefacturaFechaDesde') || {}).value || '';
    const fechaHasta = (document.getElementById('prefacturaFechaHasta') || {}).value || '';
    const resultado  = document.getElementById('prefacturasResultado');
    const btn        = document.getElementById('btnGenerarPrefacturas');
    const label      = document.getElementById('btnGenerarPrefacturasLabel');

    if (!fechaDesde || !fechaHasta) {
        if (resultado) resultado.innerHTML = '<span style="color:#c0392b;">&#9888; Debes seleccionar fecha inicio y fecha fin.</span>';
        return;
    }
    if (fechaDesde > fechaHasta) {
        if (resultado) resultado.innerHTML = '<span style="color:#c0392b;">&#9888; La fecha inicio no puede ser mayor que la fecha fin.</span>';
        return;
    }

    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Generando\u2026';
    if (resultado) resultado.innerHTML = '<span style="color:#555;">Consultando atenciones y generando archivos\u2026</span>';

    try {
        const params = new URLSearchParams({ fecha_desde: fechaDesde, fecha_hasta: fechaHasta });

        const response = await fetch(`/api/comercial/prefacturas/generar?${params}`, {
            method: 'GET',
            credentials: 'same-origin',
        });

        if (!response.ok) {
            let msg = 'Error generando prefacturas.';
            try { const data = await response.json(); msg = data.error || msg; } catch (_) {}
            if (resultado) resultado.innerHTML = `<span style="color:#c0392b;">&#9888; ${msg}</span>`;
            return;
        }

        const disposition = response.headers.get('Content-Disposition') || '';
        let filename = 'Prefacturas.zip';
        const match = disposition.match(/filename[^;=\n]*=(?:(['"])([^'"]*)\1|([^;\n]*))/i);
        if (match) filename = (match[2] || match[3] || filename).trim();

        const blob = await response.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);

        if (resultado) resultado.innerHTML = `<span style="color:#27ae60;">&#10004; Descarga iniciada: <strong>${filename}</strong></span>`;
    } catch (err) {
        console.error('generarPrefacturas error:', err);
        if (resultado) resultado.innerHTML = '<span style="color:#c0392b;">&#9888; Error de conexi\u00f3n al generar prefacturas.</span>';
    } finally {
        if (btn) btn.disabled = false;
        if (label) label.textContent = 'Generar y Descargar ZIP';
    }
}

function abrirCargueAtencionDia() {
    if (!canManageComercial('atenciones', 'read') && !canManageComercial('atenciones', 'create')) {
        showError('No tienes permisos para consultar o cargar atenciones comerciales.');
        return;
    }

    // Ocultar explícitamente todos los paneles antes de abrir
    [
        'ingresoInfoInicioPanel', 'ingresoInfoCarguePanel', 'ingresoInfoHistorialPanel',
        'ingresoInfoPrefacturasPanel', 'ingresoInfoConsultaPrefacturasPanel',
        'ingresoInfoCarteraPanel', 'ingresoInfoConsultaPanel',
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    openCargueAtencionesDiaModal();

    const submitButton = document.getElementById('cargueAtencionesDiaSubmit');
    const fileInput = document.getElementById('cargueAtencionesDiaArchivo');
    const canUpload = canManageComercial('atenciones', 'create');
    if (submitButton) submitButton.disabled = !canUpload;
    if (fileInput) fileInput.disabled = !canUpload;

    applyCargueAtencionesDiaScopeUI('');
    updateCargueAtencionesDiaScope('', '');
    hideCargueAtencionesClienteSuggestions();
    resetConsultaAtencionesDia('Ingresa uno o varios criterios para consultar atenciones cargadas.');
    setIngresoInformacionSection('inicio');
}

function closeCargueAtencionDia() {
    const modal = document.getElementById('cargueAtencionesDiaModal');
    if (modal) {
        modal.classList.remove('active');
    }
    hideCargueAtencionesClienteSuggestions();
    setIngresoInformacionSection('inicio');
}

function limpiarFiltrosCargueAtencionDia() {
    const ids = [
        'cargueAtencionesDiaFiltroAcuerdo',
        'cargueAtencionesDiaFiltroVendedor',
        'cargueAtencionesDiaFiltroCondicionComercial',
        'cargueAtencionesDiaFiltroEstado',
        'cargueAtencionesDiaFiltroPeriodo',
        'cargueAtencionesDiaFechaDesde',
        'cargueAtencionesDiaFechaHasta'
    ];
    ids.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = '';
    });
    clearCargueAtencionesClienteSelection(false);
    hideCargueAtencionesClienteSuggestions();
    resetConsultaAtencionesDia('Ingresa uno o varios criterios para consultar atenciones cargadas.');
}

async function cargarHistorialCarguesAtenciones() {
    const tbody = document.getElementById('cargueAtencionesDiaHistorialTable');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" class="loading">Cargando historial...</td></tr>';
    try {
        const response = await fetch('/api/comercial/cargue-atenciones/historial', { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'No se pudo cargar el historial de cargues');
        }

        const registros = Array.isArray(data.registros) ? data.registros : [];
        applyCargueAtencionesDiaScopeUI(data.scope);
        updateCargueAtencionesDiaScope(data.scope);

        if (!registros.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">No hay cargues visibles para este usuario.</td></tr>';
            return;
        }

        tbody.innerHTML = registros.map(item => `
            <tr>
                <td>${escapeHtml(item.fecha || 'N/A')}</td>
                <td>${escapeHtml(item.periodo || 'Sin periodo')}</td>
                <td>${escapeHtml(item.nombre_archivo || 'N/A')}</td>
                <td>${Number(item.total_filas || 0)}</td>
                <td>${item.importadas == null ? 'N/A' : Number(item.importadas || 0)}</td>
                <td>${escapeHtml(item.usuario || 'Sistema')}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando historial de atenciones del día:', error);
        tbody.innerHTML = `<tr><td colspan="6" class="loading">${escapeHtml(error.message || 'Error al cargar historial')}</td></tr>`;
    }
}

async function consultarAtencionesDiaCargadas(page = 1) {
    const results = document.getElementById('cargueAtencionesDiaResults');
    const resumen = document.getElementById('cargueAtencionesDiaResumen');
    const pageInfo = document.getElementById('cargueAtencionesDiaPageInfo');
    const prevBtn = document.getElementById('cargueAtencionesDiaPrevBtn');
    const nextBtn = document.getElementById('cargueAtencionesDiaNextBtn');
    if (!results || !resumen || !pageInfo || !prevBtn || !nextBtn) return;

    const nextPage = Math.max(1, Number(page || 1));
    const acuerdoInput = document.getElementById('cargueAtencionesDiaFiltroAcuerdo');
    const clienteIdInput = document.getElementById('cargueAtencionesDiaFiltroClienteId');
    const vendedorWrap = document.getElementById('cargueAtencionesDiaFiltroVendedorWrap');
    if (!hasActiveFiltersCargueAtencionesDia()) {
        hideCargueAtencionesClienteSuggestions();
        resetConsultaAtencionesDia('Ingresa uno o varios criterios para consultar atenciones cargadas.');
        return;
    }

    results.innerHTML = '<div class="loading">Consultando registros...</div>';

    const params = new URLSearchParams({
        page: String(nextPage),
        per_page: String(window.cargueAtencionesDiaState.perPage || 50)
    });

    const acuerdo = acuerdoInput?.value?.trim();
    const clienteId = clienteIdInput?.value?.trim();
    const vendedor = vendedorWrap?.style.display === 'none'
        ? ''
        : (document.getElementById('cargueAtencionesDiaFiltroVendedor')?.value?.trim() || '');
    const condicionComercial = document.getElementById('cargueAtencionesDiaFiltroCondicionComercial')?.value?.trim();
    const estado = document.getElementById('cargueAtencionesDiaFiltroEstado')?.value?.trim();
    const fechaDesde = document.getElementById('cargueAtencionesDiaFechaDesde')?.value?.trim();
    const fechaHasta = document.getElementById('cargueAtencionesDiaFechaHasta')?.value?.trim();

    if (clienteId) params.set('cliente_id', clienteId);
    if (acuerdo && !clienteId) params.set('acuerdo', acuerdo);
    if (vendedor) params.set('vendedor', vendedor);
    if (condicionComercial) params.set('condicion_comercial', condicionComercial);
    if (estado) params.set('estado', estado);
    if (fechaDesde) params.set('fecha_desde', fechaDesde);
    if (fechaHasta) params.set('fecha_hasta', fechaHasta);

    try {
        const response = await fetch(`/api/comercial/cargue-atenciones/consulta?${params.toString()}`, { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'No se pudo consultar la informacion cargada');
        }

        const registros = Array.isArray(data.registros) ? data.registros : [];
        const totalOrdenes = Number(data.total_ordenes ?? data.total ?? 0);
        const totalRegistros = Number(data.total_registros ?? registros.length ?? 0);
        window.cargueAtencionesDiaState.records = registros;
        window.cargueAtencionesDiaState.page = Number(data.page || 1);
        window.cargueAtencionesDiaState.pages = Number(data.pages || 0);
        window.cargueAtencionesDiaState.total = totalOrdenes;

        applyCargueAtencionesDiaScopeUI(data.scope);
        updateCargueAtencionesDiaScope(data.scope);
        if (data.search_required) {
            resetConsultaAtencionesDia('Ingresa uno o varios criterios para consultar atenciones cargadas.');
            return;
        }

        resumen.textContent = totalOrdenes
            ? `${totalOrdenes} orden(es) encontradas · ${totalRegistros} registro(s).`
            : 'No se encontraron registros con los filtros actuales.';
        pageInfo.textContent = `Pagina ${Number(data.page || 0)} de ${Number(data.pages || 0)}`;
        prevBtn.disabled = Number(data.page || 1) <= 1;
        nextBtn.disabled = Number(data.page || 1) >= Number(data.pages || 0) || Number(data.pages || 0) === 0;

        if (!registros.length) {
            results.innerHTML = '<div class="loading">No hay registros para mostrar.</div>';
            return;
        }

        results.innerHTML = construirResultadosAgrupadosCargueAtenciones(registros);
    } catch (error) {
        console.error('Error consultando atenciones cargadas:', error);
        resumen.textContent = error.message || 'No se pudo consultar la informacion cargada.';
        pageInfo.textContent = 'Pagina 0 de 0';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        results.innerHTML = `<div class="loading">${escapeHtml(error.message || 'Error al consultar registros')}</div>`;
    }
}

function setEditarAtencionMsg(message = '', isError = false) {
    const node = document.getElementById('editarAtencionMsg');
    if (!node) return;
    node.textContent = message;
    node.style.color = isError ? '#c0392b' : '#555';
}

function ocultarSugerenciasServicioAtencion() {
    const container = document.getElementById('editAtenServicioSuggestions');
    if (!container) return;
    container.style.display = 'none';
    container.innerHTML = '';
}

function actualizarHintServicioAtencion(message = '', isError = false) {
    const hint = document.getElementById('editAtenServicioHint');
    if (!hint) return;
    hint.textContent = message || 'Al editar una orden, los nuevos examenes o paquetes se agregan con la misma fecha de atención de esta orden.';
    hint.style.color = isError ? '#c0392b' : '#666';
}

async function cargarConvenioServicioAtencion(forceReload = false) {
    const clienteId = document.getElementById('editarAtencionClienteId')?.value?.trim() || '';
    const fechaAtencion = document.getElementById('editAtenFechaOrden')?.value?.trim() || '';
    if (!clienteId) {
        window.cargueAtencionesDiaState.draftConvenioItems = [];
        window.cargueAtencionesDiaState.draftConvenioLoadedKey = '';
        window.cargueAtencionesDiaState.draftConvenioSelectedItemId = null;
        actualizarHintServicioAtencion('Esta atención no tiene cliente relacionado para sugerir examenes o paquetes convenidos.');
        return [];
    }

    const cacheKey = `${clienteId}|${fechaAtencion || 'sin-fecha'}`;
    if (!forceReload && cacheKey === window.cargueAtencionesDiaState.draftConvenioLoadedKey) {
        return window.cargueAtencionesDiaState.draftConvenioItems || [];
    }

    const params = new URLSearchParams();
    if (fechaAtencion) params.set('fecha_atencion', fechaAtencion);

    const response = await fetch(`/api/comercial/clientes/${clienteId}/convenio-items${params.toString() ? `?${params.toString()}` : ''}`, {
        credentials: 'include'
    });
    const data = await response.json().catch(() => ([]));
    if (!response.ok) {
        throw new Error(data.error || 'No se pudieron cargar los examenes o paquetes convenidos del cliente.');
    }

    window.cargueAtencionesDiaState.draftConvenioItems = Array.isArray(data) ? data : [];
    window.cargueAtencionesDiaState.draftConvenioLoadedKey = cacheKey;
    window.cargueAtencionesDiaState.draftConvenioSelectedItemId = null;
    actualizarHintServicioAtencion(
        window.cargueAtencionesDiaState.draftConvenioItems.length
            ? 'Escribe para buscar entre los examenes y paquetes convenidos de este cliente. Al seleccionarlo, se completa el valor convenido.'
            : 'Este cliente no tiene examenes o paquetes convenidos vigentes para la fecha de esta orden.'
    );
    return window.cargueAtencionesDiaState.draftConvenioItems;
}

function seleccionarServicioConvenioAtencion(itemId) {
    const items = Array.isArray(window.cargueAtencionesDiaState.draftConvenioItems)
        ? window.cargueAtencionesDiaState.draftConvenioItems
        : [];
    const item = items.find(entry => Number(entry.id) === Number(itemId));
    if (!item) return;

    const servicioInput = document.getElementById('editAtenServicio');
    const precioInput = document.getElementById('editAtenPrecio');
    if (servicioInput) servicioInput.value = item.nombre || '';
    if (precioInput) precioInput.value = Number(item.valor_unitario || 0);
    window.cargueAtencionesDiaState.draftConvenioSelectedItemId = Number(item.id);
    actualizarHintServicioAtencion(`Seleccionado: ${item.nombre || 'Item'} (${item.tipo_item || 'ITEM'}) con valor ${formatCurrency(item.valor_unitario || 0)}. Se agregará a esta misma orden y fecha.`);
    ocultarSugerenciasServicioAtencion();
}

function renderSugerenciasServicioAtencion(query = '') {
    const container = document.getElementById('editAtenServicioSuggestions');
    if (!container) return;

    const text = String(query || '').trim().toLowerCase();
    const items = Array.isArray(window.cargueAtencionesDiaState.draftConvenioItems)
        ? window.cargueAtencionesDiaState.draftConvenioItems
        : [];

    const filtered = items.filter(item => {
        if (!text) return true;
        return [
            item?.nombre || '',
            item?.codigo || '',
            item?.clasificacion_resumen || '',
            item?.tipo_item || ''
        ].some(value => String(value).toLowerCase().includes(text));
    }).slice(0, 12);

    if (!filtered.length) {
        container.innerHTML = `<div class="cargue-atenciones-suggestion-empty">No encontramos examenes o paquetes convenidos para "${escapeHtml(query)}".</div>`;
        container.style.display = 'block';
        return;
    }

    container.innerHTML = filtered.map(item => `
        <button
            type="button"
            class="cargue-atenciones-suggestion-item"
            data-item-id="${Number(item.id)}">
            <strong>${escapeHtml(item.nombre || 'Item')}</strong>
            <span>${escapeHtml([item.tipo_item || '', item.clasificacion_resumen || item.codigo || '', formatCurrency(item.valor_unitario || 0)].filter(Boolean).join(' · '))}</span>
        </button>
    `).join('');
    container.style.display = 'block';
}

function limpiarSeleccionConvenioAtencion() {
    window.cargueAtencionesDiaState.draftConvenioSelectedItemId = null;
}

function programarBusquedaServicioAtencion() {
    const servicioInput = document.getElementById('editAtenServicio');
    const query = servicioInput?.value?.trim() || '';
    limpiarSeleccionConvenioAtencion();
    if (!query) {
        ocultarSugerenciasServicioAtencion();
        actualizarHintServicioAtencion();
        return;
    }

    window.clearTimeout(window.cargueAtencionesDiaState.convenioSearchTimer);
    window.cargueAtencionesDiaState.convenioSearchTimer = window.setTimeout(async () => {
        try {
            await cargarConvenioServicioAtencion(false);
            renderSugerenciasServicioAtencion(query);
        } catch (error) {
            console.error('Error cargando sugerencias de convenio para atenciones:', error);
            ocultarSugerenciasServicioAtencion();
            actualizarHintServicioAtencion(error.message || 'No se pudieron cargar los examenes o paquetes convenidos.', true);
        }
    }, 120);
}

function normalizarServicioAtencion(valor) {
    return String(valor || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function existeServicioDuplicadoAtencion(rows, servicio, excludeIndex = -1) {
    const servicioNormalizado = normalizarServicioAtencion(servicio);
    if (!servicioNormalizado) return false;

    return (Array.isArray(rows) ? rows : []).some((row, index) => {
        if (index === excludeIndex) return false;
        return normalizarServicioAtencion(row?.servicio) === servicioNormalizado;
    });
}

function renderServiciosBorradorAtencion() {
    const tbody = document.getElementById('editarAtencionServiciosBody');
    const totalNode = document.getElementById('editarAtencionServiciosTotal');
    if (!tbody || !totalNode) return;

    const rows = Array.isArray(window.cargueAtencionesDiaState.draftAtencionRows)
        ? window.cargueAtencionesDiaState.draftAtencionRows
        : [];

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="loading">Agrega al menos un servicio para continuar.</td></tr>';
        totalNode.textContent = 'Total paciente: $0';
        return;
    }

    let total = 0;
    tbody.innerHTML = rows.map((row, index) => {
        const valor = Number(row.precio || 0);
        const servicioValue = String(row.servicio || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        total += valor;
        return `
            <tr>
                <td><input type="text" value="${servicioValue}" oninput="actualizarFilaBorradorAtencion(${index}, 'servicio', this.value)" placeholder="Nombre del examen o servicio"></td>
                <td><input type="number" min="0" step="0.01" value="${Number.isFinite(valor) ? valor : 0}" oninput="actualizarFilaBorradorAtencion(${index}, 'precio', this.value)"></td>
                <td><button type="button" class="action-btn action-btn-delete" onclick="eliminarFilaBorradorAtencion(${index})">Quitar</button></td>
            </tr>
        `;
    }).join('');

    totalNode.textContent = `Total paciente: ${formatCurrency(total)}`;
}

function actualizarTotalServiciosBorradorAtencion() {
    const totalNode = document.getElementById('editarAtencionServiciosTotal');
    if (!totalNode) return;
    const rows = Array.isArray(window.cargueAtencionesDiaState.draftAtencionRows)
        ? window.cargueAtencionesDiaState.draftAtencionRows
        : [];
    const total = rows.reduce((acc, row) => acc + Number(row.precio || 0), 0);
    totalNode.textContent = `Total paciente: ${formatCurrency(total)}`;
}

function actualizarFilaBorradorAtencion(index, field, value) {
    const rows = window.cargueAtencionesDiaState.draftAtencionRows || [];
    if (!rows[index]) return;
    rows[index][field] = field === 'precio' ? value : String(value || '');
    if (field === 'precio') {
        actualizarTotalServiciosBorradorAtencion();
    }
}

function eliminarFilaBorradorAtencion(index) {
    const rows = window.cargueAtencionesDiaState.draftAtencionRows || [];
    rows.splice(index, 1);
    renderServiciosBorradorAtencion();
}

function agregarServicioBorradorAtencion() {
    const servicioInput = document.getElementById('editAtenServicio');
    const precioInput = document.getElementById('editAtenPrecio');
    const servicio = servicioInput?.value?.trim() || '';
    const precio = precioInput?.value || '';
    const selectedItemId = window.cargueAtencionesDiaState.draftConvenioSelectedItemId;
    const convenioItems = Array.isArray(window.cargueAtencionesDiaState.draftConvenioItems)
        ? window.cargueAtencionesDiaState.draftConvenioItems
        : [];
    const servicioNormalizado = servicio.toLowerCase();
    const convenioItem = convenioItems.find(item => Number(item.id) === Number(selectedItemId))
        || convenioItems.find(item => String(item?.nombre || '').trim().toLowerCase() === servicioNormalizado);
    const precioFinal = (precio === '' || precio === null || typeof precio === 'undefined') && convenioItem
        ? convenioItem.valor_unitario
        : precio;

    if (!servicio) {
        showError('Escribe el nombre del examen o servicio antes de agregarlo.');
        return;
    }
    if (existeServicioDuplicadoAtencion(window.cargueAtencionesDiaState.draftAtencionRows, servicio)) {
        showError('Ese examen o servicio ya existe en esta orden del paciente.');
        return;
    }
    if (precioFinal === '' || Number(precioFinal) < 0) {
        showError('Ingresa un valor valido para el servicio.');
        return;
    }

    window.cargueAtencionesDiaState.draftAtencionRows.push({
        id: null,
        servicio,
        precio: precioFinal,
        catalogo_item_id: convenioItem ? Number(convenioItem.id) : null,
        tipo_item: convenioItem?.tipo_item || '',
        fecha_creacion_orden: document.getElementById('editAtenFechaOrden')?.value || '',
        nro_orden: document.getElementById('editAtenNroOrden')?.value || ''
    });
    if (servicioInput) servicioInput.value = '';
    if (precioInput) precioInput.value = '';
    limpiarSeleccionConvenioAtencion();
    ocultarSugerenciasServicioAtencion();
    actualizarHintServicioAtencion(convenioItem
        ? `Se agregó ${convenioItem.nombre || 'el item'} con la misma fecha de atención de esta orden.`
        : 'El servicio se agregará a esta misma orden y fecha de atención.'
    );
    renderServiciosBorradorAtencion();
}

function construirGrupoEdicionAtencion(registroBase) {
    const records = Array.isArray(window.cargueAtencionesDiaState.records)
        ? window.cargueAtencionesDiaState.records
        : [];
    const orderKey = String(registroBase?.nro_orden || '');
    const docKey = String(registroBase?.nro_identificacion || '');
    const nameKey = String(registroBase?.nombre_paciente || '');

    return records.filter(item => {
        if (String(item?.nro_orden || '') !== orderKey) return false;
        if (docKey && String(item?.nro_identificacion || '') === docKey) return true;
        return !docKey && String(item?.nombre_paciente || '') === nameKey;
    });
}

function cerrarEditarAtencion() {
    document.getElementById('editarAtencionModal')?.classList.remove('active');
    window.cargueAtencionesDiaState.draftAtencionRows = [];
    window.cargueAtencionesDiaState.draftAtencionBase = null;
    window.cargueAtencionesDiaState.draftAtencionMode = 'create';
    window.cargueAtencionesDiaState.draftConvenioItems = [];
    window.cargueAtencionesDiaState.draftConvenioLoadedKey = '';
    window.cargueAtencionesDiaState.draftConvenioSelectedItemId = null;
    ocultarSugerenciasServicioAtencion();
    actualizarHintServicioAtencion();
    setEditarAtencionMsg('');
}

function poblarFormularioAtencionGestionInformacion(registro = {}, mode = 'edit') {
    const isCreate = mode === 'create';
    document.getElementById('editarAtencionTitulo').textContent = isCreate ? 'Nueva Atencion Comercial' : 'Editar Paciente en Orden Cargada';
    document.getElementById('editarAtencionId').value = registro.id || '';
    document.getElementById('editarAtencionClienteId').value = registro.cliente_id || '';
    document.getElementById('editarAtencionVendedorId').value = registro.vendedor_id || '';
    document.getElementById('editAtenNroOrden').value = registro.nro_orden || '';
    document.getElementById('editAtenFechaOrden').value = (registro.fecha_creacion_orden || '').slice(0, 10);
    document.getElementById('editAtenFormaPago').value = registro.forma_pago || '';
    document.getElementById('editAtenEstado').value = registro.estado_gestion || 'CARGADA';
    document.getElementById('editAtenNroId').value = registro.nro_identificacion || '';
    document.getElementById('editAtenNombrePaciente').value = registro.nombre_paciente || '';
    document.getElementById('editAtenServicio').value = '';
    document.getElementById('editAtenPrecio').value = '';
    limpiarSeleccionConvenioAtencion();
    ocultarSugerenciasServicioAtencion();
    document.getElementById('editAtenNroFactura').value = registro.nro_factura || '';
    document.getElementById('editAtenFechaFactura').value = registro.fecha_factura || '';
    document.getElementById('editAtenAcuerdo').value = registro.acuerdo_comercial || '';
    document.getElementById('editAtenEmpresaMision').value = registro.empresa_mision || '';
    document.getElementById('editAtenSede').value = registro.sede || '';
    document.getElementById('editAtenNombreVendedor').value = registro.nombre_vendedor || registro.vendedor_responsable || '';
    document.getElementById('editAtenUsuarioCreacion').value = registro.usuario_creacion || '';
    actualizarHintServicioAtencion(registro.cliente_id
        ? 'Escribe para buscar entre los examenes y paquetes convenidos de este cliente. Al seleccionarlo, se completa el valor convenido.'
        : 'Esta atención no tiene cliente relacionado para sugerir examenes o paquetes convenidos.'
    );
    setEditarAtencionMsg(isCreate
        ? 'Completa los datos del paciente y agrega uno o varios servicios.'
        : 'Se editaran todos los examenes o servicios de este paciente mientras siga en estado CARGADA.');
    renderServiciosBorradorAtencion();
}

function abrirNuevaAtencionGestionInformacion() {
    if (!canManageComercial('atenciones', 'create')) {
        showError('No tienes permiso para crear atenciones comerciales.');
        return;
    }

    const orderNumber = `ATN-${Date.now()}`;
    window.cargueAtencionesDiaState.draftAtencionMode = 'create';
    window.cargueAtencionesDiaState.draftAtencionBase = {
        archivo_origen: 'REGISTRO_MANUAL_ATENCIONES'
    };
    window.cargueAtencionesDiaState.draftAtencionRows = [];
    poblarFormularioAtencionGestionInformacion({
        nro_orden: orderNumber,
        fecha_creacion_orden: getTodayIsoDate(),
        estado_gestion: 'CARGADA',
        forma_pago: '',
        precio: ''
    }, 'create');
    document.getElementById('editarAtencionModal')?.classList.add('active');
}

async function abrirEditarAtencionGestionInformacion(registroId) {
    if (!canManageComercial('atenciones', 'update')) {
        showError('No tienes permiso para editar atenciones comerciales.');
        return;
    }

    try {
        const response = await fetch(`/api/comercial/atenciones-dia/${registroId}`, { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'No se pudo cargar la atencion');
        }

        const registro = data.registro || {};
        if (!registro.es_editable) {
            showError('Solo se pueden editar atenciones en estado CARGADA.');
            return;
        }

        const grupo = construirGrupoEdicionAtencion(registro);
        window.cargueAtencionesDiaState.draftAtencionMode = 'edit';
        window.cargueAtencionesDiaState.draftAtencionBase = registro;
        window.cargueAtencionesDiaState.draftAtencionRows = (grupo.length ? grupo : [registro]).map(item => ({
            id: item.id,
            servicio: item.servicio || '',
            precio: item.precio || 0,
            archivo_origen: item.archivo_origen || registro.archivo_origen || '',
            fecha_creacion_orden: item.fecha_creacion_orden || registro.fecha_creacion_orden || '',
            nro_orden: item.nro_orden || registro.nro_orden || ''
        }));
        poblarFormularioAtencionGestionInformacion(registro, 'edit');
        try {
            await cargarConvenioServicioAtencion(true);
        } catch (convenioError) {
            console.error('Error cargando convenio para la orden editada:', convenioError);
            actualizarHintServicioAtencion(convenioError.message || 'No se pudieron cargar los examenes o paquetes convenidos.', true);
        }
        document.getElementById('editarAtencionModal')?.classList.add('active');
    } catch (error) {
        console.error('Error cargando atencion para edicion:', error);
        showError(error.message || 'No fue posible cargar la atencion.');
    }
}

async function guardarEdicionAtencion() {
    const pendingService = document.getElementById('editAtenServicio')?.value?.trim() || '';
    if (pendingService) {
        agregarServicioBorradorAtencion();
        if ((document.getElementById('editAtenServicio')?.value?.trim() || '') !== '') {
            setEditarAtencionMsg('Revisa el servicio pendiente antes de guardar.', true);
            return;
        }
    }

    const isCreate = window.cargueAtencionesDiaState.draftAtencionMode === 'create';
    const rows = Array.isArray(window.cargueAtencionesDiaState.draftAtencionRows)
        ? window.cargueAtencionesDiaState.draftAtencionRows
        : [];
    if (isCreate && !canManageComercial('atenciones', 'create')) {
        showError('No tienes permiso para crear atenciones comerciales.');
        return;
    }
    if (!isCreate && !canManageComercial('atenciones', 'update')) {
        showError('No tienes permiso para editar atenciones comerciales.');
        return;
    }
    if (!rows.length) {
        setEditarAtencionMsg('Agrega al menos un examen o servicio antes de guardar.', true);
        return;
    }
    if (rows.some(row => !String(row.servicio || '').trim())) {
        setEditarAtencionMsg('Todos los servicios deben tener nombre.', true);
        return;
    }
    const serviciosDuplicados = rows.some((row, index) =>
        existeServicioDuplicadoAtencion(rows, row.servicio, index)
    );
    if (serviciosDuplicados) {
        setEditarAtencionMsg('No puedes guardar servicios repetidos dentro de la misma orden.', true);
        return;
    }
    if (rows.some(row => row.precio === '' || Number(row.precio) < 0)) {
        setEditarAtencionMsg('Todos los servicios deben tener un valor valido.', true);
        return;
    }

    const draftBase = window.cargueAtencionesDiaState.draftAtencionBase || {};
    const basePayload = {
        cliente_id: document.getElementById('editarAtencionClienteId')?.value || '',
        vendedor_id: document.getElementById('editarAtencionVendedorId')?.value || '',
        nro_orden: document.getElementById('editAtenNroOrden')?.value?.trim() || '',
        fecha_creacion_orden: document.getElementById('editAtenFechaOrden')?.value || '',
        forma_pago: document.getElementById('editAtenFormaPago')?.value?.trim() || '',
        estado_orden: draftBase.estado_orden || '',
        nro_identificacion: document.getElementById('editAtenNroId')?.value?.trim() || '',
        nombre_paciente: document.getElementById('editAtenNombrePaciente')?.value?.trim() || '',
        nro_factura: document.getElementById('editAtenNroFactura')?.value?.trim() || '',
        fecha_factura: document.getElementById('editAtenFechaFactura')?.value || '',
        acuerdo_comercial: document.getElementById('editAtenAcuerdo')?.value?.trim() || '',
        empresa_mision: document.getElementById('editAtenEmpresaMision')?.value?.trim() || '',
        sede: document.getElementById('editAtenSede')?.value?.trim() || '',
        nombre_vendedor: document.getElementById('editAtenNombreVendedor')?.value?.trim() || '',
        usuario_creacion: document.getElementById('editAtenUsuarioCreacion')?.value?.trim() || '',
        archivo_origen: draftBase.archivo_origen || 'REGISTRO_MANUAL_ATENCIONES',
        estado_gestion: 'CARGADA'
    };

    setEditarAtencionMsg('Guardando...');

    try {
        if (isCreate) {
            for (const row of rows) {
                const response = await fetch('/api/comercial/atenciones-dia', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        ...basePayload,
                        nro_orden: row.nro_orden || basePayload.nro_orden,
                        fecha_creacion_orden: row.fecha_creacion_orden || basePayload.fecha_creacion_orden,
                        servicio: String(row.servicio || '').trim(),
                        precio: row.precio
                    })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    setEditarAtencionMsg(data.error || 'No se pudo guardar la atencion.', true);
                    return;
                }
            }
        } else {
            const existingRows = rows.filter(row => row.id);
            const groupRows = construirGrupoEdicionAtencion(draftBase);
            const originalIds = new Set(groupRows.map(item => Number(item.id)));
            const keptIds = new Set(existingRows.map(item => Number(item.id)));

            for (const row of existingRows) {
                const response = await fetch(`/api/comercial/atenciones-dia/${row.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        ...basePayload,
                        servicio: String(row.servicio || '').trim(),
                        precio: row.precio
                    })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    setEditarAtencionMsg(data.error || 'No se pudo actualizar la atencion.', true);
                    return;
                }
            }

            for (const row of rows.filter(row => !row.id)) {
                const response = await fetch('/api/comercial/atenciones-dia', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        ...basePayload,
                        nro_orden: row.nro_orden || basePayload.nro_orden,
                        fecha_creacion_orden: row.fecha_creacion_orden || basePayload.fecha_creacion_orden,
                        servicio: String(row.servicio || '').trim(),
                        precio: row.precio
                    })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    setEditarAtencionMsg(data.error || 'No se pudo agregar el servicio.', true);
                    return;
                }
            }

            for (const originalId of Array.from(originalIds)) {
                if (keptIds.has(originalId)) continue;
                const response = await fetch(`/api/comercial/atenciones-dia/${originalId}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    setEditarAtencionMsg(data.error || 'No se pudo eliminar un servicio de la atencion cargada.', true);
                    return;
                }
            }
        }

        cerrarEditarAtencion();
        showSuccess(isCreate ? 'Atencion creada en estado CARGADA.' : 'Atencion CARGADA actualizada.');
        if (hasActiveFiltersCargueAtencionesDia()) {
            await consultarAtencionesDiaCargadas(window.cargueAtencionesDiaState.page || 1);
        }
    } catch (error) {
        console.error('Error guardando atencion de gestion informacion:', error);
        setEditarAtencionMsg(error.message || 'Error de conexion al guardar la atencion.', true);
    }
}

async function eliminarAtencionGestionInformacion(registroId) {
    if (!canManageComercial('atenciones', 'delete')) {
        showError('No tienes permiso para eliminar atenciones comerciales.');
        return;
    }
    const registro = (window.cargueAtencionesDiaState.records || []).find(item => Number(item.id) === Number(registroId));
    if (registro && !(registro.es_editable === true || String(registro.estado_gestion || '').toUpperCase() === 'CARGADA')) {
        showError('Solo se pueden eliminar atenciones en estado CARGADA.');
        return;
    }
    if (!confirm('Desea eliminar esta atencion?')) {
        return;
    }

    try {
        const response = await fetch(`/api/comercial/atenciones-dia/${registroId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'No se pudo eliminar la atencion');
        }

        showSuccess('Atencion eliminada.');
        if (hasActiveFiltersCargueAtencionesDia()) {
            await consultarAtencionesDiaCargadas(window.cargueAtencionesDiaState.page || 1);
        } else {
            resetConsultaAtencionesDia('Ingresa uno o varios criterios para consultar atenciones cargadas.');
        }
    } catch (error) {
        console.error('Error eliminando atencion de gestion informacion:', error);
        showError(error.message || 'Error de conexion al eliminar la atencion.');
    }
}

async function subirArchivoAtencionesDia(event) {
    event.preventDefault();
    if (!canManageComercial('atenciones', 'create')) {
        showError('No tienes permiso para cargar atenciones comerciales.');
        return;
    }

    const input = document.getElementById('cargueAtencionesDiaArchivo');
    const resultado = document.getElementById('cargueAtencionesDiaResultado');
    const submitButton = document.getElementById('cargueAtencionesDiaSubmit');
    const periodoDesde = document.getElementById('cargueAtencionesDiaPeriodoDesde')?.value || '';
    const periodoHasta = document.getElementById('cargueAtencionesDiaPeriodoHasta')?.value || '';
    const archivos = Array.from(input?.files || []);

    if (!archivos.length) {
        showError('Debes seleccionar al menos un archivo .xlsx antes de cargar.');
        return;
    }
    if (!periodoDesde || !periodoHasta) {
        showError('Debes indicar el periodo inicial del cargue antes de subir los archivos.');
        return;
    }
    if (periodoDesde > periodoHasta) {
        showError('El periodo inicial no puede tener una fecha final menor que la inicial.');
        return;
    }

    if (submitButton) submitButton.disabled = true;
    if (resultado) resultado.textContent = `Procesando ${archivos.length} archivo(s)...`;

    const resumenLineas = [];
    let totalImportadas = 0, totalDuplicadas = 0, totalErrores = 0;

    for (let idx = 0; idx < archivos.length; idx++) {
        const archivo = archivos[idx];
        if (resultado) resultado.textContent = `Procesando archivo ${idx + 1} de ${archivos.length}: ${archivo.name}...`;

        const formData = new FormData();
        formData.append('archivo', archivo);
        formData.append('periodo_desde', periodoDesde);
        formData.append('periodo_hasta', periodoHasta);

        try {
            const response = await fetch('/api/comercial/cargue-atenciones', {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                resumenLineas.push(`❌ ${archivo.name}: ${data.error || 'Error desconocido'}`);
                totalErrores++;
                continue;
            }
            const imp  = Number(data.importadas || 0);
            const dup  = Number(data.duplicadas || 0);
            const err  = Number(data.errores || 0);
            totalImportadas += imp;
            totalDuplicadas += dup;
            totalErrores    += err;
            resumenLineas.push(`✔ ${archivo.name}: ${imp} importadas · ${dup} duplicadas · ${err} con error`);
        } catch (error) {
            resumenLineas.push(`❌ ${archivo.name}: ${error.message || 'Error de conexión'}`);
            totalErrores++;
        }
    }

    if (resultado) resultado.innerHTML =
        resumenLineas.join('<br>') +
        `<br><strong>Total: ${totalImportadas} importadas · ${totalDuplicadas} duplicadas · ${totalErrores} con error</strong>`;

    if (input) input.value = '';
    const periodoDesdeInput = document.getElementById('cargueAtencionesDiaPeriodoDesde');
    const periodoHastaInput = document.getElementById('cargueAtencionesDiaPeriodoHasta');
    if (periodoDesdeInput) periodoDesdeInput.value = '';
    if (periodoHastaInput) periodoHastaInput.value = '';
    showSuccess(`Cargue completado: ${archivos.length} archivo(s) procesado(s).`);
    window.comercialPeriodosCargueState.loaded = false;
    await cargarHistorialCarguesAtenciones();
    await actualizarSelectoresPeriodosComercial(true);
    if (hasActiveFiltersCargueAtencionesDia()) {
        await consultarAtencionesDiaCargadas(1);
    } else {
        resetConsultaAtencionesDia('Ingresa uno o varios criterios para consultar atenciones cargadas.');
    }

    if (submitButton) submitButton.disabled = false;
}

function setAnticipoProgramadoMsg(message = '', isError = false) {
    const node = document.getElementById('anticipoProgramadoMsg');
    if (!node) return;
    node.textContent = message;
    node.style.color = isError ? '#c0392b' : '#555';
}

function limpiarSeleccionEmpresaAnticipo(preserveText = true) {
    const empresaInput = document.getElementById('anticipoEmpresaInput');
    const clienteIdInput = document.getElementById('anticipoClienteId');
    const condicionInput = document.getElementById('anticipoCondicionCliente');
    if (clienteIdInput) clienteIdInput.value = '';
    if (empresaInput) {
        empresaInput.dataset.selectedLabel = '';
        if (!preserveText) empresaInput.value = '';
    }
    if (condicionInput) condicionInput.value = '';
    window.anticipoProgramadoState.clienteId = '';
    window.anticipoProgramadoState.cliente = null;
    window.anticipoProgramadoState.convenioItems = [];
    window.anticipoProgramadoState.convenioLoadedKey = '';
    window.anticipoProgramadoState.selectedItemId = null;
    actualizarHintItemAnticipo('Selecciona primero la empresa y la fecha para consultar el convenio vigente.');
}

function ocultarSugerenciasEmpresaAnticipo() {
    const container = document.getElementById('anticipoEmpresaSuggestions');
    if (!container) return;
    container.style.display = 'none';
    container.innerHTML = '';
}

function ocultarSugerenciasItemAnticipo() {
    const container = document.getElementById('anticipoItemSuggestions');
    if (!container) return;
    container.style.display = 'none';
    container.innerHTML = '';
}

function actualizarHintItemAnticipo(message = '', isError = false) {
    const hint = document.getElementById('anticipoItemHint');
    if (!hint) return;
    hint.textContent = message || 'Selecciona primero la empresa y la fecha para consultar el convenio vigente.';
    hint.style.color = isError ? '#c0392b' : '#666';
}

function obtenerClientesAnticipoDisponibles() {
    const clientes = Array.isArray(clientesComercialesData) ? clientesComercialesData : [];
    return clientes.filter(cliente => {
        const condicion = String(cliente?.condicion_comercial || '').toUpperCase();
        const estado = obtenerEstadoCliente(cliente);
        return (condicion === 'EFECTIVO' || condicion === 'MIXTO') && estado !== 'INACTIVO';
    });
}

function renderSugerenciasEmpresaAnticipo(clientes, query = '') {
    const container = document.getElementById('anticipoEmpresaSuggestions');
    if (!container) return;

    if (!Array.isArray(clientes) || !clientes.length) {
        container.innerHTML = `<div class="cargue-atenciones-suggestion-empty">No se encontraron empresas para "${escapeHtml(query)}".</div>`;
        container.style.display = 'block';
        return;
    }

    container.innerHTML = clientes.slice(0, 12).map(cliente => {
        const label = cliente.razon_social || cliente.nombre_comercial || cliente.nit || 'Cliente sin nombre';
        const secondary = [
            cliente.nombre_comercial,
            cliente.nit,
            cliente.condicion_comercial
        ].filter(Boolean).join(' | ');
        return `
            <button
                type="button"
                class="cargue-atenciones-suggestion-item"
                data-cliente-id="${Number(cliente.id)}">
                <strong>${escapeHtml(label)}</strong>
                ${secondary ? `<span>${escapeHtml(secondary)}</span>` : ''}
            </button>
        `;
    }).join('');
    container.style.display = 'block';
}

async function buscarEmpresasAnticipoProgramado(query = '') {
    const text = String(query || '').trim();
    if (!text) {
        ocultarSugerenciasEmpresaAnticipo();
        return;
    }

    await ensureClientesComercialesLoaded();
    const normalizedQuery = normalizarBusquedaBasica(text);
    const sugerencias = obtenerClientesAnticipoDisponibles().filter(cliente => {
        const values = [
            cliente?.razon_social || '',
            cliente?.nombre_comercial || '',
            cliente?.nit || ''
        ];
        return values.some(value => normalizarBusquedaBasica(value).includes(normalizedQuery));
    });
    renderSugerenciasEmpresaAnticipo(sugerencias, text);
}

function seleccionarEmpresaAnticipo(clienteId) {
    const cliente = obtenerClientesAnticipoDisponibles().find(item => Number(item.id) === Number(clienteId));
    if (!cliente) return;

    const label = cliente.razon_social || cliente.nombre_comercial || cliente.nit || '';
    const empresaInput = document.getElementById('anticipoEmpresaInput');
    const clienteIdInput = document.getElementById('anticipoClienteId');
    const condicionInput = document.getElementById('anticipoCondicionCliente');
    if (empresaInput) {
        empresaInput.value = label;
        empresaInput.dataset.selectedLabel = label;
    }
    if (clienteIdInput) clienteIdInput.value = String(cliente.id);
    if (condicionInput) condicionInput.value = cliente.condicion_comercial || '';

    window.anticipoProgramadoState.clienteId = String(cliente.id);
    window.anticipoProgramadoState.cliente = cliente;
    window.anticipoProgramadoState.convenioItems = [];
    window.anticipoProgramadoState.convenioLoadedKey = '';
    window.anticipoProgramadoState.selectedItemId = null;
    ocultarSugerenciasEmpresaAnticipo();
    actualizarHintItemAnticipo('Empresa seleccionada. Escribe el examen o paquete para buscar entre los items convenidos.');
    cargarConvenioAnticipoProgramado(true).catch(error => {
        console.error('Error cargando convenio del anticipo:', error);
        actualizarHintItemAnticipo(error.message || 'No se pudieron cargar los items convenidos del cliente.', true);
    });
}

async function cargarConvenioAnticipoProgramado(forceReload = false) {
    const clienteId = window.anticipoProgramadoState.clienteId || document.getElementById('anticipoClienteId')?.value || '';
    const fechaAtencion = document.getElementById('anticipoFechaAtencion')?.value || '';
    if (!clienteId) {
        window.anticipoProgramadoState.convenioItems = [];
        window.anticipoProgramadoState.convenioLoadedKey = '';
        actualizarHintItemAnticipo('Selecciona primero la empresa y la fecha para consultar el convenio vigente.');
        return [];
    }
    if (!fechaAtencion) {
        window.anticipoProgramadoState.convenioItems = [];
        window.anticipoProgramadoState.convenioLoadedKey = '';
        actualizarHintItemAnticipo('Indica la fecha programada para cargar el convenio vigente del cliente.');
        return [];
    }

    const cacheKey = `${clienteId}|${fechaAtencion}`;
    if (!forceReload && cacheKey === window.anticipoProgramadoState.convenioLoadedKey) {
        return window.anticipoProgramadoState.convenioItems || [];
    }

    const params = new URLSearchParams({ fecha_atencion: fechaAtencion });
    const response = await fetch(`/api/comercial/clientes/${clienteId}/convenio-items?${params.toString()}`, {
        credentials: 'include'
    });
    const data = await response.json().catch(() => ([]));
    if (!response.ok) {
        throw new Error(data.error || 'No se pudieron cargar los items convenidos del cliente.');
    }

    window.anticipoProgramadoState.convenioItems = Array.isArray(data) ? data : [];
    window.anticipoProgramadoState.convenioLoadedKey = cacheKey;
    window.anticipoProgramadoState.selectedItemId = null;
    actualizarHintItemAnticipo(
        window.anticipoProgramadoState.convenioItems.length
            ? 'Escribe para buscar entre los examenes y paquetes convenidos. Al seleccionarlo se carga el valor negociado.'
            : 'Este cliente no tiene examenes o paquetes convenidos vigentes para la fecha seleccionada.'
    );
    return window.anticipoProgramadoState.convenioItems;
}

function seleccionarItemAnticipo(itemId) {
    const item = (window.anticipoProgramadoState.convenioItems || []).find(entry => Number(entry.id) === Number(itemId));
    if (!item) return;

    const itemInput = document.getElementById('anticipoItemInput');
    const valorInput = document.getElementById('anticipoItemValor');
    if (itemInput) itemInput.value = item.nombre || '';
    if (valorInput) valorInput.value = Number(item.valor_unitario || 0);
    window.anticipoProgramadoState.selectedItemId = Number(item.id);
    actualizarHintItemAnticipo(`Seleccionado: ${item.nombre || 'Item'} con valor ${formatCurrency(item.valor_unitario || 0)}.`);
    ocultarSugerenciasItemAnticipo();
}

function renderSugerenciasItemAnticipo(query = '') {
    const container = document.getElementById('anticipoItemSuggestions');
    if (!container) return;

    const text = normalizarBusquedaBasica(query);
    const items = Array.isArray(window.anticipoProgramadoState.convenioItems)
        ? window.anticipoProgramadoState.convenioItems
        : [];

    const filtered = items.filter(item => {
        if (!text) return true;
        const haystack = [
            item?.nombre || '',
            item?.codigo || '',
            item?.tipo_item || '',
            item?.clasificacion_resumen || '',
            ...(Array.isArray(item?.componentes) ? item.componentes : [])
        ].map(normalizarBusquedaBasica).join(' ');
        return haystack.includes(text);
    });

    if (!filtered.length) {
        container.innerHTML = `<div class="cargue-atenciones-suggestion-empty">No hay coincidencias para "${escapeHtml(query)}".</div>`;
        container.style.display = 'block';
        return;
    }

    container.innerHTML = filtered.slice(0, 12).map(item => `
        <button type="button" class="cargue-atenciones-suggestion-item" data-item-id="${Number(item.id)}">
            <strong>${escapeHtml(item.nombre || 'Item sin nombre')}</strong>
            <span>${escapeHtml([item.tipo_item, item.clasificacion_resumen].filter(Boolean).join(' | '))}</span>
            <span>${escapeHtml(`Valor: ${formatCurrency(item.valor_unitario || 0)}`)}</span>
            ${item.tipo_item === 'PAQUETE' && Array.isArray(item.componentes) && item.componentes.length
                ? `<span>${escapeHtml(`Incluye: ${item.componentes.join(', ')}`)}</span>`
                : ''}
        </button>
    `).join('');
    container.style.display = 'block';
}

function programarBusquedaItemAnticipo() {
    const input = document.getElementById('anticipoItemInput');
    if (!input) return;

    const currentValue = input.value.trim();
    const valorInput = document.getElementById('anticipoItemValor');
    window.clearTimeout(window.anticipoProgramadoState.itemSearchTimer);
    if (!currentValue) {
        window.anticipoProgramadoState.selectedItemId = null;
        if (valorInput) valorInput.value = '';
        ocultarSugerenciasItemAnticipo();
        return;
    }

    window.anticipoProgramadoState.selectedItemId = null;
    if (valorInput) valorInput.value = '';
    window.anticipoProgramadoState.itemSearchTimer = window.setTimeout(async () => {
        try {
            await cargarConvenioAnticipoProgramado();
            renderSugerenciasItemAnticipo(currentValue);
        } catch (error) {
            console.error('Error buscando items de anticipo:', error);
            actualizarHintItemAnticipo(error.message || 'No se pudieron consultar los items convenidos.', true);
            ocultarSugerenciasItemAnticipo();
        }
    }, 160);
}

function existeDetalleDuplicadoAnticipo(pacienteDocumento, itemId, fechaProgramada = '') {
    return (window.anticipoProgramadoState.draftDetalles || []).some(detalle =>
        String(detalle.paciente_documento || '').trim().toUpperCase() === String(pacienteDocumento || '').trim().toUpperCase()
        && Number(detalle.catalogo_item_id) === Number(itemId)
        && String(detalle.fecha_programada || '').trim() === String(fechaProgramada || '').trim()
    );
}

function renderDetalleAnticipoProgramado() {
    const tbody = document.getElementById('anticipoDetalleTable');
    const totalNode = document.getElementById('anticipoTotalResumen');
    const valorPagoInput = document.getElementById('anticipoValorPago');
    if (!tbody || !totalNode) return;

    const detalles = Array.isArray(window.anticipoProgramadoState.draftDetalles)
        ? window.anticipoProgramadoState.draftDetalles
        : [];

    if (!detalles.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Agrega uno o mÃ¡s pacientes con sus examenes o paquetes convenidos.</td></tr>';
        totalNode.textContent = 'Total programado: $0';
        if (valorPagoInput && !window.anticipoProgramadoState.paymentValueTouched) {
            valorPagoInput.value = '';
        }
        return;
    }

    let total = 0;
    tbody.innerHTML = detalles.map((detalle, index) => {
        total += Number(detalle.valor_unitario || 0);
        return `
            <tr>
                <td>${escapeHtml(detalle.fecha_programada || 'N/A')}</td>
                <td>${escapeHtml(detalle.paciente_documento || 'N/A')}</td>
                <td>${escapeHtml(detalle.paciente_nombre || 'N/A')}</td>
                <td>${escapeHtml(detalle.nombre || 'N/A')}</td>
                <td>${formatCurrency(detalle.valor_unitario || 0)}</td>
                <td><button type="button" class="action-btn action-btn-delete" onclick="eliminarDetalleAnticipoProgramado(${index})">Quitar</button></td>
            </tr>
        `;
    }).join('');
    totalNode.textContent = `Total programado: ${formatCurrency(total)}`;
    if (valorPagoInput && (!window.anticipoProgramadoState.paymentValueTouched || !valorPagoInput.value)) {
        valorPagoInput.value = total > 0 ? String(total) : '';
    }
}

function limpiarFormularioDetalleAnticipo() {
    const ids = ['anticipoPacienteDocumento', 'anticipoPacienteNombre', 'anticipoItemInput', 'anticipoItemValor'];
    ids.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = '';
    });
    window.anticipoProgramadoState.selectedItemId = null;
    ocultarSugerenciasItemAnticipo();
}

function actualizarAyudaPagoAnticipo() {
    const medioPago = document.getElementById('anticipoMedioPago')?.value || 'EFECTIVO';
    const canalSelect = document.getElementById('anticipoCanalPago');
    const hint = document.getElementById('anticipoComprobanteHint');
    if (canalSelect) {
        canalSelect.disabled = medioPago !== 'TRANSFERENCIA';
        if (medioPago !== 'TRANSFERENCIA') {
            canalSelect.value = '';
        }
    }
    if (hint) {
        hint.textContent = medioPago === 'TRANSFERENCIA'
            ? 'Obligatorio cuando el pago anticipado se registra por transferencia.'
            : 'Opcional. Puedes adjuntar soporte si deseas dejar evidencia adicional.';
    }
}

async function abrirProgramarAnticipoModal() {
    if (!canManageComercial('atenciones', 'create') && !canManageComercial('documentos', 'create') && !canManageComercial('pagos', 'create')) {
        showError('No tienes permiso para programar anticipos comerciales.');
        return;
    }
    try {
        await ensureClientesComercialesLoaded();
    } catch (error) {
        console.error('Error cargando clientes para anticipos:', error);
    }

    window.anticipoProgramadoState = {
        empresaSearchTimer: null,
        itemSearchTimer: null,
        clienteId: '',
        cliente: null,
        convenioItems: [],
        convenioLoadedKey: '',
        selectedItemId: null,
        draftDetalles: [],
        paymentValueTouched: false
    };

    document.getElementById('programarAnticipoForm')?.reset();
    document.getElementById('anticipoFechaAtencion').value = getTodayIsoDate();
    document.getElementById('anticipoFechaPago').value = getTodayIsoDate();
    setAnticipoProgramadoMsg('');
    actualizarAyudaPagoAnticipo();
    renderDetalleAnticipoProgramado();
    actualizarHintItemAnticipo('Selecciona primero la empresa y la fecha para consultar el convenio vigente.');
    document.getElementById('programarAnticipoModal')?.classList.add('active');
}

function cerrarProgramarAnticipoModal() {
    document.getElementById('programarAnticipoModal')?.classList.remove('active');
    ocultarSugerenciasEmpresaAnticipo();
    ocultarSugerenciasItemAnticipo();
    setAnticipoProgramadoMsg('');
}

function agregarDetalleAnticipoProgramado() {
    const pacienteDocumento = document.getElementById('anticipoPacienteDocumento')?.value.trim() || '';
    const pacienteNombre = document.getElementById('anticipoPacienteNombre')?.value.trim() || '';
    const fechaProgramada = document.getElementById('anticipoFechaAtencion')?.value || '';
    const itemId = Number(window.anticipoProgramadoState.selectedItemId || 0);
    if (!window.anticipoProgramadoState.clienteId) {
        showError('Selecciona primero la empresa para programar el anticipo.');
        return;
    }
    if (!fechaProgramada) {
        showError('Debes registrar la fecha programada antes de agregar detalles.');
        return;
    }
    if (!pacienteDocumento || !pacienteNombre) {
        showError('Debes registrar ID y nombre del paciente antes de agregar el detalle.');
        return;
    }
    if (!itemId) {
        showError('Selecciona un examen o paquete convenido de la ayuda inteligente.');
        return;
    }
    if (existeDetalleDuplicadoAnticipo(pacienteDocumento, itemId, fechaProgramada)) {
        showError('Ese examen o paquete ya fue agregado para este paciente.');
        return;
    }

    const item = (window.anticipoProgramadoState.convenioItems || []).find(entry => Number(entry.id) === itemId);
    if (!item) {
        showError('El item seleccionado ya no estÃ¡ disponible en el convenio del cliente.');
        return;
    }

    window.anticipoProgramadoState.draftDetalles.push({
        fecha_programada: fechaProgramada,
        catalogo_item_id: itemId,
        paciente_documento: pacienteDocumento,
        paciente_nombre: pacienteNombre,
        nombre: item.nombre,
        tipo_item: item.tipo_item,
        valor_unitario: Number(item.valor_unitario || 0)
    });
    renderDetalleAnticipoProgramado();
    limpiarFormularioDetalleAnticipo();
}

function eliminarDetalleAnticipoProgramado(index) {
    window.anticipoProgramadoState.draftDetalles.splice(index, 1);
    renderDetalleAnticipoProgramado();
}

async function guardarProgramarAnticipo(event) {
    event.preventDefault();

    const clienteId = window.anticipoProgramadoState.clienteId || document.getElementById('anticipoClienteId')?.value || '';
    const fechaAtencion = document.getElementById('anticipoFechaAtencion')?.value || '';
    const fechaPago = document.getElementById('anticipoFechaPago')?.value || '';
    const valorPago = document.getElementById('anticipoValorPago')?.value || '';
    const medioPago = document.getElementById('anticipoMedioPago')?.value || 'EFECTIVO';
    const comprobante = document.getElementById('anticipoComprobantePago')?.files?.[0];

    if (!clienteId) {
        showError('Selecciona la empresa a la que se le programarÃ¡ el anticipo.');
        return;
    }
    if (!fechaAtencion) {
        showError('La fecha programada es obligatoria.');
        return;
    }
    if (!(window.anticipoProgramadoState.draftDetalles || []).length) {
        showError('Agrega al menos un paciente con su examen o paquete antes de guardar.');
        return;
    }
    if (!fechaPago || !valorPago) {
        showError('Debes registrar la fecha y el valor del pago anticipado.');
        return;
    }
    if (medioPago === 'TRANSFERENCIA' && !comprobante) {
        showError('Adjunta el soporte del pago cuando el anticipo se registra por transferencia.');
        return;
    }

    setAnticipoProgramadoMsg('Guardando anticipo...');

    try {
        const formData = new FormData();
        formData.append('fecha_programada', fechaAtencion);
        formData.append('fecha_pago', fechaPago);
        formData.append('valor_pago', valorPago);
        formData.append('medio_pago', medioPago);
        formData.append('canal_transferencia', document.getElementById('anticipoCanalPago')?.value || '');
        formData.append('observaciones', document.getElementById('anticipoObservaciones')?.value.trim() || '');
        formData.append('detalles', JSON.stringify(
            (window.anticipoProgramadoState.draftDetalles || []).map(detalle => ({
                fecha_programada: detalle.fecha_programada,
                catalogo_item_id: detalle.catalogo_item_id,
                paciente_documento: detalle.paciente_documento,
                paciente_nombre: detalle.paciente_nombre
            }))
        ));
        if (comprobante) {
            formData.append('comprobante_pago', comprobante);
        }

        const response = await fetch(`/api/comercial/clientes/${clienteId}/prefacturas-manuales`, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            setAnticipoProgramadoMsg(data.error || 'No fue posible programar el anticipo.', true);
            return;
        }

        cerrarProgramarAnticipoModal();
        showSuccess('Prefactura manual de anticipo creada.');
        await consultarPrefacturas();
        if (data.prefactura?.id) {
            await abrirDetallePrefactura(data.prefactura.id);
        }
    } catch (error) {
        console.error('Error programando anticipo comercial:', error);
        setAnticipoProgramadoMsg(error.message || 'Error de conexion al programar el anticipo.', true);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('cargueAtencionesDiaForm');
    if (form && !form.dataset.boundCargueAtencionesDia) {
        form.addEventListener('submit', subirArchivoAtencionesDia);
        form.dataset.boundCargueAtencionesDia = 'true';
    }

    const acuerdoInput = document.getElementById('cargueAtencionesDiaFiltroAcuerdo');
    const suggestionsContainer = document.getElementById('cargueAtencionesDiaClienteSuggestions');
    const editServicioInput = document.getElementById('editAtenServicio');
    const editServicioSuggestions = document.getElementById('editAtenServicioSuggestions');
    const editFechaOrdenInput = document.getElementById('editAtenFechaOrden');
    if (acuerdoInput && !acuerdoInput.dataset.boundClienteSuggestions) {
        acuerdoInput.addEventListener('input', programarBusquedaClientesCargueAtenciones);
        acuerdoInput.addEventListener('focus', () => {
            if (acuerdoInput.value.trim()) {
                programarBusquedaClientesCargueAtenciones();
            }
        });
        acuerdoInput.addEventListener('blur', () => {
            window.setTimeout(hideCargueAtencionesClienteSuggestions, 150);
        });
        acuerdoInput.dataset.boundClienteSuggestions = 'true';
    }
    if (suggestionsContainer && !suggestionsContainer.dataset.boundClienteSuggestions) {
        suggestionsContainer.addEventListener('mousedown', event => {
            const button = event.target.closest('.cargue-atenciones-suggestion-item');
            if (!button) return;
            seleccionarClienteCargueAtenciones({
                id: button.dataset.clienteId,
                razon_social: button.dataset.clienteLabel,
                nombre_comercial: button.dataset.clienteNombreComercial,
                nit: button.dataset.clienteNit,
            });
        });
        suggestionsContainer.dataset.boundClienteSuggestions = 'true';
    }
    if (editServicioInput && !editServicioInput.dataset.boundAtencionConvenioSuggestions) {
        editServicioInput.addEventListener('input', programarBusquedaServicioAtencion);
        editServicioInput.addEventListener('focus', () => {
            if (editServicioInput.value.trim()) {
                programarBusquedaServicioAtencion();
            }
        });
        editServicioInput.addEventListener('blur', () => {
            window.setTimeout(ocultarSugerenciasServicioAtencion, 150);
        });
        editServicioInput.dataset.boundAtencionConvenioSuggestions = 'true';
    }
    if (editServicioSuggestions && !editServicioSuggestions.dataset.boundAtencionConvenioSuggestions) {
        editServicioSuggestions.addEventListener('mousedown', event => {
            const button = event.target.closest('.cargue-atenciones-suggestion-item');
            if (!button) return;
            seleccionarServicioConvenioAtencion(button.dataset.itemId);
        });
        editServicioSuggestions.dataset.boundAtencionConvenioSuggestions = 'true';
    }
    if (editFechaOrdenInput && !editFechaOrdenInput.dataset.boundAtencionConvenioDate) {
        editFechaOrdenInput.addEventListener('change', async () => {
            try {
                await cargarConvenioServicioAtencion(true);
                const currentQuery = document.getElementById('editAtenServicio')?.value?.trim() || '';
                if (currentQuery) {
                    renderSugerenciasServicioAtencion(currentQuery);
                }
            } catch (error) {
                console.error('Error actualizando convenio por fecha de orden:', error);
                actualizarHintServicioAtencion(error.message || 'No se pudieron actualizar los examenes o paquetes convenidos.', true);
            }
        });
        editFechaOrdenInput.dataset.boundAtencionConvenioDate = 'true';
    }

    const prefEmpresaInput = document.getElementById('consultaPrefEmpresa');
    const prefSuggestionsContainer = document.getElementById('consultaPrefEmpresaSuggestions');
    if (prefEmpresaInput && !prefEmpresaInput.dataset.boundPrefEmpresaSuggestions) {
        prefEmpresaInput.addEventListener('focus', () => {
            if (prefEmpresaInput.value.trim()) {
                buscarEmpresasPrefacturas(prefEmpresaInput.value);
            }
        });
        prefEmpresaInput.addEventListener('blur', () => {
            window.setTimeout(ocultarSugerenciasEmpresasPrefacturas, 150);
        });
        prefEmpresaInput.dataset.boundPrefEmpresaSuggestions = 'true';
    }
    if (prefSuggestionsContainer && !prefSuggestionsContainer.dataset.boundPrefEmpresaSuggestions) {
        prefSuggestionsContainer.addEventListener('mousedown', event => {
            const button = event.target.closest('.cargue-atenciones-suggestion-item');
            if (!button) return;
            seleccionarEmpresaPrefactura(decodeURIComponent(button.dataset.empresa || ''));
        });
        prefSuggestionsContainer.dataset.boundPrefEmpresaSuggestions = 'true';
    }
    const prefManualItemSelect = document.getElementById('prefManualItemSelect');
    if (prefManualItemSelect && !prefManualItemSelect.dataset.boundPrefManualItem) {
        prefManualItemSelect.addEventListener('change', actualizarValorItemPrefacturaManual);
        prefManualItemSelect.dataset.boundPrefManualItem = 'true';
    }
    const prefManualFechaProgramada = document.getElementById('prefManualFechaProgramada');
    if (prefManualFechaProgramada && !prefManualFechaProgramada.dataset.boundPrefManualFecha) {
        prefManualFechaProgramada.addEventListener('change', async () => {
            const clienteId = document.getElementById('prefacturaDetalleClienteId')?.value || '';
            const fechaProgramada = prefManualFechaProgramada.value || '';
            if (!clienteId || !fechaProgramada) return;
            try {
                await cargarConvenioPrefacturaManual(clienteId, fechaProgramada, true);
                actualizarValorItemPrefacturaManual();
            } catch (error) {
                console.error('Error actualizando convenio de detalle manual:', error);
                setPrefDetalleManualMsg(error.message || 'No se pudo actualizar el convenio para la fecha seleccionada.', true);
            }
        });
        prefManualFechaProgramada.dataset.boundPrefManualFecha = 'true';
    }

    const prefPeriodoSelect = document.getElementById('prefacturaPeriodoSelect');
    if (prefPeriodoSelect && !prefPeriodoSelect.dataset.boundPeriodoCargue) {
        prefPeriodoSelect.addEventListener('change', () => aplicarPeriodoEnRango('prefacturaPeriodoSelect', 'prefacturaFechaDesde', 'prefacturaFechaHasta'));
        prefPeriodoSelect.dataset.boundPeriodoCargue = 'true';
    }
    const consultaPrefPeriodo = document.getElementById('consultaPrefPeriodo');
    if (consultaPrefPeriodo && !consultaPrefPeriodo.dataset.boundPeriodoCargue) {
        consultaPrefPeriodo.addEventListener('change', () => aplicarPeriodoEnRango('consultaPrefPeriodo', 'consultaPrefFechaDesde', 'consultaPrefFechaHasta'));
        consultaPrefPeriodo.dataset.boundPeriodoCargue = 'true';
    }
    const atencionesPeriodo = document.getElementById('cargueAtencionesDiaFiltroPeriodo');
    if (atencionesPeriodo && !atencionesPeriodo.dataset.boundPeriodoCargue) {
        atencionesPeriodo.addEventListener('change', () => aplicarPeriodoEnRango('cargueAtencionesDiaFiltroPeriodo', 'cargueAtencionesDiaFechaDesde', 'cargueAtencionesDiaFechaHasta'));
        atencionesPeriodo.dataset.boundPeriodoCargue = 'true';
    }

    [
        ['prefacturaFechaDesde', 'prefacturaPeriodoSelect'],
        ['prefacturaFechaHasta', 'prefacturaPeriodoSelect'],
        ['consultaPrefFechaDesde', 'consultaPrefPeriodo'],
        ['consultaPrefFechaHasta', 'consultaPrefPeriodo'],
        ['cargueAtencionesDiaFechaDesde', 'cargueAtencionesDiaFiltroPeriodo'],
        ['cargueAtencionesDiaFechaHasta', 'cargueAtencionesDiaFiltroPeriodo']
    ].forEach(([inputId, selectId]) => {
        const input = document.getElementById(inputId);
        if (!input || input.dataset.boundPeriodoManual) return;
        input.addEventListener('change', () => {
            if (selectId === 'prefacturaPeriodoSelect') {
                limpiarSeleccionPeriodoSiFechasManual(selectId, 'prefacturaFechaDesde', 'prefacturaFechaHasta');
            } else if (selectId === 'consultaPrefPeriodo') {
                limpiarSeleccionPeriodoSiFechasManual(selectId, 'consultaPrefFechaDesde', 'consultaPrefFechaHasta');
            } else {
                limpiarSeleccionPeriodoSiFechasManual(selectId, 'cargueAtencionesDiaFechaDesde', 'cargueAtencionesDiaFechaHasta');
            }
        });
        input.dataset.boundPeriodoManual = 'true';
    });

    const anticipoForm = document.getElementById('programarAnticipoForm');
    if (anticipoForm && !anticipoForm.dataset.boundAnticipoProgramado) {
        anticipoForm.addEventListener('submit', guardarProgramarAnticipo);
        anticipoForm.dataset.boundAnticipoProgramado = 'true';
    }

    const anticipoEmpresaInput = document.getElementById('anticipoEmpresaInput');
    const anticipoEmpresaSuggestions = document.getElementById('anticipoEmpresaSuggestions');
    if (anticipoEmpresaInput && !anticipoEmpresaInput.dataset.boundAnticipoEmpresa) {
        anticipoEmpresaInput.addEventListener('input', () => {
            const currentValue = anticipoEmpresaInput.value.trim();
            const selectedLabel = (anticipoEmpresaInput.dataset.selectedLabel || '').trim();
            if (!currentValue) {
                limpiarSeleccionEmpresaAnticipo(false);
                ocultarSugerenciasEmpresaAnticipo();
                return;
            }
            if (!selectedLabel || currentValue !== selectedLabel) {
                limpiarSeleccionEmpresaAnticipo(true);
            }
            window.clearTimeout(window.anticipoProgramadoState.empresaSearchTimer);
            window.anticipoProgramadoState.empresaSearchTimer = window.setTimeout(() => {
                buscarEmpresasAnticipoProgramado(currentValue).catch(error => {
                    console.error('Error buscando empresas para anticipo:', error);
                    ocultarSugerenciasEmpresaAnticipo();
                });
            }, 160);
        });
        anticipoEmpresaInput.addEventListener('focus', () => {
            if (anticipoEmpresaInput.value.trim()) {
                buscarEmpresasAnticipoProgramado(anticipoEmpresaInput.value).catch(() => {});
            }
        });
        anticipoEmpresaInput.addEventListener('blur', () => {
            window.setTimeout(ocultarSugerenciasEmpresaAnticipo, 150);
        });
        anticipoEmpresaInput.dataset.boundAnticipoEmpresa = 'true';
    }
    if (anticipoEmpresaSuggestions && !anticipoEmpresaSuggestions.dataset.boundAnticipoEmpresa) {
        anticipoEmpresaSuggestions.addEventListener('mousedown', event => {
            const button = event.target.closest('.cargue-atenciones-suggestion-item');
            if (!button) return;
            seleccionarEmpresaAnticipo(button.dataset.clienteId);
        });
        anticipoEmpresaSuggestions.dataset.boundAnticipoEmpresa = 'true';
    }

    const anticipoItemInput = document.getElementById('anticipoItemInput');
    const anticipoItemSuggestions = document.getElementById('anticipoItemSuggestions');
    if (anticipoItemInput && !anticipoItemInput.dataset.boundAnticipoItem) {
        anticipoItemInput.addEventListener('input', programarBusquedaItemAnticipo);
        anticipoItemInput.addEventListener('focus', () => {
            if (anticipoItemInput.value.trim()) {
                programarBusquedaItemAnticipo();
            }
        });
        anticipoItemInput.addEventListener('blur', () => {
            window.setTimeout(ocultarSugerenciasItemAnticipo, 150);
        });
        anticipoItemInput.dataset.boundAnticipoItem = 'true';
    }
    if (anticipoItemSuggestions && !anticipoItemSuggestions.dataset.boundAnticipoItem) {
        anticipoItemSuggestions.addEventListener('mousedown', event => {
            const button = event.target.closest('.cargue-atenciones-suggestion-item');
            if (!button) return;
            seleccionarItemAnticipo(button.dataset.itemId);
        });
        anticipoItemSuggestions.dataset.boundAnticipoItem = 'true';
    }

    const anticipoFechaAtencion = document.getElementById('anticipoFechaAtencion');
    if (anticipoFechaAtencion && !anticipoFechaAtencion.dataset.boundAnticipoFecha) {
        anticipoFechaAtencion.addEventListener('change', async () => {
            try {
                await cargarConvenioAnticipoProgramado(true);
                const currentQuery = document.getElementById('anticipoItemInput')?.value?.trim() || '';
                if (currentQuery) {
                    renderSugerenciasItemAnticipo(currentQuery);
                }
            } catch (error) {
                console.error('Error actualizando convenio de anticipo por fecha:', error);
                actualizarHintItemAnticipo(error.message || 'No se pudieron actualizar los items convenidos.', true);
            }
        });
        anticipoFechaAtencion.dataset.boundAnticipoFecha = 'true';
    }

    const anticipoMedioPago = document.getElementById('anticipoMedioPago');
    if (anticipoMedioPago && !anticipoMedioPago.dataset.boundAnticipoPago) {
        anticipoMedioPago.addEventListener('change', actualizarAyudaPagoAnticipo);
        anticipoMedioPago.dataset.boundAnticipoPago = 'true';
    }

    const anticipoValorPago = document.getElementById('anticipoValorPago');
    if (anticipoValorPago && !anticipoValorPago.dataset.boundAnticipoValor) {
        anticipoValorPago.addEventListener('input', () => {
            window.anticipoProgramadoState.paymentValueTouched = true;
        });
        anticipoValorPago.dataset.boundAnticipoValor = 'true';
    }
});

function formatearNombreContactoCliente(nombre, cargo) {
    const nombreLimpio = (nombre || '').trim();
    const cargoLimpio = (cargo || '').trim();

    if (nombreLimpio && cargoLimpio) {
        return `${nombreLimpio} (${cargoLimpio})`;
    }

    return nombreLimpio || cargoLimpio || '';
}

function obtenerContactoPreferidoCliente(cliente) {
    const contactoFacturacion = formatearNombreContactoCliente(cliente?.contacto_facturacion, cliente?.cargo_contacto_facturacion);
    if (contactoFacturacion) {
        return contactoFacturacion;
    }

    return formatearNombreContactoCliente(cliente?.contacto_principal, cliente?.cargo_contacto_principal);
}

function obtenerAnotacionesRecepcionCliente(cliente) {
    const puntosRecepcion = (cliente?.puntos_atencion_recepcion || '').trim();
    const observaciones = (cliente?.observaciones || '').trim();

    if (puntosRecepcion && observaciones && puntosRecepcion !== observaciones) {
        return `${puntosRecepcion}\n\nNotas comerciales: ${observaciones}`;
    }

    return puntosRecepcion || observaciones || '';
}

function obtenerEstadoCliente(cliente) {
    const estado = String(cliente?.estado_cliente || '').trim().toUpperCase();
    if (estado) return estado;
    return cliente?.activo === false ? 'INACTIVO' : 'ACTIVO';
}

function formatearEstadoCliente(estado) {
    if (estado === 'BLOQUEO_TEMPORAL') return 'BLOQUEO TEMPORAL';
    if (estado === 'INACTIVO') return 'INACTIVO';
    return 'ACTIVO';
}

function obtenerClaseEstadoCliente(estado) {
    if (estado === 'BLOQUEO_TEMPORAL') return 'recepcion-estado-bloqueo';
    if (estado === 'INACTIVO') return 'recepcion-estado-inactivo';
    return 'recepcion-estado-activo';
}

function getTodayIsoDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseMoneyInput(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : NaN;
    }

    const normalized = String(value || '')
        .replace(/\s+/g, '')
        .replace(/\$/g, '')
        .replace(/\./g, '')
        .replace(/,/g, '.');

    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : NaN;
}

function renderSeguimientoEstadoBadge(estado) {
    const normalized = String(estado || 'PENDIENTE').toUpperCase();
    let badgeClass = 'badge-secondary';
    if (normalized === 'PAGADO') badgeClass = 'badge-success';
    else if (normalized === 'PARCIAL') badgeClass = 'badge-warning';
    else if (normalized === 'VENCIDO' || normalized === 'ANULADO') badgeClass = 'badge-danger';
    else if (normalized === 'PENDIENTE') badgeClass = 'badge-info';
    return `<span class="badge ${badgeClass}">${escapeHtml(normalized)}</span>`;
}

function getClienteSeguimientoActual() {
    return clienteSeguimientoContext?.cliente || null;
}

function getAtencionSeguimientoById(atencionId) {
    return (clienteSeguimientoContext.atenciones || []).find(atencion => Number(atencion.id) === Number(atencionId)) || null;
}

function getDocumentoSeguimientoById(documentoId) {
    return (clienteSeguimientoContext.documentos || []).find(documento => Number(documento.id) === Number(documentoId)) || null;
}

function getPagoSeguimientoById(pagoId) {
    return (clienteSeguimientoContext.pagos || []).find(pago => Number(pago.id) === Number(pagoId)) || null;
}

function getConvenioItemSeguimientoById(itemId) {
    return (clienteSeguimientoContext.convenioItems || []).find(item => Number(item.id) === Number(itemId)) || null;
}

function buildComercialDeleteBlockedMessage(defaultMessage, details = {}) {
    const items = Object.entries(details || {})
        .filter(([, value]) => Number(value || 0) > 0)
        .map(([key, value]) => `${key}: ${value}`);

    if (!items.length) {
        return defaultMessage;
    }

    return `${defaultMessage} (${items.join(', ')})`;
}

async function ensureClientesComercialesLoaded() {
    if (Array.isArray(clientesComercialesData) && clientesComercialesData.length > 0) {
        return clientesComercialesData;
    }
    await cargarClientesComercialesConfig();
    return clientesComercialesData;
}

function setSeguimientoPanelVisible(panelName = '') {
    const panels = {
        atenciones: document.getElementById('clienteSeguimientoAtencionesPanel'),
        documentos: document.getElementById('clienteSeguimientoDocumentosPanel'),
        pagos: document.getElementById('clienteSeguimientoPagosPanel')
    };
    const emptyState = document.getElementById('clienteSeguimientoEmptyState');

    Object.entries(panels).forEach(([name, panel]) => {
        if (panel) {
            panel.style.display = name === panelName ? 'block' : 'none';
        }
    });

    if (emptyState) {
        emptyState.style.display = panelName ? 'none' : 'block';
    }
}

function renderClienteSeguimientoResumen() {
    const cliente = getClienteSeguimientoActual();
    const resumenCliente = document.getElementById('clienteSeguimientoResumenCliente');
    const resumenVendedor = document.getElementById('clienteSeguimientoResumenVendedor');
    const resumenCondicion = document.getElementById('clienteSeguimientoResumenCondicion');
    const resumenCantidad = document.getElementById('clienteSeguimientoResumenCantidad');
    const resumenSaldo = document.getElementById('clienteSeguimientoResumenSaldo');

    if (resumenCliente) {
        resumenCliente.textContent = cliente?.razon_social || cliente?.nombre_comercial || 'Cliente';
    }
    if (resumenVendedor) {
        resumenVendedor.textContent = cliente?.vendedor_nombre || 'Sin vendedor';
    }
    if (resumenCondicion) {
        resumenCondicion.textContent = formatearFormaPagoCliente(cliente) || 'Sin condición';
    }
    if (resumenCantidad) {
        resumenCantidad.textContent = String((clienteSeguimientoContext.documentos || []).length);
    }
    if (resumenSaldo) {
        const saldo = (clienteSeguimientoContext.documentos || []).reduce((acc, documento) => acc + Number(documento.saldo_actual || 0), 0);
        resumenSaldo.textContent = formatCurrency(saldo);
    }
}

function renderSeguimientoDocumentosTable() {
    const tbody = document.getElementById('clienteSeguimientoDocumentosTable');
    if (!tbody) return;

    const documentos = clienteSeguimientoContext.documentos || [];
    if (!documentos.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="loading">Este cliente aún no tiene documentos comerciales registrados.</td></tr>';
        return;
    }

    tbody.innerHTML = documentos.map(documento => {
        const acciones = [];
        if (canManageComercial('pagos', 'create')) {
            acciones.push(`<button type="button" class="action-btn action-btn-edit" onclick="mostrarAgregarSeguimientoPago(${Number(documento.id)})">Pago</button>`);
        }
        if (!documento.es_atencion) {
            if (canManageComercial('documentos', 'update')) {
                acciones.push(`<button type="button" class="action-btn action-btn-edit" onclick="editarSeguimientoDocumento(${Number(documento.id)})">Editar</button>`);
            }
            if (canManageComercial('documentos', 'delete')) {
                acciones.push(`<button type="button" class="action-btn action-btn-delete" onclick="eliminarSeguimientoDocumento(${Number(documento.id)})">Eliminar</button>`);
            }
        } else {
            acciones.push('<span style="color:#64748b;">Generado desde atención</span>');
        }

        return `
            <tr>
                <td>${escapeHtml(documento.tipo_documento || 'N/A')}</td>
                <td>${escapeHtml(documento.numero_documento || 'N/A')}</td>
                <td>${escapeHtml(documento.fecha_documento || 'N/A')}</td>
                <td>${escapeHtml(documento.fecha_vencimiento || 'N/A')}</td>
                <td>${formatCurrency(documento.valor_documento || 0)}</td>
                <td>${formatCurrency(documento.saldo_actual || 0)}</td>
                <td>${documento.genera_cartera ? '<span class="badge badge-warning">Sí</span>' : '<span class="badge badge-secondary">No</span>'}</td>
                <td>${renderSeguimientoEstadoBadge(documento.estado_documento)}</td>
                <td>${acciones.join(' ')}</td>
            </tr>
        `;
    }).join('');
}

function renderSeguimientoPagosTable() {
    const tbody = document.getElementById('clienteSeguimientoPagosTable');
    if (!tbody) return;

    const pagos = clienteSeguimientoContext.pagos || [];
    if (!pagos.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="loading">Este cliente aún no tiene pagos o abonos registrados.</td></tr>';
        return;
    }

    tbody.innerHTML = pagos.map(pago => {
        const comprobante = pago.comprobante_url
            ? `<a href="${pago.comprobante_url}" target="_blank" rel="noopener noreferrer">Ver</a>`
            : 'N/A';
        const paciente = [pago.paciente_nombre, pago.paciente_documento].filter(Boolean).join(' · ') || 'N/A';
        const fechas = [pago.numero_recibo_caja, pago.fecha_pago, pago.fecha_recibo].filter(Boolean).join(' · ');
        const acciones = [];
        if (canManageComercial('pagos', 'update')) {
            acciones.push(`<button type="button" class="action-btn action-btn-edit" onclick="editarSeguimientoPago(${Number(pago.id)})">Editar</button>`);
        }
        if (canManageComercial('pagos', 'delete')) {
            acciones.push(`<button type="button" class="action-btn action-btn-delete" onclick="eliminarSeguimientoPago(${Number(pago.id)})">Eliminar</button>`);
        }

        return `
            <tr>
                <td>${escapeHtml([pago.documento_tipo, pago.documento_numero].filter(Boolean).join(' · ') || 'N/A')}</td>
                <td>${escapeHtml(fechas || 'N/A')}</td>
                <td>${escapeHtml([paciente, pago.fecha_atencion].filter(Boolean).join(' · '))}</td>
                <td>${formatCurrency(pago.valor_pago || 0)}</td>
                <td>${escapeHtml(pago.tipo_pago || 'N/A')}</td>
                <td>${escapeHtml(pago.medio_pago || 'N/A')}</td>
                <td>${escapeHtml(pago.canal_transferencia || 'N/A')}</td>
                <td>${comprobante}</td>
                <td>${acciones.join(' ')}</td>
            </tr>
        `;
    }).join('');
}

function renderSeguimientoDraftDetalles() {
    const tbody = document.getElementById('seguimientoAtencionDetalleTable');
    const totalEl = document.getElementById('seguimientoAtencionTotal');
    if (!tbody || !totalEl) return;

    const detalles = clienteSeguimientoContext.draftDetalles || [];
    if (!detalles.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">Agrega uno o más pacientes con sus exámenes o paquetes convenidos.</td></tr>';
        totalEl.textContent = 'Total atención: $0';
        return;
    }

    let total = 0;
    tbody.innerHTML = detalles.map((detalle, index) => {
        total += Number(detalle.valor_unitario || 0);
        return `
            <tr>
                <td>${escapeHtml([detalle.paciente_nombre, detalle.paciente_documento].filter(Boolean).join(' · '))}</td>
                <td>${escapeHtml(detalle.nombre || 'N/A')}</td>
                <td>${escapeHtml(detalle.tipo_item || 'N/A')}</td>
                <td>${formatCurrency(detalle.valor_unitario || 0)}</td>
                <td><button type="button" class="action-btn action-btn-delete" onclick="eliminarDetalleAtencionSeguimiento(${index})">Quitar</button></td>
            </tr>
        `;
    }).join('');
    totalEl.textContent = `Total atención: ${formatCurrency(total)}`;
}

function renderSeguimientoConvenioItemsSelect(items = []) {
    const select = document.getElementById('seguimientoAtencionItemSelect');
    const hint = document.getElementById('seguimientoAtencionItemHint');
    if (!select) return;

    select.innerHTML = '<option value="">Seleccione un item convenido...</option>';
    items.forEach(item => {
        const option = document.createElement('option');
        option.value = String(item.id);
        option.textContent = `${item.nombre} · ${item.tipo_item} · ${formatCurrency(item.valor_unitario || 0)}`;
        select.appendChild(option);
    });

    if (hint) {
        hint.textContent = items.length
            ? 'Solo se muestran los items convenidos para este cliente y se usa la tarifa registrada en el convenio.'
            : 'Este cliente no tiene exámenes o paquetes convenidos vigentes para la fecha seleccionada.';
    }
}

function llenarSelectDocumentosSeguimiento(selectedId = '') {
    const select = document.getElementById('seguimientoPagoDocumentoId');
    if (!select) return;

    const documentos = clienteSeguimientoContext.documentos || [];
    select.innerHTML = '<option value="">Seleccione un documento...</option>';

    documentos
        .filter(documento => Number(documento.saldo_actual || 0) > 0 || String(documento.id) === String(selectedId))
        .forEach(documento => {
            const option = document.createElement('option');
            option.value = String(documento.id);
            option.textContent = `${documento.tipo_documento || 'DOC'} · ${documento.numero_documento || 'Sin número'} · saldo ${formatCurrency(documento.saldo_actual || 0)}`;
            select.appendChild(option);
        });

    if (selectedId) {
        select.value = String(selectedId);
    }
}

function actualizarHintSeguimientoDocumento() {
    const checkbox = document.getElementById('seguimientoDocumentoGeneraCartera');
    const hint = document.getElementById('seguimientoDocumentoHint');
    const vencimiento = document.getElementById('seguimientoDocumentoVencimiento');
    if (!checkbox || !hint || !vencimiento) return;

    if (checkbox.checked) {
        hint.textContent = 'Como este documento genera cartera, debe registrar la fecha de vencimiento y el saldo quedará pendiente de cobro.';
    } else {
        hint.textContent = 'Si este documento deja saldo pendiente para seguimiento de cobro, marca que genera cartera y registra la fecha de vencimiento.';
        vencimiento.value = '';
    }
}

function actualizarVisibilidadSeguimientoPago() {
    const medio = document.getElementById('seguimientoPagoMedio')?.value || 'EFECTIVO';
    const documentoId = document.getElementById('seguimientoPagoDocumentoId')?.value || '';
    const reciboSection = document.getElementById('seguimientoPagoReciboCajaSection');
    const comprobanteHint = document.getElementById('seguimientoPagoComprobanteActual');
    const documento = getDocumentoSeguimientoById(documentoId);
    const cliente = getClienteSeguimientoActual();
    const requiereRecibo = Boolean(documento && medio === 'EFECTIVO' && cliente?.requiere_factura === false);

    if (reciboSection) {
        reciboSection.style.display = requiereRecibo ? 'block' : 'none';
    }
    if (comprobanteHint) {
        comprobanteHint.textContent = medio === 'TRANSFERENCIA'
            ? 'Obligatorio cuando el pago se registra por transferencia.'
            : 'Opcional. Solo se usa cuando adjunta soporte del recaudo.';
    }
}

async function loadSeguimientoConvenioItems(fechaAtencion = '') {
    const clienteId = clienteSeguimientoContext.clienteId;
    if (!clienteId) {
        clienteSeguimientoContext.convenioItems = [];
        renderSeguimientoConvenioItemsSelect([]);
        return [];
    }

    const params = new URLSearchParams();
    if (fechaAtencion) {
        params.set('fecha_atencion', fechaAtencion);
    }

    const response = await fetch(`/api/comercial/clientes/${clienteId}/convenio-items${params.toString() ? `?${params.toString()}` : ''}`, {
        credentials: 'include'
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'No se pudieron cargar los items convenidos del cliente');
    }

    clienteSeguimientoContext.convenioItems = Array.isArray(data) ? data : [];
    renderSeguimientoConvenioItemsSelect(clienteSeguimientoContext.convenioItems);
    return clienteSeguimientoContext.convenioItems;
}

async function cargarSeguimientoCliente(clienteId) {
    const responseSet = await Promise.all([
        fetch(`/api/comercial/clientes/${clienteId}/atenciones`, { credentials: 'include' }),
        fetch(`/api/comercial/clientes/${clienteId}/seguimiento-documentos`, { credentials: 'include' }),
        fetch(`/api/comercial/clientes/${clienteId}/seguimiento-pagos`, { credentials: 'include' })
    ]);

    const [atencionesResp, documentosResp, pagosResp] = responseSet;
    const [atencionesData, documentosData, pagosData] = await Promise.all(responseSet.map(response => response.json()));

    if (!atencionesResp.ok) throw new Error(atencionesData.error || 'No se pudieron cargar las atenciones');
    if (!documentosResp.ok) throw new Error(documentosData.error || 'No se pudieron cargar los documentos');
    if (!pagosResp.ok) throw new Error(pagosData.error || 'No se pudieron cargar los pagos');

    clienteSeguimientoContext.atenciones = Array.isArray(atencionesData) ? atencionesData : [];
    clienteSeguimientoContext.documentos = Array.isArray(documentosData) ? documentosData : [];
    clienteSeguimientoContext.pagos = Array.isArray(pagosData) ? pagosData : [];
    renderClienteSeguimientoResumen();
    renderSeguimientoAtencionesTable();
    renderSeguimientoDocumentosTable();
    renderSeguimientoPagosTable();
}

async function abrirSeguimientoClienteDesdeFicha() {
    const clienteId = document.getElementById('clienteComercialId')?.value || '';
    if (!clienteId) {
        showError('Guarda o selecciona primero un cliente para abrir su seguimiento.');
        return;
    }

    try {
        await ensureClientesComercialesLoaded();
        const cliente = clientesComercialesData.find(item => String(item.id) === String(clienteId));
        if (!cliente) {
            throw new Error('No se pudo encontrar el cliente seleccionado.');
        }

        clienteSeguimientoContext = {
            clienteId: String(clienteId),
            cliente,
            convenioItems: [],
            atenciones: [],
            documentos: [],
            pagos: [],
            draftDetalles: []
        };

        document.getElementById('clienteSeguimientoModal')?.classList.add('active');
        setSeguimientoPanelVisible('atenciones');
        renderClienteSeguimientoResumen();
        renderSeguimientoAtencionesTable();
        renderSeguimientoDocumentosTable();
        renderSeguimientoPagosTable();
        await cargarSeguimientoCliente(clienteId);
    } catch (error) {
        console.error('Error abriendo seguimiento del cliente:', error);
        showError(error.message || 'No fue posible abrir el seguimiento del cliente.');
    }
}

function closeClienteSeguimientoModal() {
    document.getElementById('clienteSeguimientoModal')?.classList.remove('active');
    setSeguimientoPanelVisible('');
}

function volverClienteDesdeSeguimiento() {
    closeClienteSeguimientoModal();
}

function abrirAccionClienteSeguimiento(tipo) {
    if (tipo === 'atenciones') {
        setSeguimientoPanelVisible('atenciones');
        mostrarAgregarAtencionCliente();
        return;
    }
    if (tipo === 'documentos') {
        setSeguimientoPanelVisible('documentos');
        mostrarAgregarSeguimientoDocumento();
        return;
    }
    if (tipo === 'pagos') {
        setSeguimientoPanelVisible('pagos');
        mostrarAgregarSeguimientoPago();
    }
}

function closeSeguimientoAtencionModal() {
    document.getElementById('seguimientoAtencionModal')?.classList.remove('active');
    clienteSeguimientoContext.draftDetalles = [];
    renderSeguimientoDraftDetalles();
    if (window._registroAtencionesRecargarAlCerrar) {
        window._registroAtencionesRecargarAlCerrar = false;
        const state = window._registroAtencionesState;
        if (state && state.clienteId) {
            cargarRegistroAtenciones();
        }
    }
}

function agregarDetalleAtencionSeleccionado() {
    const itemId = document.getElementById('seguimientoAtencionItemSelect')?.value || '';
    const pacienteDocumento = document.getElementById('seguimientoAtencionPacienteDocumento')?.value.trim() || '';
    const pacienteNombre = document.getElementById('seguimientoAtencionPacienteNombre')?.value.trim() || '';

    if (!itemId) {
        showError('Selecciona primero un examen o paquete convenido.');
        return;
    }
    if (!pacienteDocumento || !pacienteNombre) {
        showError('Debes registrar documento y nombre del paciente antes de agregar el item.');
        return;
    }

    const item = getConvenioItemSeguimientoById(itemId);
    if (!item) {
        showError('El item seleccionado ya no está disponible para este cliente.');
        return;
    }

    clienteSeguimientoContext.draftDetalles.push({
        catalogo_item_id: Number(item.id),
        paciente_documento: pacienteDocumento,
        paciente_nombre: pacienteNombre,
        nombre: item.nombre,
        tipo_item: item.tipo_item,
        valor_unitario: Number(item.valor_unitario || 0)
    });
    renderSeguimientoDraftDetalles();
    document.getElementById('seguimientoAtencionItemSelect').value = '';
}

function eliminarDetalleAtencionSeguimiento(index) {
    clienteSeguimientoContext.draftDetalles.splice(index, 1);
    renderSeguimientoDraftDetalles();
}

function mostrarAgregarSeguimientoDocumento() {
    if (!clienteSeguimientoContext.clienteId) {
        showError('Selecciona primero un cliente comercial.');
        return;
    }

    document.getElementById('seguimientoDocumentoModalTitle').textContent = 'Nuevo Documento Comercial';
    document.getElementById('seguimientoDocumentoForm')?.reset();
    document.getElementById('seguimientoDocumentoId').value = '';
    document.getElementById('seguimientoDocumentoTipo').value = 'FACTURA';
    document.getElementById('seguimientoDocumentoFecha').value = getTodayIsoDate();
    document.getElementById('seguimientoDocumentoValor').value = '';
    document.getElementById('seguimientoDocumentoGeneraCartera').checked = false;
    actualizarHintSeguimientoDocumento();
    document.getElementById('seguimientoDocumentoModal')?.classList.add('active');
}

function closeSeguimientoDocumentoModal() {
    document.getElementById('seguimientoDocumentoModal')?.classList.remove('active');
}

function editarSeguimientoDocumento(documentoId) {
    const documento = getDocumentoSeguimientoById(documentoId);
    if (!documento) {
        showError('No se pudo localizar el documento seleccionado.');
        return;
    }

    document.getElementById('seguimientoDocumentoModalTitle').textContent = 'Editar Documento Comercial';
    document.getElementById('seguimientoDocumentoId').value = documento.id;
    document.getElementById('seguimientoDocumentoTipo').value = documento.tipo_documento || 'FACTURA';
    document.getElementById('seguimientoDocumentoNumero').value = documento.numero_documento || '';
    document.getElementById('seguimientoDocumentoFecha').value = documento.fecha_documento || getTodayIsoDate();
    document.getElementById('seguimientoDocumentoVencimiento').value = documento.fecha_vencimiento || '';
    document.getElementById('seguimientoDocumentoValor').value = Number(documento.valor_documento || 0);
    document.getElementById('seguimientoDocumentoGeneraCartera').checked = documento.genera_cartera === true;
    document.getElementById('seguimientoDocumentoObservaciones').value = documento.observaciones || '';
    actualizarHintSeguimientoDocumento();
    document.getElementById('seguimientoDocumentoModal')?.classList.add('active');
}

async function guardarSeguimientoDocumento(event) {
    event.preventDefault();

    const clienteId = clienteSeguimientoContext.clienteId;
    const documentoId = document.getElementById('seguimientoDocumentoId').value || '';
    const valorDocumento = parseMoneyInput(document.getElementById('seguimientoDocumentoValor').value);

    if (!Number.isFinite(valorDocumento) || valorDocumento <= 0) {
        showError('El valor del documento debe ser mayor a cero.');
        return;
    }

    try {
        const response = await fetch(
            documentoId ? `/api/comercial/seguimiento-documentos/${documentoId}` : `/api/comercial/clientes/${clienteId}/seguimiento-documentos`,
            {
                method: documentoId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    tipo_documento: document.getElementById('seguimientoDocumentoTipo').value,
                    numero_documento: document.getElementById('seguimientoDocumentoNumero').value.trim(),
                    fecha_documento: document.getElementById('seguimientoDocumentoFecha').value,
                    fecha_vencimiento: document.getElementById('seguimientoDocumentoGeneraCartera').checked
                        ? document.getElementById('seguimientoDocumentoVencimiento').value
                        : '',
                    valor_documento: valorDocumento,
                    genera_cartera: document.getElementById('seguimientoDocumentoGeneraCartera').checked,
                    observaciones: document.getElementById('seguimientoDocumentoObservaciones').value.trim()
                })
            }
        );
        const data = await response.json();
        if (!response.ok) {
            showError(data.error || 'No fue posible guardar el documento.');
            return;
        }

        showSuccess(documentoId ? 'Documento actualizado.' : 'Documento registrado.');
        closeSeguimientoDocumentoModal();
        await cargarSeguimientoCliente(clienteId);
        setSeguimientoPanelVisible('documentos');
    } catch (error) {
        console.error('Error guardando documento de seguimiento:', error);
        showError('Error de conexión al guardar el documento.');
    }
}

async function eliminarSeguimientoDocumento(documentoId) {
    if (!confirm('¿Desea eliminar este documento comercial?')) {
        return;
    }

    try {
        const response = await fetch(`/api/comercial/seguimiento-documentos/${documentoId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            showError(data.error || 'No fue posible eliminar el documento.');
            return;
        }

        showSuccess('Documento eliminado.');
        await cargarSeguimientoCliente(clienteSeguimientoContext.clienteId);
        setSeguimientoPanelVisible('documentos');
    } catch (error) {
        console.error('Error eliminando documento de seguimiento:', error);
        showError('Error de conexión al eliminar el documento.');
    }
}

function mostrarAgregarSeguimientoPago(documentoId = '') {
    if (!clienteSeguimientoContext.clienteId) {
        showError('Selecciona primero un cliente comercial.');
        return;
    }

    document.getElementById('seguimientoPagoModalTitle').textContent = 'Registrar Pago';
    document.getElementById('seguimientoPagoForm')?.reset();
    document.getElementById('seguimientoPagoId').value = '';
    llenarSelectDocumentosSeguimiento(documentoId || '');
    document.getElementById('seguimientoPagoFecha').value = getTodayIsoDate();
    document.getElementById('seguimientoPagoFechaRecibo').value = getTodayIsoDate();
    document.getElementById('seguimientoPagoNumeroRecibo').value = '';
    actualizarVisibilidadSeguimientoPago();
    document.getElementById('seguimientoPagoModal')?.classList.add('active');
}

function closeSeguimientoPagoModal() {
    document.getElementById('seguimientoPagoModal')?.classList.remove('active');
}

function editarSeguimientoPago(pagoId) {
    const pago = getPagoSeguimientoById(pagoId);
    if (!pago) {
        showError('No se pudo localizar el pago seleccionado.');
        return;
    }

    document.getElementById('seguimientoPagoModalTitle').textContent = 'Editar Pago';
    document.getElementById('seguimientoPagoId').value = pago.id;
    llenarSelectDocumentosSeguimiento(pago.documento_id || '');
    document.getElementById('seguimientoPagoDocumentoId').value = String(pago.documento_id || '');
    document.getElementById('seguimientoPagoFecha').value = pago.fecha_pago || getTodayIsoDate();
    document.getElementById('seguimientoPagoValor').value = Number(pago.valor_pago || 0);
    document.getElementById('seguimientoPagoTipo').value = pago.tipo_pago || 'ABONO';
    document.getElementById('seguimientoPagoMedio').value = pago.medio_pago || 'EFECTIVO';
    document.getElementById('seguimientoPagoCanal').value = pago.canal_transferencia || '';
    document.getElementById('seguimientoPagoNumeroRecibo').value = pago.numero_recibo_caja || '';
    document.getElementById('seguimientoPagoFechaRecibo').value = pago.fecha_recibo || getTodayIsoDate();
    document.getElementById('seguimientoPagoPacienteDocumento').value = pago.paciente_documento || '';
    document.getElementById('seguimientoPagoPacienteNombre').value = pago.paciente_nombre || '';
    document.getElementById('seguimientoPagoFechaAtencion').value = pago.fecha_atencion || '';
    document.getElementById('seguimientoPagoExamenesRealizados').value = pago.examenes_realizados || '';
    document.getElementById('seguimientoPagoObservaciones').value = pago.observaciones || '';
    const comprobanteHint = document.getElementById('seguimientoPagoComprobanteActual');
    if (comprobanteHint) {
        comprobanteHint.textContent = pago.comprobante_nombre
            ? `Comprobante actual: ${pago.comprobante_nombre}`
            : 'Obligatorio cuando el pago se registra por transferencia.';
    }
    actualizarVisibilidadSeguimientoPago();
    document.getElementById('seguimientoPagoModal')?.classList.add('active');
}

async function guardarSeguimientoPago(event) {
    event.preventDefault();

    const pagoId = document.getElementById('seguimientoPagoId').value || '';
    const documentoId = document.getElementById('seguimientoPagoDocumentoId').value || '';
    if (!documentoId) {
        showError('Debes seleccionar el documento al que aplica el pago.');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('fecha_pago', document.getElementById('seguimientoPagoFecha').value);
        formData.append('valor_pago', document.getElementById('seguimientoPagoValor').value);
        formData.append('tipo_pago', document.getElementById('seguimientoPagoTipo').value);
        formData.append('medio_pago', document.getElementById('seguimientoPagoMedio').value);
        formData.append('canal_transferencia', document.getElementById('seguimientoPagoCanal').value);
        formData.append('fecha_recibo', document.getElementById('seguimientoPagoFechaRecibo').value);
        formData.append('paciente_documento', document.getElementById('seguimientoPagoPacienteDocumento').value.trim());
        formData.append('paciente_nombre', document.getElementById('seguimientoPagoPacienteNombre').value.trim());
        formData.append('fecha_atencion', document.getElementById('seguimientoPagoFechaAtencion').value);
        formData.append('examenes_realizados', document.getElementById('seguimientoPagoExamenesRealizados').value.trim());
        formData.append('observaciones', document.getElementById('seguimientoPagoObservaciones').value.trim());

        const comprobante = document.getElementById('seguimientoPagoComprobante')?.files?.[0];
        if (comprobante) {
            formData.append('comprobante_pago', comprobante);
        }

        const response = await fetch(
            pagoId ? `/api/comercial/seguimiento-pagos/${pagoId}` : `/api/comercial/seguimiento-documentos/${documentoId}/pagos`,
            {
                method: pagoId ? 'PUT' : 'POST',
                credentials: 'include',
                body: formData
            }
        );
        const data = await response.json();
        if (!response.ok) {
            showError(data.error || 'No fue posible guardar el pago.');
            return;
        }

        showSuccess(pagoId ? 'Pago actualizado.' : 'Pago registrado.');
        closeSeguimientoPagoModal();
        await cargarSeguimientoCliente(clienteSeguimientoContext.clienteId);
        setSeguimientoPanelVisible('pagos');
    } catch (error) {
        console.error('Error guardando pago de seguimiento:', error);
        showError('Error de conexión al guardar el pago.');
    }
}

async function eliminarSeguimientoPago(pagoId) {
    if (!confirm('¿Desea eliminar este pago?')) {
        return;
    }

    try {
        const response = await fetch(`/api/comercial/seguimiento-pagos/${pagoId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            showError(data.error || 'No fue posible eliminar el pago.');
            return;
        }

        showSuccess('Pago eliminado.');
        await cargarSeguimientoCliente(clienteSeguimientoContext.clienteId);
        setSeguimientoPanelVisible('pagos');
    } catch (error) {
        console.error('Error eliminando pago de seguimiento:', error);
        showError('Error de conexión al eliminar el pago.');
    }
}

function formatearMedioAutorizacion(medio) {
    const valor = String(medio || '').trim().toUpperCase();
    if (valor === 'PAGINA_WEB') return 'PAGINA WEB';
    if (valor === 'EMAIL') return 'EMAIL';
    if (valor === 'WHATSAPP') return 'WHATSAPP';
    return valor || 'No registrado';
}

function formatearFormaPagoCliente(cliente) {
    const valor = String(cliente?.condicion_comercial || '').trim().toUpperCase();
    if (valor === 'CREDITO') return 'CREDITO';
    if (valor === 'MIXTO') return 'MIXTO';
    return 'EFECTIVO';
}

const COMERCIAL_SECTION_CONFIG = {
    inicio: {
        panels: [],
        focusId: null,
        load: async () => {}
    },
    caja: {
        panels: ['comercialCajaSection'],
        focusId: null,
        load: async () => {}
    },
    registro_atenciones: {
        panels: ['comercialRegistroAtencionesSection'],
        focusId: 'comercialRegistroAtencionesSection',
        load: async () => { await inicializarRegistroAtenciones(); }
    },
    vendedores: {
        panels: ['comercialVendedoresSection'],
        focusId: 'comercialVendedoresPanel',
        load: () => cargarVendedoresConfig(),
        openNew: () => mostrarAgregarVendedor(),
        consultaPanelId: 'comercialVendedoresPanel',
        inputId: 'comercialVendedoresSearch',
        resultsId: 'comercialVendedoresResults',
        summaryId: 'comercialVendedoresResumen',
        prompt: 'Escribe para buscar un vendedor.',
        getItems: () => vendedoresConfigData,
        matchFields: item => [item.nombre, item.documento, item.email, item.telefono, item.usuario_login, item.usuario_nombre],
        renderResult: item => ({
            title: item.nombre || 'Vendedor sin nombre',
            subtitle: [item.documento || 'Sin documento', item.email || '', item.telefono || ''].filter(Boolean).join(' · '),
            meta: `Comisión venta ${Number(item.porcentaje_comision_venta || 0).toFixed(2)}% · Comisión recaudo ${Number(item.porcentaje_comision_recaudo || 0).toFixed(2)}%`,
            estado: item.activo ? 'Activo' : 'Inactivo',
            detail: item.usuario_login
                ? `Ingresa al sistema con el usuario: ${item.usuario_login}`
                : 'Sin usuario de acceso asignado'
        }),
        edit: id => editarVendedorConfig(id)
    },
    comisiones: {
        panels: ['comercialComisionesSection'],
        focusId: 'comercialComisionesSection',
        load: () => inicializarPanelComisiones()
    },
    examenes: {
        panels: ['comercialCatalogoSection'],
        focusId: 'comercialCatalogoPanel',
        load: () => cargarCatalogoComercialConfig(),
        openNew: () => mostrarAgregarItemCatalogoComercial(),
        consultaPanelId: 'comercialCatalogoPanel',
        inputId: 'comercialCatalogoSearch',
        resultsId: 'comercialCatalogoResults',
        summaryId: 'comercialCatalogoResumen',
        prompt: 'Escribe para buscar un examen o paquete.',
        getItems: () => catalogoComercialData,
        matchFields: item => [item.nombre, item.codigo, item.tipo_item, item.clasificacion_resumen, item.descripcion, item.resumen_componentes],
        renderResult: item => ({
            title: item.nombre || 'Item sin nombre',
            subtitle: [item.codigo || 'Sin código', item.tipo_item === 'EXAMEN' ? obtenerResumenClasificacionCatalogo(item) : (item.tipo_item || '')].filter(Boolean).join(' · '),
            meta: `${item.tipo_item || 'ITEM'} · ${formatCurrency(item.tarifa_base || 0)} · ${item.activo ? 'Activo' : 'Inactivo'}`,
            estado: item.tipo_item === 'EXAMEN' && item.clasificacion_completa !== true ? 'Pendiente de clasificar' : '',
            detail: item.tipo_item === 'PAQUETE'
                ? `Incluye ${item.cantidad_componentes || 0} examen(es): ${item.resumen_componentes || 'Sin exámenes definidos'}`
                : ''
        }),
        edit: id => editarItemCatalogoComercial(id)
    },
    clientes: {
        panels: ['comercialClientesSection'],
        focusId: 'comercialClientesPanel',
        load: () => Promise.all([cargarClientesComercialesConfig(), cargarTarifasComercialesConfig()]),
        openNew: () => mostrarAgregarClienteComercial(),
        consultaPanelId: 'comercialClientesPanel',
        inputId: 'comercialClientesSearch',
        resultsId: 'comercialClientesResults',
        summaryId: 'comercialClientesResumen',
        prompt: 'Escribe para buscar un cliente.',
        getItems: () => clientesComercialesData,
        matchFields: item => [item.razon_social, item.nombre_comercial, item.nit, item.vendedor_nombre, item.contacto_principal, item.cargo_contacto_principal, item.contacto_facturacion, item.cargo_contacto_facturacion, item.email_empresa, item.medio_autorizacion, item.estado_cliente],
        renderResult: item => ({
            title: item.razon_social || item.nombre_comercial || 'Cliente sin nombre',
            subtitle: [item.nit || 'Sin NIT', item.vendedor_nombre || 'Sin vendedor'].filter(Boolean).join(' · '),
            meta: [obtenerContactoPreferidoCliente(item) || 'Sin contacto', formatearMedioAutorizacion(item.medio_autorizacion), formatearFormaPagoCliente(item)].filter(Boolean).join(' · '),
            estado: formatearEstadoCliente(obtenerEstadoCliente(item))
        }),
        edit: id => editarClienteComercial(id)
    },
    mes: {
        panels: [],
        focusId: 'comercialMesPanel',
        load: async () => {
            await loadComercialDashboard();
        }
    }
};

function resetConsultaComercial(sectionName) {
    const config = getComercialSectionConfig(sectionName);
    if (!config?.consultaPanelId) return;

    const panel = document.getElementById(config.consultaPanelId);
    const input = document.getElementById(config.inputId);
    const results = document.getElementById(config.resultsId);
    const summary = document.getElementById(config.summaryId);

    if (panel) panel.style.display = 'none';
    if (input) input.value = '';
    if (input) input.dataset.showAll = 'false';
    if (summary) summary.textContent = config.prompt;
    if (results) results.innerHTML = `<div class="loading">${escapeHtml(config.prompt)}</div>`;
    actualizarBotonVerTodosConsultaComercial(sectionName);
}

function actualizarBotonVerTodosConsultaComercial(sectionName) {
    if (sectionName !== 'examenes') return;

    const input = document.getElementById('comercialCatalogoSearch');
    if (!input) return;

    let button = document.getElementById('comercialCatalogoToggleAllBtn');
    if (!button) {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = 'flex-end';
        wrapper.style.marginTop = '8px';

        button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary';
        button.id = 'comercialCatalogoToggleAllBtn';
        button.onclick = () => toggleVerTodosConsultaComercial('examenes');

        const label = document.createElement('span');
        label.className = 'btn-label';
        button.appendChild(label);
        wrapper.appendChild(button);
        input.insertAdjacentElement('afterend', wrapper);
    }

    const showAll = input.dataset.showAll === 'true';
    const label = button.querySelector('.btn-label');
    if (label) {
        label.textContent = showAll ? 'Ver menos' : 'Ver todos';
    }
}

function toggleVerTodosConsultaComercial(sectionName) {
    if (sectionName !== 'examenes') return;

    const input = document.getElementById('comercialCatalogoSearch');
    if (!input) return;

    input.dataset.showAll = input.dataset.showAll === 'true' ? 'false' : 'true';
    actualizarBotonVerTodosConsultaComercial(sectionName);
    renderConsultaComercialResults(sectionName, input.value || '');
}

function renderConsultaComercialResults(sectionName, query = '') {
    const config = getComercialSectionConfig(sectionName);
    const results = document.getElementById(config.resultsId);
    const summary = document.getElementById(config.summaryId);
    if (!results || !summary) return;

    const normalizedQuery = String(query || '').trim().toLowerCase();
    const input = document.getElementById(config.inputId);
    const showAll = input?.dataset.showAll === 'true';
    actualizarBotonVerTodosConsultaComercial(sectionName);
    if (!normalizedQuery) {
        summary.textContent = config.prompt;
        results.innerHTML = `<div class="loading">${escapeHtml(config.prompt)}</div>`;
        return;
    }

    const rawItems = (typeof config.getItems === 'function') ? config.getItems() : [];
    const items = Array.isArray(rawItems) ? rawItems : [];
    const matchFn = (typeof config.matchFields === 'function')
        ? config.matchFields
        : (item => [item && item.nombre]);
    const filtered = items.filter(item => {
        const campos = matchFn(item) || [];
        return campos.some(value => String(value || '').toLowerCase().includes(normalizedQuery));
    });

    if (filtered.length === 0) {
        summary.textContent = 'No encontramos resultados con esa búsqueda.';
        results.innerHTML = '<div class="comercial-search-empty">No hay coincidencias. Prueba con otro nombre, código, documento o contacto.</div>';
        return;
    }

    const visibleItems = (!showAll && sectionName === 'examenes')
        ? filtered.slice(0, 30)
        : filtered;

    summary.textContent = `${filtered.length} resultado(s). Selecciona uno para abrir su ficha.`;
    const truncatedNotice = (!showAll && sectionName === 'examenes' && filtered.length > visibleItems.length)
        ? `<div class="comercial-search-meta" style="margin-bottom:8px;">Mostrando ${visibleItems.length} de ${filtered.length} resultados. Usa "Ver todos" para abrir el listado completo.</div>`
        : '';
    results.innerHTML = truncatedNotice + visibleItems.map(item => {
        let view;
        try {
            view = config.renderResult(item) || {};
        } catch (err) {
            console.error('Error renderizando resultado comercial:', err, item);
            view = { title: item && (item.nombre || item.razon_social) || 'Registro' };
        }
        const parts = [
            `<strong>${escapeHtml(view.title || 'Registro')}</strong>`,
            view.subtitle ? `<div class="comercial-search-subtitle">${escapeHtml(view.subtitle)}</div>` : '',
            view.meta ? `<div class="comercial-search-meta">${escapeHtml(view.meta)}</div>` : '',
            view.estado ? `<div class="comercial-search-meta">${escapeHtml(view.estado)}</div>` : '',
            view.detail ? `<div class="comercial-search-detail">${escapeHtml(view.detail)}</div>` : ''
        ].join('');

        return `
            <button type="button" class="comercial-search-item" onclick="abrirResultadoConsultaComercial('${sectionName}', ${Number(item.id)})">
                ${parts}
            </button>
        `;
    }).join('');
}

async function abrirConsultaComercial(sectionName) {
    const config = getComercialSectionConfig(sectionName);
    if (!config?.consultaPanelId) return;

    try {
        await config.load();
    } catch (error) {
        console.error(`Error cargando consulta comercial ${sectionName}:`, error);
    }

    const panel = document.getElementById(config.consultaPanelId);
    const input = document.getElementById(config.inputId);
    if (panel) panel.style.display = 'block';
    renderConsultaComercialResults(sectionName, '');
    if (input) input.focus();
    window.setTimeout(() => focusModuleSection(config.consultaPanelId), 120);
}

function filtrarConsultaComercial(sectionName) {
    const config = getComercialSectionConfig(sectionName);
    const query = document.getElementById(config.inputId)?.value || '';
    renderConsultaComercialResults(sectionName, query);
}

function abrirResultadoConsultaComercial(sectionName, id) {
    const config = getComercialSectionConfig(sectionName);
    if (typeof config.edit === 'function') {
        config.edit(Number(id));
    }
}

function normalizarTextoConvenioRecepcion(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
}

function separarTokensConvenioRecepcion(value) {
    return String(value || '')
        .split(/[\n,;]+/)
        .map(token => token.trim())
        .filter(Boolean);
}

function construirItemsConvenioRecepcionFallback(cliente, tarifasCliente, catalogo) {
    const itemsCatalogo = Array.isArray(catalogo) ? catalogo : [];
    const tarifasActivas = Array.isArray(tarifasCliente)
        ? tarifasCliente.filter(tarifa => tarifa && tarifa.activo !== false)
        : [];
    const itemsResultado = new Map();
    const catalogoMap = new Map(itemsCatalogo.map(item => [String(item.id), item]));

    if (tarifasActivas.length > 0) {
        tarifasActivas.forEach(tarifa => {
            const itemCatalogo = catalogoMap.get(String(tarifa.catalogo_item_id));
            const itemNormalizado = {
                id: tarifa.catalogo_item_id || itemCatalogo?.id || null,
                tipo_item: tarifa.tipo_item || itemCatalogo?.tipo_item || 'EXAMEN',
                nombre: tarifa.item_nombre || itemCatalogo?.nombre || 'Item convenido',
                valor_unitario: Number(tarifa.tarifa_negociada || tarifa.tarifa_base || itemCatalogo?.tarifa_base || 0),
                clasificacion_resumen: tarifa.clasificacion_resumen || itemCatalogo?.clasificacion_resumen || '',
                componentes: Array.isArray(itemCatalogo?.componentes)
                    ? itemCatalogo.componentes.map(componente => componente?.nombre || '').filter(Boolean)
                    : [],
                vigencia_desde: tarifa.vigencia_desde || null,
                vigencia_hasta: tarifa.vigencia_hasta || null
            };
            const itemKey = itemNormalizado.id != null ? String(itemNormalizado.id) : `tarifa-${tarifa.id || itemNormalizado.nombre}`;
            itemsResultado.set(itemKey, itemNormalizado);
        });
    }

    const itemsPorClave = new Map();
    itemsCatalogo.forEach(item => {
        [item?.nombre, item?.codigo].forEach(valor => {
            const clave = normalizarTextoConvenioRecepcion(valor);
            if (clave) itemsPorClave.set(clave, item);
        });
    });

    const idsPermitidos = new Set();
    separarTokensConvenioRecepcion(cliente?.examenes_convenidos).forEach(token => {
        const item = itemsPorClave.get(normalizarTextoConvenioRecepcion(token));
        if (item && item.tipo_item === 'EXAMEN') {
            idsPermitidos.add(item.id);
        }
    });
    separarTokensConvenioRecepcion(cliente?.servicios_convenidos).forEach(token => {
        const item = itemsPorClave.get(normalizarTextoConvenioRecepcion(token));
        if (item && item.tipo_item !== 'EXAMEN') {
            idsPermitidos.add(item.id);
        }
    });

    itemsCatalogo
        .filter(item => idsPermitidos.has(item.id))
        .forEach(item => {
            const itemKey = String(item.id);
            const previo = itemsResultado.get(itemKey);
            itemsResultado.set(itemKey, {
                id: item.id,
                tipo_item: item.tipo_item || previo?.tipo_item || 'EXAMEN',
                nombre: item.nombre || previo?.nombre || 'Item convenido',
                valor_unitario: Number(previo?.valor_unitario || item.tarifa_base || 0),
                clasificacion_resumen: item.clasificacion_resumen || previo?.clasificacion_resumen || '',
                componentes: Array.isArray(item.componentes)
                    ? item.componentes.map(componente => componente?.nombre || '').filter(Boolean)
                    : (previo?.componentes || []),
                vigencia_desde: previo?.vigencia_desde || null,
                vigencia_hasta: previo?.vigencia_hasta || null
            });
        });

    return Array.from(itemsResultado.values()).sort((a, b) => {
        const tipoA = a.tipo_item === 'EXAMEN' ? 0 : 1;
        const tipoB = b.tipo_item === 'EXAMEN' ? 0 : 1;
        if (tipoA !== tipoB) return tipoA - tipoB;
        return (a.nombre || '').localeCompare(b.nombre || '');
    });
}

async function cargarConvenioRecepcionCliente(clienteId) {
    const response = await fetch(`/api/comercial/clientes/${clienteId}/convenio-items`, {
        credentials: 'include'
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'No se pudieron cargar los items convenidos del cliente');
    }
    return Array.isArray(data) ? data : [];
}

function construirTarjetasRecepcionCliente(cliente, convenioItems) {
    const items = Array.isArray(convenioItems) ? convenioItems : [];
    const examenes = items
        .filter(item => item?.tipo_item === 'EXAMEN')
        .sort((a, b) => (a?.nombre || '').localeCompare(b?.nombre || ''));
    const paquetes = items
        .filter(item => item?.tipo_item !== 'EXAMEN')
        .sort((a, b) => (a?.nombre || '').localeCompare(b?.nombre || ''));

    const notasConvenio = [
        cliente?.tarifas_convenidas ? `Observaciones de tarifa: ${cliente.tarifas_convenidas}` : ''
    ].filter(Boolean);

    if (examenes.length === 0 && paquetes.length === 0) {
        const notaHtml = notasConvenio.length > 0
            ? `<div class="recepcion-convenio-notes">${notasConvenio.map(texto => `<div class="recepcion-cliente-item-meta">${escapeHtml(texto)}</div>`).join('')}</div>`
            : '';
        return `<div class="loading">Este cliente no tiene examenes o paquetes convenidos registrados.</div>${notaHtml}`;
    }

    const examenesHtml = examenes.length > 0
        ? `<ol class="recepcion-convenio-list">${examenes.map(item => `
                <li class="recepcion-convenio-row">
                    <div class="recepcion-convenio-item-copy">
                        <strong>${escapeHtml(item.nombre || 'Examen convenido')}</strong>
                    </div>
                    <div class="recepcion-cliente-item-price">${formatCurrency(item.valor_unitario || 0)}</div>
                </li>
            `).join('')}</ol>`
        : '<div class="recepcion-convenio-empty">Este cliente no tiene examenes convenidos.</div>';

    const paquetesHtml = paquetes.length > 0
        ? `<ol class="recepcion-paquetes-list">${paquetes.map((item, index) => {
            const componentes = Array.isArray(item.componentes) ? item.componentes.filter(Boolean) : [];
            return `
                <li class="recepcion-paquete-card">
                    <strong>${escapeHtml(item.nombre || `Paquete ${index + 1}`)}</strong>
                    ${componentes.length > 0
                        ? `<ol class="recepcion-paquete-list">${componentes.map(componente => `<li>${escapeHtml(componente)}</li>`).join('')}</ol>`
                        : '<div class="recepcion-cliente-item-meta">Paquete sin componentes detallados.</div>'}
                </li>
            `;
        }).join('')}</ol>`
        : '<div class="recepcion-convenio-empty">Este cliente no tiene paquetes convenidos.</div>';

    const notasHtml = notasConvenio.length > 0
        ? `<div class="recepcion-convenio-notes">${notasConvenio.map(texto => `<div class="recepcion-cliente-item-meta">${escapeHtml(texto)}</div>`).join('')}</div>`
        : '';

    return `
        <div class="recepcion-convenio-columns">
            <div class="recepcion-convenio-column">
                <div class="recepcion-convenio-column-header">
                    <h5>Examenes</h5>
                    <span class="recepcion-convenio-count">${examenes.length}</span>
                </div>
                ${examenesHtml}
            </div>
            <div class="recepcion-convenio-column">
                <div class="recepcion-convenio-column-header">
                    <h5>Paquetes</h5>
                    <span class="recepcion-convenio-count">${paquetes.length}</span>
                </div>
                ${paquetesHtml}
            </div>
        </div>
        ${notasHtml}
    `;
}

async function abrirClienteRecepcion(id) {
    let cliente = (clientesComercialesData || []).find(item => Number(item.id) === Number(id));
    if (!cliente) {
        await asegurarClientesComerciales();
        cliente = (clientesComercialesData || []).find(item => Number(item.id) === Number(id));
    }
    if (!cliente) {
        showError('No fue posible cargar el cliente seleccionado.');
        return;
    }

    try {
        const [tarifas, catalogo] = await Promise.all([
            asegurarTarifasComerciales(),
            asegurarCatalogoComercial()
        ]);
        const tarifasCliente = (tarifas || [])
            .filter(tarifa => String(tarifa.cliente_id) === String(cliente.id) && tarifa.activo !== false)
            .sort((a, b) => (a.item_nombre || '').localeCompare(b.item_nombre || ''));
        let convenioItems = [];
        try {
            convenioItems = await cargarConvenioRecepcionCliente(cliente.id);
        } catch (convenioError) {
            console.warn('No se pudo cargar convenio detallado para recepcion, se usa respaldo local.', convenioError);
            convenioItems = construirItemsConvenioRecepcionFallback(cliente, tarifasCliente, catalogo);
        }

        recepcionClienteActivoId = Number(cliente.id);

        const detallePanel = document.getElementById('recepcionClienteDetalle');
        const consultaPanel = document.getElementById('recepcionConsultaPanel');
        const titulo = document.getElementById('recepcionClienteDetalleTitulo');
        const estadoBadge = document.getElementById('recepcionClienteEstadoBadge');
        const medioAutorizacion = document.getElementById('recepcionClienteMedioAutorizacion');
        const formaPago = document.getElementById('recepcionClienteFormaPago');
        const puntos = document.getElementById('recepcionClientePuntosAtencion');
        const contacto = document.getElementById('recepcionClienteContactoPrincipal');
        const celular = document.getElementById('recepcionClienteCelularPrincipal');
        const items = document.getElementById('recepcionClienteItems');
        const estado = obtenerEstadoCliente(cliente);

        if (titulo) {
            titulo.textContent = cliente.razon_social || cliente.nombre_comercial || 'Cliente';
        }
        if (estadoBadge) {
            estadoBadge.textContent = formatearEstadoCliente(estado);
            estadoBadge.className = `recepcion-estado-badge ${obtenerClaseEstadoCliente(estado)}`;
        }
        if (medioAutorizacion) {
            medioAutorizacion.textContent = formatearMedioAutorizacion(cliente.medio_autorizacion);
        }
        if (formaPago) {
            formaPago.textContent = formatearFormaPagoCliente(cliente);
        }
        if (puntos) {
            puntos.textContent = obtenerAnotacionesRecepcionCliente(cliente) || 'Sin anotaciones especiales registradas.';
        }
        if (contacto) {
            contacto.textContent = formatearNombreContactoCliente(cliente.contacto_principal, cliente.cargo_contacto_principal)
                || formatearNombreContactoCliente(cliente.contacto_facturacion, cliente.cargo_contacto_facturacion)
                || 'Sin contacto registrado.';
        }
        if (celular) {
            celular.textContent = [
                cliente.celular_contacto_principal || cliente.celular_facturacion || '',
                cliente.email_contacto_principal || cliente.email_facturacion || cliente.email_empresa || ''
            ].filter(Boolean).join(' · ') || 'Sin celular registrado.';
        }
        if (items) {
            items.innerHTML = construirTarjetasRecepcionCliente(cliente, convenioItems);
        }
        if (consultaPanel) consultaPanel.style.display = 'none';
        if (detallePanel) detallePanel.style.display = 'block';
        window.setTimeout(() => focusModuleSection('recepcionClienteDetalle'), 120);
        actualizarResumenPendientesCatalogo();
    } catch (error) {
        console.error('Error abriendo cliente en recepcion:', error);
        showError(error.message || 'No fue posible cargar la guia del cliente.');
    }
}

function setupUsuariosModule() {
    const usuarioForm = document.getElementById('usuarioForm');
    if (usuarioForm && !usuarioForm.dataset.bound) {
        usuarioForm.addEventListener('submit', guardarUsuario);
        usuarioForm.dataset.bound = 'true';
    }

    const rolForm = document.getElementById('rolForm');
    if (rolForm && !rolForm.dataset.bound) {
        rolForm.addEventListener('submit', guardarRol);
        rolForm.dataset.bound = 'true';
    }
}

async function loadUsuariosManagement() {
    await Promise.allSettled([
        loadMenuOptions(),
        loadRoles(),
        loadUsuarios()
    ]);
}

async function fetchUsuariosEndpoint(url, options = {}) {
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 8000);

        try {
            const response = await fetch(url, {
                ...options,
                credentials: 'include',
                cache: 'no-store',
                signal: controller.signal
            });
            const data = await response.json();

            // El limite de espera cubre tambien la lectura del JSON. Algunos
            // navegadores conservan una respuesta pendiente aunque el servidor ya respondio.
            response.json = async () => data;
            return response;
        } catch (error) {
            lastError = error;
            if (attempt === 0) {
                await new Promise(resolve => window.setTimeout(resolve, 300));
            }
        } finally {
            window.clearTimeout(timeout);
        }
    }

    throw new Error(
        lastError?.name === 'AbortError'
            ? 'La consulta de usuarios tardo demasiado. Intente nuevamente.'
            : 'No fue posible conectar con el modulo de usuarios.'
    );
}

async function loadUsuarios() {
    const tableBody = document.getElementById('usuariosTable');
    if (!tableBody) return;

    try {
        const response = await fetchUsuariosEndpoint('/api/usuarios/');
        const usuarios = await response.json();

        if (!response.ok) {
            throw new Error(usuarios.error || 'No se pudo cargar la lista de usuarios');
        }

        // El usuario EASY no es visible para nadie excepto para sí mismo
        const visibles = usuarios.filter(u => !u.is_easy || currentUser?.is_easy);

        if (visibles.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6" class="loading">No hay usuarios registrados</td></tr>';
            return;
        }

        tableBody.innerHTML = visibles.map(user => {
            const esEasy = Boolean(user.is_easy);
            const tienePermisosExtra = (user.permisos_extra_ids || []).length > 0;
            const badgeEasy = esEasy
                ? '<span class="badge badge-warning" title="Superusuario del sistema">EASY</span> '
                : '';
            const badgeExtra = tienePermisosExtra
                ? `<span class="badge badge-info" title="${(user.permisos_extra_ids || []).length} permiso(s) extra">${(user.permisos_extra_ids || []).length} extra</span> `
                : '';
            return `
                <tr>
                    <td>${badgeEasy}${escapeHtml(user.usuario || 'N/A')}</td>
                    <td>${escapeHtml(user.nombre_completo || 'N/A')}</td>
                    <td>${escapeHtml(user.email || 'N/A')}</td>
                    <td>${escapeHtml(user.role || 'N/A')}${badgeExtra}</td>
                    <td>
                        <span class="badge ${user.activo ? 'badge-success' : 'badge-danger'}">
                            ${user.activo ? 'Activo' : 'Inactivo'}
                        </span>
                    </td>
                    <td>
                        ${!esEasy ? `<button class="action-btn action-btn-edit" onclick="editUsuario(${user.id})">Editar</button>` : ''}
                        ${!esEasy ? `<button class="action-btn" onclick='resetUsuarioPassword(${user.id}, ${JSON.stringify(user.usuario || "")})'>Restablecer clave</button>` : ''}
                        <button class="action-btn action-btn-edit" onclick="editPermisosExtraUsuario(${user.id}, ${JSON.stringify(user.usuario || '')})">Permisos extra</button>
                        ${!esEasy && user.usuario !== 'admin' ? `<button class="action-btn action-btn-delete" onclick='deleteUsuario(${user.id}, ${JSON.stringify(user.usuario || '')})'>Desactivar</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error cargando usuarios:', error);
        tableBody.innerHTML = `<tr><td colspan="6" class="loading">${escapeHtml(error.message || 'Error al cargar usuarios')}</td></tr>`;
    }
}

async function loadMenuOptions() {
    const embeddedOptions = loadEmbeddedRoleMenuOptions();
    if (embeddedOptions.length) {
        menuOptionsData = embeddedOptions;
        return;
    }

    try {
        const response = await fetchUsuariosEndpoint('/api/usuarios/menu-options');
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'No se pudieron cargar las opciones del menú');
        }

        menuOptionsData = Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('Error cargando opciones del menú para roles:', error);
        menuOptionsData = [];
    }
}

function fillRoleSelect(selectedId = '') {
    const select = document.getElementById('usuarioRoleId');
    if (!select) return;

    select.innerHTML = '<option value="">Seleccione un rol...</option>';
    rolesData.forEach(role => {
        const option = document.createElement('option');
        option.value = role.id;
        option.textContent = role.nombre;
        select.appendChild(option);
    });
    if (selectedId) {
        select.value = String(selectedId);
    }
}

function getSelectedRolePermissionIds() {
    const permissionNames = new Set();
    document.querySelectorAll('#rolMenuPermissions input[data-permission-names]:checked').forEach(input => {
        try {
            JSON.parse(input.dataset.permissionNames || '[]').forEach(permissionName => {
                if (permissionName) permissionNames.add(String(permissionName));
            });
        } catch (error) {
            if (input.value) permissionNames.add(input.value);
        }
    });
    return Array.from(permissionNames);
}

async function showNewUserForm() {
    document.getElementById('usuarioForm').reset();
    document.getElementById('usuarioId').value = '';
    document.getElementById('usuarioModalTitle').textContent = 'Nuevo Usuario';
    document.getElementById('usuarioActivo').checked = true;
    await loadRoles();
    fillRoleSelect();
    document.getElementById('usuarioModal').classList.add('active');
}

function closeUsuarioModal() {
    document.getElementById('usuarioModal').classList.remove('active');
}

async function editUsuario(id) {
    try {
        if (!rolesData.length) {
            await loadRoles();
        }

        const response = await fetch(`/api/usuarios/${id}`, { credentials: 'include' });
        const user = await response.json();
        if (!response.ok) {
            return showError(user.error || 'No se pudo cargar el usuario');
        }

        document.getElementById('usuarioId').value = user.id;
        document.getElementById('usuarioModalTitle').textContent = 'Editar Usuario';
        document.getElementById('usuarioLogin').value = user.usuario || '';
        document.getElementById('usuarioNombreCompleto').value = user.nombre_completo || '';
        document.getElementById('usuarioEmail').value = user.email || '';
        document.getElementById('usuarioPassword').value = '';
        document.getElementById('usuarioActivo').checked = user.activo !== false;
        fillRoleSelect(user.role_id || '');
        document.getElementById('usuarioModal').classList.add('active');
    } catch (error) {
        console.error('Error cargando usuario:', error);
        showError('No se pudo cargar el usuario.');
    }
}

async function guardarUsuario(event) {
    event.preventDefault();
    const id = document.getElementById('usuarioId').value;
    const payload = {
        usuario: document.getElementById('usuarioLogin').value.trim(),
        nombre_completo: document.getElementById('usuarioNombreCompleto').value.trim(),
        email: document.getElementById('usuarioEmail').value.trim(),
        role_id: document.getElementById('usuarioRoleId').value,
        activo: document.getElementById('usuarioActivo').checked
    };
    const password = document.getElementById('usuarioPassword').value;
    if (password) {
        payload.password = password;
    }

    try {
        const response = await fetch(id ? `/api/usuarios/${id}` : '/api/usuarios/', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) {
            return showError(data.error || 'Error al guardar usuario');
        }

        showSuccess(id ? 'Usuario actualizado' : 'Usuario creado');
        closeUsuarioModal();
        await loadUsuariosManagement();
        if (currentUser && String(currentUser.usuario_id) === String(id)) {
            await refreshCurrentUserContext();
        }
    } catch (error) {
        console.error('Error guardando usuario:', error);
        showError('Error de conexión al guardar usuario');
    }
}

async function deleteUsuario(id, username) {
    if (!confirm(`¿Está seguro de desactivar al usuario ${username}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/usuarios/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            return showError(data.error || 'Error al desactivar usuario');
        }

        showSuccess('Usuario desactivado');
        await loadUsuarios();
    } catch (error) {
        console.error('Error desactivando usuario:', error);
        showError('Error de conexión al desactivar usuario');
    }
}

async function resetUsuarioPassword(id, username) {
    if (!confirm(`Se generara una nueva clave temporal para ${username}. La clave anterior dejara de funcionar. Desea continuar?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/usuarios/${id}/reset-password`, {
            method: 'POST',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            return showError(data.error || 'Error al restablecer la clave');
        }

        const passwordTemporal = data.password_temporal || '';
        let copied = false;

        if (passwordTemporal && navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(passwordTemporal);
                copied = true;
            } catch (error) {
                console.warn('No se pudo copiar la clave temporal al portapapeles:', error);
            }
        }

        if (passwordTemporal) {
            const promptMessage = copied
                ? `Clave temporal de ${username}. Ya quedo copiada al portapapeles:`
                : `Clave temporal de ${username}. Copiela y compartala con el usuario:`;
            window.prompt(promptMessage, passwordTemporal);
        }

        showSuccess(copied ? 'Clave temporal generada y copiada.' : 'Clave temporal generada.');
    } catch (error) {
        console.error('Error restableciendo clave:', error);
        showError('Error de conexion al restablecer la clave');
    }
}

// ==================== PERMISOS EXTRA POR USUARIO ====================

let _permisosExtraModalUsuarioId = null;

async function editPermisosExtraUsuario(id, username) {
    _permisosExtraModalUsuarioId = id;

    if (!menuOptionsData.length) {
        await loadMenuOptions();
    }

    try {
        const response = await fetch(`/api/usuarios/${id}/permisos-extra`, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) {
            return showError(data.error || 'No se pudieron cargar los permisos extra');
        }

        const selectedIds = new Set((data.permisos_extra || []).map(p => String(p.id)));
        _renderPermisosExtraModal(username, selectedIds);
        document.getElementById('permisosExtraModal').classList.add('active');
    } catch (error) {
        console.error('Error cargando permisos extra:', error);
        showError('Error de conexión al cargar permisos extra');
    }
}

function _renderPermisosExtraModal(username, selectedIds = new Set()) {
    const title = document.getElementById('permisosExtraModalTitle');
    const container = document.getElementById('permisosExtraContainer');
    if (!title || !container) return;

    title.textContent = `Permisos extra — ${username}`;

    if (!menuOptionsData.length) {
        container.innerHTML = '<div class="loading">No se pudieron cargar los permisos disponibles.</div>';
        return;
    }

    // Agrupar igual que en el modal de roles
    const menuOptions = menuOptionsData.filter(o => o.category !== 'comercial');
    const commercialGroups = {};
    menuOptionsData.filter(o => o.category === 'comercial').forEach(o => {
        const key = o.group || 'Comercial';
        commercialGroups[key] = commercialGroups[key] || [];
        commercialGroups[key].push(o);
    });

    const renderOption = o => `
        <label class="role-menu-option">
            <input type="checkbox" name="permiso_extra" value="${o.permiso_id}"
                ${selectedIds.has(String(o.permiso_id)) ? 'checked' : ''}>
            <div>
                <strong>${escapeHtml(o.nombre || o.group || 'Permiso')}</strong>
                <span>${escapeHtml(o.descripcion || '')}</span>
            </div>
        </label>
    `;

    container.innerHTML = `
        <p class="form-help" style="margin-bottom:12px;">
            Estos permisos se suman a los del rol del usuario. Úselos para dar acceso puntual
            sin cambiar el rol completo.
        </p>
        <div style="margin-bottom:14px;">
            <h4 style="margin:0 0 8px 0;">Menú lateral</h4>
            <div class="role-menu-grid">${menuOptions.map(renderOption).join('')}</div>
        </div>
        <div>
            <h4 style="margin:0 0 8px 0;">Permisos comerciales</h4>
            ${Object.entries(commercialGroups).map(([groupName, options]) => `
                <div style="margin-bottom:12px;">
                    <div style="font-weight:700; margin-bottom:6px;">${escapeHtml(groupName)}</div>
                    <div class="role-menu-grid">${options.map(renderOption).join('')}</div>
                </div>
            `).join('')}
        </div>
    `;
}

async function guardarPermisosExtra() {
    if (!_permisosExtraModalUsuarioId) return;

    const checkboxes = document.querySelectorAll('#permisosExtraContainer input[name="permiso_extra"]:checked');
    const permiso_ids = Array.from(checkboxes).map(cb => Number(cb.value));

    try {
        const response = await fetch(`/api/usuarios/${_permisosExtraModalUsuarioId}/permisos-extra`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ permiso_ids }),
        });
        const data = await response.json();
        if (!response.ok) {
            return showError(data.error || 'Error al guardar permisos extra');
        }

        showSuccess('Permisos extra actualizados');
        closePermisosExtraModal();
        await loadUsuarios();

        // Si el usuario editado es el actual, refrescar contexto
        if (currentUser && String(currentUser.usuario_id) === String(_permisosExtraModalUsuarioId)) {
            await refreshCurrentUserContext();
        }
    } catch (error) {
        console.error('Error guardando permisos extra:', error);
        showError('Error de conexión al guardar permisos extra');
    }
}

function closePermisosExtraModal() {
    const modal = document.getElementById('permisosExtraModal');
    if (modal) modal.classList.remove('active');
    _permisosExtraModalUsuarioId = null;
}

async function showNewRoleForm() {
    document.getElementById('rolForm').reset();
    document.getElementById('rolId').value = '';
    document.getElementById('rolModalTitle').textContent = 'Nuevo Rol';
    document.getElementById('rolMenuPermissions').innerHTML = '<div class="loading">Cargando menus y subopciones...</div>';
    document.getElementById('rolModal').classList.add('active');

    if (!menuOptionsData.length) {
        await loadMenuOptions();
    }
    renderRoleMenuPermissions();
}

function closeRolModal() {
    document.getElementById('rolModal').classList.remove('active');
}

async function editRole(id) {
    if (!rolesData.length) {
        await loadRoles();
    }
    if (!menuOptionsData.length) {
        await loadMenuOptions();
    }

    const role = rolesData.find(item => Number(item.id) === Number(id));
    if (!role) {
        return showError('No se pudo localizar el rol seleccionado.');
    }

    document.getElementById('rolId').value = role.id;
    document.getElementById('rolModalTitle').textContent = 'Editar Rol';
    document.getElementById('rolNombre').value = role.nombre || '';
    document.getElementById('rolDescripcion').value = role.descripcion || '';
    renderRoleMenuPermissions(role.permission_names || role.menu_permission_ids || []);
    document.getElementById('rolModal').classList.add('active');
}

async function guardarRol(event) {
    event.preventDefault();
    const id = document.getElementById('rolId').value;
    const payload = {
        nombre: document.getElementById('rolNombre').value.trim(),
        descripcion: document.getElementById('rolDescripcion').value.trim(),
        menu_permission_ids: getSelectedRolePermissionIds()
    };

    try {
        const response = await fetch(id ? `/api/usuarios/roles/${id}` : '/api/usuarios/roles', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) {
            return showError(data.error || 'Error al guardar rol');
        }

        showSuccess(id ? 'Rol actualizado' : 'Rol creado');
        closeRolModal();
        await Promise.all([loadRoles(), loadUsuarios()]);
        await refreshCurrentUserContext();
    } catch (error) {
        console.error('Error guardando rol:', error);
        showError('Error de conexión al guardar rol');
    }
}

async function deleteRole(id, roleName) {
    if (!confirm(`¿Está seguro de eliminar el rol ${roleName}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/usuarios/roles/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            return showError(data.error || 'Error al eliminar rol');
        }

        showSuccess('Rol eliminado');
        await Promise.all([loadRoles(), loadUsuarios()]);
    } catch (error) {
        console.error('Error eliminando rol:', error);
        showError('Error de conexión al eliminar rol');
    }
}

function closeEmpleadoModal() {
    document.getElementById('empleadoModal').classList.remove('active');
}

// Setup Form Handlers
function setupEstructuraLaboralForms() {
    const clienteComercialForm = document.getElementById('clienteComercialForm');
    if (clienteComercialForm && !clienteComercialForm.dataset.bound) {
        clienteComercialForm.addEventListener('submit', guardarClienteComercialConfig);
        clienteComercialForm.dataset.bound = 'true';
    }

    const catalogoComercialForm = document.getElementById('catalogoComercialForm');
    if (catalogoComercialForm && !catalogoComercialForm.dataset.bound) {
        catalogoComercialForm.addEventListener('submit', guardarCatalogoComercialConfig);
        catalogoComercialForm.dataset.bound = 'true';
    }

    const catalogoComercialTipo = document.getElementById('catalogoComercialTipo');
    if (catalogoComercialTipo && !catalogoComercialTipo.dataset.bound) {
        catalogoComercialTipo.addEventListener('change', () => {
            actualizarVisibilidadComponentesCatalogo();
        });
        catalogoComercialTipo.dataset.bound = 'true';
    }

    const catalogoComercialTipoExamen = document.getElementById('catalogoComercialTipoExamen');
    if (catalogoComercialTipoExamen && !catalogoComercialTipoExamen.dataset.bound) {
        catalogoComercialTipoExamen.addEventListener('change', () => {
            actualizarVisibilidadComponentesCatalogo();
        });
        catalogoComercialTipoExamen.dataset.bound = 'true';
    }

    const tarifaClienteForm = document.getElementById('tarifaClienteForm');
    if (tarifaClienteForm && !tarifaClienteForm.dataset.bound) {
        tarifaClienteForm.addEventListener('submit', guardarTarifaClienteConfig);
        tarifaClienteForm.dataset.bound = 'true';
    }

    const vendedorForm = document.getElementById('vendedorForm');
    if (vendedorForm && !vendedorForm.dataset.bound) {
        vendedorForm.addEventListener('submit', guardarVendedorConfig);
        vendedorForm.dataset.bound = 'true';
    }

    const recaudoForm = document.getElementById('recaudoForm');
    if (recaudoForm && !recaudoForm.dataset.bound) {
        recaudoForm.addEventListener('submit', guardarRecaudo);
        recaudoForm.dataset.bound = 'true';
    }

    const clienteFactura = document.getElementById('clienteComercialRequiereFactura');
    if (clienteFactura && !clienteFactura.dataset.bound) {
        clienteFactura.addEventListener('change', actualizarEstadoFacturaClienteComercial);
        clienteFactura.dataset.bound = 'true';
    }

    const seguimientoAtencionForm = document.getElementById('seguimientoAtencionForm');
    if (seguimientoAtencionForm && !seguimientoAtencionForm.dataset.bound) {
        seguimientoAtencionForm.addEventListener('submit', guardarSeguimientoAtencion);
        seguimientoAtencionForm.dataset.bound = 'true';
    }

    const seguimientoDocumentoForm = document.getElementById('seguimientoDocumentoForm');
    if (seguimientoDocumentoForm && !seguimientoDocumentoForm.dataset.bound) {
        seguimientoDocumentoForm.addEventListener('submit', guardarSeguimientoDocumento);
        seguimientoDocumentoForm.dataset.bound = 'true';
    }

    const seguimientoPagoForm = document.getElementById('seguimientoPagoForm');
    if (seguimientoPagoForm && !seguimientoPagoForm.dataset.bound) {
        seguimientoPagoForm.addEventListener('submit', guardarSeguimientoPago);
        seguimientoPagoForm.dataset.bound = 'true';
    }

    const seguimientoDocumentoGeneraCartera = document.getElementById('seguimientoDocumentoGeneraCartera');
    if (seguimientoDocumentoGeneraCartera && !seguimientoDocumentoGeneraCartera.dataset.bound) {
        seguimientoDocumentoGeneraCartera.addEventListener('change', actualizarHintSeguimientoDocumento);
        seguimientoDocumentoGeneraCartera.dataset.bound = 'true';
    }

    const seguimientoPagoDocumentoId = document.getElementById('seguimientoPagoDocumentoId');
    if (seguimientoPagoDocumentoId && !seguimientoPagoDocumentoId.dataset.bound) {
        seguimientoPagoDocumentoId.addEventListener('change', actualizarVisibilidadSeguimientoPago);
        seguimientoPagoDocumentoId.dataset.bound = 'true';
    }

    const seguimientoPagoMedio = document.getElementById('seguimientoPagoMedio');
    if (seguimientoPagoMedio && !seguimientoPagoMedio.dataset.bound) {
        seguimientoPagoMedio.addEventListener('change', actualizarVisibilidadSeguimientoPago);
        seguimientoPagoMedio.dataset.bound = 'true';
    }

    const seguimientoAtencionFecha = document.getElementById('seguimientoAtencionFecha');
    if (seguimientoAtencionFecha && !seguimientoAtencionFecha.dataset.bound) {
        seguimientoAtencionFecha.addEventListener('change', async () => {
            try {
                await loadSeguimientoConvenioItems(seguimientoAtencionFecha.value);
            } catch (error) {
                console.error('Error recargando items convenidos para atención:', error);
                showError(error.message || 'No se pudieron cargar los items convenidos.');
            }
        });
        seguimientoAtencionFecha.dataset.bound = 'true';
    }
}

async function asegurarVendedoresComerciales() {
    if (Array.isArray(vendedoresConfigData) && vendedoresConfigData.length > 0) {
        return vendedoresConfigData;
    }

    const response = await fetch('/api/comercial/vendedores', { credentials: 'include' });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'No se pudo cargar la lista de vendedores');
    }

    const vendedores = await response.json();
    vendedoresConfigData = Array.isArray(vendedores) ? vendedores : [];
    return vendedoresConfigData;
}

function renderClienteComercialAdjuntos(containerId, adjuntos) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!Array.isArray(adjuntos) || adjuntos.length === 0) {
        container.innerHTML = 'Sin adjuntos cargados.';
        return;
    }

    container.innerHTML = adjuntos.map(adjunto => `
        <div style="margin-bottom:6px;">
            <a href="${adjunto.download_url}" target="_blank" rel="noopener noreferrer">${escapeHtml(adjunto.nombre_original || 'Adjunto')}</a>
        </div>
    `).join('');
}

async function renderTarifasClienteComercial(clienteId = '') {
    const button = document.getElementById('clienteComercialAsignarTarifaBtn');
    const container = document.getElementById('clienteComercialTarifasResumen');
    if (!container) return;

    if (!clienteId) {
        if (button) button.disabled = true;
        container.innerHTML = 'Sin exámenes ni paquetes asignados.';
        return;
    }

    if (button) button.disabled = false;

    try {
        const tarifas = await asegurarTarifasComerciales();
        const tarifasCliente = tarifas
            .filter(tarifa => String(tarifa.cliente_id) === String(clienteId))
            .sort((a, b) => (a.item_nombre || '').localeCompare(b.item_nombre || ''));

        if (tarifasCliente.length === 0) {
            container.innerHTML = '<span style="color:#6b7280;">Sin exámenes ni paquetes asignados.</span>';
            return;
        }

        container.innerHTML = tarifasCliente.map(tarifa => `
            <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; padding:8px 0; border-bottom:1px solid #e5e7eb;">
                <div>
                    <strong>${escapeHtml(tarifa.item_nombre || 'Item')}</strong>
                    <div style="color:#666; font-size:0.85rem;">${escapeHtml(obtenerResumenClasificacionCatalogo(tarifa))}</div>
                    <div style="color:#666; font-size:0.85rem;">${escapeHtml(tarifa.vigencia_desde || 'Vigencia abierta')}${tarifa.vigencia_hasta ? ` a ${escapeHtml(tarifa.vigencia_hasta)}` : ''}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-weight:700;">${formatCurrency(tarifa.tarifa_negociada || 0)}</div>
                    <button type="button" class="action-btn action-btn-edit" style="margin-right:0; margin-top:6px;" onclick="editarTarifaCliente(${tarifa.id})">Editar</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error cargando tarifas del cliente:', error);
        container.innerHTML = 'No fue posible cargar las tarifas negociadas del cliente.';
    }
}

function actualizarBotonVerTodosConveniosCliente(tipoItem) {
    if (tipoItem !== 'EXAMEN') return;

    const input = document.getElementById('clienteComercialExamenesSearch');
    const button = document.getElementById('clienteComercialExamenesToggleAllBtn');
    if (!input || !button) return;

    const showAll = input.dataset.showAll === 'true';
    const label = button.querySelector('.btn-label');
    if (label) {
        label.textContent = showAll ? 'Ver menos' : 'Ver todos';
    }
}

function toggleVerTodosConveniosClienteComercial(tipoItem) {
    const isExamen = tipoItem === 'EXAMEN';
    const input = document.getElementById(isExamen ? 'clienteComercialExamenesSearch' : 'clienteComercialServiciosSearch');
    if (!input) return;

    input.dataset.showAll = input.dataset.showAll === 'true' ? 'false' : 'true';
    actualizarBotonVerTodosConveniosCliente(tipoItem);
    renderConveniosClienteComercialCatalogo(tipoItem);
}

async function renderConveniosClienteComercialCatalogo(tipoItem) {
    const clienteId = document.getElementById('clienteComercialId')?.value || '';
    const isExamen = tipoItem === 'EXAMEN';
    const input = document.getElementById(isExamen ? 'clienteComercialExamenesSearch' : 'clienteComercialServiciosSearch');
    const container = document.getElementById(isExamen ? 'clienteComercialExamenesList' : 'clienteComercialServiciosList');
    if (!input || !container) return;

    const query = String(input.value || '').trim().toLowerCase();
    const showAll = input.dataset.showAll === 'true';
    actualizarBotonVerTodosConveniosCliente(tipoItem);

    try {
        const [catalogo, tarifas] = await Promise.all([
            asegurarCatalogoComercial(),
            asegurarTarifasComerciales()
        ]);
        const tarifasCliente = new Map(
            (tarifas || [])
                .filter(tarifa => String(tarifa.cliente_id) === String(clienteId) && tarifa.activo !== false)
                .map(tarifa => [String(tarifa.catalogo_item_id), tarifa])
        );

        const filteredItems = (catalogo || [])
            .filter(item => item.activo !== false)
            .filter(item => item.tipo_item === tipoItem)
            .filter(item => item.tipo_item !== 'EXAMEN' || item.clasificacion_completa === true)
            .filter(item => {
                if (!query) return true;
                return [
                    item.nombre,
                    item.codigo,
                    item.clasificacion_resumen,
                    item.resumen_componentes,
                    item.descripcion
                ].filter(Boolean).some(value => String(value).toLowerCase().includes(query));
            })
            .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        const items = (!showAll && !query && isExamen)
            ? filteredItems.slice(0, 12)
            : filteredItems;

        if (items.length === 0) {
            container.innerHTML = query
                ? '<div class="cliente-convenio-meta">No hay coincidencias en el catálogo.</div>'
                : '<div class="cliente-convenio-meta">Escribe para buscar en el catálogo.</div>';
            return;
        }

        const truncatedNotice = (!showAll && !query && isExamen && filteredItems.length > items.length)
            ? `<div class="cliente-convenio-meta" style="margin-bottom:8px;">Mostrando ${items.length} de ${filteredItems.length} examenes. Usa "Ver todos" para abrir el listado completo.</div>`
            : '';

        container.innerHTML = truncatedNotice + items.map(item => {
            const tarifaExistente = tarifasCliente.get(String(item.id));
            const meta = item.tipo_item === 'PAQUETE'
                ? (item.resumen_componentes || 'Paquete comercial')
                : obtenerResumenClasificacionCatalogo(item);
            const accion = tarifaExistente
                ? `editarTarifaCliente(${tarifaExistente.id})`
                : `abrirTarifaDesdeCliente(${item.id})`;
            return `
                <div class="cliente-convenio-search-item cliente-convenio-search-clickable" onclick="${accion}">
                    <div>
                        <strong>${escapeHtml(item.nombre || 'Item')}</strong>
                        <div class="cliente-convenio-meta">${escapeHtml([item.codigo || 'Sin código', meta].filter(Boolean).join(' · '))}</div>
                    </div>
                    <div style="text-align:right;">
                        <div class="cliente-convenio-meta">${escapeHtml(tarifaExistente ? 'Editar tarifa' : 'Asignar')}</div>
                        ${tarifaExistente ? `<span>${formatCurrency(tarifaExistente.tarifa_negociada || 0)}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error cargando buscador de convenios del cliente:', error);
        container.innerHTML = '<div class="cliente-convenio-meta">No fue posible cargar el catálogo.</div>';
    }
}

async function toggleAsignacionConveniosClienteComercial() {
    const panel = document.getElementById('clienteComercialConveniosHelp');
    const button = document.getElementById('clienteComercialToggleAsignacionBtn');
    if (!panel || !button) return;

    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';
    button.querySelector('.btn-label').textContent = visible ? 'Buscar en el catálogo' : 'Ocultar buscador';

    if (!visible) {
        await Promise.all([
            renderConveniosClienteComercialCatalogo('EXAMEN'),
            renderConveniosClienteComercialCatalogo('PAQUETE')
        ]);
    }
}

async function abrirPanelConveniosClienteComercial() {
    const panel = document.getElementById('clienteComercialConveniosHelp');
    const button = document.getElementById('clienteComercialToggleAsignacionBtn');
    if (!panel || !button) return;

    panel.style.display = 'block';
    const label = button.querySelector('.btn-label');
    if (label) label.textContent = 'Ocultar buscador';

    await Promise.all([
        renderConveniosClienteComercialCatalogo('EXAMEN'),
        renderConveniosClienteComercialCatalogo('PAQUETE')
    ]);
}

async function abrirTarifaDesdeCliente(preselectedItemId = '') {
    const clienteId = document.getElementById('clienteComercialId')?.value;
    if (!clienteId) {
        return showError('Guarda primero el cliente antes de asignarle tarifas.');
    }

    clienteComercialTarifaContext = String(clienteId);
    closeClienteComercialModal(true);
    await mostrarAgregarTarifaCliente(clienteId, preselectedItemId);
}

// ==================== GESTIÓN TARIFAS CLIENTE (nuevo modal unificado) ====================

let _gestionTarifasVerTodos = false;

async function abrirGestionTarifasCliente() {
    const clienteId = document.getElementById('clienteComercialId')?.value;
    if (!clienteId) {
        return showError('Guarda primero el cliente antes de gestionar sus tarifas.');
    }

    const modal = document.getElementById('gestionTarifasClienteModal');
    const title = document.getElementById('gestionTarifasClienteTitle');
    if (!modal) return;

    // Título con nombre del cliente
    const clienteNombre = document.getElementById('clienteComercialRazonSocial')?.value || 'Cliente';
    if (title) title.textContent = `Exámenes y Paquetes — ${clienteNombre}`;

    _gestionTarifasVerTodos = false;
    document.getElementById('gestionTarifasSearch').value = '';
    document.getElementById('gestionTarifasFiltroTipo').value = '';
    document.getElementById('gestionTarifasVerTodosLabel').textContent = 'Ver todos';

    modal.classList.add('active');
    await renderGestionTarifasAsignadas();
    await renderGestionTarifasCatalogo();
}

function cerrarGestionTarifasCliente() {
    const modal = document.getElementById('gestionTarifasClienteModal');
    if (modal) modal.classList.remove('active');
}

async function renderGestionTarifasAsignadas() {
    const clienteId = document.getElementById('clienteComercialId')?.value;
    const container = document.getElementById('gestionTarifasClienteLista');
    if (!container || !clienteId) return;

    try {
        const tarifas = await asegurarTarifasComerciales(true);
        const tarifasCliente = tarifas
            .filter(t => String(t.cliente_id) === String(clienteId))
            .sort((a, b) => (a.item_nombre || '').localeCompare(b.item_nombre || ''));

        if (tarifasCliente.length === 0) {
            container.innerHTML = '<div style="color:#6b7280; padding:8px 0;">Este cliente no tiene exámenes ni paquetes asignados aún.</div>';
            return;
        }

        container.innerHTML = tarifasCliente.map(t => `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 4px; border-bottom:1px solid #f1f5f9;">
                <div style="flex:1; min-width:0;">
                    <strong>${escapeHtml(t.item_nombre || 'Item')}</strong>
                    <span style="margin-left:8px; color:#6b7280; font-size:0.82rem;">${escapeHtml(obtenerResumenClasificacionCatalogo(t))}</span>
                    ${t.vigencia_desde || t.vigencia_hasta
                        ? `<div style="color:#6b7280; font-size:0.82rem;">${escapeHtml(t.vigencia_desde || '')}${t.vigencia_hasta ? ` → ${escapeHtml(t.vigencia_hasta)}` : ' (sin vencimiento)'}</div>`
                        : ''}
                </div>
                <div style="display:flex; align-items:center; gap:8px; white-space:nowrap;">
                    <strong>${formatCurrency(t.tarifa_negociada || 0)}</strong>
                    ${canManageComercial('tarifas', 'update') ? `<button class="action-btn action-btn-edit" onclick="editarTarifaDesdeGestion(${t.id})">Editar</button>` : ''}
                    ${canManageComercial('tarifas', 'delete') ? `<button class="action-btn action-btn-delete" onclick="eliminarTarifaDesdeGestion(${t.id})">Eliminar</button>` : ''}
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = '<div style="color:#ef4444;">No fue posible cargar las tarifas.</div>';
    }
}

async function renderGestionTarifasCatalogo() {
    const clienteId = document.getElementById('clienteComercialId')?.value;
    const container = document.getElementById('gestionTarifasCatalogoLista');
    if (!container || !clienteId) return;

    const query = String(document.getElementById('gestionTarifasSearch')?.value || '').trim().toLowerCase();
    const filtroTipo = document.getElementById('gestionTarifasFiltroTipo')?.value || '';

    if (!query && !filtroTipo && !_gestionTarifasVerTodos) {
        container.innerHTML = '<div style="color:#6b7280; padding:8px;">Escribe un nombre, código o selecciona un tipo para buscar.</div>';
        return;
    }

    try {
        const [catalogo, tarifas] = await Promise.all([
            asegurarCatalogoComercial(),
            asegurarTarifasComerciales()
        ]);

        const tarifasClienteMap = new Map(
            tarifas
                .filter(t => String(t.cliente_id) === String(clienteId) && t.activo !== false)
                .map(t => [String(t.catalogo_item_id), t])
        );

        let items = (catalogo || [])
            .filter(item => item.activo !== false)
            .filter(item => item.tipo_item !== 'EXAMEN' || item.clasificacion_completa === true)
            .filter(item => !filtroTipo || item.tipo_item === filtroTipo)
            .filter(item => {
                if (!query) return true;
                return [item.nombre, item.codigo, item.clasificacion_resumen, item.resumen_componentes]
                    .filter(Boolean)
                    .some(v => String(v).toLowerCase().includes(query));
            })
            .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

        if (items.length === 0) {
            container.innerHTML = '<div style="color:#6b7280; padding:8px;">No hay coincidencias en el catálogo.</div>';
            return;
        }

        container.innerHTML = items.map(item => {
            const tarifaExistente = tarifasClienteMap.get(String(item.id));
            const meta = item.tipo_item === 'PAQUETE'
                ? (item.resumen_componentes || 'Paquete')
                : obtenerResumenClasificacionCatalogo(item);
            const tipoBadge = item.tipo_item === 'PAQUETE'
                ? '<span style="background:#dbeafe; color:#1d4ed8; border-radius:4px; padding:1px 6px; font-size:0.78rem; margin-left:6px;">PAQUETE</span>'
                : '';
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:7px 6px; border-bottom:1px solid #f1f5f9; cursor:pointer;"
                     onclick="${tarifaExistente ? `editarTarifaDesdeGestion(${tarifaExistente.id})` : `nuevaTarifaDesdeGestionConItem(${item.id})`}">
                    <div style="flex:1; min-width:0;">
                        <span>${escapeHtml(item.nombre || 'Item')}</span>${tipoBadge}
                        <div style="color:#6b7280; font-size:0.82rem;">${escapeHtml([item.codigo || 'Sin código', meta].filter(Boolean).join(' · '))}</div>
                    </div>
                    <div style="white-space:nowrap; font-size:0.88rem;">
                        ${tarifaExistente
                            ? `<span style="color:#059669; font-weight:600;">${formatCurrency(tarifaExistente.tarifa_negociada || 0)}</span>
                               <span style="color:#6b7280; margin-left:6px;">✏ Editar</span>`
                            : '<span style="color:#2563eb;">+ Asignar</span>'}
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        container.innerHTML = '<div style="color:#ef4444; padding:8px;">No fue posible cargar el catálogo.</div>';
    }
}

function toggleVerTodosGestionTarifas() {
    _gestionTarifasVerTodos = !_gestionTarifasVerTodos;
    document.getElementById('gestionTarifasVerTodosLabel').textContent = _gestionTarifasVerTodos ? 'Ver menos' : 'Ver todos';
    renderGestionTarifasCatalogo();
}

async function nuevaTarifaDesdeGestion() {
    const clienteId = document.getElementById('clienteComercialId')?.value;
    if (!clienteId) return;
    clienteComercialTarifaContext = String(clienteId);
    cerrarGestionTarifasCliente();
    await mostrarAgregarTarifaCliente(clienteId, '');
}

async function nuevaTarifaDesdeGestionConItem(itemId) {
    const clienteId = document.getElementById('clienteComercialId')?.value;
    if (!clienteId) return;
    clienteComercialTarifaContext = String(clienteId);
    cerrarGestionTarifasCliente();
    await mostrarAgregarTarifaCliente(clienteId, itemId);
}

async function editarTarifaDesdeGestion(tarifaId) {
    cerrarGestionTarifasCliente();
    await editarTarifaCliente(tarifaId);
}

async function eliminarTarifaDesdeGestion(tarifaId) {
    await eliminarTarifaComercialConfig(tarifaId);
    await renderGestionTarifasAsignadas();
    await renderGestionTarifasCatalogo();
    // Refrescar también el resumen en la ficha del cliente
    const clienteId = document.getElementById('clienteComercialId')?.value;
    if (clienteId) await renderTarifasClienteComercial(clienteId);
}

function actualizarEstadoFacturaClienteComercial() {
    const requiereFactura = document.getElementById('clienteComercialRequiereFactura')?.checked;
    const condicion = document.getElementById('clienteComercialCondicion');
    const fechas = document.getElementById('clienteComercialFechasFacturacion');
    const fechaSolicitud = document.getElementById('clienteComercialFechaSolicitudFactura');
    const hint = document.getElementById('clienteComercialFacturaHint');

    if (!condicion || !fechas || !fechaSolicitud || !hint) return;

    if (requiereFactura) {
        condicion.disabled = false;
        fechas.disabled = false;
        fechaSolicitud.disabled = false;
        hint.textContent = 'Registre las fechas de facturación y, si aplica, la fecha desde la cual el cliente solicitó pasar a facturación.';
        return;
    }

    condicion.value = 'EFECTIVO';
    condicion.disabled = true;
    fechas.value = '';
    fechas.disabled = true;
    fechaSolicitud.value = '';
    fechaSolicitud.disabled = true;
    hint.textContent = 'Si el cliente no requiere factura, queda registrado como cliente en efectivo. Cuando solicite facturación, la fecha de solicitud marcará el cambio.';
}

async function llenarSelectVendedorComercial(selectedId = '') {
    const select = document.getElementById('clienteComercialVendedorId');
    if (!select) return;

    // Cuando el usuario logueado es un vendedor, sus clientes se asignan
    // automaticamente a el: ocultamos el selector y fijamos su vendedor.
    const contenedor = select.closest('.form-group');
    if (currentUser?.es_vendedor && currentUser?.vendedor_id) {
        select.innerHTML = `<option value="${currentUser.vendedor_id}">${escapeHtml(currentUser.vendedor_nombre || 'Mis clientes')}</option>`;
        select.value = String(currentUser.vendedor_id);
        if (contenedor) contenedor.style.display = 'none';
        return;
    }
    if (contenedor) contenedor.style.display = '';

    try {
        const vendedores = await asegurarVendedoresComerciales();
        select.innerHTML = '<option value="">Seleccione un vendedor...</option>';
        vendedores.forEach(vendedor => {
            const option = document.createElement('option');
            option.value = vendedor.id;
            option.textContent = vendedor.nombre;
            select.appendChild(option);
        });
        if (selectedId) {
            select.value = String(selectedId);
        }
    } catch (error) {
        console.error('Error cargando vendedores para cliente comercial:', error);
        select.innerHTML = '<option value="">No disponible</option>';
    }
}

async function asegurarClientesComerciales() {
    if (Array.isArray(clientesComercialesData) && clientesComercialesData.length > 0) {
        return clientesComercialesData;
    }

    const response = await fetch('/api/comercial/clientes', { credentials: 'include' });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'No se pudo cargar la lista de clientes comerciales');
    }

    const clientes = await response.json();
    clientesComercialesData = Array.isArray(clientes) ? clientes : [];
    return clientesComercialesData;
}

// ==========================================================================
// Registro de Atenciones / Recaudos (seccion comercial)
// ==========================================================================

function getRegistroAtencionesState() {
    if (!window._registroAtencionesState) {
        window._registroAtencionesState = {
            clienteId: null,
            atenciones: [],
            recaudos: [],
            seleccionadas: new Set()
        };
    }
    return window._registroAtencionesState;
}

async function inicializarRegistroAtenciones() {
    const state = getRegistroAtencionesState();
    const select = document.getElementById('registroAtencionesClienteSelect');
    if (!select) return;

    try {
        await asegurarClientesComerciales();
    } catch (error) {
        console.error('Error cargando clientes para registro de atenciones:', error);
        showError(error.message || 'No se pudieron cargar las empresas.');
        return;
    }

    const clientes = Array.isArray(clientesComercialesData) ? clientesComercialesData : [];
    const seleccionActual = select.value || (state.clienteId ? String(state.clienteId) : '');
    const opciones = ['<option value="">Seleccione una empresa...</option>'];
    clientes.forEach(cliente => {
        const label = cliente.razon_social || cliente.nombre_comercial || `Cliente ${cliente.id}`;
        opciones.push(`<option value="${escapeHtml(String(cliente.id))}">${escapeHtml(label)}</option>`);
    });
    select.innerHTML = opciones.join('');

    // Si es un vendedor con un solo cliente, preselecciona.
    let preseleccion = seleccionActual;
    if (!preseleccion && clientes.length === 1) {
        preseleccion = String(clientes[0].id);
    }
    if (preseleccion && clientes.some(cliente => String(cliente.id) === String(preseleccion))) {
        select.value = preseleccion;
        await cargarRegistroAtenciones();
    } else {
        select.value = '';
        state.clienteId = null;
        state.atenciones = [];
        state.recaudos = [];
        state.seleccionadas = new Set();
        renderRegistroAtencionesListas();
    }

    // Prepara el filtro de comision con el anio actual y consulta el acumulado del vendedor.
    const anioInput = document.getElementById('comisionRecaudoAnio');
    if (anioInput && !anioInput.value) {
        anioInput.value = new Date().getFullYear();
    }
    cargarComisionAcumuladaRecaudos();
}

async function cargarComisionAcumuladaRecaudos() {
    const totalRecaudadoEl = document.getElementById('comisionRecaudoTotalRecaudado');
    const totalComisionEl = document.getElementById('comisionRecaudoTotalComision');
    const cantidadEl = document.getElementById('comisionRecaudoCantidad');
    if (!totalRecaudadoEl || !totalComisionEl || !cantidadEl) return;

    const mes = document.getElementById('comisionRecaudoMes')?.value || '';
    const anio = document.getElementById('comisionRecaudoAnio')?.value || '';
    const params = new URLSearchParams();
    if (mes && anio) {
        params.set('mes', mes);
        params.set('anio', anio);
    }
    const query = params.toString();
    const url = `/api/comercial/recaudos/comision-acumulada${query ? `?${query}` : ''}`;

    try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'No se pudo obtener la comision acumulada.');
        }
        const data = await resp.json();
        totalRecaudadoEl.textContent = formatCurrency(data.total_recaudado || 0);
        totalComisionEl.textContent = formatCurrency(data.total_comision || 0);
        cantidadEl.textContent = String(data.cantidad_recaudos || 0);
    } catch (error) {
        console.error('Error cargando comision acumulada de recaudos:', error);
        totalRecaudadoEl.textContent = '$0';
        totalComisionEl.textContent = '$0';
        cantidadEl.textContent = '0';
    }
}

async function cargarRegistroAtenciones() {
    const state = getRegistroAtencionesState();
    const select = document.getElementById('registroAtencionesClienteSelect');
    const clienteId = select ? select.value : '';

    if (!clienteId) {
        state.clienteId = null;
        state.atenciones = [];
        state.recaudos = [];
        state.seleccionadas = new Set();
        renderRegistroAtencionesListas();
        return;
    }

    state.clienteId = clienteId;
    state.seleccionadas = new Set();

    try {
        const [atencionesResp, recaudosResp] = await Promise.all([
            fetch(`/api/comercial/clientes/${clienteId}/atenciones-pendientes`, { credentials: 'include' }),
            fetch(`/api/comercial/clientes/${clienteId}/recaudos`, { credentials: 'include' })
        ]);
        const atencionesData = await atencionesResp.json().catch(() => ([]));
        const recaudosData = await recaudosResp.json().catch(() => ([]));

        if (!atencionesResp.ok) {
            throw new Error(atencionesData.error || 'No se pudieron cargar las atenciones.');
        }
        if (!recaudosResp.ok) {
            throw new Error(recaudosData.error || 'No se pudieron cargar los recaudos.');
        }

        state.atenciones = Array.isArray(atencionesData) ? atencionesData : [];
        state.recaudos = Array.isArray(recaudosData) ? recaudosData : [];
    } catch (error) {
        console.error('Error cargando registro de atenciones:', error);
        showError(error.message || 'No se pudo cargar la informacion de la empresa.');
        state.atenciones = [];
        state.recaudos = [];
    }

    renderRegistroAtencionesListas();
    cargarComisionAcumuladaRecaudos();
}

function toggleAtencionRegistro(atencionId, checked) {
    const state = getRegistroAtencionesState();
    const id = Number(atencionId);
    if (checked) {
        state.seleccionadas.add(id);
    } else {
        state.seleccionadas.delete(id);
    }
    actualizarResumenSeleccionRegistro();
}

function toggleTodasAtencionesRegistro(checked) {
    const state = getRegistroAtencionesState();
    state.seleccionadas = new Set();
    if (checked) {
        (state.atenciones || []).forEach(atencion => state.seleccionadas.add(Number(atencion.id)));
    }
    renderRegistroAtencionesListas();
}

function actualizarResumenSeleccionRegistro() {
    const state = getRegistroAtencionesState();
    const resumen = document.getElementById('registroAtencionesSeleccionResumen');
    if (!resumen) return;
    const cantidad = state.seleccionadas.size;
    if (!cantidad) {
        resumen.textContent = 'No hay atenciones seleccionadas.';
        return;
    }
    const total = (state.atenciones || [])
        .filter(atencion => state.seleccionadas.has(Number(atencion.id)))
        .reduce((acc, atencion) => acc + Number(atencion.valor_total || 0), 0);
    resumen.textContent = `${cantidad} atención(es) seleccionada(s) · Total ${formatCurrency(total)}`;
}

function renderRegistroAtencionesListas() {
    const state = getRegistroAtencionesState();
    const tbodyAtenciones = document.getElementById('registroAtencionesListaAtenciones');
    const tbodyRecaudos = document.getElementById('registroAtencionesListaRecaudos');

    if (tbodyAtenciones) {
        if (!state.clienteId) {
            tbodyAtenciones.innerHTML = '<tr><td colspan="7" class="loading">Selecciona una empresa para ver sus atenciones.</td></tr>';
        } else if (!state.atenciones.length) {
            tbodyAtenciones.innerHTML = '<tr><td colspan="7" class="loading">Esta empresa no tiene atenciones registradas.</td></tr>';
        } else {
            tbodyAtenciones.innerHTML = state.atenciones.map(atencion => {
                const id = Number(atencion.id);
                const checked = state.seleccionadas.has(id) ? 'checked' : '';
                const recaudoInfo = atencion.tiene_recaudo
                    ? '<span class="badge badge-success">Sí</span>'
                    : '<span class="badge badge-secondary">No</span>';
                const paciente = [atencion.paciente_nombre, atencion.paciente_documento].filter(Boolean).join(' · ');
                return `<tr>
                    <td><input type="checkbox" ${checked} onchange="toggleAtencionRegistro(${id}, this.checked)"></td>
                    <td>${escapeHtml(atencion.nro_atencion || '-')}</td>
                    <td>${escapeHtml(atencion.fecha_atencion || '-')}</td>
                    <td>${escapeHtml(paciente || '-')}</td>
                    <td>${formatCurrency(atencion.valor_total || 0)}</td>
                    <td>${escapeHtml(atencion.estado_cobro || '-')}</td>
                    <td>${recaudoInfo}</td>
                </tr>`;
            }).join('');
        }
    }

    const checkAll = document.getElementById('registroAtencionesCheckAll');
    if (checkAll) {
        const total = state.atenciones.length;
        checkAll.checked = total > 0 && state.seleccionadas.size === total;
    }

    if (tbodyRecaudos) {
        if (!state.clienteId) {
            tbodyRecaudos.innerHTML = '<tr><td colspan="9" class="loading">Selecciona una empresa para ver sus recaudos.</td></tr>';
        } else if (!state.recaudos.length) {
            tbodyRecaudos.innerHTML = '<tr><td colspan="9" class="loading">Esta empresa no tiene recaudos registrados.</td></tr>';
        } else {
            tbodyRecaudos.innerHTML = state.recaudos.map(recaudo => {
                const id = Number(recaudo.id);
                const soporte = recaudo.comprobante_url || recaudo.nombre_comprobante
                    ? `<a href="/api/comercial/recaudos/${id}/comprobante" target="_blank" rel="noopener">Ver</a>`
                    : '<span style="color:#999;">Sin soporte</span>';
                const medio = [recaudo.medio_pago, recaudo.canal_transferencia].filter(Boolean).join(' · ');
                return `<tr>
                    <td>${escapeHtml(recaudo.fecha_pago || '-')}</td>
                    <td>${formatCurrency(recaudo.valor_comprobante || 0)}</td>
                    <td>${escapeHtml(medio || '-')}</td>
                    <td>${Number(recaudo.porcentaje_aplicado || 0).toFixed(2)}%</td>
                    <td>${formatCurrency(recaudo.comision_calculada || 0)}</td>
                    <td>${Number(recaudo.cantidad_atenciones || 0)}</td>
                    <td>${escapeHtml(recaudo.estado || '-')}</td>
                    <td>${soporte}</td>
                    <td>
                        <div class="button-group" style="gap:6px; flex-wrap:wrap;">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="abrirRecaudoModal(${id})">Editar</button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="asociarAtencionesARecaudo(${id})">Asociar atenciones</button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="subirSoporteRecaudo(${id})">Subir soporte</button>
                            <button type="button" class="btn btn-danger btn-sm" onclick="eliminarRecaudo(${id})">Eliminar</button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
        }
    }

    actualizarResumenSeleccionRegistro();
}

function actualizarCanalRecaudo() {
    const medio = document.getElementById('recaudoMedioPago')?.value || '';
    const grupo = document.getElementById('recaudoCanalGroup');
    if (!grupo) return;
    grupo.style.display = medio === 'TRANSFERENCIA' ? '' : 'none';
}

function abrirRecaudoModal(recaudoId = null) {
    const state = getRegistroAtencionesState();
    if (!state.clienteId) {
        showError('Selecciona primero una empresa.');
        return;
    }

    const form = document.getElementById('recaudoForm');
    const titulo = document.getElementById('recaudoModalTitulo');
    const resumen = document.getElementById('recaudoAtencionesResumen');
    if (!form) return;

    form.reset();
    document.getElementById('recaudoId').value = recaudoId ? String(recaudoId) : '';

    if (recaudoId) {
        const recaudo = (state.recaudos || []).find(item => Number(item.id) === Number(recaudoId));
        if (!recaudo) {
            showError('No se pudo localizar el recaudo.');
            return;
        }
        if (titulo) titulo.textContent = 'Editar recaudo';
        document.getElementById('recaudoFechaPago').value = recaudo.fecha_pago || '';
        document.getElementById('recaudoValorComprobante').value = recaudo.valor_comprobante || '';
        document.getElementById('recaudoMedioPago').value = recaudo.medio_pago || 'EFECTIVO';
        document.getElementById('recaudoCanalTransferencia').value = recaudo.canal_transferencia || '';
        document.getElementById('recaudoObservaciones').value = recaudo.observaciones || '';
        const atenciones = Array.isArray(recaudo.atenciones) ? recaudo.atenciones : [];
        if (resumen) {
            resumen.innerHTML = atenciones.length
                ? atenciones.map(a => `<div>${escapeHtml(a.nro_atencion || 'Atención')} · ${escapeHtml(a.paciente_nombre || '')} · ${formatCurrency(a.valor_aplicado || a.valor_atencion || 0)}</div>`).join('')
                : 'Este recaudo no tiene atenciones asociadas.';
        }
    } else {
        if (titulo) titulo.textContent = 'Registrar pago (recaudo)';
        document.getElementById('recaudoFechaPago').value = getTodayIsoDate();
        document.getElementById('recaudoMedioPago').value = 'EFECTIVO';
        const seleccionadas = Array.from(state.seleccionadas || []);
        const atenciones = (state.atenciones || []).filter(a => seleccionadas.includes(Number(a.id)));
        if (resumen) {
            resumen.innerHTML = atenciones.length
                ? atenciones.map(a => `<div>${escapeHtml(a.nro_atencion || 'Atención')} · ${escapeHtml(a.paciente_nombre || '')} · ${formatCurrency(a.valor_total || 0)}</div>`).join('')
                : 'No hay atenciones seleccionadas.';
        }
    }

    actualizarCanalRecaudo();
    document.getElementById('recaudoModal')?.classList.add('active');
}

function cerrarRecaudoModal() {
    document.getElementById('recaudoModal')?.classList.remove('active');
}

async function guardarRecaudo(event) {
    if (event) event.preventDefault();
    const state = getRegistroAtencionesState();
    if (!state.clienteId) {
        showError('Selecciona primero una empresa.');
        return;
    }

    const recaudoId = document.getElementById('recaudoId').value || '';
    const fechaPago = document.getElementById('recaudoFechaPago').value || '';
    const valor = document.getElementById('recaudoValorComprobante').value || '';
    const medioPago = document.getElementById('recaudoMedioPago').value || '';
    const canal = document.getElementById('recaudoCanalTransferencia').value || '';
    const observaciones = document.getElementById('recaudoObservaciones').value || '';
    const archivoInput = document.getElementById('recaudoComprobante');
    const archivo = archivoInput && archivoInput.files.length ? archivoInput.files[0] : null;

    if (!fechaPago) {
        showError('La fecha de pago es obligatoria.');
        return;
    }
    if (!(Number(valor) > 0)) {
        showError('El valor del comprobante debe ser mayor a cero.');
        return;
    }

    const formData = new FormData();
    formData.append('fecha_pago', fechaPago);
    formData.append('valor_comprobante', valor);
    formData.append('medio_pago', medioPago);
    if (medioPago === 'TRANSFERENCIA' && canal) {
        formData.append('canal_transferencia', canal);
    }
    if (observaciones) {
        formData.append('observaciones', observaciones);
    }
    if (archivo) {
        formData.append('comprobante_pago', archivo);
    }

    // En creacion se agrupan las atenciones marcadas.
    if (!recaudoId) {
        const seleccionadas = Array.from(state.seleccionadas || []);
        formData.append('atencion_ids', JSON.stringify(seleccionadas));
    }

    try {
        const url = recaudoId
            ? `/api/comercial/recaudos/${recaudoId}`
            : `/api/comercial/clientes/${state.clienteId}/recaudos`;
        const method = recaudoId ? 'PUT' : 'POST';
        const response = await fetch(url, { method, credentials: 'include', body: formData });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'No se pudo guardar el recaudo.');
        }

        cerrarRecaudoModal();
        const comision = data.comision_calculada;
        if (comision !== undefined && comision !== null) {
            showSuccess(`Recaudo guardado. Comisión calculada: ${formatCurrency(comision)}`);
        } else {
            showSuccess('Recaudo guardado correctamente.');
        }
        await cargarRegistroAtenciones();
    } catch (error) {
        console.error('Error guardando recaudo:', error);
        showError(error.message || 'No se pudo guardar el recaudo.');
    }
}

async function asociarAtencionesARecaudo(recaudoId) {
    const state = getRegistroAtencionesState();
    const seleccionadas = Array.from(state.seleccionadas || []);
    if (!seleccionadas.length) {
        showError('Marca primero las atenciones que quieres asociar.');
        return;
    }

    const formData = new FormData();
    formData.append('atencion_ids', JSON.stringify(seleccionadas));

    try {
        const response = await fetch(`/api/comercial/recaudos/${recaudoId}`, {
            method: 'PUT',
            credentials: 'include',
            body: formData
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'No se pudieron asociar las atenciones.');
        }
        const comision = data.comision_calculada;
        showSuccess(comision !== undefined && comision !== null
            ? `Atenciones asociadas. Comisión: ${formatCurrency(comision)}`
            : 'Atenciones asociadas correctamente.');
        await cargarRegistroAtenciones();
    } catch (error) {
        console.error('Error asociando atenciones:', error);
        showError(error.message || 'No se pudieron asociar las atenciones.');
    }
}

function subirSoporteRecaudo(recaudoId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.addEventListener('change', async () => {
        if (!input.files.length) return;
        const formData = new FormData();
        formData.append('comprobante_pago', input.files[0]);
        try {
            const response = await fetch(`/api/comercial/recaudos/${recaudoId}`, {
                method: 'PUT',
                credentials: 'include',
                body: formData
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'No se pudo subir el soporte.');
            }
            showSuccess('Soporte subido correctamente.');
            await cargarRegistroAtenciones();
        } catch (error) {
            console.error('Error subiendo soporte:', error);
            showError(error.message || 'No se pudo subir el soporte.');
        }
    });
    input.click();
}

async function eliminarRecaudo(recaudoId) {
    if (!window.confirm('¿Eliminar este recaudo? Esta acción no se puede deshacer.')) {
        return;
    }
    try {
        const response = await fetch(`/api/comercial/recaudos/${recaudoId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'No se pudo eliminar el recaudo.');
        }
        showSuccess('Recaudo eliminado.');
        await cargarRegistroAtenciones();
    } catch (error) {
        console.error('Error eliminando recaudo:', error);
        showError(error.message || 'No se pudo eliminar el recaudo.');
    }
}

async function registrarAtencionRegistro() {
    const state = getRegistroAtencionesState();
    if (!state.clienteId) {
        showError('Selecciona primero una empresa.');
        return;
    }

    try {
        await ensureClientesComercialesLoaded();
        const cliente = (clientesComercialesData || []).find(item => String(item.id) === String(state.clienteId));
        if (!cliente) {
            throw new Error('No se pudo localizar la empresa seleccionada.');
        }

        // Reutiliza el flujo de atenciones del seguimiento del cliente.
        clienteSeguimientoContext = {
            clienteId: String(state.clienteId),
            cliente,
            convenioItems: [],
            atenciones: [],
            documentos: [],
            pagos: [],
            draftDetalles: []
        };
        // Marca para recargar el registro cuando se cierre el modal de atención.
        window._registroAtencionesRecargarAlCerrar = true;
        await mostrarAgregarAtencionCliente();
    } catch (error) {
        console.error('Error abriendo registro de atención:', error);
        showError(error.message || 'No se pudo abrir el registro de atención.');
    }
}

function actualizarOpcionesSubtipoCatalogo(preferredValue = '') {
    const tipoExamenSelect = document.getElementById('catalogoComercialTipoExamen');
    const subtipoSelect = document.getElementById('catalogoComercialSubtipoLaboratorio');
    const subtipoLabel = document.getElementById('catalogoComercialSubtipoLaboratorioLabel');
    if (!tipoExamenSelect || !subtipoSelect || !subtipoLabel) return;

    const tipoExamen = tipoExamenSelect.value;
    const currentValue = preferredValue || subtipoSelect.value || '';
    let label = 'Subtipo del examen';
    let options = [{ value: '', text: 'Pendiente de definir' }];

    if (tipoExamen === 'LABORATORIO') {
        label = 'Subtipo de laboratorio';
        options = options.concat([
            { value: 'REMITIDO', text: 'REMITIDO' },
            { value: 'REALIZADO', text: 'REALIZADO EN LABORATORIO' }
        ]);
    } else if (tipoExamen === 'CURSOS') {
        label = 'Condición del curso';
        options = options.concat([
            { value: 'REMITIDO', text: 'REMITIDO' },
            { value: 'NO_REMITIDO', text: 'NO REMITIDO' }
        ]);
    }

    subtipoLabel.textContent = label;
    subtipoSelect.innerHTML = options
        .map(option => `<option value="${option.value}">${option.text}</option>`)
        .join('');
    subtipoSelect.value = options.some(option => option.value === currentValue) ? currentValue : '';
}

async function refrescarAyudasComercialesVisibles() {
    const clienteId = document.getElementById('clienteComercialId')?.value || '';
    const conveniosPanel = document.getElementById('clienteComercialConveniosHelp');

    if (clienteId) {
        await renderTarifasClienteComercial(clienteId);
    }

    if (conveniosPanel && conveniosPanel.style.display !== 'none') {
        await Promise.all([
            renderConveniosClienteComercialCatalogo('EXAMEN'),
            renderConveniosClienteComercialCatalogo('PAQUETE')
        ]);
    }

    if (recepcionClienteActivoId) {
        await abrirClienteRecepcion(recepcionClienteActivoId);
    }
}

async function asegurarCatalogoComercial(forceRefresh = false) {
    if (!forceRefresh && Array.isArray(catalogoComercialData) && catalogoComercialData.length > 0) {
        return catalogoComercialData;
    }

    const response = await fetch('/api/comercial/catalogo', { credentials: 'include' });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'No se pudo cargar el catálogo comercial');
    }

    const items = await response.json();
    catalogoComercialData = Array.isArray(items) ? items : [];
    return catalogoComercialData;
}

async function asegurarTarifasComerciales() {
    if (Array.isArray(tarifasComercialesData) && tarifasComercialesData.length > 0) {
        return tarifasComercialesData;
    }

    const response = await fetch('/api/comercial/tarifas', { credentials: 'include' });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'No se pudo cargar la lista de tarifas comerciales');
    }

    const tarifas = await response.json();
    tarifasComercialesData = Array.isArray(tarifas) ? tarifas : [];
    return tarifasComercialesData;
}

async function llenarSelectClientesComerciales(selectedId = '') {
    const select = document.getElementById('tarifaClienteClienteId');
    if (!select) return;

    try {
        const clientes = await asegurarClientesComerciales();
        select.innerHTML = '<option value="">Seleccione un cliente...</option>';
        clientes.forEach(cliente => {
            const option = document.createElement('option');
            option.value = cliente.id;
            option.textContent = cliente.razon_social;
            select.appendChild(option);
        });
        if (selectedId) {
            select.value = String(selectedId);
        }
    } catch (error) {
        console.error('Error cargando clientes para tarifa:', error);
        select.innerHTML = '<option value="">No disponible</option>';
    }
}

async function llenarSelectCatalogoComercial(selectedId = '') {
    const select = document.getElementById('tarifaClienteCatalogoItemId');
    if (!select) return;

    try {
        const items = await asegurarCatalogoComercial();
        select.innerHTML = '<option value="">Seleccione un examen o paquete...</option>';
        items
            .filter(item => item.activo !== false)
            .filter(item => item.tipo_item !== 'EXAMEN' || item.clasificacion_completa === true)
            .forEach(item => {
                const option = document.createElement('option');
                option.value = item.id;
                option.textContent = item.tipo_item === 'EXAMEN'
                    ? `${item.clasificacion_resumen || 'PENDIENTE DE CLASIFICAR'} - ${item.nombre}`
                    : `${item.tipo_item} - ${item.nombre}`;
                select.appendChild(option);
            });
        if (selectedId) {
            select.value = String(selectedId);
        }
    } catch (error) {
        console.error('Error cargando catálogo para tarifa:', error);
        select.innerHTML = '<option value="">No disponible</option>';
    }
}

function obtenerResumenClasificacionCatalogo(item) {
    if (!item) return 'SIN CLASIFICAR';
    if (item.clasificacion_resumen) return item.clasificacion_resumen;
    if (item.tipo_item !== 'EXAMEN') return item.tipo_item || 'ITEM';
    if (!item.tipo_examen) return 'PENDIENTE DE CLASIFICAR';
    if (item.tipo_examen !== 'LABORATORIO' && item.tipo_examen !== 'CURSOS') return item.tipo_examen;
    if (item.subtipo_laboratorio === 'REMITIDO') return `${item.tipo_examen} / REMITIDO`;
    if (item.subtipo_laboratorio === 'REALIZADO') return 'LABORATORIO / REALIZADO EN LABORATORIO';
    if (item.subtipo_laboratorio === 'NO_REMITIDO') return 'CURSOS / NO REMITIDO';
    return `${item.tipo_examen} / SUBTIPO PENDIENTE`;
}

function obtenerGruposCatalogoParaPaquete(items) {
    const grupos = [
        { title: 'Consultas', items: [] },
        { title: 'Paraclinicos', items: [] },
        { title: 'EcoBaby', items: [] },
        { title: 'Cursos remitidos', items: [] },
        { title: 'Cursos no remitidos', items: [] },
        { title: 'Laboratorio remitidos', items: [] },
        { title: 'Laboratorio realizados en laboratorio', items: [] }
    ];

    (items || []).forEach(item => {
        if (item.tipo_examen === 'CONSULTA') {
            grupos[0].items.push(item);
        } else if (item.tipo_examen === 'PARACLINICO') {
            grupos[1].items.push(item);
        } else if (item.tipo_examen === 'ECOBABY') {
            grupos[2].items.push(item);
        } else if (item.tipo_examen === 'CURSOS' && item.subtipo_laboratorio === 'REMITIDO') {
            grupos[3].items.push(item);
        } else if (item.tipo_examen === 'CURSOS' && item.subtipo_laboratorio === 'NO_REMITIDO') {
            grupos[4].items.push(item);
        } else if (item.tipo_examen === 'LABORATORIO' && item.subtipo_laboratorio === 'REMITIDO') {
            grupos[5].items.push(item);
        } else if (item.tipo_examen === 'LABORATORIO' && item.subtipo_laboratorio === 'REALIZADO') {
            grupos[6].items.push(item);
        }
    });

    return grupos.filter(grupo => grupo.items.length > 0);
}

function obtenerComponentesSeleccionadosCatalogo() {
    return [...catalogoComercialComponentesSeleccionados];
}

// ==================== CLIENTE COMERCIAL: CASOS Y DOCUMENTOS ====================

// Catalogo de documentos con su tipo (usado como tipo_documento del adjunto)
const CLIENTE_DOCUMENTOS_CATALOGO = [
    { tipo: 'RUT', nombre: 'RUT' },
    { tipo: 'CAMARA_COMERCIO', nombre: 'Cámara de Comercio' },
    { tipo: 'CEDULA_REP_LEGAL', nombre: 'Foto cédula rep. legal' },
    { tipo: 'CONTRATO', nombre: 'Contrato' },
    { tipo: 'FORMULARIO', nombre: 'Formulario' },
    { tipo: 'ACUERDO', nombre: 'Acuerdo' },
    { tipo: 'PAGARE', nombre: 'Pagaré' },
];

// Documentos requeridos por caso (combinacion requiere_factura x condicion de pago)
function _documentosDelCasoCliente(requiereFactura, pago) {
    if (requiereFactura === 'SI' && pago === 'CREDITO') {
        return ['RUT', 'CAMARA_COMERCIO', 'CEDULA_REP_LEGAL', 'CONTRATO', 'FORMULARIO', 'ACUERDO', 'PAGARE'];
    }
    if (requiereFactura === 'SI' && pago === 'CONTADO') {
        return ['RUT'];
    }
    return []; // Requiere factura NO -> sin documentos
}

// Estado en memoria de los archivos seleccionados por tipo de documento (nuevos)
// y de los adjuntos ya cargados (existentes en BD).
window._clienteComercialDocsState = window._clienteComercialDocsState || {
    nuevos: {},      // { TIPO: File }
    existentes: {}   // { TIPO: [ {id, nombre_original, download_url} ] }
};

function _resetDocsStateCliente(adjuntos = []) {
    const existentes = {};
    (Array.isArray(adjuntos) ? adjuntos : []).forEach(adj => {
        const tipo = String(adj.tipo_documento || '').toUpperCase();
        if (!existentes[tipo]) existentes[tipo] = [];
        existentes[tipo].push(adj);
    });
    window._clienteComercialDocsState = { nuevos: {}, existentes };
}

function seleccionarDocumentoCliente(tipo, input) {
    const file = input?.files?.[0] || null;
    if (file) {
        window._clienteComercialDocsState.nuevos[tipo] = file;
    } else {
        delete window._clienteComercialDocsState.nuevos[tipo];
    }
    renderDocumentosCliente();
}

function renderDocumentosCliente() {
    const container = document.getElementById('clienteComercialDocumentosLista');
    if (!container) return;

    const requiereFactura = document.getElementById('clienteComercialRequiereFacturaSel')?.value || 'NO';
    const pago = document.getElementById('clienteComercialPagoSel')?.value || 'CONTADO';
    const tipos = _documentosDelCasoCliente(requiereFactura, pago);
    const state = window._clienteComercialDocsState || { nuevos: {}, existentes: {} };

    if (!tipos.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = tipos.map(tipo => {
        const def = CLIENTE_DOCUMENTOS_CATALOGO.find(d => d.tipo === tipo) || { nombre: tipo };
        const existentes = state.existentes[tipo] || [];
        const nuevo = state.nuevos[tipo] || null;
        const cargado = Boolean(nuevo) || existentes.length > 0;

        const estadoChip = cargado
            ? '<span class="cliente-doc-chip cliente-doc-chip-ok">Cargado</span>'
            : '<span class="cliente-doc-chip cliente-doc-chip-pend">Pendiente</span>';

        const existentesHtml = existentes.length
            ? `<div class="cliente-doc-existentes">${existentes.map(adj =>
                `<a href="${adj.download_url}" target="_blank" rel="noopener noreferrer">${escapeHtml(adj.nombre_original || 'Documento')}</a>`
              ).join('')}</div>`
            : '';

        const nuevoHtml = nuevo
            ? `<div class="cliente-doc-nuevo">Nuevo: ${escapeHtml(nuevo.name)}</div>`
            : '';

        return `
            <div class="cliente-doc-row ${cargado ? 'is-ok' : 'is-pend'}">
                <div class="cliente-doc-info">
                    <span class="cliente-doc-semaforo ${cargado ? 'ok' : 'pend'}"></span>
                    <div>
                        <strong>${escapeHtml(def.nombre)}</strong>
                        ${estadoChip}
                        ${existentesHtml}
                        ${nuevoHtml}
                    </div>
                </div>
                <label class="cliente-doc-upload">
                    <span class="btn btn-secondary btn-sm">${cargado ? 'Reemplazar' : 'Adjuntar'}</span>
                    <input type="file" style="display:none;" onchange="seleccionarDocumentoCliente('${tipo}', this)" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx">
                </label>
            </div>
        `;
    }).join('');
}

// Sincroniza los 2 selectores de negocio con los campos ocultos que espera el
// backend (condicion_comercial + requiere_factura) y refresca documentos.
function actualizarCasoClienteComercial() {
    const requiereFacturaSel = document.getElementById('clienteComercialRequiereFacturaSel')?.value || 'NO';
    const pago = document.getElementById('clienteComercialPagoSel')?.value || 'CONTADO';

    // Campos ocultos que consume el backend
    const requiereFacturaChk = document.getElementById('clienteComercialRequiereFactura');
    const condicionHidden = document.getElementById('clienteComercialCondicion');
    if (requiereFacturaChk) requiereFacturaChk.checked = requiereFacturaSel === 'SI';
    if (condicionHidden) condicionHidden.value = pago === 'CREDITO' ? 'CREDITO' : 'EFECTIVO';

    // Seccion de documentos: visible solo cuando el caso pide documentos
    const docsSection = document.getElementById('clienteComercialDocumentosSection');
    const tipos = _documentosDelCasoCliente(requiereFacturaSel, pago);
    if (docsSection) docsSection.style.display = tipos.length ? '' : 'none';

    // Hint del caso
    const hint = document.getElementById('clienteComercialCasoHint');
    if (hint) {
        if (requiereFacturaSel === 'SI' && pago === 'CREDITO') {
            hint.textContent = 'Requiere factura y crédito: registra los datos de la empresa y adjunta los documentos legales (RUT, cámara de comercio, cédula, contrato, formulario, acuerdo y pagaré).';
        } else if (requiereFacturaSel === 'SI' && pago === 'CONTADO') {
            hint.textContent = 'Requiere factura de contado: registra los datos de la empresa y adjunta el RUT.';
        } else {
            hint.textContent = 'Sin factura: solo se registran los datos de la empresa.';
        }
    }

    renderDocumentosCliente();
}

async function mostrarAgregarClienteComercial() {
    const form = document.getElementById('clienteComercialForm');
    if (!form) return;

    form.reset();
    clienteComercialTarifaContext = null;
    document.getElementById('clienteComercialId').value = '';
    document.getElementById('clienteComercialModalTitle').textContent = 'Nuevo Cliente Comercial';
    document.getElementById('clienteComercialEstado').value = 'ACTIVO';
    document.getElementById('clienteComercialMedioAutorizacion').value = 'WHATSAPP';
    document.getElementById('clienteComercialRequiereFactura').checked = false;
    document.getElementById('clienteComercialDocumentosCompletos').checked = false;
    document.getElementById('clienteComercialConfirmadoAdministrativo').checked = false;
    document.getElementById('clienteComercialPagareFirmado').checked = false;
    document.getElementById('clienteComercialExamenesSearch').value = '';
    document.getElementById('clienteComercialExamenesSearch').dataset.showAll = 'false';
    document.getElementById('clienteComercialServiciosSearch').value = '';
    actualizarBotonVerTodosConveniosCliente('EXAMEN');
    renderClienteComercialAdjuntos('clienteComercialDocumentosExistentes', []);
    renderClienteComercialAdjuntos('clienteComercialPagareExistentes', []);
    const seguimientoBtn = document.getElementById('clienteComercialSeguimientoBtn');
    if (seguimientoBtn) {
        seguimientoBtn.disabled = true;
    }
    await renderTarifasClienteComercial('');
    await llenarSelectVendedorComercial();
    // Nuevos selectores de negocio: por defecto NO requiere factura / CONTADO
    const reqSel = document.getElementById('clienteComercialRequiereFacturaSel');
    const pagoSel = document.getElementById('clienteComercialPagoSel');
    if (reqSel) reqSel.value = 'NO';
    if (pagoSel) pagoSel.value = 'CONTADO';
    _resetDocsStateCliente([]);
    actualizarCasoClienteComercial();
    document.getElementById('clienteComercialModal').classList.add('active');
}

function closeClienteComercialModal(preserveTarifaContext = false) {
    if (!preserveTarifaContext) {
        clienteComercialTarifaContext = null;
    }
    document.getElementById('clienteComercialModal').classList.remove('active');
}

async function editarClienteComercial(id) {
    const cliente = clientesComercialesData.find(item => item.id === id);
    if (!cliente) return;

    clienteComercialTarifaContext = String(id);
    document.getElementById('clienteComercialId').value = cliente.id;
    document.getElementById('clienteComercialModalTitle').textContent = 'Editar Cliente Comercial';
    await llenarSelectVendedorComercial(cliente.vendedor_id || '');
    document.getElementById('clienteComercialRazonSocial').value = cliente.razon_social || '';
    document.getElementById('clienteComercialNombreComercial').value = cliente.nombre_comercial || '';
    document.getElementById('clienteComercialNit').value = cliente.nit || '';
    document.getElementById('clienteComercialCiudad').value = cliente.ciudad || '';
    document.getElementById('clienteComercialDireccion').value = cliente.direccion || '';
    document.getElementById('clienteComercialTelefonoEmpresa').value = cliente.telefono_empresa || '';
    document.getElementById('clienteComercialEmailEmpresa').value = cliente.email_empresa || '';
    document.getElementById('clienteComercialContactoPrincipal').value = cliente.contacto_principal || '';
    document.getElementById('clienteComercialCargoPrincipal').value = cliente.cargo_contacto_principal || '';
    document.getElementById('clienteComercialCelularPrincipal').value = cliente.celular_contacto_principal || '';
    document.getElementById('clienteComercialEmailPrincipal').value = cliente.email_contacto_principal || '';
    document.getElementById('clienteComercialContactoFacturacion').value = cliente.contacto_facturacion || '';
    document.getElementById('clienteComercialCargoFacturacion').value = cliente.cargo_contacto_facturacion || '';
    document.getElementById('clienteComercialCelularFacturacion').value = cliente.celular_facturacion || '';
    document.getElementById('clienteComercialEmailFacturacion').value = cliente.email_facturacion || '';
    document.getElementById('clienteComercialMedioAutorizacion').value = cliente.medio_autorizacion || 'WHATSAPP';
    document.getElementById('clienteComercialCondicion').value = cliente.condicion_comercial || 'EFECTIVO';
    document.getElementById('clienteComercialEstado').value = obtenerEstadoCliente(cliente);
    document.getElementById('clienteComercialRequiereFactura').checked = cliente.requiere_factura === true;
    document.getElementById('clienteComercialFechasFacturacion').value = cliente.fechas_facturacion || '';
    document.getElementById('clienteComercialFechaSolicitudFactura').value = cliente.fecha_solicitud_factura || '';
    document.getElementById('clienteComercialPuntosAtencionRecepcion').value = cliente.puntos_atencion_recepcion || '';
    document.getElementById('clienteComercialExamenes').value = cliente.examenes_convenidos || '';
    document.getElementById('clienteComercialServicios').value = cliente.servicios_convenidos || '';
    document.getElementById('clienteComercialTarifas').value = cliente.tarifas_convenidas || '';
    document.getElementById('clienteComercialDocumentosCompletos').checked = cliente.documentos_legales_completos === true;
    document.getElementById('clienteComercialConfirmadoAdministrativo').checked = cliente.confirmado_administrativo === true;
    document.getElementById('clienteComercialDocumentosDetalle').value = cliente.documentos_legales_detalle || '';
    document.getElementById('clienteComercialPagareFirmado').checked = cliente.pagare_firmado === true;
    document.getElementById('clienteComercialPagareDetalle').value = cliente.pagare_detalle || '';
    document.getElementById('clienteComercialObservaciones').value = cliente.observaciones || '';
    document.getElementById('clienteComercialExamenesSearch').value = '';
    document.getElementById('clienteComercialExamenesSearch').dataset.showAll = 'false';
    document.getElementById('clienteComercialServiciosSearch').value = '';
    actualizarBotonVerTodosConveniosCliente('EXAMEN');
    renderClienteComercialAdjuntos('clienteComercialDocumentosExistentes', cliente.documentos_legales_adjuntos || []);
    renderClienteComercialAdjuntos('clienteComercialPagareExistentes', cliente.pagare_adjuntos || []);
    const seguimientoBtn = document.getElementById('clienteComercialSeguimientoBtn');
    if (seguimientoBtn) {
        seguimientoBtn.disabled = false;
    }
    await renderTarifasClienteComercial(cliente.id);
    // Reconstruir los selectores de negocio desde los campos guardados
    const reqSel = document.getElementById('clienteComercialRequiereFacturaSel');
    const pagoSel = document.getElementById('clienteComercialPagoSel');
    if (reqSel) reqSel.value = cliente.requiere_factura === true ? 'SI' : 'NO';
    if (pagoSel) pagoSel.value = String(cliente.condicion_comercial || '').toUpperCase() === 'CREDITO' ? 'CREDITO' : 'CONTADO';
    _resetDocsStateCliente(cliente.adjuntos || []);
    actualizarCasoClienteComercial();
    document.getElementById('clienteComercialModal').classList.add('active');
}

function closeCatalogoComercialModal() {
    document.getElementById('catalogoComercialModal').classList.remove('active');
}

async function mostrarAgregarTarifaCliente(preselectedClienteId = '', preselectedItemId = '') {
    const form = document.getElementById('tarifaClienteForm');
    if (!form) return;

    form.reset();
    document.getElementById('tarifaClienteId').value = '';
    document.getElementById('tarifaClienteModalTitle').textContent = 'Nueva Tarifa por Cliente';
    document.getElementById('tarifaClienteTarifaNegociada').value = '0';
    document.getElementById('tarifaClienteActivo').checked = true;
    await llenarSelectClientesComerciales(preselectedClienteId || '');
    await llenarSelectCatalogoComercial(preselectedItemId || '');
    document.getElementById('tarifaClienteModal').classList.add('active');
}

function closeTarifaClienteModal() {
    document.getElementById('tarifaClienteModal').classList.remove('active');
    if (clienteComercialTarifaContext) {
        const retornoId = clienteComercialTarifaContext;
        clienteComercialTarifaContext = null;
        editarClienteComercial(Number(retornoId));
    }
}

async function editarTarifaCliente(id) {
    const tarifa = tarifasComercialesData.find(entry => entry.id === id);
    if (!tarifa) return;

    const clienteModal = document.getElementById('clienteComercialModal');
    if (clienteModal?.classList.contains('active')) {
        clienteComercialTarifaContext = String(tarifa.cliente_id || '');
        closeClienteComercialModal(true);
    }

    document.getElementById('tarifaClienteId').value = tarifa.id;
    document.getElementById('tarifaClienteModalTitle').textContent = 'Editar Tarifa por Cliente';
    await llenarSelectClientesComerciales(tarifa.cliente_id || '');
    await llenarSelectCatalogoComercial(tarifa.catalogo_item_id || '');
    document.getElementById('tarifaClienteTarifaNegociada').value = tarifa.tarifa_negociada || 0;
    document.getElementById('tarifaClienteVigenciaDesde').value = tarifa.vigencia_desde || '';
    document.getElementById('tarifaClienteVigenciaHasta').value = tarifa.vigencia_hasta || '';
    document.getElementById('tarifaClienteObservacion').value = tarifa.observacion || '';
    document.getElementById('tarifaClienteActivo').checked = tarifa.activo !== false;
    document.getElementById('tarifaClienteModal').classList.add('active');
}

async function cargarUsuariosAsignablesVendedor(vendedorId = null, usuarioSeleccionado = null) {
    const select = document.getElementById('vendedorUsuarioId');
    if (!select) return;

    try {
        const url = vendedorId
            ? `/api/comercial/vendedores/usuarios-asignables?vendedor_id=${vendedorId}`
            : '/api/comercial/vendedores/usuarios-asignables';
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error('No se pudieron cargar los usuarios');
        vendedorUsuariosAsignablesData = await response.json();
    } catch (error) {
        console.error('Error cargando usuarios asignables:', error);
        vendedorUsuariosAsignablesData = [];
    }

    const opciones = ['<option value="">Sin usuario asignado</option>'];
    (vendedorUsuariosAsignablesData || []).forEach(usuario => {
        const etiqueta = `${usuario.nombre_completo} (${usuario.usuario})`;
        if (usuario.disponible) {
            opciones.push(`<option value="${usuario.id}">${escapeHtml(etiqueta)}</option>`);
        } else {
            opciones.push(`<option value="${usuario.id}" disabled>${escapeHtml(etiqueta)} - ya asignado a ${escapeHtml(usuario.vendedor_asignado || 'otro vendedor')}</option>`);
        }
    });
    select.innerHTML = opciones.join('');
    select.value = usuarioSeleccionado != null ? String(usuarioSeleccionado) : '';
}

function mostrarAgregarVendedor() {
    document.getElementById('vendedorForm').reset();
    document.getElementById('vendedorId').value = '';
    document.getElementById('vendedorModalTitle').textContent = 'Nuevo Vendedor';
    document.getElementById('vendedorComisionVenta').value = '0';
    document.getElementById('vendedorComisionRecaudo').value = '0';
    document.getElementById('vendedorMontoBaseComision').value = '0';
    document.getElementById('vendedorActivo').checked = true;
    // Al crear un vendedor nuevo no aplica el boton eliminar.
    const eliminarBtn = document.getElementById('vendedorEliminarBtn');
    if (eliminarBtn) eliminarBtn.style.display = 'none';
    // Abrimos el modal de inmediato; la lista de usuarios asignables se carga
    // en segundo plano para no bloquear la apertura si el endpoint falla.
    document.getElementById('vendedorModal').classList.add('active');
    cargarUsuariosAsignablesVendedor().catch(err => console.error('Usuarios asignables:', err));
}

function closeVendedorModal() {
    document.getElementById('vendedorModal').classList.remove('active');
}

async function editarVendedorConfig(id) {
    const vendedor = vendedoresConfigData.find(item => item.id === id);
    if (!vendedor) return;

    document.getElementById('vendedorId').value = vendedor.id;
    document.getElementById('vendedorNombre').value = vendedor.nombre || '';
    document.getElementById('vendedorCargo').value = vendedor.cargo || '';
    document.getElementById('vendedorDocumento').value = vendedor.documento || '';
    document.getElementById('vendedorTelefono').value = vendedor.telefono || '';
    document.getElementById('vendedorEmail').value = vendedor.email || '';
    document.getElementById('vendedorComisionVenta').value = vendedor.porcentaje_comision_venta || 0;
    document.getElementById('vendedorComisionRecaudo').value = vendedor.porcentaje_comision_recaudo || 0;
    document.getElementById('vendedorMontoBaseComision').value = vendedor.monto_base_comision || 0;
    document.getElementById('vendedorDescripcion').value = vendedor.descripcion || '';
    document.getElementById('vendedorActivo').checked = vendedor.activo !== false;
    document.getElementById('vendedorModalTitle').textContent = 'Editar Vendedor';
    // Mostrar el boton eliminar solo si el usuario tiene permiso.
    const eliminarBtn = document.getElementById('vendedorEliminarBtn');
    if (eliminarBtn) {
        eliminarBtn.style.display = canManageComercial('vendedores', 'delete') ? '' : 'none';
    }
    document.getElementById('vendedorModal').classList.add('active');
    cargarUsuariosAsignablesVendedor(vendedor.id, vendedor.usuario_id)
        .catch(err => console.error('Usuarios asignables:', err));
}

function eliminarVendedorDesdeModal() {
    const id = document.getElementById('vendedorId').value;
    if (!id) return;
    eliminarVendedorConfig(Number(id));
}

async function guardarVendedorConfig(event) {
    event.preventDefault();
    const id = document.getElementById('vendedorId').value;
    const porcentajeVenta = parseFloat(document.getElementById('vendedorComisionVenta').value || '0');
    const porcentajeRecaudo = parseFloat(document.getElementById('vendedorComisionRecaudo').value || '0');
    const montoBase = parseFloat(document.getElementById('vendedorMontoBaseComision').value || '0');

    if (Number.isNaN(porcentajeVenta) || porcentajeVenta < 0 || porcentajeVenta > 100) {
        return showError('La comisión de venta debe estar entre 0 y 100.');
    }

    if (Number.isNaN(porcentajeRecaudo) || porcentajeRecaudo < 0 || porcentajeRecaudo > 100) {
        return showError('La comisión de recaudo debe estar entre 0 y 100.');
    }

    if (Number.isNaN(montoBase) || montoBase < 0) {
        return showError('El monto base de comisión no puede ser negativo.');
    }

    try {
        const response = await fetch(id ? `/api/comercial/vendedores/${id}` : '/api/comercial/vendedores', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                nombre: document.getElementById('vendedorNombre').value.trim(),
                cargo: document.getElementById('vendedorCargo').value.trim() || null,
                documento: document.getElementById('vendedorDocumento').value.trim() || null,
                telefono: document.getElementById('vendedorTelefono').value.trim() || null,
                email: document.getElementById('vendedorEmail').value.trim() || null,
                usuario_id: document.getElementById('vendedorUsuarioId').value || null,
                porcentaje_comision_venta: porcentajeVenta,
                porcentaje_comision_recaudo: porcentajeRecaudo,
                monto_base_comision: montoBase,
                descripcion: document.getElementById('vendedorDescripcion').value.trim() || null,
                activo: document.getElementById('vendedorActivo').checked
            })
        });
        const data = await response.json();
        if (!response.ok) return showError(data.error || 'Error al guardar vendedor');
        showSuccess(id ? 'Vendedor actualizado' : 'Vendedor creado');
        closeVendedorModal();
        await Promise.all([
            cargarVendedoresConfig(),
            loadComercialDashboard()
        ]);
    } catch (error) {
        console.error('Error guardando vendedor:', error);
        showError('Error de conexión al guardar vendedor');
    }
}

async function guardarClienteComercialConfig(event) {
    event.preventDefault();
    const id = document.getElementById('clienteComercialId').value;
    const vendedorId = document.getElementById('clienteComercialVendedorId').value;
    const razonSocial = document.getElementById('clienteComercialRazonSocial').value.trim();

    if (!vendedorId) {
        return showError('Debe seleccionar un vendedor responsable.');
    }

    if (!razonSocial) {
        return showError('La razón social es obligatoria.');
    }

    const formData = new FormData();
    formData.append('vendedor_id', vendedorId);
    formData.append('razon_social', razonSocial);
    formData.append('nombre_comercial', document.getElementById('clienteComercialNombreComercial').value.trim());
    formData.append('nit', document.getElementById('clienteComercialNit').value.trim());
    formData.append('ciudad', document.getElementById('clienteComercialCiudad').value.trim());
    formData.append('direccion', document.getElementById('clienteComercialDireccion').value.trim());
    formData.append('telefono_empresa', document.getElementById('clienteComercialTelefonoEmpresa').value.trim());
    formData.append('email_empresa', document.getElementById('clienteComercialEmailEmpresa').value.trim());
    formData.append('contacto_principal', document.getElementById('clienteComercialContactoPrincipal').value.trim());
    formData.append('cargo_contacto_principal', document.getElementById('clienteComercialCargoPrincipal').value.trim());
    formData.append('celular_contacto_principal', document.getElementById('clienteComercialCelularPrincipal').value.trim());
    formData.append('email_contacto_principal', document.getElementById('clienteComercialEmailPrincipal').value.trim());
    formData.append('contacto_facturacion', document.getElementById('clienteComercialContactoFacturacion').value.trim());
    formData.append('cargo_contacto_facturacion', document.getElementById('clienteComercialCargoFacturacion').value.trim());
    formData.append('celular_facturacion', document.getElementById('clienteComercialCelularFacturacion').value.trim());
    formData.append('email_facturacion', document.getElementById('clienteComercialEmailFacturacion').value.trim());
    formData.append('medio_autorizacion', document.getElementById('clienteComercialMedioAutorizacion').value);
    formData.append('estado_cliente', document.getElementById('clienteComercialEstado').value);
    formData.append('condicion_comercial', document.getElementById('clienteComercialCondicion').value);
    formData.append('requiere_factura', document.getElementById('clienteComercialRequiereFactura').checked ? 'true' : 'false');
    formData.append('fechas_facturacion', document.getElementById('clienteComercialFechasFacturacion').value.trim());
    formData.append('fecha_solicitud_factura', document.getElementById('clienteComercialFechaSolicitudFactura').value);
    formData.append('puntos_atencion_recepcion', document.getElementById('clienteComercialPuntosAtencionRecepcion').value.trim());
    formData.append('examenes_convenidos', document.getElementById('clienteComercialExamenes').value.trim());
    formData.append('servicios_convenidos', document.getElementById('clienteComercialServicios').value.trim());
    formData.append('tarifas_convenidas', document.getElementById('clienteComercialTarifas').value.trim());
    formData.append('documentos_legales_completos', document.getElementById('clienteComercialDocumentosCompletos').checked ? 'true' : 'false');
    formData.append('confirmado_administrativo', document.getElementById('clienteComercialConfirmadoAdministrativo').checked ? 'true' : 'false');
    formData.append('documentos_legales_detalle', document.getElementById('clienteComercialDocumentosDetalle').value.trim());
    formData.append('pagare_detalle', document.getElementById('clienteComercialPagareDetalle').value.trim());
    formData.append('observaciones', document.getElementById('clienteComercialObservaciones').value.trim());

    // Documentos por tipo (semaforo). Cada archivo nuevo se envia con un campo
    // "documento_<TIPO>" para que el backend lo guarde con ese tipo_documento.
    const docsState = window._clienteComercialDocsState || { nuevos: {} };
    const tiposConNuevo = Object.keys(docsState.nuevos || {});
    tiposConNuevo.forEach(tipo => {
        const file = docsState.nuevos[tipo];
        if (file) formData.append(`documento_${tipo}`, file);
    });
    formData.append('documentos_tipos', JSON.stringify(tiposConNuevo));
    // Coherencia: si adjuntan el pagare, marcamos pagare_firmado en true.
    formData.append('pagare_firmado', tiposConNuevo.includes('PAGARE') ? 'true' : 'false');

    try {
        const response = await fetch(id ? `/api/comercial/clientes/${id}` : '/api/comercial/clientes', {
            method: id ? 'PUT' : 'POST',
            credentials: 'include',
            body: formData
        });
        const data = await response.json();
        if (!response.ok) return showError(data.error || 'Error al guardar cliente comercial');
        await Promise.all([
            cargarClientesComercialesConfig(),
            cargarTarifasComercialesConfig(),
            loadComercialDashboard()
        ]);
        if (!id && data.id) {
            if (data.aviso) {
                showSuccess(`Cliente comercial creado. ${data.aviso}`);
            } else {
                showSuccess('Cliente comercial creado. Ya puedes asignar tarifas.');
            }
            await editarClienteComercial(data.id);
            return;
        }
        showSuccess('Cliente comercial actualizado');
        await refrescarAyudasComercialesVisibles();
        closeClienteComercialModal();
    } catch (error) {
        console.error('Error guardando cliente comercial:', error);
        showError('Error de conexión al guardar cliente comercial');
    }
}

function actualizarResumenPendientesCatalogo() {
    const summary = document.getElementById('catalogoComercialComponentesPendientesResumen');
    const button = document.querySelector('.catalogo-componentes-bulk-add');
    const total = catalogoComercialComponentesPendientes.length;
    const visibles = obtenerExamenesDisponiblesFiltrados(
        document.getElementById('catalogoComercialComponentesSearch')?.value || ''
    ).length;

    if (summary) {
        summary.textContent = total > 0
            ? `${total} examen(es) marcados para agregar. ${visibles} visible(s) con el filtro actual.`
            : `${visibles} examen(es) visibles con el filtro actual.`;
    }

    if (button) {
        button.disabled = total === 0;
    }
}

function togglePendienteComponenteCatalogo(id, checked) {
    const normalizedId = Number(id);
    if (Number.isNaN(normalizedId)) return;

    if (checked) {
        if (!catalogoComercialComponentesPendientes.includes(normalizedId)) {
            catalogoComercialComponentesPendientes.push(normalizedId);
        }
    } else {
        catalogoComercialComponentesPendientes = catalogoComercialComponentesPendientes.filter(itemId => Number(itemId) !== normalizedId);
    }

    actualizarResumenPendientesCatalogo();
}

function agregarComponentesCatalogoSeleccionados() {
    const nuevosIds = catalogoComercialComponentesPendientes.filter(
        id => !catalogoComercialComponentesSeleccionados.includes(Number(id))
    );

    if (nuevosIds.length === 0) {
        showError('Marca uno o varios examenes para agregarlos al paquete.');
        return;
    }

    catalogoComercialComponentesSeleccionados.push(...nuevosIds.map(id => Number(id)));
    catalogoComercialComponentesPendientes = [];
    filtrarCatalogoComponentesDisponibles();
}

function asegurarControlesComponentesCatalogo() {
    const searchInput = document.getElementById('catalogoComercialComponentesSearch');
    if (searchInput && !document.getElementById('catalogoComercialComponentesFiltroTipo')) {
        const select = document.createElement('select');
        select.id = 'catalogoComercialComponentesFiltroTipo';
        select.style.marginTop = '10px';
        select.onchange = () => filtrarCatalogoComponentesDisponibles();
        select.innerHTML = [
            '<option value="">Todas las clasificaciones</option>',
            '<option value="CONSULTA">CONSULTA</option>',
            '<option value="PARACLINICO">PARACLINICO</option>',
            '<option value="ECOBABY">ECOBABY</option>',
            '<option value="CURSOS">CURSOS (todos)</option>',
            '<option value="CURSOS|REMITIDO">CURSOS - Remitidos</option>',
            '<option value="CURSOS|NO_REMITIDO">CURSOS - No remitidos</option>',
            '<option value="LABORATORIO">LABORATORIO (todos)</option>',
            '<option value="LABORATORIO|REMITIDO">LABORATORIO - Remitidos</option>',
            '<option value="LABORATORIO|REALIZADO">LABORATORIO - Realizados en laboratorio</option>'
        ].join('');
        searchInput.insertAdjacentElement('afterend', select);
    }

    const addButton = document.querySelector('.catalogo-componentes-bulk-add');
    if (addButton && !document.querySelector('.catalogo-componentes-toolbar-actions')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'catalogo-componentes-toolbar-actions';

        const markVisibleButton = document.createElement('button');
        markVisibleButton.type = 'button';
        markVisibleButton.className = 'catalogo-componentes-secondary';
        markVisibleButton.textContent = 'Marcar visibles';
        markVisibleButton.onclick = () => marcarTodosComponentesFiltrados();

        const clearPendingButton = document.createElement('button');
        clearPendingButton.type = 'button';
        clearPendingButton.className = 'catalogo-componentes-secondary';
        clearPendingButton.textContent = 'Limpiar marcados';
        clearPendingButton.onclick = () => limpiarPendientesComponentesCatalogo();

        addButton.insertAdjacentElement('beforebegin', wrapper);
        wrapper.appendChild(markVisibleButton);
        wrapper.appendChild(clearPendingButton);
        wrapper.appendChild(addButton);
    }
}

function obtenerExamenesDisponiblesFiltrados(query = '') {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const filtroRaw = String(document.getElementById('catalogoComercialComponentesFiltroTipo')?.value || '').trim().toUpperCase();
    const selectedSet = new Set(catalogoComercialComponentesSeleccionados.map(id => Number(id)));

    // El filtro puede ser "TIPO" o "TIPO|SUBTIPO"
    const filtroParts = filtroRaw ? filtroRaw.split('|') : [];
    const filtroTipo = filtroParts[0] || '';
    const filtroSubtipo = filtroParts[1] || '';

    const disponibles = catalogoComercialExamenesDisponibles.filter(
        item => item.activo !== false && item.clasificacion_completa === true && !selectedSet.has(Number(item.id))
    );

    return disponibles.filter(item => {
        if (filtroTipo) {
            // Filtrar por tipo principal
            if (item.tipo_examen !== filtroTipo) {
                return false;
            }
            // Si además se especificó subtipo, filtrar por subtipo
            if (filtroSubtipo && (item.subtipo_laboratorio || '') !== filtroSubtipo) {
                return false;
            }
        }

        if (!normalizedQuery) {
            return true;
        }

        return [
            item.nombre,
            item.codigo,
            item.clasificacion_resumen,
            item.tipo_examen,
            item.subtipo_laboratorio
        ].some(value => String(value || '').toLowerCase().includes(normalizedQuery));
    });
}

function marcarTodosComponentesFiltrados() {
    const query = document.getElementById('catalogoComercialComponentesSearch')?.value || '';
    const visibles = obtenerExamenesDisponiblesFiltrados(query);
    if (visibles.length === 0) {
        showError('No hay examenes visibles para marcar.');
        return;
    }

    const pendientesSet = new Set(catalogoComercialComponentesPendientes.map(id => Number(id)));
    visibles.forEach(item => pendientesSet.add(Number(item.id)));
    catalogoComercialComponentesPendientes = Array.from(pendientesSet);
    filtrarCatalogoComponentesDisponibles();
}

function limpiarPendientesComponentesCatalogo() {
    catalogoComercialComponentesPendientes = [];
    actualizarResumenPendientesCatalogo();
    filtrarCatalogoComponentesDisponibles();
}

async function renderCatalogoComercialComponentes(selectedIds = [], options = {}) {
    const currentContainer = document.getElementById('catalogoComercialComponentesActuales');
    const availableContainer = document.getElementById('catalogoComercialComponentesList');
    const searchInput = document.getElementById('catalogoComercialComponentesSearch');
    const { forceRefresh = false } = options;
    if (!currentContainer || !availableContainer) return;

    try {
        asegurarControlesComponentesCatalogo();
        const items = await asegurarCatalogoComercial(forceRefresh);
        const examenes = items
            .filter(item => item.tipo_item === 'EXAMEN')
            .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        const examenesDisponibles = examenes.filter(
            item => item.activo !== false && item.clasificacion_completa === true
        );
        const selectedOrder = (selectedIds || []).map(id => Number(id)).filter(id => !Number.isNaN(id));
        const examenesById = new Map(examenes.map(item => [Number(item.id), item]));
        const pendientes = items.filter(
            item => item.tipo_item === 'EXAMEN' && (item.clasificacion_completa !== true || item.activo === false)
        );

        catalogoComercialExamenesDisponibles = examenes;
        catalogoComercialComponentesSeleccionados = selectedOrder.filter(id => examenesById.has(id));
        catalogoComercialComponentesPendientes = [];

        if (searchInput) {
            searchInput.value = '';
        }

        if (examenesDisponibles.length === 0) {
            currentContainer.innerHTML = '<div class="catalogo-componentes-empty">Todavía no hay exámenes completamente clasificados para armar paquetes.</div>';
            availableContainer.innerHTML = '<div class="catalogo-componentes-empty">Todavía no hay exámenes disponibles para agregar.</div>';
            actualizarResumenPendientesCatalogo();
            return;
        }

        renderCatalogoComercialComponentesDisponibles('');

        if (pendientes.length > 0) {
            const resumen = document.getElementById('catalogoComercialComponentesResumen');
            if (resumen && !catalogoComercialComponentesSeleccionados.length) {
                resumen.textContent = `Hay ${pendientes.length} examen(es) pendientes de clasificar. Esos aún no aparecen para paquetes.`;
            }
        }
    } catch (error) {
        console.error('Error cargando componentes del paquete:', error);
        currentContainer.innerHTML = '<div class="catalogo-componentes-empty">No fue posible cargar la composición actual del paquete.</div>';
        availableContainer.innerHTML = '<div class="catalogo-componentes-empty">No fue posible cargar los exámenes del catálogo.</div>';
        catalogoComercialComponentesPendientes = [];
        actualizarResumenPendientesCatalogo();
    }
}

function renderCatalogoComercialComponentesActuales() {
    const container = document.getElementById('catalogoComercialComponentesActuales');
    const resumen = document.getElementById('catalogoComercialComponentesResumen');
    if (!container || !resumen) return;

    const examenesById = new Map(catalogoComercialExamenesDisponibles.map(item => [Number(item.id), item]));
    const seleccionados = catalogoComercialComponentesSeleccionados
        .map(id => examenesById.get(Number(id)))
        .filter(Boolean);

    if (seleccionados.length === 0) {
        container.innerHTML = '<div class="catalogo-componentes-empty">Todavía no has agregado exámenes al paquete.</div>';
        resumen.textContent = 'Sin exámenes seleccionados.';
        return;
    }


    container.innerHTML = seleccionados.map(item => `
        <div class="catalogo-componentes-current">
            <div>
                <strong>${escapeHtml(item.nombre || 'N/A')}</strong>
                <div class="catalogo-componentes-current-meta">${escapeHtml([obtenerResumenClasificacionCatalogo(item), item.codigo || 'Sin codigo'].filter(Boolean).join(' · '))}</div>
            </div>
            <button type="button" class="catalogo-componentes-action" onclick="quitarComponenteCatalogo(${Number(item.id)})">Quitar</button>
        </div>
    `).join('');

    resumen.textContent = `Este paquete tiene ${seleccionados.length} examen(es) seleccionados. Puedes seguir agregando, quitar uno puntual o ajustar la busqueda para completar el paquete.`;
}

function renderCatalogoComercialComponentesDisponibles(query = '') {
    const container = document.getElementById('catalogoComercialComponentesList');
    if (!container) return;

    asegurarControlesComponentesCatalogo();
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const pendientesSet = new Set(catalogoComercialComponentesPendientes.map(id => Number(id)));
    const filtrados = obtenerExamenesDisponiblesFiltrados(query);

    if (filtrados.length === 0) {
        container.innerHTML = normalizedQuery
            ? '<div class="catalogo-componentes-empty">No encontramos exámenes con esa búsqueda.</div>'
            : '<div class="catalogo-componentes-empty">Todos los exámenes disponibles ya están dentro del paquete.</div>';
        renderCatalogoComercialComponentesActuales();
        actualizarResumenPendientesCatalogo();
        return;
    }

    const grupos = obtenerGruposCatalogoParaPaquete(filtrados);
    container.innerHTML = grupos.map(grupo => `
        <div style="margin-bottom:14px;">
            <div style="font-weight:700; color:#0f172a; margin-bottom:8px;">${escapeHtml(grupo.title)}</div>
            ${grupo.items.map(item => `
                <label class="catalogo-componentes-item">
                    <input
                        type="checkbox"
                        class="catalogo-componente-checkbox"
                        ${pendientesSet.has(Number(item.id)) ? 'checked' : ''}
                        onchange="togglePendienteComponenteCatalogo(${Number(item.id)}, this.checked)"
                    >
                    <span class="catalogo-componentes-item-name">
                        ${escapeHtml(item.nombre || 'N/A')}
                        <small>${escapeHtml(item.codigo || 'Sin código')}</small>
                    </span>
                    <button type="button" class="catalogo-componentes-add" onclick="agregarComponenteCatalogo(${Number(item.id)})">Agregar</button>
                </div>
            `).join('')}
        </div>
    `).join('');

    renderCatalogoComercialComponentesActuales();
    actualizarResumenPendientesCatalogo();
}

function filtrarCatalogoComponentesDisponibles() {
    const query = document.getElementById('catalogoComercialComponentesSearch')?.value || '';
    renderCatalogoComercialComponentesDisponibles(query);
}

function agregarComponenteCatalogo(id) {
    const normalizedId = Number(id);
    if (!catalogoComercialComponentesSeleccionados.includes(normalizedId)) {
        catalogoComercialComponentesSeleccionados.push(normalizedId);
    }
    catalogoComercialComponentesPendientes = catalogoComercialComponentesPendientes.filter(itemId => Number(itemId) !== normalizedId);
    actualizarResumenPendientesCatalogo();
    filtrarCatalogoComponentesDisponibles();
}

function quitarComponenteCatalogo(id) {
    const normalizedId = Number(id);
    catalogoComercialComponentesSeleccionados = catalogoComercialComponentesSeleccionados.filter(itemId => Number(itemId) !== normalizedId);
    filtrarCatalogoComponentesDisponibles();
}

function actualizarVisibilidadComponentesCatalogo() {
    const tipoSelect = document.getElementById('catalogoComercialTipo');
    const tipoExamenRow = document.getElementById('catalogoComercialTipoExamenRow');
    const subtipoRow = document.getElementById('catalogoComercialSubtipoLaboratorioRow');
    const row = document.getElementById('catalogoComercialComponentesRow');
    const tipoExamenSelect = document.getElementById('catalogoComercialTipoExamen');
    const subtipoSelect = document.getElementById('catalogoComercialSubtipoLaboratorio');
    const searchInput = document.getElementById('catalogoComercialComponentesSearch');
    if (!tipoSelect || !row || !tipoExamenRow || !tipoExamenSelect || !subtipoRow || !subtipoSelect) return;

    const esExamen = tipoSelect.value === 'EXAMEN';
    const esPaquete = tipoSelect.value === 'PAQUETE';
    const requiereSubtipo = esExamen && ['LABORATORIO', 'CURSOS'].includes(tipoExamenSelect.value);

    actualizarOpcionesSubtipoCatalogo();

    tipoExamenRow.style.display = esExamen ? 'grid' : 'none';
    subtipoRow.style.display = requiereSubtipo ? 'grid' : 'none';
    row.style.display = esPaquete ? 'block' : 'none';

    if (!esExamen) {
        tipoExamenSelect.value = '';
        subtipoSelect.value = '';
    }

    if (!requiereSubtipo) {
        subtipoSelect.value = '';
    }

    if (!esPaquete) {
        catalogoComercialComponentesSeleccionados = [];
        catalogoComercialComponentesPendientes = [];
        if (searchInput) {
            searchInput.value = '';
        }
        const filterSelect = document.getElementById('catalogoComercialComponentesFiltroTipo');
        if (filterSelect) {
            filterSelect.value = '';
        }
        renderCatalogoComercialComponentesActuales();
        renderCatalogoComercialComponentesDisponibles('');
        actualizarResumenPendientesCatalogo();
    }
}

function mostrarAgregarItemCatalogoComercial() {
    const form = document.getElementById('catalogoComercialForm');
    if (!form) return;

    form.reset();
    document.getElementById('catalogoComercialId').value = '';
    document.getElementById('catalogoComercialModalTitle').textContent = 'Nuevo Examen o Paquete';
    document.getElementById('catalogoComercialTipo').value = 'EXAMEN';
    document.getElementById('catalogoComercialTipoExamen').value = '';
    actualizarOpcionesSubtipoCatalogo();
    document.getElementById('catalogoComercialSubtipoLaboratorio').value = '';
    document.getElementById('catalogoComercialTarifaBase').value = '0';
    document.getElementById('catalogoComercialActivo').checked = true;
    renderCatalogoComercialComponentes([], { forceRefresh: true });
    actualizarVisibilidadComponentesCatalogo();
    document.getElementById('catalogoComercialModal').classList.add('active');
}

async function editarItemCatalogoComercial(id) {
    await asegurarCatalogoComercial(true);
    const item = catalogoComercialData.find(entry => entry.id === id);
    if (!item) return;

    await renderCatalogoComercialComponentes(item.componentes_ids || [], { forceRefresh: true });
    document.getElementById('catalogoComercialId').value = item.id;
    document.getElementById('catalogoComercialModalTitle').textContent = item.tipo_item === 'PAQUETE'
        ? 'Editar Paquete'
        : (item.tipo_item === 'SERVICIO' ? 'Editar Registro Legado' : 'Editar Examen');
    document.getElementById('catalogoComercialTipo').value = item.tipo_item || 'EXAMEN';
    document.getElementById('catalogoComercialTipoExamen').value = item.tipo_examen || '';
    actualizarOpcionesSubtipoCatalogo(item.subtipo_laboratorio || '');
    document.getElementById('catalogoComercialSubtipoLaboratorio').value = item.subtipo_laboratorio || '';
    document.getElementById('catalogoComercialCodigo').value = item.codigo || '';
    document.getElementById('catalogoComercialNombre').value = item.nombre || '';
    document.getElementById('catalogoComercialNombreCorto').value = item.nombre_corto || '';
    document.getElementById('catalogoComercialTarifaBase').value = item.tarifa_base || 0;
    document.getElementById('catalogoComercialDescripcion').value = item.descripcion || '';
    document.getElementById('catalogoComercialActivo').checked = item.activo !== false;
    actualizarVisibilidadComponentesCatalogo();
    document.getElementById('catalogoComercialModal').classList.add('active');
}

async function guardarCatalogoComercialConfig(event) {
    event.preventDefault();
    const id = document.getElementById('catalogoComercialId').value;
    const tipoItem = document.getElementById('catalogoComercialTipo').value;
    const tipoExamen = document.getElementById('catalogoComercialTipoExamen').value;
    const subtipoLaboratorio = document.getElementById('catalogoComercialSubtipoLaboratorio').value;
    const tarifaBase = parseFloat(document.getElementById('catalogoComercialTarifaBase').value || '0');
    const componentesIds = obtenerComponentesSeleccionadosCatalogo();

    if (Number.isNaN(tarifaBase) || tarifaBase < 0) {
        return showError('La tarifa base no puede ser negativa.');
    }

    if (tipoItem === 'PAQUETE' && componentesIds.length === 0) {
        return showError('Selecciona al menos un examen para armar el paquete.');
    }

    try {
        const response = await fetch(id ? `/api/comercial/catalogo/${id}` : '/api/comercial/catalogo', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                tipo_item: tipoItem,
                tipo_examen: tipoItem === 'EXAMEN' ? (tipoExamen || null) : null,
                subtipo_laboratorio: tipoItem === 'EXAMEN' ? (subtipoLaboratorio || null) : null,
                codigo: document.getElementById('catalogoComercialCodigo').value.trim() || null,
                nombre: document.getElementById('catalogoComercialNombre').value.trim(),
                nombre_corto: document.getElementById('catalogoComercialNombreCorto').value.trim() || null,
                tarifa_base: tarifaBase,
                descripcion: document.getElementById('catalogoComercialDescripcion').value.trim() || null,
                activo: document.getElementById('catalogoComercialActivo').checked,
                componentes_ids: tipoItem === 'PAQUETE' ? componentesIds : []
            })
        });
        const data = await response.json();
        if (!response.ok) return showError(data.error || 'Error al guardar item comercial');
        showSuccess(id ? 'Item comercial actualizado' : 'Item comercial creado');
        closeCatalogoComercialModal();
        await Promise.all([
            cargarCatalogoComercialConfig(),
            cargarTarifasComercialesConfig()
        ]);
        await refrescarAyudasComercialesVisibles();
    } catch (error) {
        console.error('Error guardando item comercial:', error);
        showError('Error de conexion al guardar item comercial');
    }
}

async function guardarTarifaClienteConfig(event) {
    event.preventDefault();
    const id = document.getElementById('tarifaClienteId').value;
    const tarifaNegociada = parseFloat(document.getElementById('tarifaClienteTarifaNegociada').value || '0');

    if (Number.isNaN(tarifaNegociada) || tarifaNegociada < 0) {
        return showError('La tarifa del cliente no puede ser negativa.');
    }

    try {
        const response = await fetch(id ? `/api/comercial/tarifas/${id}` : '/api/comercial/tarifas', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                cliente_id: document.getElementById('tarifaClienteClienteId').value,
                catalogo_item_id: document.getElementById('tarifaClienteCatalogoItemId').value,
                tarifa_negociada: tarifaNegociada,
                vigencia_desde: document.getElementById('tarifaClienteVigenciaDesde').value || null,
                vigencia_hasta: document.getElementById('tarifaClienteVigenciaHasta').value || null,
                observacion: document.getElementById('tarifaClienteObservacion').value.trim() || null,
                activo: document.getElementById('tarifaClienteActivo').checked
            })
        });
        const data = await response.json();
        if (!response.ok) return showError(data.error || 'Error al guardar tarifa comercial');
        showSuccess(id ? 'Tarifa comercial actualizada' : 'Tarifa comercial creada');
        await Promise.all([
            cargarTarifasComercialesConfig(),
            cargarClientesComercialesConfig()
        ]);
        await refrescarAyudasComercialesVisibles();
        closeTarifaClienteModal();
    } catch (error) {
        console.error('Error guardando tarifa comercial:', error);
        showError('Error de conexión al guardar tarifa comercial');
    }
}

async function mostrarAgregarAtencionCliente() {
    if (!clienteSeguimientoContext.clienteId) {
        showError('Selecciona primero un cliente comercial.');
        return;
    }

    const form = document.getElementById('seguimientoAtencionForm');
    document.getElementById('seguimientoAtencionModalTitle').textContent = 'Nueva AtenciÃ³n';
    form?.reset();
    if (form) {
        form.dataset.atencionId = '';
    }
    document.getElementById('seguimientoAtencionFecha').value = getTodayIsoDate();
    clienteSeguimientoContext.draftDetalles = [];
    renderSeguimientoDraftDetalles();
    try {
        await loadSeguimientoConvenioItems(document.getElementById('seguimientoAtencionFecha').value);
    } catch (error) {
        console.error('Error cargando convenio para atenciÃ³n:', error);
        showError(error.message || 'No se pudieron cargar los items convenidos.');
    }
    document.getElementById('seguimientoAtencionModal')?.classList.add('active');
}

async function editarSeguimientoAtencion(atencionId) {
    const atencion = getAtencionSeguimientoById(atencionId);
    if (!atencion) {
        showError('No se pudo localizar la atenciÃ³n seleccionada.');
        return;
    }

    const form = document.getElementById('seguimientoAtencionForm');
    form?.reset();
    if (form) {
        form.dataset.atencionId = String(atencion.id);
    }
    document.getElementById('seguimientoAtencionModalTitle').textContent = 'Editar AtenciÃ³n';
    document.getElementById('seguimientoAtencionFecha').value = atencion.fecha_atencion || getTodayIsoDate();
    document.getElementById('seguimientoAtencionObservaciones').value = atencion.observaciones || '';

    try {
        await loadSeguimientoConvenioItems(document.getElementById('seguimientoAtencionFecha').value);
    } catch (error) {
        console.error('Error cargando convenio para editar atenciÃ³n:', error);
        showError(error.message || 'No se pudieron cargar los items convenidos.');
        return;
    }

    clienteSeguimientoContext.draftDetalles = (atencion.detalles || []).map(detalle => ({
        catalogo_item_id: Number(detalle.catalogo_item_id),
        paciente_documento: detalle.paciente_documento || '',
        paciente_nombre: detalle.paciente_nombre || '',
        nombre: detalle.nombre_item || 'Item',
        tipo_item: detalle.tipo_item || 'EXAMEN',
        valor_unitario: Number(detalle.valor_item || 0)
    }));
    renderSeguimientoDraftDetalles();
    document.getElementById('seguimientoAtencionModal')?.classList.add('active');
}

async function guardarSeguimientoAtencion(event) {
    event.preventDefault();

    const clienteId = clienteSeguimientoContext.clienteId;
    const form = document.getElementById('seguimientoAtencionForm');
    const atencionId = form?.dataset.atencionId || '';
    if (!clienteId) {
        showError('No hay cliente activo para registrar la atenciÃ³n.');
        return;
    }

    if (!(clienteSeguimientoContext.draftDetalles || []).length) {
        showError('Agrega al menos un examen o paquete antes de guardar la atenciÃ³n.');
        return;
    }

    try {
        const response = await fetch(
            atencionId ? `/api/comercial/atenciones/${atencionId}` : `/api/comercial/clientes/${clienteId}/atenciones`,
            {
                method: atencionId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    fecha_atencion: document.getElementById('seguimientoAtencionFecha').value,
                    observaciones: document.getElementById('seguimientoAtencionObservaciones').value.trim(),
                    detalles: clienteSeguimientoContext.draftDetalles.map(detalle => ({
                        catalogo_item_id: detalle.catalogo_item_id,
                        paciente_documento: detalle.paciente_documento,
                        paciente_nombre: detalle.paciente_nombre
                    }))
                })
            }
        );
        const data = await response.json();
        if (!response.ok) {
            showError(buildComercialDeleteBlockedMessage(data.error || 'No fue posible guardar la atenciÃ³n.', data.details));
            return;
        }

        showSuccess(atencionId ? 'AtenciÃ³n actualizada.' : 'AtenciÃ³n registrada.');
        closeSeguimientoAtencionModal();
        await cargarSeguimientoCliente(clienteId);
        setSeguimientoPanelVisible('atenciones');
    } catch (error) {
        console.error('Error guardando atenciÃ³n de seguimiento:', error);
        showError('Error de conexiÃ³n al guardar la atenciÃ³n.');
    }
}

async function eliminarSeguimientoAtencion(atencionId) {
    if (!confirm('Â¿Desea eliminar esta atenciÃ³n comercial?')) {
        return;
    }

    try {
        const response = await fetch(`/api/comercial/atenciones/${atencionId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            showError(buildComercialDeleteBlockedMessage(data.error || 'No fue posible eliminar la atenciÃ³n.', data.details));
            return;
        }

        showSuccess('AtenciÃ³n eliminada.');
        await cargarSeguimientoCliente(clienteSeguimientoContext.clienteId);
        setSeguimientoPanelVisible('atenciones');
    } catch (error) {
        console.error('Error eliminando atenciÃ³n de seguimiento:', error);
        showError('Error de conexiÃ³n al eliminar la atenciÃ³n.');
    }
}

async function eliminarVendedorConfig(vendedorId) {
    if (!confirm('Â¿Desea eliminar este vendedor?')) {
        return;
    }

    try {
        const response = await fetch(`/api/comercial/vendedores/${vendedorId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            showError(buildComercialDeleteBlockedMessage(data.error || 'No fue posible eliminar el vendedor.', data.details));
            return;
        }

        showSuccess('Vendedor eliminado.');
        closeVendedorModal();
        await Promise.all([
            cargarVendedoresConfig(),
            cargarClientesComercialesConfig(),
            loadComercialDashboard()
        ]);
        // Refrescar la consulta de vendedores si esta abierta.
        const input = document.getElementById('comercialVendedoresSearch');
        if (input) renderConsultaComercialResults('vendedores', input.value || '');
    } catch (error) {
        console.error('Error eliminando vendedor:', error);
        showError('Error de conexion al eliminar el vendedor.');
    }
}

async function eliminarItemCatalogoComercial(itemId) {
    if (!confirm('Â¿Desea eliminar este examen o paquete?')) {
        return;
    }

    try {
        const response = await fetch(`/api/comercial/catalogo/${itemId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            showError(buildComercialDeleteBlockedMessage(data.error || 'No fue posible eliminar el item comercial.', data.details));
            return;
        }

        showSuccess('Item comercial eliminado.');
        await Promise.all([
            cargarCatalogoComercialConfig(),
            cargarTarifasComercialesConfig()
        ]);
        await refrescarAyudasComercialesVisibles();
    } catch (error) {
        console.error('Error eliminando item comercial:', error);
        showError('Error de conexiÃ³n al eliminar el item comercial.');
    }
}

async function eliminarTarifaComercialConfig(tarifaId) {
    if (!confirm('Â¿Desea eliminar esta tarifa comercial?')) {
        return;
    }

    try {
        const response = await fetch(`/api/comercial/tarifas/${tarifaId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            showError(data.error || 'No fue posible eliminar la tarifa comercial.');
            return;
        }

        showSuccess('Tarifa comercial eliminada.');
        await Promise.all([
            cargarTarifasComercialesConfig(),
            cargarClientesComercialesConfig()
        ]);
        await refrescarAyudasComercialesVisibles();
    } catch (error) {
        console.error('Error eliminando tarifa comercial:', error);
        showError('Error de conexiÃ³n al eliminar la tarifa comercial.');
    }
}

async function eliminarClienteComercialConfig(clienteId) {
    if (!confirm('Â¿Desea eliminar este cliente comercial?')) {
        return;
    }

    try {
        const response = await fetch(`/api/comercial/clientes/${clienteId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            showError(buildComercialDeleteBlockedMessage(data.error || 'No fue posible eliminar el cliente comercial.', data.details));
            return;
        }

        showSuccess('Cliente comercial eliminado.');
        await Promise.all([
            cargarClientesComercialesConfig(),
            cargarTarifasComercialesConfig(),
            loadComercialDashboard()
        ]);
    } catch (error) {
        console.error('Error eliminando cliente comercial:', error);
        showError('Error de conexiÃ³n al eliminar el cliente comercial.');
    }
}

async function loadRoles() {
    const tableBody = document.getElementById('rolesTable');
    if (!tableBody) return;

    try {
        const response = await fetchUsuariosEndpoint('/api/usuarios/roles');
        const roles = await response.json();
        if (!response.ok) {
            throw new Error(roles.error || 'No se pudo cargar la lista de roles');
        }

        rolesData = Array.isArray(roles) ? roles : [];
        if (rolesData.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="loading">No hay roles configurados</td></tr>';
            fillRoleSelect();
            return;
        }

        tableBody.innerHTML = rolesData.map(role => {
            const commercialCount = (role.permissions || []).filter(item => item.category === 'comercial').length;
            const resumenAcceso = [
                (role.menu_permissions || []).map(item => item.nombre).join(', ') || 'Sin menu',
                commercialCount ? `${commercialCount} permisos comerciales` : 'Sin permisos comerciales'
            ].join(' | ');
            return `
                <tr>
                    <td>${escapeHtml(role.nombre || 'N/A')}</td>
                    <td>${escapeHtml(role.descripcion || 'Sin descripcion')}</td>
                    <td>${escapeHtml(resumenAcceso)}</td>
                    <td>${Number(role.cantidad_usuarios || 0)}</td>
                    <td>
                        <button class="action-btn action-btn-edit" onclick="editRole(${role.id})">Editar</button>
                        ${role.nombre !== 'Administrador' ? `<button class="action-btn action-btn-delete" onclick='deleteRole(${role.id}, ${JSON.stringify(role.nombre || '')})'>Eliminar</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');

        fillRoleSelect();
    } catch (error) {
        console.error('Error cargando roles:', error);
        tableBody.innerHTML = `<tr><td colspan="5" class="loading">${escapeHtml(error.message || 'Error al cargar roles')}</td></tr>`;
    }
}

async function cargarVendedoresConfig() {
    const tbody = document.getElementById('comercialVendedoresTable');
    if (!tbody) return;

    try {
        const response = await fetch('/api/comercial/vendedores', { credentials: 'include' });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'No se pudo cargar la lista de vendedores');
        }
        const vendedores = await response.json();
        vendedoresConfigData = Array.isArray(vendedores) ? vendedores : [];

        if (vendedoresConfigData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="loading">No hay vendedores configurados</td></tr>';
            return;
        }

        tbody.innerHTML = vendedoresConfigData.map(vendedor => `
            <tr>
                <td>${escapeHtml(vendedor.nombre || 'N/A')}</td>
                <td>${escapeHtml(vendedor.documento || 'N/A')}</td>
                <td>${Number(vendedor.porcentaje_comision_venta || 0).toFixed(2)}%</td>
                <td>${Number(vendedor.porcentaje_comision_recaudo || 0).toFixed(2)}%</td>
                <td>${formatCurrency(vendedor.monto_base_comision || 0)}</td>
                <td>${vendedor.activo ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-danger">Inactivo</span>'}</td>
                <td>
                    ${canManageComercial('vendedores', 'update') ? `<button class="action-btn action-btn-edit" onclick="editarVendedorConfig(${vendedor.id})">Editar</button>` : ''}
                    ${canManageComercial('vendedores', 'delete') ? `<button class="action-btn action-btn-delete" onclick="eliminarVendedorConfig(${vendedor.id})">Eliminar</button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando vendedores:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Error al cargar vendedores</td></tr>';
    }
}

async function cargarTarifasComercialesConfig() {
    const tbody = document.getElementById('comercialTarifasTable');
    if (!tbody) return;

    try {
        const response = await fetch('/api/comercial/tarifas', { credentials: 'include' });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'No se pudo cargar la lista de tarifas comerciales');
        }
        const tarifas = await response.json();
        tarifasComercialesData = Array.isArray(tarifas) ? tarifas : [];

        if (tarifasComercialesData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="loading">No hay tarifas diferenciales configuradas</td></tr>';
            return;
        }

        tbody.innerHTML = tarifasComercialesData.map(tarifa => `
            <tr>
                <td>${escapeHtml(tarifa.cliente_nombre || 'N/A')}</td>
                <td>
                    <strong>${escapeHtml(tarifa.item_nombre || 'N/A')}</strong>
                    <div style="color:#666; font-size:0.85rem;">${escapeHtml(tarifa.tipo_item === 'EXAMEN' ? obtenerResumenClasificacionCatalogo(tarifa) : (tarifa.tipo_item || ''))}</div>
                </td>
                <td>${formatCurrency(tarifa.tarifa_base || 0)}</td>
                <td>${formatCurrency(tarifa.tarifa_negociada || 0)}</td>
                <td>${escapeHtml([tarifa.vigencia_desde || '', tarifa.vigencia_hasta || ''].filter(Boolean).join(' a ') || 'Abierta')}</td>
                <td>${tarifa.activo ? '<span class="badge badge-success">Activa</span>' : '<span class="badge badge-danger">Inactiva</span>'}</td>
                <td>
                    ${canManageComercial('tarifas', 'update') ? `<button class="action-btn action-btn-edit" onclick="editarTarifaCliente(${tarifa.id})">Editar</button>` : ''}
                    ${canManageComercial('tarifas', 'delete') ? `<button class="action-btn action-btn-delete" onclick="eliminarTarifaComercialConfig(${tarifa.id})">Eliminar</button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando tarifas comerciales:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Error al cargar tarifas comerciales</td></tr>';
    }
}

async function cargarCatalogoComercialConfig() {
    const tbody = document.getElementById('comercialCatalogoTable');
    if (!tbody) return;

    try {
        const response = await fetch('/api/comercial/catalogo', { credentials: 'include' });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'No se pudo cargar el catalogo comercial');
        }
        const items = await response.json();
        catalogoComercialData = Array.isArray(items) ? items : [];

        if (catalogoComercialData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="loading">No hay examenes o paquetes configurados</td></tr>';
            return;
        }

        tbody.innerHTML = catalogoComercialData.map(item => {
            const entity = getCatalogEntityFromTipoItem(item.tipo_item);
            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(item.tipo_item || 'N/A')}</strong>
                        ${item.tipo_item === 'EXAMEN' ? `<div style="color:#666; font-size:0.82rem;">${item.clasificacion_completa ? 'Listo para usar' : 'Pendiente de clasificar'}</div>` : ''}
                    </td>
                    <td>
                        ${item.tipo_item === 'EXAMEN'
                            ? `<span class="badge ${item.clasificacion_completa ? 'badge-info' : 'badge-warning-soft'}">${escapeHtml(obtenerResumenClasificacionCatalogo(item))}</span>`
                            : '<span class="badge badge-secondary">No aplica</span>'}
                    </td>
                    <td>${escapeHtml(item.codigo || 'N/A')}</td>
                    <td>
                        <strong>${escapeHtml(item.nombre || 'N/A')}</strong>
                        <div style="color:#666; font-size:0.85rem;">${escapeHtml(item.descripcion || '')}</div>
                        ${item.tipo_item === 'PAQUETE' ? `<div style="color:#0b5ed7; font-size:0.82rem; margin-top:4px;">Incluye ${item.cantidad_componentes || 0} examen(es): ${escapeHtml(item.resumen_componentes || 'Sin examenes definidos')}</div>` : ''}
                    </td>
                    <td>${formatCurrency(item.tarifa_base || 0)}</td>
                    <td>${item.activo ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-danger">Inactivo</span>'}</td>
                    <td>
                        ${canManageComercial(entity, 'update') ? `<button class="action-btn action-btn-edit" onclick="editarItemCatalogoComercial(${item.id})">Editar</button>` : ''}
                        ${canManageComercial(entity, 'delete') ? `<button class="action-btn action-btn-delete" onclick="eliminarItemCatalogoComercial(${item.id})">Eliminar</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error cargando catalogo comercial:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Error al cargar catalogo comercial</td></tr>';
    }
}

async function cargarClientesComercialesConfig() {
    const tbody = document.getElementById('comercialClientesTable');
    if (!tbody) return;

    try {
        const response = await fetch('/api/comercial/clientes', { credentials: 'include' });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'No se pudo cargar la lista de clientes comerciales');
        }
        const clientes = await response.json();
        clientesComercialesData = Array.isArray(clientes) ? clientes : [];

        if (clientesComercialesData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="loading">No hay clientes comerciales configurados</td></tr>';
            return;
        }

        tbody.innerHTML = clientesComercialesData.map(cliente => `
            <tr>
                <td>
                    <strong>${escapeHtml(cliente.razon_social || 'N/A')}</strong>
                    <div style="color:#666; font-size:0.85rem;">${escapeHtml(cliente.nit || cliente.nombre_comercial || 'Sin NIT')}</div>
                </td>
                <td>${escapeHtml(cliente.vendedor_nombre || 'N/A')}</td>
                <td>${escapeHtml(cliente.condicion_comercial || 'N/A')}</td>
                <td style="max-width:240px;">${escapeHtml(cliente.resumen_facturacion || 'N/A')}</td>
                <td>
                    ${escapeHtml(obtenerContactoPreferidoCliente(cliente) || 'N/A')}
                    <div style="color:#666; font-size:0.85rem;">${escapeHtml(cliente.email_facturacion || cliente.email_contacto_principal || cliente.email_empresa || 'Sin email')}</div>
                </td>
                <td>
                    <div>Legales: ${cliente.documentos_legales_adjuntos?.length || 0}</div>
                    <div>Pagare: ${cliente.pagare_adjuntos?.length || 0}</div>
                </td>
                <td>${escapeHtml(formatearEstadoCliente(obtenerEstadoCliente(cliente)))}</td>
                <td>
                    ${canManageComercial('clientes', 'update') ? `<button class="action-btn action-btn-edit" onclick="editarClienteComercial(${cliente.id})">Editar</button>` : ''}
                    ${canManageComercial('clientes', 'delete') ? `<button class="action-btn action-btn-delete" onclick="eliminarClienteComercialConfig(${cliente.id})">Eliminar</button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando clientes comerciales:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Error al cargar clientes comerciales</td></tr>';
    }
}

function renderSeguimientoAtencionesTable() {
    const tbody = document.getElementById('clienteSeguimientoAtencionesTable');
    if (!tbody) return;

    const atenciones = clienteSeguimientoContext.atenciones || [];
    if (!atenciones.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Este cliente aun no tiene atenciones registradas.</td></tr>';
        return;
    }

    tbody.innerHTML = atenciones.map(atencion => {
        const detalle = atencion.detalle_resumen || atencion.detalle_items_resumen || 'Sin detalle';
        const acciones = [];
        if (atencion.documento_id && canManageComercial('pagos', 'create')) {
            acciones.push(`<button type="button" class="action-btn action-btn-edit" onclick="mostrarAgregarSeguimientoPago(${Number(atencion.documento_id)})">Registrar pago</button>`);
        }
        if (canManageComercial('atenciones', 'update')) {
            acciones.push(`<button type="button" class="action-btn action-btn-edit" onclick="editarSeguimientoAtencion(${Number(atencion.id)})">Editar</button>`);
        }
        if (canManageComercial('atenciones', 'delete')) {
            acciones.push(`<button type="button" class="action-btn action-btn-delete" onclick="eliminarSeguimientoAtencion(${Number(atencion.id)})">Eliminar</button>`);
        }

        return `
            <tr>
                <td>${escapeHtml(atencion.nro_atencion || 'N/A')}</td>
                <td>${escapeHtml(atencion.fecha_atencion || 'N/A')}</td>
                <td>${escapeHtml(atencion.pacientes_resumen || atencion.paciente_nombre || 'N/A')}</td>
                <td style="max-width:320px;">${escapeHtml(detalle)}</td>
                <td>${formatCurrency(atencion.valor_total || 0)}</td>
                <td>${formatCurrency(atencion.saldo_pendiente || 0)}</td>
                <td>${renderSeguimientoEstadoBadge(atencion.estado_cobro)}</td>
                <td style="display:flex; gap:6px; flex-wrap:wrap;">${acciones.join('') || '<span style="color:#64748b;">Sin acciones</span>'}</td>
            </tr>
        `;
    }).join('');
}

window.setTimeout(syncComercialPermissionUI, 0);

// ===========================================================================
// PREFACTURAS — CONSULTAR
// ===========================================================================

function _fmtMoney(v) {
    return Number(v || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ocultarSugerenciasEmpresasPrefacturas() {
    const container = document.getElementById('consultaPrefEmpresaSuggestions');
    if (!container) return;
    container.style.display = 'none';
    container.innerHTML = '';
}

function seleccionarEmpresaPrefactura(nombreEmpresa) {
    const input = document.getElementById('consultaPrefEmpresa');
    if (input) {
        input.value = nombreEmpresa || '';
    }
    ocultarSugerenciasEmpresasPrefacturas();
}

async function buscarEmpresasPrefacturas(query) {
    const container = document.getElementById('consultaPrefEmpresaSuggestions');
    if (!container) return;

    const text = String(query || '').trim();
    if (!text) {
        ocultarSugerenciasEmpresasPrefacturas();
        return;
    }

    try {
        await ensureClientesComercialesLoaded();
        const normalizedQuery = text.toLowerCase();
        const visibles = Array.isArray(clientesComercialesData) ? clientesComercialesData : [];

        const sugerencias = visibles
            .filter(cliente => {
                const values = [
                    cliente?.razon_social || '',
                    cliente?.nombre_comercial || '',
                    cliente?.nit || ''
                ].map(value => String(value).toLowerCase());
                return values.some(value => value.includes(normalizedQuery));
            })
            .map(cliente => ({
                label: cliente.razon_social || cliente.nombre_comercial || cliente.nit || 'Cliente sin nombre',
                secondary: [cliente.nombre_comercial, cliente.nit].filter(Boolean).join(' | ')
            }));

        const unique = [];
        const seen = new Set();
        sugerencias.forEach(item => {
            const key = String(item.label || '').trim().toLowerCase();
            if (!key || seen.has(key)) return;
            seen.add(key);
            unique.push(item);
        });

        if (!unique.length) {
            container.innerHTML = `<div class="cargue-atenciones-suggestion-empty">No se encontraron empresas para "${escapeHtml(text)}".</div>`;
            container.style.display = 'block';
            return;
        }

        container.innerHTML = unique.slice(0, 12).map(item => `
            <button
                type="button"
                class="cargue-atenciones-suggestion-item"
                data-empresa="${encodeURIComponent(item.label || '')}">
                <strong>${escapeHtml(item.label)}</strong>
                ${item.secondary ? `<span>${escapeHtml(item.secondary)}</span>` : ''}
            </button>
        `).join('');
        container.style.display = 'block';
    } catch (error) {
        console.error('Error buscando empresas para prefacturas:', error);
        ocultarSugerenciasEmpresasPrefacturas();
    }
}

function limpiarFiltrosPrefacturas() {
    ['consultaPrefEmpresa','consultaPrefFormaPago','consultaPrefEstado','consultaPrefPeriodo',
     'consultaPrefFechaDesde','consultaPrefFechaHasta'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    ocultarSugerenciasEmpresasPrefacturas();
    const t = document.getElementById('consultaPrefTable');
    if (t) t.style.display = 'none';
    const r = document.getElementById('consultaPrefResultado');
    if (r) r.textContent = '';
}

async function consultarPrefacturas() {
    const resultado = document.getElementById('consultaPrefResultado');
    const tabla     = document.getElementById('consultaPrefTable');
    const tbody     = document.getElementById('consultaPrefBody');
    if (resultado) resultado.textContent = 'Consultando…';
    if (tabla)     tabla.style.display   = 'none';

    const params = new URLSearchParams();
    const empresa = (document.getElementById('consultaPrefEmpresa')?.value || '').trim();
    const forma   = document.getElementById('consultaPrefFormaPago')?.value || '';
    const estado  = document.getElementById('consultaPrefEstado')?.value || '';
    const fd      = document.getElementById('consultaPrefFechaDesde')?.value || '';
    const fh      = document.getElementById('consultaPrefFechaHasta')?.value || '';
    if (empresa) params.set('empresa', empresa);
    if (forma)   params.set('forma_pago', forma);
    if (estado)  params.set('estado', estado);
    if (fd)      params.set('fecha_desde', fd);
    if (fh)      params.set('fecha_hasta', fh);

    try {
        const res  = await fetch('/api/comercial/prefacturas?' + params, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { if (resultado) resultado.textContent = data.error || 'Error consultando.'; return; }

        const prefs = data.prefacturas || [];
        if (resultado) resultado.textContent = `${prefs.length} prefactura(s) encontrada(s).`;
        if (!prefs.length) return;

        tbody.innerHTML = '';
        prefs.forEach(p => {
            const esManual = String(p.origen || '').toUpperCase() === 'MANUAL_ANTICIPO';
            const estadoBadge = p.estado === 'CERRADA'
                ? '<span style="color:#27ae60;font-weight:bold;">CERRADA</span>'
                : '<span style="color:#e67e22;font-weight:bold;">BORRADOR</span>';
            const periodo = `${p.fecha_desde || ''} al ${p.fecha_hasta || ''}`;
            const esBorrador = p.estado === 'BORRADOR';
            const numeroPrefactura = construirNumeroPrefactura(p);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(p.nombre_empresa)}${esManual ? `<div style="color:#2563eb;font-size:0.82rem;">${escapeHtml(numeroPrefactura)}</div>` : ''}</td>
                <td style="font-size:0.85em;">${periodo}</td>
                <td>${escapeHtml(p.forma_pago)}</td>
                <td style="text-align:center;">${p.cant_pacientes}</td>
                <td style="text-align:right;">$${_fmtMoney(p.valor_total)}</td>
                <td style="text-align:center;">${estadoBadge}${p.bloqueada_por_pago ? '<div style="color:#b45309;font-size:0.82rem;">Bloqueada por anticipo</div>' : ''}</td>
                <td>${escapeHtml(esManual ? numeroPrefactura : (p.nro_factura || ''))}</td>
                <td style="text-align:right;">${p.valor_factura != null ? '$' + _fmtMoney(p.valor_factura) : ''}</td>
                <td style="text-align:right;">$${_fmtMoney(p.total_pagado)}</td>
                <td style="text-align:right;">$${_fmtMoney(p.saldo_pendiente)}</td>
                <td style="white-space:nowrap;">
                    <button class="action-btn action-btn-edit"
                        title="Ver detalle, factura y pagos"
                        onclick="abrirDetallePrefactura(${p.id})">Ver / Pagar</button>
                    ${esBorrador ? `
                    <button class="action-btn action-btn-edit"
                        title="Editar observaciones"
                        style="background:#6c757d;"
                        onclick="editarObservacionesPrefactura(${p.id})">Editar</button>
                    <button class="action-btn action-btn-edit"
                        title="Regenerar Excel de esta empresa"
                        style="background:#17a2b8;"
                        onclick="regenerarPrefacturaEmpresa(${JSON.stringify(p.nombre_empresa)}, ${JSON.stringify(p.fecha_desde)}, ${JSON.stringify(p.fecha_hasta)})">Regenerar</button>
                    <button class="action-btn action-btn-delete"
                        title="Eliminar prefactura (solo admin)"
                        onclick="eliminarPrefactura(${p.id})">Eliminar</button>
                    ` : ''}
                </td>`;
            tbody.appendChild(tr);
        });
        tabla.style.display = '';
    } catch (err) {
        console.error('consultarPrefacturas error', err);
        if (resultado) resultado.textContent = 'Error de conexión.';
    }
}

// ===========================================================================
// PREFACTURAS — DETALLE / CERRAR / REABRIR
// ===========================================================================

function construirNumeroPrefactura(prefactura) {
    const id = Number(prefactura?.id || 0);
    if (!id) return '';
    const esManual = String(prefactura?.origen || '').toUpperCase() === 'MANUAL_ANTICIPO';
    const prefijo = esManual ? 'PREF-ANT' : 'PREF';
    return `${prefijo}-${String(id).padStart(6, '0')}`;
}

function obtenerPagosActivosPrefactura(prefactura) {
    return (Array.isArray(prefactura?.pagos) ? prefactura.pagos : [])
        .filter(pg => String(pg?.estado || '').toUpperCase() !== 'ANULADO')
        .sort((a, b) => String(a?.fecha_pago || '').localeCompare(String(b?.fecha_pago || '')));
}

function renderCabeceraPrefacturaManual(prefactura) {
    const pagoReferencia = obtenerPagosActivosPrefactura(prefactura)[0] || null;
    const comprobanteNode = document.getElementById('prefDetalleAnticipoComprobante');
    const empresaInput = document.getElementById('prefDetalleAnticipoEmpresa');
    const numeroInput = document.getElementById('prefDetalleAnticipoNumero');
    const valorInput = document.getElementById('prefDetalleAnticipoValorCancelado');
    const fechaPagoInput = document.getElementById('prefDetalleAnticipoFechaPago');
    const formaPagoInput = document.getElementById('prefDetalleAnticipoFormaPago');

    if (empresaInput) empresaInput.value = prefactura?.nombre_empresa || '';
    if (numeroInput) numeroInput.value = construirNumeroPrefactura(prefactura);
    if (valorInput) valorInput.value = formatCurrency(prefactura?.total_pagado || 0);
    if (fechaPagoInput) fechaPagoInput.value = pagoReferencia?.fecha_pago || '';
    if (formaPagoInput) {
        const medio = pagoReferencia?.medio_pago || '';
        const canal = pagoReferencia?.canal_transferencia ? ` / ${pagoReferencia.canal_transferencia}` : '';
        formaPagoInput.value = `${medio}${canal}`;
    }
    if (comprobanteNode) {
        comprobanteNode.innerHTML = pagoReferencia?.comprobante_url
            ? `<a href="${pagoReferencia.comprobante_url}" target="_blank" rel="noopener">Descargar comprobante</a>`
            : 'Sin comprobante adjunto.';
    }
}

function obtenerFechaBasePrefacturaManualEditor() {
    return document.getElementById('prefacturaDetalleFechaProgramada')?.value || getTodayIsoDate();
}

function setPrefDetalleManualMsg(message = '', isError = false) {
    const node = document.getElementById('prefDetalleManualMsg');
    if (!node) return;
    node.textContent = message;
    node.style.color = isError ? '#c0392b' : '#555';
}

function limpiarEditorDetallePrefacturaManual() {
    ['prefManualPacienteDocumento', 'prefManualPacienteNombre', 'prefManualItemValor'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = '';
    });
    const fechaInput = document.getElementById('prefManualFechaProgramada');
    if (fechaInput) fechaInput.value = obtenerFechaBasePrefacturaManualEditor();
    const itemSelect = document.getElementById('prefManualItemSelect');
    if (itemSelect) itemSelect.value = '';
    window.prefacturaManualState.detalleEditId = null;
    const saveBtn = document.getElementById('prefManualGuardarBtn');
    const cancelBtn = document.getElementById('prefManualCancelarBtn');
    if (saveBtn) saveBtn.textContent = 'Agregar detalle';
    if (cancelBtn) cancelBtn.style.display = 'none';
    setPrefDetalleManualMsg('');
}

function poblarSelectDetallePrefacturaManual(items = []) {
    const select = document.getElementById('prefManualItemSelect');
    if (!select) return;
    const options = ['<option value="">Seleccione...</option>'].concat(
        (Array.isArray(items) ? items : []).map(item => `
            <option value="${Number(item.id)}">${escapeHtml(`${item.nombre || 'Item'}${item.tipo_item ? ` · ${item.tipo_item}` : ''}`)}</option>
        `)
    );
    select.innerHTML = options.join('');
}

async function cargarConvenioPrefacturaManual(clienteId, fechaProgramada, forceReload = false) {
    if (!clienteId || !fechaProgramada) {
        window.prefacturaManualState.convenioItems = [];
        window.prefacturaManualState.convenioLoadedKey = '';
        poblarSelectDetallePrefacturaManual([]);
        return [];
    }
    const cacheKey = `${clienteId}|${fechaProgramada}`;
    if (!forceReload && cacheKey === window.prefacturaManualState.convenioLoadedKey) {
        return window.prefacturaManualState.convenioItems || [];
    }
    const params = new URLSearchParams({ fecha_atencion: fechaProgramada });
    const response = await fetch(`/api/comercial/clientes/${clienteId}/convenio-items?${params.toString()}`, {
        credentials: 'include'
    });
    const data = await response.json().catch(() => ([]));
    if (!response.ok) {
        throw new Error(data.error || 'No se pudieron cargar los items del convenio para esta prefactura.');
    }
    window.prefacturaManualState.convenioItems = Array.isArray(data) ? data : [];
    window.prefacturaManualState.convenioLoadedKey = cacheKey;
    poblarSelectDetallePrefacturaManual(window.prefacturaManualState.convenioItems);
    return window.prefacturaManualState.convenioItems;
}

function actualizarValorItemPrefacturaManual() {
    const select = document.getElementById('prefManualItemSelect');
    const valorInput = document.getElementById('prefManualItemValor');
    if (!select || !valorInput) return;
    const item = (window.prefacturaManualState.convenioItems || []).find(entry => Number(entry.id) === Number(select.value));
    valorInput.value = item ? Number(item.valor_unitario || 0) : '';
}

function renderPrefacturaManualDetalles(prefactura) {
    const section = document.getElementById('prefDetalleManualSection');
    const tbody = document.getElementById('prefDetalleManualBody');
    const resumen = document.getElementById('prefDetalleManualResumen');
    const hint = document.getElementById('prefDetalleManualHint');
    const editor = document.getElementById('prefDetalleManualEditor');
    if (!section || !tbody || !resumen || !hint || !editor) return;

    const esManual = String(prefactura?.origen || '').toUpperCase() === 'MANUAL_ANTICIPO';
    if (!esManual) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';
    const detalles = Array.isArray(prefactura?.detalles) ? prefactura.detalles : [];
    const bloqueada = prefactura?.bloqueada_por_pago === true;
    hint.textContent = bloqueada
        ? 'Esta prefactura ya quedo bloqueada porque el anticipo cubrio el total programado.'
        : 'Solo se pueden usar items vigentes del convenio del cliente y modificar mientras no este bloqueada.';
    editor.style.display = bloqueada ? 'none' : '';

    if (!detalles.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;">No hay detalles programados.</td></tr>';
    } else {
        tbody.innerHTML = detalles.map(detalle => `
            <tr>
                <td>${escapeHtml(detalle.fecha_programada || 'N/A')}</td>
                <td>${escapeHtml(detalle.paciente_documento || 'N/A')}</td>
                <td>${escapeHtml(detalle.paciente_nombre || 'N/A')}</td>
                <td>${escapeHtml(detalle.nombre_item || 'N/A')}</td>
                <td style="text-align:right;">${formatCurrency(detalle.valor_item || 0)}</td>
                <td>${detalle.atencion_dia_id ? '<span style="color:#27ae60;font-weight:600;">Cruzado</span>' : '<span style="color:#e67e22;">Pendiente</span>'}</td>
                <td style="white-space:nowrap;">
                    ${bloqueada ? '' : `
                        <button class="action-btn action-btn-edit" type="button" onclick="editarDetallePrefacturaManual(${detalle.id})">Editar</button>
                        <button class="action-btn action-btn-delete" type="button" onclick="eliminarDetallePrefacturaManual(${detalle.id})">Eliminar</button>
                    `}
                </td>
            </tr>
        `).join('');
    }

    resumen.textContent = `Total programado: ${formatCurrency(prefactura?.valor_total || 0)} | Total cancelado: ${formatCurrency(prefactura?.total_pagado || 0)} | Cruzados: ${Number(prefactura?.detalles_cruzados || 0)} / ${Number(prefactura?.detalles_count || 0)}`;
}

function editarDetallePrefacturaManual(detalleId) {
    const prefactura = window.prefacturaManualState.currentPrefactura || {};
    const detalles = Array.isArray(prefactura.detalles) ? prefactura.detalles : [];
    const detalle = detalles.find(item => Number(item.id) === Number(detalleId));
    if (!detalle) return;

    document.getElementById('prefManualFechaProgramada').value = detalle.fecha_programada || obtenerFechaBasePrefacturaManualEditor();
    document.getElementById('prefManualPacienteDocumento').value = detalle.paciente_documento || '';
    document.getElementById('prefManualPacienteNombre').value = detalle.paciente_nombre || '';
    document.getElementById('prefManualItemSelect').value = String(detalle.catalogo_item_id || '');
    actualizarValorItemPrefacturaManual();
    window.prefacturaManualState.detalleEditId = Number(detalle.id);
    const saveBtn = document.getElementById('prefManualGuardarBtn');
    const cancelBtn = document.getElementById('prefManualCancelarBtn');
    if (saveBtn) saveBtn.textContent = 'Guardar cambio';
    if (cancelBtn) cancelBtn.style.display = '';
    setPrefDetalleManualMsg('Editando detalle seleccionado.');
}

function cancelarEdicionDetallePrefacturaManual() {
    limpiarEditorDetallePrefacturaManual();
}

async function guardarDetallePrefacturaManual() {
    const prefId = document.getElementById('prefacturaDetalleId')?.value;
    const clienteId = document.getElementById('prefacturaDetalleClienteId')?.value;
    const fechaProgramada = document.getElementById('prefManualFechaProgramada')?.value || document.getElementById('prefacturaDetalleFechaProgramada')?.value;
    const pacienteDocumento = document.getElementById('prefManualPacienteDocumento')?.value?.trim() || '';
    const pacienteNombre = document.getElementById('prefManualPacienteNombre')?.value?.trim() || '';
    const itemId = document.getElementById('prefManualItemSelect')?.value || '';
    const editingId = window.prefacturaManualState.detalleEditId;

    if (!prefId || !clienteId || !fechaProgramada) {
        setPrefDetalleManualMsg('No hay una prefactura manual lista para editar.', true);
        return;
    }
    if (!pacienteDocumento || !pacienteNombre || !itemId) {
        setPrefDetalleManualMsg('Debes completar paciente e item del convenio.', true);
        return;
    }

    setPrefDetalleManualMsg(editingId ? 'Guardando cambio...' : 'Agregando detalle...');
    try {
        const response = await fetch(
            editingId ? `/api/comercial/prefacturas/detalles/${editingId}` : `/api/comercial/prefacturas/${prefId}/detalles`,
            {
                method: editingId ? 'PUT' : 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fecha_programada: fechaProgramada,
                    paciente_documento: pacienteDocumento,
                    paciente_nombre: pacienteNombre,
                    catalogo_item_id: Number(itemId)
                })
            }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            setPrefDetalleManualMsg(data.error || 'No se pudo guardar el detalle.', true);
            return;
        }
        limpiarEditorDetallePrefacturaManual();
        await abrirDetallePrefactura(prefId);
    } catch (error) {
        console.error('Error guardando detalle manual de prefactura:', error);
        setPrefDetalleManualMsg(error.message || 'Error de conexion al guardar el detalle.', true);
    }
}

async function eliminarDetallePrefacturaManual(detalleId) {
    const prefId = document.getElementById('prefacturaDetalleId')?.value;
    if (!detalleId || !prefId) return;
    if (!confirm('¿Eliminar este detalle de la prefactura manual?')) return;
    try {
        const response = await fetch(`/api/comercial/prefacturas/detalles/${detalleId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            setPrefDetalleManualMsg(data.error || 'No se pudo eliminar el detalle.', true);
            return;
        }
        limpiarEditorDetallePrefacturaManual();
        await abrirDetallePrefactura(prefId);
    } catch (error) {
        console.error('Error eliminando detalle manual de prefactura:', error);
        setPrefDetalleManualMsg(error.message || 'Error de conexion al eliminar el detalle.', true);
    }
}

async function abrirDetallePrefactura(prefId) {
    document.getElementById('prefacturaDetalleId').value = prefId;
    document.getElementById('prefacturaDetalleClienteId').value = '';
    document.getElementById('prefacturaDetalleOrigen').value = '';
    document.getElementById('prefacturaDetalleFechaProgramada').value = '';
    document.getElementById('prefDetalleMsg').textContent = '';
    document.getElementById('nuevoPagoMsg').textContent   = '';
    limpiarEditorDetallePrefacturaManual();

    try {
        const res  = await fetch(`/api/comercial/prefacturas/${prefId}`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Error cargando prefactura', 'error'); return; }

        const p = data.prefactura;
        window.prefacturaManualState.currentPrefactura = p;
        const esManual = String(p.origen || '').toUpperCase() === 'MANUAL_ANTICIPO';
        const rangoPrefactura = `${p.fecha_desde || ''}${p.fecha_hasta && p.fecha_hasta !== p.fecha_desde ? ` al ${p.fecha_hasta}` : ''}`;
        document.getElementById('prefacturaDetalleTitulo').textContent =
            `${p.nombre_empresa} · ${p.forma_pago} · ${p.fecha_desde} al ${p.fecha_hasta}`;
        document.getElementById('prefacturaDetalleClienteId').value = p.cliente_id || '';
        document.getElementById('prefacturaDetalleOrigen').value = p.origen || '';
        document.getElementById('prefacturaDetalleFechaProgramada').value = p.fecha_programada || '';
        document.getElementById('prefDetalleFechaFactura').value  = p.fecha_factura  || '';
        document.getElementById('prefDetalleNroFactura').value    = p.nro_factura    || '';
        document.getElementById('prefDetalleValorFactura').value  = p.valor_factura  != null ? p.valor_factura : p.valor_total;
        document.getElementById('prefDetalleObservaciones').value = p.observaciones  || '';
        document.getElementById('prefacturaDetalleTitulo').textContent = esManual
            ? `${construirNumeroPrefactura(p)} | ${p.nombre_empresa}`
            : `${p.nombre_empresa} | ${p.forma_pago} | ${rangoPrefactura}`;
        document.getElementById('prefacturaDetalleFechaProgramada').value = p.fecha_programada || p.fecha_desde || '';
        const fechaManualInput = document.getElementById('prefManualFechaProgramada');
        if (fechaManualInput) fechaManualInput.value = p.fecha_programada || p.fecha_desde || getTodayIsoDate();

        const cerrado = p.estado === 'CERRADA';
        const bloqueada = p.bloqueada_por_pago === true;
        const facturaSection = document.getElementById('prefDetalleFacturaSection');
        const anticipoSection = document.getElementById('prefDetalleAnticipoSection');
        const pagoTitulo = document.getElementById('prefDetalleNuevoPagoTitulo');
        document.getElementById('btnCerrarPrefactura').style.display  = (cerrado || esManual) ? 'none' : '';
        document.getElementById('btnReabrirPrefactura').style.display = (!esManual && cerrado) ? '' : 'none';
        document.getElementById('prefDetalleNuevoPagoSection').style.display = bloqueada ? 'none' : '';
        if (facturaSection) facturaSection.style.display = esManual ? 'none' : '';
        if (anticipoSection) anticipoSection.style.display = esManual ? '' : 'none';
        if (pagoTitulo) pagoTitulo.textContent = esManual ? 'Registrar pago adicional' : 'Registrar Pago / Anticipo';

        // Campos de factura: readonly si cerrada
        ['prefDetalleFechaFactura','prefDetalleNroFactura','prefDetalleValorFactura','prefDetalleObservaciones']
            .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = cerrado || bloqueada; });

        if (esManual) {
            renderCabeceraPrefacturaManual(p);
        }
        _renderCarteraBody(p.pagos || [], p.total_pagado, p.saldo_pendiente);
        renderPrefacturaManualDetalles(p);
        if (esManual && p.cliente_id && (p.fecha_programada || p.fecha_desde)) {
            try {
                await cargarConvenioPrefacturaManual(p.cliente_id, p.fecha_programada || p.fecha_desde, true);
            } catch (error) {
                console.error('Error cargando convenio para prefactura manual:', error);
                setPrefDetalleManualMsg(error.message || 'No se pudo cargar el convenio del cliente.', true);
            }
        } else {
            poblarSelectDetallePrefacturaManual([]);
        }

        document.getElementById('prefacturaDetalleModal').classList.add('active');
    } catch (err) {
        console.error('abrirDetallePrefactura error', err);
        showToast('Error de conexión', 'error');
    }
}

function _renderCarteraBody(pagos, totalPagado, saldo) {
    const tbody = document.getElementById('prefDetalleCarteraBody');
    tbody.innerHTML = '';
    if (!pagos.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;">Sin pagos registrados.</td></tr>';
    } else {
        pagos.forEach(pg => {
            const anulado = pg.estado === 'ANULADO';
            const tr = document.createElement('tr');
            tr.style.opacity = anulado ? '0.5' : '1';
            tr.innerHTML = `
                <td>${pg.fecha_pago || ''}</td>
                <td>${escapeHtml(pg.tipo_movimiento)}</td>
                <td>${escapeHtml(`${pg.medio_pago || ''}${pg.canal_transferencia ? ` / ${pg.canal_transferencia}` : ''}`)}</td>
                <td>
                    ${escapeHtml(pg.nro_comprobante || '')}
                    ${pg.comprobante_url ? `<div><a href="${pg.comprobante_url}" target="_blank" rel="noopener">Descargar soporte</a></div>` : ''}
                </td>
                <td style="text-align:right;">$${_fmtMoney(pg.valor_pago)}</td>
                <td>${escapeHtml(pg.estado)}</td>
                <td>${anulado ? '' : `<button class="action-btn action-btn-delete" onclick="anularPagoCartera(${pg.id})">Anular</button>`}</td>`;
            tbody.appendChild(tr);
        });
    }
    document.getElementById('prefDetalleTotalPagado').textContent = '$' + _fmtMoney(totalPagado);
    document.getElementById('prefDetalleSaldo').textContent       = '$' + _fmtMoney(saldo);
}

function cerrarPrefacturaDetalle() {
    document.getElementById('prefacturaDetalleModal').classList.remove('active');
    window.prefacturaManualState.currentPrefactura = null;
    limpiarEditorDetallePrefacturaManual();
}

async function cerrarPrefacturaGuardar() {
    const prefId = document.getElementById('prefacturaDetalleId').value;
    const msg    = document.getElementById('prefDetalleMsg');
    const payload = {
        fecha_factura:  document.getElementById('prefDetalleFechaFactura').value  || null,
        nro_factura:    document.getElementById('prefDetalleNroFactura').value     || null,
        valor_factura:  document.getElementById('prefDetalleValorFactura').value   || null,
        observaciones:  document.getElementById('prefDetalleObservaciones').value  || null,
    };
    try {
        const res  = await fetch(`/api/comercial/prefacturas/${prefId}/cerrar`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { if (msg) msg.textContent = data.error || 'Error cerrando.'; return; }
        showToast('Prefactura cerrada correctamente');
        cerrarPrefacturaDetalle();
        consultarPrefacturas();
    } catch (err) {
        if (msg) msg.textContent = 'Error de conexión.';
    }
}

async function reabrirPrefactura() {
    const prefId = document.getElementById('prefacturaDetalleId').value;
    const msg    = document.getElementById('prefDetalleMsg');
    if (!confirm('¿Reabrir esta prefactura a estado Borrador?')) return;
    try {
        const res  = await fetch(`/api/comercial/prefacturas/${prefId}/reabrir`, {
            method: 'POST', credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { if (msg) msg.textContent = data.error || 'Error reabriendo.'; return; }
        showToast('Prefactura reabierta');
        cerrarPrefacturaDetalle();
        consultarPrefacturas();
    } catch (err) {
        if (msg) msg.textContent = 'Error de conexión.';
    }
}

// ===========================================================================
// CARTERA — REGISTRAR Y ANULAR PAGOS
// ===========================================================================

async function registrarPagoCartera() {
    const prefId = document.getElementById('prefacturaDetalleId').value;
    const msg    = document.getElementById('nuevoPagoMsg');
    const payload = {
        tipo_movimiento: document.getElementById('nuevoPagoTipo').value,
        fecha_pago: document.getElementById('nuevoPagoFecha').value,
        valor_pago: document.getElementById('nuevoPagoValor').value,
        medio_pago: document.getElementById('nuevoPagoMedio').value,
        nro_comprobante: document.getElementById('nuevoPagoComprobante').value || null,
        canal_transferencia: document.getElementById('nuevoPagoCanal')?.value || '',
        observaciones: document.getElementById('nuevoPagoObs').value || null,
    };
    const comprobanteArchivo = document.getElementById('nuevoPagoComprobanteArchivo')?.files?.[0];
    if (!payload.fecha_pago || !payload.valor_pago) {
        if (msg) msg.textContent = 'Fecha y valor son obligatorios.'; return;
    }
    if (payload.medio_pago === 'TRANSFERENCIA' && !comprobanteArchivo) {
        if (msg) msg.textContent = 'Adjunta el soporte cuando el pago se registra por transferencia.'; return;
    }
    try {
        const formData = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
            if (value !== null && value !== '') formData.append(key, value);
        });
        if (comprobanteArchivo) formData.append('comprobante_pago', comprobanteArchivo);
        const res  = await fetch(`/api/comercial/prefacturas/${prefId}/cartera`, {
            method: 'POST', credentials: 'include',
            body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { if (msg) msg.textContent = data.error || 'Error registrando pago.'; return; }
        showToast('Pago registrado');
        if (msg) msg.textContent = '';
        // Limpiar campos de pago
        ['nuevoPagoFecha','nuevoPagoValor','nuevoPagoComprobante','nuevoPagoObs']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const canal = document.getElementById('nuevoPagoCanal');
        if (canal) canal.value = '';
        const archivo = document.getElementById('nuevoPagoComprobanteArchivo');
        if (archivo) archivo.value = '';
        // Recargar detalle
        abrirDetallePrefactura(prefId);
    } catch (err) {
        if (msg) msg.textContent = 'Error de conexión.';
    }
}

async function anularPagoCartera(pagoId) {
    if (!confirm('¿Anular este pago?')) return;
    try {
        const res  = await fetch(`/api/comercial/cartera/${pagoId}`, {
            method: 'DELETE', credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Error anulando pago', 'error'); return; }
        showToast('Pago anulado');
        const prefId = document.getElementById('prefacturaDetalleId').value;
        abrirDetallePrefactura(prefId);
    } catch (err) {
        showToast('Error de conexión', 'error');
    }
}

// ===========================================================================
// CARTERA — CARGA MASIVA DESDE resumen_periodo.xlsx
// ===========================================================================

async function cargarResumenPrefacturas() {
    const input     = document.getElementById('carteraResumenArchivo');
    const resultado = document.getElementById('carteraResumenResultado');
    const archivo   = input?.files?.[0];
    if (!archivo) { if (resultado) resultado.textContent = 'Selecciona un archivo primero.'; return; }

    if (resultado) resultado.textContent = 'Procesando…';
    const formData = new FormData();
    formData.append('archivo', archivo);

    try {
        const res  = await fetch('/api/comercial/prefacturas/cargar-resumen', {
            method: 'POST', credentials: 'include', body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { if (resultado) resultado.textContent = data.error || 'Error procesando.'; return; }

        let msg = `✔ ${data.actualizadas} prefactura(s) actualizadas.`;
        if (data.no_encontradas?.length) {
            msg += `<br><small style="color:#e67e22;">No encontradas: ${data.no_encontradas.join(', ')}</small>`;
        }
        if (resultado) resultado.innerHTML = msg;
        if (input) input.value = '';
        showToast('Resumen cargado correctamente');
    } catch (err) {
        if (resultado) resultado.textContent = 'Error de conexión.';
    }
}

// ===========================================================================
// PREFACTURAS — EDITAR OBSERVACIONES Y ELIMINAR
// ===========================================================================

async function editarObservacionesPrefactura(prefId) {
    // Obtener observaciones actuales desde el backend
    let obsActual = '';
    try {
        const res = await fetch(`/api/comercial/prefacturas/${prefId}`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (res.ok) obsActual = data.prefactura?.observaciones || '';
    } catch (_) {}

    const nueva = prompt('Observaciones:', obsActual);
    if (nueva === null) return; // canceló
    try {
        const res  = await fetch(`/api/comercial/prefacturas/${prefId}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ observaciones: nueva }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Error actualizando', 'error'); return; }
        showToast('Observaciones actualizadas');
        consultarPrefacturas();
    } catch (err) {
        showToast('Error de conexión', 'error');
    }
}

async function eliminarPrefactura(prefId) {
    if (!confirm('¿Eliminar esta prefactura? Solo es posible si está en estado Borrador y requiere permisos de administrador.')) return;
    try {
        const res  = await fetch(`/api/comercial/prefacturas/${prefId}`, {
            method: 'DELETE', credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Error eliminando', 'error'); return; }
        showToast('Prefactura eliminada');
        consultarPrefacturas();
    } catch (err) {
        showToast('Error de conexión', 'error');
    }
}

// ===========================================================================
// PREFACTURAS — REGENERAR EMPRESA
// ===========================================================================

async function regenerarPrefacturaEmpresa(nombreEmpresa, fechaDesde, fechaHasta) {
    if (!nombreEmpresa || !fechaDesde || !fechaHasta) {
        showToast('Faltan datos para regenerar la prefactura', 'error');
        return;
    }
    if (!confirm(`¿Regenerar la prefactura de "${nombreEmpresa}" para el periodo ${fechaDesde} al ${fechaHasta}?\nEsto actualizará el registro en BD con los datos actuales de atenciones.`)) return;

    const resultado = document.getElementById('consultaPrefResultado');
    if (resultado) resultado.textContent = `Regenerando prefactura de ${nombreEmpresa}…`;

    try {
        const params = new URLSearchParams({
            empresa:      nombreEmpresa,
            fecha_desde:  fechaDesde,
            fecha_hasta:  fechaHasta,
        });
        const response = await fetch(`/api/comercial/prefacturas/regenerar-empresa?${params}`, {
            method: 'GET',
            credentials: 'same-origin',
        });

        if (!response.ok) {
            let msg = 'Error regenerando prefactura.';
            try { const data = await response.json(); msg = data.error || msg; } catch (_) {}
            if (resultado) resultado.textContent = msg;
            showToast(msg, 'error');
            return;
        }

        const disposition = response.headers.get('Content-Disposition') || '';
        let filename = 'Prefactura.zip';
        const match = disposition.match(/filename[^;=\n]*=(?:(['"])([^'"]*)\1|([^;\n]*))/i);
        if (match) filename = (match[2] || match[3] || filename).trim();

        const blob = await response.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);

        if (resultado) resultado.innerHTML = `<span style="color:#27ae60;">✔ Prefactura regenerada y descargada: <strong>${filename}</strong></span>`;
        showToast('Prefactura regenerada correctamente');
        // Refrescar la tabla de prefacturas
        consultarPrefacturas();
    } catch (err) {
        console.error('regenerarPrefacturaEmpresa error:', err);
        if (resultado) resultado.textContent = 'Error de conexión al regenerar.';
        showToast('Error de conexión', 'error');
    }
}

// ===========================================================================
// REGISTRO DIARIO DE CAJA — ÓRDENES DE SERVICIO
// ===========================================================================

window._cajaState = { page: 1, pages: 0, total: 0, opciones: null };

async function cargarOpcionesCaja() {
    if (window._cajaState.opciones) return;
    try {
        const res  = await fetch('/api/comercial/caja/opciones', { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            window._cajaState.opciones = data;
            _renderCheckboxGroup('cajaTipoExamenOpciones', data.tipo_examen || [], 'radio', 'cajaTipoExamen');
            _renderCheckboxGroup('cajaEnfasisOpciones',    data.enfasis || [],     'checkbox', 'cajaEnfasis');
            _renderCheckboxGroup('cajaParaclinicosOpciones', data.paraclinicos || [], 'checkbox', 'cajaParaclinicos');
            _renderCheckboxGroup('cajaLaboratorioOpciones',  data.laboratorio || [],  'checkbox', 'cajaLaboratorio');
            _renderCheckboxGroup('cajaOtrosServiciosOpciones', data.otros_servicios || [], 'checkbox', 'cajaOtrosServicios');
            _renderCheckboxGroup('cajaAutorizacionOpciones', data.formas_autorizacion || [], 'checkbox', 'cajaFormasAutorizacion');
        }
    } catch (err) {
        console.error('cargarOpcionesCaja error', err);
    }
}

function _renderCheckboxGroup(containerId, opciones, tipo, name) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = opciones.map(op => `
        <label class="caja-choice-card">
            <input type="${tipo}" name="${name}" value="${escapeHtml(op)}"
                style="width:16px; height:16px; cursor:pointer;">
            <span>${escapeHtml(_humanizeCajaOption(op))}</span>
        </label>
    `).join('');
}

function _humanizeCajaOption(value) {
    return String(value || '')
        .replaceAll('_', ' ')
        .toLowerCase()
        .replace(/\b\w/g, char => char.toUpperCase());
}

function _getCheckedValues(name) {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`))
        .map(el => el.value);
}

function _setCheckedValues(name, values, tipo) {
    const arr = Array.isArray(values) ? values : (values ? [values] : []);
    document.querySelectorAll(`input[name="${name}"]`).forEach(el => {
        el.checked = arr.includes(el.value);
    });
}

function _renderCajaAdjuntos(adjuntos = []) {
    const container = document.getElementById('cajaTransferenciaAdjuntosExistentes');
    if (!container) return;
    container.dataset.count = Array.isArray(adjuntos) ? String(adjuntos.length) : '0';
    if (!Array.isArray(adjuntos) || !adjuntos.length) {
        container.textContent = 'Sin adjuntos cargados.';
        return;
    }
    container.innerHTML = adjuntos.map(adjunto => `
        <div style="display:flex; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid rgba(148, 163, 184, 0.2);">
            <span>${escapeHtml(adjunto.nombre_original || 'Adjunto')}</span>
            <a href="${adjunto.download_url}" target="_blank" rel="noopener noreferrer">Descargar</a>
        </div>
    `).join('');
}

function _actualizarResumenAdjuntosCaja() {
    const input = document.getElementById('cajaTransferenciaAdjuntos');
    const resumen = document.getElementById('cajaTransferenciaAdjuntosResumen');
    if (!resumen) return;
    const archivos = Array.from(input?.files || []);
    resumen.textContent = archivos.length
        ? `${archivos.length} archivo(s) seleccionado(s): ${archivos.map(a => a.name).join(', ')}`
        : 'No hay archivos seleccionados.';
}

function _buildCajaRequerimientos() {
    return [
        {
            clave: 'GERENCIA_C',
            nombre: 'Gerencia C',
            seleccionado: !!document.getElementById('cajaReqGerenciaCheck')?.checked,
            responsable: document.getElementById('cajaReqGerenciaResp')?.value.trim() || '',
            celular: document.getElementById('cajaReqGerenciaCel')?.value.trim() || '',
        },
        {
            clave: 'ASESORA_Y',
            nombre: 'Asesora Y',
            seleccionado: !!document.getElementById('cajaReqAsesoraCheck')?.checked,
            responsable: document.getElementById('cajaReqAsesoraResp')?.value.trim() || '',
            celular: document.getElementById('cajaReqAsesoraCel')?.value.trim() || '',
        },
        {
            clave: 'OTRO',
            nombre: document.getElementById('cajaReqOtroNombre')?.value.trim() || 'Otro',
            seleccionado: !!document.getElementById('cajaReqOtroCheck')?.checked,
            responsable: document.getElementById('cajaReqOtroResp')?.value.trim() || '',
            celular: document.getElementById('cajaReqOtroCel')?.value.trim() || '',
        },
    ];
}

function _applyCajaRequerimientos(items = []) {
    const byKey = new Map((Array.isArray(items) ? items : []).map(item => [String(item.clave || '').toUpperCase(), item]));
    const gerencia = byKey.get('GERENCIA_C') || {};
    const asesora = byKey.get('ASESORA_Y') || {};
    const otro = byKey.get('OTRO') || {};

    document.getElementById('cajaReqGerenciaCheck').checked = !!gerencia.seleccionado;
    document.getElementById('cajaReqGerenciaResp').value = gerencia.responsable || '';
    document.getElementById('cajaReqGerenciaCel').value = gerencia.celular || '';

    document.getElementById('cajaReqAsesoraCheck').checked = !!asesora.seleccionado;
    document.getElementById('cajaReqAsesoraResp').value = asesora.responsable || '';
    document.getElementById('cajaReqAsesoraCel').value = asesora.celular || '';

    document.getElementById('cajaReqOtroNombre').value = otro.nombre && otro.nombre !== 'Otro' ? otro.nombre : '';
    document.getElementById('cajaReqOtroCheck').checked = !!otro.seleccionado;
    document.getElementById('cajaReqOtroResp').value = otro.responsable || '';
    document.getElementById('cajaReqOtroCel').value = otro.celular || '';
}

function toggleMixtoCaja() {
    const forma = document.getElementById('cajaFormaPago')?.value;
    const panel = document.getElementById('cajaMixtoPanel');
    if (panel) panel.style.display = forma === 'MIXTO' ? '' : 'none';
    const transferenciaPanel = document.getElementById('cajaTransferenciaPanel');
    const valorTransferencia = Number(document.getElementById('cajaMixtoTransferencia')?.value || 0);
    const requiereSoporte = forma === 'TRANSFERENCIA' || (forma === 'MIXTO' && valorTransferencia > 0);
    if (transferenciaPanel) transferenciaPanel.style.display = requiereSoporte ? '' : 'none';
    _actualizarResumenAdjuntosCaja();
}

function _resetFormularioCaja() {
    ['cajaNroOrden','cajaFechaOrden','cajaNroDoc','cajaNombrePaciente',
     'cajaCargo','cajaEmpresa','cajaEmpresaMision','cajaTotalCosto',
     'cajaTipoExamenOtro','cajaEnfasisOtro','cajaParaclinicosOtro',
     'cajaLaboratorioOtro','cajaOtrosServiciosOtro','cajaObservaciones',
     'cajaMixtoEfectivo','cajaMixtoTransferencia','cajaMixtoCredito',
     'cajaNumeroTurno','cajaAutorizacionObservaciones',
     'cajaReqGerenciaResp','cajaReqGerenciaCel','cajaReqAsesoraResp','cajaReqAsesoraCel',
     'cajaReqOtroNombre','cajaReqOtroResp','cajaReqOtroCel'
    ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('cajaTipoDoc').value     = 'CC';
    document.getElementById('cajaTipoCliente').value = '';
    document.getElementById('cajaFormaPago').value   = '';
    document.getElementById('cajaMixtoPanel').style.display = 'none';
    document.getElementById('cajaTransferenciaPanel').style.display = 'none';
    document.getElementById('cajaOrdenId').value     = '';
    document.getElementById('cajaOrdenMsg').textContent = '';
    if (document.getElementById('cajaTransferenciaAdjuntos')) {
        document.getElementById('cajaTransferenciaAdjuntos').value = '';
    }
    _renderCajaAdjuntos([]);
    _actualizarResumenAdjuntosCaja();
    // Limpiar checkboxes
    ['cajaTipoExamen','cajaEnfasis','cajaParaclinicos','cajaLaboratorio','cajaOtrosServicios','cajaFormasAutorizacion']
        .forEach(name => {
            document.querySelectorAll(`input[name="${name}"]`).forEach(el => el.checked = false);
        });
    ['cajaReqGerenciaCheck','cajaReqAsesoraCheck','cajaReqOtroCheck'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
    });
}

function abrirFormularioCaja() {
    cargarOpcionesCaja();
    _resetFormularioCaja();
    document.getElementById('cajaOrdenModalTitulo').textContent = 'Nueva Orden de Servicio';
    // Prefijar fecha de hoy
    document.getElementById('cajaFechaOrden').value = new Date().toISOString().slice(0, 10);
    if (document.getElementById('cajaTransferenciaAdjuntos')) {
        document.getElementById('cajaTransferenciaAdjuntos').onchange = _actualizarResumenAdjuntosCaja;
    }
    document.getElementById('cajaOrdenModal').classList.add('active');
}

function cerrarFormularioCaja() {
    document.getElementById('cajaOrdenModal').classList.remove('active');
}

async function abrirEditarOrdenCaja(ordenId) {
    cargarOpcionesCaja();
    try {
        const res  = await fetch(`/api/comercial/caja/${ordenId}`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Error cargando orden', 'error'); return; }
        const o = data.orden;

        _resetFormularioCaja();
        document.getElementById('cajaOrdenId').value          = o.id;
        document.getElementById('cajaNroOrden').value         = o.nro_orden || '';
        document.getElementById('cajaFechaOrden').value       = o.fecha_orden || '';
        document.getElementById('cajaTipoDoc').value          = o.tipo_documento || 'CC';
        document.getElementById('cajaNroDoc').value           = o.nro_documento || '';
        document.getElementById('cajaNombrePaciente').value   = o.nombre_paciente || '';
        document.getElementById('cajaCargo').value            = o.cargo_paciente || '';
        document.getElementById('cajaNumeroTurno').value      = o.numero_turno || '';
        document.getElementById('cajaEmpresa').value          = o.empresa || '';
        document.getElementById('cajaEmpresaMision').value    = o.empresa_mision || '';
        document.getElementById('cajaTotalCosto').value       = o.total_costo || '';
        document.getElementById('cajaTipoCliente').value      = o.tipo_cliente || '';
        document.getElementById('cajaFormaPago').value        = o.forma_pago || '';
        document.getElementById('cajaObservaciones').value    = o.observaciones || '';
        document.getElementById('cajaAutorizacionObservaciones').value = o.autorizacion_observaciones || '';
        document.getElementById('cajaTipoExamenOtro').value   = o.tipo_examen_otro || '';
        document.getElementById('cajaEnfasisOtro').value      = o.enfasis_otro || '';
        document.getElementById('cajaParaclinicosOtro').value = o.paraclinicos_otro || '';
        document.getElementById('cajaLaboratorioOtro').value  = o.laboratorio_otro || '';
        document.getElementById('cajaOtrosServiciosOtro').value = o.otros_servicios_otro || '';

        if (o.forma_pago === 'MIXTO') {
            document.getElementById('cajaMixtoPanel').style.display = '';
            document.getElementById('cajaMixtoEfectivo').value     = o.mixto_efectivo || '';
            document.getElementById('cajaMixtoTransferencia').value = o.mixto_transferencia || '';
            document.getElementById('cajaMixtoCredito').value      = o.mixto_credito || '';
        }

        // Checkboxes — esperar a que las opciones estén renderizadas
        await cargarOpcionesCaja();
        _setCheckedValues('cajaTipoExamen',      o.tipo_examen,    'radio');
        _setCheckedValues('cajaEnfasis',         o.enfasis,        'checkbox');
        _setCheckedValues('cajaParaclinicos',     o.paraclinicos,   'checkbox');
        _setCheckedValues('cajaLaboratorio',      o.laboratorio,    'checkbox');
        _setCheckedValues('cajaOtrosServicios',   o.otros_servicios,'checkbox');
        _setCheckedValues('cajaFormasAutorizacion', o.formas_autorizacion, 'checkbox');
        _applyCajaRequerimientos(o.grupo_requerimientos || []);
        _renderCajaAdjuntos(o.adjuntos_transferencia || []);
        if (document.getElementById('cajaTransferenciaAdjuntos')) {
            document.getElementById('cajaTransferenciaAdjuntos').onchange = _actualizarResumenAdjuntosCaja;
        }
        toggleMixtoCaja();

        document.getElementById('cajaOrdenModalTitulo').textContent = `Editar Orden ${o.nro_orden}`;
        document.getElementById('cajaOrdenModal').classList.add('active');
    } catch (err) {
        showToast('Error de conexión', 'error');
    }
}

async function guardarOrdenCaja() {
    const msg     = document.getElementById('cajaOrdenMsg');
    const ordenId = document.getElementById('cajaOrdenId').value;
    if (msg) msg.textContent = '';

    const tipoExamenChecked = _getCheckedValues('cajaTipoExamen');
    const comprobantes = Array.from(document.getElementById('cajaTransferenciaAdjuntos')?.files || []);

    const payload = {
        nro_orden:            document.getElementById('cajaNroOrden').value.trim(),
        fecha_orden:          document.getElementById('cajaFechaOrden').value,
        tipo_documento:       document.getElementById('cajaTipoDoc').value,
        nro_documento:        document.getElementById('cajaNroDoc').value.trim(),
        nombre_paciente:      document.getElementById('cajaNombrePaciente').value.trim(),
        cargo_paciente:       document.getElementById('cajaCargo').value.trim(),
        empresa:              document.getElementById('cajaEmpresa').value.trim(),
        empresa_mision:       document.getElementById('cajaEmpresaMision').value.trim(),
        tipo_examen:          tipoExamenChecked[0] || null,
        tipo_examen_otro:     document.getElementById('cajaTipoExamenOtro').value.trim(),
        enfasis:              _getCheckedValues('cajaEnfasis'),
        enfasis_otro:         document.getElementById('cajaEnfasisOtro').value.trim(),
        paraclinicos:         _getCheckedValues('cajaParaclinicos'),
        paraclinicos_otro:    document.getElementById('cajaParaclinicosOtro').value.trim(),
        laboratorio:          _getCheckedValues('cajaLaboratorio'),
        laboratorio_otro:     document.getElementById('cajaLaboratorioOtro').value.trim(),
        otros_servicios:      _getCheckedValues('cajaOtrosServicios'),
        otros_servicios_otro: document.getElementById('cajaOtrosServiciosOtro').value.trim(),
        total_costo:          document.getElementById('cajaTotalCosto').value || 0,
        tipo_cliente:         document.getElementById('cajaTipoCliente').value,
        forma_pago:           document.getElementById('cajaFormaPago').value,
        mixto_efectivo:       document.getElementById('cajaMixtoEfectivo').value || 0,
        mixto_transferencia:  document.getElementById('cajaMixtoTransferencia').value || 0,
        mixto_credito:        document.getElementById('cajaMixtoCredito').value || 0,
        formas_autorizacion:  _getCheckedValues('cajaFormasAutorizacion'),
        autorizacion_observaciones: document.getElementById('cajaAutorizacionObservaciones').value.trim(),
        grupo_requerimientos: _buildCajaRequerimientos(),
        numero_turno:         document.getElementById('cajaNumeroTurno').value.trim(),
        observaciones:        document.getElementById('cajaObservaciones').value.trim(),
    };

    const tieneAdjuntosActuales = Number(document.getElementById('cajaTransferenciaAdjuntosExistentes')?.dataset?.count || 0) > 0;
    const requiereSoporte = payload.forma_pago === 'TRANSFERENCIA'
        || (payload.forma_pago === 'MIXTO' && Number(payload.mixto_transferencia || 0) > 0);
    if (requiereSoporte && !comprobantes.length && !tieneAdjuntosActuales) {
        if (msg) msg.textContent = 'Debe adjuntar al menos un recibo cuando la orden incluye transferencia.';
        return;
    }

    const url    = ordenId ? `/api/comercial/caja/${ordenId}` : '/api/comercial/caja';
    const method = ordenId ? 'PUT' : 'POST';
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
        if (Array.isArray(value) || (value && typeof value === 'object')) {
            formData.append(key, JSON.stringify(value));
        } else {
            formData.append(key, value ?? '');
        }
    });
    comprobantes.forEach(file => formData.append('transferencia_adjuntos', file));

    try {
        const res  = await fetch(url, {
            method, credentials: 'include',
            body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { if (msg) msg.textContent = data.error || 'Error guardando.'; return; }
        showToast(ordenId ? 'Orden actualizada' : 'Orden registrada');
        cerrarFormularioCaja();
        consultarOrdenesCaja(1);
    } catch (err) {
        if (msg) msg.textContent = 'Error de conexión.';
    }
}

// --- Consulta ---
function abrirConsultaCaja() {
    const panel = document.getElementById('cajaPanelConsulta');
    const gaps  = document.getElementById('cajaPanelGaps');
    if (gaps)  gaps.style.display  = 'none';
    if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function limpiarFiltroCaja() {
    ['cajaFiltroEmpresa','cajaFiltroNroOrden','cajaFiltroFechaDesde','cajaFiltroFechaHasta'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('cajaFiltroEstado').value = '';
    const tabla = document.getElementById('cajaTablaResultados');
    if (tabla) tabla.style.display = 'none';
    const res = document.getElementById('cajaConsultaResumen');
    if (res) res.textContent = '';
}

async function consultarOrdenesCaja(page = 1) {
    page = Math.max(1, page);
    if (page > window._cajaState.pages && window._cajaState.pages > 0) return;

    const resumen = document.getElementById('cajaConsultaResumen');
    const tabla   = document.getElementById('cajaTablaResultados');
    const tbody   = document.getElementById('cajaTablaBody');
    if (resumen) resumen.textContent = 'Consultando…';

    const params = new URLSearchParams({ page, per_page: 50 });
    const empresa = document.getElementById('cajaFiltroEmpresa')?.value.trim();
    const nroOrden = document.getElementById('cajaFiltroNroOrden')?.value.trim();
    const estado  = document.getElementById('cajaFiltroEstado')?.value;
    const fd      = document.getElementById('cajaFiltroFechaDesde')?.value;
    const fh      = document.getElementById('cajaFiltroFechaHasta')?.value;
    if (empresa)  params.set('empresa', empresa);
    if (nroOrden) params.set('nro_orden', nroOrden);
    if (estado)   params.set('estado', estado);
    if (fd)       params.set('fecha_desde', fd);
    if (fh)       params.set('fecha_hasta', fh);

    try {
        const res  = await fetch('/api/comercial/caja?' + params, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { if (resumen) resumen.textContent = data.error || 'Error consultando.'; return; }

        window._cajaState.page  = data.page  || 1;
        window._cajaState.pages = data.pages || 0;
        window._cajaState.total = data.total || 0;

        if (resumen) resumen.textContent = `${data.total} orden(es) encontrada(s).`;

        const pageInfo = document.getElementById('cajaPageInfo');
        if (pageInfo) pageInfo.textContent = `Página ${data.page} de ${data.pages}`;
        const prevBtn = document.getElementById('cajaPrevBtn');
        const nextBtn = document.getElementById('cajaNextBtn');
        if (prevBtn) prevBtn.disabled = data.page <= 1;
        if (nextBtn) nextBtn.disabled = data.page >= data.pages;

        const ordenes = data.ordenes || [];
        if (!ordenes.length) {
            if (tabla) tabla.style.display = 'none';
            return;
        }

        const _estadoBadge = (e) => {
            const colores = { INGRESADO: '#e67e22', APROBADO: '#27ae60', TERMINADO: '#2980b9', ANULADO: '#c0392b' };
            return `<span style="font-weight:bold; color:${colores[e] || '#555'};">${e}</span>`;
        };

        tbody.innerHTML = '';
        ordenes.forEach(o => {
            const esIngresado = o.estado === 'INGRESADO';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(o.nro_orden)}</td>
                <td>${o.fecha_orden || ''}</td>
                <td>${escapeHtml(o.nombre_paciente)}</td>
                <td style="font-size:0.85em;">${escapeHtml(o.empresa || o.empresa_mision || '')}</td>
                <td>${escapeHtml(o.forma_pago)}</td>
                <td style="text-align:right;">$${_fmtMoney(o.total_costo)}</td>
                <td style="text-align:center;">${_estadoBadge(o.estado)}</td>
                <td style="white-space:nowrap;">
                    <button class="action-btn action-btn-edit" onclick="verDetalleCaja(${o.id})" title="Ver detalle">Ver</button>
                    ${esIngresado ? `<button class="action-btn action-btn-edit" style="background:#6c757d;" onclick="abrirEditarOrdenCaja(${o.id})" title="Editar">Editar</button>` : ''}
                    ${o.estado === 'INGRESADO' ? `<button class="action-btn action-btn-edit" style="background:#27ae60;" onclick="abrirCambiarEstadoCaja(${o.id},'APROBADO')">Aprobar</button>` : ''}
                    ${o.estado === 'APROBADO'  ? `<button class="action-btn action-btn-edit" style="background:#2980b9;" onclick="abrirCambiarEstadoCaja(${o.id},'TERMINADO')">Terminar</button>` : ''}
                    ${o.estado !== 'ANULADO' && o.estado !== 'TERMINADO' ? `<button class="action-btn action-btn-delete" onclick="abrirCambiarEstadoCaja(${o.id},'ANULADO')">Anular</button>` : ''}
                </td>`;
            tbody.appendChild(tr);
        });
        if (tabla) tabla.style.display = '';
    } catch (err) {
        console.error('consultarOrdenesCaja error', err);
        if (resumen) resumen.textContent = 'Error de conexión.';
    }
}

async function verDetalleCaja(ordenId) {
    try {
        const res  = await fetch(`/api/comercial/caja/${ordenId}`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Error', 'error'); return; }
        const o = data.orden;
        const servicios = [
            o.tipo_examen ? `Tipo: ${o.tipo_examen}` : '',
            (o.enfasis?.length)       ? `Énfasis: ${o.enfasis.join(', ')}` : '',
            (o.paraclinicos?.length)  ? `Paraclínicos: ${o.paraclinicos.join(', ')}` : '',
            (o.laboratorio?.length)   ? `Laboratorio: ${o.laboratorio.join(', ')}` : '',
            (o.otros_servicios?.length) ? `Otros: ${o.otros_servicios.join(', ')}` : '',
        ].filter(Boolean).join('\n');
        alert(`Orden: ${o.nro_orden} | ${o.fecha_orden}\nPaciente: ${o.nombre_paciente} (${o.tipo_documento} ${o.nro_documento})\nEmpresa: ${o.empresa || ''} | Misión: ${o.empresa_mision || ''}\nCargo: ${o.cargo_paciente || ''}\n\nServicios:\n${servicios}\n\nTotal: $${_fmtMoney(o.total_costo)} | Pago: ${o.forma_pago}\nEstado: ${o.estado}\nObservaciones: ${o.observaciones || ''}`);
    } catch (err) {
        showToast('Error de conexión', 'error');
    }
}

// --- Cambiar estado ---
function abrirCambiarEstadoCaja(ordenId, nuevoEstado) {
    document.getElementById('cajaCambiarEstadoId').value    = ordenId;
    document.getElementById('cajaCambiarEstadoNuevo').value = nuevoEstado;
    document.getElementById('cajaMotivoAnulacion').value    = '';
    document.getElementById('cajaMotivoAnulacionWrap').style.display = nuevoEstado === 'ANULADO' ? '' : 'none';
    document.getElementById('cajaCambiarEstadoTitulo').textContent = `Cambiar a ${nuevoEstado}`;
    document.getElementById('cajaCambiarEstadoModal').classList.add('active');
}

function cerrarCambiarEstadoCaja() {
    document.getElementById('cajaCambiarEstadoModal').classList.remove('active');
}

async function confirmarCambioEstadoCaja() {
    const ordenId    = document.getElementById('cajaCambiarEstadoId').value;
    const nuevoEstado = document.getElementById('cajaCambiarEstadoNuevo').value;
    const motivo     = document.getElementById('cajaMotivoAnulacion').value.trim();

    if (nuevoEstado === 'ANULADO' && !motivo) {
        showToast('El motivo de anulación es obligatorio', 'error'); return;
    }

    try {
        const res  = await fetch(`/api/comercial/caja/${ordenId}/cambiar-estado`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado, motivo }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Error cambiando estado', 'error'); return; }
        showToast(`Orden ${nuevoEstado.toLowerCase()} correctamente`);
        cerrarCambiarEstadoCaja();
        consultarOrdenesCaja(window._cajaState.page);
    } catch (err) {
        showToast('Error de conexión', 'error');
    }
}

// --- Verificar gaps de numeración ---
function verificarGapsCaja() {
    const panel   = document.getElementById('cajaPanelGaps');
    const consulta = document.getElementById('cajaPanelConsulta');
    if (consulta) consulta.style.display = 'none';
    if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

async function ejecutarVerificacionGaps() {
    const resultado = document.getElementById('cajaGapsResultado');
    if (resultado) resultado.innerHTML = 'Verificando…';

    const params = new URLSearchParams();
    const fd = document.getElementById('cajaGapsFechaDesde')?.value;
    const fh = document.getElementById('cajaGapsFechaHasta')?.value;
    if (fd) params.set('fecha_desde', fd);
    if (fh) params.set('fecha_hasta', fh);

    try {
        const res  = await fetch('/api/comercial/caja/gaps?' + params, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { if (resultado) resultado.textContent = data.error || 'Error.'; return; }

        if (!data.tiene_gaps) {
            resultado.innerHTML = `<span style="color:#27ae60;">✔ Sin saltos en la numeración. Total órdenes verificadas: ${data.total_ordenes}</span>`;
            return;
        }

        let html = `<span style="color:#c0392b;">⚠ Se encontraron ${data.gaps.length} salto(s) en la numeración (${data.total_ordenes} órdenes verificadas):</span><ul style="margin-top:8px;">`;
        data.gaps.forEach(g => {
            html += `<li>Entre <strong>${escapeHtml(g.entre)}</strong> — faltan ${g.cantidad} número(s): ${g.faltantes.join(', ')}${g.cantidad > 20 ? '…' : ''}</li>`;
        });
        html += '</ul>';
        resultado.innerHTML = html;
    } catch (err) {
        if (resultado) resultado.textContent = 'Error de conexión.';
    }
}

// ---------------------------------------------------------------------------
// SERVICIOS Y PAQUETES — Catálogo Comercial (CRUD)
// ---------------------------------------------------------------------------

let _catalogoItems = [];      // cache local para filtros
let _catalogoEditandoId = null;
let _catalogoEliminandoId = null;
let _catalogoComponentesIds = [];  // IDs seleccionados para paquete
let _catalogoEliminarModo = 'delete';

function puedeLeerCatalogoGestion() {
    return canManageComercial('examenes', 'read') || canManageComercial('paquetes', 'read');
}

function puedeCrearCatalogoGestion() {
    return canManageComercial('examenes', 'create') || canManageComercial('paquetes', 'create');
}

function puedeGestionarItemCatalogo(item, action) {
    if (!item) return false;
    if (currentUser?.role === 'Administrador' || currentUser?.is_superuser || currentUser?.is_easy || currentUser?.usuario === 'admin') {
        return true;
    }
    return canManageComercial(getCatalogEntityFromTipoItem(item.tipo_item), action);
}

function actualizarControlesCatalogoGestion() {
    const aviso = document.getElementById('catalogoPermisoAviso');
    const cargaExcel = document.getElementById('catalogoExcelCargaBox');
    const btnNuevo = document.getElementById('btnNuevoCatalogo')
        || document.querySelector('button[onclick="abrirModalCatalogo(null)"]');
    const btnActualizar = document.getElementById('btnActualizarCatalogo')
        || document.querySelector('button[onclick="cargarTablaCatalogo()"]');

    const puedeLeer = puedeLeerCatalogoGestion();
    const puedeCrear = puedeCrearCatalogoGestion();

    if (cargaExcel) cargaExcel.style.display = puedeCrear ? '' : 'none';
    if (btnNuevo) btnNuevo.style.display = puedeCrear ? '' : 'none';
    if (btnActualizar) btnActualizar.disabled = !puedeLeer;

    if (!aviso) return;

    if (!puedeLeer) {
        aviso.style.display = '';
        aviso.style.background = '#fdecea';
        aviso.style.color = '#a93226';
        aviso.style.border = '1px solid #f5c6cb';
        aviso.textContent = 'Tu usuario no tiene permisos para consultar este catálogo.';
        return;
    }

    if (!puedeCrear) {
        aviso.style.display = '';
        aviso.style.background = '#fff8e1';
        aviso.style.color = '#8a6d3b';
        aviso.style.border = '1px solid #f3d28b';
        aviso.textContent = 'Estás en modo solo consulta. Puedes revisar el catálogo, pero no crear nuevos ítems ni cargar Excel.';
        return;
    }

    aviso.style.display = 'none';
    aviso.textContent = '';
}

async function cargarTablaCatalogo() {
    const contenedor = document.getElementById('catalogoTablaContenedor');
    actualizarControlesCatalogoGestion();
    if (!puedeLeerCatalogoGestion()) {
        if (contenedor) {
            contenedor.innerHTML = '<p style="color:#c0392b; text-align:center; padding:20px;">No tienes permisos para consultar servicios y paquetes.</p>';
        }
        return;
    }
    if (contenedor) contenedor.innerHTML = '<p style="color:#888; text-align:center; padding:20px;">Cargando catálogo...</p>';

    try {
        const resp = await fetch('/api/comercial/catalogo', { credentials: 'include' });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            if (contenedor) contenedor.innerHTML = `<p style="color:#c0392b;">Error al cargar: ${err.error || resp.status}</p>`;
            return;
        }
        _catalogoItems = await resp.json();
        filtrarTablaCatalogo();
    } catch (err) {
        if (contenedor) contenedor.innerHTML = '<p style="color:#c0392b;">Error de conexión al cargar el catálogo.</p>';
    }
}

function filtrarTablaCatalogo() {
    const tipo   = (document.getElementById('catalogoFiltroTipo')   || {}).value || '';
    const activo = (document.getElementById('catalogoFiltroActivo') || {}).value;
    const busq   = ((document.getElementById('catalogoBusqueda')    || {}).value || '').toLowerCase().trim();

    const filtrados = _catalogoItems.filter(item => {
        if (tipo   && item.tipo_item !== tipo) return false;
        if (activo === 'true'  && !item.activo) return false;
        if (activo === 'false' &&  item.activo) return false;
        if (busq && !`${item.nombre} ${item.codigo || ''}`.toLowerCase().includes(busq)) return false;
        return true;
    });
    _renderTablaCatalogo(filtrados);
}

function _renderTablaCatalogo(items) {
    const contenedor = document.getElementById('catalogoTablaContenedor');
    if (!contenedor) return;

    if (!items || items.length === 0) {
        contenedor.innerHTML = '<p style="color:#888; text-align:center; padding:20px;">No se encontraron items con los filtros aplicados.</p>';
        return;
    }

    const badge = (txt, color) =>
        `<span style="background:${color};color:#fff;padding:2px 7px;border-radius:10px;font-size:0.78em;white-space:nowrap;">${txt}</span>`;

    const tipoBadge = tipo => {
        const map = { EXAMEN: '#2980b9', PAQUETE: '#8e44ad', SERVICIO: '#27ae60' };
        return badge(tipo, map[tipo] || '#7f8c8d');
    };

    const rows = items.map(it => {
        const subTipo = it.clasificacion_resumen || '-';
        const activoBadge = it.activo ? badge('Activo', '#27ae60') : badge('Inactivo', '#95a5a6');
        const tarifa = it.tarifa_base != null
            ? `$ ${Number(it.tarifa_base).toLocaleString('es-CO')}`
            : '-';
        const componentes = it.resumen_componentes
            ? `<span style="font-size:0.82em; color:#555;" title="${it.resumen_componentes}">${it.cantidad_componentes} examen(es)</span>`
            : '';

        const acciones = [];
        if (puedeGestionarItemCatalogo(it, 'update')) {
            acciones.push(
                `<button class="btn btn-secondary" style="padding:3px 10px; font-size:0.82em;" onclick="abrirModalCatalogo(${it.id})">Editar</button>`
            );
        }
        if (puedeGestionarItemCatalogo(it, 'delete')) {
            acciones.push(
                `<button class="btn btn-danger" style="padding:3px 10px; font-size:0.82em; margin-left:4px;" onclick="abrirModalEliminarCatalogo(${it.id}, '${(it.nombre || '').replace(/'/g, "\\'")}')">Eliminar</button>`
            );
        }
        const accionesHtml = acciones.length
            ? acciones.join('')
            : '<span style="color:#888; font-size:0.82em;">Solo lectura</span>';

        return `<tr>
            <td style="white-space:nowrap; font-size:0.88em;">${it.codigo || '-'}</td>
            <td style="font-size:0.9em;">${it.nombre}${componentes ? '<br>' + componentes : ''}</td>
            <td style="text-align:center;">${tipoBadge(it.tipo_item)}</td>
            <td style="white-space:nowrap; font-size:0.88em;">${subTipo}</td>
            <td style="text-align:right; white-space:nowrap; font-size:0.9em;">${tarifa}</td>
            <td style="text-align:center;">${activoBadge}</td>
            <td style="text-align:center; white-space:nowrap;">${accionesHtml}</td>
        </tr>`;
    }).join('');

    contenedor.innerHTML = `
        <p style="color:#666; font-size:0.88em; margin-bottom:6px;">${items.length} item(s)</p>
        <table style="width:100%; border-collapse:collapse; font-size:0.91em;">
            <thead>
                <tr style="background:#2c3e50; color:#fff;">
                    <th style="padding:7px 8px; text-align:left;">Codigo</th>
                    <th style="padding:7px 8px; text-align:left;">Nombre</th>
                    <th style="padding:7px 8px; text-align:center;">Tipo</th>
                    <th style="padding:7px 8px; text-align:left;">Clasificacion</th>
                    <th style="padding:7px 8px; text-align:right;">Tarifa base</th>
                    <th style="padding:7px 8px; text-align:center;">Estado</th>
                    <th style="padding:7px 8px; text-align:center;">Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>`;
}

// ---- Modal crear / editar ----

function abrirModalCatalogo(itemId) {
    if (!itemId && !puedeCrearCatalogoGestion()) {
        showError('No tienes permiso para crear servicios, exámenes o paquetes.');
        return;
    }

    _catalogoEditandoId = itemId || null;
    _catalogoComponentesIds = [];

    const modal = document.getElementById('catalogoCrudModal');
    const titulo = document.getElementById('catalogoModalTitulo');
    const errDiv = document.getElementById('catalogoCrudError');
    if (errDiv) { errDiv.style.display = 'none'; errDiv.textContent = ''; }

    // Limpiar form
    ['crudNombre', 'crudNombreCorto', 'crudCodigo', 'crudDescripcion', 'crudComponentesBusq']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const crudTarifa = document.getElementById('crudTarifa');
    if (crudTarifa) crudTarifa.value = '0';
    const crudActivo = document.getElementById('crudActivo');
    if (crudActivo) crudActivo.checked = true;
    const crudTipoItem = document.getElementById('crudTipoItem');
    if (crudTipoItem) crudTipoItem.value = 'EXAMEN';
    const crudTipoExamen = document.getElementById('crudTipoExamen');
    if (crudTipoExamen) crudTipoExamen.value = '';
    const crudSubtipo = document.getElementById('crudSubtipo');
    if (crudSubtipo) crudSubtipo.value = '';
    _actualizarVisibilidadCrudCampos();
    _renderComponentesSeleccionados();

    if (itemId) {
        titulo.textContent = 'Editar ítem';
        const item = _catalogoItems.find(i => i.id === itemId);
        if (!puedeGestionarItemCatalogo(item, 'update')) {
            showError('No tienes permiso para editar este ítem del catálogo.');
            return;
        }
        if (item) {
            if (crudTipoItem) crudTipoItem.value = item.tipo_item || 'EXAMEN';
            if (crudTipoExamen) crudTipoExamen.value = item.tipo_examen || '';
            if (crudSubtipo) crudSubtipo.value = item.subtipo_laboratorio || '';
            document.getElementById('crudNombre').value = item.nombre || '';
            document.getElementById('crudNombreCorto').value = item.nombre_corto || '';
            document.getElementById('crudCodigo').value = item.codigo || '';
            document.getElementById('crudTarifa').value = item.tarifa_base || 0;
            document.getElementById('crudDescripcion').value = item.descripcion || '';
            document.getElementById('crudActivo').checked = item.activo !== false;
            _catalogoComponentesIds = [...(item.componentes_ids || [])];
            _renderComponentesSeleccionados();
        }
        _actualizarVisibilidadCrudCampos();
    } else {
        titulo.textContent = 'Nuevo ítem';
    }

    if (modal) modal.style.display = 'flex';
}

function cerrarModalCatalogo() {
    const modal = document.getElementById('catalogoCrudModal');
    if (modal) modal.style.display = 'none';
    _catalogoEditandoId = null;
    _catalogoComponentesIds = [];
}

function onCrudTipoItemChange() {
    _actualizarVisibilidadCrudCampos();
}

function onCrudTipoExamenChange() {
    _actualizarVisibilidadCrudCampos();
}

function _actualizarVisibilidadCrudCampos() {
    const tipo = (document.getElementById('crudTipoItem') || {}).value || 'EXAMEN';
    const tipoExamen = (document.getElementById('crudTipoExamen') || {}).value || '';

    const grupoTipoExamen = document.getElementById('crudGrupoTipoExamen');
    const grupoSubtipo    = document.getElementById('crudGrupoSubtipo');
    const grupoComp       = document.getElementById('crudGrupoComponentes');

    if (grupoTipoExamen) grupoTipoExamen.style.display = tipo === 'EXAMEN' ? '' : 'none';
    if (grupoSubtipo) {
        const necesitaSubtipo = tipo === 'EXAMEN' && ['LABORATORIO', 'CURSOS'].includes(tipoExamen);
        grupoSubtipo.style.display = necesitaSubtipo ? '' : 'none';
        if (!necesitaSubtipo) {
            const el = document.getElementById('crudSubtipo');
            if (el) el.value = '';
        }
    }
    if (grupoComp) grupoComp.style.display = tipo === 'PAQUETE' ? '' : 'none';
}

async function buscarExamenesParaPaquete() {
    const q = ((document.getElementById('crudComponentesBusq') || {}).value || '').trim().toLowerCase();
    const sugs = document.getElementById('crudComponentesSugerencias');
    if (!sugs) return;

    const examenes = _catalogoItems.filter(it =>
        it.tipo_item === 'EXAMEN' &&
        it.activo &&
        it.clasificacion_completa &&
        !_catalogoComponentesIds.includes(it.id) &&
        (q === '' || `${it.nombre} ${it.codigo || ''}`.toLowerCase().includes(q))
    ).slice(0, 20);

    if (!q && examenes.length === 0) { sugs.style.display = 'none'; return; }

    sugs.innerHTML = examenes.map(ex =>
        `<div style="padding:6px 10px; cursor:pointer; border-bottom:1px solid #f0f0f0; font-size:0.9em;"
              onmousedown="agregarComponentePaquete(${ex.id}, '${(ex.nombre || '').replace(/'/g, "\\'")}')">
            <strong>${ex.codigo || ''}</strong> ${ex.nombre}
            <span style="color:#888; font-size:0.85em;">(${ex.clasificacion_resumen || ex.tipo_examen || ''})</span>
         </div>`
    ).join('') || '<div style="padding:8px 10px; color:#888; font-size:0.9em;">Sin resultados</div>';
    sugs.style.display = '';
}

function agregarComponentePaquete(id, nombre) {
    if (!_catalogoComponentesIds.includes(id)) {
        _catalogoComponentesIds.push(id);
        _renderComponentesSeleccionados();
    }
    const busq = document.getElementById('crudComponentesBusq');
    if (busq) busq.value = '';
    const sugs = document.getElementById('crudComponentesSugerencias');
    if (sugs) sugs.style.display = 'none';
}

function quitarComponentePaquete(id) {
    _catalogoComponentesIds = _catalogoComponentesIds.filter(x => x !== id);
    _renderComponentesSeleccionados();
}

function _renderComponentesSeleccionados() {
    const cont = document.getElementById('crudComponentesSeleccionados');
    if (!cont) return;
    if (_catalogoComponentesIds.length === 0) {
        cont.innerHTML = '<span style="color:#aaa; font-size:0.88em;">Ningún examen seleccionado</span>';
        return;
    }
    cont.innerHTML = _catalogoComponentesIds.map(id => {
        const it = _catalogoItems.find(x => x.id === id);
        const nombre = it ? it.nombre : `ID ${id}`;
        return `<span style="background:#e8f4fd; border:1px solid #b3d7f0; border-radius:12px; padding:3px 10px; font-size:0.85em; display:flex; align-items:center; gap:5px;">
            ${nombre}
            <span onclick="quitarComponentePaquete(${id})" style="cursor:pointer; color:#c0392b; font-weight:bold; font-size:1.1em;" title="Quitar">&times;</span>
        </span>`;
    }).join('');
}

async function guardarItemCatalogo() {
    const errDiv = document.getElementById('catalogoCrudError');
    const btn    = document.getElementById('btnGuardarCatalogo');
    if (errDiv) { errDiv.style.display = 'none'; errDiv.textContent = ''; }
    if (btn) btn.disabled = true;

    const tipo_item     = (document.getElementById('crudTipoItem')     || {}).value || '';
    const tipo_examen   = (document.getElementById('crudTipoExamen')   || {}).value || null;
    const subtipo       = (document.getElementById('crudSubtipo')      || {}).value || null;
    const nombre        = ((document.getElementById('crudNombre')      || {}).value || '').trim();
    const nombre_corto  = ((document.getElementById('crudNombreCorto') || {}).value || '').trim() || null;
    const codigo        = ((document.getElementById('crudCodigo')      || {}).value || '').trim() || null;
    const tarifa_base   = parseFloat((document.getElementById('crudTarifa') || {}).value || '0') || 0;
    const descripcion   = ((document.getElementById('crudDescripcion') || {}).value || '').trim() || null;
    const activo        = (document.getElementById('crudActivo') || {}).checked !== false;
    const entidad       = getCatalogEntityFromTipoItem(tipo_item);
    const accion        = _catalogoEditandoId ? 'update' : 'create';

    if (!nombre) {
        if (errDiv) { errDiv.textContent = 'El nombre es obligatorio.'; errDiv.style.display = ''; }
        if (btn) btn.disabled = false;
        return;
    }
    if (!canManageComercial(entidad, accion)) {
        if (errDiv) { errDiv.textContent = 'No tienes permiso para guardar este tipo de ítem.'; errDiv.style.display = ''; }
        if (btn) btn.disabled = false;
        return;
    }
    if (tipo_item === 'PAQUETE' && _catalogoComponentesIds.length === 0) {
        if (errDiv) { errDiv.textContent = 'Debes agregar al menos un examen al paquete.'; errDiv.style.display = ''; }
        if (btn) btn.disabled = false;
        return;
    }

    const payload = {
        tipo_item,
        tipo_examen: tipo_item === 'EXAMEN' ? (tipo_examen || null) : null,
        subtipo_laboratorio: tipo_item === 'EXAMEN' ? (subtipo || null) : null,
        nombre,
        nombre_corto,
        codigo,
        tarifa_base,
        descripcion,
        activo,
        componentes_ids: tipo_item === 'PAQUETE' ? _catalogoComponentesIds : [],
    };

    try {
        const url    = _catalogoEditandoId ? `/api/comercial/catalogo/${_catalogoEditandoId}` : '/api/comercial/catalogo';
        const method = _catalogoEditandoId ? 'PUT' : 'POST';
        const resp   = await fetch(url, {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            if (errDiv) { errDiv.textContent = data.error || `Error ${resp.status}`; errDiv.style.display = ''; }
            if (btn) btn.disabled = false;
            return;
        }
        cerrarModalCatalogo();
        await cargarTablaCatalogo();
    } catch (err) {
        if (errDiv) { errDiv.textContent = 'Error de conexión.'; errDiv.style.display = ''; }
        if (btn) btn.disabled = false;
    }
}

// ---- Modal eliminar ----

function abrirModalEliminarCatalogo(id, nombre) {
    const item = _catalogoItems.find(entry => entry.id === id);
    if (!puedeGestionarItemCatalogo(item, 'delete')) {
        showError('No tienes permiso para eliminar este ítem del catálogo.');
        return;
    }

    _catalogoEliminandoId = id;
    _catalogoEliminarModo = 'delete';
    const modal  = document.getElementById('catalogoEliminarModal');
    const label  = document.getElementById('catalogoEliminarNombre');
    const errDiv = document.getElementById('catalogoEliminarError');
    const btn    = document.getElementById('btnConfirmarEliminarCatalogo');
    const message = document.getElementById('catalogoEliminarMensaje') || modal?.querySelector('p');
    if (label)  label.textContent = nombre;
    if (errDiv) { errDiv.style.display = 'none'; errDiv.textContent = ''; }
    if (btn) {
        btn.textContent = 'Eliminar';
        btn.disabled = false;
    }
    if (message) {
        message.innerHTML = `¿Confirmas que deseas eliminar <strong id="catalogoEliminarNombre">${escapeHtml(nombre || '')}</strong>? Esta acción no se puede deshacer.`;
    }
    if (modal)  modal.style.display = 'flex';
}

function cerrarModalEliminarCatalogo() {
    const modal = document.getElementById('catalogoEliminarModal');
    if (modal) modal.style.display = 'none';
    _catalogoEliminandoId = null;
    _catalogoEliminarModo = 'delete';
}

async function confirmarEliminarCatalogo() {
    if (!_catalogoEliminandoId) return;
    const btn    = document.getElementById('btnConfirmarEliminarCatalogo');
    const errDiv = document.getElementById('catalogoEliminarError');
    const item = _catalogoItems.find(entry => entry.id === _catalogoEliminandoId);
    if (!puedeGestionarItemCatalogo(item, 'delete')) {
        if (errDiv) {
            errDiv.textContent = 'No tienes permiso para eliminar este ítem.';
            errDiv.style.display = '';
        }
        return;
    }
    if (btn) btn.disabled = true;
    if (errDiv) { errDiv.style.display = 'none'; errDiv.textContent = ''; }

    try {
        const query = _catalogoEliminarModo === 'soft' ? '?soft=true' : '';
        const resp = await fetch(`/api/comercial/catalogo/${_catalogoEliminandoId}${query}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.status === 409 && _catalogoEliminarModo !== 'soft') {
            const details = data.details || {};
            const referencias = [
                details.tarifas ? `${details.tarifas} tarifa(s)` : null,
                details.atenciones ? `${details.atenciones} atención(es)` : null,
                details.paquetes ? `${details.paquetes} paquete(s)` : null,
            ].filter(Boolean);
            if (errDiv) {
                errDiv.textContent = `${data.error || 'Este ítem ya tiene uso registrado.'} Puedes inactivarlo para ocultarlo del uso diario${referencias.length ? ` (${referencias.join(', ')})` : ''}.`;
                errDiv.style.display = '';
            }
            _catalogoEliminarModo = 'soft';
            if (btn) {
                btn.textContent = 'Inactivar';
                btn.disabled = false;
            }
            return;
        }
        if (!resp.ok) {
            if (errDiv) {
                errDiv.textContent = data.error || `Error ${resp.status}`;
                errDiv.style.display = '';
            }
            if (btn) btn.disabled = false;
            return;
        }
        if (_catalogoEliminarModo === 'soft') {
            showSuccess(data.mensaje || 'Item inactivado correctamente.');
        }
        cerrarModalEliminarCatalogo();
        await cargarTablaCatalogo();
    } catch (err) {
        if (errDiv) { errDiv.textContent = 'Error de conexión.'; errDiv.style.display = ''; }
        if (btn) btn.disabled = false;
    }
}

// ---- Carga masiva Excel ----

async function cargarCatalogoDesdeExcel() {
    const input     = document.getElementById('catalogoExcelArchivo');
    const resultado = document.getElementById('catalogoExcelResultado');
    const btn       = document.getElementById('btnCargarCatalogoExcel');

    if (!puedeCrearCatalogoGestion()) {
        if (resultado) resultado.innerHTML = '<span style="color:#c0392b;">No tienes permiso para cargar catálogos desde Excel.</span>';
        return;
    }

    if (!input || !input.files || !input.files[0]) {
        if (resultado) resultado.innerHTML = '<span style="color:#c0392b;">⚠ Selecciona un archivo .xlsx primero.</span>';
        return;
    }
    const archivo = input.files[0];
    if (!archivo.name.toLowerCase().endsWith('.xlsx')) {
        if (resultado) resultado.innerHTML = '<span style="color:#c0392b;">⚠ Solo se aceptan archivos .xlsx.</span>';
        return;
    }
    if (btn) btn.disabled = true;
    if (resultado) resultado.innerHTML = '<span style="color:#555;">Subiendo, por favor espera...</span>';

    try {
        const formData = new FormData();
        formData.append('archivo', archivo);
        const resp = await fetch('/api/comercial/catalogo/cargar-excel', {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            if (resultado) resultado.innerHTML = `<span style="color:#c0392b;">⚠ Error: ${data.error || resp.status}</span>`;
            return;
        }
        let html = `<span style="color:#27ae60;">✔ ${data.mensaje}</span>`;
        if (data.errores && data.errores.length > 0) {
            html += `<br><span style="color:#e67e22;">Advertencias (${data.total_errores}):</span>
                <ul style="margin:4px 0 0 16px; color:#e67e22; font-size:0.88em;">
                    ${data.errores.map(e => `<li>${e}</li>`).join('')}
                </ul>`;
        }
        if (resultado) resultado.innerHTML = html;
        if (input) input.value = '';
        await cargarTablaCatalogo();
    } catch (err) {
        if (resultado) resultado.innerHTML = '<span style="color:#c0392b;">⚠ Error de conexión al subir el archivo.</span>';
    } finally {
        if (btn) btn.disabled = false;
    }
}


// ===========================================================================
// COMISIONES — LIQUIDACION POR VENDEDOR Y PERIODO
// ===========================================================================

let comisionLiquidacionActual = null;

async function inicializarPanelComisiones() {
    const anioInput = document.getElementById('comisionAnio');
    const mesSelect = document.getElementById('comisionMes');
    const now = new Date();
    if (anioInput && !anioInput.value) anioInput.value = now.getFullYear();
    if (mesSelect && !mesSelect.value) mesSelect.value = String(now.getMonth() + 1);

    const vendedorGroup = document.getElementById('comisionVendedorGroup');
    const vendedorSelect = document.getElementById('comisionVendedorId');

    // Un usuario-vendedor solo ve sus comisiones: ocultamos el selector.
    if (currentUser?.es_vendedor && currentUser?.vendedor_id) {
        if (vendedorSelect) {
            vendedorSelect.innerHTML = `<option value="${currentUser.vendedor_id}">${escapeHtml(currentUser.vendedor_nombre || 'Mis comisiones')}</option>`;
            vendedorSelect.value = String(currentUser.vendedor_id);
        }
        if (vendedorGroup) vendedorGroup.style.display = 'none';
        return;
    }

    if (vendedorGroup) vendedorGroup.style.display = '';
    if (!vendedorSelect) return;
    try {
        const vendedores = await asegurarVendedoresComerciales();
        vendedorSelect.innerHTML = '<option value="">Seleccione un vendedor...</option>' +
            vendedores.map(v => `<option value="${v.id}">${escapeHtml(v.nombre)}</option>`).join('');
    } catch (error) {
        console.error('Error cargando vendedores para comisiones:', error);
        vendedorSelect.innerHTML = '<option value="">No disponible</option>';
    }
}

function _resolverVendedorComisionSeleccionado() {
    if (currentUser?.es_vendedor && currentUser?.vendedor_id) {
        return String(currentUser.vendedor_id);
    }
    return document.getElementById('comisionVendedorId')?.value || '';
}

async function generarLiquidacionComision() {
    const vendedorId = _resolverVendedorComisionSeleccionado();
    const anio = document.getElementById('comisionAnio')?.value || '';
    const mes = document.getElementById('comisionMes')?.value || '';

    if (!vendedorId) {
        showError('Selecciona un vendedor.');
        return;
    }
    if (!anio || !mes) {
        showError('Selecciona el periodo (mes y año).');
        return;
    }

    try {
        const response = await fetch('/api/comercial/comisiones/liquidaciones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ vendedor_id: Number(vendedorId), mes: Number(mes), anio: Number(anio) })
        });
        const data = await response.json();
        if (!response.ok) {
            showError(data.error || 'No fue posible generar la liquidacion.');
            return;
        }
        comisionLiquidacionActual = data.liquidacion;
        renderLiquidacionComision(comisionLiquidacionActual);
        showSuccess('Liquidacion generada.');
    } catch (error) {
        console.error('Error generando liquidacion:', error);
        showError('Error de conexion al generar la liquidacion.');
    }
}

function renderLiquidacionComision(liquidacion) {
    const resumen = document.getElementById('comisionResumenPanel');
    const detallePanel = document.getElementById('comisionDetallePanel');
    if (!liquidacion) {
        if (resumen) resumen.style.display = 'none';
        if (detallePanel) detallePanel.style.display = 'none';
        return;
    }

    if (resumen) resumen.style.display = '';
    if (detallePanel) detallePanel.style.display = '';

    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('comisionTotalConSoporte', formatCurrency(liquidacion.total_recaudo_con_soporte || 0));
    setText('comisionTotalSinSoporte', formatCurrency(liquidacion.total_recaudo_sin_soporte || 0));
    setText('comisionTotalAprobada', formatCurrency(liquidacion.total_comision_aprobada || 0));
    setText('comisionTotalPendiente', formatCurrency(liquidacion.total_comision_pendiente || 0));
    setText('comisionTotalPagable', formatCurrency(liquidacion.total_comision_pagable || 0));

    const badge = document.getElementById('comisionEstadoBadge');
    if (badge) {
        badge.textContent = liquidacion.estado || 'BORRADOR';
        badge.className = 'badge ' + (liquidacion.estado === 'CERRADA' ? 'badge-success' : 'badge-secondary');
    }

    const cerrarBtn = document.getElementById('comisionCerrarBtn');
    if (cerrarBtn) {
        const puedeCerrar = liquidacion.estado !== 'CERRADA' && canManageComercial('comisiones', 'update');
        cerrarBtn.style.display = puedeCerrar ? '' : 'none';
    }

    const tbody = document.getElementById('comisionDetalleTable');
    if (!tbody) return;
    const detalles = liquidacion.detalles || [];
    if (!detalles.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="loading">No hay recibos de pago en este periodo.</td></tr>';
        return;
    }

    const puedeValidar = canManageComercial('comisiones', 'validate') && liquidacion.estado !== 'CERRADA';
    tbody.innerHTML = detalles.map(det => {
        const soporte = det.tiene_soporte
            ? (det.comprobante_url ? `<a href="${det.comprobante_url}" target="_blank">Ver</a>` : '<span class="badge badge-success">Con soporte</span>')
            : '<span class="badge badge-warning-soft">Sin soporte</span>';
        const estado = renderEstadoValidacionComision(det.estado_validacion);
        let acciones = '<span style="color:#64748b;">—</span>';
        if (!det.tiene_soporte && puedeValidar) {
            acciones = `
                <button class="action-btn action-btn-edit" onclick="validarComision(${det.id}, 'APROBAR')">Aprobar</button>
                <button class="action-btn action-btn-delete" onclick="validarComision(${det.id}, 'RECHAZAR')">Rechazar</button>
            `;
        }
        return `
            <tr>
                <td>${escapeHtml(det.fecha_pago || 'N/A')}</td>
                <td>${escapeHtml(det.cliente_nombre || 'N/A')}</td>
                <td>${escapeHtml(det.forma_pago || 'N/A')}</td>
                <td style="max-width:220px;">${escapeHtml(det.descripcion || '')}</td>
                <td>${formatCurrency(det.valor_recaudo || 0)}</td>
                <td>${Number(det.porcentaje_aplicado || 0).toFixed(2)}%</td>
                <td>${formatCurrency(det.comision || 0)}</td>
                <td>${soporte}</td>
                <td>${estado}</td>
                <td style="display:flex; gap:6px; flex-wrap:wrap;">${acciones}</td>
            </tr>
        `;
    }).join('');
}

function renderEstadoValidacionComision(estado) {
    if (estado === 'APROBADA') return '<span class="badge badge-success">Aprobada</span>';
    if (estado === 'RECHAZADA') return '<span class="badge badge-danger">Rechazada</span>';
    return '<span class="badge badge-warning-soft">Pendiente</span>';
}

async function validarComision(detalleId, decision) {
    let observacion = '';
    if (decision === 'RECHAZAR') {
        observacion = prompt('Motivo del rechazo (opcional):') || '';
    }
    try {
        const response = await fetch(`/api/comercial/comisiones/detalle/${detalleId}/validar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ decision, observacion })
        });
        const data = await response.json();
        if (!response.ok) {
            showError(data.error || 'No fue posible validar la comision.');
            return;
        }
        comisionLiquidacionActual = data.liquidacion;
        renderLiquidacionComision(comisionLiquidacionActual);
        showSuccess(decision === 'APROBAR' ? 'Comision aprobada.' : 'Comision rechazada.');
    } catch (error) {
        console.error('Error validando comision:', error);
        showError('Error de conexion al validar la comision.');
    }
}

async function cerrarLiquidacionComision() {
    if (!comisionLiquidacionActual?.id) return;
    if (!confirm('¿Cerrar la liquidacion? No podras recalcularla despues.')) return;

    try {
        const response = await fetch(`/api/comercial/comisiones/liquidaciones/${comisionLiquidacionActual.id}/cerrar`, {
            method: 'POST',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            showError(data.error || 'No fue posible cerrar la liquidacion.');
            return;
        }
        comisionLiquidacionActual = data.liquidacion;
        renderLiquidacionComision(comisionLiquidacionActual);
        showSuccess('Liquidacion cerrada.');
    } catch (error) {
        console.error('Error cerrando liquidacion:', error);
        showError('Error de conexion al cerrar la liquidacion.');
    }
}
