// Dashboard functionality

let currentUser = null;
let empleadosList = [];
let tiposNovedadList = [];
// Contexto actual de período de nómina seleccionado (año/mes/quincena)
let nominaPeriodoSeleccionado = null;
// Contexto de período actual por módulo (Mes/Año)
window._bancosPeriodoActual = window._bancosPeriodoActual || null;
window._comisionesPeriodoActual = window._comisionesPeriodoActual || null;
window._impuestosPeriodoActual = window._impuestosPeriodoActual || null;
window._comprasPeriodoActual = window._comprasPeriodoActual || null;
window._ventasPeriodoActual = window._ventasPeriodoActual || null;

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

(function initComisionesPeriodoFromStorage() {
    try {
        if (!window._comisionesPeriodoActual && window.localStorage) {
            const raw = localStorage.getItem('comisionesPeriodoActual');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.mes === 'number' && typeof parsed.anio === 'number') {
                    window._comisionesPeriodoActual = parsed;
                }
            }
        }
    } catch (e) {
        console.warn('No se pudo recuperar periodo de comisiones desde localStorage', e);
    }
    window._comisionesPeriodoActual = window._comisionesPeriodoActual || null;
})();

document.addEventListener('DOMContentLoaded', () => {
    currentUser = checkAuth();
    
    if (currentUser) {
        document.getElementById('userName').textContent = currentUser.usuario || currentUser.nombre;
        document.getElementById('userInfo').textContent = `${currentUser.usuario} (${currentUser.role})`;
    }
    
    setupMenuNavigation();
    setupLogout();
    setupEmpleadoForm();
    setupConsultaEmpleados();
    setupEstructuraLaboralForms();
    setupNovedadForm();
    setupNovedadesFiltro();
    setupNominaQuincenaSeleccion();
    setupModulosPeriodoActual();
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
                actualizarEtiquetaQuincenaSeleccionada();
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
    const resumenMensual = document.getElementById('nominaResumenMensual');
    const matrizPanel = document.getElementById('nominaMatrizPanel');
    const panelQuincena = document.getElementById('nominaQuincenaPanel');
    const empleadosPanel = document.getElementById('nominaEmpleadosPanel');

    if (homeHeader) homeHeader.style.display = 'none';
    if (dashboardResumen) dashboardResumen.style.display = 'none';
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
    const resumenMensual = document.getElementById('nominaResumenMensual');
    const matrizPanel = document.getElementById('nominaMatrizPanel');
    const panelQuincena = document.getElementById('nominaQuincenaPanel');
    const empleadosPanel = document.getElementById('nominaEmpleadosPanel');

    if (homeHeader) homeHeader.style.display = '';
    if (dashboardResumen) dashboardResumen.style.display = '';
    if (resumenMensual) resumenMensual.style.display = '';
    if (matrizPanel) matrizPanel.style.display = '';
    if (panelQuincena) panelQuincena.style.display = 'none';
    // Al volver al inicio restauramos la tabla de empleados
    if (empleadosPanel) empleadosPanel.style.display = '';
}

function actualizarEtiquetaQuincenaSeleccionada() {
    const label = document.getElementById('nominaQuincenaSeleccionadaLabel');
    if (!label) return;

    if (!nominaPeriodoSeleccionado) {
        label.style.display = 'none';
        label.textContent = '';
        return;
    }

    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mesNombre = meses[nominaPeriodoSeleccionado.mes] || nominaPeriodoSeleccionado.mes;
    const qText = nominaPeriodoSeleccionado.numero_quincena === 1 || nominaPeriodoSeleccionado.numero_quincena === '1'
        ? '1ª Quincena'
        : '2ª Quincena';
    label.textContent = `Período seleccionado: ${qText} de ${mesNombre} ${nominaPeriodoSeleccionado.anio}`;
    label.style.display = 'block';
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

        closeNominaQuincenaSeleccion();
        actualizarEtiquetaQuincenaSeleccionada();
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

function toggleComisionesMesPanel() {
    const panel = document.getElementById('comisionesMesPanel');
    if (!panel) return;

    const homeHeader = document.getElementById('comisionesHomeHeader');
    const isVisible = panel.style.display === 'block';
    if (!isVisible && !window._comisionesPeriodoActual) {
        if (typeof openComisionesPeriodoSeleccion === 'function') {
            openComisionesPeriodoSeleccion();
            return;
        }
    }

    panel.style.display = isVisible ? 'none' : 'block';
    if (homeHeader) {
        homeHeader.style.display = isVisible ? '' : 'none';
    }
}

function scrollToModuleSection(elementId) {
    const target = document.getElementById(elementId);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function consultarServicios() {
    scrollToModuleSection('serviciosCatalogo');
}

function consultarBancos() {
    scrollToModuleSection('prestamosTable');
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
                if (typeof actualizarResumenBancosDashboard === 'function') {
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
            if (typeof actualizarResumenBancosDashboard === 'function') {
                actualizarResumenBancosDashboard();
            }
        } catch (eDashInit) {
            console.warn('No se pudo inicializar resumen de bancos', eDashInit);
        }
    }

    // Comisiones
    const formComisiones = document.getElementById('comisionesPeriodoSeleccionForm');
    if (formComisiones && !formComisiones.dataset.bound) {
        const yearInput = document.getElementById('comisiones_periodo_anio');
        if (yearInput && !yearInput.value) yearInput.value = now.getFullYear();

        formComisiones.addEventListener('submit', (e) => {
            e.preventDefault();
            const anio = parseInt(document.getElementById('comisiones_periodo_anio').value, 10);
            const mes = parseInt(document.getElementById('comisiones_periodo_mes').value, 10);
            if (!anio || !mes) {
                showError('Debe seleccionar mes y año para Comisiones.');
                return;
            }
            window._comisionesPeriodoActual = { mes, anio };
            try {
                if (window.localStorage) {
                    localStorage.setItem('comisionesPeriodoActual', JSON.stringify(window._comisionesPeriodoActual));
                }
            } catch (storageError) {
                console.warn('No se pudo guardar periodo de comisiones', storageError);
            }
            actualizarEtiquetaComisionesPeriodo();
            closeComisionesPeriodoSeleccion();

            const panel = document.getElementById('comisionesMesPanel');
            const homeHeader = document.getElementById('comisionesHomeHeader');
            if (panel) panel.style.display = 'block';
            if (homeHeader) homeHeader.style.display = 'none';
        });
        formComisiones.dataset.bound = 'true';
        actualizarEtiquetaComisionesPeriodo();
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

function actualizarEtiquetaComisionesPeriodo() {
    const label = document.getElementById('comisionesMesSeleccionadoLabel');
    const resumen = document.getElementById('comisionesMesActual');

    if (!window._comisionesPeriodoActual) {
        if (label) label.textContent = 'Período Comisiones (Mes/Año) · selección pendiente';
        if (resumen) resumen.textContent = 'No hay mes en proceso registrado.';
        return;
    }

    const { mes, anio } = window._comisionesPeriodoActual;
    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mesNombre = meses[mes] || mes;

    if (label) label.textContent = `Período seleccionado: ${mesNombre} ${anio}`;
    if (resumen) resumen.textContent = `Mes en proceso: ${mesNombre} ${anio}`;
}

function openComisionesPeriodoSeleccion() {
    const modal = document.getElementById('comisionesPeriodoSeleccionModal');
    if (!modal) return;

    const now = new Date();
    const base = window._comisionesPeriodoActual || { mes: now.getMonth() + 1, anio: now.getFullYear() };

    const anioInput = document.getElementById('comisiones_periodo_anio');
    const mesSelect = document.getElementById('comisiones_periodo_mes');
    if (anioInput) anioInput.value = base.anio;
    if (mesSelect) mesSelect.value = String(base.mes);

    modal.classList.add('active');
}

function closeComisionesPeriodoSeleccion() {
    const modal = document.getElementById('comisionesPeriodoSeleccionModal');
    if (modal) modal.classList.remove('active');
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

        let result = null;
        try {
            result = await response.json();
        } catch (err) {
            const text = await response.text();
            result = { error: text || 'Respuesta inválida del servidor' };
        }

        if (response.ok) {
            procesarResultadoLiquidacion(result);
        } else {
            showError(result.error || 'Error al liquidar quincena');
        }
    } catch (error) {
        console.error('Error al pre-liquidar quincena seleccionada:', error);
        showError('Error de conexión al liquidar quincena');
    }
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
            const module = item.dataset.module;
            switchModule(module);
            
            // Update active state
            menuItems.forEach(mi => mi.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

function switchModule(moduleName) {
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
    } else if (moduleName === 'comisiones') {
        displayName = 'GestiÃ³n de Comisiones';
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
    if (moduleName === 'comisiones') {
        displayName = 'Gestion de Comisiones';
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
            if (typeof loadNominaDashboard === 'function') {
                loadNominaDashboard();
            }
            // Siempre que entremos al módulo Nómina, mostrar vista de inicio
            volverInicioNomina();
        } else if (moduleName === 'usuarios') {
            loadUsuarios();
        } else if (moduleName === 'dashboard') {
            loadDashboardData();
        } else if (moduleName === 'comisiones') {
            try {
                const panelMes = document.getElementById('comisionesMesPanel');
                const homeHeader = document.getElementById('comisionesHomeHeader');
                if (panelMes) panelMes.style.display = 'none';
                if (homeHeader) homeHeader.style.display = '';
                actualizarEtiquetaComisionesPeriodo();
            } catch (e) {
                console.error('Error inicializando modulo Comisiones', e);
            }
        } else if (moduleName === 'servicios') {
            // Módulo Servicios usa su propio JS para cargar catálogo completo
            try {
                const ph = document.getElementById('serviciosCatalogoPlaceholder');
                if (ph) ph.style.display = 'none';
                if (typeof loadServicesList === 'function') {
                    loadServicesList();
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
                if (typeof actualizarResumenBancosDashboard === 'function') {
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
async function loadNominaDashboard() {
    const totalEmpEl = document.getElementById('nominaTotalEmpleados');
    const planillaEl = document.getElementById('nominaEmpleadosPlanilla');
    const pagadaMesEl = document.getElementById('nominaPagadaMes');
    const pendienteEl = document.getElementById('nominaPendientePagar');
    const quinEl = document.getElementById('nominaQuincenaActual');
    const matrizYearEl = document.getElementById('nominaMatrizAnio');

    const q1TotalEl = document.getElementById('nominaQ1Total');
    const q1PagadoEl = document.getElementById('nominaQ1Pagado');
    const q1SaldoEl = document.getElementById('nominaQ1Saldo');
    const q2TotalEl = document.getElementById('nominaQ2Total');
    const q2PagadoEl = document.getElementById('nominaQ2Pagado');
    const q2SaldoEl = document.getElementById('nominaQ2Saldo');
    const totalMesEl = document.getElementById('nominaTotalMes');
    const anioPreferido = nominaPeriodoSeleccionado?.anio || new Date().getFullYear();
    const matrizAnio = nominaPeriodoSeleccionado?.anio || parseInt(matrizYearEl?.value, 10) || anioPreferido;
    const params = new URLSearchParams({ anio: String(matrizAnio) });

    if (matrizYearEl && (!matrizYearEl.value || nominaPeriodoSeleccionado?.anio)) {
        matrizYearEl.value = String(matrizAnio);
    }

    if (nominaPeriodoSeleccionado?.mes && nominaPeriodoSeleccionado?.numero_quincena && nominaPeriodoSeleccionado?.anio) {
        params.set('referencia_mes', String(nominaPeriodoSeleccionado.mes));
        params.set('referencia_numero_quincena', String(nominaPeriodoSeleccionado.numero_quincena));
        params.set('referencia_anio', String(nominaPeriodoSeleccionado.anio));
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
                nominaPeriodoSeleccionado?.mes &&
                nominaPeriodoSeleccionado?.numero_quincena &&
                nominaPeriodoSeleccionado?.anio &&
                Number(quincenaBackend.mes) === Number(nominaPeriodoSeleccionado.mes) &&
                Number(quincenaBackend.numero_quincena) === Number(nominaPeriodoSeleccionado.numero_quincena) &&
                Number(quincenaBackend.anio) === Number(nominaPeriodoSeleccionado.anio);

            const q = (nominaPeriodoSeleccionado?.mes && nominaPeriodoSeleccionado?.numero_quincena && nominaPeriodoSeleccionado?.anio)
                ? {
                    mes: nominaPeriodoSeleccionado.mes,
                    numero_quincena: nominaPeriodoSeleccionado.numero_quincena,
                    anio: nominaPeriodoSeleccionado.anio,
                    fecha_inicio: backendCoincideSeleccion ? quincenaBackend.fecha_inicio : null,
                    fecha_fin: backendCoincideSeleccion ? quincenaBackend.fecha_fin : null,
                    procesada: backendCoincideSeleccion ? quincenaBackend.procesada : false,
                    pagos_finalizados: backendCoincideSeleccion ? quincenaBackend.pagos_finalizados : false
                }
                : quincenaBackend;
            if (q.mes && q.numero_quincena && q.anio) {
                const quincenaLabel = q.numero_quincena === 1 ? '1ª quincena' : '2ª quincena';
                const estado = q.pagos_finalizados ? 'FINALIZADA' : (q.procesada ? 'EN PROCESO' : 'PENDIENTE');
                const rango = q.fecha_inicio && q.fecha_fin ? ` (${q.fecha_inicio} a ${q.fecha_fin})` : '';
                quinEl.textContent = `${q.mes}/${q.anio} - ${quincenaLabel}${rango} - ${estado}`;
            } else {
                quinEl.textContent = 'No hay quincena en proceso registrada.';
            }
        }
    } catch (err) {
        console.error('Error cargando dashboard de nómina', err);
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

    if (yearEl) yearEl.value = String(matriz.anio || new Date().getFullYear());
    if (resumen) resumen.textContent = `${matriz.filas.length} empleados visibles en el tablero ${matriz.anio}`;

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
        if (moduleName === 'comisiones') {
            document.getElementById('moduleTitle').textContent = 'Gestion de Comisiones';
        }
        // load module-specific handlers
        if (moduleName === 'nomina') loadEmpleados();
        else if (moduleName === 'usuarios') loadUsuarios();
        else if (moduleName === 'dashboard') loadDashboardData();
        else if (moduleName === 'comisiones') {
            const panelMes = document.getElementById('comisionesMesPanel');
            const homeHeader = document.getElementById('comisionesHomeHeader');
            if (panelMes) panelMes.style.display = 'none';
            if (homeHeader) homeHeader.style.display = '';
            actualizarEtiquetaComisionesPeriodo();
        }
        else if (moduleName === 'bancos' && typeof loadPrestamosResumen === 'function') loadPrestamosResumen();
    } else {
        alert('No existe la vista completa para este módulo.');
    }
}

function setupLogout() {
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
            localStorage.removeItem('user');
            window.location.href = '/';
        } catch (error) {
            console.error('Error al cerrar sesión:', error);
            localStorage.removeItem('user');
            window.location.href = '/';
        }
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

async function loadUsuarios() {
    const tableBody = document.getElementById('usuariosTable');
    
    try {
        const response = await fetch('/api/usuarios/', {
            credentials: 'include'
        });
        const usuarios = await response.json();
        
        if (usuarios.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="loading">No hay usuarios registrados</td></tr>';
            return;
        }
        
        tableBody.innerHTML = usuarios.map(user => `
            <tr>
                <td>${user.usuario}</td>
                <td>${user.email || 'N/A'}</td>
                <td>${user.role || 'N/A'}</td>
                <td>
                    <span class="badge ${user.activo ? 'badge-success' : 'badge-danger'}">
                        ${user.activo ? 'Activo' : 'Inactivo'}
                    </span>
                </td>
                <td>
                    <button class="action-btn action-btn-edit" onclick="editUsuario(${user.id})">Editar</button>
                    ${user.usuario !== 'admin' ? `<button class="action-btn action-btn-delete" onclick="deleteUsuario(${user.id}, '${user.usuario}')">Eliminar</button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error cargando usuarios:', error);
        tableBody.innerHTML = '<tr><td colspan="5" class="loading">Error al cargar usuarios</td></tr>';
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

function showNewUserForm() {
    showError('Funcionalidad en desarrollo: Crear nuevo usuario');
}

function editUsuario(id) {
    showError('Funcionalidad en desarrollo: Editar usuario #' + id);
}

function deleteUsuario(id, username) {
    if (confirm(`¿Está seguro de eliminar al usuario ${username}?`)) {
        showError('Funcionalidad en desarrollo: Eliminar usuario');
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
            let result = null;
            try {
                result = await response.json();
            } catch (err) {
                // Si no se pudo parsear JSON, intentar obtener texto crudo
                const text = await response.text();
                result = { error: text || 'Respuesta inválida del servidor' };
            }

            if (response.ok) {
                procesarResultadoLiquidacion(result);
                return;
            }

            showError(result.error || 'Error al liquidar quincena');
            return;
        } catch (error) {
            console.error('Error al liquidar quincena automáticamente:', error);
            showError('Error de conexión al liquidar quincena');
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
        
        let result = null;
        try {
            result = await response.json();
        } catch (err) {
            const text = await response.text();
            result = { error: text || 'Respuesta inválida del servidor' };
        }

        if (response.ok) {
            procesarResultadoLiquidacion(result);
        } else {
            showError(result.error || 'Error al liquidar quincena');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al liquidar quincena');
    }
}

function procesarResultadoLiquidacion(result) {
    ultimaLiquidacionData = result;
    closeLiquidacionModal();
    mostrarResultadosLiquidacion(result);
    showSuccess('✅ Liquidación calculada exitosamente\n\nAhora proceda a registrar los pagos y finalice con "🔒 Finalizar Pago Quincena"');
}

function mostrarResultadosLiquidacion(data) {
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
