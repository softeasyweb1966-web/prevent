// JS helpers for módulo Bancos / Préstamos de empresa

function setupPrestamosModule() {
    const form = document.getElementById('prestamoEmpresaForm');
    if (form && !form.dataset.bound) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitPrestamoEmpresaForm();
        });
        form.dataset.bound = 'true';
    }

    const novForm = document.getElementById('prestamoNovedadForm');
    if (novForm && !novForm.dataset.bound) {
        novForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitPrestamoNovedadForm();
        });
        novForm.dataset.bound = 'true';
    }

    const novMesForm = document.getElementById('prestamosNovedadesForm');
    if (novMesForm && !novMesForm.dataset.bound) {
        const yearInput = document.getElementById('prest_nov_anio');
        if (yearInput) yearInput.value = new Date().getFullYear();
        loadPrestamosSelect('prest_nov_prestamo_select');
        novMesForm.addEventListener('submit', submitPrestamosNovedadesForm);
        novMesForm.dataset.bound = 'true';
    }

    const pagoForm = document.getElementById('prestamoPagoForm');
    if (pagoForm && !pagoForm.dataset.bound) {
        pagoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitPrestamoPagoForm();
        });
        pagoForm.dataset.bound = 'true';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupPrestamosModule);
} else {
    setupPrestamosModule();
}

// Resumen de totales para el dashboard de Bancos (similar a Servicios)
async function actualizarResumenBancosDashboard() {
    const conCargoSpan = document.getElementById('bancosConCargoMes');
    const totalProgSpan = document.getElementById('bancosTotalProgramadoMes');
    const totalPagadoSpan = document.getElementById('bancosTotalPagadoMes');

    // Si el resumen no está en el DOM, no hacemos nada
    if (!conCargoSpan && !totalProgSpan && !totalPagadoSpan) return;

    const periodo = window._bancosPeriodoActual;
    if (!periodo) {
        if (conCargoSpan) conCargoSpan.textContent = '-';
        if (totalProgSpan) totalProgSpan.textContent = '-';
        if (totalPagadoSpan) totalPagadoSpan.textContent = '-';
        return;
    }

    const params = new URLSearchParams({
        desde_mes: periodo.mes,
        desde_anio: periodo.anio,
        hasta_mes: periodo.mes,
        hasta_anio: periodo.anio,
    });

    try {
        const res = await fetch('/api/bancos/historial?' + params.toString(), { credentials: 'include' });
        if (!res.ok) {
            if (conCargoSpan) conCargoSpan.textContent = '-';
            if (totalProgSpan) totalProgSpan.textContent = '-';
            if (totalPagadoSpan) totalPagadoSpan.textContent = '-';
            return;
        }
        const data = await res.json();
        const items = Array.isArray(data) ? data : [];

        let conCargo = 0;
        let totalProgramado = 0;
        let totalPagado = 0;

        items.forEach((entry) => {
            const tot = entry.totales || {};
            const prog = Number(tot.total_programado || 0);
            const pag = Number(tot.total_pagado || 0);
            if (prog > 0) {
                conCargo += 1;
            }
            totalProgramado += prog;
            totalPagado += pag;
        });

        if (conCargoSpan) conCargoSpan.textContent = String(conCargo);
        if (totalProgSpan) {
            totalProgSpan.textContent = totalProgramado.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
        }
        if (totalPagadoSpan) {
            totalPagadoSpan.textContent = totalPagado.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
        }
    } catch (err) {
        console.error('Error actualizando resumen de bancos', err);
        if (conCargoSpan) conCargoSpan.textContent = '-';
        if (totalProgSpan) totalProgSpan.textContent = '-';
        if (totalPagadoSpan) totalPagadoSpan.textContent = '-';
    }
}

function renderBancosMatrizAnual(matriz, errorMessage = '') {
    const head = document.getElementById('bancosMatrizHead');
    const body = document.getElementById('bancosMatrizBody');
    const foot = document.getElementById('bancosMatrizFoot');
    const resumen = document.getElementById('bancosMatrizResumen');
    const yearEl = document.getElementById('bancosMatrizAnio');

    if (!head || !body || !foot) return;

    if (!matriz || !Array.isArray(matriz.periodos) || !Array.isArray(matriz.filas)) {
        head.innerHTML = '';
        foot.innerHTML = '';
        body.innerHTML = `<tr><td colspan="15" class="loading">${escapeHtml(errorMessage || 'No hay datos de préstamos para construir la matriz.')}</td></tr>`;
        if (resumen) resumen.textContent = errorMessage || 'Sin información anual de préstamos.';
        return;
    }

    if (yearEl) yearEl.value = String(matriz.anio || new Date().getFullYear());
    if (resumen) resumen.textContent = `${matriz.filas.length} préstamos visibles en el tablero ${matriz.anio}`;

    head.innerHTML = `
        <tr>
            <th>Préstamo</th>
            <th>Valor Base</th>
            ${matriz.periodos.map(periodo => `<th>${escapeHtml(periodo.label)}</th>`).join('')}
            <th>Total Cancelado</th>
            <th>Saldo Pendiente</th>
        </tr>
    `;

    if (matriz.filas.length === 0) {
        body.innerHTML = `<tr><td colspan="${matriz.periodos.length + 4}" class="loading">No hay préstamos con información para ${matriz.anio}.</td></tr>`;
        foot.innerHTML = '';
        return;
    }

    body.innerHTML = matriz.filas.map(fila => `
        <tr>
            <td class="nomina-matriz-empleado">${escapeHtml(fila.item || 'N/A')}</td>
            <td class="nomina-matriz-money">${formatCurrencyCompact(fila.valor_base || 0)}</td>
            ${(fila.celdas || []).map(celda => `
                <td class="nomina-matriz-cell nomina-matriz-${String(celda.estado || 'BLANK').toLowerCase()}" title="${escapeHtml(celda.titulo || '')}">
                    ${escapeHtml(celda.texto || '')}
                </td>
            `).join('')}
            <td class="nomina-matriz-money">${formatCurrencyCompact(fila.total_cancelado || 0)}</td>
            <td class="nomina-matriz-money">${formatCurrencyCompact(fila.saldo_pendiente || 0)}</td>
        </tr>
    `).join('');

    const totalesPeriodos = matriz.periodos.map(periodo => {
        const total = matriz.totales?.periodos?.[periodo.key] || 0;
        return `<td class="nomina-matriz-total" title="${formatCurrency(total)}">${formatCurrencyCompact(total)}</td>`;
    }).join('');

    foot.innerHTML = `
        <tr>
            <td class="nomina-matriz-total-label">Totales</td>
            <td class="nomina-matriz-total" title="${formatCurrency(matriz.totales?.valor_base || 0)}">${formatCurrencyCompact(matriz.totales?.valor_base || 0)}</td>
            ${totalesPeriodos}
            <td class="nomina-matriz-total" title="${formatCurrency(matriz.totales?.total_cancelado || 0)}">${formatCurrencyCompact(matriz.totales?.total_cancelado || 0)}</td>
            <td class="nomina-matriz-total" title="${formatCurrency(matriz.totales?.saldo_pendiente || 0)}">${formatCurrencyCompact(matriz.totales?.saldo_pendiente || 0)}</td>
        </tr>
    `;
}

async function loadBancosDashboardFull() {
    const activosEl = document.getElementById('bancosTotalActivos');
    const conCargoEl = document.getElementById('bancosConCargoMes');
    const totalProgramadoEl = document.getElementById('bancosTotalProgramadoMes');
    const totalPagadoEl = document.getElementById('bancosTotalPagadoMes');
    const yearEl = document.getElementById('bancosMatrizAnio');

    try {
        const periodo = window._bancosPeriodoActual || {
            mes: new Date().getMonth() + 1,
            anio: new Date().getFullYear()
        };
        const anio = parseInt(yearEl?.value, 10) || periodo.anio || new Date().getFullYear();
        const params = new URLSearchParams({
            anio: String(anio),
            referencia_mes: String(periodo.mes),
            referencia_anio: String(periodo.anio)
        });

        const res = await fetch('/api/dashboard/bancos?' + params.toString(), { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'No se pudo cargar el dashboard de préstamos');
        }

        if (activosEl) activosEl.textContent = String(data.total_prestamos_activos ?? '-');
        if (conCargoEl) conCargoEl.textContent = String(data.prestamos_con_cargo_mes ?? '-');
        if (totalProgramadoEl) totalProgramadoEl.textContent = formatCurrencyCompact(data.total_programado_mes || 0);
        if (totalPagadoEl) totalPagadoEl.textContent = formatCurrencyCompact(data.total_pagado_mes || 0);

        renderBancosMatrizAnual(data.matriz_anual);
    } catch (err) {
        console.error('Error cargando dashboard de bancos', err);
        if (activosEl) activosEl.textContent = '-';
        if (conCargoEl) conCargoEl.textContent = '-';
        if (totalProgramadoEl) totalProgramadoEl.textContent = '-';
        if (totalPagadoEl) totalPagadoEl.textContent = '-';
        renderBancosMatrizAnual(null, err.message || 'Error al cargar matriz de préstamos');
    }
}

async function loadPrestamosResumen() {
    const tbody = document.getElementById('prestamosTable');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="9" class="loading">Cargando préstamos...</td></tr>';

    try {
        const res = await fetch('/api/bancos/prestamos', { credentials: 'include' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const msg = err.error || 'Error al cargar préstamos';
            tbody.innerHTML = `<tr><td colspan="9" class="loading" style="color:#e74c3c;">${msg}</td></tr>`;
            console.error('loadPrestamosResumen error', msg);
            return;
        }
        const payload = await res.json();
        const data = payload.data || payload.prestamos || payload || [];
        if (!data || !data.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="loading">No hay préstamos de empresa registrados.</td></tr>';
            // Actualizar contador de préstamos activos en el dashboard, si existe
            try {
                const spanActivos = document.getElementById('bancosTotalActivos');
                if (spanActivos) spanActivos.textContent = '0';
            } catch (eSpan) {
                console.warn('No se pudo actualizar bancosTotalActivos (sin datos)', eSpan);
            }
            return;
        }

        tbody.innerHTML = '';
        let activosCount = 0;
        data.forEach((p) => {
            if (p.activo !== false) {
                activosCount += 1;
            }
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(p.nombre || '')}</td>
                <td>${p.fecha_inicio || ''}</td>
                <td>${p.fecha_final || ''}</td>
                <td style="text-align:right;">${p.cantidad_cuotas || ''}</td>
                <td style="text-align:right;">${Number(p.valor_prestamo || 0).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                <td style="text-align:right;">${p.porcentaje_interes != null ? Number(p.porcentaje_interes).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2}) : ''}</td>
                <td style="text-align:right;">${p.valor_cuota != null ? Number(p.valor_cuota).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2}) : ''}</td>
                <td style="text-align:center;">${p.dia_pago || ''}</td>
                <td>${escapeHtml(p.modalidad_pago || '')}</td>
            `;
            tbody.appendChild(tr);
        });

        // Actualizar total de préstamos activos en el resumen del módulo Bancos
        try {
            const spanActivos = document.getElementById('bancosTotalActivos');
            if (spanActivos) {
                spanActivos.textContent = String(activosCount);
            }
        } catch (eSpan2) {
            console.warn('No se pudo actualizar bancosTotalActivos', eSpan2);
        }
    } catch (err) {
        console.error('loadPrestamosResumen exception', err);
        tbody.innerHTML = '<tr><td colspan="9" class="loading" style="color:#e74c3c;">Error al cargar préstamos</td></tr>';
    }
}

function showNewPrestamoModal() {
    const modal = document.getElementById('prestamoEmpresaModal');
    if (!modal) {
        alert('Formulario de préstamo no disponible');
        return;
    }
    const form = document.getElementById('prestamoEmpresaForm');
    if (form) {
        form.reset();
        form.dataset.editingId = '';
    }
    modal.classList.add('active');
}

function closePrestamoEmpresaModal() {
    const modal = document.getElementById('prestamoEmpresaModal');
    if (modal) modal.classList.remove('active');
}

async function submitPrestamoEmpresaForm() {
    const form = document.getElementById('prestamoEmpresaForm');
    if (!form) return;

    const payload = {
        nombre: form.nombre.value,
        tipo_prestatario: form.tipo_prestatario.value || null,
        fecha_inicio: form.fecha_inicio.value || null,
        fecha_final: form.fecha_final.value || null,
        cantidad_cuotas: form.cantidad_cuotas.value ? Number(form.cantidad_cuotas.value) : null,
        valor_prestamo: form.valor_prestamo.value ? Number(form.valor_prestamo.value) : 0,
        porcentaje_interes: form.porcentaje_interes.value ? Number(form.porcentaje_interes.value) : null,
        valor_cuota: form.valor_cuota.value ? Number(form.valor_cuota.value) : null,
        dia_pago: form.dia_pago.value ? Number(form.dia_pago.value) : null,
        modalidad_pago: form.modalidad_pago.value || 'BANCARIO',
        frecuencia_cadena: form.frecuencia_cadena.value || null,
        fecha_recibe_cadena: form.fecha_recibe_cadena.value || null,
    };

    const editingId = form.dataset.editingId;
    const url = editingId ? `/api/bancos/prestamos/${editingId}` : '/api/bancos/prestamos';
    const method = editingId ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Error al guardar préstamo');
        }
        closePrestamoEmpresaModal();
        loadPrestamosResumen();
    } catch (err) {
        console.error('submitPrestamoEmpresaForm error', err);
        alert(err.message || 'Error al guardar préstamo');
    }
}

function reloadPrestamosResumen() {
    loadPrestamosResumen();
}

// ---------- Novedades de préstamos ----------

async function loadPrestamosSelect(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '<option value="">Seleccionar...</option>';
    try {
        const res = await fetch('/api/bancos/prestamos?activos=true', { credentials: 'include' });
        if (!res.ok) return;
        const payload = await res.json();
        const data = payload.data || payload.prestamos || payload || [];
        data.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.nombre || `Préstamo ${p.id}`;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('loadPrestamosSelect error', err);
    }
}

function showNewPrestamoNovedadModal() {
    const modal = document.getElementById('prestamoNovedadModal');
    const form = document.getElementById('prestamoNovedadForm');
    if (!modal || !form) return;
    form.reset();
    form.dataset.editId = '';
    loadPrestamosSelect('prestamo_nov_prestamo_id');
    modal.classList.add('active');
}

function closePrestamoNovedadModal() {
    const modal = document.getElementById('prestamoNovedadModal');
    if (modal) modal.classList.remove('active');
}

async function submitPrestamoNovedadForm() {
    const form = document.getElementById('prestamoNovedadForm');
    if (!form) return;

    const prestamoId = form.prestamo_id.value;
    if (!prestamoId) {
        alert('Seleccione un préstamo');
        return;
    }

    const payload = {
        valor_a_pagar: form.valor_a_pagar.value ? Number(form.valor_a_pagar.value) : 0,
        fecha_limite_pago: form.fecha_limite_pago.value || null,
        descripcion: form.descripcion.value || null,
        cumplida: !!form.cumplida.checked,
    };

    try {
        const res = await fetch(`/api/bancos/prestamos/${prestamoId}/novedades`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Error al guardar novedad');
        }
        closePrestamoNovedadModal();
        if (window.showToast) {
            showToast('Novedad de préstamo guardada');
        }
        // Si el modal de listado está abierto, recargarlo
        const listadoModal = document.getElementById('prestamosNovedadesModal');
        if (listadoModal && listadoModal.classList.contains('active')) {
            reloadPrestamosNovedades();
        }
        try { loadPrestamosNovedadesMesActual('bancosNovedadesInlineBody'); } catch (e1) {}
        try { loadBancosDashboardFull(); } catch (e2) {}
    } catch (err) {
        console.error('submitPrestamoNovedadForm error', err);
        alert(err.message || 'Error al guardar novedad');
    }
}

function showPrestamosNovedadesModal() {
    const modal = document.getElementById('prestamosNovedadesModal');
    const form = document.getElementById('prestamosNovedadesForm');
    if (!modal || !form) return;
    form.reset();

    // Al abrir desde el botón de "Historial" queremos permitir
    // elegir libremente el período, así que nos aseguramos de que
    // los campos de período estén habilitados.
    const periodoRow = document.getElementById('prestamosPeriodoRow');
    if (periodoRow) periodoRow.style.display = '';
    const pagosSection = document.getElementById('prestamosPagosSection');
    if (pagosSection) pagosSection.style.display = '';
    const mesSelect = document.getElementById('prest_nov_mes');
    if (mesSelect) {
        mesSelect.disabled = false;
        mesSelect.required = true;
    }
    const yearInput = document.getElementById('prest_nov_anio');
    if (yearInput) {
        yearInput.readOnly = false;
        yearInput.disabled = false;
        yearInput.required = true;
        yearInput.value = new Date().getFullYear();
    }

    // Restaurar etiquetas a la versión "normal" con asterisco
    const mesLabel = document.querySelector('label[for="prest_nov_mes"]');
    if (mesLabel) mesLabel.textContent = 'Mes *';
    const anioLabel = document.querySelector('label[for="prest_nov_anio"]');
    if (anioLabel) anioLabel.textContent = 'Año *';
    loadPrestamosSelect('prest_nov_prestamo_select');
    const tbody = document.getElementById('prestamosNovedadesBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Seleccione mes y año para ver novedades.</td></tr>';
        delete tbody.dataset.lastQuery;
    }
    const tbodyPagos = document.getElementById('prestamosPagosBody');
    if (tbodyPagos) {
        tbodyPagos.innerHTML = '<tr><td colspan="5" class="loading">Seleccione mes y año para ver pagos.</td></tr>';
    }
    modal.classList.add('active');
}

function closePrestamosNovedadesModal() {
    const modal = document.getElementById('prestamosNovedadesModal');
    if (modal) modal.classList.remove('active');
}

// Mostrar novedades/pagos usando SIEMPRE el período actual de Bancos
// (window._bancosPeriodoActual), sin volver a pedir Mes/Año al usuario.
function showPrestamosNovedadesForPeriodoActual() {
    if (!window._bancosPeriodoActual) {
        if (typeof openBancosPeriodoSeleccion === 'function') {
            openBancosPeriodoSeleccion();
        } else {
            alert('Debe seleccionar primero el período de préstamos (Mes/Año) desde el botón "Mes".');
        }
        return;
    }

    const modal = document.getElementById('prestamosNovedadesModal');
    const form = document.getElementById('prestamosNovedadesForm');
    if (!modal || !form) return;

    const { mes, anio } = window._bancosPeriodoActual;

    const periodoRow = document.getElementById('prestamosPeriodoRow');
    if (periodoRow) periodoRow.style.display = 'none';

    // En el flujo de Novedades (como en Nómina) no
    // mostramos la tabla de Pagos; sólo novedades.
    const pagosSection = document.getElementById('prestamosPagosSection');
    if (pagosSection) pagosSection.style.display = 'none';

    const mesSelect = document.getElementById('prest_nov_mes');
    const yearInput = document.getElementById('prest_nov_anio');
    if (mesSelect) {
        mesSelect.value = String(mes);
        mesSelect.disabled = true;
        mesSelect.required = false;
    }
    if (yearInput) {
        yearInput.value = anio;
        yearInput.readOnly = true;
        yearInput.disabled = false; // permitir envío del formulario
        yearInput.required = false;
    }

    // Ajustar etiquetas para dejar claro que se usa el período actual
    const mesLabel = document.querySelector('label[for="prest_nov_mes"]');
    if (mesLabel) mesLabel.textContent = 'Mes (período actual)';
    const anioLabel = document.querySelector('label[for="prest_nov_anio"]');
    if (anioLabel) anioLabel.textContent = 'Año (período actual)';

    // Mensajes de carga basados en el período actual
    const tbodyNov = document.getElementById('prestamosNovedadesBody');
    if (tbodyNov) {
        tbodyNov.innerHTML = '<tr><td colspan="6" class="loading">Use "Consultar" para ver las novedades del mes actual.</td></tr>';
    }
    const tbodyPag = document.getElementById('prestamosPagosBody');
    if (tbodyPag) {
        tbodyPag.innerHTML = '<tr><td colspan="5" class="loading">Use "Consultar" para ver los pagos del mes actual.</td></tr>';
    }

    modal.classList.add('active');

    // Cargar automáticamente las novedades/pagos del período actual
    consultarPrestamosHistorial(String(mes), String(anio), '', false);
}

async function submitPrestamosNovedadesForm(e) {
    e.preventDefault();
    const form = document.getElementById('prestamosNovedadesForm');
    if (!form) return;
    const mes = form.mes.value;
    const anio = form.anio.value;
    const prestamoId = form.prestamo_id ? form.prestamo_id.value : '';
    await consultarPrestamosHistorial(mes, anio, prestamoId, true);
}

// Helper reutilizable para consultar historial de novedades/pagos por período
async function consultarPrestamosHistorial(mes, anio, prestamoId, validarPeriodo) {
    if (validarPeriodo && (!mes || !anio)) {
        alert('Seleccione mes y año');
        return;
    }

    if (!mes || !anio) return;

    const params = new URLSearchParams({
        desde_mes: mes,
        desde_anio: anio,
        hasta_mes: mes,
        hasta_anio: anio,
    });
    if (prestamoId) params.set('prestamo_id', prestamoId);

    const tbody = document.getElementById('prestamosNovedadesBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Cargando...</td></tr>';
        tbody.dataset.lastQuery = params.toString();
    }

    try {
        const res = await fetch('/api/bancos/historial?' + params.toString(), { credentials: 'include' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Error consultando novedades');
        }
        const data = await res.json();
        renderPrestamosNovedadesResultados(data);
        renderPrestamosPagosResultados(data);
    } catch (err) {
        console.error('consultarPrestamosHistorial error', err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:#e74c3c;">${err.message}</td></tr>`;
    }
}

async function reloadPrestamosNovedades() {
    const tbody = document.getElementById('prestamosNovedadesBody');
    if (!tbody || !tbody.dataset.lastQuery) return;
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Cargando...</td></tr>';
    try {
        const res = await fetch('/api/bancos/historial?' + tbody.dataset.lastQuery, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        renderPrestamosNovedadesResultados(data);
        renderPrestamosPagosResultados(data);
    } catch (err) {
        console.error('reloadPrestamosNovedades error', err);
    }
}

function renderPrestamosNovedadesResultados(data, targetBodyId) {
    const bodyId = targetBodyId || 'prestamosNovedadesBody';
    const tbody = document.getElementById(bodyId);
    if (!tbody) return;
    const items = data || [];
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#666;">No hay novedades para el periodo seleccionado.</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    items.forEach((entry) => {
        const prestamoNombre = entry.prestamo && entry.prestamo.nombre ? entry.prestamo.nombre : `Préstamo ${entry.prestamo && entry.prestamo.id ? entry.prestamo.id : ''}`;
        (entry.novedades || []).forEach((n) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(prestamoNombre)}</td>
                <td>${n.fecha_limite_pago || ''}</td>
                <td style="text-align:right;">${Number(n.valor_a_pagar || 0).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                <td>${escapeHtml(n.descripcion || '')}</td>
                <td style="text-align:center;">${n.cumplida ? 'Sí' : 'No'}</td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="deletePrestamoNovedad(${n.id})" title="Eliminar">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
    if (!tbody.children.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#666;">No hay novedades para el periodo seleccionado.</td></tr>';
    }
}

// Cargar novedades de préstamos del período actual directamente en un tbody específico
async function loadPrestamosNovedadesMesActual(targetBodyId) {
    const bodyId = targetBodyId || 'bancosNovedadesInlineBody';
    const tbody = document.getElementById(bodyId);
    if (!tbody) return;

    if (!window._bancosPeriodoActual) {
        if (typeof openBancosPeriodoSeleccion === 'function') {
            openBancosPeriodoSeleccion();
        } else {
            alert('Debe seleccionar primero el período de préstamos (Mes/Año) desde el botón "Mes".');
        }
        return;
    }

    const { mes, anio } = window._bancosPeriodoActual;
    const params = new URLSearchParams({
        desde_mes: mes,
        desde_anio: anio,
        hasta_mes: mes,
        hasta_anio: anio,
    });

    tbody.innerHTML = '<tr><td colspan="6" class="loading">Cargando novedades del mes...</td></tr>';

    try {
        const res = await fetch('/api/bancos/historial?' + params.toString(), { credentials: 'include' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Error consultando novedades de préstamos');
        }
        const data = await res.json();
        renderPrestamosNovedadesResultados(data, bodyId);
    } catch (err) {
        console.error('loadPrestamosNovedadesMesActual error', err);
        tbody.innerHTML = `<tr><td colspan="6" style="color:#e74c3c; text-align:center;">${err.message || 'Error cargando novedades del mes'}</td></tr>`;
    }
}

async function deletePrestamoNovedad(id) {
    if (!confirm('¿Eliminar esta novedad de préstamo? Esta acción no se puede deshacer.')) {
        return;
    }
    try {
        const res = await fetch(`/api/bancos/novedades/${id}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Error al eliminar novedad');
        }
        alert('Novedad eliminada');
        // Refrescar tanto el modal como el panel inline si están visibles
        try { reloadPrestamosNovedades(); } catch (e1) { console.warn('No se pudo recargar novedades de préstamos (modal)', e1); }
        try { loadPrestamosNovedadesMesActual('bancosNovedadesInlineBody'); } catch (e2) { console.warn('No se pudo recargar novedades inline de bancos', e2); }
    } catch (err) {
        console.error('deletePrestamoNovedad error', err);
        alert(err.message || 'Error al eliminar novedad');
    }
}

function renderPrestamosPagosResultados(data) {
    const tbody = document.getElementById('prestamosPagosBody');
    if (!tbody) return;
    const items = data || [];
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#666;">No hay pagos para el periodo seleccionado.</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    items.forEach((entry) => {
        const prestamoNombre = entry.prestamo && entry.prestamo.nombre ? entry.prestamo.nombre : `Préstamo ${entry.prestamo && entry.prestamo.id ? entry.prestamo.id : ''}`;
        (entry.pagos || []).forEach((p) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(prestamoNombre)}</td>
                <td>${p.fecha_pago || ''}</td>
                <td style="text-align:right;">${Number(p.valor_pagado || 0).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                <td>${escapeHtml(p.forma_pago || '')}</td>
                <td>${escapeHtml(p.observaciones || '')}</td>
            `;
            tbody.appendChild(tr);
        });
    });
    if (!tbody.children.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#666;">No hay pagos para el periodo seleccionado.</td></tr>';
    }
}

// ---------- Pagos de préstamos ----------

function showNewPrestamoPagoModal() {
    const modal = document.getElementById('prestamoPagoModal');
    const form = document.getElementById('prestamoPagoForm');
    if (!modal || !form) return;
    form.reset();
    loadPrestamosSelect('prestamo_pago_prestamo_id');
    const fechaInput = document.getElementById('prestamo_pago_fecha');
    if (fechaInput) {
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        fechaInput.value = `${y}-${m}-${d}`;
    }
    modal.classList.add('active');
}

function closePrestamoPagoModal() {
    const modal = document.getElementById('prestamoPagoModal');
    if (modal) modal.classList.remove('active');
}

async function submitPrestamoPagoForm() {
    const form = document.getElementById('prestamoPagoForm');
    if (!form) return;
    const prestamoId = form.prestamo_id.value;
    if (!prestamoId) {
        alert('Seleccione un préstamo');
        return;
    }
    const payload = {
        fecha_pago: form.fecha_pago.value || null,
        forma_pago: form.forma_pago.value || null,
        valor_pagado: form.valor_pagado.value ? Number(form.valor_pagado.value) : 0,
        observaciones: form.observaciones.value || null,
    };
    try {
        const res = await fetch(`/api/bancos/prestamos/${prestamoId}/pagos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Error al guardar pago');
        }
        closePrestamoPagoModal();
        if (window.showToast) {
            showToast('Pago de préstamo guardado');
        }
        const tbody = document.getElementById('prestamosPagosBody');
        if (tbody && tbody.dataset && tbody.dataset.lastQuery) {
            await reloadPrestamosNovedades();
        }
        try { loadBancosDashboardFull(); } catch (e1) {}
    } catch (err) {
        console.error('submitPrestamoPagoForm error', err);
        alert(err.message || 'Error al guardar pago');
    }
}

function ensurePrestamosActionsHeader() {
    const table = document.getElementById('prestamosTable')?.closest('table');
    if (!table) return;
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;
    const headers = Array.from(headerRow.querySelectorAll('th')).map((th) => th.textContent.trim().toLowerCase());
    if (!headers.includes('acciones')) {
        const th = document.createElement('th');
        th.textContent = 'Acciones';
        headerRow.appendChild(th);
    }
    const emptyCell = document.querySelector('#prestamosTable td[colspan="9"]');
    if (emptyCell) {
        emptyCell.colSpan = 10;
    }
}

loadPrestamosResumen = async function () {
    const tbody = document.getElementById('prestamosTable');
    if (!tbody) return;

    ensurePrestamosActionsHeader();
    tbody.innerHTML = '<tr><td colspan="10" class="loading">Cargando prestamos...</td></tr>';

    try {
        const res = await fetch('/api/bancos/prestamos', { credentials: 'include' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const msg = err.error || 'Error al cargar prestamos';
            tbody.innerHTML = `<tr><td colspan="10" class="loading" style="color:#e74c3c;">${msg}</td></tr>`;
            console.error('loadPrestamosResumen error', msg);
            return;
        }

        const payload = await res.json();
        const data = payload.data || payload.prestamos || payload || [];
        if (!data || !data.length) {
            tbody.innerHTML = '<tr><td colspan="10" class="loading">No hay prestamos de empresa registrados.</td></tr>';
            const spanActivos = document.getElementById('bancosTotalActivos');
            if (spanActivos) spanActivos.textContent = '0';
            return;
        }

        tbody.innerHTML = '';
        let activosCount = 0;
        data.forEach((p) => {
            if (p.activo !== false) {
                activosCount += 1;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(p.nombre || '')}</td>
                <td>${p.fecha_inicio || ''}</td>
                <td>${p.fecha_final || ''}</td>
                <td style="text-align:right;">${p.cantidad_cuotas || ''}</td>
                <td style="text-align:right;">${Number(p.valor_prestamo || 0).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                <td style="text-align:right;">${p.porcentaje_interes != null ? Number(p.porcentaje_interes).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2}) : ''}</td>
                <td style="text-align:right;">${p.valor_cuota != null ? Number(p.valor_cuota).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2}) : ''}</td>
                <td style="text-align:center;">${p.dia_pago || ''}</td>
                <td>${escapeHtml(p.modalidad_pago || '')}</td>
                <td>
                    <button class="action-btn action-btn-edit">Editar</button>
                    <button class="action-btn action-btn-delete">Eliminar</button>
                </td>
            `;

            const [editBtn, deleteBtn] = tr.querySelectorAll('button');
            if (editBtn) editBtn.onclick = () => editPrestamoEmpresa(p.id);
            if (deleteBtn) deleteBtn.onclick = () => deletePrestamoEmpresa(p.id, p.nombre || '');
            tbody.appendChild(tr);
        });

        const spanActivos = document.getElementById('bancosTotalActivos');
        if (spanActivos) {
            spanActivos.textContent = String(activosCount);
        }
    } catch (err) {
        console.error('loadPrestamosResumen exception', err);
        tbody.innerHTML = '<tr><td colspan="10" class="loading" style="color:#e74c3c;">Error al cargar prestamos</td></tr>';
    }
};

showNewPrestamoModal = function () {
    const modal = document.getElementById('prestamoEmpresaModal');
    if (!modal) {
        alert('Formulario de prestamo no disponible');
        return;
    }

    const form = document.getElementById('prestamoEmpresaForm');
    if (form) {
        form.reset();
        form.dataset.editingId = '';
    }

    const modalTitle = modal.querySelector('.modal-header h2');
    if (modalTitle) modalTitle.textContent = 'Nuevo Prestamo de Empresa';
    modal.classList.add('active');
};

async function editPrestamoEmpresa(id) {
    try {
        const res = await fetch(`/api/bancos/prestamos/${id}`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'Error al cargar prestamo');
        }

        const modal = document.getElementById('prestamoEmpresaModal');
        const form = document.getElementById('prestamoEmpresaForm');
        if (!modal || !form) return;

        form.nombre.value = data.nombre || '';
        form.tipo_prestatario.value = data.tipo_prestatario || '';
        form.fecha_inicio.value = data.fecha_inicio || '';
        form.fecha_final.value = data.fecha_final || '';
        form.cantidad_cuotas.value = data.cantidad_cuotas ?? '';
        form.valor_prestamo.value = data.valor_prestamo ?? '';
        form.porcentaje_interes.value = data.porcentaje_interes ?? '';
        form.valor_cuota.value = data.valor_cuota ?? '';
        form.dia_pago.value = data.dia_pago ?? '';
        form.modalidad_pago.value = data.modalidad_pago || 'BANCARIO';
        form.frecuencia_cadena.value = data.frecuencia_cadena || '';
        form.fecha_recibe_cadena.value = data.fecha_recibe_cadena || '';
        form.dataset.editingId = String(id);

        const modalTitle = modal.querySelector('.modal-header h2');
        if (modalTitle) modalTitle.textContent = 'Editar Prestamo de Empresa';
        modal.classList.add('active');
    } catch (err) {
        console.error('editPrestamoEmpresa error', err);
        alert(err.message || 'Error al cargar prestamo');
    }
}

async function deletePrestamoEmpresa(id, nombre = '') {
    const nombreMostrado = nombre ? ` ${nombre}` : '';
    if (!confirm(`Desea desactivar${nombreMostrado}?`)) return;

    try {
        const res = await fetch(`/api/bancos/prestamos/${id}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'Error al eliminar prestamo');
        }
        showToast('Prestamo desactivado');
        loadPrestamosResumen();
        try { loadBancosDashboardFull(); } catch (e) {}
    } catch (err) {
        console.error('deletePrestamoEmpresa error', err);
        showToast(err.message || 'Error al eliminar prestamo', 'error');
    }
}
