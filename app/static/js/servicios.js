// JS helper for Services module

// Contexto de período actual de Servicios (mes/año seleccionado por el usuario)
// Se intenta recuperar primero desde localStorage para que el usuario
// no tenga que volver a elegirlo en cada recarga.
(function initServiciosPeriodoFromStorage(){
    try {
        if (!window._serviciosPeriodoActual) {
            const raw = window.localStorage ? localStorage.getItem('serviciosPeriodoActual') : null;
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.mes === 'number' && typeof parsed.anio === 'number') {
                    window._serviciosPeriodoActual = parsed;
                }
            }
        }
    } catch (e) {
        console.warn('No se pudo recuperar periodo de servicios desde localStorage', e);
    }
    window._serviciosPeriodoActual = window._serviciosPeriodoActual || null;
})();

async function switchToServicios() {
    // ensure module title and view switching similar to switchModule
    document.getElementById('moduleTitle').textContent = 'Servicios';
    document.querySelectorAll('.module-view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById('serviciosView');
    if (view) view.classList.add('active');
    loadServicesList();
}

// Obtener el periodo (mes/año) actual de Servicios.
// Si ya está definido en memoria (window._serviciosPeriodoActual),
// se reutiliza sin consultar al backend.
async function obtenerPeriodoActualServicios() {
    const ahora = new Date();
    if (window._serviciosPeriodoActual) {
        return window._serviciosPeriodoActual;
    }
    try {
        const res = await fetch('/api/servicios/periodo-actual');
        if (!res.ok) throw new Error('respuesta no OK');
        const data = await res.json();
        const mes = data.mes || (ahora.getMonth() + 1);
        const anio = data.anio || ahora.getFullYear();
        const periodo = { mes, anio };
        window._serviciosPeriodoActual = periodo;
        try {
            if (window.localStorage) {
                localStorage.setItem('serviciosPeriodoActual', JSON.stringify(periodo));
            }
        } catch (eStore) {
            console.warn('No se pudo guardar periodo de servicios en localStorage', eStore);
        }
        try {
            if (typeof actualizarEtiquetaServiciosPeriodo === 'function') {
                actualizarEtiquetaServiciosPeriodo();
            }
        } catch (e) {
            console.warn('Error actualizando etiqueta de período de servicios', e);
        }
        return periodo;
    } catch (err) {
        console.warn('obtenerPeriodoActualServicios: usando fecha local por error', err);
        const periodo = { mes: ahora.getMonth() + 1, anio: ahora.getFullYear() };
        window._serviciosPeriodoActual = periodo;
        try {
            if (window.localStorage) {
                localStorage.setItem('serviciosPeriodoActual', JSON.stringify(periodo));
            }
        } catch (e2store) {
            console.warn('No se pudo guardar periodo de servicios en localStorage (fallback)', e2store);
        }
        try {
            if (typeof actualizarEtiquetaServiciosPeriodo === 'function') {
                actualizarEtiquetaServiciosPeriodo();
            }
        } catch (e2) {
            console.warn('Error actualizando etiqueta de período de servicios (fallback)', e2);
        }
        return periodo;
    }
}

// --- Services (catálogo) ---
async function loadServicesList() {
    try {
        const res = await fetch('/api/servicios/list');
        if (!res.ok) {
            console.error('loadServicesList: respuesta no OK', res.status);
            return;
        }
        const data = await res.json();
        const servicios = data.servicios || data.data || data.items || [];
        // Guardar catálogo en memoria para búsquedas rápidas por nombre
        window._serviciosCatalogo = servicios;
        // Actualizar total de servicios activos en el resumen del módulo
        try {
            const spanTotal = document.getElementById('serviciosTotalActivos');
            if (spanTotal) {
                spanTotal.textContent = servicios.length.toString();
            }
        } catch (eSpan) {
            console.warn('No se pudo actualizar serviciosTotalActivos', eSpan);
        }
        
        
        const container = document.getElementById('serviciosCatalogo');
        if (!container) { console.warn('loadServicesList: no existe #serviciosCatalogo'); return; }
        container.innerHTML = '';
    
        const table = document.createElement('table');
        table.className = 'data-table';
        table.innerHTML = `
            <thead><tr>
                <th>Servicio</th>
                <th>Referencia</th>
                <th>Día pago</th>
                <th>Modalidad (meses)</th>
                <th>Mes inicio</th>
                <th>Valor aprox.</th>
                <th>Acciones</th>
            </tr></thead>
            <tbody id="serviciosCatalogoBody"></tbody>
        `;
        container.appendChild(table);
        const tbody = document.getElementById('serviciosCatalogoBody');
        servicios.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(s.nombre)}</td>
                <td>${escapeHtml(s.referencia_pago || '')}</td>
                <td>${s.dia_pago || ''}</td>
                <td>${s.modalidad_pago_meses || 1}</td>
                <td>${s.mes_inicio_pago || ''}</td>
                <td>${s.valor_aproximado.toLocaleString()}</td>
                <td>
                    <button class="action-btn action-btn-edit" onclick="editServicio(${s.id})">Editar</button>
                    <button class="action-btn action-btn-delete" onclick="deleteServicio(${s.id})">Eliminar</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        // After rendering list, load payment alerts
        loadPaymentAlerts();
    } catch (err) {
        console.error('loadServicesList error', err);
    }
    
}

function escapeHtml(text){ if(text===null||text===undefined) return ''; return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function showNewServicioModal(){
    const form = document.getElementById('servicioForm');
    if (form) {
        form.reset();
        delete form.dataset.editId;
    }
    document.getElementById('servicioModal').classList.add('active');
}
function closeServicioModal(){ document.getElementById('servicioModal').classList.remove('active'); }

async function submitServicioForm(e){
    e.preventDefault();
    const form = document.getElementById('servicioForm');
    const payload = {
        nombre: form.nombre.value,
        referencia_pago: form.referencia_pago.value,
        dia_pago: form.dia_pago.value || null,
        valor_aproximado: form.valor_aproximado.value || 0,
        modalidad_pago_meses: parseInt(form.modalidad_pago_meses.value || '1', 10),
        mes_inicio_pago: form.mes_inicio_pago.value ? parseInt(form.mes_inicio_pago.value, 10) : null
    };
    const res = await fetch('/api/servicios/create', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    if (res.ok){ closeServicioModal(); loadServicesList(); showToast('Servicio creado'); }
    else { showToast('Error creando servicio', 'error'); }
}

function fillServicioFormFromData(id, s){
    const form = document.getElementById('servicioForm');
    form.nombre.value = s.nombre || '';
    form.referencia_pago.value = s.referencia_pago || '';
    form.dia_pago.value = s.dia_pago || '';
    form.valor_aproximado.value = s.valor_aproximado || 0;
    if (form.modalidad_pago_meses) {
        form.modalidad_pago_meses.value = s.modalidad_pago_meses || 1;
    }
    if (form.mes_inicio_pago) {
        form.mes_inicio_pago.value = s.mes_inicio_pago || '';
    }
    if (id) form.dataset.editId = id;
}

// simple edit/delete
async function editServicio(id){
    const res = await fetch(`/api/servicios/${id}`);
    if (!res.ok) return showToast('Error al cargar servicio','error');
    const raw = await res.json();
    const s = raw.data || raw;
    fillServicioFormFromData(id, s);
    document.getElementById('servicioModal').classList.add('active');
}

async function deleteServicio(id){
    if(!confirm('Eliminar servicio?')) return;
    const res = await fetch(`/api/servicios/${id}`, {method:'DELETE'});
    if (res.ok){ loadServicesList(); showToast('Servicio eliminado'); }
    else showToast('Error eliminando','error');
}

// modify submit to handle edit
async function submitServicioFormHandler(e){
    e.preventDefault();
    const form = document.getElementById('servicioForm');
    const editId = form.dataset.editId;
    const payload = {
        nombre: form.nombre.value,
        referencia_pago: form.referencia_pago.value,
        dia_pago: form.dia_pago.value || null,
        valor_aproximado: form.valor_aproximado.value || 0,
        modalidad_pago_meses: parseInt(form.modalidad_pago_meses.value || '1', 10),
        mes_inicio_pago: form.mes_inicio_pago.value ? parseInt(form.mes_inicio_pago.value, 10) : null
    };
    let res;
    if (editId){
        res = await fetch(`/api/servicios/${editId}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
        delete form.dataset.editId;
    } else {
        res = await fetch('/api/servicios/create', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
    }
    if (res.ok){ closeServicioModal(); loadServicesList(); showToast('Guardado'); }
    else showToast('Error guardando','error');
}

// --- Novedades (Servicios) ---
async function showNewServicioNovedadModal(){
    const form = document.getElementById('servicioNovedadForm');
    if (form) {
        form.reset();
        delete form.dataset.editId;
        // Prefijar mes/año con el periodo actual de Servicios
        try {
            const periodo = await obtenerPeriodoActualServicios();
            if (form.novedad_mes) {
                form.novedad_mes.value = String(periodo.mes);
            }
            const yearInput = form.novedad_anio || document.getElementById('novedad_anio');
            if (yearInput) yearInput.value = periodo.anio;
        } catch (e) {
            // Fallback: año actual si algo falla
            const yearInput = form.novedad_anio || document.getElementById('novedad_anio');
            if (yearInput) yearInput.value = new Date().getFullYear();
        }
    }
    const modal = document.getElementById('servicioNovedadModal');
    if (modal) modal.classList.add('active');
    loadServiciosSelect('novedad_servicio');
}
function closeServicioNovedadModal(){
    const modal = document.getElementById('servicioNovedadModal');
    if (modal) modal.classList.remove('active');
    const f = document.getElementById('servicioNovedadForm');
    if (f) delete f.dataset.editId;
}
async function submitServicioNovedadForm(e){
    e.preventDefault();
    const f = document.getElementById('servicioNovedadForm');
    // Construir fecha_recibo: si el usuario no selecciona un día específico,
    // usar el primer día del mes/año indicados.
    let fecha_recibo = f.fecha_recibo.value || null;
    const mesSel = f.novedad_mes ? f.novedad_mes.value : '';
    const anioSel = f.novedad_anio ? f.novedad_anio.value : '';
    if (!fecha_recibo && mesSel && anioSel) {
        const mm = String(mesSel).padStart(2, '0');
        fecha_recibo = `${anioSel}-${mm}-01`;
    }
    const payload = {
        servicio_id: f.servicio_id.value,
        valor_real: f.valor_real.value,
        fecha_recibo: fecha_recibo,
        fecha_limite_primer_pago: f.fecha_limite_primer_pago.value || null,
        referencia: f.referencia.value,
        descripcion: f.descripcion.value
    };
    const editId = f.dataset.editId;
    let url = '/api/servicios/novedades';
    let method = 'POST';
    if (editId){
        url = `/api/servicios/novedades/${editId}`;
        method = 'PUT';
    }
    const res = await fetch(url, {method, headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify(payload)});
    if (res.ok){
        delete f.dataset.editId;
        closeServicioNovedadModal();
        showToast(editId ? 'Novedad actualizada' : 'Novedad creada');
        // Si está abierto el listado por mes, refrescarlo
        const body = document.getElementById('serviciosNovedadesMesBody');
        if (body && body.dataset.lastQuery){
            try { reloadServiciosNovedadesMes(); } catch(e){}
        }
        try { loadServiciosNovedadesMesActual('serviciosNovedadesInlineBody'); } catch(e1){}
        try { loadServiciosDashboardFull(); } catch(e2){}
        try { submitServiciosLiquidacionForm(); } catch(e3){}
    }
    else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Error guardando novedad', 'error');
    }
}

// --- Pagos ---
function showNewPagoModal(){ document.getElementById('pagoForm').reset(); document.getElementById('pagoModal').classList.add('active'); loadServiciosSelect('pago_servicio'); }
function closePagoModal(){ document.getElementById('pagoModal').classList.remove('active'); }
async function submitPagoForm(e){
    e.preventDefault();
    const f = document.getElementById('pagoForm');
    const payload = {
        servicio_id: f.servicio_id.value,
        fecha_pago: f.fecha_pago.value || null,
        forma_pago: f.forma_pago.value,
        valor_pagado: f.valor_pagado.value,
        observaciones: f.observaciones.value
    };
    const res = await fetch('/api/servicios/pagos', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify(payload)});
    if (res.ok){
        closePagoModal();
        showToast('Pago registrado');
        try { loadServiciosDashboardFull(); } catch(e1){}
        try { submitServiciosLiquidacionForm(); } catch(e2){}
        try { reloadServiciosNovedadesMes(); } catch(e3){}
        try { loadServiciosNovedadesMesActual('serviciosNovedadesInlineBody'); } catch(e4){}
    }
    else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Error registrando pago','error');
    }
}

async function loadServiciosSelect(selectId){
    const res = await fetch('/api/servicios/list');
    if (!res.ok) return;
    const data = await res.json();
    const servicios = data.servicios || data.data || data.items || [];
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '<option value="">Seleccionar...</option>';
    servicios.forEach(s => { const opt = document.createElement('option'); opt.value = s.id; opt.textContent = s.nombre; sel.appendChild(opt); });
}

// --- Novedades por Mes (Servicios) ---
async function showServiciosNovedadesMesModal(){
    const modal = document.getElementById('serviciosNovedadesMesModal');
    const form = document.getElementById('serviciosNovedadesMesForm');
    if (form) {
        form.reset();
        try {
            const periodo = await obtenerPeriodoActualServicios();
            const mesSel = document.getElementById('serv_nov_mes');
            const yearInput = document.getElementById('serv_nov_anio');
            if (mesSel) {
                mesSel.value = String(periodo.mes);
                // En el flujo operativo no queremos que el usuario cambie el período
                mesSel.disabled = true;
            }
            if (yearInput) {
                yearInput.value = periodo.anio;
                yearInput.readOnly = true;
            }
            // Ocultar la fila de selección de período: el sistema maneja el mes/año
            const periodoRow = document.getElementById('serviciosNovedadesPeriodoRow');
            if (periodoRow) periodoRow.style.display = 'none';
        } catch (e) {
            const yearInput = document.getElementById('serv_nov_anio');
            if (yearInput) {
                yearInput.value = new Date().getFullYear();
                yearInput.readOnly = true;
            }
        }
    }
    loadServiciosSelect('serv_nov_servicio');
    if (modal) modal.classList.add('active');
    // Cargar de inmediato las novedades del período actual sin pedir el período
    try { await submitServiciosNovedadesMesForm(); } catch (err) { console.error('Error auto-consultando novedades mes actual', err); }
}

function closeServiciosNovedadesMesModal(){
    const modal = document.getElementById('serviciosNovedadesMesModal');
    if (modal) modal.classList.remove('active');
}

async function submitServiciosNovedadesMesForm(e){
    if (e && e.preventDefault) e.preventDefault();
    const form = document.getElementById('serviciosNovedadesMesForm');
    if (!form) return;
    const mes = form.mes.value;
    const anio = form.anio.value;
    const servicio_id = form.servicio_id ? form.servicio_id.value : '';
    if (!mes || !anio) {
        showToast('Seleccione mes y año', 'error');
        return;
    }
    const params = new URLSearchParams({ mes, anio });
    if (servicio_id) params.set('servicio_id', servicio_id);
    const tbody = document.getElementById('serviciosNovedadesMesBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Cargando...</td></tr>';
        tbody.dataset.lastQuery = params.toString();
    }
    try {
        const res = await fetch('/api/servicios/novedades/por-mes?' + params.toString());
        if (!res.ok) {
            showToast('Error consultando novedades por mes', 'error');
            return;
        }
        const data = await res.json();
        renderServiciosNovedadesMesResultados(data);
    } catch (err) {
        console.error('Error en novedades por mes', err);
        showToast('Error consultando novedades por mes', 'error');
    }
}

async function reloadServiciosNovedadesMes(){
    const tbody = document.getElementById('serviciosNovedadesMesBody');
    if (!tbody || !tbody.dataset.lastQuery) return;
    const params = tbody.dataset.lastQuery;
    tbody.innerHTML = '<tr><td colspan="8" class="loading">Cargando...</td></tr>';
    const res = await fetch('/api/servicios/novedades/por-mes?' + params);
    if (!res.ok) return;
    const data = await res.json();
    renderServiciosNovedadesMesResultados(data);
}

function renderServiciosNovedadesMesResultados(data, targetBodyId){
    const tbody = document.getElementById(targetBodyId || 'serviciosNovedadesMesBody');
    if (!tbody) return;
    const items = data && (data.data || []);
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#666;">No hay novedades para el mes seleccionado.</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    // Mapa id->nombre servicio desde catálogo en memoria
    const catalogo = window._serviciosCatalogo || [];
    const nombrePorServicio = {};
    catalogo.forEach(s => { nombrePorServicio[s.id] = s.nombre; });
    items.forEach(n => {
        const tr = document.createElement('tr');
        const saldo = Number(n.saldo_pendiente || 0);
        const pagada = !!n.pagada;
        tr.innerHTML = `
            <td>${escapeHtml(nombrePorServicio[n.servicio_id] || '')}</td>
            <td>${escapeHtml(n.fecha_recibo || '')}</td>
            <td style="text-align:right;">${Number(n.valor_real || 0).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}</td>
            <td style="text-align:right;">${saldo.toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}</td>
            <td>${escapeHtml(n.referencia || '')}</td>
            <td>${escapeHtml(n.descripcion || '')}</td>
            <td>${pagada ? 'PAGADA' : 'PENDIENTE'}</td>
            <td>
                <button class="btn btn-sm btn-info" ${pagada ? 'disabled' : ''} onclick="editServicioNovedad(${n.id})" title="Editar">✏️</button>
                <button class="btn btn-sm btn-danger" style="margin-left:4px;" onclick="deleteServicioNovedad(${n.id})" title="Eliminar">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Cargar novedades del mes actual directamente en el panel inline de Servicios
async function loadServiciosNovedadesMesActual(targetBodyId){
    const tbody = document.getElementById(targetBodyId || 'serviciosNovedadesInlineBody');
    if (!tbody) return;

    let periodo;
    try {
        periodo = await obtenerPeriodoActualServicios();
    } catch (e) {
        console.error('No se pudo obtener período actual para novedades de servicios', e);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#666;">No se pudo obtener el período actual.</td></tr>';
        return;
    }

    const params = new URLSearchParams({ mes: periodo.mes, anio: periodo.anio });
    tbody.innerHTML = '<tr><td colspan="8" class="loading">Cargando...</td></tr>';
    try {
        const res = await fetch('/api/servicios/novedades/por-mes?' + params.toString());
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#666;">Error consultando novedades para este mes.</td></tr>';
            return;
        }
        const data = await res.json();
        renderServiciosNovedadesMesResultados(data, tbody.id);
    } catch (err) {
        console.error('Error cargando novedades del mes actual (servicios)', err);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#666;">Error consultando novedades para este mes.</td></tr>';
    }
}

async function editServicioNovedad(id){
    try {
        const res = await fetch(`/api/servicios/novedades/${id}`);
        if (!res.ok) return showToast('Error al cargar novedad','error');
        const raw = await res.json();
        const n = raw.data || raw;
        const f = document.getElementById('servicioNovedadForm');
        if (!f) return;
        f.servicio_id.value = n.servicio_id || '';
        f.valor_real.value = n.valor_real || 0;
        f.fecha_recibo.value = n.fecha_recibo || '';
        // Derivar mes y año desde fecha_recibo si vienen informados
        if (n.fecha_recibo) {
            const parts = n.fecha_recibo.split('-');
            if (parts.length >= 2) {
                if (f.novedad_anio) f.novedad_anio.value = parts[0];
                if (f.novedad_mes) f.novedad_mes.value = String(parseInt(parts[1], 10));
            }
        }
        f.fecha_limite_primer_pago.value = n.fecha_limite_primer_pago || '';
        f.referencia.value = n.referencia || '';
        f.descripcion.value = n.descripcion || '';
        f.dataset.editId = id;
        document.getElementById('servicioNovedadModal').classList.add('active');
    } catch (err) {
        console.error('Error editServicioNovedad', err);
        showToast('Error al cargar novedad','error');
    }
}

async function deleteServicioNovedad(id){
    if (!confirm('¿Eliminar esta novedad de servicio? Esta acción no se puede deshacer.')) {
        return;
    }
    try {
        const res = await fetch(`/api/servicios/novedades/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Error al eliminar novedad');
        }
        showToast('Novedad eliminada');
        // Refrescar listado modal y panel inline si existen
        try { reloadServiciosNovedadesMes(); } catch (e1) { console.warn('No se pudo recargar novedades por mes', e1); }
        try { loadServiciosNovedadesMesActual('serviciosNovedadesInlineBody'); } catch (e2) { console.warn('No se pudo recargar novedades inline de servicios', e2); }
    } catch (err) {
        console.error('deleteServicioNovedad error', err);
        showToast(err.message || 'Error al eliminar novedad', 'error');
    }
}

// --- Finalizar mes de Servicios ---
async function finalizarPeriodoServicios(){
    if (!confirm('Al finalizar el mes se bloquearán las novedades y pagos de ese periodo y se pasará al mes siguiente. ¿Desea continuar?')) {
        return;
    }
    try {
        const periodo = await obtenerPeriodoActualServicios();
        const res = await fetch('/api/servicios/periodos/finalizar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mes: periodo.mes, anio: periodo.anio })
        });
        if (!res.ok) {
            let msg = 'Error finalizando mes de servicios';
            try {
                const data = await res.json();
                if (data && data.error) msg = data.error;
            } catch (e) {}
            showToast(msg, 'error');
            return;
        }
        const data = await res.json();
        showToast('Mes de servicios finalizado');
        // Actualizar período actual al siguiente mes indicado por backend
        if (data && data.siguiente_periodo) {
            const m = data.siguiente_periodo.mes;
            const y = data.siguiente_periodo.anio;
            const meses = [
                '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
            ];

            const nuevoPeriodo = { mes: m, anio: y };
            window._serviciosPeriodoActual = nuevoPeriodo;
            try {
                if (window.localStorage) {
                    localStorage.setItem('serviciosPeriodoActual', JSON.stringify(nuevoPeriodo));
                }
            } catch (eStore) {
                console.warn('No se pudo guardar nuevo periodo de servicios en localStorage', eStore);
            }

            const span = document.getElementById('serviciosLiquidacionTitulo');
            if (span) {
                span.textContent = `${meses[m]} de ${y}`;
            }

            try {
                if (typeof actualizarEtiquetaServiciosPeriodo === 'function') {
                    actualizarEtiquetaServiciosPeriodo();
                }
            } catch (eLabel) {
                console.warn('Error actualizando etiqueta de período de servicios tras finalizar', eLabel);
            }
        }
    } catch (err) {
        console.error('Error finalizarPeriodoServicios', err);
        showToast('Error finalizando mes de servicios', 'error');
    }
}

// --- Historial de servicios ---
function showHistServiciosModal(){ document.getElementById('histServiciosForm').reset(); loadServiciosSelect('hist_servicio_select'); document.getElementById('histServiciosModal').classList.add('active'); }
function closeHistServiciosModal(){ document.getElementById('histServiciosModal').classList.remove('active'); }

async function submitHistServiciosForm(e){
    e.preventDefault();
    const f = document.getElementById('histServiciosForm');
    const desde_mes = f.desde_mes_hist.value; const desde_anio = f.desde_anio_hist.value;
    const hasta_mes = f.hasta_mes_hist.value; const hasta_anio = f.hasta_anio_hist.value;
    const servicio_id = f.hist_servicio_select.value;
    const params = new URLSearchParams({desde_mes, desde_anio, hasta_mes, hasta_anio});
    if (servicio_id) params.set('servicio_id', servicio_id);
    const res = await fetch('/api/servicios/historial?' + params.toString());
    if (!res.ok) return showToast('Error consultando historial','error');
    const data = await res.json();
    renderHistServiciosResults(data);
}

// Enganchar campo Nombre del servicio para cargar datos si ya existe
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('servicioForm');
    if (form && form.nombre) {
        const handler = () => {
            const nombre = (form.nombre.value || '').trim();
            if (!nombre) return;
            const catalogo = window._serviciosCatalogo || [];
            const encontrado = catalogo.find(s => (s.nombre || '').toLowerCase() === nombre.toLowerCase());
            if (encontrado) {
                fillServicioFormFromData(encontrado.id, encontrado);
                showToast('Servicio existente cargado', 'info');
            }
        };
        form.nombre.addEventListener('change', handler);
        form.nombre.addEventListener('blur', handler);
    }

    // Enlazar formulario de Novedades por Mes
    const novMesForm = document.getElementById('serviciosNovedadesMesForm');
    if (novMesForm) {
        const yearInput = document.getElementById('serv_nov_anio');
        if (yearInput) yearInput.value = new Date().getFullYear();
        loadServiciosSelect('serv_nov_servicio');
        novMesForm.addEventListener('submit', submitServiciosNovedadesMesForm);
    }
});

// Enlazar submit del formulario de liquidación mensual al cargar el módulo
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('serviciosLiquidacionForm');
    if (form) {
        form.addEventListener('submit', submitServiciosLiquidacionForm);
    }
});

// --- Liquidación mensual de servicios ---
async function showServiciosLiquidacionModal(){
    const form = document.getElementById('serviciosLiquidacionForm');
    if (form) {
        form.reset();
        try {
            const periodo = await obtenerPeriodoActualServicios();
            const mesSel = document.getElementById('serv_liq_mes');
            const yearInput = document.getElementById('serv_liq_anio');
            if (mesSel) {
                mesSel.value = String(periodo.mes);
                mesSel.disabled = true;
            }
            if (yearInput) {
                yearInput.value = periodo.anio;
                yearInput.readOnly = true;
            }
            // Ocultar la fila de selección de período: el sistema maneja el mes/año
            const periodoRow = document.getElementById('serviciosLiquidacionPeriodoRow');
            if (periodoRow) periodoRow.style.display = 'none';
        } catch (e) {
            const yearInput = document.getElementById('serv_liq_anio');
            if (yearInput) {
                yearInput.value = new Date().getFullYear();
                yearInput.readOnly = true;
            }
        }
    }
    const modal = document.getElementById('serviciosLiquidacionModal');
    if (modal) modal.classList.add('active');
    // Consultar de inmediato la liquidación del período actual
    try { await submitServiciosLiquidacionForm(); } catch (err) { console.error('Error auto-consultando liquidación mes actual', err); }
}

function closeServiciosLiquidacionModal(){
    const modal = document.getElementById('serviciosLiquidacionModal');
    if (modal) modal.classList.remove('active');
}

async function submitServiciosLiquidacionForm(e){
    if (e && e.preventDefault) e.preventDefault();
    const form = document.getElementById('serviciosLiquidacionForm');
    if (!form) return;
    const mes = form.mes.value;
    const anio = form.anio.value;
    if (!mes || !anio) {
        showToast('Seleccione mes y año', 'error');
        return;
    }
    const params = new URLSearchParams({ mes, anio });
    const tbody = document.getElementById('serviciosLiquidacionBody');
    const container = document.getElementById('serviciosLiquidacionResultados');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">Cargando...</td></tr>';
    }
    if (container) container.style.display = 'block';

    try {
        const res = await fetch('/api/servicios/liquidacion-mensual?' + params.toString());
        if (!res.ok) {
            showToast('Error consultando liquidación mensual', 'error');
            return;
        }
        const data = await res.json();
        renderServiciosLiquidacionResultados(data);
        closeServiciosLiquidacionModal();
    } catch (err) {
        console.error('Error en liquidación mensual de servicios', err);
        showToast('Error consultando liquidación mensual', 'error');
    }
}

function renderServiciosLiquidacionResultados(data){
    const tbody = document.getElementById('serviciosLiquidacionBody');
    if (!tbody) return;
    const tituloSpan = document.getElementById('serviciosLiquidacionTitulo');
    const periodoSpan = document.getElementById('serviciosLiquidacionPeriodo');
    const totalSpan = document.getElementById('serviciosLiquidacionTotal');
    if (tituloSpan && data) {
        const mesNum = Number(data.mes || 0);
        const anio = data.anio || '';
        const nombresMes = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const nombreMes = (mesNum >= 1 && mesNum <= 12) ? nombresMes[mesNum] : 'mes seleccionado';
        const textoPeriodo = anio ? `${nombreMes} de ${anio}` : nombreMes;
        tituloSpan.textContent = textoPeriodo;
        if (periodoSpan) periodoSpan.textContent = textoPeriodo;
    }
    const items = data && (data.data || data.servicios || data.items || []);
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#666;">No hay servicios con saldo o cargo para el mes seleccionado.</td></tr>';
        if (totalSpan) {
            totalSpan.textContent = (0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
        }
        return;
    }
    tbody.innerHTML = '';
    let totalGlobal = 0;
    items.forEach(it => {
        const tr = document.createElement('tr');
        const saldoAnterior = Number(it.saldo_anterior || 0);
        const valorMes = Number(it.valor_mes || 0);
        const totalPagar = Number(it.total_a_pagar || (saldoAnterior + valorMes));
        totalGlobal += totalPagar;
        tr.innerHTML = `
            <td>${escapeHtml(it.servicio_nombre || '')}</td>
            <td>${escapeHtml(it.referencia_pago || '')}</td>
            <td style="text-align:right;">${saldoAnterior.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
            <td style="text-align:right;">${valorMes.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
            <td style="text-align:right; font-weight:600;">${totalPagar.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
        `;
        tbody.appendChild(tr);
    });
    if (totalSpan) {
        totalSpan.textContent = totalGlobal.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
    }
}

// --- Alertas de pago ---
async function loadPaymentAlerts(){
    try{
        const res = await fetch('/api/servicios/novedades/list');
        if (!res.ok) return;
        const data = await res.json();
        const novedades = data.novedades || data.data || [];
        const today = new Date();
        const upcoming = [];
        const overdue = [];
        novedades.forEach(n => {
            if (!n.fecha_limite_primer_pago) return;
            const f = new Date(n.fecha_limite_primer_pago);
            const diffDays = Math.ceil((f - today) / (1000*60*60*24));
            if (diffDays < 0) overdue.push(n);
            else if (diffDays <= 3) upcoming.push({n, days: diffDays});
        });

        const container = document.getElementById('serviciosCatalogo');
        if (!container) return;
        // remove existing alert bar if any
        const existing = document.getElementById('servicios-alert-bar');
        if (existing) existing.remove();

        if (overdue.length === 0 && upcoming.length === 0) return;

        const bar = document.createElement('div');
        bar.id = 'servicios-alert-bar';
        bar.style.padding = '10px';
        bar.style.marginBottom = '10px';
        bar.style.borderRadius = '6px';
        bar.style.display = 'flex';
        bar.style.justifyContent = 'space-between';
        bar.style.alignItems = 'center';
        if (overdue.length) {
            bar.style.background = '#fff3cd';
            bar.style.border = '1px solid #ffc107';
            bar.innerHTML = `<div><strong>⚠️ ${overdue.length} recibo(s) vencido(s)</strong> — Revisa pagos pendientes.</div><div><button class="btn btn-primary" onclick="openNovedadesOverdue()">Ver</button></div>`;
        } else {
            bar.style.background = '#e8f7ff';
            bar.style.border = '1px solid #90caf9';
            bar.innerHTML = `<div><strong>📅 ${upcoming.length} recibo(s) con pago próximo</strong> — Dentro de ${upcoming[0].days} días (ejemplo).</div><div><button class="btn btn-primary" onclick="openNovedadesUpcoming()">Ver</button></div>`;
        }
        container.prepend(bar);

        // Store lists for quick view handlers
        window._servicios_overdue = overdue;
        window._servicios_upcoming = upcoming;
    }catch(err){ console.error('loadPaymentAlerts error', err); }
}

// ==================== Selección de período de Servicios ====================

function actualizarEtiquetaServiciosPeriodo() {
    const label = document.getElementById('serviciosMesSeleccionadoLabel');
    const resumen = document.getElementById('serviciosMesActual');
    const periodoResumen = document.getElementById('serviciosPeriodoResumen');

    if (!window._serviciosPeriodoActual) {
        if (label) label.textContent = 'Período Servicios (Mes/Año) · selección pendiente';
        if (resumen) resumen.textContent = 'No hay mes en proceso registrado.';
        if (periodoResumen) periodoResumen.textContent = '-';
        return;
    }

    const { mes, anio } = window._serviciosPeriodoActual;
    const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mesNombre = meses[mes] || mes;

    const texto = `${mesNombre} ${anio}`;
    if (label) {
        label.textContent = `Período seleccionado: ${texto}`;
    }
    if (resumen) {
        resumen.textContent = `Mes en proceso: ${texto}`;
    }
    if (periodoResumen) {
        periodoResumen.textContent = texto;
    }
}

// Resumen de totales para el dashboard de Servicios (similar a Nómina)
async function actualizarResumenServiciosDashboard() {
    const totalMesSpan = document.getElementById('serviciosTotalMes');
    const conCargoSpan = document.getElementById('serviciosConCargoMes');
    // Si el resumen no está en el DOM, no hacemos nada
    if (!totalMesSpan && !conCargoSpan) return;

    let periodo = window._serviciosPeriodoActual;
    try {
        if (!periodo) {
            periodo = await obtenerPeriodoActualServicios();
        }
    } catch (e) {
        console.warn('No se pudo obtener período actual de servicios para resumen', e);
        if (totalMesSpan) totalMesSpan.textContent = '-';
        if (conCargoSpan) conCargoSpan.textContent = '-';
        return;
    }

    const params = new URLSearchParams({ mes: periodo.mes, anio: periodo.anio });
    try {
        const res = await fetch('/api/servicios/liquidacion-mensual?' + params.toString());
        if (!res.ok) {
            if (totalMesSpan) totalMesSpan.textContent = '-';
            if (conCargoSpan) conCargoSpan.textContent = '-';
            return;
        }
        const data = await res.json();
        const items = data && (data.data || data.servicios || data.items || []);
        let totalGlobal = 0;
        if (items && items.length) {
            items.forEach(it => {
                const saldoAnterior = Number(it.saldo_anterior || 0);
                const valorMes = Number(it.valor_mes || 0);
                const totalPagar = Number(it.total_a_pagar || (saldoAnterior + valorMes));
                totalGlobal += totalPagar;
            });
            if (conCargoSpan) conCargoSpan.textContent = items.length.toString();
        } else {
            if (conCargoSpan) conCargoSpan.textContent = '0';
        }
        if (totalMesSpan) {
            totalMesSpan.textContent = totalGlobal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
    } catch (err) {
        console.error('Error actualizando resumen de servicios', err);
        if (totalMesSpan) totalMesSpan.textContent = '-';
        if (conCargoSpan) conCargoSpan.textContent = '-';
    }
}

function openServiciosPeriodoSeleccion() {
    const modal = document.getElementById('serviciosPeriodoSeleccionModal');
    if (!modal) return;

    const now = new Date();
    const base = window._serviciosPeriodoActual || { mes: now.getMonth() + 1, anio: now.getFullYear() };

    const anioInput = document.getElementById('servicios_periodo_anio');
    const mesSelect = document.getElementById('servicios_periodo_mes');
    if (anioInput) anioInput.value = base.anio;
    if (mesSelect) mesSelect.value = String(base.mes);

    modal.classList.add('active');
}

function closeServiciosPeriodoSeleccion() {
    const modal = document.getElementById('serviciosPeriodoSeleccionModal');
    if (modal) modal.classList.remove('active');
}

function renderServiciosMatrizAnual(matriz, errorMessage = '') {
    const head = document.getElementById('serviciosMatrizHead');
    const body = document.getElementById('serviciosMatrizBody');
    const foot = document.getElementById('serviciosMatrizFoot');
    const resumen = document.getElementById('serviciosMatrizResumen');
    const yearEl = document.getElementById('serviciosMatrizAnio');

    if (!head || !body || !foot) return;

    if (!matriz || !Array.isArray(matriz.periodos) || !Array.isArray(matriz.filas)) {
        head.innerHTML = '';
        foot.innerHTML = '';
        body.innerHTML = `<tr><td colspan="15" class="loading">${escapeHtml(errorMessage || 'No hay datos de servicios para construir la matriz.')}</td></tr>`;
        if (resumen) resumen.textContent = errorMessage || 'Sin información anual de servicios.';
        return;
    }

    if (yearEl) yearEl.value = String(matriz.anio || new Date().getFullYear());
    if (resumen) resumen.textContent = `${matriz.filas.length} servicios visibles en el tablero ${matriz.anio}`;

    head.innerHTML = `
        <tr>
            <th>Servicio</th>
            <th>Valor Base</th>
            ${matriz.periodos.map(periodo => `<th>${escapeHtml(periodo.label)}</th>`).join('')}
            <th>Total Cancelado</th>
            <th>Saldo Pendiente</th>
        </tr>
    `;

    if (matriz.filas.length === 0) {
        body.innerHTML = `<tr><td colspan="${matriz.periodos.length + 4}" class="loading">No hay servicios con información para ${matriz.anio}.</td></tr>`;
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

async function loadServiciosDashboardFull() {
    const totalActivosEl = document.getElementById('serviciosTotalActivos');
    const conCargoEl = document.getElementById('serviciosConCargoMes');
    const totalMesEl = document.getElementById('serviciosTotalMes');
    const periodoResumenEl = document.getElementById('serviciosPeriodoResumen');
    const yearEl = document.getElementById('serviciosMatrizAnio');

    try {
        let periodo = window._serviciosPeriodoActual;
        if (!periodo) {
            periodo = await obtenerPeriodoActualServicios();
        }

        if (periodo && !window._serviciosPeriodoActual) {
            window._serviciosPeriodoActual = periodo;
        }

        const anio = parseInt(yearEl?.value, 10) || periodo?.anio || new Date().getFullYear();
        const params = new URLSearchParams({ anio: String(anio) });
        if (periodo?.mes && periodo?.anio) {
            params.set('referencia_mes', String(periodo.mes));
            params.set('referencia_anio', String(periodo.anio));
        }

        const res = await fetch('/api/dashboard/servicios?' + params.toString(), { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'No se pudo cargar el dashboard de servicios');
        }

        if ((!window._serviciosPeriodoActual || !window._serviciosPeriodoActual.mes) && data.periodo_actual?.mes && data.periodo_actual?.anio) {
            window._serviciosPeriodoActual = {
                mes: Number(data.periodo_actual.mes),
                anio: Number(data.periodo_actual.anio)
            };
        }

        actualizarEtiquetaServiciosPeriodo();

        if (totalActivosEl) totalActivosEl.textContent = String(data.total_servicios ?? '-');
        if (conCargoEl) conCargoEl.textContent = String(data.servicios_con_cargo_mes ?? '-');
        if (totalMesEl) totalMesEl.textContent = formatCurrencyCompact(data.total_programado_mes || 0);
        if (periodoResumenEl && window._serviciosPeriodoActual) {
            const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
            periodoResumenEl.textContent = `${meses[window._serviciosPeriodoActual.mes] || window._serviciosPeriodoActual.mes} ${window._serviciosPeriodoActual.anio}`;
        }

        renderServiciosMatrizAnual(data.matriz_anual);
    } catch (err) {
        console.error('Error cargando dashboard de servicios', err);
        if (totalActivosEl) totalActivosEl.textContent = '-';
        if (conCargoEl) conCargoEl.textContent = '-';
        if (totalMesEl) totalMesEl.textContent = '-';
        renderServiciosMatrizAnual(null, err.message || 'Error al cargar matriz de servicios');
    }
}

function openNovedadesOverdue(){
    const list = window._servicios_overdue || [];
    if (!list.length) return showToast('No hay recibos vencidos');
    // reuse historial modal to show details: build a quick list in an alert
    let html = list.map(n => `${n.fecha_recibo} — ${n.valor_real.toLocaleString()} — ${n.referencia||''}`).join('\n');
    alert('Recibos vencidos:\n' + html);
}

function openNovedadesUpcoming(){
    const list = (window._servicios_upcoming || []).map(x => x.n);
    if (!list.length) return showToast('No hay recibos próximos');
    let html = list.map(n => `${n.fecha_recibo} — ${n.valor_real.toLocaleString()} — ${n.referencia||''}`).join('\n');
    alert('Recibos próximos:\n' + html);
}

function renderHistServiciosResults(data){
    const container = document.getElementById('histServiciosResults');
    container.innerHTML = '';
    const servicios = data.servicios || data.data || [];
    if (!servicios || servicios.length===0) { container.innerHTML = '<div class="placeholder">No hay registros</div>'; return; }
    servicios.forEach(s => {
        const box = document.createElement('div'); box.className = 'hist-quincena';
        const title = document.createElement('h3'); title.textContent = s.servicio_nombre || ('Servicio ' + s.servicio_id);
        box.appendChild(title);
        // Novedades table
        if (s.novedades && s.novedades.length){
            const t = document.createElement('table'); t.className='hist-table';
            t.innerHTML = '<thead><tr><th>Fecha recibo</th><th>Valor</th><th>Referencia</th><th>Descripción</th></tr></thead>';
            const tb = document.createElement('tbody');
            s.novedades.forEach(n=>{ const tr = document.createElement('tr'); tr.innerHTML = `<td>${n.fecha_recibo}</td><td>${n.valor_real.toLocaleString()}</td><td>${escapeHtml(n.referencia||'')}</td><td>${escapeHtml(n.descripcion||'')}</td>`; tb.appendChild(tr); });
            t.appendChild(tb); box.appendChild(t);
        }
        // Pagos table
        if (s.pagos && s.pagos.length){
            const t2 = document.createElement('table'); t2.className='hist-table';
            t2.innerHTML = '<thead><tr><th>Fecha pago</th><th>Valor</th><th>Forma</th><th>Observaciones</th></tr></thead>';
            const tb2 = document.createElement('tbody');
            s.pagos.forEach(p=>{ const tr = document.createElement('tr'); tr.innerHTML = `<td>${p.fecha_pago}</td><td>${p.valor_pagado.toLocaleString()}</td><td>${escapeHtml(p.forma_pago||'')}</td><td>${escapeHtml(p.observaciones||'')}</td>`; tb2.appendChild(tr); });
            t2.appendChild(tb2); box.appendChild(t2);
        }
        container.appendChild(box);
    });
}

// small toast helper (assumes showToast exists in main.js from earlier code)
function showToast(msg, type='success'){ if(window.showToast) window.showToast(msg, type); else alert(msg); }

// Hook forms on load
document.addEventListener('DOMContentLoaded', ()=>{
    const svcForm = document.getElementById('servicioForm'); if (svcForm) svcForm.addEventListener('submit', submitServicioFormHandler);
    const novForm = document.getElementById('servicioNovedadForm'); if (novForm) novForm.addEventListener('submit', submitServicioNovedadForm);
    const pagoForm = document.getElementById('pagoForm'); if (pagoForm) pagoForm.addEventListener('submit', submitPagoForm);
    const histForm = document.getElementById('histServiciosForm'); if (histForm) histForm.addEventListener('submit', submitHistServiciosForm);

    // Enganchar formulario de selección de período de Servicios
    const formPeriodo = document.getElementById('serviciosPeriodoSeleccionForm');
    if (formPeriodo) {
        formPeriodo.addEventListener('submit', (e) => {
            e.preventDefault();
            const anio = parseInt(document.getElementById('servicios_periodo_anio').value, 10);
            const mes = parseInt(document.getElementById('servicios_periodo_mes').value, 10);
            if (!anio || !mes) {
                showToast('Debe seleccionar mes y año', 'error');
                return;
            }
            window._serviciosPeriodoActual = { mes, anio };
            try {
                if (window.localStorage) {
                    localStorage.setItem('serviciosPeriodoActual', JSON.stringify(window._serviciosPeriodoActual));
                }
            } catch (eStore) {
                console.warn('No se pudo guardar periodo de servicios en localStorage (selección manual)', eStore);
            }
            actualizarEtiquetaServiciosPeriodo();
            try { loadServiciosDashboardFull(); } catch (eDash) { console.warn('No se pudo refrescar dashboard de servicios', eDash); }
            closeServiciosPeriodoSeleccion();

            // Activar directamente la vista de gestión de mes
            const panel = document.getElementById('serviciosMesPanel');
            const homeHeader = document.getElementById('serviciosHomeHeader');
            if (panel) panel.style.display = 'block';
            if (homeHeader) homeHeader.style.display = 'none';
        });

        // Al cargar, actualizar etiquetas y el resumen si ya hubiera un período en memoria
        actualizarEtiquetaServiciosPeriodo();
        try { loadServiciosDashboardFull(); } catch (eDashInit) { console.warn('No se pudo inicializar dashboard de servicios', eDashInit); }
    }
});
