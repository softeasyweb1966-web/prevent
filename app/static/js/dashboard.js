// Dashboard functionality

let currentUser = null;
let empleadosList = [];
let tiposNovedadList = [];
let rolesData = [];
let menuOptionsData = [];
let chatState = {
    initialized: false,
    users: [],
    conversations: [],
    activeConversationId: null,
    pollHandle: null,
    notificationPrimed: false,
    audioContext: null,
    audioUnlockBound: false,
    desktopPermissionRequested: false
};
// Contexto actual de período de nómina seleccionado (año/mes/quincena)
let nominaPeriodoSeleccionado = null;
let nominaDashboardRequestSeq = 0;
// Contexto de período actual por módulo (Mes/Año)
window._nominaMatrixContext = window._nominaMatrixContext || null;
window._bancosPeriodoActual = window._bancosPeriodoActual || null;
window._comercialPeriodoActual = window._comercialPeriodoActual || null;
window._comisionesPeriodoActual = window._comisionesPeriodoActual || null;
window._comercialSeccionActual = window._comercialSeccionActual || 'inicio';
window._impuestosPeriodoActual = window._impuestosPeriodoActual || null;
window._comprasPeriodoActual = window._comprasPeriodoActual || null;
window._ventasPeriodoActual = window._ventasPeriodoActual || null;

(function initNominaPeriodoFromStorage() {
    try {
        if (!nominaPeriodoSeleccionado && window.localStorage) {
            const raw = localStorage.getItem('nominaPeriodoActual');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.mes === 'number' && typeof parsed.anio === 'number' && typeof parsed.numero_quincena === 'number') {
                    nominaPeriodoSeleccionado = parsed;
                }
            }
        }
    } catch (e) {
        console.warn('No se pudo recuperar periodo de nomina desde localStorage', e);
    }
})();

function persistNominaPeriodoSeleccionado() {
    try {
        if (!window.localStorage) return;
        if (nominaPeriodoSeleccionado) {
            localStorage.setItem('nominaPeriodoActual', JSON.stringify({
                mes: Number(nominaPeriodoSeleccionado.mes),
                anio: Number(nominaPeriodoSeleccionado.anio),
                numero_quincena: Number(nominaPeriodoSeleccionado.numero_quincena),
                origen: nominaPeriodoSeleccionado.origen || 'manual'
            }));
        } else {
            localStorage.removeItem('nominaPeriodoActual');
        }
    } catch (e) {
        console.warn('No se pudo guardar periodo de nomina en localStorage', e);
    }
}

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
    const menuItems = document.querySelectorAll('.menu-item');
    const allowedModules = Array.isArray(currentUser?.menu_modules) ? currentUser.menu_modules : [];
    const isAdminUser = currentUser?.role === 'Administrador';

    menuItems.forEach(item => {
        const moduleName = item.dataset.module;
        const visible = !moduleName || isAdminUser || allowedModules.includes(moduleName);
        const container = item.closest('li') || item;
        container.style.display = visible ? '' : 'none';
    });
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
        ensureChatMonitoring();
    } catch (error) {
        console.error('Error actualizando contexto del usuario actual:', error);
    }
}

function getNominaPeriodoActivo() {
    if (nominaPeriodoSeleccionado && nominaPeriodoSeleccionado.mes && nominaPeriodoSeleccionado.anio && nominaPeriodoSeleccionado.numero_quincena) {
        return {
            mes: Number(nominaPeriodoSeleccionado.mes),
            anio: Number(nominaPeriodoSeleccionado.anio),
            numero_quincena: Number(nominaPeriodoSeleccionado.numero_quincena),
            origen: nominaPeriodoSeleccionado.origen || 'manual'
        };
    }

    try {
        if (window.localStorage) {
            const raw = localStorage.getItem('nominaPeriodoActual');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.mes === 'number' && typeof parsed.anio === 'number' && typeof parsed.numero_quincena === 'number') {
                    nominaPeriodoSeleccionado = parsed;
                    return parsed;
                }
            }
        }
    } catch (e) {
        console.warn('No se pudo leer el periodo activo de nomina', e);
    }

    return null;
}

// Intentar recuperar período de Bancos desde localStorage para no
// volver a pedirlo en cada recarga (similar a Servicios).
(function initBancosPeriodoFromStorage() {
    try {
        if (!window._bancosPeriodoActual && window.localStorage) {
            const raw = localStorage.getItem('bancosPeriodoActual');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.mes === 'number' && typeof parsed.anio === 'number') {
                    window._bancosPeriodoActual = parsed;
                }
            }
        }
    } catch (e) {
        console.warn('No se pudo recuperar periodo de bancos desde localStorage', e);
    }
    window._bancosPeriodoActual = window._bancosPeriodoActual || null;
})();

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
    ensureChatMonitoring();
    
    setupMenuNavigation();
    setupLogout();
    setupUsuariosModule();
    setupEmpleadoForm();
    setupConsultaEmpleados();
    setupEstructuraLaboralForms();
    setupNovedadForm();
    setupNovedadesFiltro();
    setupNominaQuincenaSeleccion();
    setupChatModule();
    setupModulosPeriodoActual();
    refreshCurrentUserContext();
});

// ==================== TOGGLE PANELES DE PERÍODO POR MÓDULO ====================

// Flujo de quincena para Nómina: al hacer clic en "Quincena" salimos del dashboard
// y entramos a una vista de trabajo por período. Si no hay información previa,
// se solicita Año-Mes-Quincena.

async function openNominaQuincenaView() {
    try {
        // Si ya hay un período seleccionado en esta sesión, solo activar vista quincena
        if (!nominaPeriodoSeleccionado) {
            // Consultar quincena actual o sugerida
            let sugerida = null;
            try {
                const resp = await fetch('/api/nomina/quincenas/actual', { credentials: 'include' });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data && data.existe) {
                        sugerida = data;
                    }
                }
            } catch (err) {
                console.error('Error consultando quincena actual/sugerida:', err);
            }

            if (sugerida) {
                nominaPeriodoSeleccionado = {
                    anio: sugerida.anio,
                    mes: sugerida.mes,
                    numero_quincena: sugerida.numero_quincena,
                    origen: sugerida.modo || 'sugerida'
                };
                persistNominaPeriodoSeleccionado();
                actualizarEtiquetaQuincenaSeleccionada();
                await loadNominaDashboard({ usarPeriodoSeleccionado: true });
            } else {
                // No hay información de quincena: pedir Año-Mes-Quincena al usuario
                abrirModalNominaQuincenaSeleccion();
                return;
            }
        }

        activarVistaQuincenaNomina();
    } catch (err) {
        console.error('Error al abrir vista de quincena de nómina:', err);
        showError('No se pudo abrir la vista de quincena.');
    }
}

function activarVistaQuincenaNomina() {
    const homeHeader = document.getElementById('nominaHomeHeader');
    const dashboardResumen = document.getElementById('nominaDashboardResumen');
    const estadoPanel = document.getElementById('nominaEstadoPanel');
    const resumenMensual = document.getElementById('nominaResumenMensual');
    const matrizPanel = document.getElementById('nominaMatrizPanel');
    const panelQuincena = document.getElementById('nominaQuincenaPanel');
    const empleadosPanel = document.getElementById('nominaEmpleadosPanel');

    if (homeHeader) homeHeader.style.display = 'none';
    if (dashboardResumen) dashboardResumen.style.display = 'none';
    if (estadoPanel) estadoPanel.style.display = 'none';
    if (resumenMensual) resumenMensual.style.display = 'none';
    if (matrizPanel) matrizPanel.style.display = 'none';
    // En vista de quincena ocultamos el catálogo general de empleados
    if (empleadosPanel) empleadosPanel.style.display = 'none';
    if (panelQuincena) {
        panelQuincena.style.display = 'block';
        actualizarEtiquetaQuincenaSeleccionada();
    }
}

function volverInicioNomina() {
    const homeHeader = document.getElementById('nominaHomeHeader');
    const dashboardResumen = document.getElementById('nominaDashboardResumen');
    const estadoPanel = document.getElementById('nominaEstadoPanel');
    const resumenMensual = document.getElementById('nominaResumenMensual');
    const matrizPanel = document.getElementById('nominaMatrizPanel');
    const panelQuincena = document.getElementById('nominaQuincenaPanel');
    const empleadosPanel = document.getElementById('nominaEmpleadosPanel');
    const matrizYearEl = document.getElementById('nominaMatrizAnio');
    const label = document.getElementById('nominaQuincenaSeleccionadaLabel');
    const title = document.getElementById('nominaQuincenaActualTitle');

    if (homeHeader) homeHeader.style.display = '';
    if (dashboardResumen) dashboardResumen.style.display = '';
    if (estadoPanel) estadoPanel.style.display = '';
    if (resumenMensual) resumenMensual.style.display = '';
    if (matrizPanel) matrizPanel.style.display = '';
    if (panelQuincena) panelQuincena.style.display = 'none';
    // Al volver al inicio restauramos la tabla de empleados
    if (empleadosPanel) empleadosPanel.style.display = '';
    nominaPeriodoSeleccionado = null;
    persistNominaPeriodoSeleccionado();
    if (label) {
        label.style.display = 'none';
        label.textContent = '';
    }
    if (title) {
        title.textContent = 'Quincena en proceso';
    }
    if (matrizYearEl) {
        matrizYearEl.value = String(new Date().getFullYear());
    }
    loadNominaDashboard({ usarPeriodoSeleccionado: false });
}

function __legacy_actualizarEtiquetaQuincenaSeleccionada() {
    const label = document.getElementById('nominaQuincenaSeleccionadaLabel');
    const title = document.getElementById('nominaQuincenaActualTitle');
    const periodoActivo = getNominaPeriodoActivo();

    if (!periodoActivo) {
        if (label) {
            label.style.display = 'none';
            label.textContent = '';
        }
        if (title) title.textContent = 'Quincena en proceso';
        return;
    }

    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mesNombre = meses[periodoActivo.mes] || periodoActivo.mes;
    const qText = periodoActivo.numero_quincena === 1 || periodoActivo.numero_quincena === '1'
        ? '1ª Quincena'
        : '2ª Quincena';
    label.textContent = `Período seleccionado: ${qText} de ${mesNombre} ${nominaPeriodoSeleccionado.anio}`;
    label.style.display = 'block';
    if (title) {
        title.textContent = `${qText} de ${mesNombre} ${nominaPeriodoSeleccionado.anio}`;
    }
}

// Configuración y manejo del modal de selección de período de nómina
function setupNominaQuincenaSeleccion() {
    const form = document.getElementById('nominaQuincenaSeleccionForm');
    if (!form) return;

    // Prefijar año actual si no hay valor
    const yearInput = document.getElementById('nomina_quincena_anio');
    if (yearInput && !yearInput.value) {
        yearInput.value = new Date().getFullYear();
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        const anio = parseInt(document.getElementById('nomina_quincena_anio').value, 10);
        const mes = parseInt(document.getElementById('nomina_quincena_mes').value, 10);
        const numero = parseInt(document.getElementById('nomina_quincena_numero').value, 10);

        if (!anio || !mes || !numero) {
            showError('Debe seleccionar Año, Mes y Quincena.');
            return;
        }

        nominaPeriodoSeleccionado = {
            anio: anio,
            mes: mes,
            numero_quincena: numero,
            origen: 'manual'
        };

        persistNominaPeriodoSeleccionado();
        closeNominaQuincenaSeleccion();
        actualizarEtiquetaQuincenaSeleccionada();
        loadNominaDashboard({ usarPeriodoSeleccionado: true });
        activarVistaQuincenaNomina();
    });
}

function abrirModalNominaQuincenaSeleccion() {
    const modal = document.getElementById('nominaQuincenaSeleccionModal');
    if (!modal) return;

    // Prefijar valores sugeridos (año/mes actual) si no hay nada
    const now = new Date();
    const yearInput = document.getElementById('nomina_quincena_anio');
    const mesSelect = document.getElementById('nomina_quincena_mes');
    const qSelect = document.getElementById('nomina_quincena_numero');
    if (yearInput && !yearInput.value) yearInput.value = now.getFullYear();
    if (mesSelect && !mesSelect.value) mesSelect.value = String(now.getMonth() + 1);
    if (qSelect && !qSelect.value) qSelect.value = '';

    modal.classList.add('active');
}

function closeNominaQuincenaSeleccion() {
    const modal = document.getElementById('nominaQuincenaSeleccionModal');
    if (modal) modal.classList.remove('active');
}

function toggleServiciosMesPanel() {
    const panel = document.getElementById('serviciosMesPanel');
    if (!panel) return;

    const homeHeader = document.getElementById('serviciosHomeHeader');
    const catalogo = document.getElementById('serviciosCatalogo');
    const resultados = document.getElementById('serviciosLiquidacionResultados');
    const isVisible = panel.style.display === 'block';

    // Si vamos a entrar por primera vez y no hay período definido,
    // pedimos al usuario el mes/año inicial.
    if (!isVisible && !window._serviciosPeriodoActual) {
        if (typeof openServiciosPeriodoSeleccion === 'function') {
            openServiciosPeriodoSeleccion();
            return;
        }
    }

    // Cuando entramos a la gestión de mes, ocultamos el header principal
    // (Nuevo Servicio / Mes / Ver Historial) y el catálogo, igual que en Nómina,
    // para que dentro de "Mes" solo se vea el flujo de pasos.
    panel.style.display = isVisible ? 'none' : 'block';
    if (homeHeader) {
        homeHeader.style.display = isVisible ? '' : 'none';
    }
    if (!isVisible) {
        // Al entrar a Mes: ocultar catálogo y resultados previos hasta que
        // el usuario pulse explícitamente "Pre-Liquidación".
        if (catalogo) catalogo.style.display = 'none';
        if (resultados) resultados.style.display = 'none';
    } else {
        // Al salir de Mes: volver a mostrar catálogo y ocultar resultados
        // de liquidación para evitar mezclar vistas.
        if (catalogo) catalogo.style.display = '';
        if (resultados) resultados.style.display = 'none';
    }
}

function toggleBancosMesPanel() {
    const panel = document.getElementById('bancosMesPanel');
    if (!panel) return;

    const homeHeader = document.getElementById('bancosHomeHeader');
    const isVisible = panel.style.display === 'block';
    // Si vamos a entrar por primera vez y no hay período definido,
    // pedimos al usuario Mes/Año (similar a Servicios).
    if (!isVisible && !window._bancosPeriodoActual) {
        if (typeof openBancosPeriodoSeleccion === 'function') {
            openBancosPeriodoSeleccion();
            return;
        }
    }

    panel.style.display = isVisible ? 'none' : 'block';
    if (homeHeader) {
        homeHeader.style.display = isVisible ? '' : 'none';
    }
}

function toggleComercialMesPanel() {
    if (window._comercialSeccionActual === 'mes') {
        switchComercialSection('inicio', { reload: false, focus: false });
        return;
    }

    switchComercialSection('mes');
}

function toggleComisionesMesPanel() {
    toggleComercialMesPanel();
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

function consultarServicios() {
    const panelMes = document.getElementById('serviciosMesPanel');
    const homeHeader = document.getElementById('serviciosHomeHeader');
    const catalogo = document.getElementById('serviciosCatalogo');
    const resultados = document.getElementById('serviciosLiquidacionResultados');

    if (panelMes) panelMes.style.display = 'none';
    if (homeHeader) homeHeader.style.display = '';
    if (catalogo) catalogo.style.display = '';
    if (resultados) resultados.style.display = 'none';

    if (typeof loadServicesList === 'function') {
        loadServicesList();
    }

    window.setTimeout(() => focusModuleSection('serviciosCatalogo'), 120);
}

function consultarBancos() {
    const panelMes = document.getElementById('bancosMesPanel');
    const homeHeader = document.getElementById('bancosHomeHeader');
    if (panelMes) panelMes.style.display = 'none';
    if (homeHeader) homeHeader.style.display = '';

    if (typeof loadPrestamosResumen === 'function') {
        loadPrestamosResumen();
    }

    window.setTimeout(() => focusModuleSection('prestamosTable'), 120);
}

function toggleImpuestosMesPanel() {
    const panel = document.getElementById('impuestosMesPanel');
    if (!panel) return;

    const homeHeader = document.getElementById('impuestosHomeHeader');
    const isVisible = panel.style.display === 'block';
    if (!isVisible && !window._impuestosPeriodoActual) {
        if (typeof openImpuestosPeriodoSeleccion === 'function') {
            openImpuestosPeriodoSeleccion();
            return;
        }
    }

    panel.style.display = isVisible ? 'none' : 'block';
    if (homeHeader) {
        homeHeader.style.display = isVisible ? '' : 'none';
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

    // Bancos
    const formBancos = document.getElementById('bancosPeriodoSeleccionForm');
    if (formBancos && !formBancos.dataset.bound) {
        const yearInput = document.getElementById('bancos_periodo_anio');
        if (yearInput && !yearInput.value) yearInput.value = now.getFullYear();

        formBancos.addEventListener('submit', (e) => {
            e.preventDefault();
            const anio = parseInt(document.getElementById('bancos_periodo_anio').value, 10);
            const mes = parseInt(document.getElementById('bancos_periodo_mes').value, 10);
            if (!anio || !mes) {
                showError('Debe seleccionar mes y año para Bancos.');
                return;
            }
            window._bancosPeriodoActual = { mes, anio };
            try {
                if (window.localStorage) {
                    localStorage.setItem('bancosPeriodoActual', JSON.stringify(window._bancosPeriodoActual));
                }
            } catch (eStore) {
                console.warn('No se pudo guardar periodo de bancos en localStorage', eStore);
            }
            actualizarEtiquetaBancosPeriodo();
            try {
                if (typeof loadBancosDashboardFull === 'function') {
                    loadBancosDashboardFull();
                } else if (typeof actualizarResumenBancosDashboard === 'function') {
                    actualizarResumenBancosDashboard();
                }
            } catch (eDash) {
                console.warn('No se pudo refrescar resumen de bancos', eDash);
            }
            closeBancosPeriodoSeleccion();

            const panel = document.getElementById('bancosMesPanel');
            const homeHeader = document.getElementById('bancosHomeHeader');
            if (panel) panel.style.display = 'block';
            if (homeHeader) homeHeader.style.display = 'none';
        });
        formBancos.dataset.bound = 'true';
        actualizarEtiquetaBancosPeriodo();
        try {
            if (typeof loadBancosDashboardFull === 'function') {
                loadBancosDashboardFull();
            } else if (typeof actualizarResumenBancosDashboard === 'function') {
                actualizarResumenBancosDashboard();
            }
        } catch (eDashInit) {
            console.warn('No se pudo inicializar resumen de bancos', eDashInit);
        }
    }

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

    // Impuestos
    const formImpuestos = document.getElementById('impuestosPeriodoSeleccionForm');
    if (formImpuestos && !formImpuestos.dataset.bound) {
        const yearInput = document.getElementById('impuestos_periodo_anio');
        if (yearInput && !yearInput.value) yearInput.value = now.getFullYear();

        formImpuestos.addEventListener('submit', (e) => {
            e.preventDefault();
            const anio = parseInt(document.getElementById('impuestos_periodo_anio').value, 10);
            const mes = parseInt(document.getElementById('impuestos_periodo_mes').value, 10);
            if (!anio || !mes) {
                showError('Debe seleccionar mes y año para Impuestos.');
                return;
            }
            window._impuestosPeriodoActual = { mes, anio };
            actualizarEtiquetaImpuestosPeriodo();
            closeImpuestosPeriodoSeleccion();

            const panel = document.getElementById('impuestosMesPanel');
            const homeHeader = document.getElementById('impuestosHomeHeader');
            if (panel) panel.style.display = 'block';
            if (homeHeader) homeHeader.style.display = 'none';
        });
        formImpuestos.dataset.bound = 'true';
        actualizarEtiquetaImpuestosPeriodo();
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

function actualizarEtiquetaBancosPeriodo() {
    const label = document.getElementById('bancosMesSeleccionadoLabel');
    const resumen = document.getElementById('bancosMesActual');

    if (!window._bancosPeriodoActual) {
        if (label) label.textContent = 'Período Préstamos (Mes/Año) · selección pendiente';
        if (resumen) resumen.textContent = 'No hay mes en proceso registrado.';
        return;
    }

    const { mes, anio } = window._bancosPeriodoActual;
    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mesNombre = meses[mes] || mes;

    if (label) label.textContent = `Período seleccionado: ${mesNombre} ${anio}`;
    if (resumen) resumen.textContent = `Mes en proceso: ${mesNombre} ${anio}`;
}

function openBancosPeriodoSeleccion() {
    const modal = document.getElementById('bancosPeriodoSeleccionModal');
    if (!modal) return;

    const now = new Date();
    const base = window._bancosPeriodoActual || { mes: now.getMonth() + 1, anio: now.getFullYear() };

    const anioInput = document.getElementById('bancos_periodo_anio');
    const mesSelect = document.getElementById('bancos_periodo_mes');
    if (anioInput) anioInput.value = base.anio;
    if (mesSelect) mesSelect.value = String(base.mes);

    modal.classList.add('active');
}

function closeBancosPeriodoSeleccion() {
    const modal = document.getElementById('bancosPeriodoSeleccionModal');
    if (modal) modal.classList.remove('active');
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

function actualizarEtiquetaComisionesPeriodo() {
    actualizarEtiquetaComercialPeriodo();
}

function openComisionesPeriodoSeleccion() {
    openComercialPeriodoSeleccion();
}

function closeComisionesPeriodoSeleccion() {
    closeComercialPeriodoSeleccion();
}

function actualizarEtiquetaImpuestosPeriodo() {
    const label = document.getElementById('impuestosMesSeleccionadoLabel');
    const resumen = document.getElementById('impuestosMesActual');

    if (!window._impuestosPeriodoActual) {
        if (label) label.textContent = 'Período Impuestos (Mes/Año) · selección pendiente';
        if (resumen) resumen.textContent = 'No hay mes en proceso registrado.';
        return;
    }

    const { mes, anio } = window._impuestosPeriodoActual;
    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mesNombre = meses[mes] || mes;

    if (label) label.textContent = `Período seleccionado: ${mesNombre} ${anio}`;
    if (resumen) resumen.textContent = `Mes en proceso: ${mesNombre} ${anio}`;
}

function openImpuestosPeriodoSeleccion() {
    const modal = document.getElementById('impuestosPeriodoSeleccionModal');
    if (!modal) return;

    const now = new Date();
    const base = window._impuestosPeriodoActual || { mes: now.getMonth() + 1, anio: now.getFullYear() };

    const anioInput = document.getElementById('impuestos_periodo_anio');
    const mesSelect = document.getElementById('impuestos_periodo_mes');
    if (anioInput) anioInput.value = base.anio;
    if (mesSelect) mesSelect.value = String(base.mes);

    modal.classList.add('active');
}

function closeImpuestosPeriodoSeleccion() {
    const modal = document.getElementById('impuestosPeriodoSeleccionModal');
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

function setNominaWorkflowStep(step) {
    const panel = document.getElementById('nominaQuincenaPanel');
    if (!panel) return;

    const buttons = panel.querySelectorAll('.period-workflow-steps .btn-step');
    buttons.forEach(btn => btn.classList.remove('active'));
    const target = Array.from(buttons).find(btn => btn.dataset.step === step);
    if (target) target.classList.add('active');

    // Mostrar/ocultar botones de Finalizar según el paso
    const btnFinalizarNovedades = document.getElementById('btnNominaFinalizarNovedadesPanel');
    const btnFinalizarPago = document.getElementById('btnNominaFinalizarPagoPanel');
    if (btnFinalizarNovedades) btnFinalizarNovedades.style.display = (step === 'novedades') ? 'inline-block' : 'none';
    if (btnFinalizarPago) btnFinalizarPago.style.display = (step === 'pagos') ? 'inline-block' : 'none';

    if (step === 'resumen') {
        focusNominaPreLiquidacion();
        // Al entrar al paso 1 ejecutamos directamente la pre-liquidación
        if (typeof preliquidarQuincenaSeleccionada === 'function') {
            preliquidarQuincenaSeleccionada();
        }
    } else if (step === 'novedades') {
        focusNominaNovedades();
    } else if (step === 'pagos') {
        focusNominaPagos();
    }
}

// Pre-liquidación directa de la quincena actualmente seleccionada en la vista de Nómina
async function preliquidarQuincenaSeleccionada() {
    if (!nominaPeriodoSeleccionado) {
        showError('Debe seleccionar primero un período de quincena.');
        return;
    }

    const { mes, numero_quincena, anio } = nominaPeriodoSeleccionado;

    try {
        // Verificar estado de la quincena antes de liquidar
        const verificarResponse = await fetch('/api/nomina/quincenas/verificar-estado', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                mes: parseInt(mes),
                numero_quincena: parseInt(numero_quincena),
                anio: parseInt(anio)
            })
        });

        const estadoData = await verificarResponse.json();

        if (!verificarResponse.ok) {
            showError(estadoData.error || 'Error al verificar quincena');
            return;
        }

        if (estadoData.pagos_finalizados) {
            showError(`${estadoData.mensaje}\n\nEsta quincena ya fue finalizada. Proceda a liquidar la siguiente quincena.`);
            return;
        }

        // Si la quincena ya tiene liquidaciones pero aún no tiene pagos,
        // simplemente permitimos re-liquidar sin pedir confirmación adicional
        // (la nueva filosofía permite recalcular las liquidaciones libremente
        //  mientras no se hayan cerrado los pagos).
    } catch (error) {
        console.error('Error verificando quincena seleccionada:', error);
        showError('Error de conexión al verificar quincena');
        return;
    }

    try {
        const response = await fetch('/api/nomina/quincenas/liquidar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                mes: parseInt(mes),
                numero_quincena: parseInt(numero_quincena),
                anio: parseInt(anio)
            })
        });

        const raw = await response.text();
        let result = null;
        try {
            result = raw ? JSON.parse(raw) : {};
        } catch (err) {
            result = { error: raw || 'Respuesta inválida del servidor' };
        }

        if (response.ok) {
            const resultadoNormalizado = await expandirResultadoLiquidacion(result);
            procesarResultadoLiquidacion(resultadoNormalizado);
        } else {
            showError(result.error || 'Error al liquidar quincena');
        }
    } catch (error) {
        console.error('Error al pre-liquidar quincena seleccionada:', error);
        showError(error.message || 'Error de conexión al liquidar quincena');
    }
}

async function expandirResultadoLiquidacion(result) {
    if (Array.isArray(result?.liquidaciones)) {
        return result;
    }

    if (!result?.mes || !result?.numero_quincena || !result?.anio) {
        return result;
    }

    const params = new URLSearchParams({
        mes: String(result.mes),
        numero_quincena: String(result.numero_quincena),
        anio: String(result.anio)
    });

    const liquidacionesResponse = await fetch(`/api/nomina/liquidaciones/pendientes?${params.toString()}`, {
        credentials: 'include'
    });
    const liquidacionesRaw = await liquidacionesResponse.json();

    if (!liquidacionesResponse.ok) {
        throw new Error(liquidacionesRaw.error || 'No se pudo cargar la liquidación existente');
    }

    const empleadosResponse = await fetch('/api/nomina/empleados?activos=false', {
        credentials: 'include'
    });
    const empleadosRaw = await empleadosResponse.json();

    if (!empleadosResponse.ok) {
        throw new Error(empleadosRaw.error || 'No se pudo cargar el catálogo de empleados');
    }

    const empleadosMap = {};
    (empleadosRaw || []).forEach(emp => {
        empleadosMap[emp.id] = emp;
    });

    const liquidaciones = (liquidacionesRaw || []).map(liq => {
        const empleado = empleadosMap[liq.empleado_id] || {};
        const sueldoQuincena = Number(liq.sueldo_quincena || 0);
        const totalIngresos = Number(liq.total_ingresos || 0);

        return {
            empleado_id: liq.empleado_id,
            nro_documento: liq.nro_documento,
            nombre: liq.empleado_nombre || empleado.nombre_completo || 'Empleado',
            cargo: liq.cargo || empleado.cargo || '',
            sueldo_base: Number(empleado.sueldo_base || 0),
            sueldo_quincena: sueldoQuincena,
            saldo_anterior: Number(liq.saldo_anterior || 0),
            ingresos_extra: Math.max(0, totalIngresos - sueldoQuincena),
            pension: Number(liq.pension || 0),
            salud: Number(liq.salud || 0),
            caja_compensacion: Number(liq.caja_compensacion || 0),
            deducciones_otras: Number(liq.deducciones_otras || 0),
            anticipos: Number(liq.anticipos || 0),
            prestamos: Number(liq.prestamos || 0),
            total_ingresos: totalIngresos,
            total_deducciones: Number(liq.total_deducciones || 0),
            total_a_pagar: Number(liq.total_a_pagar || 0),
            novedades_aplicadas: [],
            liquido_id: liq.liquido_id
        };
    });

    return {
        ...result,
        total_empleados: liquidaciones.length,
        total_a_pagar_todos: liquidaciones.reduce((acc, item) => acc + Number(item.total_a_pagar || 0), 0),
        liquidaciones
    };
}

function focusNominaPreLiquidacion() {
    const novedadesPanel = document.getElementById('nominaNovedadesPanel');
    const resultados = document.getElementById('liquidacionResultados');
    const pagos = document.getElementById('pagarNominaLiquidada');

    // En este paso los empleados siguen visibles; solo gestionamos las secciones inferiores
    if (novedadesPanel) novedadesPanel.style.display = 'none';
    if (pagos) pagos.style.display = 'none';

    // No forzamos la visibilidad de resultados: solo si ya hay liquidación calculada
    if (resultados && resultados.style.display !== 'none') {
        resultados.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function focusNominaNovedades() {
    const novedadesPanel = document.getElementById('nominaNovedadesPanel');
    const resultados = document.getElementById('liquidacionResultados');
    const pagos = document.getElementById('pagarNominaLiquidada');
    const filtroRow = document.getElementById('nominaNovedadesFiltroRow');

    // Mostrar únicamente el panel de novedades dentro de la vista de quincena,
    // manteniendo visible la tabla de empleados
    if (resultados) resultados.style.display = 'none';
    if (pagos) pagos.style.display = 'none';
    if (novedadesPanel) {
        novedadesPanel.style.display = 'block';

        // Si ya hay un período de nómina seleccionado, ocultar filtros de mes/quincena
        if (filtroRow && nominaPeriodoSeleccionado) {
            filtroRow.style.display = 'none';
        } else if (filtroRow) {
            filtroRow.style.display = 'flex';
        }

        // Cargar automáticamente las novedades del período activo, si existe
        if (nominaPeriodoSeleccionado && typeof loadNovedadesPeriodo === 'function') {
            loadNovedadesPeriodo();
        }

        const anchor = document.getElementById('nominaNovedadesSection');
        if (anchor) {
            anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}

function focusNominaPagos() {
    const novedadesPanel = document.getElementById('nominaNovedadesPanel');
    const resultados = document.getElementById('liquidacionResultados');
    const pagos = document.getElementById('pagarNominaLiquidada');

    // Asegurar que la sección de pagos esté lista (carga datos desde la liquidación)
    if (typeof mostrarSeccionPagos === 'function') {
        try { mostrarSeccionPagos(); } catch (e) { console.error('Error mostrando sección de pagos', e); }
    }

    // Mostrar solo la sección de pagos debajo de la tabla de empleados
    if (novedadesPanel) novedadesPanel.style.display = 'none';
    if (resultados) resultados.style.display = 'none';
    if (pagos) {
        pagos.style.display = 'block';
        pagos.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function setServiciosWorkflowStep(step) {
    const panel = document.getElementById('serviciosMesPanel');
    if (!panel) return;

    // Mostrar/ocultar botones de Finalizar según el paso, similar a Nómina
    const btnFinalizarNovedades = document.getElementById('btnServiciosFinalizarNovedadesPanel');
    const btnFinalizarPago = document.getElementById('btnServiciosFinalizarPagoPanel');
    if (btnFinalizarNovedades) btnFinalizarNovedades.style.display = (step === 'novedades') ? 'inline-block' : 'none';
    if (btnFinalizarPago) btnFinalizarPago.style.display = (step === 'pagos') ? 'inline-block' : 'none';

    const buttons = panel.querySelectorAll('.period-workflow-steps .btn-step');
    buttons.forEach(btn => btn.classList.remove('active'));
    const target = Array.from(buttons).find(btn => btn.dataset.step === step);
    if (target) target.classList.add('active');

     // Acciones de la tabla de liquidación (Registrar Pago / Finalizar Mes)
    const liqAcciones = document.getElementById('serviciosLiquidacionAcciones');
    const liqResultados = document.getElementById('serviciosLiquidacionResultados');
    const novedadesPanel = document.getElementById('serviciosNovedadesPanel');
    if (liqAcciones) {
        // Solo deben verse en el paso de Pagos; en Pre-Liquidación
        // mostramos únicamente el resumen de servicios a pagar.
        liqAcciones.style.display = (step === 'pagos') ? 'flex' : 'none';
    }

    if (step === 'resumen') {
        // Paso 1: Pre-Liquidación.
        // Si aún no hay período seleccionado de Servicios, pedirlo primero.
        if (!window._serviciosPeriodoActual && typeof openServiciosPeriodoSeleccion === 'function') {
            try {
                openServiciosPeriodoSeleccion();
                return;
            } catch (e) {
                console.error('Error abriendo selección de período de servicios', e);
            }
        }

        // Ejecutar la liquidación mensual usando siempre el período actual
        // (el modal rellenará mes/año y lo ocultará, sin volver a preguntar).
        if (typeof showServiciosLiquidacionModal === 'function') {
            try {
                showServiciosLiquidacionModal();
            } catch (e) {
                console.error('Error mostrando liquidación mensual de servicios', e);
            }
        }

        const resultados = document.getElementById('serviciosLiquidacionResultados');
        if (resultados) {
            resultados.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (novedadesPanel) {
            novedadesPanel.style.display = 'none';
        }
    } else if (step === 'novedades') {
        // Paso 2: Novedades. Ocultamos la tabla de pre-liquidación y
        // mostramos el panel de novedades con su tabla, similar a Nómina.
        if (liqResultados) {
            liqResultados.style.display = 'none';
        }
        if (novedadesPanel) {
            novedadesPanel.style.display = 'block';
        }
        if (typeof loadServiciosNovedadesMesActual === 'function') {
            try {
                loadServiciosNovedadesMesActual('serviciosNovedadesInlineBody');
            } catch (e) {
                console.error('Error cargando novedades de servicios para el mes actual', e);
            }
        }
    } else if (step === 'pagos') {
        // Paso 3: Pagos. Aquí abrimos directamente el registro de pago,
        // manteniendo la pre-liquidación en el paso 1.
        if (typeof showNewPagoModal === 'function') {
            try {
                showNewPagoModal();
            } catch (e) {
                console.error('Error mostrando registro de pago de servicio', e);
            }
        }
    }
}

function setBancosWorkflowStep(step) {
    const panel = document.getElementById('bancosMesPanel');
    if (!panel) return;

    // Mostrar/ocultar botones de Finalizar según el paso, similar a Nómina
    const btnFinalizarNovedades = document.getElementById('btnBancosFinalizarNovedadesPanel');
    const btnFinalizarPago = document.getElementById('btnBancosFinalizarPagoPanel');
    if (btnFinalizarNovedades) btnFinalizarNovedades.style.display = (step === 'novedades') ? 'inline-block' : 'none';
    if (btnFinalizarPago) btnFinalizarPago.style.display = (step === 'pagos') ? 'inline-block' : 'none';

    const buttons = panel.querySelectorAll('.period-workflow-steps .btn-step');
    buttons.forEach(btn => btn.classList.remove('active'));
    const target = Array.from(buttons).find(btn => btn.dataset.step === step);
    if (target) target.classList.add('active');

    const novedadesPanel = document.getElementById('bancosNovedadesPanel');

    if (step === 'resumen') {
        // En Pre-Liquidación mostramos el resumen de préstamos
        // (tabla principal) y ocultamos el panel de novedades inline.
        if (novedadesPanel) novedadesPanel.style.display = 'none';

        if (typeof reloadPrestamosResumen === 'function') {
            try { reloadPrestamosResumen(); } catch (e) { console.error('Error recargando resumen de préstamos', e); }
        }
        const tabla = document.getElementById('prestamosTable');
        if (tabla) {
            tabla.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    } else if (step === 'novedades') {
        // En Novedades usamos SIEMPRE el período actual de Bancos
        // y cargamos las novedades en el panel inline, sin abrir modales.
        if (novedadesPanel) novedadesPanel.style.display = 'block';
        if (typeof loadPrestamosNovedadesMesActual === 'function') {
            try { loadPrestamosNovedadesMesActual('bancosNovedadesInlineBody'); } catch (e) { console.error('Error cargando novedades de préstamos del mes', e); }
        }
    } else if (step === 'pagos') {
        if (typeof showNewPrestamoPagoModal === 'function') {
            try { showNewPrestamoPagoModal(); } catch (e) { console.error('Error mostrando pago de préstamo', e); }
        }
    }
}

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
function showHistorialModal() {
    // Cargar empleados y mostrar modal
    loadEmpleadosSelectForHistorial();
    const year = new Date().getFullYear();
    document.getElementById('desde_anio_hist').value = year;
    document.getElementById('hasta_anio_hist').value = year;
    document.getElementById('historialResults').innerHTML = '';
    document.getElementById('historialModal').classList.add('active');
}

function closeHistorialModal() {
    document.getElementById('historialModal').classList.remove('active');
    document.getElementById('historialResults').innerHTML = '';
}

async function loadEmpleadosSelectForHistorial() {
    const sel = document.getElementById('historial_empleado_select');
    sel.innerHTML = '<option value="">Todos</option>';
    try {
        const resp = await fetch('/api/nomina/empleados?activos=true', { credentials: 'include' });
        if (!resp.ok) return;
        const empleados = await resp.json();
        empleados.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.textContent = `${e.nombre_completo} — ${e.cedula}`;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('Error cargando empleados para historial', err);
    }
}

// Manejar submit del formulario de historial
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('historialForm');
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            await fetchHistorial();
        });
    }
});

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

function setComercialElementsVisibility(selector, visible) {
    document.querySelectorAll(selector).forEach(element => {
        element.style.display = visible ? '' : 'none';
    });
}

function syncComercialPermissionUI() {
    setComercialElementsVisibility('#comercialNavVendedores', hasAnyComercialPermission('vendedores'));
    setComercialElementsVisibility('#comercialNavExamenes', hasAnyCatalogoPermission());
    setComercialElementsVisibility('#comercialNavClientes', hasAnyComercialPermission('clientes'));
    setComercialElementsVisibility('#comercialNavCargue', canManageComercial('atenciones', 'read') || canManageComercial('atenciones', 'create'));
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

async function loadRoles() {
    const tableBody = document.getElementById('rolesTable');
    if (!tableBody) return;

    try {
        const response = await fetch('/api/usuarios/roles', { credentials: 'include' });
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

function renderRoleMenuPermissions(selectedIds = []) {
    const container = document.getElementById('rolMenuPermissions');
    if (!container) return;

    if (!Array.isArray(menuOptionsData) || menuOptionsData.length === 0) {
        container.innerHTML = '<div class="loading">No fue posible cargar los permisos.</div>';
        return;
    }

    const selected = new Set((selectedIds || []).map(id => String(id)));
    const renderOption = option => `
        <label class="role-menu-option">
            <input type="checkbox" value="${option.permiso_id}" ${selected.has(String(option.permiso_id)) ? 'checked' : ''}>
            <div>
                <strong>${escapeHtml(option.nombre || option.group || 'Permiso')}</strong>
                <span>${escapeHtml(option.descripcion || '')}</span>
            </div>
        </label>
    `;

    const menuOptions = menuOptionsData.filter(option => option.category !== 'comercial');
    const commercialGroups = {};
    menuOptionsData.filter(option => option.category === 'comercial').forEach(option => {
        const key = option.group || 'Comercial';
        commercialGroups[key] = commercialGroups[key] || [];
        commercialGroups[key].push(option);
    });

    container.innerHTML = `
        <div style="grid-column:1 / -1;">
            <h4 style="margin:0 0 10px 0;">Menu lateral</h4>
            <div class="role-menu-grid">
                ${menuOptions.map(renderOption).join('')}
            </div>
        </div>
        <div style="grid-column:1 / -1; margin-top:12px;">
            <h4 style="margin:0 0 10px 0;">Permisos comerciales</h4>
            ${Object.entries(commercialGroups).map(([groupName, options]) => `
                <div style="margin-bottom:14px;">
                    <div style="font-weight:700; margin-bottom:8px;">${escapeHtml(groupName)}</div>
                    <div class="role-menu-grid">
                        ${options.map(renderOption).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
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

async function fetchHistorial() {
    const d_mes = document.getElementById('desde_mes_hist').value;
    const d_num = document.getElementById('desde_numero_quincena_hist').value;
    const d_anio = document.getElementById('desde_anio_hist').value;
    const h_mes = document.getElementById('hasta_mes_hist').value;
    const h_num = document.getElementById('hasta_numero_quincena_hist').value;
    const h_anio = document.getElementById('hasta_anio_hist').value;
    const empleado_id = document.getElementById('historial_empleado_select').value;

    if (!d_mes || !d_num || !d_anio || !h_mes || !h_num || !h_anio) {
        showError('Complete el rango de quincenas');
        return;
    }

    const params = new URLSearchParams();
    params.append('desde_mes', d_mes);
    params.append('desde_numero_quincena', d_num);
    params.append('desde_anio', d_anio);
    params.append('hasta_mes', h_mes);
    params.append('hasta_numero_quincena', h_num);
    params.append('hasta_anio', h_anio);
    if (empleado_id) params.append('empleado_id', empleado_id);

    const url = `/api/nomina/historial?${params.toString()}`;
    const container = document.getElementById('historialResults');
    container.innerHTML = '<p>Cargando historial...</p>';

    try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'Error al consultar historial');
        }
        const data = await resp.json();
        renderHistorialResults(data);
    } catch (err) {
        console.error('Error al obtener historial', err);
        container.innerHTML = `<p style="color:#e74c3c;">${err.message}</p>`;
        showError(err.message || 'Error al obtener historial');
    }
}

function renderHistorialResults(data) {
    const container = document.getElementById('historialResults');
    if (!data || data.length === 0) {
        container.innerHTML = '<p style="color:#666;">No se encontraron movimientos en el rango seleccionado.</p>';
        return;
    }
    let html = '';
    data.forEach((q, qi) => {
        html += `<div class="hist-quincena">
            <h3>${q.quincena}</h3>`;

        html += `<div style="overflow:auto;"><table class="data-table hist-table" style="width:100%; margin-bottom:8px;">
            <thead>
                <tr>
                    <th style="width:30%">Empleado</th>
                    <th style="width:12%">Sueldo</th>
                    <th style="width:12%">Total Deducc.</th>
                    <th style="width:12%">Total a Pagar</th>
                    <th style="width:12%">Saldo Pend.</th>
                    <th style="width:8%">Pagada</th>
                    <th style="width:14%">Acciones</th>
                </tr>
            </thead>
            <tbody>`;

        let total_quincena = 0;
        let total_saldos = 0;
        let total_pagos_real = 0;

        q.liquidaciones.forEach((liq, idx) => {
            // Debug: log empleado id and novedades to help trace incorrect detail content
            try { console.debug('hist render - quincena', qi, 'liq idx', idx, 'empleado_id', liq.empleado_id, 'novedades_count', (liq.novedades_aplicadas||[]).length); } catch(e){}
            const pagos_sum = (liq.pagos || []).reduce((s, p) => s + (p.valor_pagado || 0), 0);
            total_quincena += (liq.total_a_pagar || 0);
            total_saldos += (liq.saldo_pendiente || 0);
            total_pagos_real += pagos_sum;

            const rowId = `hist-${qi}-${idx}`;

            html += `<tr class="hist-main-row" data-rowid="${rowId}" data-empleado-id="${liq.empleado_id || ''}" data-empleado-nombre="${(liq.empleado_nombre||'').replace(/"/g,'&quot;')}">
                <td title="${liq.empleado_nombre || ''}">${liq.empleado_nombre || 'N/A'}</td>
                <td style="text-align:right;">${formatCurrency(liq.sueldo_quincena || 0)}</td>
                <td style="text-align:right;">${formatCurrency(liq.total_deducciones || 0)}</td>
                <td style="text-align:right; font-weight:700; color:#1e88e5;">${formatCurrency(liq.total_a_pagar || 0)}</td>
                <td style="text-align:right; color:#f44336;">${formatCurrency(liq.saldo_pendiente || 0)}</td>
                <td style="text-align:center;">${liq.pagada ? 'Sí' : 'No'}</td>
                <td style="text-align:center;"><button class="btn-detail" onclick="toggleHistDetail('${rowId}')">Detalles</button></td>
            </tr>`;

            // Detail row (hidden by default)
            const novedadesHtml = (liq.novedades_aplicadas || []).map(n => {
                const cuota = n.cuota_numero ? ` (Cuota ${n.cuota_numero})` : '';
                return `<div>${n.tipo}: ${formatCurrency(n.valor_aplicado)}${cuota}</div>`;
            }).join('');

            const pagosHtml = (liq.pagos || []).map(p => `<div>${formatDate(p.fecha_pago)} — ${formatCurrency(p.valor_pagado)} ${p.forma_pago ? '('+p.forma_pago+')' : ''}</div>`).join('');

            html += `<tr id="${rowId}" class="hist-detail-row" data-empleado-id="${liq.empleado_id || ''}">
                <td class="hist-detail-cell" colspan="7">
                    <div class="detail-panel">
                        <div class="detail-section">
                            <h4>Desglose</h4>
                            <div>Pensión: ${formatCurrency(liq.pension || 0)}</div>
                            <div>Salud: ${formatCurrency(liq.salud || 0)}</div>
                            <div>Caja: ${formatCurrency(liq.caja_compensacion || 0)}</div>
                            <div>Anticipos: ${formatCurrency(liq.anticipos || 0)}</div>
                            <div>Préstamos: ${formatCurrency(liq.prestamos || 0)}</div>
                            <div>Otras: ${formatCurrency(liq.otras_deducciones || 0)}</div>
                        </div>
                        <div class="detail-section">
                            <h4>Novedades aplicadas</h4>
                            <div class="hist-novedades">${novedadesHtml || '<div class="hist-empty">- Sin novedades -</div>'}</div>
                        </div>
                        <div class="detail-section">
                            <h4>Pagos</h4>
                            <div class="hist-novedades">${pagosHtml || '<div class="hist-empty">- Sin pagos -</div>'}</div>
                        </div>
                    </div>
                </td>
            </tr>`;
        });

        html += `</tbody></table></div>`;

        html += `<div class="hist-totals">
            <div>Total a Pagar: ${formatCurrency(total_quincena)}</div>
            <div>Total Pagos: ${formatCurrency(total_pagos_real)}</div>
            <div>Saldo Pendiente: ${formatCurrency(total_saldos)}</div>
        </div>`;

        html += `</div>`; // cierre quincena
    });

    container.innerHTML = html;
}

function toggleHistDetail(id) {
    const container = document.getElementById('historialResults');
    const row = document.getElementById(id);
    if (!row) return;

    // Find corresponding main row to get empleado id
    const mainRow = document.querySelector(`tr.hist-main-row[data-rowid="${id}"]`);
    const empleadoId = mainRow ? mainRow.dataset.empleadoId : row.dataset.empleadoId;

    // If the global empleado selector is empty (Todos) and user opened details,
    // filter the whole results to show only that empleado's rows. Clicking again clears the filter.
    const sel = document.getElementById('historial_empleado_select');
    const isAllSelected = sel && !sel.value;

    // Toggle visibility of this detail row
    const opening = row.style.display !== 'table-row';
    row.style.display = opening ? 'table-row' : 'none';

    // When opening and 'Todos' is selected, apply filter
    if (opening && isAllSelected && empleadoId) {
        // Mark container with active filter
        container.dataset.filteredEmpleado = empleadoId;

        // Hide all main and detail rows, then show only matching empleado
        document.querySelectorAll('.hist-main-row').forEach(r => {
            if (r.dataset.empleadoId === empleadoId) r.style.display = '';
            else r.style.display = 'none';
        });
        document.querySelectorAll('.hist-detail-row').forEach(r => {
            if (r.dataset.empleadoId === empleadoId) r.style.display = 'none';
            else r.style.display = 'none';
        });
        // Ensure this detail row is visible
        row.style.display = 'table-row';

        // Insert a small clear-filter bar if not present
        if (!document.getElementById('hist-filter-bar')) {
            const bar = document.createElement('div');
            bar.id = 'hist-filter-bar';
            bar.className = 'hist-filter-bar';
            bar.innerHTML = `<span>Mostrando solo: ${mainRow ? mainRow.dataset.empleadoNombre : 'Empleado'}</span> <button class="action-btn" onclick="clearHistFilter()">Ver todos</button>`;
            container.prepend(bar);
        } else {
            document.getElementById('hist-filter-bar').querySelector('span').textContent = `Mostrando solo: ${mainRow ? mainRow.dataset.empleadoNombre : 'Empleado'}`;
        }
    } else if (!opening && container.dataset.filteredEmpleado) {
        // If closing and there was a filter active for this empleado, clear it
        if (container.dataset.filteredEmpleado === empleadoId) {
            clearHistFilter();
        }
    }

    // Scroll into view when opening
    if (row.style.display === 'table-row') row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearHistFilter() {
    const container = document.getElementById('historialResults');
    delete container.dataset.filteredEmpleado;
    // Show all rows
    document.querySelectorAll('.hist-main-row').forEach(r => r.style.display = '');
    document.querySelectorAll('.hist-detail-row').forEach(r => r.style.display = 'none');
    const bar = document.getElementById('hist-filter-bar');
    if (bar) bar.remove();
}


function setupMenuNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    
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
            switchModule(module);
            
            // Update active state
            menuItems.forEach(mi => mi.classList.remove('active'));
            item.classList.add('active');
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

    // Hide all views
    const views = document.querySelectorAll('.module-view');
    views.forEach(view => view.classList.remove('active'));

    const userMenu = document.querySelector('.user-menu');
    let displayName;
    if (moduleName === 'nomina') {
        displayName = 'Gestión de Nómina';
        if (userMenu) userMenu.style.display = 'none';
    } else if (moduleName === 'servicios') {
        // Título específico para el módulo de Servicios
        displayName = 'Gestión de Servicios';
        if (userMenu) userMenu.style.display = '';
    } else if (moduleName === 'bancos') {
        // Bancos se usa para gestionar préstamos a empleados
        displayName = 'Gestión de Préstamos';
        if (userMenu) userMenu.style.display = '';
    } else if (moduleName === 'comercial') {
        displayName = 'GestiÃ³n de Comisiones';
        if (userMenu) userMenu.style.display = '';
    } else if (moduleName === 'recepcion') {
        displayName = 'Consulta Clientes';
        if (userMenu) userMenu.style.display = '';
    } else if (moduleName === 'chat') {
        displayName = 'Chat Interno';
        if (userMenu) userMenu.style.display = '';
    } else if (moduleName === 'impuestos') {
        displayName = 'Gestión de Impuestos';
        if (userMenu) userMenu.style.display = '';
    } else if (moduleName === 'compras') {
        displayName = 'Gestión de Compras';
        if (userMenu) userMenu.style.display = '';
    } else if (moduleName === 'ventas') {
        displayName = 'Gestión de Ventas';
        if (userMenu) userMenu.style.display = '';
    } else {
        displayName = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
        if (userMenu) userMenu.style.display = '';
    }
    if (moduleName === 'comercial') {
        displayName = 'Gestion Comercial';
    }
    document.getElementById('moduleTitle').textContent = displayName;

    // Try to show a full module view if it exists (e.g., nominaView)
    const fullView = document.getElementById(`${moduleName}View`);
    if (fullView) {
        console.debug('switchModule: activating full view', moduleName);
        fullView.classList.add('active');
        // Load module-specific data where available
        if (moduleName === 'nomina') {
            loadEmpleados();
            // Siempre que entremos al módulo Nómina, mostrar vista de inicio
            volverInicioNomina();
        } else if (moduleName === 'usuarios') {
            loadUsuariosManagement();
        } else if (moduleName === 'chat') {
            initChatModule();
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
        } else if (moduleName === 'recepcion') {
            try {
                inicializarModuloRecepcion();
            } catch (e) {
                console.error('Error inicializando modulo Recepcion', e);
            }
        } else if (moduleName === 'servicios') {
            // Módulo Servicios usa su propio JS para cargar catálogo completo
            try {
                const ph = document.getElementById('serviciosCatalogoPlaceholder');
                if (ph) ph.style.display = 'none';
                if (typeof loadServicesList === 'function') {
                    loadServicesList();
                }
                if (typeof loadServiciosDashboardFull === 'function') {
                    loadServiciosDashboardFull();
                }

                // Al entrar al módulo Servicios desde la barra lateral,
                // siempre mostramos la vista "home" del módulo:
                // - Header principal (Nuevo Servicio / Mes / Ver Historial)
                // - Catálogo de servicios
                // - Panel de "Gestión de Mes" oculto hasta que el usuario
                //   pulse explícitamente el botón Mes.
                const panelMes = document.getElementById('serviciosMesPanel');
                const homeHeader = document.getElementById('serviciosHomeHeader');
                const catalogo = document.getElementById('serviciosCatalogo');
                const resultados = document.getElementById('serviciosLiquidacionResultados');

                if (panelMes) panelMes.style.display = 'none';
                if (homeHeader) homeHeader.style.display = '';
                if (catalogo) catalogo.style.display = '';
                if (resultados) resultados.style.display = 'none';
            
                // Resetear paso activo visualmente a Pre-Liquidación sin
                // ejecutar lógica todavía (el usuario decidirá cuándo).
                if (panelMes) {
                    const buttons = panelMes.querySelectorAll('.period-workflow-steps .btn-step');
                    buttons.forEach(btn => btn.classList.remove('active'));
                    const preBtn = Array.from(buttons).find(btn => btn.dataset.step === 'resumen');
                    if (preBtn) preBtn.classList.add('active');

                    const acciones = panelMes.querySelector('.button-group.module-actions');
                    if (acciones) acciones.style.display = 'none';
                }
            } catch (e) {
                console.error('Error inicializando módulo Servicios', e);
            }
        } else if (moduleName === 'bancos') {
            // Módulo Bancos se centra en préstamos de empleados
            try {
                const panelMes = document.getElementById('bancosMesPanel');
                const homeHeader = document.getElementById('bancosHomeHeader');
                if (panelMes) panelMes.style.display = 'none';
                if (homeHeader) homeHeader.style.display = '';
                if (typeof loadPrestamosResumen === 'function') {
                    loadPrestamosResumen();
                }
                if (typeof loadBancosDashboardFull === 'function') {
                    loadBancosDashboardFull();
                } else if (typeof actualizarResumenBancosDashboard === 'function') {
                    actualizarResumenBancosDashboard();
                }
            } catch (e) {
                console.error('Error inicializando módulo Bancos/Préstamos', e);
            }
        } else if (moduleName === 'impuestos' || moduleName === 'compras' || moduleName === 'ventas') {
            try {
                const panelMes = document.getElementById(`${moduleName}MesPanel`);
                const homeHeader = document.getElementById(`${moduleName}HomeHeader`);
                if (panelMes) panelMes.style.display = 'none';
                if (homeHeader) homeHeader.style.display = '';
            } catch (e) {
                console.error(`Error inicializando modulo ${moduleName}`, e);
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
async function loadNominaDashboard(options = {}) {
    const usarPeriodoSeleccionado = options.usarPeriodoSeleccionado === true;
    const requestSeq = ++nominaDashboardRequestSeq;
      const totalEmpEl = document.getElementById('nominaTotalEmpleados');
      const planillaEl = document.getElementById('nominaEmpleadosPlanilla');
      const pagadaMesEl = document.getElementById('nominaPagadaMes');
      const pendienteEl = document.getElementById('nominaPendientePagar');
      const quinEl = document.getElementById('nominaQuincenaActual');
      const quinTitleEl = document.getElementById('nominaQuincenaActualTitle');
      const matrizYearEl = document.getElementById('nominaMatrizAnio');

    const q1TotalEl = document.getElementById('nominaQ1Total');
    const q1PagadoEl = document.getElementById('nominaQ1Pagado');
    const q1SaldoEl = document.getElementById('nominaQ1Saldo');
    const q2TotalEl = document.getElementById('nominaQ2Total');
    const q2PagadoEl = document.getElementById('nominaQ2Pagado');
    const q2SaldoEl = document.getElementById('nominaQ2Saldo');
    const totalMesEl = document.getElementById('nominaTotalMes');
    const periodoActivo = usarPeriodoSeleccionado ? getNominaPeriodoActivo() : null;
    const anioPreferido = periodoActivo?.anio || new Date().getFullYear();
    const matrizAnio = parseInt(matrizYearEl?.value, 10) || anioPreferido;
    const params = new URLSearchParams({ anio: String(matrizAnio) });

    if (matrizYearEl && !matrizYearEl.value) {
        matrizYearEl.value = String(matrizAnio);
    }

    if (usarPeriodoSeleccionado && periodoActivo?.mes && periodoActivo?.numero_quincena && periodoActivo?.anio) {
        params.set('referencia_mes', String(periodoActivo.mes));
        params.set('referencia_numero_quincena', String(periodoActivo.numero_quincena));
        params.set('referencia_anio', String(periodoActivo.anio));
        actualizarEtiquetaQuincenaSeleccionada();
    }

    if (quinEl) {
        quinEl.textContent = 'Cargando información de quincena...';
    }

      try {
          const resp = await fetch(`/api/dashboard/nomina?${params.toString()}`, { credentials: 'include' });
          if (!resp.ok) {
              throw new Error('No se pudo cargar el dashboard de nómina');
          }
          const data = await resp.json();

          if (requestSeq !== nominaDashboardRequestSeq) {
              return;
          }

          if (totalEmpEl) totalEmpEl.textContent = data.total_empleados != null ? data.total_empleados : '-';
        if (planillaEl) planillaEl.textContent = data.empleados_planilla != null ? data.empleados_planilla : '-';
        if (pagadaMesEl) pagadaMesEl.textContent = typeof formatCurrency === 'function'
            ? formatCurrency(data.nomina_pagada_mes || 0)
            : (data.nomina_pagada_mes || 0);
        if (pendienteEl) pendienteEl.textContent = typeof formatCurrency === 'function'
            ? formatCurrency(data.pendiente_por_pagar || 0)
            : (data.pendiente_por_pagar || 0);

        // Detalle por quincena del mes
        const detalle = Array.isArray(data.detalle_quincenas) ? data.detalle_quincenas : [];
        const byNum = {};
        detalle.forEach(d => {
            if (d && d.numero_quincena != null) {
                byNum[d.numero_quincena] = d;
            }
        });

        const q1 = byNum[1] || {};
        const q2 = byNum[2] || {};

        if (q1TotalEl) q1TotalEl.textContent = typeof formatCurrency === 'function'
            ? formatCurrency(q1.total_a_pagar || 0)
            : (q1.total_a_pagar || 0);
        if (q1PagadoEl) q1PagadoEl.textContent = typeof formatCurrency === 'function'
            ? formatCurrency(q1.total_pagado || 0)
            : (q1.total_pagado || 0);
        if (q1SaldoEl) q1SaldoEl.textContent = typeof formatCurrency === 'function'
            ? formatCurrency(q1.saldo_pendiente || 0)
            : (q1.saldo_pendiente || 0);

        if (q2TotalEl) q2TotalEl.textContent = typeof formatCurrency === 'function'
            ? formatCurrency(q2.total_a_pagar || 0)
            : (q2.total_a_pagar || 0);
        if (q2PagadoEl) q2PagadoEl.textContent = typeof formatCurrency === 'function'
            ? formatCurrency(q2.total_pagado || 0)
            : (q2.total_pagado || 0);
        if (q2SaldoEl) q2SaldoEl.textContent = typeof formatCurrency === 'function'
            ? formatCurrency(q2.saldo_pendiente || 0)
            : (q2.saldo_pendiente || 0);

        if (totalMesEl) totalMesEl.textContent = typeof formatCurrency === 'function'
            ? formatCurrency(data.total_mes_nomina || 0)
            : (data.total_mes_nomina || 0);

        renderNominaMatrizAnual(data.matriz_anual);

          if (quinEl) {
              const quincenaBackend = data.quincena_actual || {};
              const backendCoincideSeleccion =
                usarPeriodoSeleccionado &&
                periodoActivo?.mes &&
                periodoActivo?.numero_quincena &&
                periodoActivo?.anio &&
                Number(quincenaBackend.mes) === Number(periodoActivo.mes) &&
                Number(quincenaBackend.numero_quincena) === Number(periodoActivo.numero_quincena) &&
                Number(quincenaBackend.anio) === Number(periodoActivo.anio);

            const q = (usarPeriodoSeleccionado && periodoActivo?.mes && periodoActivo?.numero_quincena && periodoActivo?.anio)
                ? {
                    mes: periodoActivo.mes,
                    numero_quincena: periodoActivo.numero_quincena,
                    anio: periodoActivo.anio,
                    fecha_inicio: backendCoincideSeleccion ? quincenaBackend.fecha_inicio : null,
                    fecha_fin: backendCoincideSeleccion ? quincenaBackend.fecha_fin : null,
                    procesada: backendCoincideSeleccion ? quincenaBackend.procesada : false,
                    pagos_finalizados: backendCoincideSeleccion ? quincenaBackend.pagos_finalizados : false,
                    modo: backendCoincideSeleccion ? quincenaBackend.modo : 'seleccionada',
                    nombre: backendCoincideSeleccion ? quincenaBackend.nombre : null
                }
                : quincenaBackend;
              if (q.mes && q.numero_quincena && q.anio) {
                  const quincenaLabel = q.numero_quincena === 1 ? '1ª quincena' : '2ª quincena';
                  const quincenaLabelTitulo = q.numero_quincena === 1 ? '1ª Quincena' : '2ª Quincena';
                  const mesesTexto = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
                  const mesNombre = mesesTexto[Number(q.mes)] || q.mes;
                  let estado = 'PENDIENTE';
                  if (q.pagos_finalizados) {
                      estado = 'FINALIZADA';
                  } else if (q.procesada) {
                      estado = 'EN PROCESO';
                  } else if (q.modo === 'siguiente') {
                      estado = 'SIGUIENTE SUGERIDA';
                  } else if (q.modo === 'seleccionada') {
                      estado = 'SELECCIONADA';
                  } else if (q.modo === 'calendario') {
                      estado = 'ACTUAL';
                  }
                  const rango = q.fecha_inicio && q.fecha_fin ? ` (${q.fecha_inicio} a ${q.fecha_fin})` : '';
                  if (quinTitleEl) {
                      quinTitleEl.textContent = q.nombre || `${quincenaLabelTitulo} de ${mesNombre} ${q.anio}`;
                  }
                  quinEl.textContent = `${q.nombre || quincenaLabel}${rango} - ${estado}`;
              } else {
                  if (quinTitleEl) {
                      quinTitleEl.textContent = 'Quincena en proceso';
                  }
                  quinEl.textContent = 'No hay quincena en proceso registrada.';
              }
          }
      } catch (err) {
          console.error('Error cargando dashboard de nómina', err);
          if (requestSeq !== nominaDashboardRequestSeq) {
              return;
          }
          if (quinTitleEl) quinTitleEl.textContent = 'Quincena en proceso';
          if (quinEl) quinEl.textContent = 'No se pudo cargar el estado de la quincena.';
        if (totalEmpEl) totalEmpEl.textContent = '-';
        if (planillaEl) planillaEl.textContent = '-';
        if (pagadaMesEl) pagadaMesEl.textContent = '-';
        if (pendienteEl) pendienteEl.textContent = '-';
        if (q1TotalEl) q1TotalEl.textContent = '-';
        if (q1PagadoEl) q1PagadoEl.textContent = '-';
        if (q1SaldoEl) q1SaldoEl.textContent = '-';
        if (q2TotalEl) q2TotalEl.textContent = '-';
        if (q2PagadoEl) q2PagadoEl.textContent = '-';
        if (q2SaldoEl) q2SaldoEl.textContent = '-';
        if (totalMesEl) totalMesEl.textContent = '-';
          renderNominaMatrizAnual(null, err.message);
      }
  }

function formatCurrencyCompact(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return '-';
    if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
        return '$' + new Intl.NumberFormat('es-CO', {
            notation: 'compact',
            compactDisplay: 'short',
            maximumFractionDigits: amount >= 1000000 ? 1 : 0
        }).format(amount);
    }
    return formatCurrency(amount);
}

function compareNominaPeriods(a, b) {
    const ax = [Number(a?.anio || 0), Number(a?.mes || 0), Number(a?.numero_quincena || 0)];
    const bx = [Number(b?.anio || 0), Number(b?.mes || 0), Number(b?.numero_quincena || 0)];
    if (ax[0] !== bx[0]) return ax[0] - bx[0];
    if (ax[1] !== bx[1]) return ax[1] - bx[1];
    return ax[2] - bx[2];
}

async function obtenerContextoPagoNomina(periodo) {
    const params = new URLSearchParams({
        mes: String(periodo.mes),
        numero_quincena: String(periodo.numero_quincena),
        anio: String(periodo.anio)
    });

    const response = await fetch(`/api/nomina/liquidaciones/pendientes?${params.toString()}`, {
        credentials: 'include'
    });
    const liquidaciones = await response.json();
    if (!response.ok) {
        throw new Error(liquidaciones.error || 'No se pudo cargar la liquidacion del periodo.');
    }

    const empResponse = await fetch('/api/nomina/empleados', { credentials: 'include' });
    const empleados = empResponse.ok ? await empResponse.json() : [];
    const empMap = {};
    (empleados || []).forEach(emp => {
        empMap[emp.id] = emp;
    });

    return { liquidaciones, empMap };
}

async function handleNominaMatrixCellClick(empleadoId, periodIndex) {
    try {
        const matriz = window._nominaMatrixContext;
        if (!matriz || !Array.isArray(matriz.periodos) || !Array.isArray(matriz.filas)) return;

        const periodo = matriz.periodos[periodIndex];
        const fila = (matriz.filas || []).find(item => Number(item.empleado_id) === Number(empleadoId));
        const celda = fila?.celdas?.[periodIndex];
        const referencia = matriz.referencia;

        if (!periodo || !fila || !celda || !referencia) return;

        if (compareNominaPeriods(periodo, referencia) > 0) {
            showError('Ese valor corresponde a la quincena siguiente y aun no esta habilitado para pago.');
            return;
        }

        const periodoPago = {
            mes: Number(referencia.mes),
            numero_quincena: Number(referencia.numero_quincena),
            anio: Number(referencia.anio)
        };

        const contexto = await obtenerContextoPagoNomina(periodoPago);
        const liquidacion = (contexto.liquidaciones || []).find(item => Number(item.empleado_id) === Number(empleadoId));
        if (!liquidacion) {
            showError('El empleado no tiene liquidacion pendiente en el periodo actual. Liquidelo primero si corresponde.');
            return;
        }

        const empleado = contexto.empMap[empleadoId] || {};

        nominaPeriodoSeleccionado = {
            ...periodoPago,
            origen: 'matriz'
        };
        persistNominaPeriodoSeleccionado();
        actualizarEtiquetaQuincenaSeleccionada();
        activarVistaQuincenaNomina();
        ultimaLiquidacionData = { ...periodoPago };
        setNominaWorkflowStep('pagos');
        abrirModalPagoIndividual(liquidacion, empleado);
    } catch (error) {
        console.error('handleNominaMatrixCellClick error', error);
        showError(error.message || 'No se pudo abrir el pago desde la matriz.');
    }
}

function __legacy_renderNominaMatrizAnual(matriz, errorMessage = '') {
    const head = document.getElementById('nominaMatrizHead');
    const body = document.getElementById('nominaMatrizBody');
    const foot = document.getElementById('nominaMatrizFoot');
    const resumen = document.getElementById('nominaMatrizResumen');
    const yearEl = document.getElementById('nominaMatrizAnio');

    if (!head || !body || !foot) return;

    if (!matriz || !Array.isArray(matriz.periodos) || !Array.isArray(matriz.filas)) {
        window._nominaMatrixContext = null;
        if (resumen) resumen.textContent = errorMessage || 'No se pudo construir el tablero anual.';
        head.innerHTML = `
            <tr>
                <th>Empleado</th>
                <th>Sueldo</th>
                <th>Total Cancelado</th>
                <th>Saldo Pendiente</th>
            </tr>
        `;
        body.innerHTML = '<tr><td colspan="4" class="loading">No hay información disponible para el tablero anual.</td></tr>';
        foot.innerHTML = '';
        return;
    }

      if (yearEl) yearEl.value = String(matriz.anio || new Date().getFullYear());
      if (resumen) resumen.textContent = `${matriz.filas.length} empleados visibles en el tablero ${matriz.anio}`;

      const periodoActivo = getNominaPeriodoActivo();
      if (periodoActivo?.anio && periodoActivo?.mes && periodoActivo?.numero_quincena) {
          const limite = getNominaMatrizLimiteVisual(
              Number(periodoActivo.mes),
              Number(periodoActivo.numero_quincena),
              Number(periodoActivo.anio)
          );

          matriz.filas = (matriz.filas || []).map(fila => ({
              ...fila,
              celdas: (fila.celdas || []).map((celda, idx) => {
                  const periodo = matriz.periodos[idx];
                  if (!periodo) return celda;

                  const actual = [Number(matriz.anio || 0), Number(periodo.mes || 0), Number(periodo.numero_quincena || 0)];
                  const fueraDeHorizonte =
                      actual[0] > limite[0] ||
                      (actual[0] === limite[0] && actual[1] > limite[1]) ||
                      (actual[0] === limite[0] && actual[1] === limite[1] && actual[2] > limite[2]);

                  if (!fueraDeHorizonte) {
                      return celda;
                  }

                  return {
                      ...celda,
                      estado: 'BLANK',
                      texto: '',
                      titulo: 'Quincena fuera del horizonte visible del tablero',
                      valor: null,
                      valor_pagado: 0,
                      saldo_pendiente: 0
                  };
              })
          }));
      }

    head.innerHTML = `
        <tr>
            <th>Empleado</th>
            <th>Sueldo</th>
            ${matriz.periodos.map(periodo => `<th>${escapeHtml(periodo.label)}</th>`).join('')}
            <th>Total Cancelado</th>
            <th>Saldo Pendiente</th>
        </tr>
    `;

    if (matriz.filas.length === 0) {
        body.innerHTML = `<tr><td colspan="${matriz.periodos.length + 4}" class="loading">No hay empleados con información para ${matriz.anio}.</td></tr>`;
        foot.innerHTML = '';
        return;
  }

function __legacy_getNominaMatrizLimiteVisual(mes, numeroQuincena, anio) {
    if (Number(numeroQuincena) === 1) {
        return [Number(anio), Number(mes), 2];
    }

    if (Number(mes) === 12) {
        return [Number(anio) + 1, 1, 1];
    }

    return [Number(anio), Number(mes) + 1, 1];
}

    body.innerHTML = matriz.filas.map(fila => `
        <tr>
            <td class="nomina-matriz-empleado">${escapeHtml(fila.empleado || 'N/A')}</td>
            <td class="nomina-matriz-money">${formatCurrencyCompact(fila.sueldo_base)}</td>
            ${fila.celdas.map(celda => `
                <td class="nomina-matriz-cell nomina-matriz-${String(celda.estado || 'BLANK').toLowerCase()}" title="${escapeHtml(celda.titulo || '')}">
                    ${celda.texto ? escapeHtml(celda.texto) : '&nbsp;'}
                </td>
            `).join('')}
            <td class="nomina-matriz-money">${formatCurrencyCompact(fila.total_cancelado)}</td>
            <td class="nomina-matriz-money">${formatCurrencyCompact(fila.saldo_pendiente)}</td>
        </tr>
    `).join('');

    const totalesPeriodos = matriz.periodos.map(periodo => {
        const total = matriz.totales?.periodos?.[periodo.key] || 0;
        return `<td class="nomina-matriz-total" title="${formatCurrency(total)}">${formatCurrencyCompact(total)}</td>`;
    }).join('');

    foot.innerHTML = `
        <tr>
            <td class="nomina-matriz-total-label">Totales</td>
            <td class="nomina-matriz-total" title="${formatCurrency(matriz.totales?.sueldo_base || 0)}">${formatCurrencyCompact(matriz.totales?.sueldo_base || 0)}</td>
            ${totalesPeriodos}
            <td class="nomina-matriz-total" title="${formatCurrency(matriz.totales?.total_cancelado || 0)}">${formatCurrencyCompact(matriz.totales?.total_cancelado || 0)}</td>
            <td class="nomina-matriz-total" title="${formatCurrency(matriz.totales?.saldo_pendiente || 0)}">${formatCurrencyCompact(matriz.totales?.saldo_pendiente || 0)}</td>
        </tr>
    `;
}

function getNominaMatrizLimiteVisual(mes, numeroQuincena, anio) {
    if (Number(numeroQuincena) === 1) {
        return [Number(anio), Number(mes), 2];
    }

    if (Number(mes) === 12) {
        return [Number(anio) + 1, 1, 1];
    }

    return [Number(anio), Number(mes) + 1, 1];
}

function actualizarEtiquetaQuincenaSeleccionada() {
    const label = document.getElementById('nominaQuincenaSeleccionadaLabel');
    const title = document.getElementById('nominaQuincenaActualTitle');
    const periodoActivo = getNominaPeriodoActivo();

    if (!periodoActivo) {
        if (label) {
            label.style.display = 'none';
            label.textContent = '';
        }
        if (title) title.textContent = 'Quincena en proceso';
        return;
    }

    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mesNombre = meses[periodoActivo.mes] || periodoActivo.mes;
    const qText = Number(periodoActivo.numero_quincena) === 1 ? '1ª Quincena' : '2ª Quincena';

    if (label) {
        label.textContent = `Período seleccionado: ${qText} de ${mesNombre} ${periodoActivo.anio}`;
        label.style.display = 'block';
    }
    if (title) {
        title.textContent = `${qText} de ${mesNombre} ${periodoActivo.anio}`;
    }
}

function renderNominaMatrizAnual(matriz, errorMessage = '') {
    const head = document.getElementById('nominaMatrizHead');
    const body = document.getElementById('nominaMatrizBody');
    const foot = document.getElementById('nominaMatrizFoot');
    const resumen = document.getElementById('nominaMatrizResumen');
    const yearEl = document.getElementById('nominaMatrizAnio');

    if (!head || !body || !foot) return;

    if (!matriz || !Array.isArray(matriz.periodos) || !Array.isArray(matriz.filas)) {
        if (resumen) resumen.textContent = errorMessage || 'No se pudo construir el tablero anual.';
        head.innerHTML = `
            <tr>
                <th>Empleado</th>
                <th>Sueldo</th>
                <th>Total Cancelado</th>
                <th>Saldo Pendiente</th>
            </tr>
        `;
        body.innerHTML = '<tr><td colspan="4" class="loading">No hay información disponible para el tablero anual.</td></tr>';
        foot.innerHTML = '';
        return;
    }

    window._nominaMatrixContext = matriz;
    const filas = (matriz.filas || []).map(fila => ({
        ...fila,
        celdas: (fila.celdas || []).map(celda => ({ ...celda }))
    }));

    if (yearEl) yearEl.value = String(matriz.anio || new Date().getFullYear());
    if (resumen) resumen.textContent = `${filas.length} empleados visibles en el tablero ${matriz.anio}`;

    head.innerHTML = `
        <tr>
            <th>Empleado</th>
            <th>Sueldo</th>
            ${matriz.periodos.map(periodo => `<th>${escapeHtml(periodo.label)}</th>`).join('')}
            <th>Total Cancelado</th>
            <th>Saldo Pendiente</th>
        </tr>
    `;

    if (filas.length === 0) {
        body.innerHTML = `<tr><td colspan="${matriz.periodos.length + 4}" class="loading">No hay empleados con información para ${matriz.anio}.</td></tr>`;
        foot.innerHTML = '';
        return;
    }

    body.innerHTML = filas.map(fila => `
        <tr>
            <td class="nomina-matriz-empleado">${escapeHtml(fila.empleado || 'N/A')}</td>
            <td class="nomina-matriz-money">${formatCurrencyCompact(fila.sueldo_base)}</td>
            ${fila.celdas.map((celda, idx) => {
                const periodo = matriz.periodos[idx];
                const esFutura = compareNominaPeriods(periodo, matriz.referencia || {}) > 0;
                const tieneSaldo = Number(celda?.saldo_pendiente || 0) > 0;
                const tieneValorFuturo = esFutura && Number(celda?.valor || 0) > 0;
                const esAccionable = tieneSaldo || tieneValorFuturo;
                const clickableClass = esAccionable ? ' nomina-matrix-actionable' : '';
                const clickableTitle = esAccionable
                    ? [
                        esFutura
                            ? 'No corresponde al periodo actual. Clic para ver la advertencia.'
                            : 'Clic para gestionar el pago en el periodo actual.',
                        celda.titulo || ''
                    ].filter(Boolean).join(' | ')
                    : (celda.titulo || '');
                const onclickAttr = esAccionable
                    ? ` onclick="handleNominaMatrixCellClick(${Number(fila.empleado_id)}, ${idx})"`
                    : '';
                return `
                <td class="nomina-matriz-cell nomina-matriz-${String(celda.estado || 'BLANK').toLowerCase()}${clickableClass}" title="${escapeHtml(clickableTitle)}"${onclickAttr}>
                    ${celda.texto ? escapeHtml(celda.texto) : '&nbsp;'}
                </td>
            `;
            }).join('')}
            <td class="nomina-matriz-money">${formatCurrencyCompact(fila.total_cancelado)}</td>
            <td class="nomina-matriz-money">${formatCurrencyCompact(fila.saldo_pendiente)}</td>
        </tr>
    `).join('');

    const totalesPeriodos = matriz.periodos.map(periodo => {
        const total = matriz.totales?.periodos?.[periodo.key] || 0;
        return `<td class="nomina-matriz-total" title="${formatCurrency(total)}">${formatCurrencyCompact(total)}</td>`;
    }).join('');

    foot.innerHTML = `
        <tr>
            <td class="nomina-matriz-total-label">Totales</td>
            <td class="nomina-matriz-total" title="${formatCurrency(matriz.totales?.sueldo_base || 0)}">${formatCurrencyCompact(matriz.totales?.sueldo_base || 0)}</td>
            ${totalesPeriodos}
            <td class="nomina-matriz-total" title="${formatCurrency(matriz.totales?.total_cancelado || 0)}">${formatCurrencyCompact(matriz.totales?.total_cancelado || 0)}</td>
            <td class="nomina-matriz-total" title="${formatCurrency(matriz.totales?.saldo_pendiente || 0)}">${formatCurrencyCompact(matriz.totales?.saldo_pendiente || 0)}</td>
        </tr>
    `;
}

function openModuleFull(moduleName) {
    const full = document.getElementById(`${moduleName}View`);
    if (full) {
        // deactivate mini/full views
        document.querySelectorAll('.module-view').forEach(v => v.classList.remove('active'));
        full.classList.add('active');
        // set title and user-menu state similar to switchModule
        const userMenu = document.querySelector('.user-menu');
        if (moduleName === 'nomina') {
            document.getElementById('moduleTitle').textContent = 'Gestión de Nómina';
            if (userMenu) userMenu.style.display = 'none';
        } else if (moduleName === 'bancos') {
            document.getElementById('moduleTitle').textContent = 'Gestión de Préstamos';
            if (userMenu) userMenu.style.display = '';
        } else {
            document.getElementById('moduleTitle').textContent = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
            if (userMenu) userMenu.style.display = '';
        }
        if (moduleName === 'comercial') {
            document.getElementById('moduleTitle').textContent = 'Gestion Comercial';
        }
        // load module-specific handlers
        if (moduleName === 'nomina') loadEmpleados();
        else if (moduleName === 'usuarios') loadUsuariosManagement();
        else if (moduleName === 'dashboard') loadDashboardData();
        else if (moduleName === 'comercial') {
            const panelMes = document.getElementById('comercialMesPanel');
            const homeHeader = document.getElementById('comercialHomeHeader');
            if (panelMes) panelMes.style.display = 'none';
            if (homeHeader) homeHeader.style.display = '';
            inicializarModuloComercial(window._comercialSeccionActual || 'inicio');
        }
        else if (moduleName === 'bancos' && typeof loadPrestamosResumen === 'function') loadPrestamosResumen();
    } else {
        alert('No existe la vista completa para este módulo.');
    }
}

async function performLogout() {
    try {
        stopChatPolling();
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        localStorage.removeItem('user');
        window.location.href = '/';
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
        stopChatPolling();
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
    const panelMes = document.getElementById('comercialMesPanel');
    const homeHeader = document.getElementById('comercialHomeHeader');
    const mesActualPanel = document.getElementById('comercialMesActualPanel');
    const config = getComercialSectionConfig(normalizedSection);

    window._comercialSeccionActual = normalizedSection;
    if (homeHeader) homeHeader.style.display = '';
    actualizarNavegacionComercial(normalizedSection);
    mostrarPanelesComercial(normalizedSection);
    ['vendedores', 'examenes', 'clientes'].forEach(section => {
        if (section !== normalizedSection) {
            resetConsultaComercial(section);
        }
    });

    if (normalizedSection === 'inicio') {
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

async function loadEmpleados() {
    const tableBody = document.getElementById('empleadosTable');
    
    try {
        const response = await fetch('/api/nomina/empleados', {
            credentials: 'include'
        });
        const empleados = await response.json();
        
        if (empleados.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" class="loading">No hay empleados registrados</td></tr>';
            return;
        }
        
        tableBody.innerHTML = empleados.map(emp => `
            <tr>
                <td>${emp.cedula}</td>
                <td>${emp.nombre_completo}</td>
                <td>${emp.cargo || 'N/A'}</td>
                <td>${formatCurrency(emp.sueldo_quincena)}</td>
                <td>
                    <span class="badge ${emp.planilla_afiliado ? 'badge-success' : 'badge-warning'}">
                        ${emp.planilla_afiliado ? 'Sí' : 'No'}
                    </span>
                </td>
                <td>${renderEstadoLaboralBadge(emp.estado_laboral, emp.activo)}</td>
                <td>
                    <button class="action-btn action-btn-edit" onclick="editEmpleado(${emp.id})">Editar</button>
                    ${emp.estado_laboral === 'RETIRADO'
                        ? `<button class="action-btn" onclick="showReintegrarEmpleadoModal(${emp.id}, ${JSON.stringify(emp.nombre_completo)})">Reintegrar</button>`
                        : `<button class="action-btn action-btn-delete" onclick="showRetiroEmpleadoModal(${emp.id}, ${JSON.stringify(emp.nombre_completo)})">Retirar</button>`}
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando empleados:', error);
        tableBody.innerHTML = '<tr><td colspan="7" class="loading">Error al cargar empleados</td></tr>';
    }
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
        cargue_atenciones: ['ingresoInfoCarguePanel', 'ingresoInfoHistorialPanel'],
        prefacturas: ['ingresoInfoPrefacturasPanel'],
        consulta_prefacturas: ['ingresoInfoConsultaPrefacturasPanel'],
        cartera: ['ingresoInfoCarteraPanel'],
        consulta: ['ingresoInfoConsultaPanel']
    };
    const buttonMap = {
        inicio: 'ingresoInfoNavInicio',
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
            throw new Error(data.error || 'No se pudo consultar la información cargada');
        }

        const registros = Array.isArray(data.registros) ? data.registros : [];
        window.cargueAtencionesDiaState.records = registros;
        window.cargueAtencionesDiaState.page = Number(data.page || 1);
        window.cargueAtencionesDiaState.pages = Number(data.pages || 0);
        window.cargueAtencionesDiaState.total = Number(data.total || 0);

        applyCargueAtencionesDiaScopeUI(data.scope);
        updateCargueAtencionesDiaScope(data.scope);
        if (data.search_required) {
            resetConsultaAtencionesDia('Ingresa uno o varios criterios para consultar atenciones cargadas.');
            return;
        }
        resumen.textContent = data.total
            ? `${Number(data.total)} registro(s) encontrados.`
            : 'No se encontraron registros con los filtros actuales.';
        pageInfo.textContent = `Página ${Number(data.page || 0)} de ${Number(data.pages || 0)}`;
        pageInfo.textContent = `Pagina ${Number(data.page || 0)} de ${Number(data.pages || 0)}`;
        prevBtn.disabled = Number(data.page || 1) <= 1;
        nextBtn.disabled = Number(data.page || 1) >= Number(data.pages || 0) || Number(data.pages || 0) === 0;

        if (!registros.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="loading">No hay registros para mostrar.</td></tr>';
            return;
        }

        tbody.innerHTML = registros.map(item => `
            <tr>
                <td>${escapeHtml(item.fecha_creacion_orden || item.fecha_factura || 'N/A')}</td>
                <td>
                    <strong>${escapeHtml(item.cliente_nombre || item.acuerdo_comercial || 'Sin cliente relacionado')}</strong>
                    <div style="color:#666; font-size:0.85rem;">${escapeHtml(item.empresa_mision || 'Sin empresa en misión')}</div>
                </td>
                <td>
                    <strong>${escapeHtml(item.nombre_paciente || 'N/A')}</strong>
                    <div style="color:#666; font-size:0.85rem;">${escapeHtml(item.nro_identificacion || 'Sin identificación')}</div>
                </td>
                <td>
                    <strong>${escapeHtml(item.servicio || 'N/A')}</strong>
                    <div style="color:#666; font-size:0.85rem;">Orden ${escapeHtml(item.nro_orden || 'N/A')}</div>
                </td>
                <td>${formatCurrency(Number(item.precio || 0))}</td>
                <td>
                    <strong>${escapeHtml(item.vendedor_responsable || item.nombre_vendedor || 'N/A')}</strong>
                    <div style="color:#666; font-size:0.85rem;">${escapeHtml(item.usuario_creacion || 'Sin usuario origen')}</div>
                </td>
                <td>
                    <strong>${escapeHtml(item.estado_gestion || 'N/A')}</strong>
                    <div style="color:#666; font-size:0.85rem;">${escapeHtml(`Archivo: ${item.estado_orden || 'N/A'}`)}</div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error consultando atenciones cargadas:', error);
        resumen.textContent = 'No se pudo consultar la información cargada.';
        pageInfo.textContent = 'Página 0 de 0';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        tbody.innerHTML = `<tr><td colspan="7" class="loading">${escapeHtml(error.message || 'Error al consultar registros')}</td></tr>`;
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
        window.cargueAtencionesDiaState.records = registros;
        window.cargueAtencionesDiaState.page = Number(data.page || 1);
        window.cargueAtencionesDiaState.pages = Number(data.pages || 0);
        window.cargueAtencionesDiaState.total = Number(data.total || 0);

        applyCargueAtencionesDiaScopeUI(data.scope);
        updateCargueAtencionesDiaScope(data.scope);
        if (data.search_required) {
            resetConsultaAtencionesDia('Ingresa uno o varios criterios para consultar atenciones cargadas.');
            return;
        }

        resumen.textContent = data.total
            ? `${Number(data.total)} registro(s) encontrados.`
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

function renderSeguimientoAtencionesTable() {
    const tbody = document.getElementById('clienteSeguimientoAtencionesTable');
    if (!tbody) return;

    const atenciones = clienteSeguimientoContext.atenciones || [];
    if (!atenciones.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Este cliente aún no tiene atenciones registradas.</td></tr>';
        return;
    }

    tbody.innerHTML = atenciones.map(atencion => {
        const detalle = atencion.detalle_resumen || atencion.detalle_items_resumen || 'Sin detalle';
        const accion = atencion.documento_id
            ? `<button type="button" class="action-btn action-btn-edit" onclick="mostrarAgregarSeguimientoPago(${Number(atencion.documento_id)})">Registrar pago</button>`
            : '<span style="color:#64748b;">Sin acción</span>';

        return `
            <tr>
                <td>${escapeHtml(atencion.nro_atencion || 'N/A')}</td>
                <td>${escapeHtml(atencion.fecha_atencion || 'N/A')}</td>
                <td>${escapeHtml(atencion.pacientes_resumen || atencion.paciente_nombre || 'N/A')}</td>
                <td style="max-width:320px;">${escapeHtml(detalle)}</td>
                <td>${formatCurrency(atencion.valor_total || 0)}</td>
                <td>${formatCurrency(atencion.saldo_pendiente || 0)}</td>
                <td>${renderSeguimientoEstadoBadge(atencion.estado_cobro)}</td>
                <td>${accion}</td>
            </tr>
        `;
    }).join('');
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

async function mostrarAgregarAtencionCliente() {
    if (!clienteSeguimientoContext.clienteId) {
        showError('Selecciona primero un cliente comercial.');
        return;
    }

    document.getElementById('seguimientoAtencionModalTitle').textContent = 'Nueva Atención';
    document.getElementById('seguimientoAtencionForm')?.reset();
    document.getElementById('seguimientoAtencionFecha').value = getTodayIsoDate();
    clienteSeguimientoContext.draftDetalles = [];
    renderSeguimientoDraftDetalles();
    try {
        await loadSeguimientoConvenioItems(document.getElementById('seguimientoAtencionFecha').value);
    } catch (error) {
        console.error('Error cargando convenio para atención:', error);
        showError(error.message || 'No se pudieron cargar los items convenidos.');
    }
    document.getElementById('seguimientoAtencionModal')?.classList.add('active');
}

function closeSeguimientoAtencionModal() {
    document.getElementById('seguimientoAtencionModal')?.classList.remove('active');
    clienteSeguimientoContext.draftDetalles = [];
    renderSeguimientoDraftDetalles();
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

async function guardarSeguimientoAtencion(event) {
    event.preventDefault();

    const clienteId = clienteSeguimientoContext.clienteId;
    if (!clienteId) {
        showError('No hay cliente activo para registrar la atención.');
        return;
    }

    if (!(clienteSeguimientoContext.draftDetalles || []).length) {
        showError('Agrega al menos un examen o paquete antes de guardar la atención.');
        return;
    }

    try {
        const response = await fetch(`/api/comercial/clientes/${clienteId}/atenciones`, {
            method: 'POST',
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
        });
        const data = await response.json();
        if (!response.ok) {
            showError(data.error || 'No fue posible registrar la atención.');
            return;
        }

        showSuccess('Atención registrada.');
        closeSeguimientoAtencionModal();
        await cargarSeguimientoCliente(clienteId);
        setSeguimientoPanelVisible('atenciones');
    } catch (error) {
        console.error('Error guardando atención de seguimiento:', error);
        showError('Error de conexión al guardar la atención.');
    }
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
        matchFields: item => [item.nombre, item.documento, item.email, item.telefono],
        renderResult: item => ({
            title: item.nombre || 'Vendedor sin nombre',
            subtitle: [item.documento || 'Sin documento', item.email || '', item.telefono || ''].filter(Boolean).join(' · '),
            meta: `Comisión venta ${Number(item.porcentaje_comision_venta || 0).toFixed(2)}% · Comisión recaudo ${Number(item.porcentaje_comision_recaudo || 0).toFixed(2)}%`,
            estado: item.activo ? 'Activo' : 'Inactivo'
        }),
        edit: id => editarVendedorConfig(id)
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

    const items = Array.isArray(config.getItems?.()) ? config.getItems() : [];
    const filtered = items.filter(item => config.matchFields(item).some(value => String(value || '').toLowerCase().includes(normalizedQuery)));

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
        const view = config.renderResult(item);
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

function resetRecepcionConsulta() {
    recepcionClienteActivoId = null;

    const detallePanel = document.getElementById('recepcionClienteDetalle');
    const consultaPanel = document.getElementById('recepcionConsultaPanel');
    const input = document.getElementById('recepcionClientesSearch');
    const titulo = document.getElementById('recepcionClienteDetalleTitulo');
    const estadoBadge = document.getElementById('recepcionClienteEstadoBadge');
    const medioAutorizacion = document.getElementById('recepcionClienteMedioAutorizacion');
    const formaPago = document.getElementById('recepcionClienteFormaPago');
    const puntos = document.getElementById('recepcionClientePuntosAtencion');
    const contacto = document.getElementById('recepcionClienteContactoPrincipal');
    const celular = document.getElementById('recepcionClienteCelularPrincipal');
    const items = document.getElementById('recepcionClienteItems');

    if (detallePanel) detallePanel.style.display = 'none';
    if (consultaPanel) consultaPanel.style.display = 'block';
    if (input) input.value = '';
    if (titulo) titulo.textContent = 'Cliente';
    if (estadoBadge) {
        estadoBadge.textContent = 'ACTIVO';
        estadoBadge.className = 'recepcion-estado-badge recepcion-estado-activo';
    }
    if (medioAutorizacion) medioAutorizacion.textContent = 'No registrado.';
    if (formaPago) formaPago.textContent = 'No registrada.';
    if (puntos) puntos.textContent = 'Sin anotaciones especiales registradas.';
    if (contacto) contacto.textContent = 'Sin contacto registrado.';
    if (celular) celular.textContent = 'Sin celular registrado.';
    if (items) items.innerHTML = '<div class="loading">Selecciona un cliente para ver su detalle.</div>';
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

function renderRecepcionClientesResults() {
    const input = document.getElementById('recepcionClientesSearch');
    const results = document.getElementById('recepcionClientesResults');
    const summary = document.getElementById('recepcionClientesResumen');
    if (!results || !summary) return;

    const query = String(input?.value || '').trim().toLowerCase();
    const clientes = Array.isArray(clientesComercialesData) ? clientesComercialesData : [];
    const base = clientes
        .sort((a, b) => (a.razon_social || a.nombre_comercial || '').localeCompare(b.razon_social || b.nombre_comercial || ''));

    const filtered = !query
        ? base.slice(0, 30)
        : base.filter(cliente => [
            cliente.razon_social,
            cliente.nombre_comercial,
            cliente.nit,
            cliente.contacto_principal,
            cliente.contacto_facturacion,
            cliente.email_empresa,
            cliente.vendedor_nombre,
            cliente.medio_autorizacion,
            cliente.estado_cliente
        ].some(value => String(value || '').toLowerCase().includes(query)));

    if (filtered.length === 0) {
        summary.textContent = query
            ? 'No encontramos clientes con esa busqueda.'
            : 'No hay clientes comerciales disponibles.';
        results.innerHTML = '<div class="comercial-search-empty">No hay coincidencias. Prueba con otro nombre, NIT o contacto.</div>';
        return;
    }

    summary.textContent = query
        ? `${filtered.length} resultado(s). Selecciona un cliente para ver su guia de recepcion.`
        : `${base.length} cliente(s). Puedes seleccionar uno o escribir para filtrar.`;

    results.innerHTML = filtered.map(cliente => `
        <button type="button" class="comercial-search-item" onclick="abrirClienteRecepcion(${Number(cliente.id)})">
            <strong>${escapeHtml(cliente.razon_social || cliente.nombre_comercial || 'Cliente sin nombre')}</strong>
            <div class="comercial-search-subtitle">${escapeHtml([cliente.nit || 'Sin NIT', cliente.nombre_comercial || '', cliente.vendedor_nombre || ''].filter(Boolean).join(' · '))}</div>
            <div class="comercial-search-meta">${escapeHtml([formatearEstadoCliente(obtenerEstadoCliente(cliente)), formatearMedioAutorizacion(cliente.medio_autorizacion), formatearFormaPagoCliente(cliente)].filter(Boolean).join(' · '))}</div>
        </button>
    `).join('');
}

function volverConsultaRecepcion() {
    resetRecepcionConsulta();
    renderRecepcionClientesResults();
    const input = document.getElementById('recepcionClientesSearch');
    if (input) input.focus();
    window.setTimeout(() => focusModuleSection('recepcionConsultaPanel'), 120);
}

async function inicializarModuloRecepcion() {
    resetRecepcionConsulta();

    const results = document.getElementById('recepcionClientesResults');
    const summary = document.getElementById('recepcionClientesResumen');
    if (results) results.innerHTML = '<div class="loading">Cargando clientes...</div>';
    if (summary) summary.textContent = 'Cargando clientes para recepcion...';

    try {
        await Promise.all([
            asegurarClientesComerciales(),
            asegurarTarifasComerciales(),
            asegurarCatalogoComercial()
        ]);
        renderRecepcionClientesResults();
    } catch (error) {
        console.error('Error inicializando recepcion:', error);
        if (summary) summary.textContent = 'No fue posible cargar la consulta de clientes.';
        if (results) results.innerHTML = '<div class="comercial-search-empty">No fue posible cargar los clientes de recepcion.</div>';
    }
}

function setupConsultaEmpleados() {
    const searchInput = document.getElementById('consultaEmpleadoSearch');
    const estadoSelect = document.getElementById('consultaEmpleadoEstado');

    if (searchInput && !searchInput.dataset.bound) {
        searchInput.addEventListener('input', renderConsultaEmpleados);
        searchInput.dataset.bound = 'true';
    }

    if (estadoSelect && !estadoSelect.dataset.bound) {
        estadoSelect.addEventListener('change', renderConsultaEmpleados);
        estadoSelect.dataset.bound = 'true';
    }
}

function showConsultarEmpleadosModal() {
    const modal = document.getElementById('consultarEmpleadosModal');
    if (!modal) return;

    const searchInput = document.getElementById('consultaEmpleadoSearch');
    const estadoSelect = document.getElementById('consultaEmpleadoEstado');
    if (searchInput) searchInput.value = '';
    if (estadoSelect) estadoSelect.value = 'todos';

    modal.classList.add('active');
    reloadConsultaEmpleados();
}

function closeConsultarEmpleadosModal() {
    const modal = document.getElementById('consultarEmpleadosModal');
    if (modal) modal.classList.remove('active');
}

async function reloadConsultaEmpleados() {
    const tbody = document.getElementById('consultaEmpleadosTable');
    const resumen = document.getElementById('consultaEmpleadosResumen');

    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="10" class="loading">Cargando empleados...</td></tr>';
    }
    if (resumen) resumen.textContent = 'Consultando empleados activos e inactivos...';

    try {
        const response = await fetch('/api/nomina/empleados?activos=false', {
            credentials: 'include'
        });
        const empleados = await response.json();
        consultaEmpleadosData = Array.isArray(empleados) ? empleados : [];
        renderConsultaEmpleados();
    } catch (error) {
        console.error('Error consultando empleados:', error);
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="10" class="loading">Error al cargar empleados</td></tr>';
        }
        if (resumen) resumen.textContent = 'No se pudo cargar la consulta de empleados.';
    }
}

function renderConsultaEmpleados() {
    const tbody = document.getElementById('consultaEmpleadosTable');
    const resumen = document.getElementById('consultaEmpleadosResumen');
    const search = (document.getElementById('consultaEmpleadoSearch')?.value || '').trim().toLowerCase();
    const estado = document.getElementById('consultaEmpleadoEstado')?.value || 'todos';

    if (!tbody) return;

    let empleados = [...consultaEmpleadosData];
    if (estado === 'activos') {
        empleados = empleados.filter(emp => getEstadoLaboralVigente(emp) === 'ACTIVO');
    } else if (estado === 'inactivos') {
        empleados = empleados.filter(emp => getEstadoLaboralVigente(emp) !== 'ACTIVO');
    }

    if (search) {
        empleados = empleados.filter(emp => {
            const fields = [
                emp.nro_documento,
                emp.cedula,
                emp.nombre_completo,
                emp.nombres,
                emp.apellidos,
                emp.cargo,
                emp.banco
            ];
            return fields.some(value => String(value || '').toLowerCase().includes(search));
        });
    }

    const activos = empleados.filter(emp => getEstadoLaboralVigente(emp) === 'ACTIVO').length;
    const inactivos = empleados.length - activos;
    if (resumen) {
        resumen.textContent = `${empleados.length} empleados visibles · ${activos} activos · ${inactivos} inactivos`;
    }

    if (empleados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="loading">No hay empleados que coincidan con la consulta</td></tr>';
        return;
    }

    tbody.innerHTML = empleados.map(emp => `
        <tr>
            <td>${emp.nro_documento || emp.cedula || 'N/A'}</td>
            <td>${emp.nombre_completo || `${emp.nombres || ''} ${emp.apellidos || ''}`.trim() || 'N/A'}</td>
            <td>${emp.cargo || 'N/A'}</td>
            <td>${emp.forma_pago || 'N/A'}</td>
            <td>${formatCurrency(emp.sueldo_base || 0)}</td>
            <td>${emp.banco || 'N/A'}</td>
            <td>${renderEstadoLaboralBadge(getEstadoLaboralVigente(emp), emp.activo)}</td>
            <td>${emp.fecha_inicio || emp.fecha_ingreso || 'N/A'}</td>
            <td>${emp.fecha_retiro || 'N/A'}</td>
            <td>
                <button class="action-btn action-btn-edit" onclick="editEmpleadoFromConsulta(${emp.id})">Editar</button>
                ${getEstadoLaboralVigente(emp) === 'RETIRADO'
                    ? `<button class="action-btn" onclick="showReintegrarEmpleadoDesdeConsulta(${emp.id}, ${JSON.stringify(emp.nombre_completo || `${emp.nombres || ''} ${emp.apellidos || ''}`.trim())})">Reintegrar</button>`
                    : `<button class="action-btn action-btn-delete" onclick="showRetiroEmpleadoDesdeConsulta(${emp.id}, ${JSON.stringify(emp.nombre_completo || `${emp.nombres || ''} ${emp.apellidos || ''}`.trim())})">Retirar</button>`}
            </td>
        </tr>
    `).join('');
}

function editEmpleadoFromConsulta(id) {
    closeConsultarEmpleadosModal();
    editEmpleado(id);
}

function showRetiroEmpleadoDesdeConsulta(id, nombre) {
    closeConsultarEmpleadosModal();
    showRetiroEmpleadoModal(id, nombre);
}

function showReintegrarEmpleadoDesdeConsulta(id, nombre) {
    closeConsultarEmpleadosModal();
    showReintegrarEmpleadoModal(id, nombre);
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
    await Promise.all([
        loadMenuOptions(),
        loadRoles(),
        loadUsuarios()
    ]);
}

async function loadUsuarios() {
    const tableBody = document.getElementById('usuariosTable');
    if (!tableBody) return;

    try {
        const response = await fetch('/api/usuarios/', {
            credentials: 'include'
        });
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

async function loadRoles() {
    const tableBody = document.getElementById('rolesTable');
    if (!tableBody) return;

    try {
        const response = await fetch('/api/usuarios/roles', {
            credentials: 'include'
        });
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

        tableBody.innerHTML = rolesData.map(role => `
            <tr>
                <td>${escapeHtml(role.nombre || 'N/A')}</td>
                <td>${escapeHtml(role.descripcion || 'Sin descripción')}</td>
                <td>${escapeHtml((role.menu_permissions || []).map(item => item.nombre).join(', ') || 'Sin accesos')}</td>
                <td>${Number(role.cantidad_usuarios || 0)}</td>
                <td>
                    <button class="action-btn action-btn-edit" onclick="editRole(${role.id})">Editar</button>
                    ${role.nombre !== 'Administrador' ? `<button class="action-btn action-btn-delete" onclick='deleteRole(${role.id}, ${JSON.stringify(role.nombre || '')})'>Eliminar</button>` : ''}
                </td>
            </tr>
        `).join('');

        fillRoleSelect();
    } catch (error) {
        console.error('Error cargando roles:', error);
        tableBody.innerHTML = `<tr><td colspan="5" class="loading">${escapeHtml(error.message || 'Error al cargar roles')}</td></tr>`;
    }
}

async function loadMenuOptions() {
    try {
        const response = await fetch('/api/usuarios/menu-options', {
            credentials: 'include'
        });
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

function renderRoleMenuPermissions(selectedIds = []) {
    const container = document.getElementById('rolMenuPermissions');
    if (!container) return;

    if (!Array.isArray(menuOptionsData) || menuOptionsData.length === 0) {
        container.innerHTML = '<div class="loading">No fue posible cargar las opciones del menú.</div>';
        return;
    }

    const selected = new Set((selectedIds || []).map(id => String(id)));
    container.innerHTML = menuOptionsData.map(option => `
        <label class="role-menu-option">
            <input type="checkbox" value="${option.permiso_id}" ${selected.has(String(option.permiso_id)) ? 'checked' : ''}>
            <div>
                <strong>${escapeHtml(option.nombre || option.module || 'Módulo')}</strong>
                <span>${escapeHtml(option.descripcion || '')}</span>
            </div>
        </label>
    `).join('');
}

function getSelectedRolePermissionIds() {
    return Array.from(document.querySelectorAll('#rolMenuPermissions input[type="checkbox"]:checked'))
        .map(input => Number(input.value))
        .filter(value => Number.isFinite(value));
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
    if (!menuOptionsData.length) {
        await loadMenuOptions();
    }
    renderRoleMenuPermissions();
    document.getElementById('rolModal').classList.add('active');
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
    renderRoleMenuPermissions(role.menu_permission_ids || []);
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

function setupChatModule() {
    if (chatState.initialized) {
        return;
    }

    const startBtn = document.getElementById('chatStartConversationBtn');
    const messageForm = document.getElementById('chatMessageForm');
    const searchInput = document.getElementById('chatConversationSearch');
    const selectAllBtn = document.getElementById('chatSelectAllBtn');
    const clearBtn = document.getElementById('chatClearSelectionBtn');

    if (startBtn) {
        startBtn.addEventListener('click', startChatConversation);
    }

    if (messageForm) {
        messageForm.addEventListener('submit', sendChatMessage);
    }

    if (searchInput) {
        searchInput.addEventListener('input', renderChatConversationList);
    }

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => setChatRecipientSelection(true));
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => setChatRecipientSelection(false));
    }

    chatState.initialized = true;
    bindChatAudioUnlock();
}

async function initChatModule() {
    setupChatModule();
    await Promise.all([
        loadChatUsers(),
        loadChatConversations({ preserveSelection: true })
    ]);
    startChatPolling();
}

function hasChatModuleAccess() {
    const allowedModules = Array.isArray(currentUser?.menu_modules) ? currentUser.menu_modules : [];
    return currentUser?.role === 'Administrador' || allowedModules.includes('chat');
}

function isChatViewActive() {
    const chatView = document.getElementById('chatView');
    return Boolean(chatView && chatView.classList.contains('active'));
}

function bindChatAudioUnlock() {
    if (chatState.audioUnlockBound) {
        return;
    }

    const unlock = () => {
        ensureChatAudioContext();
        ensureChatDesktopNotifications();
    };

    document.addEventListener('click', unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });
    chatState.audioUnlockBound = true;
}

function supportsDesktopNotifications() {
    return typeof window !== 'undefined' && 'Notification' in window;
}

function ensureChatDesktopNotifications() {
    if (!supportsDesktopNotifications()) {
        return;
    }

    if (Notification.permission !== 'default') {
        return;
    }

    if (chatState.desktopPermissionRequested) {
        return;
    }

    chatState.desktopPermissionRequested = true;
    Notification.requestPermission().catch(error => {
        console.warn('No se pudo solicitar permiso de notificaciones para chat:', error);
    });
}

function ensureChatAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
        return null;
    }

    if (!chatState.audioContext) {
        try {
            chatState.audioContext = new AudioContextClass();
        } catch (error) {
            console.warn('No se pudo crear el contexto de audio para chat:', error);
            return null;
        }
    }

    if (chatState.audioContext.state === 'suspended') {
        chatState.audioContext.resume().catch(error => {
            console.warn('No se pudo reanudar el audio del chat:', error);
        });
    }

    return chatState.audioContext;
}

function playChatAlertTone() {
    const audioContext = ensureChatAudioContext();
    if (!audioContext || audioContext.state !== 'running') {
        return;
    }

    const notes = [
        { frequency: 784, duration: 0.18, offset: 0 },
        { frequency: 1046, duration: 0.2, offset: 0.2 },
        { frequency: 1318, duration: 0.24, offset: 0.44 },
    ];
    const startAt = audioContext.currentTime + 0.02;

    notes.forEach(note => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        const filterNode = audioContext.createBiquadFilter();

        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(note.frequency, startAt + note.offset);
        filterNode.type = 'lowpass';
        filterNode.frequency.setValueAtTime(2200, startAt + note.offset);
        gainNode.gain.setValueAtTime(0.0001, startAt + note.offset);
        gainNode.gain.exponentialRampToValueAtTime(0.24, startAt + note.offset + 0.03);
        gainNode.gain.exponentialRampToValueAtTime(0.16, startAt + note.offset + (note.duration * 0.55));
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + note.offset + note.duration);

        oscillator.connect(filterNode);
        filterNode.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start(startAt + note.offset);
        oscillator.stop(startAt + note.offset + note.duration);
    });
}

async function openChatFromNotification(conversationId) {
    if (typeof window !== 'undefined' && typeof window.focus === 'function') {
        window.focus();
    }

    switchModule('chat');
    await loadChatUsers();
    await loadChatConversations({ preserveSelection: true, silent: true });
    await openChatConversation(conversationId, { markRead: true });
}

function showDesktopChatNotification(conversation) {
    if (!supportsDesktopNotifications() || Notification.permission !== 'granted') {
        return;
    }

    const latestMessage = conversation?.ultimo_mensaje;
    if (!latestMessage) {
        return;
    }

    const remitente = latestMessage.remitente_nombre
        || latestMessage.remitente_usuario
        || conversation.display_name
        || 'Nuevo mensaje';
    const body = latestMessage.contenido || 'Tienes un mensaje nuevo en el chat interno.';
    const notification = new Notification(`Chat interno: ${remitente}`, {
        body,
        tag: `prevent-chat-${conversation.id}`,
        renotify: true,
        requireInteraction: false,
    });

    notification.onclick = () => {
        notification.close();
        openChatFromNotification(conversation.id).catch(error => {
            console.error('No se pudo abrir la conversacion desde la notificacion:', error);
        });
    };

    window.setTimeout(() => notification.close(), 12000);
}

function notifyIncomingChatMessages(previousConversations, nextConversations) {
    const previousById = new Map(
        (previousConversations || []).map(conversation => [Number(conversation.id), conversation])
    );
    const incoming = [];

    (nextConversations || []).forEach(conversation => {
        const latestMessage = conversation?.ultimo_mensaje;
        if (!latestMessage || latestMessage.remitente_id === currentUser?.usuario_id) {
            return;
        }

        const previousConversation = previousById.get(Number(conversation.id));
        const previousMessageId = Number(previousConversation?.ultimo_mensaje?.id || 0);
        const latestMessageId = Number(latestMessage.id || 0);
        const previousUnread = Number(previousConversation?.unread_count || 0);
        const nextUnread = Number(conversation.unread_count || 0);

        if (latestMessageId > previousMessageId || nextUnread > previousUnread) {
            incoming.push(conversation);
        }
    });

    if (!incoming.length) {
        return;
    }

    playChatAlertTone();

    if (incoming.length === 1) {
        const conversation = incoming[0];
        showDesktopChatNotification(conversation);
        const remitente = conversation.ultimo_mensaje?.remitente_nombre
            || conversation.ultimo_mensaje?.remitente_usuario
            || conversation.display_name
            || 'Usuario';
        showWarning(`Nuevo mensaje de chat de ${remitente}.`);
        return;
    }

    incoming.forEach(showDesktopChatNotification);
    showWarning(`Tienes ${incoming.length} conversaciones con mensajes nuevos.`);
}

function ensureChatMonitoring() {
    if (!hasChatModuleAccess()) {
        stopChatPolling();
        chatState.notificationPrimed = false;
        chatState.conversations = [];
        return;
    }

    setupChatModule();
    if (!chatState.pollHandle) {
        loadChatConversations({ preserveSelection: true, silent: true });
    }
    startChatPolling();
}

function startChatPolling() {
    stopChatPolling();
    chatState.pollHandle = window.setInterval(async () => {
        if (!hasChatModuleAccess()) {
            stopChatPolling();
            return;
        }

        if (!isChatViewActive()) {
            await loadChatConversations({ preserveSelection: true, silent: true });
            actualizarResumenPendientesCatalogo();
            return;
        }

        await loadChatConversations({ preserveSelection: true, silent: true });

        if (chatState.activeConversationId) {
            await loadChatMessages(chatState.activeConversationId, { markRead: true, silent: true });
        }
    }, 7000);
}

function stopChatPolling() {
    if (chatState.pollHandle) {
        window.clearInterval(chatState.pollHandle);
        chatState.pollHandle = null;
    }
}

function chatEscapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatChatDateTime(dateValue) {
    if (!dateValue) {
        return '';
    }

    try {
        const date = new Date(dateValue);
        return new Intl.DateTimeFormat('es-CO', {
            dateStyle: 'short',
            timeStyle: 'short'
        }).format(date);
    } catch (error) {
        return '';
    }
}

function getActiveChatConversation() {
    return chatState.conversations.find(conversation => conversation.id === chatState.activeConversationId) || null;
}

async function loadChatUsers() {
    try {
        const response = await fetch('/api/chat/usuarios', {
            credentials: 'include'
        });
        const users = await response.json();
        chatState.users = Array.isArray(users) ? users : [];
        renderChatUserOptions();
    } catch (error) {
        console.error('Error cargando usuarios para chat:', error);
        chatState.users = [];
        renderChatUserOptions();
    }
}

function renderChatUserOptions() {
    const container = document.getElementById('chatUserChecklist');
    if (!container) {
        return;
    }

    if (chatState.users.length === 0) {
        container.innerHTML = '<div class="loading">No hay otros usuarios activos para chatear.</div>';
        updateChatRecipientSummary();
        return;
    }

    const items = [];
    chatState.users.forEach(user => {
        items.push(`
            <label class="chat-user-option">
                <input type="checkbox" class="chat-user-checkbox" value="${user.id}" onchange="updateChatRecipientSummary()" />
                <div>
                    <strong>${chatEscapeHtml(user.nombre_completo || user.usuario)}</strong>
                    <span>${chatEscapeHtml(user.usuario)}${user.role ? ` · ${chatEscapeHtml(user.role)}` : ''}</span>
                </div>
            </label>
        `);
    });
    container.innerHTML = items.join('');
    updateChatRecipientSummary();
}

function getSelectedChatRecipientIds() {
    return Array.from(document.querySelectorAll('.chat-user-checkbox:checked'))
        .map(input => Number(input.value))
        .filter(value => Number.isInteger(value) && value > 0);
}

function setChatRecipientSelection(selectAll) {
    document.querySelectorAll('.chat-user-checkbox').forEach(input => {
        input.checked = selectAll;
    });
    updateChatRecipientSummary();
}

function updateChatRecipientSummary() {
    const summary = document.getElementById('chatRecipientSummary');
    if (!summary) {
        return;
    }

    const selectedCount = getSelectedChatRecipientIds().length;
    const total = chatState.users.length;
    if (selectedCount === 0) {
        summary.textContent = 'Selecciona uno o varios usuarios.';
    } else if (selectedCount === 1) {
        summary.textContent = 'Se abrira un chat directo con 1 usuario.';
    } else if (selectedCount === total && total > 1) {
        summary.textContent = `Se creara un chat general para los ${total} usuarios disponibles.`;
    } else {
        summary.textContent = `Se creara un chat grupal para ${selectedCount} usuarios.`;
    }
}

async function loadChatConversations(options = {}) {
    const {
        preserveSelection = true,
        silent = false
    } = options;

    const list = document.getElementById('chatConversationList');
    if (list && !silent && chatState.conversations.length === 0) {
        list.innerHTML = '<div class="loading">Cargando conversaciones...</div>';
    }

    try {
        const previousConversations = Array.isArray(chatState.conversations)
            ? chatState.conversations.map(conversation => ({ ...conversation }))
            : [];
        const response = await fetch('/api/chat/conversaciones', {
            credentials: 'include'
        });
        const conversations = await response.json();
        const nextConversations = Array.isArray(conversations) ? conversations : [];

        if (chatState.notificationPrimed) {
            notifyIncomingChatMessages(previousConversations, nextConversations);
        } else {
            chatState.notificationPrimed = true;
        }

        chatState.conversations = nextConversations;
        renderChatConversationList();

        const hasActive = preserveSelection && chatState.conversations.some(
            conversation => conversation.id === chatState.activeConversationId
        );

        if (!hasActive) {
            const firstConversation = chatState.conversations[0] || null;
            if (firstConversation && isChatViewActive()) {
                await openChatConversation(firstConversation.id, { markRead: false });
            } else {
                if (!firstConversation) {
                    chatState.activeConversationId = null;
                }
                if (isChatViewActive()) {
                    renderChatEmptyState();
                }
            }
        } else {
            renderChatConversationHeader(getActiveChatConversation());
        }
        actualizarResumenPendientesCatalogo();
    } catch (error) {
        console.error('Error cargando conversaciones:', error);
        if (list && !silent) {
            list.innerHTML = '<div class="loading">No fue posible cargar las conversaciones.</div>';
        }
    }
}

function renderChatConversationList() {
    const list = document.getElementById('chatConversationList');
    const searchInput = document.getElementById('chatConversationSearch');
    if (!list) {
        return;
    }

    const search = (searchInput?.value || '').trim().toLowerCase();
    const filtered = chatState.conversations.filter(conversation => {
        if (!search) {
            return true;
        }

        const candidate = [
            conversation.display_name,
            conversation.subtitle,
            conversation.ultimo_mensaje?.contenido
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        return candidate.includes(search);
    });

    if (filtered.length === 0) {
        list.innerHTML = '<div class="loading">No hay conversaciones para mostrar.</div>';
        return;
    }

    list.innerHTML = filtered.map(conversation => {
        const preview = conversation.ultimo_mensaje
            ? chatEscapeHtml(conversation.ultimo_mensaje.contenido)
            : 'Sin mensajes todavia.';
        const unreadBadge = conversation.unread_count > 0
            ? `<span class="chat-unread-badge">${conversation.unread_count}</span>`
            : '';
        const isActive = conversation.id === chatState.activeConversationId ? ' active' : '';

        return `
            <button type="button" class="chat-conversation-item${isActive}" onclick="openChatConversation(${conversation.id})">
                <div class="chat-conversation-top">
                    <span class="chat-conversation-title">${chatEscapeHtml(conversation.display_name || 'Conversacion interna')}</span>
                    <span class="chat-conversation-time">${formatChatDateTime(conversation.ultimo_mensaje?.created_at || conversation.updated_at)}</span>
                </div>
                <div class="chat-conversation-subtitle">${chatEscapeHtml(conversation.subtitle || 'Chat directo')}</div>
                <div class="chat-conversation-preview">
                    <span>${preview}</span>
                    ${unreadBadge}
                </div>
            </button>
        `;
    }).join('');
}

function renderChatEmptyState() {
    const emptyState = document.getElementById('chatEmptyState');
    const conversationPanel = document.getElementById('chatConversationPanel');
    const messages = document.getElementById('chatMessages');
    const title = document.getElementById('chatConversationTitle');
    const subtitle = document.getElementById('chatConversationSubtitle');
    const unread = document.getElementById('chatConversationUnread');
    const hiddenConversationId = document.getElementById('chatConversationId');

    if (hiddenConversationId) {
        hiddenConversationId.value = '';
    }
    if (title) {
        title.textContent = 'Conversacion';
    }
    if (subtitle) {
        subtitle.textContent = 'Sin mensajes por ahora.';
    }
    if (unread) {
        unread.style.display = 'none';
        unread.textContent = '';
    }
    if (messages) {
        messages.innerHTML = '<div class="loading">Selecciona un chat para ver los mensajes.</div>';
    }
    if (conversationPanel) {
        conversationPanel.style.display = 'none';
    }
    if (emptyState) {
        emptyState.style.display = 'flex';
    }
}

function renderChatConversationHeader(conversation) {
    const title = document.getElementById('chatConversationTitle');
    const subtitle = document.getElementById('chatConversationSubtitle');
    const unread = document.getElementById('chatConversationUnread');
    const hiddenConversationId = document.getElementById('chatConversationId');
    const emptyState = document.getElementById('chatEmptyState');
    const conversationPanel = document.getElementById('chatConversationPanel');

    if (!conversation) {
        renderChatEmptyState();
        return;
    }

    if (hiddenConversationId) {
        hiddenConversationId.value = String(conversation.id);
    }
    if (title) {
        title.textContent = conversation.display_name || 'Conversacion interna';
    }
    if (subtitle) {
        subtitle.textContent = conversation.subtitle || 'Chat directo interno';
    }
    if (unread) {
        if (conversation.unread_count > 0) {
            unread.style.display = 'inline-flex';
            unread.textContent = `${conversation.unread_count} nuevo(s)`;
        } else {
            unread.style.display = 'none';
            unread.textContent = '';
        }
    }
    if (emptyState) {
        emptyState.style.display = 'none';
    }
    if (conversationPanel) {
        conversationPanel.style.display = 'flex';
    }
}

async function startChatConversation() {
    const selectedIds = getSelectedChatRecipientIds();
    const titleInput = document.getElementById('chatGroupTitle');
    const titulo = titleInput ? titleInput.value.trim() : '';
    if (selectedIds.length === 0) {
        showError('Selecciona al menos un usuario para crear el chat.');
        return;
    }

    const totalUsers = chatState.users.length;
    const sendToAll = totalUsers > 1 && selectedIds.length === totalUsers;

    try {
        const response = await fetch('/api/chat/conversaciones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                usuarios_ids: selectedIds,
                send_to_all: sendToAll,
                titulo
            })
        });
        const data = await response.json();

        if (!response.ok) {
            showError(data.error || 'No fue posible abrir la conversacion.');
            return;
        }

        if (titleInput) {
            titleInput.value = '';
        }
        setChatRecipientSelection(false);
        showSuccess(data.creada ? 'Conversacion creada.' : 'Conversacion abierta.');
        await loadChatConversations({ preserveSelection: false });
        await openChatConversation(data.conversacion.id);
    } catch (error) {
        console.error('Error creando conversacion de chat:', error);
        showError('Error de conexion al abrir el chat.');
    }
}

async function openChatConversation(conversationId, options = {}) {
    const { markRead = true } = options;
    chatState.activeConversationId = Number(conversationId);
    renderChatConversationList();
    renderChatConversationHeader(getActiveChatConversation());
    await loadChatMessages(chatState.activeConversationId, { markRead });
}

async function loadChatMessages(conversationId, options = {}) {
    const { markRead = true, silent = false } = options;
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) {
        return;
    }

    const activeConversationId = Number(conversationId);
    if (!silent) {
        messagesContainer.innerHTML = '<div class="loading">Cargando mensajes...</div>';
    }

    try {
        const response = await fetch(`/api/chat/conversaciones/${activeConversationId}/mensajes`, {
            credentials: 'include'
        });
        const data = await response.json();

        if (!response.ok) {
            showError(data.error || 'No fue posible cargar la conversacion.');
            return;
        }

        if (chatState.activeConversationId !== activeConversationId) {
            return;
        }

        const conversation = data.conversacion || getActiveChatConversation();
        if (conversation) {
            const index = chatState.conversations.findIndex(item => item.id === conversation.id);
            if (index >= 0) {
                chatState.conversations[index] = conversation;
            }
            renderChatConversationHeader(conversation);
            renderChatConversationList();
        }

        const messages = Array.isArray(data.mensajes) ? data.mensajes : [];
        if (messages.length === 0) {
            messagesContainer.innerHTML = '<div class="loading">Todavia no hay mensajes en esta conversacion.</div>';
        } else {
            messagesContainer.innerHTML = messages.map(message => `
                <div class="chat-message ${message.es_mio ? 'mine' : 'other'}">
                    <div class="chat-message-meta">
                        ${chatEscapeHtml(message.remitente_nombre || message.remitente_usuario || 'Usuario')}
                        <span>${formatChatDateTime(message.created_at)}</span>
                    </div>
                    <div class="chat-message-bubble">${chatEscapeHtml(message.contenido)}</div>
                </div>
            `).join('');
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        if (markRead && conversation && conversation.unread_count > 0) {
            await markChatConversationRead(activeConversationId, { silent: true });
        }
        actualizarResumenPendientesCatalogo();
    } catch (error) {
        console.error('Error cargando mensajes del chat:', error);
        if (!silent) {
            messagesContainer.innerHTML = '<div class="loading">Error al cargar mensajes.</div>';
            showError('Error de conexion al cargar mensajes.');
        }
    }
}

async function markChatConversationRead(conversationId, options = {}) {
    const { silent = false } = options;

    try {
        const response = await fetch(`/api/chat/conversaciones/${conversationId}/leer`, {
            method: 'POST',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            if (!silent) {
                showError(data.error || 'No fue posible actualizar la lectura del chat.');
            }
            return;
        }

        const targetConversation = chatState.conversations.find(item => item.id === Number(conversationId));
        if (targetConversation) {
            targetConversation.unread_count = 0;
            targetConversation.ultimo_leido_at = data.ultimo_leido_at || null;
        }
        renderChatConversationHeader(getActiveChatConversation());
        renderChatConversationList();
    } catch (error) {
        console.error('Error marcando chat como leido:', error);
        if (!silent) {
            showError('Error de conexion al actualizar el chat.');
        }
    }
}

async function sendChatMessage(event) {
    event.preventDefault();

    const conversationId = Number(document.getElementById('chatConversationId')?.value || 0);
    const input = document.getElementById('chatMessageInput');
    if (!conversationId || !input) {
        showError('Selecciona una conversacion antes de enviar mensajes.');
        return;
    }

    const contenido = input.value.trim();
    if (!contenido) {
        showError('Escribe un mensaje antes de enviarlo.');
        return;
    }

    try {
        const response = await fetch(`/api/chat/conversaciones/${conversationId}/mensajes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ contenido })
        });
        const data = await response.json();

        if (!response.ok) {
            showError(data.error || 'No fue posible enviar el mensaje.');
            return;
        }

        input.value = '';
        await loadChatConversations({ preserveSelection: true, silent: true });
        await loadChatMessages(conversationId, { markRead: true, silent: true });
    } catch (error) {
        console.error('Error enviando mensaje:', error);
        showError('Error de conexion al enviar el mensaje.');
    }
}

function showNewEmpleadoForm() {
    document.getElementById('empleadoModalTitle').textContent = 'Nuevo Empleado';
    document.getElementById('empleadoForm').reset();
    document.getElementById('empleadoId').value = '';
    document.getElementById('nro_documento').readOnly = false;  // Permitir edición para nuevo empleado
    document.getElementById('planilla_afiliado').checked = true;
    document.getElementById('activo').checked = true;
    document.getElementById('forma_pago').value = 'QUINCENAL';
    
    // Set fecha_inicio to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('fecha_inicio').value = today;
    
    document.getElementById('empleadoModal').classList.add('active');
}

function closeEmpleadoModal() {
    document.getElementById('empleadoModal').classList.remove('active');
}

async function editEmpleado(id) {
    try {
        const response = await fetch(`/api/nomina/empleados/${id}`, {
            credentials: 'include'
        });
        const empleado = await response.json();
        
        if (response.ok) {
            document.getElementById('empleadoModalTitle').textContent = 'Editar Empleado';
            document.getElementById('empleadoId').value = empleado.id;
            document.getElementById('nro_documento').value = empleado.nro_documento || '';
            document.getElementById('nro_documento').readOnly = true;  // Evitar cambiar el documento
            document.getElementById('nombres').value = empleado.nombres || '';
            document.getElementById('apellidos').value = empleado.apellidos || '';
            document.getElementById('cargo').value = empleado.cargo || '';
            document.getElementById('sueldo_base').value = empleado.sueldo_base || '';
            document.getElementById('forma_pago').value = empleado.forma_pago || 'QUINCENAL';
            document.getElementById('dia_pago').value = empleado.dia_pago || '';
            document.getElementById('banco').value = empleado.banco || '';
            document.getElementById('numero_cuenta').value = empleado.numero_cuenta || '';
            document.getElementById('fecha_inicio').value = empleado.fecha_inicio ? empleado.fecha_inicio.split('T')[0] : '';
            document.getElementById('planilla_afiliado').checked = empleado.planilla_afiliado || false;
            document.getElementById('activo').checked = empleado.activo !== false;
            
            document.getElementById('empleadoModal').classList.add('active');
        } else {
            showError('Error al cargar datos del empleado');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al cargar empleado');
    }
}

function showRetiroEmpleadoModal(id, nombre) {
    document.getElementById('retiroEmpleadoId').value = id;
    document.getElementById('retiroEmpleadoNombre').value = nombre || '';
    document.getElementById('retiroMotivo').value = '';
    document.getElementById('retiroObservacion').value = '';
    document.getElementById('retiroFecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('retiroEmpleadoModal').classList.add('active');
}

function closeRetiroEmpleadoModal() {
    document.getElementById('retiroEmpleadoModal').classList.remove('active');
}

async function showReintegrarEmpleadoModal(id, nombre) {
    document.getElementById('reintegroEmpleadoId').value = id;
    document.getElementById('reintegroEmpleadoNombre').value = nombre || '';
    document.getElementById('reintegroMotivo').value = '';
    document.getElementById('reintegroObservacion').value = '';
    document.getElementById('reintegroFecha').value = new Date().toISOString().split('T')[0];
    await cargarAreasConfig();
    await cargarCargosConfig();
    fillAreasSelect('reintegroAreaId', true);
    fillCargosSelect('reintegroCargoId', true);
    document.getElementById('reintegroEmpleadoModal').classList.add('active');
}

function closeReintegroEmpleadoModal() {
    document.getElementById('reintegroEmpleadoModal').classList.remove('active');
}

async function deleteEmpleado(id, nombre) {
    if (!confirm(`¿Está seguro de eliminar al empleado ${nombre}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/nomina/empleados/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showSuccess('Empleado eliminado exitosamente');
            loadEmpleados();
        } else {
            const data = await response.json();
            showError(data.error || 'Error al eliminar empleado');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al eliminar empleado');
    }
}

// Setup Form Handlers
function setupEmpleadoForm() {
    document.getElementById('empleadoForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const empleadoId = document.getElementById('empleadoId').value;
        const url = empleadoId ? `/api/nomina/empleados/${empleadoId}` : '/api/nomina/empleados';
        const method = empleadoId ? 'PUT' : 'POST';
        
        const data = {
            nro_documento: document.getElementById('nro_documento').value,
            nombres: document.getElementById('nombres').value,
            apellidos: document.getElementById('apellidos').value,
            cargo: document.getElementById('cargo').value,
            sueldo_base: parseFloat(document.getElementById('sueldo_base').value),
            forma_pago: document.getElementById('forma_pago').value,
            dia_pago: document.getElementById('dia_pago').value ? parseInt(document.getElementById('dia_pago').value) : null,
            banco: document.getElementById('banco').value || null,
            numero_cuenta: document.getElementById('numero_cuenta').value || null,
            fecha_ingreso: document.getElementById('fecha_inicio').value,
            planilla_afiliado: document.getElementById('planilla_afiliado').checked,
            activo: document.getElementById('activo').checked
        };
        
        try {
            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (response.ok) {
                showSuccess(empleadoId ? 'Empleado actualizado exitosamente' : 'Empleado creado exitosamente');
                closeEmpleadoModal();
                loadEmpleados();
            } else {
                showError(result.error || 'Error al guardar empleado');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('Error de conexión al guardar empleado');
        }
    });
}

function setupEstructuraLaboralForms() {
    const areaForm = document.getElementById('areaForm');
    if (areaForm && !areaForm.dataset.bound) {
        areaForm.addEventListener('submit', guardarAreaConfig);
        areaForm.dataset.bound = 'true';
    }

    const cargoForm = document.getElementById('cargoForm');
    if (cargoForm && !cargoForm.dataset.bound) {
        cargoForm.addEventListener('submit', guardarCargoConfig);
        cargoForm.dataset.bound = 'true';
    }

    const asignacionForm = document.getElementById('asignacionLaboralForm');
    if (asignacionForm && !asignacionForm.dataset.bound) {
        asignacionForm.addEventListener('submit', guardarAsignacionLaboralConfig);
        asignacionForm.dataset.bound = 'true';
    }

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

    const retiroForm = document.getElementById('retiroEmpleadoForm');
    if (retiroForm && !retiroForm.dataset.bound) {
        retiroForm.addEventListener('submit', guardarRetiroEmpleado);
        retiroForm.dataset.bound = 'true';
    }

    const reintegroForm = document.getElementById('reintegroEmpleadoForm');
    if (reintegroForm && !reintegroForm.dataset.bound) {
        reintegroForm.addEventListener('submit', guardarReintegroEmpleado);
        reintegroForm.dataset.bound = 'true';
    }

    const asignacionArea = document.getElementById('asignacionAreaId');
    if (asignacionArea && !asignacionArea.dataset.bound) {
        asignacionArea.addEventListener('change', () => fillCargosSelect('asignacionCargoId', true, asignacionArea.value || null));
        asignacionArea.dataset.bound = 'true';
    }

    const reintegroArea = document.getElementById('reintegroAreaId');
    if (reintegroArea && !reintegroArea.dataset.bound) {
        reintegroArea.addEventListener('change', () => fillCargosSelect('reintegroCargoId', true, reintegroArea.value || null));
        reintegroArea.dataset.bound = 'true';
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

function fillAreasSelect(selectId, includeBlank = false) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = includeBlank ? '<option value="">Seleccione...</option>' : '';
    areasConfigData.filter(area => area.activo !== false).forEach(area => {
        const option = document.createElement('option');
        option.value = area.id;
        option.textContent = area.nombre;
        select.appendChild(option);
    });
    if (currentValue) select.value = currentValue;
}

function fillCargosSelect(selectId, includeBlank = false, areaId = null) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = includeBlank ? '<option value="">Seleccione...</option>' : '';

    cargosConfigData
        .filter(cargo => cargo.activo !== false)
        .filter(cargo => !areaId || !cargo.area_id || String(cargo.area_id) === String(areaId))
        .forEach(cargo => {
            const option = document.createElement('option');
            option.value = cargo.id;
            option.textContent = cargo.area_nombre ? `${cargo.nombre} (${cargo.area_nombre})` : cargo.nombre;
            select.appendChild(option);
        });

    if (currentValue) select.value = currentValue;
}

async function fillEmpleadosConfigSelect(selectId, includeRetired = true) {
    const select = document.getElementById(selectId);
    if (!select) return;

    try {
        const response = await fetch(`/api/nomina/empleados?activos=${includeRetired ? 'false' : 'true'}`, {
            credentials: 'include'
        });
        const empleados = await response.json();
        select.innerHTML = '<option value="">Seleccione un empleado...</option>';
        empleados.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = `${emp.nro_documento} - ${emp.nombre_completo}`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error cargando empleados para configuracion:', error);
    }
}

async function cargarAreasConfig() {
    const tbody = document.getElementById('areasTable');
    if (!tbody) return;

    try {
        const response = await fetch('/api/nomina/areas', { credentials: 'include' });
        const areas = await response.json();
        areasConfigData = Array.isArray(areas) ? areas : [];
        fillAreasSelect('cargoAreaId', true);
        fillAreasSelect('asignacionAreaId', true);
        fillAreasSelect('reintegroAreaId', true);

        if (areasConfigData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="loading">No hay areas configuradas</td></tr>';
            return;
        }

        tbody.innerHTML = areasConfigData.map(area => `
            <tr>
                <td>${escapeHtml(area.nombre)}</td>
                <td>${escapeHtml(area.descripcion || 'N/A')}</td>
                <td>${area.activo ? '<span class="badge badge-success">Activa</span>' : '<span class="badge badge-danger">Inactiva</span>'}</td>
                <td><button class="action-btn action-btn-edit" onclick="editarAreaConfig(${area.id})">Editar</button></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando areas:', error);
        tbody.innerHTML = '<tr><td colspan="4" class="loading">Error al cargar areas</td></tr>';
    }
}

async function cargarCargosConfig() {
    const tbody = document.getElementById('cargosTable');
    if (!tbody) return;

    try {
        const response = await fetch('/api/nomina/cargos', { credentials: 'include' });
        const cargos = await response.json();
        cargosConfigData = Array.isArray(cargos) ? cargos : [];
        fillCargosSelect('asignacionCargoId', true, document.getElementById('asignacionAreaId')?.value || null);
        fillCargosSelect('reintegroCargoId', true, document.getElementById('reintegroAreaId')?.value || null);

        if (cargosConfigData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="loading">No hay cargos configurados</td></tr>';
            return;
        }

        tbody.innerHTML = cargosConfigData.map(cargo => `
            <tr>
                <td>${escapeHtml(cargo.nombre)}</td>
                <td>${escapeHtml(cargo.area_nombre || 'N/A')}</td>
                <td>${escapeHtml(cargo.descripcion || 'N/A')}</td>
                <td>${cargo.activo ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-danger">Inactivo</span>'}</td>
                <td><button class="action-btn action-btn-edit" onclick="editarCargoConfig(${cargo.id})">Editar</button></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando cargos:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="loading">Error al cargar cargos</td></tr>';
    }
}

async function cargarAsignacionesLaboralesConfig() {
    const tbody = document.getElementById('asignacionesLaboralesTable');
    if (!tbody) return;

    try {
        const response = await fetch('/api/nomina/asignaciones-laborales', { credentials: 'include' });
        const asignaciones = await response.json();
        asignacionesLaboralesData = Array.isArray(asignaciones) ? asignaciones : [];
        await fillEmpleadosConfigSelect('asignacionEmpleadoId', true);

        if (asignacionesLaboralesData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="loading">No hay asignaciones laborales registradas</td></tr>';
            return;
        }

        tbody.innerHTML = asignacionesLaboralesData.map(asignacion => `
            <tr>
                <td>${escapeHtml(asignacion.empleado_nombre || 'N/A')}</td>
                <td>${escapeHtml(asignacion.area_nombre || 'N/A')}</td>
                <td>${escapeHtml(asignacion.cargo_nombre || 'N/A')}</td>
                <td>${asignacion.fecha_inicio || 'N/A'}</td>
                <td>${asignacion.fecha_fin || 'N/A'}</td>
                <td>${asignacion.activo ? '<span class="badge badge-success">Activa</span>' : '<span class="badge badge-danger">Finalizada</span>'}</td>
                <td><button class="action-btn action-btn-edit" onclick="editarAsignacionLaboral(${asignacion.id})">Editar</button></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando asignaciones laborales:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Error al cargar asignaciones laborales</td></tr>';
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
                <td><button class="action-btn action-btn-edit" onclick="editarVendedorConfig(${vendedor.id})">Editar</button></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando vendedores:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Error al cargar vendedores</td></tr>';
    }
}

async function cargarCatalogoComercialConfigLegacy() {
    const tbody = document.getElementById('comercialCatalogoTable');
    if (!tbody) return;

    try {
        const response = await fetch('/api/comercial/catalogo', { credentials: 'include' });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'No se pudo cargar el catálogo comercial');
        }

        const items = await response.json();
        catalogoComercialData = Array.isArray(items) ? items : [];

        if (catalogoComercialData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">No hay exámenes o paquetes configurados</td></tr>';
            return;
        }

        tbody.innerHTML = catalogoComercialData.map(item => `
            <tr>
                <td>
                    <strong>${escapeHtml(item.tipo_item || 'N/A')}</strong>
                    ${item.tipo_item === 'EXAMEN' ? `<div style="color:#666; font-size:0.82rem;">${escapeHtml(item.tipo_examen || 'Sin clasificar')}</div>` : ''}
                </td>
                <td>${escapeHtml(item.codigo || 'N/A')}</td>
                <td>
                    <strong>${escapeHtml(item.nombre || 'N/A')}</strong>
                    <div style="color:#666; font-size:0.85rem;">${escapeHtml(item.descripcion || '')}</div>
                    ${item.tipo_item === 'PAQUETE' ? `<div style="color:#0b5ed7; font-size:0.82rem; margin-top:4px;">Incluye ${item.cantidad_componentes || 0} examen(es): ${escapeHtml(item.resumen_componentes || 'Sin examenes definidos')}</div>` : ''}
                </td>
                <td>${formatCurrency(item.tarifa_base || 0)}</td>
                <td>${item.activo ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-danger">Inactivo</span>'}</td>
                <td><button class="action-btn action-btn-edit" onclick="editarItemCatalogoComercial(${item.id})">Editar</button></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando catálogo comercial:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Error al cargar catálogo comercial</td></tr>';
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
                <td><button class="action-btn action-btn-edit" onclick="editarTarifaCliente(${tarifa.id})">Editar</button></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando tarifas comerciales:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Error al cargar tarifas comerciales</td></tr>';
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

async function renderCatalogoComercialComponentesLegacy(selectedIds = []) {
    const container = document.getElementById('catalogoComercialComponentesList');
    if (!container) return;

    try {
        const items = await asegurarCatalogoComercial();
        const examenes = items
            .filter(item => item.tipo_item === 'EXAMEN')
            .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        const examenesDisponibles = examenes.filter(
            item => item.activo !== false && item.clasificacion_completa === true
        );
        const selectedSet = new Set((selectedIds || []).map(id => String(id)));
        const pendientes = items.filter(item => item.tipo_item === 'EXAMEN' && item.clasificacion_completa !== true);

        if (examenesDisponibles.length === 0) {
            container.innerHTML = '<div class="catalogo-componentes-empty">Todavia no hay examenes completamente clasificados para armar paquetes.</div>';
            return;
        }

        container.innerHTML = examenes.map(item => `
            <label class="catalogo-componentes-item">
                <input
                    type="checkbox"
                    class="catalogo-componente-checkbox"
                    value="${item.id}"
                    ${selectedSet.has(String(item.id)) ? 'checked' : ''}
                >
                <span>
                    <strong>${escapeHtml(item.nombre || 'N/A')}</strong>
                    <small>${escapeHtml(item.tipo_examen || 'Sin clasificar')} · ${escapeHtml(item.codigo || 'Sin codigo')}</small>
                </span>
            </label>
        `).join('');
    } catch (error) {
        console.error('Error cargando componentes del paquete:', error);
        container.innerHTML = '<div class="catalogo-componentes-empty">No fue posible cargar los examenes del catalogo.</div>';
    }
}

function actualizarVisibilidadComponentesCatalogoLegacy() {
    const tipoSelect = document.getElementById('catalogoComercialTipo');
    const tipoExamenRow = document.getElementById('catalogoComercialTipoExamenRow');
    const row = document.getElementById('catalogoComercialComponentesRow');
    const tipoExamenSelect = document.getElementById('catalogoComercialTipoExamen');
    if (!tipoSelect || !row || !tipoExamenRow || !tipoExamenSelect) return;

        const esExamen = tipoSelect.value === 'EXAMEN';
        const esPaquete = tipoSelect.value === 'PAQUETE';
        tipoExamenSelect.required = esExamen;
        tipoExamenRow.style.display = esExamen ? 'grid' : 'none';
        row.style.display = esPaquete ? 'block' : 'none';

    if (!esExamen) {
        tipoExamenSelect.value = '';
    }

    if (!esPaquete) {
        document.querySelectorAll('#catalogoComercialComponentesList .catalogo-componente-checkbox').forEach(input => {
            input.checked = false;
        });
    }
}

function obtenerComponentesSeleccionadosCatalogo() {
    return [...catalogoComercialComponentesSeleccionados];
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
                    <div>Pagaré: ${cliente.pagare_adjuntos?.length || 0}</div>
                </td>
                <td>${escapeHtml(formatearEstadoCliente(obtenerEstadoCliente(cliente)))}</td>
                <td><button class="action-btn action-btn-edit" onclick="editarClienteComercial(${cliente.id})">Editar</button></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando clientes comerciales:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Error al cargar clientes comerciales</td></tr>';
    }
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
    actualizarEstadoFacturaClienteComercial();
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
    actualizarEstadoFacturaClienteComercial();
    document.getElementById('clienteComercialModal').classList.add('active');
}

function mostrarAgregarItemCatalogoComercialLegacy() {
    const form = document.getElementById('catalogoComercialForm');
    if (!form) return;

    form.reset();
    renderCatalogoComercialComponentes();
    document.getElementById('catalogoComercialId').value = '';
    document.getElementById('catalogoComercialModalTitle').textContent = 'Nuevo Examen o Paquete';
    document.getElementById('catalogoComercialTipo').value = 'EXAMEN';
    document.getElementById('catalogoComercialTipoExamen').value = '';
    document.getElementById('catalogoComercialTarifaBase').value = '0';
    document.getElementById('catalogoComercialActivo').checked = true;
    actualizarVisibilidadComponentesCatalogo();
    document.getElementById('catalogoComercialModal').classList.add('active');
}

function closeCatalogoComercialModal() {
    document.getElementById('catalogoComercialModal').classList.remove('active');
}

async function editarItemCatalogoComercialLegacy(id) {
    const item = catalogoComercialData.find(entry => entry.id === id);
    if (!item) return;

    await renderCatalogoComercialComponentes(item.componentes_ids || []);
    document.getElementById('catalogoComercialId').value = item.id;
    document.getElementById('catalogoComercialModalTitle').textContent = item.tipo_item === 'PAQUETE'
        ? 'Editar Paquete'
        : (item.tipo_item === 'SERVICIO' ? 'Editar Registro Legado' : 'Editar Examen');
    document.getElementById('catalogoComercialTipo').value = item.tipo_item || 'EXAMEN';
    document.getElementById('catalogoComercialTipoExamen').value = item.tipo_examen || '';
    document.getElementById('catalogoComercialCodigo').value = item.codigo || '';
    document.getElementById('catalogoComercialNombre').value = item.nombre || '';
    document.getElementById('catalogoComercialNombreCorto').value = item.nombre_corto || '';
    document.getElementById('catalogoComercialTarifaBase').value = item.tarifa_base || 0;
    document.getElementById('catalogoComercialDescripcion').value = item.descripcion || '';
    document.getElementById('catalogoComercialActivo').checked = item.activo !== false;
    actualizarVisibilidadComponentesCatalogo();
    document.getElementById('catalogoComercialModal').classList.add('active');
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

function mostrarAgregarArea() {
    document.getElementById('areaForm').reset();
    document.getElementById('areaId').value = '';
    document.getElementById('areaModalTitle').textContent = 'Nueva Area';
    document.getElementById('areaActivo').checked = true;
    document.getElementById('areaModal').classList.add('active');
}

function closeAreaModal() {
    document.getElementById('areaModal').classList.remove('active');
}

function editarAreaConfig(id) {
    const area = areasConfigData.find(item => item.id === id);
    if (!area) return;
    document.getElementById('areaId').value = area.id;
    document.getElementById('areaNombre').value = area.nombre || '';
    document.getElementById('areaDescripcion').value = area.descripcion || '';
    document.getElementById('areaActivo').checked = area.activo !== false;
    document.getElementById('areaModalTitle').textContent = 'Editar Area';
    document.getElementById('areaModal').classList.add('active');
}

async function mostrarAgregarCargo() {
    document.getElementById('cargoForm').reset();
    document.getElementById('cargoConfigId').value = '';
    document.getElementById('cargoModalTitle').textContent = 'Nuevo Cargo';
    document.getElementById('cargoActivo').checked = true;
    await cargarAreasConfig();
    fillAreasSelect('cargoAreaId', true);
    document.getElementById('cargoModal').classList.add('active');
}

function closeCargoModal() {
    document.getElementById('cargoModal').classList.remove('active');
}

function editarCargoConfig(id) {
    const cargo = cargosConfigData.find(item => item.id === id);
    if (!cargo) return;
    document.getElementById('cargoConfigId').value = cargo.id;
    document.getElementById('cargoConfigNombre').value = cargo.nombre || '';
    document.getElementById('cargoDescripcion').value = cargo.descripcion || '';
    document.getElementById('cargoActivo').checked = cargo.activo !== false;
    fillAreasSelect('cargoAreaId', true);
    document.getElementById('cargoAreaId').value = cargo.area_id || '';
    document.getElementById('cargoModalTitle').textContent = 'Editar Cargo';
    document.getElementById('cargoModal').classList.add('active');
}

async function mostrarAgregarAsignacionLaboral() {
    document.getElementById('asignacionLaboralForm').reset();
    document.getElementById('asignacionLaboralId').value = '';
    document.getElementById('asignacionLaboralModalTitle').textContent = 'Nueva Asignacion Laboral';
    document.getElementById('asignacionActiva').checked = true;
    document.getElementById('asignacionFechaInicio').value = new Date().toISOString().split('T')[0];
    await cargarAreasConfig();
    await cargarCargosConfig();
    fillAreasSelect('asignacionAreaId', true);
    fillCargosSelect('asignacionCargoId', true);
    await fillEmpleadosConfigSelect('asignacionEmpleadoId', true);
    document.getElementById('asignacionLaboralModal').classList.add('active');
}

function closeAsignacionLaboralModal() {
    document.getElementById('asignacionLaboralModal').classList.remove('active');
}

function mostrarAgregarVendedor() {
    document.getElementById('vendedorForm').reset();
    document.getElementById('vendedorId').value = '';
    document.getElementById('vendedorModalTitle').textContent = 'Nuevo Vendedor';
    document.getElementById('vendedorComisionVenta').value = '0';
    document.getElementById('vendedorComisionRecaudo').value = '0';
    document.getElementById('vendedorMontoBaseComision').value = '0';
    document.getElementById('vendedorActivo').checked = true;
    document.getElementById('vendedorModal').classList.add('active');
}

function closeVendedorModal() {
    document.getElementById('vendedorModal').classList.remove('active');
}

function editarVendedorConfig(id) {
    const vendedor = vendedoresConfigData.find(item => item.id === id);
    if (!vendedor) return;

    document.getElementById('vendedorId').value = vendedor.id;
    document.getElementById('vendedorNombre').value = vendedor.nombre || '';
    document.getElementById('vendedorDocumento').value = vendedor.documento || '';
    document.getElementById('vendedorTelefono').value = vendedor.telefono || '';
    document.getElementById('vendedorEmail').value = vendedor.email || '';
    document.getElementById('vendedorComisionVenta').value = vendedor.porcentaje_comision_venta || 0;
    document.getElementById('vendedorComisionRecaudo').value = vendedor.porcentaje_comision_recaudo || 0;
    document.getElementById('vendedorMontoBaseComision').value = vendedor.monto_base_comision || 0;
    document.getElementById('vendedorDescripcion').value = vendedor.descripcion || '';
    document.getElementById('vendedorActivo').checked = vendedor.activo !== false;
    document.getElementById('vendedorModalTitle').textContent = 'Editar Vendedor';
    document.getElementById('vendedorModal').classList.add('active');
}

function editarAsignacionLaboral(id) {
    const asignacion = asignacionesLaboralesData.find(item => item.id === id);
    if (!asignacion) return;
    document.getElementById('asignacionLaboralId').value = asignacion.id;
    document.getElementById('asignacionLaboralModalTitle').textContent = 'Editar Asignacion Laboral';
    fillEmpleadosConfigSelect('asignacionEmpleadoId', true).then(() => {
        document.getElementById('asignacionEmpleadoId').value = asignacion.empleado_id || '';
    });
    fillAreasSelect('asignacionAreaId', true);
    document.getElementById('asignacionAreaId').value = asignacion.area_id || '';
    fillCargosSelect('asignacionCargoId', true, asignacion.area_id || null);
    document.getElementById('asignacionCargoId').value = asignacion.cargo_id || '';
    document.getElementById('asignacionFechaInicio').value = asignacion.fecha_inicio || '';
    document.getElementById('asignacionFechaFin').value = asignacion.fecha_fin || '';
    document.getElementById('asignacionMotivo').value = asignacion.motivo || '';
    document.getElementById('asignacionActiva').checked = asignacion.activo !== false;
    document.getElementById('asignacionLaboralModal').classList.add('active');
}

async function guardarAreaConfig(event) {
    event.preventDefault();
    const id = document.getElementById('areaId').value;
    const response = await fetch(id ? `/api/nomina/areas/${id}` : '/api/nomina/areas', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            nombre: document.getElementById('areaNombre').value.trim(),
            descripcion: document.getElementById('areaDescripcion').value.trim() || null,
            activo: document.getElementById('areaActivo').checked
        })
    });
    const data = await response.json();
    if (!response.ok) return showError(data.error || 'Error al guardar area');
    showSuccess(id ? 'Area actualizada' : 'Area creada');
    closeAreaModal();
    await cargarAreasConfig();
    await cargarCargosConfig();
}

async function guardarCargoConfig(event) {
    event.preventDefault();
    const id = document.getElementById('cargoConfigId').value;
    const response = await fetch(id ? `/api/nomina/cargos/${id}` : '/api/nomina/cargos', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            nombre: document.getElementById('cargoConfigNombre').value.trim(),
            area_id: document.getElementById('cargoAreaId').value || null,
            descripcion: document.getElementById('cargoDescripcion').value.trim() || null,
            activo: document.getElementById('cargoActivo').checked
        })
    });
    const data = await response.json();
    if (!response.ok) return showError(data.error || 'Error al guardar cargo');
    showSuccess(id ? 'Cargo actualizado' : 'Cargo creado');
    closeCargoModal();
    await cargarCargosConfig();
    await cargarAsignacionesLaboralesConfig();
}

async function guardarAsignacionLaboralConfig(event) {
    event.preventDefault();
    const id = document.getElementById('asignacionLaboralId').value;
    const response = await fetch(id ? `/api/nomina/asignaciones-laborales/${id}` : '/api/nomina/asignaciones-laborales', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            empleado_id: document.getElementById('asignacionEmpleadoId').value || null,
            area_id: document.getElementById('asignacionAreaId').value || null,
            cargo_id: document.getElementById('asignacionCargoId').value || null,
            fecha_inicio: document.getElementById('asignacionFechaInicio').value,
            fecha_fin: document.getElementById('asignacionFechaFin').value || null,
            motivo: document.getElementById('asignacionMotivo').value.trim() || null,
            activo: document.getElementById('asignacionActiva').checked
        })
    });
    const data = await response.json();
    if (!response.ok) return showError(data.error || 'Error al guardar asignacion laboral');
    showSuccess(id ? 'Asignacion laboral actualizada' : 'Asignacion laboral creada');
    closeAsignacionLaboralModal();
    await cargarAsignacionesLaboralesConfig();
    await loadEmpleados();
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
                documento: document.getElementById('vendedorDocumento').value.trim() || null,
                telefono: document.getElementById('vendedorTelefono').value.trim() || null,
                email: document.getElementById('vendedorEmail').value.trim() || null,
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
    formData.append('documentos_legales_detalle', document.getElementById('clienteComercialDocumentosDetalle').value.trim());
    formData.append('pagare_firmado', document.getElementById('clienteComercialPagareFirmado').checked ? 'true' : 'false');
    formData.append('pagare_detalle', document.getElementById('clienteComercialPagareDetalle').value.trim());
    formData.append('observaciones', document.getElementById('clienteComercialObservaciones').value.trim());

    Array.from(document.getElementById('clienteComercialDocumentosAdjuntos').files || []).forEach(file => {
        formData.append('documentos_legales_adjuntos', file);
    });
    Array.from(document.getElementById('clienteComercialPagareAdjuntos').files || []).forEach(file => {
        formData.append('pagare_adjuntos', file);
    });

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
            showSuccess('Cliente comercial creado. Ya puedes asignar tarifas.');
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

async function guardarCatalogoComercialConfigLegacy(event) {
    event.preventDefault();
    const id = document.getElementById('catalogoComercialId').value;
    const tipoItem = document.getElementById('catalogoComercialTipo').value;
    const tipoExamen = document.getElementById('catalogoComercialTipoExamen').value;
    const tarifaBase = parseFloat(document.getElementById('catalogoComercialTarifaBase').value || '0');
    const componentesIds = obtenerComponentesSeleccionadosCatalogo();

    if (Number.isNaN(tarifaBase) || tarifaBase < 0) {
        return showError('La tarifa base no puede ser negativa.');
    }

    if (tipoItem === 'PAQUETE' && componentesIds.length === 0) {
        return showError('Selecciona al menos un examen para armar el paquete.');
    }

    if (tipoItem === 'EXAMEN' && !tipoExamen) {
        return showError('Selecciona el tipo de examen: CONSULTA, LABORATORIO, PARACLINICO, ECOBABY o CURSOS.');
    }

    try {
        const response = await fetch(id ? `/api/comercial/catalogo/${id}` : '/api/comercial/catalogo', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                tipo_item: tipoItem,
                tipo_examen: tipoItem === 'EXAMEN' ? tipoExamen : null,
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
    } catch (error) {
        console.error('Error guardando item comercial:', error);
        showError('Error de conexión al guardar item comercial');
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

        tbody.innerHTML = catalogoComercialData.map(item => `
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
                <td><button class="action-btn action-btn-edit" onclick="editarItemCatalogoComercial(${item.id})">Editar</button></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando catalogo comercial:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Error al cargar catalogo comercial</td></tr>';
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

function renderSeguimientoAtencionesTable() {
    const tbody = document.getElementById('clienteSeguimientoAtencionesTable');
    if (!tbody) return;

    const atenciones = clienteSeguimientoContext.atenciones || [];
    if (!atenciones.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Este cliente aÃºn no tiene atenciones registradas.</td></tr>';
        return;
    }

    tbody.innerHTML = atenciones.map(atencion => {
        const detalle = atencion.detalle_resumen || atencion.detalle_items_resumen || 'Sin detalle';
        const acciones = [];
        if (atencion.documento_id) {
            acciones.push(`<button type="button" class="action-btn action-btn-edit" onclick="mostrarAgregarSeguimientoPago(${Number(atencion.documento_id)})">Registrar pago</button>`);
        }
        acciones.push(`<button type="button" class="action-btn action-btn-edit" onclick="editarSeguimientoAtencion(${Number(atencion.id)})">Editar</button>`);
        acciones.push(`<button type="button" class="action-btn action-btn-delete" onclick="eliminarSeguimientoAtencion(${Number(atencion.id)})">Eliminar</button>`);

        return `
            <tr>
                <td>${escapeHtml(atencion.nro_atencion || 'N/A')}</td>
                <td>${escapeHtml(atencion.fecha_atencion || 'N/A')}</td>
                <td>${escapeHtml(atencion.pacientes_resumen || atencion.paciente_nombre || 'N/A')}</td>
                <td style="max-width:320px;">${escapeHtml(detalle)}</td>
                <td>${formatCurrency(atencion.valor_total || 0)}</td>
                <td>${formatCurrency(atencion.saldo_pendiente || 0)}</td>
                <td>${renderSeguimientoEstadoBadge(atencion.estado_cobro)}</td>
                <td style="display:flex; gap:6px; flex-wrap:wrap;">${acciones.join('')}</td>
            </tr>
        `;
    }).join('');
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
        await Promise.all([
            cargarVendedoresConfig(),
            cargarClientesComercialesConfig(),
            loadComercialDashboard()
        ]);
    } catch (error) {
        console.error('Error eliminando vendedor:', error);
        showError('Error de conexiÃ³n al eliminar el vendedor.');
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
                <td style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button class="action-btn action-btn-edit" onclick="editarVendedorConfig(${vendedor.id})">Editar</button>
                    <button class="action-btn action-btn-delete" onclick="eliminarVendedorConfig(${vendedor.id})">Eliminar</button>
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
                <td style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button class="action-btn action-btn-edit" onclick="editarTarifaCliente(${tarifa.id})">Editar</button>
                    <button class="action-btn action-btn-delete" onclick="eliminarTarifaComercialConfig(${tarifa.id})">Eliminar</button>
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

        tbody.innerHTML = catalogoComercialData.map(item => `
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
                <td style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button class="action-btn action-btn-edit" onclick="editarItemCatalogoComercial(${item.id})">Editar</button>
                    <button class="action-btn action-btn-delete" onclick="eliminarItemCatalogoComercial(${item.id})">Eliminar</button>
                </td>
            </tr>
        `).join('');
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
                    <div>PagarÃ©: ${cliente.pagare_adjuntos?.length || 0}</div>
                </td>
                <td>${escapeHtml(formatearEstadoCliente(obtenerEstadoCliente(cliente)))}</td>
                <td style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button class="action-btn action-btn-edit" onclick="editarClienteComercial(${cliente.id})">Editar</button>
                    <button class="action-btn action-btn-delete" onclick="eliminarClienteComercialConfig(${cliente.id})">Eliminar</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando clientes comerciales:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Error al cargar clientes comerciales</td></tr>';
    }
}

async function guardarRetiroEmpleado(event) {
    event.preventDefault();
    const empleadoId = document.getElementById('retiroEmpleadoId').value;
    const response = await fetch(`/api/nomina/empleados/${empleadoId}/retirar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            fecha_retiro: document.getElementById('retiroFecha').value,
            motivo: document.getElementById('retiroMotivo').value.trim(),
            observacion: document.getElementById('retiroObservacion').value.trim() || null
        })
    });
    const data = await response.json();
    if (!response.ok) return showError(data.error || 'Error al retirar empleado');
    showSuccess('Empleado retirado correctamente');
    closeRetiroEmpleadoModal();
    await loadEmpleados();
    await reloadConsultaEmpleados();
    await cargarAsignacionesLaboralesConfig();
}

async function guardarReintegroEmpleado(event) {
    event.preventDefault();
    const empleadoId = document.getElementById('reintegroEmpleadoId').value;
    const response = await fetch(`/api/nomina/empleados/${empleadoId}/reintegrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            fecha_reintegro: document.getElementById('reintegroFecha').value,
            motivo: document.getElementById('reintegroMotivo').value.trim(),
            observacion: document.getElementById('reintegroObservacion').value.trim() || null,
            area_id: document.getElementById('reintegroAreaId').value || null,
            cargo_id: document.getElementById('reintegroCargoId').value || null
        })
    });
    const data = await response.json();
    if (!response.ok) return showError(data.error || 'Error al reintegrar empleado');
    showSuccess('Empleado reintegrado correctamente');
    closeReintegroEmpleadoModal();
    await loadEmpleados();
    await reloadConsultaEmpleados();
    await cargarAsignacionesLaboralesConfig();
}

async function showNewNovedadForm() {
    const form = document.getElementById('novedadForm');
    if (form) {
        form.reset();
    }
    document.getElementById('novedadDynamicFields').innerHTML = '';

    // Cargar empleados y tipos de novedad antes de mostrar el modal
    await loadEmpleadosSelect();
    await loadTiposNovedadSelect();

    document.getElementById('novedadModal').classList.add('active');
}

function closeNovedadModal() {
    document.getElementById('novedadModal').classList.remove('active');
}

function setupNovedadForm() {
    document.getElementById('novedadForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const tipoSelect = document.getElementById('tipo_novedad_id');
        const selectedOption = tipoSelect && tipoSelect.selectedIndex >= 0
            ? tipoSelect.options[tipoSelect.selectedIndex]
            : null;

        if (!selectedOption || !tipoSelect.value) {
            showError('Debe seleccionar la clase de novedad.');
            return;
        }

        const categoria = selectedOption.getAttribute('data-categoria');
        
        const data = {
            empleado_id: parseInt(document.getElementById('novedad_empleado_id').value),
            tipo_novedad_id: parseInt(tipoSelect.value),
            descripcion: document.getElementById('descripcion_novedad').value
        };

        if (!data.empleado_id || Number.isNaN(data.empleado_id)) {
            showError('Debe seleccionar un empleado.');
            return;
        }
        
        // Agregar campos según la categoría
        if (categoria === 'ANTICIPO') {
            data.valor = parseFloat(document.getElementById('valor_anticipo').value);
            data.fecha_novedad = document.getElementById('fecha_novedad_anticipo').value;
        } else if (categoria === 'PRESTAMO') {
            data.valor = parseFloat(document.getElementById('valor_prestamo').value);
            data.numero_cuotas = parseInt(document.getElementById('numero_cuotas').value);
            
            // Construir fecha de quincena_inicio_descuento a partir de mes + quincena
            const mes = parseInt(document.getElementById('mes_inicio_descuento').value);
            const quincena = parseInt(document.getElementById('quincena_inicio_descuento').value);
            const anio = new Date().getFullYear();
            
            // Si es quincena 1: día 1, si es quincena 2: día 16
            const dia = quincena === 1 ? 1 : 16;
            const fechaStr = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
            data.quincena_inicio_descuento = fechaStr;
            
            data.fecha_novedad = document.getElementById('fecha_novedad_prestamo').value;
        } else if (categoria === 'INGRESO_EXTRA') {
            data.valor = parseFloat(document.getElementById('valor_ingreso_extra').value);
            data.autorizado_por = document.getElementById('autorizado_por').value;
            data.fecha_novedad = document.getElementById('fecha_novedad_ingreso').value;
        } else if (categoria === 'INCAPACIDAD' || categoria === 'LICENCIA') {
            data.valor = parseFloat(document.getElementById('valor_dias').value);
            data.autorizado_por = document.getElementById('autorizado_por_dias').value;
            data.fecha_novedad = document.getElementById('fecha_novedad_dias').value;
        } else {
            const valorInput = document.getElementById('valor_novedad');
            const fechaInput = document.getElementById('fecha_novedad_generica');

            if (!valorInput || !valorInput.value) {
                showError('Debe ingresar el valor de la novedad.');
                return;
            }

            data.valor = parseFloat(valorInput.value);
            if (fechaInput && fechaInput.value) {
                data.fecha_novedad = fechaInput.value;
            }
        }
        
        try {
            const response = await fetch('/api/nomina/novedades', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (response.ok) {
                showSuccess('Novedad registrada exitosamente');
                closeNovedadModal();
            } else {
                showError(result.error || 'Error al registrar novedad');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('Error de conexión al registrar novedad');
        }
    });
}

function updateNovedadFields() {
    const tipoSelect = document.getElementById('tipo_novedad_id');
    if (!tipoSelect || tipoSelect.selectedIndex < 0) {
        return;
    }

    const selectedOption = tipoSelect.options[tipoSelect.selectedIndex];
    const categoria = selectedOption.getAttribute('data-categoria');
    const fieldsContainer = document.getElementById('novedadDynamicFields');
    
    let html = '';
    
    if (categoria === 'ANTICIPO') {
        html = `
            <div class="form-row">
                <div class="form-group">
                    <label for="valor_anticipo">Valor Anticipo *</label>
                    <input type="number" id="valor_anticipo" step="0.01" required>
                </div>
                <div class="form-group">
                    <label for="fecha_novedad_anticipo">Fecha de Novedad *</label>
                    <input type="date" id="fecha_novedad_anticipo" required>
                </div>
            </div>
        `;
    } else if (categoria === 'PRESTAMO') {
        html = `
            <div class="form-row">
                <div class="form-group">
                    <label for="valor_prestamo">Valor Préstamo *</label>
                    <input type="number" id="valor_prestamo" step="0.01" required>
                </div>
                <div class="form-group">
                    <label for="numero_cuotas">Número de Cuotas *</label>
                    <input type="number" id="numero_cuotas" required>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="mes_inicio_descuento">Mes de Inicio Descuento *</label>
                    <select id="mes_inicio_descuento" required>
                        <option value="">Seleccione mes...</option>
                        <option value="1">Enero</option>
                        <option value="2">Febrero</option>
                        <option value="3">Marzo</option>
                        <option value="4">Abril</option>
                        <option value="5">Mayo</option>
                        <option value="6">Junio</option>
                        <option value="7">Julio</option>
                        <option value="8">Agosto</option>
                        <option value="9">Septiembre</option>
                        <option value="10">Octubre</option>
                        <option value="11">Noviembre</option>
                        <option value="12">Diciembre</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="quincena_inicio_descuento">Quincena de Inicio *</label>
                    <select id="quincena_inicio_descuento" required>
                        <option value="">Seleccione quincena...</option>
                        <option value="1">1ª Quincena (1-15)</option>
                        <option value="2">2ª Quincena (16-fin de mes)</option>
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="fecha_novedad_prestamo">Fecha de Novedad *</label>
                    <input type="date" id="fecha_novedad_prestamo" required>
                </div>
            </div>
        `;
    } else if (categoria === 'INGRESO_EXTRA') {
        html = `
            <div class="form-row">
                <div class="form-group">
                    <label for="valor_ingreso_extra">Valor *</label>
                    <input type="number" id="valor_ingreso_extra" step="0.01" required>
                </div>
                <div class="form-group">
                    <label for="autorizado_por">Autorizado Por *</label>
                    <input type="text" id="autorizado_por" required>
                </div>
            </div>
            <div class="form-group">
                <label for="fecha_novedad_ingreso">Fecha de Novedad *</label>
                <input type="date" id="fecha_novedad_ingreso" required>
            </div>
        `;
    } else if (categoria === 'INCAPACIDAD' || categoria === 'LICENCIA') {
        html = `
            <div class="form-row">
                <div class="form-group">
                    <label for="valor_dias">Número de Días *</label>
                    <input type="number" id="valor_dias" required>
                </div>
                <div class="form-group">
                    <label for="autorizado_por_dias">Autorizado Por *</label>
                    <input type="text" id="autorizado_por_dias" required>
                </div>
            </div>
            <div class="form-group">
                <label for="fecha_novedad_dias">Fecha de Novedad *</label>
                <input type="date" id="fecha_novedad_dias" required>
            </div>
        `;
    } else {
        // Caso genérico para nuevas categorías / tipos estructurales o recurrentes
        html = `
            <div class="form-row">
                <div class="form-group">
                    <label for="valor_novedad">Valor *</label>
                    <input type="number" id="valor_novedad" step="0.01" required>
                </div>
                <div class="form-group">
                    <label for="fecha_novedad_generica">Fecha de Novedad *</label>
                    <input type="date" id="fecha_novedad_generica" required>
                </div>
            </div>
        `;
    }
    
    fieldsContainer.innerHTML = html;
}

async function loadEmpleadosSelect() {
    try {
        const select = document.getElementById('novedad_empleado_id');
        if (!select) return;

        select.innerHTML = '<option value="">Seleccione un empleado...</option>';

        // Si estamos trabajando sobre una quincena y ya existe una pre-liquidación
        // para ese mismo período, limitar el listado a los empleados que salen
        // en esa quincena (según ultimaLiquidacionData).
        if (
            nominaPeriodoSeleccionado &&
            ultimaLiquidacionData &&
            ultimaLiquidacionData.mes === nominaPeriodoSeleccionado.mes &&
            ultimaLiquidacionData.numero_quincena === nominaPeriodoSeleccionado.numero_quincena &&
            ultimaLiquidacionData.anio === nominaPeriodoSeleccionado.anio &&
            Array.isArray(ultimaLiquidacionData.liquidaciones)
        ) {
            const empleadosQuincena = [...ultimaLiquidacionData.liquidaciones]
                .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

            empleadosQuincena.forEach(emp => {
                const option = document.createElement('option');
                option.value = emp.empleado_id;
                option.textContent = `${emp.nro_documento} - ${emp.nombre}`;
                select.appendChild(option);
            });

            // Si no hay empleados en la quincena, se puede seguir al fallback
            if (empleadosQuincena.length > 0) {
                return;
            }
        }

        // Fallback: catálogo completo de empleados activos
        const response = await fetch('/api/nomina/empleados', {
            credentials: 'include'
        });
        const empleados = await response.json();

        empleados.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = `${emp.nro_documento} - ${emp.nombres} ${emp.apellidos}`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error cargando empleados:', error);
    }
}

// Cache en memoria de tipos de novedad para evitar múltiples llamadas
let tiposNovedadCache = [];

async function loadTiposNovedadSelect() {
    try {
        const response = await fetch('/api/nomina/tipos-novedad', {
            credentials: 'include'
        });
        const tipos = await response.json();

        tiposNovedadCache = Array.isArray(tipos) ? tipos : [];

        const claseSelect = document.getElementById('tipo_novedad_id');
        if (!claseSelect) {
            return;
        }

        // Poblar directamente las clases de novedad activas
        populateClaseNovedadOptions();
    } catch (error) {
        console.error('Error cargando tipos de novedad:', error);
    }
}

function populateClaseNovedadOptions() {
    const claseSelect = document.getElementById('tipo_novedad_id');
    if (!claseSelect) {
        return;
    }
    claseSelect.innerHTML = '<option value="">Seleccione tipo...</option>';

    const filtrados = tiposNovedadCache.filter(t => t.activo !== false);

    filtrados.forEach(tipo => {
        const option = document.createElement('option');
        option.value = tipo.id;
        option.setAttribute('data-categoria', tipo.categoria);
        option.textContent = `${tipo.nombre} (${tipo.tipo_movimiento})`;
        claseSelect.appendChild(option);
    });

    // Si no hay clases para el tipo funcional elegido, limpiar campos dinámicos
    if (filtrados.length === 0) {
        document.getElementById('novedadDynamicFields').innerHTML = '';
    } else {
        // Seleccionar la primera opción por defecto y actualizar los campos dinámicos
        claseSelect.selectedIndex = 0;
        updateNovedadFields();
    }
}

function setupNovedadesFiltro() {
    const mesSelect = document.getElementById('novedades_mes');
    const quincenaSelect = document.getElementById('novedades_quincena');

    if (mesSelect && quincenaSelect) {
        // Si ya hay un período de nómina seleccionado, usarlo como valor por defecto
        if (nominaPeriodoSeleccionado) {
            mesSelect.value = String(nominaPeriodoSeleccionado.mes);
            quincenaSelect.value = String(nominaPeriodoSeleccionado.numero_quincena);
        } else {
            const now = new Date();
            mesSelect.value = String(now.getMonth() + 1);
        }
    }
}

// NOTA: La función loadNovedadesPeriodo se define más abajo en la sección
// "GESTIÓN DE NOVEDADES". Esta definición anterior se eliminó para evitar
// duplicados y utilizar siempre la versión que respeta nominaPeriodoSeleccionado.

// ==================== LIQUIDACION DE QUINCENA ====================

let ultimaLiquidacionData = null;

function showLiquidacionForm() {
    const mesField = document.getElementById('mes_liquidacion');
    const qField = document.getElementById('quincena_liquidacion');

    if (nominaPeriodoSeleccionado) {
        mesField.value = String(nominaPeriodoSeleccionado.mes);
        qField.value = String(nominaPeriodoSeleccionado.numero_quincena);
    } else {
        mesField.value = '';
        qField.value = '';
    }

    mesField.disabled = false;
    qField.disabled = false;
    document.getElementById('liquidacionModal').classList.add('active');
    verificarQuincenasPendientes();
    // Si no hay período seleccionado, seguimos usando la sugerencia del backend
    if (!nominaPeriodoSeleccionado) {
        cargarQuincenaSugerida();
    }
}

async function cargarQuincenaSugerida() {
    try {
        const response = await fetch('/api/nomina/quincenas/actual', {
            credentials: 'include'
        });
        const data = await response.json();

        if (data.existe) {
            document.getElementById('mes_liquidacion').value = data.mes || '';
            document.getElementById('quincena_liquidacion').value = data.numero_quincena || '';

            if (data.modo === 'en_proceso') {
                document.getElementById('mes_liquidacion').disabled = true;
                document.getElementById('quincena_liquidacion').disabled = true;
            }
        }
    } catch (error) {
        console.error('Error obteniendo quincena sugerida:', error);
    }
}

async function verificarQuincenasPendientes() {
    try {
        // Consultar TODAS las quincenas que aún no han sido finalizadas,
        // sin limitar por mes/año actual. Esto evita que quincenas antiguas
        // bloqueen el flujo sin ofrecer opción para retomarlas.
        const response = await fetch('/api/nomina/liquidaciones/pendientes', {
            credentials: 'include'
        });
        
        const liquidaciones = await response.json();
        
        if (liquidaciones.length > 0) {
            const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                           'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
            const quincenas_no_pagadas = {};
            
            liquidaciones.forEach(liq => {
                const key = liq.mes + '/' + liq.numero_quincena + '/' + liq.anio;
                if (!quincenas_no_pagadas[key]) {
                    quincenas_no_pagadas[key] = {
                        mes: liq.mes,
                        numero_quincena: liq.numero_quincena,
                        anio: liq.anio,
                        count: 0
                    };
                }
                quincenas_no_pagadas[key].count++;
            });
            
            if (Object.keys(quincenas_no_pagadas).length > 0) {
                const texto = Object.values(quincenas_no_pagadas)
                    .map(q => meses[q.mes] + ' Q' + q.numero_quincena + '/' + q.anio + ' - ' + q.count + ' empleado(s)')
                    .join(', ');
                
                document.getElementById('quincenasPendientesText').innerHTML = 
                    '<strong>Quincenas:</strong> ' + texto + '<br>⚠️ Debe finalizar estos pagos antes de liquidar la siguiente quincena';
                document.getElementById('quincenasPendientesAlert').style.display = 'block';
            } else {
                document.getElementById('quincenasPendientesAlert').style.display = 'none';
            }
        } else {
            document.getElementById('quincenasPendientesAlert').style.display = 'none';
        }
    } catch (error) {
        console.error('Error verificando quincenas pendientes:', error);
    }
}

async function retomarPagosGuardados() {
    try {
        // Obtener TODAS las quincenas con pagos no finalizados
        const response = await fetch('/api/nomina/liquidaciones/pendientes', {
            credentials: 'include'
        });
        
        const liquidaciones = await response.json();
        
        if (liquidaciones.length === 0) {
            showError('No hay quincenas con pagos pendientes para retomar');
            closeLiquidacionModal();
            return;
        }
        
        // Obtener la quincena más reciente (mayor año/mes/número) con pagos pendientes
        const ordenadas = [...liquidaciones].sort((a, b) => {
            if (a.anio !== b.anio) return a.anio - b.anio;
            if (a.mes !== b.mes) return a.mes - b.mes;
            return a.numero_quincena - b.numero_quincena;
        });

        const quincena_pendiente = ordenadas[ordenadas.length - 1];
        const mes_retomar = quincena_pendiente.mes;
        const numero_quincena_retomar = quincena_pendiente.numero_quincena;
        const anio_retomar = quincena_pendiente.anio;
        
        // Guardar datos para mostrar pagos
        ultimaLiquidacionData = {
            mes: mes_retomar,
            numero_quincena: numero_quincena_retomar,
            anio: anio_retomar
        };
        
        closeLiquidacionModal();
        
        // Cargar la sección de pagos con la quincena pendiente
        await mostrarSeccionPagosRetomar(mes_retomar, numero_quincena_retomar, anio_retomar);
        
    } catch (error) {
        console.error('Error retomando pagos:', error);
        showError('Error al retomar pagos');
    }
}

async function mostrarSeccionPagosRetomar(mes, numero_quincena, anio) {
    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const quincena_text = numero_quincena === 1 ? '1ª' : '2ª';
    
    document.getElementById('pagoQuincenaTitulo').textContent = 
        `${meses[mes]} ${anio} - ${quincena_text} Quincena`;
    
    try {
        // Cargar liquidaciones de esa quincena específica
        const response = await fetch(`/api/nomina/liquidaciones/pendientes?mes=${mes}&numero_quincena=${numero_quincena}&anio=${anio}`, {
            credentials: 'include'
        });
        
        const liquidaciones = await response.json();
        
        if (!response.ok) {
            showError(liquidaciones.error || 'Error al cargar liquidaciones');
            return;
        }
        
        // Obtener información de pagos ya realizados
        const pagosResponse = await fetch(`/api/nomina/pagos?mes=${mes}&numero_quincena=${numero_quincena}&anio=${anio}`, {
            credentials: 'include'
        });
        
        const pagos_realizados = pagosResponse.ok ? (await pagosResponse.json()) : [];
        
        // Crear mapa de pagos por liquido_id
        const pagos_map = {};
        pagos_realizados.forEach(p => {
            if (!pagos_map[p.liquido_quincena_id]) {
                pagos_map[p.liquido_quincena_id] = [];
            }
            pagos_map[p.liquido_quincena_id].push(p);
        });
        
        // Cargar info de empleados
        const empResponse = await fetch('/api/nomina/empleados', { credentials: 'include' });
        const empleados = await empResponse.json();
        const empMap = {};
        empleados.forEach(e => empMap[e.id] = e);
        
        const tbody = document.getElementById('tablaPagosLiquidacion');
        tbody.innerHTML = '';
        
        liquidaciones.forEach(liq => {
            const emp = empMap[liq.empleado_id] || {};
            const saldoPendiente = Math.max(0, (liq.total_a_pagar || 0) - (liq.pagada ? liq.total_a_pagar : 0));
            const estaPagado = liq.pagada || (liq.saldo_pendiente === 0 || liq.saldo_pendiente === '0');
            const esParcial = !estaPagado && liq.saldo_pendiente > 0 && Number(liq.saldo_pendiente) < Number(liq.total_a_pagar);
            
            // Obtener pagos de este empleado en esta quincena
            const pagos_empleado = pagos_map[liq.liquido_id] || [];
            const pagos_info = pagos_empleado.length > 0 
                ? pagos_empleado.map(p => `${p.forma_pago}: $${formatCurrency(p.valor_pagado)}`).join(', ')
                : 'Sin pagar';
            
            // Determinar estado visual
            let estadoHTML = '';
            if (estaPagado) {
                estadoHTML = '<span style="background: #4caf50; color: white; padding: 3px 8px; border-radius: 3px; font-weight: bold;">✅ PAGADO</span>';
            } else if (esParcial) {
                estadoHTML = '<span style="background: #ff9800; color: white; padding: 3px 8px; border-radius: 3px; font-weight: bold;">⚠️ PARCIAL</span>';
            } else {
                estadoHTML = '<span style="background: #f44336; color: white; padding: 3px 8px; border-radius: 3px; font-weight: bold;">⏳ PENDIENTE</span>';
            }
            
            const row = document.createElement('tr');
            row.style.backgroundColor = estaPagado ? '#f1f8e9' : (esParcial ? '#fff3e0' : '');
            row.innerHTML = `
                <td><input type="checkbox" class="pago-liq-checkbox" data-liquido-id="${liq.liquido_id}" data-valor="${liq.total_a_pagar}" ${estaPagado ? 'disabled' : 'checked'}></td>
                <td>${liq.empleado_nombre}</td>
                <td style="color: #f44336;">$${formatCurrency(liq.saldo_anterior || 0)}</td>
                <td style="color: #4caf50;">$${formatCurrency(liq.total_ingresos)}</td>
                <td style="color: #ff9800;">$${formatCurrency(liq.total_deducciones)}</td>
                <td style="font-weight: bold; color: #2196F3;">$${formatCurrency(liq.total_a_pagar)}</td>
                <td>${estadoHTML}</td>
                <td>${liq.banco || '-'}${liq.numero_cuenta ? ' / ' + liq.numero_cuenta : ''}</td>
                <td style="font-size: 0.85rem;">${pagos_info}</td>
                <td>
                    <div style="display:flex;gap:6px;align-items:center;">
                        <button class="btn btn-sm btn-info" onclick="verPagosDetalle(${liq.liquido_id}, ${liq.empleado_id})">🔍 Ver pagos</button>
                        ${!estaPagado ? `<button class="btn btn-sm btn-primary" onclick='abrirModalPagoIndividual(${JSON.stringify(liq)}, ${JSON.stringify(emp)})'>💸 Pagar</button>` : '<span style="color: #999;">Pagado</span>'}
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
        
        // Actualizar estado del workflow
        const pagados = liquidaciones.filter(l => l.pagada || l.saldo_pendiente === 0 || l.saldo_pendiente === '0').length;
        const pendientes = liquidaciones.filter(l => !l.pagada && l.saldo_pendiente > 0).length;
        const total = liquidaciones.length;
        
        const workflowAlert = document.getElementById('workflowAlert');
        const workflowStatus = document.getElementById('workflowStatus');
        if (pendientes > 0 || pagados > 0) {
            workflowStatus.innerHTML = `
                <strong>Progreso de Pago (Reanudado):</strong> ${pagados} pagado(s) ✅ / ${pendientes} pendiente(s) ⏳ (Total: ${total})
            `;
            workflowAlert.style.display = 'block';
        }
        
        // El botón FINALIZAR siempre debe estar disponible
        // (Puede finalizar aunque queden empleados sin pagar - pasarán a siguiente quincena)
        const btnFinalizar = document.getElementById('btnFinalizarPagosQuincena');
        btnFinalizar.style.display = 'inline-block';
        
        // Mostrar sección de pagos
        document.getElementById('pagarNominaLiquidada').style.display = 'block';
        document.getElementById('pagarNominaLiquidada').scrollIntoView({ behavior: 'smooth' });
        
        showSuccess('Pagos retomados - Continúe registrando los faltantes o finalice');
        
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cargar datos para pago');
    }
}

function closeLiquidacionModal() {
    document.getElementById('liquidacionModal').classList.remove('active');
}

// Configurar evento del formulario
document.addEventListener('DOMContentLoaded', function() {
    const forma = document.getElementById('liquidacionForm');
    if (forma) {
        forma.addEventListener('submit', async (e) => {
            e.preventDefault();
            await liquidarQuincena();
        });
    }
});

async function liquidarQuincena() {
    const mes = document.getElementById('mes_liquidacion').value;
    const numero_quincena = document.getElementById('quincena_liquidacion').value;
    
    if (!mes || !numero_quincena) {
        // Permitir liquidación automática si el backend determina la quincena
        try {
            const response = await fetch('/api/nomina/quincenas/liquidar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({})
            });
            const raw = await response.text();
            let result = null;
            try {
                result = raw ? JSON.parse(raw) : {};
            } catch (err) {
                result = { error: raw || 'Respuesta inválida del servidor' };
            }

            if (response.ok) {
                const resultadoNormalizado = await expandirResultadoLiquidacion(result);
                procesarResultadoLiquidacion(resultadoNormalizado);
                return;
            }

            showError(result.error || 'Error al liquidar quincena');
            return;
        } catch (error) {
            console.error('Error al liquidar quincena automáticamente:', error);
            showError(error.message || 'Error de conexión al liquidar quincena');
            return;
        }
    }
    
    // Primero verificar el estado de la quincena
    try {
        const verificarResponse = await fetch('/api/nomina/quincenas/verificar-estado', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                mes: parseInt(mes),
                numero_quincena: parseInt(numero_quincena),
                anio: new Date().getFullYear()
            })
        });
        
        const estadoData = await verificarResponse.json();
        
        if (!verificarResponse.ok) {
            showError(estadoData.error || 'Error al verificar quincena');
            return;
        }
        
        // Si la quincena existe con pagos finalizados, bloquear; en caso contrario
        // permitir re-liquidar libremente sin exigir finalizar quincenas anteriores
        // ni pedir confirmaciones adicionales.
        if (estadoData.pagos_finalizados) {
            showError(`❌ ${estadoData.mensaje}\n\nEsta quincena ya fue finalizada. Proceda a liquidar la siguiente quincena.`);
            return;
        }
    } catch (error) {
        console.error('Error verificando:', error);
        showError('Error de conexión al verificar quincena');
        return;
    }
    
    // Proceder con la liquidación
    try {
        const response = await fetch('/api/nomina/quincenas/liquidar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                mes: parseInt(mes),
                numero_quincena: parseInt(numero_quincena),
                anio: new Date().getFullYear()
            })
        });

        const raw = await response.text();
        let result = null;
        try {
            result = raw ? JSON.parse(raw) : {};
        } catch (err) {
            result = { error: raw || 'Respuesta inválida del servidor' };
        }

        if (response.ok) {
            const resultadoNormalizado = await expandirResultadoLiquidacion(result);
            procesarResultadoLiquidacion(resultadoNormalizado);
        } else {
            showError(result.error || 'Error al liquidar quincena');
        }
    } catch (error) {
        console.error('Error:', error);
        showError(error.message || 'Error de conexión al liquidar quincena');
    }
}

function procesarResultadoLiquidacion(result) {
    ultimaLiquidacionData = result;
    closeLiquidacionModal();
    mostrarResultadosLiquidacion(result);
    showSuccess('✅ Liquidación calculada exitosamente\n\nAhora proceda a registrar los pagos y finalice con "🔒 Finalizar Pago Quincena"');
}

function mostrarResultadosLiquidacion(data) {
    if (!data || !Array.isArray(data.liquidaciones)) {
        showError('La liquidación no devolvió el detalle esperado de empleados.');
        return;
    }

    // Mostrar información general
    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const quincena_text = data.numero_quincena === 1 ? '1ª' : '2ª';
    
    document.getElementById('liquidacionPeriodo').textContent = 
        `${meses[data.mes]} ${data.anio} - ${quincena_text} Quincena`;
    document.getElementById('liquidacionEmpleados').textContent = data.total_empleados;
    document.getElementById('liquidacionTotal').textContent = 
        `$${formatCurrency(data.total_a_pagar_todos)}`;
    
    // Mostrar tabla de liquidaciones
    const tbody = document.getElementById('liquidacionTable');
    tbody.innerHTML = '';
    
    const mostrarPension = data.liquidaciones.some(emp => Number(emp.pension) > 0);
    const mostrarSalud = data.liquidaciones.some(emp => Number(emp.salud) > 0);
    const mostrarCaja = data.liquidaciones.some(emp => Number(emp.caja_compensacion) > 0);

    data.liquidaciones.forEach(emp => {
        const row = document.createElement('tr');
        
        // Crear tooltip de novedades si existen
        let novedadesTooltip = '';
        if (emp.novedades_aplicadas && emp.novedades_aplicadas.length > 0) {
            novedadesTooltip = emp.novedades_aplicadas.map(n => {
                const signo = n.movimiento === 'DEBITO' ? '+' : '-';
                const cuota = n.cuota ? ` (${n.cuota})` : '';
                return `${n.tipo}${cuota}: ${signo}$${formatCurrency(n.valor)}`;
            }).join('\n');
        }
        
        row.innerHTML = `
            <td>
                ${emp.nombre}
                ${emp.novedades_aplicadas && emp.novedades_aplicadas.length > 0 ? 
                    `<span style="color: #2196F3; cursor: help; margin-left: 5px;" title="${novedadesTooltip}">📋 (${emp.novedades_aplicadas.length})</span>` : 
                    ''}
            </td>
            <td>$${formatCurrency(emp.sueldo_base)}</td>
            <td>$${formatCurrency(emp.sueldo_quincena)}</td>
            <td style="color: #f44336; font-weight: bold;">$${formatCurrency(emp.saldo_anterior)}</td>
            <td>$${formatCurrency(emp.ingresos_extra)}</td>
            <td>$${formatCurrency(emp.deducciones_otras)}</td>
            <td>$${formatCurrency(emp.anticipos)}</td>
            <td>$${formatCurrency(emp.prestamos)}</td>
            <td>$${formatCurrency(emp.total_deducciones)}</td>
            <td style="font-weight: bold; color: #27ae60;">$${formatCurrency(emp.total_a_pagar)}</td>
        `;
        tbody.appendChild(row);
    });

    // Ocultar columnas de conceptos con porcentaje 0
    document.querySelectorAll('.col-pension').forEach(el => {
        el.style.display = mostrarPension ? '' : 'none';
    });
    document.querySelectorAll('.col-salud').forEach(el => {
        el.style.display = mostrarSalud ? '' : 'none';
    });
    document.querySelectorAll('.col-caja').forEach(el => {
        el.style.display = mostrarCaja ? '' : 'none';
    });
    
    // Mostrar sección de resultados
    document.getElementById('liquidacionResultados').style.display = 'block';
    
    // Scroll a la sección de resultados
    document.getElementById('liquidacionResultados').scrollIntoView({ behavior: 'smooth' });
}

function guardarLiquidacion() {
    if (!ultimaLiquidacionData) {
        showError('No hay liquidación para guardar');
        return;
    }
    
    // La liquidación ya se guardó en la BD cuando se calculó
    showSuccess('Liquidación guardada correctamente. Puede proceder a pagar.');
    
    // Mostrar botón para proceder a pagar
    document.getElementById('btnProcederPago').style.display = 'inline-block';
}

// ==================== FUNCIONES DE PAGO DESDE LIQUIDACIÓN ====================

async function mostrarSeccionPagos() {
    if (!ultimaLiquidacionData) {
        showError('No hay datos de liquidación');
        return;
    }
    
    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const quincena_text = ultimaLiquidacionData.numero_quincena === 1 ? '1ª' : '2ª';
    
    document.getElementById('pagoQuincenaTitulo').textContent = 
        `${meses[ultimaLiquidacionData.mes]} ${ultimaLiquidacionData.anio} - ${quincena_text} Quincena`;
    
    // Cargar datos completos desde liquidación y empleados
    try {
        const response = await fetch(`/api/nomina/liquidaciones/pendientes?mes=${ultimaLiquidacionData.mes}&numero_quincena=${ultimaLiquidacionData.numero_quincena}&anio=${ultimaLiquidacionData.anio}`, {
            credentials: 'include'
        });
        
        const liquidaciones = await response.json();
        
        // Cargar información de pagos ya registrados
        const pagosResponse = await fetch(`/api/nomina/pagos?mes=${ultimaLiquidacionData.mes}&numero_quincena=${ultimaLiquidacionData.numero_quincena}&anio=${ultimaLiquidacionData.anio}`, {
            credentials: 'include'
        });
        
        const pagos_realizados = pagosResponse.ok ? (await pagosResponse.json()) : [];
        
        // Crear mapa de pagos por liquido_id
        const pagos_map = {};
        pagos_realizados.forEach(p => {
            if (!pagos_map[p.liquido_quincena_id]) {
                pagos_map[p.liquido_quincena_id] = [];
            }
            pagos_map[p.liquido_quincena_id].push(p);
        });
        
        if (!response.ok) {
            showError(liquidaciones.error || 'Error al cargar liquidaciones');
            return;
        }
        
        // Cargar info completa de empleados
        const empResponse = await fetch('/api/nomina/empleados', { credentials: 'include' });
        const empleados = await empResponse.json();
        const empMap = {};
        empleados.forEach(e => empMap[e.id] = e);
        
        const tbody = document.getElementById('tablaPagosLiquidacion');
        tbody.innerHTML = '';
        
        liquidaciones.forEach(liq => {
            const emp = empMap[liq.empleado_id] || {};
            const saldoPendiente = Math.max(0, (liq.total_a_pagar || 0) - (liq.pagada ? liq.total_a_pagar : 0));
            const estaPagado = liq.pagada || (liq.saldo_pendiente === 0 || liq.saldo_pendiente === '0');
            const esParcial = !estaPagado && liq.saldo_pendiente > 0;
            
            // Obtener pagos de este empleado en esta quincena
            const pagos_empleado = pagos_map[liq.liquido_id] || [];
            const pagos_info = pagos_empleado.length > 0 
                ? pagos_empleado.map(p => `${p.forma_pago}: $${formatCurrency(p.valor_pagado)}`).join(', ')
                : 'Sin pagar';
            
            // Determinar estado visual
            let estadoHTML = '';
            if (estaPagado) {
                estadoHTML = '<span style="background: #4caf50; color: white; padding: 3px 8px; border-radius: 3px; font-weight: bold;">✅ PAGADO</span>';
            } else if (esParcial) {
                estadoHTML = '<span style="background: #ff9800; color: white; padding: 3px 8px; border-radius: 3px; font-weight: bold;">⚠️ PARCIAL</span>';
            } else {
                estadoHTML = '<span style="background: #f44336; color: white; padding: 3px 8px; border-radius: 3px; font-weight: bold;">⏳ PENDIENTE</span>';
            }
            
            const row = document.createElement('tr');
            row.style.backgroundColor = estaPagado ? '#f1f8e9' : (esParcial ? '#fff3e0' : '');
            row.innerHTML = `
                <td><input type="checkbox" class="pago-liq-checkbox" data-liquido-id="${liq.liquido_id}" data-valor="${liq.total_a_pagar}" ${estaPagado ? 'disabled' : 'checked'}></td>
                <td>${liq.empleado_nombre}</td>
                <td style="color: #f44336;">$${formatCurrency(liq.saldo_anterior || 0)}</td>
                <td style="color: #4caf50;">$${formatCurrency(liq.total_ingresos)}</td>
                <td style="color: #ff9800;">$${formatCurrency(liq.total_deducciones)}</td>
                <td style="font-weight: bold; color: #2196F3;">$${formatCurrency(liq.total_a_pagar)}</td>
                <td>${estadoHTML}</td>
                <td>${liq.banco || '-'}${liq.numero_cuenta ? ' / ' + liq.numero_cuenta : ''}</td>
                <td style="font-size: 0.85rem;">${pagos_info}</td>
                <td>
                    <div style="display:flex;gap:6px;align-items:center;">
                        <button class="btn btn-sm btn-info" onclick="verPagosDetalle(${liq.liquido_id}, ${liq.empleado_id})">🔍 Ver pagos</button>
                        ${!estaPagado ? `<button class="btn btn-sm btn-primary" onclick='abrirModalPagoIndividual(${JSON.stringify(liq)}, ${JSON.stringify(emp)})'>💸 Pagar</button>` : '<span style="color: #999;">Pagado</span>'}
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
        
        // El botón FINALIZAR siempre debe estar disponible
        // (Puede finalizar aunque queden empleados sin pagar - pasarán a siguiente quincena)
        const btnFinalizar = document.getElementById('btnFinalizarPagosQuincena');
        btnFinalizar.style.display = 'inline-block';
        
        // Mostrar sección de pagos
        document.getElementById('pagarNominaLiquidada').style.display = 'block';
        document.getElementById('pagarNominaLiquidada').scrollIntoView({ behavior: 'smooth' });
        
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cargar datos para pago');
    }
}

function ocultarSeccionPagos() {
    document.getElementById('pagarNominaLiquidada').style.display = 'none';
}

function toggleSelectAllPagosLiq() {
    const selectAll = document.getElementById('selectAllPagosLiq');
    const checkboxes = document.querySelectorAll('.pago-liq-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
}

async function procesarPagoMasivoLiquidacion() {
    const checkboxes = document.querySelectorAll('.pago-liq-checkbox:checked');
    
    if (checkboxes.length === 0) {
        showError('Debe seleccionar al menos un empleado para pagar');
        return;
                // Actualizar estado del workflow
                const pagados = liquidaciones.filter(l => l.pagada || l.saldo_pendiente === 0 || l.saldo_pendiente === '0').length;
                const pendientes = liquidaciones.filter(l => !l.pagada && l.saldo_pendiente > 0).length;
                const total = liquidaciones.length;
        
                const workflowAlert = document.getElementById('workflowAlert');
                const workflowStatus = document.getElementById('workflowStatus');
                if (pendientes > 0 || pagados > 0) {
                    workflowStatus.innerHTML = `
                        <strong>Progreso de Pago:</strong> ${pagados} pagado(s) ✅ / ${pendientes} pendiente(s) ⏳ (Total: ${total})
                    `;
                    workflowAlert.style.display = 'block';
                }
    }
    
    const total = Array.from(checkboxes).reduce((sum, cb) => sum + parseFloat(cb.dataset.valor), 0);
    
    if (!confirm(`¿Confirma el pago de ${checkboxes.length} empleado(s) por un total de $${formatCurrency(total)}?`)) {
        return;
    }
    
    const liquidaciones = Array.from(checkboxes).map(cb => ({
        liquido_id: parseInt(cb.dataset.liquidoId),
        valor_a_pagar: parseFloat(cb.dataset.valor)
    }));
    
    try {
        const response = await fetch('/api/nomina/pagos/masivo', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                liquidaciones: liquidaciones,
                fecha_pago: new Date().toISOString(),
                forma_pago: 'TRANSFERENCIA'
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showSuccess(`Pagos procesados exitosamente: ${result.cantidad} empleado(s)`);
            
            // Limpiar y resetear
            setTimeout(() => {
                ocultarSeccionPagos();
                document.getElementById('liquidacionResultados').style.display = 'none';
                document.getElementById('btnProcederPago').style.display = 'none';
                document.getElementById('mes_liquidacion').value = '';
                document.getElementById('quincena_liquidacion').value = '';
                ultimaLiquidacionData = null;
            }, 2000);
        } else {
            showError(result.error || 'Error al procesar pagos');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al procesar pagos');
    }
}

function guardarPagosQuincena() {
    if (!ultimaLiquidacionData) {
        showError('No hay datos de liquidación');
        return;
    }

    showSuccess('Pagos guardados. Puede retomar esta quincena después.');
    ocultarSeccionPagos();
    document.getElementById('btnProcederPago').style.display = 'inline-block';
}

// ==================== FINALIZAR PAGO DE QUINCENA ====================

async function finalizarPagosQuincena() {
    if (!ultimaLiquidacionData) {
        showError('No hay datos de liquidación');
        return;
    }
    
    const mes = ultimaLiquidacionData.mes;
    const numero_quincena = ultimaLiquidacionData.numero_quincena;
    const anio = ultimaLiquidacionData.anio;
    
    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const quincena_text = numero_quincena === 1 ? '1ª' : '2ª';
    
    if (!confirm(`¿Está seguro de finalizar los pagos de ${meses[mes]} ${anio} - ${quincena_text} Quincena?\n\nUna vez finalizado:\n✅ Se guardarán los saldos pendientes\n✅ Se podrá liquidar la siguiente quincena`)) {
        return;
    }
    
    try {
        const response = await fetch('/api/nomina/quincenas/finalizar-pagos', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                mes: mes,
                numero_quincena: numero_quincena,
                anio: anio
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showSuccess(`✅ Pagos finalizados exitosamente!\n\n📊 Saldos guardados: ${result.saldos_guardados}\n📅 Siguiente quincena: ${result.siguiente_quincena}`);
            
            // Limpiar y resetear después de 3 segundos
            setTimeout(() => {
                ocultarSeccionPagos();
                document.getElementById('liquidacionResultados').style.display = 'none';
                document.getElementById('btnProcederPago').style.display = 'none';
                document.getElementById('btnFinalizarPagosQuincena').style.display = 'none';
                document.getElementById('mes_liquidacion').value = '';
                document.getElementById('quincena_liquidacion').value = '';
                ultimaLiquidacionData = null;
            }, 3000);
        } else {
            showError(`❌ Error: ${result.error || 'Error al finalizar pagos'}`);
        }
    } catch (error) {
        console.error('Error:', error);
        showError('❌ Error de conexión al finalizar pagos');
    }
}

// ==================== PAGO INDIVIDUAL CON DISCRIMINACIÓN ====================

function abrirModalPagoIndividual(liquidacion, empleado) {
    // Llenar datos del empleado
    document.getElementById('pago_ind_liquido_id').value = liquidacion.liquido_id;
    document.getElementById('pago_ind_empleado_id').value = liquidacion.empleado_id;
    document.getElementById('pago_ind_empleado_nombre').textContent = liquidacion.empleado_nombre;
    
    // Llenar valores - USAR CAMPOS CORRECTOS
    console.log('Abrir modal pago individual - liquidacion:', liquidacion);
    document.getElementById('pago_ind_salario_base').textContent = formatCurrency(empleado.sueldo_base || 0);
    document.getElementById('pago_ind_sueldo_quincena').textContent = formatCurrency(liquidacion.sueldo_quincena || 0);
    document.getElementById('pago_ind_saldo_anterior').textContent = formatCurrency(liquidacion.saldo_anterior || 0);
    document.getElementById('pago_ind_ingresos').textContent = formatCurrency(liquidacion.total_ingresos || 0);
    // Mostrar deducciones: usar total_deducciones si existe, si no sumar los componentes como fallback
    const deduccionesFallback = (parseFloat(liquidacion.pension || 0) || 0) + (parseFloat(liquidacion.salud || 0) || 0) + (parseFloat(liquidacion.caja_compensacion || 0) || 0) + (parseFloat(liquidacion.deducciones_otras || 0) || 0) + (parseFloat(liquidacion.anticipos || 0) || 0) + (parseFloat(liquidacion.prestamos || 0) || 0);
    const deduccionesVal = (typeof liquidacion.total_deducciones !== 'undefined' && liquidacion.total_deducciones != null) ? parseFloat(liquidacion.total_deducciones) : deduccionesFallback;
    document.getElementById('pago_ind_deducciones').textContent = formatCurrency(deduccionesVal || 0);
    // Mostrar el total combinado: saldo anterior + valor neto de la quincena
    const saldoAnterior = parseFloat(liquidacion.saldo_anterior || 0);
    const totalQuincena = parseFloat(liquidacion.total_a_pagar || 0);
    const totalCombinado = saldoAnterior + totalQuincena;
    document.getElementById('pago_ind_total').textContent = formatCurrency(totalCombinado || 0);
    
    // Valores hidden para cálculos
    const saldoPendiente = parseFloat(liquidacion.saldo_pendiente || 0);

    document.getElementById('pago_ind_saldo_ant_original').value = saldoAnterior;
    document.getElementById('pago_ind_total_quincena').value = totalQuincena;

    // Valor por defecto: proponer pagar el total combinado (saldo anterior + quincena)
    document.getElementById('pago_ind_valor_total').value = totalCombinado.toFixed(2);

    // Sugerir distribución por defecto: priorizar pago a saldo anterior
    let pagoSaldoAnterior = Math.min(totalCombinado, saldoAnterior);
    let pagoQuincenaActual = Math.max(0, totalCombinado - pagoSaldoAnterior);

    document.getElementById('pago_ind_saldo_ant_pago').value = pagoSaldoAnterior.toFixed(2);
    document.getElementById('pago_ind_quincena_pago').value = pagoQuincenaActual.toFixed(2);
    
    // Fecha actual por defecto
    document.getElementById('pago_ind_fecha').valueAsDate = new Date();
    
    // Calcular distribución inicial
    calcularDistribucionPago();
    
    // Mostrar modal
    document.getElementById('pagoIndividualDetailModal').style.display = 'block';
}

function closePagoIndividualDetailModal() {
    document.getElementById('pagoIndividualDetailModal').style.display = 'none';
    document.getElementById('pagoIndividualDetailForm').reset();
    document.getElementById('pagoMixtoFields').style.display = 'none';
    document.getElementById('saldoPendiente').style.display = 'none';
}

// Mostrar modal con detalles de pagos realizados para un liquido
async function verPagosDetalle(liquidoId, empleadoId) {
    try {
        if (!ultimaLiquidacionData) {
            showError('No hay contexto de quincena para consultar pagos');
            return;
        }

        const mes = ultimaLiquidacionData.mes;
        const numero_quincena = ultimaLiquidacionData.numero_quincena;
        const anio = ultimaLiquidacionData.anio;

        const params = new URLSearchParams({ mes: mes, numero_quincena: numero_quincena, anio: anio });
        const response = await fetch(`/api/nomina/pagos?${params.toString()}`, { credentials: 'include' });
        const pagos = await response.json();

        const pagos_filtrados = (pagos || []).filter(p => p.liquido_quincena_id === liquidoId);

        const tbody = document.getElementById('verPagosTable');
        tbody.innerHTML = '';

        document.getElementById('verPagosInfo').textContent = `Empleado ID: ${empleadoId} — Liquido: ${liquidoId}`;

        if (!pagos_filtrados.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="loading">No hay pagos registrados para este líquido</td></tr>';
        } else {
            pagos_filtrados.forEach(p => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${p.fecha_pago}</td>
                    <td>$${formatCurrency(p.valor_pagado)}</td>
                    <td>${p.forma_pago}</td>
                    <td>${p.numero_comprobante || '-'}</td>
                    <td>${p.observaciones || '-'}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        document.getElementById('verPagosModal').style.display = 'block';
    } catch (error) {
        console.error('Error cargando pagos:', error);
        showError('Error al cargar pagos');
    }
}

function closeVerPagosModal() {
    document.getElementById('verPagosModal').style.display = 'none';
    document.getElementById('verPagosTable').innerHTML = '';
    document.getElementById('verPagosInfo').textContent = '';
}

function calcularDistribucionPago() {
    // Esta función ahora SOLO valida, no auto-calcula
    const valorTotal = parseFloat(document.getElementById('pago_ind_valor_total').value) || 0;
    const pagoSaldoAnt = parseFloat(document.getElementById('pago_ind_saldo_ant_pago').value) || 0;
    const pagoQuincena = parseFloat(document.getElementById('pago_ind_quincena_pago').value) || 0;
    
    // Calcular nuevo saldo pendiente
    const saldoAnterior = parseFloat(document.getElementById('pago_ind_saldo_ant_original').value) || 0;
    const totalQuincena = parseFloat(document.getElementById('pago_ind_total_quincena').value) || 0;
    const nuevoSaldo = (saldoAnterior - pagoSaldoAnt) + (totalQuincena - pagoQuincena);
    
    document.getElementById('nuevoSaldoPendiente').textContent = formatCurrency(nuevoSaldo);
    
    // Mostrar aviso si queda saldo pendiente
    if (nuevoSaldo > 0) {
        document.getElementById('saldoPendiente').style.display = 'block';
    } else {
        document.getElementById('saldoPendiente').style.display = 'none';
    }
    
    // Si el tipo de pago es MIXTO, recalcular la distribución 50-50
    recalcularDistribucionMixta();
}

function validarDistribucion() {
    const valorTotal = parseFloat(document.getElementById('pago_ind_valor_total').value) || 0;
    const pagoSaldoAnt = parseFloat(document.getElementById('pago_ind_saldo_ant_pago').value) || 0;
    const pagoQuincena = parseFloat(document.getElementById('pago_ind_quincena_pago').value) || 0;
    const suma = pagoSaldoAnt + pagoQuincena;
    
    const diferencia = Math.abs(suma - valorTotal);
    
    // Mostrar error solo si no coincide (tolerancia: 0.01)
    if (diferencia > 0.01) {
        showError(`⚠️ Advertencia: ${formatCurrency(pagoSaldoAnt)} + ${formatCurrency(pagoQuincena)} = ${formatCurrency(suma)} (debe ser ${formatCurrency(valorTotal)})`);
    }
    
    // Calcular nuevo saldo
    const saldoAnterior = parseFloat(document.getElementById('pago_ind_saldo_ant_original').value) || 0;
    const totalQuincena = parseFloat(document.getElementById('pago_ind_total_quincena').value) || 0;
    const nuevoSaldo = (saldoAnterior - pagoSaldoAnt) + (totalQuincena - pagoQuincena);
    
    document.getElementById('nuevoSaldoPendiente').textContent = formatCurrency(nuevoSaldo);
    document.getElementById('saldoPendiente').style.display = nuevoSaldo > 0 ? 'block' : 'none';
}

// Nueva función: Recalcular la discriminación automáticamente cuando cambia el valor total
function sugerirDistribucionAutomatica() {
    const valorTotal = parseFloat(document.getElementById('pago_ind_valor_total').value) || 0;
    const saldoAnterior = parseFloat(document.getElementById('pago_ind_saldo_ant_original').value) || 0;
    const totalQuincena = parseFloat(document.getElementById('pago_ind_total_quincena').value) || 0;
    
    // Distribuir el valor a pagar: primero al saldo anterior, luego a la quincena actual
    let pagoSaldoAnt = 0;
    let pagoQuincena = 0;
    
    if (valorTotal <= saldoAnterior) {
        // Si lo que pago es menos que el saldo anterior, todo va al saldo anterior
        pagoSaldoAnt = valorTotal;
        pagoQuincena = 0;
    } else {
        // Si pago más que el saldo anterior, primero se cubre el saldo anterior, el resto va a quincena actual
        pagoSaldoAnt = saldoAnterior;
        pagoQuincena = valorTotal - saldoAnterior;
    }
    
    // Actualizar los campos de discriminación
    document.getElementById('pago_ind_saldo_ant_pago').value = pagoSaldoAnt.toFixed(2);
    document.getElementById('pago_ind_quincena_pago').value = pagoQuincena.toFixed(2);
    
    // Validar la distribución
    validarDistribucion();
}

function toggleFormaPago() {
    const tipo = document.getElementById('pago_ind_tipo').value;
    const mixtoFields = document.getElementById('pagoMixtoFields');
    const unicoInfo = document.getElementById('pagoUnicoInfo');
    const pagoMixtoTotal = document.getElementById('pagoMixtoTotal');
    const pagoUnicoTipo = document.getElementById('pagoUnicoTipo');
    
    const valorTotal = parseFloat(document.getElementById('pago_ind_valor_total').value) || 0;
    
    if (tipo === 'MIXTO') {
        // Mostrar campos de pago mixto
        mixtoFields.style.display = 'block';
        unicoInfo.style.display = 'none';
        
        // Mostrar el total en la sección mixta
        pagoMixtoTotal.textContent = formatCurrency(valorTotal);
        
        // Sugerir distribución 50-50 basado en el VALOR ACTUAL del input
        const mitad = (valorTotal / 2).toFixed(2);
        document.getElementById('pago_ind_efectivo').value = mitad;
        document.getElementById('pago_ind_transferencia').value = mitad;
        
        validarPagoMixto();
    } else {
        // Ocultar campos de pago mixto
        mixtoFields.style.display = 'none';
        document.getElementById('pago_ind_efectivo').value = '0';
        document.getElementById('pago_ind_transferencia').value = '0';
        document.getElementById('pagoMixtoValidation').style.display = 'none';
        
        // Mostrar info de pago único
        if (tipo) {
            unicoInfo.style.display = 'block';
            const tipoNombre = tipo === 'TRANSFERENCIA' ? '🏦 Transferencia' : '💵 Efectivo';
            pagoUnicoTipo.textContent = tipoNombre;
        } else {
            unicoInfo.style.display = 'none';
        }
    }
}

// Nueva función: Recalcular distribución mixta cuando cambia el valor total
function recalcularDistribucionMixta() {
    const tipo = document.getElementById('pago_ind_tipo').value;
    
    // Solo recalcular si el tipo es MIXTO
    if (tipo === 'MIXTO') {
        const valorTotal = parseFloat(document.getElementById('pago_ind_valor_total').value) || 0;
        const pagoMixtoTotal = document.getElementById('pagoMixtoTotal');
        
        // Actualizar el total mostrado
        pagoMixtoTotal.textContent = formatCurrency(valorTotal);
        
        // Recalcular distribución 50-50
        const mitad = (valorTotal / 2).toFixed(2);
        document.getElementById('pago_ind_efectivo').value = mitad;
        document.getElementById('pago_ind_transferencia').value = mitad;
        
        validarPagoMixto();
    }
}

function validarPagoMixto() {
    const valorTotal = parseFloat(document.getElementById('pago_ind_valor_total').value) || 0;
    const efectivo = parseFloat(document.getElementById('pago_ind_efectivo').value) || 0;
    const transferencia = parseFloat(document.getElementById('pago_ind_transferencia').value) || 0;
    const suma = efectivo + transferencia;
    
    const validationDiv = document.getElementById('pagoMixtoValidation');
    const validationMsg = document.getElementById('pagoMixtoValidationMsg');
    
    const diferencia = Math.abs(suma - valorTotal);
    
    if (diferencia > 0.01) {
        validationDiv.style.display = 'block';
        validationDiv.style.background = '#ffebee';
        validationDiv.style.borderLeft = '4px solid #d32f2f';
        validationMsg.style.color = '#d32f2f';
        validationMsg.textContent = `❌ Error: ${formatCurrency(efectivo)} + ${formatCurrency(transferencia)} = ${formatCurrency(suma)} (debe ser ${formatCurrency(valorTotal)})`;
    } else if (suma === 0) {
        validationDiv.style.display = 'none';
    } else {
        validationDiv.style.display = 'block';
        validationDiv.style.background = '#e8f5e9';
        validationDiv.style.borderLeft = '4px solid #4caf50';
        validationMsg.style.color = '#4caf50';
        validationMsg.textContent = `✅ Correcto: ${formatCurrency(efectivo)} + ${formatCurrency(transferencia)} = ${formatCurrency(suma)}`;
    }
}

async function procesarPagoIndividual(event) {
    event.preventDefault();
    
    const liquidoId = document.getElementById('pago_ind_liquido_id').value;
    const empleadoId = document.getElementById('pago_ind_empleado_id').value;
    const fechaPago = document.getElementById('pago_ind_fecha').value;
    const valorTotal = parseFloat(document.getElementById('pago_ind_valor_total').value);
    const pagoSaldoAnt = parseFloat(document.getElementById('pago_ind_saldo_ant_pago').value);
    const pagoQuincena = parseFloat(document.getElementById('pago_ind_quincena_pago').value);
    const tipo = document.getElementById('pago_ind_tipo').value;
    const comprobante = document.getElementById('pago_ind_comprobante').value;
    const observaciones = document.getElementById('pago_ind_observaciones').value;
    
    // Validación: Valor total debe ser mayor a 0
    if (valorTotal <= 0) {
        showError('❌ El valor a pagar debe ser mayor a 0');
        return;
    }
    
    // Validación: Tipo de pago obligatorio
    if (!tipo) {
        showError('❌ Debe seleccionar una forma de pago');
        return;
    }
    
    let efectivo = 0;
    let transferencia = 0;
    let formaPago = tipo;
    
    if (tipo === 'MIXTO') {
        efectivo = parseFloat(document.getElementById('pago_ind_efectivo').value) || 0;
        transferencia = parseFloat(document.getElementById('pago_ind_transferencia').value) || 0;
        
        // Validar suma
        const diferencia = Math.abs((efectivo + transferencia) - valorTotal);
        if (diferencia > 0.01) {
            showError(`❌ Error de distribución: ${formatCurrency(efectivo)} + ${formatCurrency(transferencia)} ≠ ${formatCurrency(valorTotal)}`);
            return;
        }
        
        // Validar que ambos sean mayores a 0
        if (efectivo === 0 && transferencia === 0) {
            showError('❌ En pago MIXTO debe especificar ambas formas de pago');
            return;
        }
    } else if (tipo === 'EFECTIVO') {
        efectivo = valorTotal;
        transferencia = 0;
    } else if (tipo === 'TRANSFERENCIA') {
        efectivo = 0;
        transferencia = valorTotal;
    }
    
    // Validar discriminación
    const diferenciaDis = Math.abs((pagoSaldoAnt + pagoQuincena) - valorTotal);
    if (diferenciaDis > 0.01) {
        showError(`❌ Error en discriminación: Saldo Ant (${formatCurrency(pagoSaldoAnt)}) + Quincena (${formatCurrency(pagoQuincena)}) ≠ Total (${formatCurrency(valorTotal)})`);
        return;
    }
    
    const pagoData = {
        liquido_quincena_id: parseInt(liquidoId),
        empleado_id: parseInt(empleadoId),
        fecha_pago: fechaPago,
        valor_pagado: valorTotal,
        pago_saldo_anterior: pagoSaldoAnt,
        pago_quincena_actual: pagoQuincena,
        forma_pago: formaPago,
        efectivo: efectivo,
        transferencia: transferencia,
        numero_comprobante: comprobante,
        observaciones: observaciones
    };
    
    console.log('📤 Enviando pago:', pagoData);
    console.log('📋 JSON a enviar:', JSON.stringify(pagoData, null, 2));
    
    try {
        const response = await fetch('/api/nomina/pagos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(pagoData)
        });
        
        console.log('📊 Status de respuesta:', response.status, response.statusText);
        
        const result = await response.json();
        
        console.log('📥 Respuesta del servidor:', result);
        
        if (response.ok) {
            console.log('✅ PAGO REGISTRADO EXITOSAMENTE');
            showSuccess(`✅ Pago registrado exitosamente - ${formatCurrency(valorTotal)} (${formaPago})`);
            closePagoIndividualDetailModal();
            // Recargar sección de pagos
            console.log('🔄 Recargando sección de pagos...');
            mostrarSeccionPagos();
        } else {
            console.error('❌ Error del servidor:', result);
            showError(`❌ Error: ${result.error || 'Error al registrar pago'}`);
        }
    } catch (error) {
        console.error('❌ Error crítico:', error);
        showError('❌ Error de conexión al procesar pago');
    }
}


// Funciones para gestionar novedades en el período

function viewNovedadDetail(id) {
    fetch(`/api/nomina/novedades/${id}`, { credentials: 'include' })
        .then(r => r.json())
        .then(novedad => {
            document.getElementById('detalle_novedad_id').value = novedad.id;
            document.getElementById('detalle_empleado_nombre').value = novedad.empleado_nombre || 'N/A';
            document.getElementById('detalle_nro_documento').value = novedad.nro_documento || 'N/A';
            document.getElementById('detalle_tipo').value = novedad.tipo_novedad || '';
            document.getElementById('detalle_movimiento').value = novedad.tipo_movimiento || '';
            document.getElementById('detalle_valor').value = formatCurrency(novedad.valor);
            document.getElementById('detalle_fecha').value = novedad.fecha_novedad || '';
            document.getElementById('detalle_descripcion').value = novedad.descripcion || '';
            document.getElementById('detalle_activa').value = novedad.activa ? 'true' : 'false';
            
            if (novedad.numero_cuotas || novedad.quincena_inicio_descuento) {
                document.getElementById('detalleExtended').style.display = 'block';
                document.getElementById('detalle_cuotas').value = novedad.numero_cuotas || '';
                document.getElementById('detalle_quincena_inicio').value = novedad.quincena_inicio_descuento || '';
            } else {
                document.getElementById('detalleExtended').style.display = 'none';
            }
            
            document.getElementById('verNovedadModal').classList.add('active');
        })
        .catch(error => {
            console.error('Error:', error);
            showError('Error al cargar detalle de novedad');
        });
}

function closeVerNovedadModal() {
    document.getElementById('verNovedadModal').classList.remove('active');
}

function deleteNovedadConfirm() {
    if (!confirm('¿Está seguro de eliminar esta novedad?')) return;
    
    const id = document.getElementById('detalle_novedad_id').value;
    
    fetch(`/api/nomina/novedades/${id}`, {
        method: 'DELETE',
        credentials: 'include'
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) {
            showError(data.error);
        } else {
            showSuccess('Novedad eliminada');
            closeVerNovedadModal();
            loadNovedadesPeriodo();  // Recargar tabla
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showError('Error al eliminar novedad');
    });
}

function deleteNovedad(id) {
    if (!confirm('¿Está seguro de eliminar esta novedad?')) return;
    
    fetch(`/api/nomina/novedades/${id}`, {
        method: 'DELETE',
        credentials: 'include'
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) {
            showError(data.error);
        } else {
            showSuccess('Novedad eliminada');
            loadNovedadesPeriodo();  // Recargar tabla
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showError('Error al eliminar novedad');
    });
}

// Actualizar handler del formulario ver novedad
document.addEventListener('DOMContentLoaded', () => {
    const verForm = document.getElementById('verNovedadForm');
    if (verForm) {
        verForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const id = document.getElementById('detalle_novedad_id').value;
            const activa = document.getElementById('detalle_activa').value === 'true';
            
            try {
                const response = await fetch(`/api/nomina/novedades/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ activa: activa })
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showSuccess('Novedad actualizada');
                    closeVerNovedadModal();
                    loadNovedadesPeriodo();
                } else {
                    showError(result.error || 'Error al actualizar');
                }
            } catch (error) {
                console.error('Error:', error);
                showError('Error de conexión');
            }
        });
    }
});



// Funciones para gestionar novedades en el período

function viewNovedadDetail(id) {
    fetch(`/api/nomina/novedades/${id}`, { credentials: 'include' })
        .then(r => r.json())
        .then(novedad => {
            document.getElementById('detalle_novedad_id').value = novedad.id;
            document.getElementById('detalle_empleado_nombre').value = novedad.empleado_nombre || 'N/A';
            document.getElementById('detalle_nro_documento').value = novedad.nro_documento || 'N/A';
            document.getElementById('detalle_tipo').value = novedad.tipo_novedad || '';
            document.getElementById('detalle_movimiento').value = novedad.tipo_movimiento || '';
            document.getElementById('detalle_valor').value = formatCurrency(novedad.valor);
            document.getElementById('detalle_fecha').value = novedad.fecha_novedad || '';
            document.getElementById('detalle_descripcion').value = novedad.descripcion || '';
            document.getElementById('detalle_activa').value = novedad.activa ? 'true' : 'false';
            
            if (novedad.numero_cuotas || novedad.quincena_inicio_descuento) {
                document.getElementById('detalleExtended').style.display = 'block';
                document.getElementById('detalle_cuotas').value = novedad.numero_cuotas || '';
                document.getElementById('detalle_quincena_inicio').value = novedad.quincena_inicio_descuento || '';
            } else {
                document.getElementById('detalleExtended').style.display = 'none';
            }
            
            document.getElementById('verNovedadModal').classList.add('active');
        })
        .catch(error => {
            console.error('Error:', error);
            showError('Error al cargar detalle de novedad');
        });
}

function closeVerNovedadModal() {
    document.getElementById('verNovedadModal').classList.remove('active');
}

function deleteNovedadConfirm() {
    if (!confirm('¿Está seguro de eliminar esta novedad?')) return;
    
    const id = document.getElementById('detalle_novedad_id').value;
    
    fetch(`/api/nomina/novedades/${id}`, {
        method: 'DELETE',
        credentials: 'include'
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) {
            showError(data.error);
        } else {
            showSuccess('Novedad eliminada');
            closeVerNovedadModal();
            loadNovedadesPeriodo();  // Recargar tabla
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showError('Error al eliminar novedad');
    });
}

function deleteNovedad(id) {
    if (!confirm('¿Está seguro de eliminar esta novedad?')) return;
    
    fetch(`/api/nomina/novedades/${id}`, {
        method: 'DELETE',
        credentials: 'include'
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) {
            showError(data.error);
        } else {
            showSuccess('Novedad eliminada');
            loadNovedadesPeriodo();  // Recargar tabla
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showError('Error al eliminar novedad');
    });
}

// Actualizar handler del formulario ver novedad
document.addEventListener('DOMContentLoaded', () => {
    const verForm = document.getElementById('verNovedadForm');
    if (verForm) {
        verForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const id = document.getElementById('detalle_novedad_id').value;
            const activa = document.getElementById('detalle_activa').value === 'true';
            
            try {
                const response = await fetch(`/api/nomina/novedades/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ activa: activa })
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showSuccess('Novedad actualizada');
                    closeVerNovedadModal();
                    loadNovedadesPeriodo();
                } else {
                    showError(result.error || 'Error al actualizar');
                }
            } catch (error) {
                console.error('Error:', error);
                showError('Error de conexión');
            }
        });
    }
});



// ============ FUNCIONES PARA GESTIÓN DE DESCUENTOS ==============

function cargarDescuentos() {
    fetch('/api/parametros/descuentos', {
        credentials: 'include'
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) {
            showError(data.error);
            return;
        }
        
        const tbody = document.getElementById('descuentosTable');
        tbody.innerHTML = '';
        
        if (!data.descuentos || data.descuentos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="center">No hay parámetros de descuento configurados</td></tr>';
            return;
        }
        
        data.descuentos.forEach(descuento => {
            const row = document.createElement('tr');
            const estadoBadge = descuento.activo 
                ? '<span class="badge badge-success">Activo</span>' 
                : '<span class="badge badge-danger">Inactivo</span>';
            
            row.innerHTML = `
                <td><strong>${descuento.nombre}</strong></td>
                <td>${descuento.porcentaje}%</td>
                <td>${descuento.descripcion || '-'}</td>
                <td>${estadoBadge}</td>
                <td>
                    <button class="btn btn-sm btn-info" onclick="editarDescuento(${descuento.id})">✏️ Editar</button>
                    <button class="btn btn-sm btn-danger" onclick="eliminarDescuento(${descuento.id}, '${descuento.nombre}')">${descuento.activo ? '🗑️ Eliminar' : '💾 Restaurar'}</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    })
    .catch(error => {
        console.error('Error:', error);
        showError('Error al cargar descuentos');
    });
}

function mostrarAgregarDescuento() {
    document.getElementById('descuentoId').value = '';
    document.getElementById('descuentoModalTitle').textContent = 'Nuevo Parámetro de Descuento';
    document.getElementById('descuentoNombre').value = '';
    document.getElementById('descuentoPorcentaje').value = '';
    document.getElementById('descuentoDescripcion').value = '';
    document.getElementById('descuentoActivo').checked = true;
    document.getElementById('descuentoNombre').disabled = false;
    
    document.getElementById('descuentoModal').style.display = 'block';
}

function editarDescuento(id) {
    // Buscar el descuento en la tabla
    fetch('/api/parametros/descuentos', {
        credentials: 'include'
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) {
            showError(data.error);
            return;
        }
        
        const descuento = data.descuentos.find(d => d.id === id);
        if (!descuento) {
            showError('Descuento no encontrado');
            return;
        }
        
        document.getElementById('descuentoId').value = descuento.id;
        document.getElementById('descuentoModalTitle').textContent = `Editar: ${descuento.nombre}`;
        document.getElementById('descuentoNombre').value = descuento.nombre;
        document.getElementById('descuentoPorcentaje').value = descuento.porcentaje;
        document.getElementById('descuentoDescripcion').value = descuento.descripcion || '';
        document.getElementById('descuentoActivo').checked = descuento.activo;
        document.getElementById('descuentoNombre').disabled = true;  // No permitir cambiar el nombre en edición
        
        document.getElementById('descuentoModal').style.display = 'block';
    })
    .catch(error => {
        console.error('Error:', error);
        showError('Error al cargar descuento');
    });
}

function guardarDescuento(event) {
    event.preventDefault();
    
    const id = document.getElementById('descuentoId').value;
    const nombre = document.getElementById('descuentoNombre').value;
    const porcentajeInput = document.getElementById('descuentoPorcentaje').value;
    const porcentaje = porcentajeInput === '' ? null : parseFloat(porcentajeInput);
    const descripcion = document.getElementById('descuentoDescripcion').value;
    const activo = document.getElementById('descuentoActivo').checked;
    
    if (!nombre || porcentaje === null) {
        showError('Complete los campos requeridos');
        return;
    }
    
    if (porcentaje < 0 || porcentaje > 100) {
        showError('El porcentaje debe estar entre 0 y 100');
        return;
    }
    
    const url = id ? `/api/parametros/descuentos/${id}` : '/api/parametros/descuentos';
    const method = id ? 'PUT' : 'POST';
    
    const body = {
        nombre: nombre,
        porcentaje: porcentaje,
        descripcion: descripcion,
        activo: activo
    };
    
    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) {
            showError(data.error);
        } else {
            showSuccess(id ? 'Parámetro actualizado' : 'Parámetro creado');
            closeDescuentoModal();
            cargarDescuentos();
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showError('Error al guardar parámetro');
    });
}

function closeDescuentoModal() {
    document.getElementById('descuentoModal').style.display = 'none';
}

function eliminarDescuento(id, nombre) {
    const descuentoData = JSON.stringify({}).descuentos || [];
    
    // Buscar el descuento para saber si está activo
    fetch('/api/parametros/descuentos', { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
            const descuento = data.descuentos.find(d => d.id === id);
            const mensaje = descuento.activo 
                ? `¿Está seguro de eliminar ${nombre}?\n\nEsto desactivará el parámetro.` 
                : `¿Está seguro de restaurar ${nombre}?\n\nEsto reactivará el parámetro.`;
            
            if (!confirm(mensaje)) return;
            
            // Cambiar estado activo/inactivo
            fetch(`/api/parametros/descuentos/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    porcentaje: descuento.porcentaje,
                    descripcion: descuento.descripcion,
                    activo: !descuento.activo  // Invertir estado
                })
            })
            .then(r => r.json())
            .then(data => {
                if (data.error) {
                    showError(data.error);
                } else {
                    showSuccess(descuento.activo ? `${nombre} eliminado` : `${nombre} restaurado`);
                    cargarDescuentos();
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showError('Error al eliminar parámetro');
            });
        })
        .catch(error => {
            console.error('Error:', error);
            showError('Error al cargar parámetro');
        });
}

// Override de switchModule para cargar descuentos cuando se accede a Tablas
const originalSwitchModule = switchModule;
switchModule = function(moduleName) {
    originalSwitchModule(moduleName);
    
    if (moduleName === 'tablas') {
        cargarDescuentos();
        cargarTiposNovedadConfig();
        cargarAreasConfig();
        cargarCargosConfig();
        cargarAsignacionesLaboralesConfig();
    }
};

// ============ FUNCIONES PARA GESTIÓN DE TIPOS DE NOVEDAD ==============

function cargarTiposNovedadConfig() {
    fetch('/api/nomina/tipos-novedad?todos=true', {
        credentials: 'include'
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) {
            showError(data.error);
            return;
        }

        const tbody = document.getElementById('tiposNovedadTable');
        if (!tbody) return;

        tbody.innerHTML = '';

        const tipos = Array.isArray(data) ? data : (data.tipos || data.lista || []);

        if (!tipos || tipos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="center">No hay clases de novedad configuradas</td></tr>';
            return;
        }

        tipos.forEach(tipo => {
            const row = document.createElement('tr');
            const activo = tipo.activo !== false;
            const estadoBadge = activo
                ? '<span class="badge badge-success">Activo</span>'
                : '<span class="badge badge-danger">Inactivo</span>';

            const requiere = tipo.requiere_autorizacion
                ? '<span class="badge badge-warning">Sí</span>'
                : '<span class="badge badge-secondary">No</span>';

            row.innerHTML = `
                <td><strong>${tipo.nombre}</strong></td>
                <td>${tipo.tipo_movimiento}</td>
                <td>${tipo.categoria}</td>
                <td>${tipo.tipo_funcional || 'PERIODO'}</td>
                <td>${requiere}</td>
                <td>${estadoBadge}</td>
                <td>
                    <button class="btn btn-sm btn-info" onclick="editarTipoNovedad(${tipo.id})">✏️ Editar</button>
                    <button class="btn btn-sm btn-danger" onclick="toggleActivoTipoNovedad(${tipo.id})">${activo ? '🗑️ Desactivar' : '💾 Activar'}</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    })
    .catch(error => {
        console.error('Error:', error);
        showError('Error al cargar clases de novedad');
    });
}

function mostrarAgregarTipoNovedad() {
    document.getElementById('tipoNovedadId').value = '';
    document.getElementById('tipoNovedadModalTitle').textContent = 'Nueva Clase de Novedad';
    document.getElementById('tipoNovedadNombre').value = '';
    document.getElementById('tipoNovedadMovimiento').value = 'DEBITO';
    document.getElementById('tipoNovedadCategoria').value = 'INGRESO_EXTRA';
    document.getElementById('tipoNovedadFuncional').value = 'PERIODO';
    document.getElementById('tipoNovedadRequiereAutorizacion').checked = false;
    document.getElementById('tipoNovedadDescripcion').value = '';
    document.getElementById('tipoNovedadActivo').checked = true;

    document.getElementById('tipoNovedadModal').style.display = 'block';
}

function closeTipoNovedadModal() {
    document.getElementById('tipoNovedadModal').style.display = 'none';
}

function editarTipoNovedad(id) {
    fetch('/api/nomina/tipos-novedad?todos=true', {
        credentials: 'include'
    })
    .then(r => r.json())
    .then(data => {
        const tipos = Array.isArray(data) ? data : (data.tipos || data.lista || []);
        const tipo = tipos.find(t => t.id === id);
        if (!tipo) {
            showError('No se encontró la clase de novedad');
            return;
        }

        document.getElementById('tipoNovedadId').value = tipo.id;
        document.getElementById('tipoNovedadModalTitle').textContent = 'Editar Clase de Novedad';
        document.getElementById('tipoNovedadNombre').value = tipo.nombre || '';
        document.getElementById('tipoNovedadMovimiento').value = tipo.tipo_movimiento || 'DEBITO';
        document.getElementById('tipoNovedadCategoria').value = tipo.categoria || 'INGRESO_EXTRA';
        document.getElementById('tipoNovedadFuncional').value = tipo.tipo_funcional || 'PERIODO';
        document.getElementById('tipoNovedadRequiereAutorizacion').checked = !!tipo.requiere_autorizacion;
        document.getElementById('tipoNovedadDescripcion').value = tipo.descripcion || '';
        document.getElementById('tipoNovedadActivo').checked = tipo.activo !== false;

        document.getElementById('tipoNovedadModal').style.display = 'block';
    })
    .catch(error => {
        console.error('Error:', error);
        showError('Error al cargar clase de novedad');
    });
}

function guardarTipoNovedad(event) {
    event.preventDefault();

    const id = document.getElementById('tipoNovedadId').value || null;
    const nombre = document.getElementById('tipoNovedadNombre').value.trim();
    const tipo_movimiento = document.getElementById('tipoNovedadMovimiento').value;
    const categoria = document.getElementById('tipoNovedadCategoria').value;
    const tipo_funcional = document.getElementById('tipoNovedadFuncional').value;
    const requiere_autorizacion = document.getElementById('tipoNovedadRequiereAutorizacion').checked;
    const descripcion = document.getElementById('tipoNovedadDescripcion').value.trim();
    const activo = document.getElementById('tipoNovedadActivo').checked;

    if (!nombre) {
        showError('El nombre es obligatorio');
        return;
    }

    const url = id ? `/api/nomina/tipos-novedad/${id}` : '/api/nomina/tipos-novedad';
    const method = id ? 'PUT' : 'POST';

    const body = {
        nombre,
        tipo_movimiento,
        categoria,
        tipo_funcional,
        requiere_autorizacion,
        descripcion,
        activo
    };

    fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) {
            showError(data.error);
        } else {
            showSuccess(id ? 'Clase de novedad actualizada' : 'Clase de novedad creada');
            closeTipoNovedadModal();
            cargarTiposNovedadConfig();
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showError('Error al guardar tipo de novedad');
    });
}

function toggleActivoTipoNovedad(id) {
    fetch('/api/nomina/tipos-novedad?todos=true', {
        credentials: 'include'
    })
    .then(r => r.json())
    .then(data => {
        const tipos = Array.isArray(data) ? data : (data.tipos || data.lista || []);
        const tipo = tipos.find(t => t.id === id);
        if (!tipo) {
            showError('No se encontró la clase de novedad');
            return;
        }

        const nuevoActivo = !tipo.activo;
        const mensaje = nuevoActivo
            ? `¿Desea activar nuevamente la clase de novedad "${tipo.nombre}"?`
            : `¿Desea desactivar la clase de novedad "${tipo.nombre}"?
\nNo aparecerá en las listas para nuevas novedades.`;

        if (!confirm(mensaje)) return;

        fetch(`/api/nomina/tipos-novedad/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ activo: nuevoActivo })
        })
        .then(r => r.json())
        .then(data => {
            if (data.error) {
                showError(data.error);
            } else {
                showSuccess(nuevoActivo ? 'Clase de novedad activada' : 'Clase de novedad desactivada');
                cargarTiposNovedadConfig();
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showError('Error al cambiar estado del tipo de novedad');
        });
    })
    .catch(error => {
        console.error('Error:', error);
        showError('Error al cargar clases de novedad');
    });
}

// ==================== GESTIÓN DE NOVEDADES ====================

async function loadNovedadesPeriodo() {
    let mes = null;
    let quincena = null;

    // Si hay un período de nómina seleccionado, usarlo directamente
    if (nominaPeriodoSeleccionado) {
        mes = nominaPeriodoSeleccionado.mes;
        quincena = nominaPeriodoSeleccionado.numero_quincena;

        // Sincronizar selects si existen (aunque estén ocultos)
        const mesSelect = document.getElementById('novedades_mes');
        const qSelect = document.getElementById('novedades_quincena');
        if (mesSelect) mesSelect.value = String(mes);
        if (qSelect) qSelect.value = String(quincena);
    } else {
        const mesSelect = document.getElementById('novedades_mes');
        const qSelect = document.getElementById('novedades_quincena');
        mes = mesSelect ? mesSelect.value : null;
        quincena = qSelect ? qSelect.value : null;

        if (!mes || !quincena) {
            showError('Debe seleccionar mes y quincena');
            return;
        }
    }
    
    const tbody = document.getElementById('novedadesTable');
    tbody.innerHTML = '<tr><td colspan="9" class="loading">Cargando novedades...</td></tr>';
    
    try {
        const anio = nominaPeriodoSeleccionado ? nominaPeriodoSeleccionado.anio : new Date().getFullYear();
        const response = await fetch(`/api/nomina/novedades?mes=${mes}&numero_quincena=${quincena}&anio=${anio}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Error al cargar novedades');
        }
        
        const novedades = await response.json();
        
        if (novedades.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #999;">No hay novedades en este período</td></tr>';
            return;
        }
        
        tbody.innerHTML = '';
        novedades.forEach(nov => {
            const row = document.createElement('tr');
            const signo = nov.tipo_movimiento === 'DEBITO' ? '+' : '-';
            const estadoClass = nov.activa ? 'badge-success' : 'badge-danger';
            const estadoText = nov.activa ? 'Activa' : 'Inactiva';
            
            row.innerHTML = `
                <td>${nov.fecha_novedad}</td>
                <td>${nov.empleado_nombre}</td>
                <td>${nov.nro_documento}</td>
                <td>${nov.tipo_novedad}</td>
                <td style="color: ${nov.tipo_movimiento === 'DEBITO' ? '#27ae60' : '#c0392b'};">${signo} ${nov.tipo_movimiento}</td>
                <td>$${formatCurrency(nov.valor)}</td>
                <td>${nov.descripcion || '-'}</td>
                <td><span class="badge ${estadoClass}">${estadoText}</span></td>
                <td>
                    <button class="btn btn-sm btn-info" onclick="editarNovedad(${nov.id})" title="Editar">✏️</button>
                    <button class="btn btn-sm btn-danger" onclick="eliminarNovedad(${nov.id}, '${nov.empleado_nombre}')" title="Eliminar">🗑️</button>
                </td>
            `;
            tbody.appendChild(row);
        });
        
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #e74c3c;">Error al cargar novedades</td></tr>';
        showError('Error al cargar novedades');
    }
}

async function editarNovedad(novedadId) {
    try {
        const response = await fetch(`/api/nomina/novedades/${novedadId}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Error al cargar novedad');
        }
        
        const novedad = await response.json();
        
        // Llenar el formulario con los datos
        document.getElementById('detalle_novedad_id').value = novedad.id;
        document.getElementById('detalle_empleado_nombre').value = novedad.empleado_nombre;
        document.getElementById('detalle_nro_documento').value = novedad.nro_documento;
        document.getElementById('detalle_tipo').value = novedad.tipo_novedad;
        document.getElementById('detalle_movimiento').value = novedad.tipo_movimiento;
        document.getElementById('detalle_valor').value = novedad.valor;
        document.getElementById('detalle_fecha').value = novedad.fecha_novedad;
        document.getElementById('detalle_descripcion').value = novedad.descripcion || '';
        document.getElementById('detalle_activa').value = novedad.activa ? 'true' : 'false';
        
        // Mostrar campos extendidos si aplica
        if (novedad.numero_cuotas) {
            document.getElementById('detalleExtended').style.display = 'block';
            document.getElementById('detalle_cuotas').value = novedad.numero_cuotas;
            document.getElementById('detalle_quincena_inicio').value = novedad.quincena_inicio_descuento || '-';
        } else {
            document.getElementById('detalleExtended').style.display = 'none';
        }
        
        // Mostrar el modal
        document.getElementById('verNovedadModal').style.display = 'block';
        
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cargar la novedad');
    }
}

async function eliminarNovedad(novedadId, empleadoNombre) {
    if (!confirm(`¿Está seguro de eliminar esta novedad de ${empleadoNombre}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/nomina/novedades/${novedadId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Error al eliminar novedad');
        }
        
        showSuccess('Novedad eliminada exitosamente');
        loadNovedadesPeriodo(); // Recargar la lista
        
    } catch (error) {
        console.error('Error:', error);
        showError('Error al eliminar la novedad');
    }
}

// Agregar evento de submit al formulario de edición
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('verNovedadForm');
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const novedadId = document.getElementById('detalle_novedad_id').value;
            const data = {
                valor: parseFloat(document.getElementById('detalle_valor').value),
                fecha_novedad: document.getElementById('detalle_fecha').value,
                descripcion: document.getElementById('detalle_descripcion').value,
                activa: document.getElementById('detalle_activa').value === 'true'
            };
            
            try {
                const response = await fetch(`/api/nomina/novedades/${novedadId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(data)
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Error al actualizar novedad');
                }
                
                showSuccess('Novedad actualizada exitosamente');
                closeVerNovedadModal();
                loadNovedadesPeriodo(); // Recargar la lista
                
            } catch (error) {
                console.error('Error:', error);
                showError(error.message || 'Error al actualizar la novedad');
            }
        });
    }
});

async function loadRoles() {
    const tableBody = document.getElementById('rolesTable');
    if (!tableBody) return;

    try {
        const response = await fetch('/api/usuarios/roles', { credentials: 'include' });
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

function renderRoleMenuPermissions(selectedIds = []) {
    const container = document.getElementById('rolMenuPermissions');
    if (!container) return;

    if (!Array.isArray(menuOptionsData) || menuOptionsData.length === 0) {
        container.innerHTML = '<div class="loading">No fue posible cargar los permisos.</div>';
        return;
    }

    const selected = new Set((selectedIds || []).map(id => String(id)));
    const renderOption = option => `
        <label class="role-menu-option">
            <input type="checkbox" value="${option.permiso_id}" ${selected.has(String(option.permiso_id)) ? 'checked' : ''}>
            <div>
                <strong>${escapeHtml(option.nombre || option.group || 'Permiso')}</strong>
                <span>${escapeHtml(option.descripcion || '')}</span>
            </div>
        </label>
    `;

    const menuOptions = menuOptionsData.filter(option => option.category !== 'comercial');
    const commercialGroups = {};
    menuOptionsData.filter(option => option.category === 'comercial').forEach(option => {
        const key = option.group || 'Comercial';
        commercialGroups[key] = commercialGroups[key] || [];
        commercialGroups[key].push(option);
    });

    container.innerHTML = `
        <div style="grid-column:1 / -1;">
            <h4 style="margin:0 0 10px 0;">Menu lateral</h4>
            <div class="role-menu-grid">
                ${menuOptions.map(renderOption).join('')}
            </div>
        </div>
        <div style="grid-column:1 / -1; margin-top:12px;">
            <h4 style="margin:0 0 10px 0;">Permisos comerciales</h4>
            ${Object.entries(commercialGroups).map(([groupName, options]) => `
                <div style="margin-bottom:14px;">
                    <div style="font-weight:700; margin-bottom:8px;">${escapeHtml(groupName)}</div>
                    <div class="role-menu-grid">
                        ${options.map(renderOption).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
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
