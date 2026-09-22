function escapeSiigo(value) {
    const element = document.createElement('div');
    element.textContent = value == null ? '' : String(value);
    return element.innerHTML;
}

function formatoSiigoNumero(value) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }).format(value || 0);
}

function formatoSiigoFecha(value) {
    if (!value) return 'Sin comprobantes cargados';
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
}

function fechaCorteAnualCarteraSiigo() {
    const anio = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric' }).format(new Date());
    return `${anio}-12-31`;
}

function fechaHoyCarteraSiigo() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(new Date());
}

function formatoSiigoFechaHora(value) {
    if (!value) return '';
    const fecha = new Date(value);
    if (Number.isNaN(fecha.getTime())) return formatoSiigoFecha(String(value).slice(0, 10));
    return fecha.toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function actualizarModoCarteraSiigo(ocultarMenu) {
    document.body.classList.toggle('body-siigo-cartera-focus', ocultarMenu);
    document.querySelectorAll('#siigoAlternarMenuCartera, #siigoAlternarMenuVencidas').forEach(boton => {
        boton.textContent = ocultarMenu ? 'Mostrar menú lateral' : 'Ocultar menú lateral';
        boton.setAttribute('aria-expanded', String(!ocultarMenu));
    });
}

function esVendedorCarteraSiigo() {
    return typeof currentUser !== 'undefined' && Boolean(currentUser?.es_vendedor);
}

async function descargarExcelSiigo(url, nombreArchivo, estadoNode, boton) {
    if (boton) boton.disabled = true;
    if (estadoNode) estadoNode.textContent = 'Preparando Excel...';
    try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok || !response.headers.get('content-type')?.includes('spreadsheetml')) {
            const data = await leerRespuestaSiigo(response);
            throw new Error(data.error || 'No fue posible descargar el Excel.');
        }
        const blobUrl = URL.createObjectURL(await response.blob());
        const enlace = document.createElement('a');
        enlace.href = blobUrl;
        enlace.download = nombreArchivo;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        if (estadoNode) estadoNode.textContent = '';
    } catch (error) {
        if (estadoNode) estadoNode.textContent = error.message;
    } finally {
        if (boton) boton.disabled = false;
    }
}

function mostrarVigenciaComprobantes(vigencia) {
    const panel = document.getElementById('siigoVigenciaComprobantes');
    if (!panel) return;

    const ultimaFecha = formatoSiigoFecha(vigencia?.fecha_ultimo_comprobante);
    const fechaRequerida = formatoSiigoFecha(vigencia?.fecha_minima_requerida);
    if (vigencia?.al_dia) {
        panel.className = 'siigo-vigencia-comprobantes siigo-vigencia-ok';
        panel.innerHTML = `<strong>Comprobantes al dia</strong><span>Informacion cargada hasta el ${escapeSiigo(ultimaFecha)}. La fecha minima requerida es ${escapeSiigo(fechaRequerida)}.</span>`;
        return;
    }

    const atraso = vigencia?.dias_atraso;
    panel.className = 'siigo-vigencia-comprobantes siigo-vigencia-alerta';
    if (atraso == null) {
        panel.innerHTML = `<strong>Alerta: comprobantes sin actualizar</strong><span>Aun no hay comprobantes cargados. Debe existir informacion al menos hasta el ${escapeSiigo(fechaRequerida)}. En SIIGO vaya a <strong>Reportes → Versiones anteriores reportes → Comprobantes detallados</strong>, use <strong>Agrupar</strong> y seleccione el período, exporte el informe a Excel (.xlsx) y cárguelo aquí.</span>`;
        return;
    }
    const detalleAtraso = `Hay ${atraso} dia${atraso === 1 ? '' : 's'} de atraso frente al minimo requerido.`;
    panel.innerHTML = `<strong>Alerta: comprobantes sin actualizar</strong><span>Informacion cargada hasta el ${escapeSiigo(ultimaFecha)}. Debe estar cargada al menos hasta el ${escapeSiigo(fechaRequerida)}. ${escapeSiigo(detalleAtraso)} En SIIGO vaya a <strong>Reportes → Versiones anteriores reportes → Comprobantes detallados</strong>, use <strong>Agrupar</strong> y seleccione el período, exporte el informe a Excel (.xlsx) y cárguelo aquí.</span>`;
}

function mostrarDetalleCarteraClienteSiigo(result, cliente, button) {
    let panel = result.querySelector('.siigo-detalle-cartera');
    if (!panel) {
        panel = document.createElement('section');
        panel.className = 'siigo-detalle-cartera';
        const tituloClientes = [...result.querySelectorAll('h4')].find(titulo => titulo.textContent.includes('cliente'));
        (tituloClientes || result.firstElementChild).insertAdjacentElement('beforebegin', panel);
    }

    const filas = (cliente.facturas || []).map(factura => `<tr><td>${escapeSiigo(factura.referencia)}</td><td>${escapeSiigo(formatoSiigoFecha(factura.fecha_factura))}</td><td>${escapeSiigo(formatoSiigoFecha(factura.fecha_vencimiento))}</td><td>${formatoSiigoNumero(factura.facturado)}</td><td>${formatoSiigoNumero(factura.recaudado)}</td><td>${formatoSiigoNumero(factura.ajustes_ac)}</td><td>${formatoSiigoNumero(factura.notas_credito)}</td><td>${formatoSiigoNumero(factura.notas_debito)}</td><td>${formatoSiigoNumero(factura.otros_movimientos)}</td><td>${detalleCrucesFacturaSiigo(factura)}</td><td>${factura.dias_vencido}</td></tr>`).join('');
    panel.hidden = false;
    actualizarModoCarteraSiigo(true);
    panel.innerHTML = `<div class="siigo-detalle-cartera-header"><div><h4>Detalle de ${escapeSiigo(cliente.cliente)}</h4><p>${escapeSiigo(cliente.identificacion || 'Sin identificacion')} | Saldo: <strong>${formatoSiigoNumero(cliente.saldo)}</strong></p></div><button type="button" class="btn btn-secondary" data-siigo-cerrar-detalle>Cerrar detalle</button></div><div class="siigo-tabla-con-encabezado-fijo siigo-tabla-detalle"><table class="data-table"><thead><tr><th>Factura</th><th>Fecha</th><th>Vencimiento</th><th>Facturado</th><th>Recaudado</th><th>Ajustes AC</th><th>Notas crédito</th><th>Notas débito</th><th>Otros cruces</th><th>Saldo</th><th>Dias vencido</th></tr></thead><tbody>${filas}</tbody></table></div>`;
    result.querySelectorAll('[data-siigo-cliente-index]').forEach(item => { item.textContent = 'Ver detalle'; });
    button.textContent = 'Viendo detalle';
    panel.querySelector('[data-siigo-cerrar-detalle]').addEventListener('click', () => {
        panel.hidden = true;
        button.textContent = 'Ver detalle';
        button.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let filtrosClientesSiigoPromise = null;

async function cargarFiltrosClientesSiigo() {
    if (!filtrosClientesSiigoPromise) {
        filtrosClientesSiigoPromise = fetch('/api/contable/filtros-clientes', { credentials: 'include' })
            .then(async response => {
                const data = await leerRespuestaSiigo(response);
                if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los filtros.');
                return data;
            })
            .catch(error => {
                filtrosClientesSiigoPromise = null;
                throw error;
            });
    }
    return filtrosClientesSiigoPromise;
}

function tablaCarteraClientesSiigo(clientes) {
    if (!clientes.length) return '';
    const filas = clientes.map((cliente, index) => {
        return `<tr><td>${escapeSiigo(cliente.identificacion)}</td><td>${escapeSiigo(cliente.cliente)}</td><td>${escapeSiigo(cliente.vendedor||'Sin asignar')}</td><td>${formatoSiigoNumero(cliente.facturado)}</td><td>${formatoSiigoNumero(cliente.recaudado)}</td><td>${formatoSiigoNumero(cliente.ajustes_ac)}</td><td>${formatoSiigoNumero(cliente.notas_credito)}</td><td>${formatoSiigoNumero(cliente.notas_debito)}</td><td>${formatoSiigoNumero(cliente.otros_movimientos)}</td><td>${formatoSiigoNumero(cliente.por_vencer)}</td><td>${formatoSiigoNumero(cliente.vencido_1_30)}</td><td>${formatoSiigoNumero(cliente.vencido_31_60)}</td><td>${formatoSiigoNumero(cliente.vencido_61_90)}</td><td>${formatoSiigoNumero(cliente.vencido_91_mas)}</td><td>${formatoSiigoNumero(cliente.saldo)}</td><td><button type="button" class="action-btn" data-siigo-cliente-index="${index}">Ver detalle</button></td></tr>`;
    }).join('');
    return `<h4 style="margin:20px 0 8px;">Detalle de cartera por cliente</h4><p class="form-help">Seleccione “Ver detalle” para consultar las facturas que componen cada saldo.</p><div class="siigo-tabla-con-encabezado-fijo"><table class="data-table"><thead><tr><th>Identificacion</th><th>Cliente</th><th>Vendedor</th><th>Facturado</th><th>Recaudado</th><th>Ajustes AC</th><th>Notas crédito</th><th>Notas débito</th><th>Otros cruces</th><th>Por vencer</th><th>1 a 30</th><th>31 a 60</th><th>61 a 90</th><th>Mas de 90</th><th>Saldo</th><th>Detalle</th></tr></thead><tbody>${filas}</tbody></table></div>`;
}

async function leerRespuestaSiigo(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return response.json();
    const body = await response.text();
    const detail = body.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(`Railway devolvio una respuesta no valida (HTTP ${response.status}). ${detail}`);
}

async function cargarResumenSiigo() {
    const response = await fetch('/api/contable/resumen', { credentials: 'include' });
    const data = await leerRespuestaSiigo(response);
    if (!response.ok) throw new Error(data.error || 'No fue posible consultar la informacion SIIGO.');
    document.getElementById('siigoClientesCount').textContent = data.clientes || 0;
    document.getElementById('siigoClientesSinVendedor').textContent = `${data.clientes_sin_vendedor || 0} sin vendedor asignado`;
    document.getElementById('siigoCuentasCount').textContent = data.cuentas || 0;
    document.getElementById('siigoComprobantesCount').textContent = data.comprobantes || 0;
    document.getElementById('siigoMovimientosCount').textContent = data.movimientos || 0;
    mostrarVigenciaComprobantes(data.vigencia_comprobantes);
    const cargas = (data.cargas || []).slice(0, 1);
    document.getElementById('siigoCargasRecientes').innerHTML = cargas.length ? cargas.map(carga => `<div><strong>${escapeSiigo(carga.tipo)}</strong> - ${escapeSiigo(carga.archivo)} (${escapeSiigo(carga.fecha)}): ${carga.importados} importados, ${carga.omitidos} omitidos.</div>`).join('') : 'Aun no hay cargues registrados.';
}

function seleccionarArchivoSiigo(tipo, resultadoId = 'siigoCargaResultado', alCompletar = null) {
    const input = document.getElementById('siigoArchivoInput');
    input.value = '';
    input.onchange = () => importarArchivoSiigo(tipo, input.files[0], resultadoId, alCompletar);
    input.click();
}

async function importarArchivoSiigo(tipo, archivo, resultadoId = 'siigoCargaResultado', alCompletar = null) {
    if (!archivo) return;
    const result = document.getElementById(resultadoId);
    result.textContent = `Cargando ${archivo.name}...`;
    const formData = new FormData();
    formData.append('archivo', archivo);
    try {
        const response = await fetch(`/api/contable/cargar-${tipo}`, { method: 'POST', body: formData, credentials: 'include' });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok && response.status !== 202) throw new Error(data.error || 'No fue posible procesar el archivo.');
        if (tipo === 'clientes' && typeof invalidarClientesComerciales === 'function') invalidarClientesComerciales();
        if (tipo === 'clientes' && data.estado === 'en_proceso') {
            result.textContent = 'Importación de clientes en proceso... (puede tardar varios minutos)';
            seguirEstadoCargaClientes(result, alCompletar);
            return;
        }
        const detalleCarga = data.creados != null
            ? ` Creados: ${data.creados}. Actualizados: ${data.actualizados}.`
            : (data.comprobantes != null ? ` Comprobantes: ${data.comprobantes}. Movimientos: ${data.movimientos}. Omitidos: ${data.omitidos}.` : '');
        result.textContent = `${data.mensaje}${detalleCarga}`;
        await cargarResumenSiigo();
        if (alCompletar) await alCompletar();
    } catch (error) {
        result.textContent = error.message;
    }
}

async function seguirEstadoCargaClientes(result, alCompletar = null) {
    const consultar = async () => {
        try {
            const r = await fetch('/api/contable/estado-carga-clientes', { credentials: 'include' });
            const d = await r.json().catch(() => ({}));
            if (d.estado === 'en_proceso') return false;
            if (d.estado === 'completado') {
                const s = d.resumen || {};
                const partes = [];
                if (s.identificaciones != null) partes.push(`${s.identificaciones} identificaciones`);
                if (s.creados != null) partes.push(`creados ${s.creados}`);
                if (s.actualizados != null) partes.push(`actualizados ${s.actualizados}`);
                if (s.revision != null) partes.push(`en revisión ${s.revision}`);
                result.textContent = partes.length
                    ? `Importación de clientes completada: ${partes.join(', ')}.`
                    : 'Importación de clientes completada sin duplicados.';
            } else if (d.estado === 'error') {
                result.textContent = `Error en la importación de clientes: ${d.error || 'revisa el archivo e intenta de nuevo.'}`;
            } else {
                result.textContent = 'Importación de clientes finalizada.';
            }
            if (typeof invalidarClientesComerciales === 'function') invalidarClientesComerciales();
            await cargarResumenSiigo();
            if (alCompletar) await alCompletar();
            return true;
        } catch (e) {
            return false;
        }
    };
    if (await consultar()) return;
    const timer = setInterval(async () => {
        if (await consultar()) clearInterval(timer);
    }, 4000);
}

function paramsConsultaComprobantesSiigo() {
    const params = new URLSearchParams();
    [['cliente', 'siigoClienteFiltro'], ['tipo', 'siigoTipoFiltro'], ['numero', 'siigoNumeroFiltro'], ['desde', 'siigoDesdeFiltro'], ['hasta', 'siigoHastaFiltro']].forEach(([key, id]) => {
        const input = document.getElementById(id);
        const value = key === 'cliente' && input.dataset.identificacion ? input.dataset.identificacion : input.value.trim();
        if (value) params.set(key, value);
    });
    return params;
}

async function consultarComprobantesSiigo(event) {
    if (event) event.preventDefault();
    const params = paramsConsultaComprobantesSiigo();
    const container = document.getElementById('siigoConsultaResultado');
    container.innerHTML = 'Consultando...';
    try {
        const response = await fetch(`/api/contable/comprobantes?${params.toString()}`, { credentials: 'include' });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible consultar comprobantes.');
        const rows = data.comprobantes || [];
        container.innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Documento</th><th>Fecha</th><th>Movimientos</th><th>Debito</th><th>Credito</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeSiigo(`${row.tipo}-${row.codigo}-${row.numero}`)}</td><td>${escapeSiigo(row.fecha)}</td><td>${row.movimientos}</td><td>${formatoSiigoNumero(row.debito)}</td><td>${formatoSiigoNumero(row.credito)}</td></tr>`).join('')}</tbody></table>` : 'No se encontraron comprobantes con esos filtros.';
    } catch (error) {
        container.textContent = error.message;
    }
}

function configurarAutocompletadoTercerosSiigo() {
    const input = document.getElementById('siigoClienteFiltro');
    if (!input || input.dataset.autocompleteBound) return;
    const suggestions = document.createElement('div');
    suggestions.id = 'siigoTerceroSugerencias';
    suggestions.className = 'table-container';
    suggestions.style.cssText = 'display:none; position:absolute; z-index:5; width:100%; max-height:220px; overflow:auto; background:#fff;';
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(suggestions);
    let timer;

    input.addEventListener('input', () => {
        delete input.dataset.identificacion;
        clearTimeout(timer);
        const search = input.value.trim();
        if (search.length < 2) {
            suggestions.style.display = 'none';
            return;
        }
        timer = setTimeout(() => cargarSugerenciasTerceroSiigo(search, input, suggestions), 250);
    });
    input.addEventListener('blur', () => setTimeout(() => { suggestions.style.display = 'none'; }, 180));
    input.dataset.autocompleteBound = 'true';
}

async function cargarSugerenciasTerceroSiigo(search, input, suggestions) {
    try {
        const response = await fetch(`/api/contable/clientes?q=${encodeURIComponent(search)}`, { credentials: 'include' });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible buscar terceros.');
        const clientes = data.clientes || [];
        if (!clientes.length) {
            suggestions.style.display = 'none';
            return;
        }
        suggestions.innerHTML = clientes.slice(0, 12).map(cliente => `<button type="button" class="action-btn" style="display:block; width:100%; text-align:left; padding:8px; border:0; border-bottom:1px solid #eee;" data-id="${escapeSiigo(cliente.identificacion)}" data-name="${escapeSiigo(cliente.nombre)}">${escapeSiigo(cliente.nombre)} <span style="color:#666;">${escapeSiigo(cliente.identificacion)}</span></button>`).join('');
        suggestions.querySelectorAll('button').forEach(button => button.addEventListener('mousedown', () => {
            input.value = button.dataset.name;
            input.dataset.identificacion = button.dataset.id;
            suggestions.style.display = 'none';
        }));
        suggestions.style.display = 'block';
    } catch (error) {
        suggestions.style.display = 'none';
    }
}

function crearPanelComparativoSiigo() {
    let panel = document.getElementById('siigoComparativoPanel');
    if (panel) return panel;
    const consulta = document.getElementById('siigoConsultaResultado').closest('.recent-section');
    panel = document.createElement('section');
    panel.id = 'siigoComparativoPanel';
    panel.className = 'recent-section';
    panel.style.marginTop = '16px';
    panel.innerHTML = `<h3 style="margin-top:0;">Clientes nuevos y clientes que no volvieron</h3><p class="form-help">Se comparan las facturas FV de dos periodos. La cartera cruza facturas y recibos de caja hasta la fecha de corte indicada.</p><form id="siigoComparativoForm"><div class="form-row"><div class="form-group"><label>Periodo 1: desde</label><input id="siigoPeriodoADesde" type="date" required></div><div class="form-group"><label>Periodo 1: hasta</label><input id="siigoPeriodoAHasta" type="date" required></div><div class="form-group"><label>Periodo 2: desde</label><input id="siigoPeriodoBDesde" type="date" required></div><div class="form-group"><label>Periodo 2: hasta</label><input id="siigoPeriodoBHasta" type="date" required></div><div class="form-group"><label>Cartera a fecha de corte</label><input id="siigoComparativoFechaCorte" type="date"></div><div class="form-group" style="align-self:end;"><button class="btn btn-primary" type="submit">Generar comparativo</button></div><div class="form-group" style="align-self:end;"><button class="btn btn-secondary" type="button" data-siigo-exportar-comparativo>Descargar Excel</button></div></div></form><div id="siigoComparativoResultado" class="table-container" style="margin-top:16px;"></div>`;
    consulta.insertAdjacentElement('afterend', panel);
    panel.querySelector('form').addEventListener('submit', consultarComparativoClientesSiigo);
    panel.querySelector('[data-siigo-exportar-comparativo]').addEventListener('click', descargarComparativoClientesSiigo);
    agregarFiltrosMaestroSiigo(panel.querySelector('form'));
    return panel;
}

function mostrarComparativoClientes() {
    mostrarInformeSiigo('comparativo');
    const panel = crearPanelComparativoSiigo();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function paramsComparativoClientesSiigo(form) {
    const params = new URLSearchParams({
        ...valoresFiltrosMaestroSiigo(form),
        periodo_a_desde: document.getElementById('siigoPeriodoADesde').value,
        periodo_a_hasta: document.getElementById('siigoPeriodoAHasta').value,
        periodo_b_desde: document.getElementById('siigoPeriodoBDesde').value,
        periodo_b_hasta: document.getElementById('siigoPeriodoBHasta').value,
    });
    const fechaCorte = document.getElementById('siigoComparativoFechaCorte').value;
    if (fechaCorte) params.set('fecha_corte_cartera', fechaCorte);
    return params;
}

async function consultarComparativoClientesSiigo(event) {
    event.preventDefault();
    const params = paramsComparativoClientesSiigo(event.currentTarget || event.target);
    const result = document.getElementById('siigoComparativoResultado');
    result.textContent = 'Generando comparativo...';
    try {
        const response = await fetch(`/api/contable/comparativo-clientes?${params.toString()}`, { credentials: 'include' });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible generar el comparativo.');
        const table = (items, empty) => items.length ? `<table class="data-table"><thead><tr><th>Identificacion</th><th>Cliente</th><th>Facturas</th></tr></thead><tbody>${items.map(item => `<tr><td>${escapeSiigo(item.identificacion)}</td><td>${escapeSiigo(item.nombre)}</td><td>${item.facturas}</td></tr>`).join('')}</tbody></table>` : `<p class="form-help">${empty}</p>`;
        const resumenGrupo = (titulo, total) => `<div class="recent-section" style="flex:1; min-width:280px;"><h4 style="margin-top:0;">${titulo}</h4><p class="form-help">Cartera conciliada por factura al ${escapeSiigo(data.fecha_cartera)}.</p><div class="stats-grid"><div class="stat-card"><h3>Facturacion</h3><p class="stat-number" style="font-size:1.35rem;">${formatoSiigoNumero(total.facturacion)}</p></div><div class="stat-card"><h3>Cartera pendiente</h3><p class="stat-number" style="font-size:1.35rem;">${formatoSiigoNumero(total.cartera)}</p></div><div class="stat-card"><h3>Abonos y ajustes por conciliar</h3><p class="stat-number" style="font-size:1.35rem;">${formatoSiigoNumero(total.pagos_pendientes_conciliar)}</p></div></div></div>`;
        result.innerHTML = `<div class="stats-grid"><div class="stat-card"><h3>Clientes periodo 1</h3><p class="stat-number">${data.clientes_periodo_a}</p></div><div class="stat-card"><h3>Clientes periodo 2</h3><p class="stat-number">${data.clientes_periodo_b}</p></div><div class="stat-card"><h3>Nuevos</h3><p class="stat-number">${data.nuevos.length}</p></div><div class="stat-card"><h3>No volvieron</h3><p class="stat-number">${data.no_volvieron.length}</p></div></div><div class="form-row" style="align-items:stretch; margin-top:16px;">${resumenGrupo('Clientes nuevos', data.totales_nuevos)}${resumenGrupo('Clientes que no volvieron', data.totales_no_volvieron)}</div><div class="form-row" style="align-items:flex-start;"><div style="flex:1; min-width:280px;"><h4>Clientes nuevos</h4>${table(data.nuevos, 'No hubo clientes nuevos en el segundo periodo.')}</div><div style="flex:1; min-width:280px;"><h4>Clientes que no volvieron</h4>${table(data.no_volvieron, 'Todos los clientes del primer periodo volvieron a facturar.')}</div></div>`;
    } catch (error) {
        result.textContent = error.message;
    }
}

function crearPanelVentasMensualesSiigo() {
    let panel = document.getElementById('siigoVentasMensualesPanel');
    if (panel) return panel;
    const anchor = crearPanelComparativoSiigo();
    panel = document.createElement('section');
    panel.id = 'siigoVentasMensualesPanel';
    panel.className = 'recent-section';
    panel.style.marginTop = '16px';
    panel.innerHTML = `<h3 style="margin-top:0;">Control mensual de ventas</h3><p class="form-help">Calculado desde PREVENT con las mismas reglas de FV, NC e IVA que se compararan contra SIIGO.</p><form id="siigoVentasMensualesForm"><div class="form-row"><div class="form-group"><label for="siigoVentasAnio">Ano</label><input id="siigoVentasAnio" type="number" min="2000" max="2100" value="${new Date().getFullYear()}" required></div><div class="form-group" style="align-self:end;"><label><input id="siigoVentasIncluirNC" type="checkbox" checked> Incluir notas credito</label></div><div class="form-group" style="align-self:end;"><label><input id="siigoVentasIncluirIVA" type="checkbox"> Incluir impuesto</label></div><div class="form-group" style="align-self:end;"><button class="btn btn-primary" type="submit">Calcular ventas</button></div><div class="form-group" style="align-self:end;"><button class="btn btn-secondary" type="button" data-siigo-exportar-ventas>Descargar Excel</button></div></div></form><div id="siigoVentasMensualesResultado" class="table-container" style="margin-top:16px;"></div><h4 style="margin:20px 0 8px;">Cuentas incluidas en el calculo</h4><div id="siigoConfiguracionVentas" class="table-container"></div>`;
    anchor.insertAdjacentElement('afterend', panel);
    panel.querySelector('form').addEventListener('submit', consultarVentasMensualesSiigo);
    panel.querySelector('[data-siigo-exportar-ventas]').addEventListener('click', descargarVentasMensualesSiigo);
    agregarFiltrosMaestroSiigo(panel.querySelector('form'));
    return panel;
}

function crearPanelCarteraDinamicaSiigo(tipo) {
    const id = tipo === 'pagos' ? 'siigoPagosClientesPanel' : 'siigoCarteraRecaudoPanel';
    let panel = document.getElementById(id);
    if (panel) return panel;
    const anchor = crearPanelVentasMensualesSiigo();
    const esPagos = tipo === 'pagos';
    panel = document.createElement('section');
    panel.id = id;
    panel.className = 'recent-section';
    panel.style.marginTop = '16px';
    panel.innerHTML = esPagos
        ? `<h3 style="margin-top:0;">Analisis de pago de clientes</h3><p class="form-help">Cruza cada recibo de caja RC con la factura FV indicada en la descripcion. El promedio considera facturas con recibos RC cuyo saldo fue cancelado con RC, ajustes AC y notas crédito/débito; cuenta hasta la fecha de la cancelación total.</p><form data-siigo-cartera="pagos"><div class="form-row"><div class="form-group"><label>Fecha de corte</label><input type="date" required value="${new Date().toISOString().slice(0, 10)}"></div><div class="form-group" style="align-self:end;"><button class="btn btn-primary" type="submit">Generar analisis</button></div></div></form><div class="table-container" style="margin-top:16px;"></div>`
        : `<h3 style="margin-top:0;">Cartera y recaudo por periodo</h3><p class="form-help">Calculado desde las facturas FV, recibos RC, ajustes AC y notas crédito/débito asociados a cada factura. Saldo = débitos menos créditos de cartera vinculados a la factura, sin restringir el tipo de comprobante. Los ajustes AC incluyen los documentos antiguos CC-AC y las retenciones que afectan cartera; un ajuste negativo aumenta el saldo. La fecha de vencimiento corresponde a la cuota indicada por SIIGO.</p><form data-siigo-cartera="recaudo"><div class="form-row"><div class="form-group"><label>Fecha de corte</label><input type="date" required value="${new Date().toISOString().slice(0, 10)}"></div><div class="form-group" style="align-self:end;"><button class="btn btn-primary" type="submit">Generar cartera</button></div></div></form><div class="table-container" style="margin-top:16px;"></div>`;
    const form = panel.querySelector('form');
    agregarFiltrosMaestroSiigo(form);
    anchor.insertAdjacentElement('afterend', panel);
    const exportar = document.createElement('button');
    exportar.type = 'button';
    exportar.className = 'btn btn-secondary';
    exportar.textContent = 'Descargar Excel';
    exportar.addEventListener('click', () => descargarCarteraDinamicaSiigo(form, tipo, exportar));
    const exportarGroup = document.createElement('div');
    exportarGroup.className = 'form-group';
    exportarGroup.style.alignSelf = 'end';
    exportarGroup.appendChild(exportar);
    form.querySelector('.form-row')?.appendChild(exportarGroup);
    const boton = form.querySelector('button[type="submit"]');
    boton.type = 'button';
    boton.addEventListener('click', () => consultarCarteraDinamicaSiigo(form, tipo));
    form.addEventListener('submit', event => {
        event.preventDefault();
        consultarCarteraDinamicaSiigo(form, tipo);
    });
    if (!esPagos) {
        const alternarMenu = document.createElement('button');
        alternarMenu.id = 'siigoAlternarMenuCartera';
        alternarMenu.type = 'button';
        alternarMenu.className = 'btn btn-secondary';
        alternarMenu.textContent = 'Mostrar menu lateral';
        form.querySelector('.form-row').appendChild(alternarMenu);
        alternarMenu.addEventListener('click', () => {
            actualizarModoCarteraSiigo(!document.body.classList.contains('body-siigo-cartera-focus'));
        });
    }
    return panel;
}

function crearPanelFacturasVencidasSiigo() {
    let panel = document.getElementById('siigoFacturasVencidasPanel');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'siigoFacturasVencidasPanel';
    panel.className = 'recent-section';
    const hoy = fechaCorteAnualCarteraSiigo();
    panel.innerHTML = `<div data-vencidas-filtros><h3>Facturas vencidas y por vencer por cliente</h3><form class="siigo-vencidas-filtros"><div class="form-group"><label for="siigoVencidasCorte">Fecha de corte</label><input id="siigoVencidasCorte" type="date" required value="${hoy}"></div><div class="form-group"><label for="siigoVencidasCliente">Cliente o identificación (opcional)</label><input id="siigoVencidasCliente" name="cliente" type="text"></div><div class="form-group"><label for="siigoEstadoFacturas">Facturas</label><select id="siigoEstadoFacturas" name="estado_facturas"><option value="todos">Todos</option><option value="vencidos">Solo vencidos</option><option value="por_vencer">Por vencer</option></select><small>Por vencer incluye las que vencen hoy. Cantidad y total corresponden al filtro.</small></div><button class="btn btn-primary" type="submit">Generar informe</button></form><form class="siigo-comprobante-recibido" data-comprobante-recibido><h4>Cargar comprobante de pago</h4><div class="form-row siigo-form-dos"><div class="form-group"><label>Empresa *</label><input name="cliente_nombre" required maxlength="255"><input name="identificacion" placeholder="NIT o identificación" required maxlength="50"></div><div class="form-group"><label>Paciente</label><input name="paciente" maxlength="200"></div></div><div class="form-row siigo-form-dos"><div class="form-group"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div><div class="form-group"><label>Archivos *</label><input name="archivos" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple required></div></div><button type="submit" class="btn btn-primary">Guardar comprobante</button><p role="status"></p></form><p data-vencidas-estado role="status"></p></div><div class="siigo-vencidas-visor" hidden><header class="siigo-vencidas-cabecera"><div><h2 tabindex="-1">Facturas vencidas y por vencer por cliente</h2><p data-vencidas-meta></p><p data-alertas-cartera role="status" aria-live="polite"></p></div><button type="button" class="btn btn-secondary" data-vencidas-regresar>Regresar</button></header><div class="table-container siigo-vencidas-datos"></div><footer class="siigo-vencidas-pie"><div class="siigo-vencidas-barra" tabindex="0" role="region" aria-label="Desplazamiento horizontal de las facturas"><div></div></div><div class="siigo-vencidas-acciones"><button class="btn btn-primary" type="button" data-vencidas-generar>Generar informe</button><button class="btn btn-secondary" type="button" data-siigo-exportar-vencidas>Descargar Excel</button><button class="btn btn-secondary" type="button" id="siigoAlternarMenuVencidas">Mostrar menú lateral</button><button class="btn btn-secondary" type="button" data-vencidas-actualizar>Actualizar comprobantes</button></div><p id="siigoVencidasCargaResultado" role="status" aria-live="polite"></p></footer></div>`;
    panel.querySelector('[data-vencidas-filtros] h3').textContent = 'Seguimiento de cartera';
    panel.querySelector('.siigo-vencidas-cabecera h2').textContent = 'Seguimiento de cartera';
    panel.querySelector('#siigoVencidasCorte')?.closest('.form-group')?.remove();
    panel.querySelector('form')?.insertAdjacentHTML('afterbegin', `<input id="siigoVencidasCorte" name="fecha_corte" type="hidden" value="${fechaCorteAnualCarteraSiigo()}">`);
    const clienteInput = panel.querySelector('#siigoVencidasCliente');
    panel.querySelector('label[for="siigoVencidasCliente"]').textContent = 'Búsqueda de cliente o identificación';
    clienteInput.type = 'search';
    clienteInput.autocomplete = 'off';
    clienteInput.placeholder = 'Nombre, NIT o cédula';
    crearPanelCarteraDinamicaSiigo('recaudo').insertAdjacentElement('afterend', panel);
    const tituloFiltros = panel.querySelector('[data-vencidas-filtros] h3');
    const cabeceraFiltros = document.createElement('div');
    cabeceraFiltros.className = 'siigo-vencidas-cabecera';
    tituloFiltros.replaceWith(cabeceraFiltros);
    cabeceraFiltros.appendChild(tituloFiltros);
    cabeceraFiltros.insertAdjacentHTML('beforeend', '<button type="button" class="btn btn-secondary" data-vencidas-informes>Regresar a informes</button>');
    cabeceraFiltros.querySelector('button').addEventListener('click', () => {
        if (panel.dataset.origen === 'comercial-cartera') {
            regresarMenuPrincipalCarteraSiigo();
            return;
        }
        mostrarInformeSiigo('comparativo');
    });
    const form = panel.querySelector('form');
    agregarFiltrosMaestroSiigo(form);
    form.addEventListener('submit', event => {
        event.preventDefault();
        consultarFacturasVencidasSiigo(form);
    });
    panel.querySelector('[data-vencidas-generar]').addEventListener('click', () => form.requestSubmit());
    panel.querySelector('[data-vencidas-regresar]').addEventListener('click', () => mostrarFiltrosVencidasSiigo(true));
    panel.querySelector('#siigoAlternarMenuVencidas').addEventListener('click', () => {
        actualizarModoCarteraSiigo(!document.body.classList.contains('body-siigo-cartera-focus'));
    });
    panel.querySelector('[data-vencidas-actualizar]').addEventListener('click', () => seleccionarArchivoSiigo(
        'comprobantes', 'siigoVencidasCargaResultado', () => {
            if (!panel.querySelector('.siigo-vencidas-visor').hidden) return consultarFacturasVencidasSiigo(form);
        },
    ));
    panel.querySelector('[data-siigo-exportar-vencidas]').addEventListener('click', async event => {
        const boton = event.currentTarget;
        boton.disabled = true;
        const params = new URLSearchParams({ informe: 'vencidas', formato: 'xlsx', ...panel._filtrosConsultados });
        const estado = panel.querySelector('#siigoVencidasCargaResultado');
        estado.textContent = 'Preparando Excel...';
        try {
            const response = await fetch(`/api/contable/cartera-dinamica?${params}`, { credentials: 'include' });
            if (!response.ok || !response.headers.get('content-type')?.includes('spreadsheetml')) {
                const data = await leerRespuestaSiigo(response);
                throw new Error(data.error || 'No fue posible descargar el informe.');
            }
            const url = URL.createObjectURL(await response.blob());
            const enlace = document.createElement('a');
            enlace.href = url;
            enlace.download = `facturas_vencidas_${params.get('fecha_corte')}.xlsx`;
            document.body.appendChild(enlace);
            enlace.click();
            enlace.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            estado.textContent = '';
        } catch (error) {
            estado.textContent = error.message;
        } finally {
            boton.disabled = false;
        }
    });
    return panel;
}

function abrirGestionCarteraComercial() {
    const destino = document.getElementById('comercialCarteraPanel');
    const panel = crearPanelFacturasVencidasSiigo();
    panel.dataset.origen = 'comercial-cartera';
    asegurarInicioGestionCarteraSiigo(panel);
    const volver = panel.querySelector('[data-vencidas-informes]');
    if (volver) {
        volver.textContent = 'Regresar al menú principal';
        volver.classList.replace('btn-secondary', 'btn-primary');
    }
    if (destino && panel.parentElement !== destino) {
        destino.replaceChildren(panel);
    }
    mostrarInicioGestionCarteraSiigo(panel);
}

function asegurarInicioGestionCarteraSiigo(panel) {
    if (panel.querySelector('[data-cartera-inicio]')) return;
    panel.insertAdjacentHTML('afterbegin', `<section data-cartera-inicio class="siigo-cartera-inicio"><div><h3>Gestión de cartera</h3><p class="form-help">Alertas de cartera según el estado del último seguimiento visible para tu rol.</p></div><div class="form-group" data-cartera-vendedor-caja hidden><label for="siigoCarteraInicioVendedor">Ver cartera de</label><select id="siigoCarteraInicioVendedor" data-cartera-vendedor><option value="">Todos los vendedores</option></select></div><div class="siigo-cartera-alertas" data-cartera-alertas></div><div class="button-group"><button type="button" class="btn btn-primary" data-ver-cartera>Ver cartera</button><button type="button" class="btn btn-secondary" data-cartera-volver>Regresar al menú principal</button></div><p data-cartera-estado role="status"></p></section>`);
    cargarSelectorVendedorCarteraInicio(panel);
    agregarAccionesClientesCarteraSiigo(panel);
    reorganizarInicioCarteraSiigo(panel);
    panel.querySelector('[data-ver-cartera]').addEventListener('click', () => {
        panel._filtroAlertaCartera = '';
        panel._filtroProximoHoyCartera = false;
        panel.querySelector('[data-cartera-inicio]').hidden = true;
        mostrarFiltrosVencidasSiigo(true);
        aplicarFiltroVendedorCarteraInicio(panel);
        panel.querySelector('form')?.requestSubmit();
    });
    panel.querySelector('[data-cartera-volver]').addEventListener('click', regresarMenuPrincipalCarteraSiigo);
    panel.querySelector('[data-cartera-anio]')?.addEventListener('change', () => cargarAlertasInicioCarteraSiigo(panel));
}

function reorganizarInicioCarteraSiigo(panel) {
    const inicio = panel.querySelector('[data-cartera-inicio]');
    if (!inicio || inicio.dataset.reorganizado) return;
    inicio.dataset.reorganizado = '1';
    inicio.querySelector(':scope > div:first-child')?.remove();
    const acciones = inicio.querySelector('.button-group');
    const alertas = inicio.querySelector('[data-cartera-alertas]');
    const vendedorCaja = inicio.querySelector('[data-cartera-vendedor-caja]');
    const anioActual = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric' }).format(new Date());
    const filtros = document.createElement('div');
    filtros.className = 'siigo-cartera-filtros';
    filtros.innerHTML = esVendedorCarteraSiigo()
        ? ''
        : `<div class="form-group"><label for="siigoCarteraAnioResumen">Año</label><input id="siigoCarteraAnioResumen" type="number" min="2020" max="2100" step="1" value="${anioActual}" data-cartera-anio></div>`;
    if (vendedorCaja) filtros.insertBefore(vendedorCaja, filtros.firstChild);
    if (acciones) {
        acciones.classList.add('siigo-cartera-acciones');
        inicio.prepend(acciones);
        acciones.insertAdjacentElement('afterend', filtros);
    }
    if (alertas) {
        alertas.insertAdjacentHTML('afterend', '<div class="siigo-cartera-resumen" data-cartera-resumen></div>');
    }
}

function descargarComparativoClientesSiigo(event) {
    const params = paramsComparativoClientesSiigo(event.currentTarget.closest('form'));
    params.set('formato', 'xlsx');
    descargarExcelSiigo(`/api/contable/comparativo-clientes?${params.toString()}`, 'comparativo_clientes.xlsx',
        document.getElementById('siigoComparativoResultado'), event.currentTarget);
}

function descargarComprobantesSiigo(event) {
    const params = paramsConsultaComprobantesSiigo();
    params.set('formato', 'xlsx');
    descargarExcelSiigo(`/api/contable/comprobantes?${params.toString()}`, 'consulta_por_cliente.xlsx',
        document.getElementById('siigoConsultaResultado'), event.currentTarget);
}

function agregarAccionesClientesCarteraSiigo(panel) {
    const acciones = panel.querySelector('[data-cartera-inicio] .button-group');
    const volver = panel.querySelector('[data-cartera-volver]');
    if (!acciones || !volver || panel.querySelector('[data-cartera-nuevo-cliente]')) return;

    const nuevo = document.createElement('button');
    nuevo.type = 'button';
    nuevo.className = 'btn btn-secondary';
    nuevo.dataset.carteraNuevoCliente = '1';
    nuevo.textContent = 'Nuevo cliente';
    nuevo.addEventListener('click', async () => {
        if (typeof switchComercialSection === 'function') {
            await switchComercialSection('clientes', { focus: false });
        }
        if (typeof mostrarAgregarClienteComercial === 'function') {
            mostrarAgregarClienteComercial();
        } else {
            window.location.href = urlMaestroClientesCarteraSiigo();
        }
    });

    const maestro = document.createElement('button');
    maestro.type = 'button';
    maestro.className = 'btn btn-secondary';
    maestro.dataset.carteraMaestroClientes = '1';
    maestro.textContent = 'Maestro de clientes';
    maestro.addEventListener('click', () => {
        window.location.href = urlMaestroClientesCarteraSiigo();
    });

    const chat = document.createElement('button');
    chat.type = 'button';
    chat.className = 'btn btn-secondary';
    chat.dataset.carteraChatVendedor = '1';
    chat.textContent = 'Chat vendedor';
    chat.addEventListener('click', () => abrirChatVendedorCarteraSiigo(panel));

    acciones.insertBefore(nuevo, volver);
    acciones.insertBefore(maestro, volver);
    acciones.insertBefore(chat, volver);
    actualizarAccionesClientesCarteraSiigo(panel);
}

function actualizarAccionesClientesCarteraSiigo(panel = document.getElementById('siigoFacturasVencidasPanel')) {
    if (!panel) return;
    const puedeCrear = typeof canManageComercial === 'function' && canManageComercial('clientes', 'create');
    const puedeLeer = typeof canManageComercial === 'function' && canManageComercial('clientes', 'read');
    const nuevo = panel.querySelector('[data-cartera-nuevo-cliente]');
    const maestro = panel.querySelector('[data-cartera-maestro-clientes]');
    const chat = panel.querySelector('[data-cartera-chat-vendedor]');
    if (nuevo) nuevo.style.display = puedeCrear ? '' : 'none';
    if (maestro) maestro.style.display = puedeLeer ? '' : 'none';
    if (chat) chat.style.display = puedeLeer ? '' : 'none';
}

function urlMaestroClientesCarteraSiigo(panel = document.getElementById('siigoFacturasVencidasPanel')) {
    const params = new URLSearchParams();
    if (panel?._filtroVendedorCartera) {
        params.set('vendedor_id', panel._filtroVendedorCartera);
    }
    const query = params.toString();
    return `/api/comercial/maestros${query ? `?${query}` : ''}#clientes`;
}

// Solo un Administrador puede elegir ver un vendedor puntual o todos; un vendedor siempre ve lo suyo.
async function cargarSelectorVendedorCarteraInicio(panel) {
    const caja = panel.querySelector('[data-cartera-vendedor-caja]');
    const select = panel.querySelector('[data-cartera-vendedor]');
    try {
        const data = await cargarFiltrosClientesSiigo();
        panel._vendedoresCartera = data.vendedores || [];
        if (!data.es_administrador) return;
        select.replaceChildren(new Option('Todos los vendedores', ''));
        panel._vendedoresCartera.forEach(v => select.add(new Option(v.nombre, v.id)));
        caja.hidden = false;
        select.addEventListener('change', () => {
            panel._filtroVendedorCartera = select.value;
            cargarAlertasInicioCarteraSiigo(panel);
        });
    } catch (error) {
        console.error('Error cargando vendedores para Gestión de cartera:', error);
    }
}

function nombreVendedorCarteraSiigo(panel) {
    const id = panel._filtroVendedorCartera;
    if (!id) return 'Todos los vendedores';
    const vendedor = (panel._vendedoresCartera || []).find(v => String(v.id) === String(id));
    return vendedor ? vendedor.nombre : 'Vendedor seleccionado';
}

function aplicarFiltroVendedorCarteraInicio(panel) {
    const form = panel.querySelector('form');
    if (form?._aplicarVendedorCarteraSiigo) {
        form._aplicarVendedorCarteraSiigo(panel._filtroVendedorCartera);
    } else if (form) {
        // El fetch de vendedores/contactos de este formulario aún no responde; se reintenta al terminar.
        const vendedorSelect = form.elements?.namedItem('vendedor_id');
        if (vendedorSelect) vendedorSelect.value = panel._filtroVendedorCartera || '';
        window.setTimeout(() => form._aplicarVendedorCarteraSiigo?.(panel._filtroVendedorCartera), 300);
    }
    const titulo = panel.querySelector('[data-vencidas-filtros] h3');
    if (titulo) {
        titulo.querySelector('.siigo-cartera-vendedor-actual')?.remove();
        titulo.insertAdjacentHTML('beforeend', ` <span class="siigo-cartera-vendedor-actual">· ${escapeSiigo(nombreVendedorCarteraSiigo(panel))}</span>`);
    }
}

function mostrarInicioGestionCarteraSiigo(panel) {
    panel._filtroAlertaCartera = '';
    panel._filtroProximoHoyCartera = false;
    mostrarFiltrosVencidasSiigo(false);
    panel.querySelector('[data-cartera-inicio]').hidden = false;
    panel.querySelector('[data-vencidas-filtros]').hidden = true;
    cargarAlertasInicioCarteraSiigo(panel);
}

async function cargarAlertasInicioCarteraSiigo(panel) {
    const estado = panel.querySelector('[data-cartera-estado]');
    const alertas = panel.querySelector('[data-cartera-alertas]');
    const resumen = panel.querySelector('[data-cartera-resumen]');
    const anio = anioCarteraSeleccionadoSiigo(panel);
    const rangoAnio = rangoAnioCarteraSiigo(anio);
    const fecha = rangoAnio.hasta;
    const corteInput = panel.querySelector('#siigoVencidasCorte');
    if (corteInput) corteInput.value = fecha;
    estado.textContent = 'Calculando alertas...';
    try {
        const params = new URLSearchParams({ informe: 'vencidas', fecha_corte: fecha, desde: rangoAnio.desde, hasta: rangoAnio.hasta, estado_facturas: 'todos' });
        if (panel._filtroVendedorCartera) params.set('vendedor_id', panel._filtroVendedorCartera);
        const anioParams = new URLSearchParams({ fecha_corte: rangoAnio.hasta, desde: rangoAnio.desde, hasta: rangoAnio.hasta });
        if (panel._filtroVendedorCartera) anioParams.set('vendedor_id', panel._filtroVendedorCartera);
        const consultas = [
            fetch(`/api/contable/cartera-dinamica?${params}`, { credentials: 'include' }),
            fetch(`/api/contable/cartera-dinamica?${anioParams}`, { credentials: 'include' }),
        ];
        const [response, resumenResponse] = await Promise.all(consultas);
        const data = await leerRespuestaSiigo(response);
        const resumenData = await leerRespuestaSiigo(resumenResponse);
        if (!response.ok) throw new Error(data.error || 'No fue posible calcular las alertas.');
        if (!resumenResponse.ok) throw new Error(resumenData.error || 'No fue posible calcular el resumen del año.');
        panel._datosVencidas = data;
        panel._resumenInicioCartera = { anio: resumenData, anioSeleccionado: anio };
        const hoy = fechaHoyCarteraSiigo();
        const proximosHoy = (data.clientes || []).filter(cliente => (cliente.seguimientos || []).some(item => item.proximo_seguimiento === hoy)).length;
        alertas.innerHTML = `${ordenEstadosGestionCarteraSiigo.map(estadoClave => `<button type="button" class="siigo-alerta-card siigo-${estadoClave}" data-alerta-inicio="${estadoClave}"><span>${estadosGestionCarteraSiigo[estadoClave]}:</span><strong>${(data.clientes || []).filter(cliente => estadoClienteCarteraSiigo(cliente) === estadoClave).length}</strong></button>`).join('')}<button type="button" class="siigo-alerta-card siigo-proximo-hoy" data-proximo-hoy><span>Próximo seguimiento hoy:</span><strong>${proximosHoy}</strong></button>`;
        if (resumen) resumen.innerHTML = renderResumenInicioCarteraSiigo(resumenData, anio);
        resumen?.querySelectorAll('[data-cartera-resumen-detalle]').forEach(boton => {
            boton.addEventListener('click', () => abrirDetalleResumenInicioCarteraSiigo(panel, boton.dataset.carteraResumenDetalle));
        });
        alertas.querySelectorAll('[data-alerta-inicio]').forEach(boton => {
            boton.addEventListener('click', () => {
                panel._filtroAlertaCartera = boton.dataset.alertaInicio;
                panel._filtroProximoHoyCartera = false;
                panel.querySelector('[data-cartera-inicio]').hidden = true;
                mostrarFiltrosVencidasSiigo(true);
                aplicarFiltroVendedorCarteraInicio(panel);
                panel.querySelector('form')?.requestSubmit();
            });
        });
        alertas.querySelector('[data-proximo-hoy]')?.addEventListener('click', () => {
            panel._filtroAlertaCartera = '';
            panel._filtroProximoHoyCartera = true;
            panel.querySelector('[data-cartera-inicio]').hidden = true;
            mostrarFiltrosVencidasSiigo(true);
            aplicarFiltroVendedorCarteraInicio(panel);
            panel.querySelector('form')?.requestSubmit();
        });
        estado.textContent = '';
    } catch (error) {
        estado.textContent = error.message;
    }
}

function anioCarteraSeleccionadoSiigo(panel) {
    const anioActual = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric' }).format(new Date());
    const valor = Number(panel?.querySelector('[data-cartera-anio]')?.value || anioActual);
    return Number.isFinite(valor) && valor >= 2020 && valor <= 2100 ? valor : Number(anioActual);
}

function rangoAnioCarteraSiigo(anio) {
    const year = Number(anio);
    const desde = `${year}-01-01`;
    const hasta = `${year}-12-31`;
    return { desde, hasta };
}

function totalesResumenCarteraSiigo(data) {
    if (data?.totales) {
        return {
            ventas: Number(data.totales.ventas || 0),
            recaudado: Number(data.totales.recaudado || 0),
            sinRecaudo: Number(data.totales.sin_recaudo || data.totales.sinRecaudo || 0),
            cartera: Number(data.totales.cartera || 0),
        };
    }
    const periodos = data?.periodos || [];
    const ventas = periodos.reduce((suma, item) => suma + Number(item.facturado || 0), 0);
    const recaudado = periodos.reduce((suma, item) => suma + Number(item.recaudado || 0), 0);
    const cartera = (data?.cartera_clientes || []).reduce((suma, item) => suma + Number(item.saldo || 0), 0);
    return { ventas, recaudado, sinRecaudo: cartera, cartera };
}

function renderResumenInicioCarteraSiigo(anioData, anio) {
    const acumulado = totalesResumenCarteraSiigo(anioData);
    if (esVendedorCarteraSiigo()) {
        return `<section class="siigo-cartera-resumen-bloque"><div class="siigo-cartera-resumen-header"><h4>Cartera ${escapeSiigo(anio)}</h4></div><dl><div><dt>Total cartera</dt><dd>${formatoSiigoNumero(acumulado.cartera)}</dd></div></dl></section>`;
    }
    const bloque = (titulo, datos, tipo) => `<section class="siigo-cartera-resumen-bloque"><div class="siigo-cartera-resumen-header"><h4>${escapeSiigo(titulo)}</h4><button type="button" class="btn btn-secondary" data-cartera-resumen-detalle="${tipo}">Ver detalle</button></div><dl><div><dt>Total ventas</dt><dd>${formatoSiigoNumero(datos.ventas)}</dd></div><div><dt>Total recaudado</dt><dd>${formatoSiigoNumero(datos.recaudado)}</dd></div><div><dt>Total sin recaudo</dt><dd>${formatoSiigoNumero(datos.sinRecaudo)}</dd></div><div><dt>Cartera a corte</dt><dd>${formatoSiigoNumero(datos.cartera)}</dd></div></dl></section>`;
    return bloque(`Año ${anio}`, acumulado, 'anio');
}

function abrirDetalleResumenInicioCarteraSiigo(panel, tipo) {
    const data = panel?._resumenInicioCartera?.[tipo];
    if (!data) return;
    const anioSeleccionado = panel._resumenInicioCartera.anioSeleccionado;
    const titulo = `Detalle año ${anioSeleccionado}`;
    const clientes = data.cartera_clientes || [];
    const dialogo = document.createElement('dialog');
    dialogo.className = 'siigo-seguimiento-dialogo siigo-cartera-detalle-dialogo';
    dialogo.innerHTML = `<div class="siigo-seguimiento-cabecera"><h2>${escapeSiigo(titulo)}</h2></div><div class="button-group"><button type="button" class="btn btn-primary" data-cerrar>Cerrar</button></div><p class="form-help">Fecha de corte: ${escapeSiigo(formatoSiigoFecha(data.fecha_corte || ''))}. Clientes: ${clientes.length}.</p><div data-cartera-detalle-contenido>${tablaCarteraClientesSiigo(clientes) || '<p>No hay cartera para este periodo.</p>'}</div>`;
    document.body.appendChild(dialogo);
    const contenido = dialogo.querySelector('[data-cartera-detalle-contenido]');
    contenido.querySelectorAll('[data-siigo-cliente-index]').forEach(button => button.addEventListener('click', () => {
        const cliente = clientes[Number(button.dataset.siigoClienteIndex)];
        if (cliente) mostrarDetalleCarteraClienteSiigo(contenido, cliente, button);
    }));
    dialogo.querySelector('[data-cerrar]').addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('close', () => dialogo.remove(), { once: true });
    dialogo.showModal();
}

function regresarMenuPrincipalCarteraSiigo() {
    mostrarFiltrosVencidasSiigo(false);
    actualizarModoCarteraSiigo(false);
    const vistas = document.querySelectorAll('.module-view');
    vistas.forEach(view => view.classList.remove('active'));
    document.getElementById('appBannerView')?.classList.add('active');
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    const titulo = document.getElementById('moduleTitle');
    if (titulo) titulo.textContent = 'Gestión de Servicios';
}

function mostrarFiltrosVencidasSiigo(enfocar = false) {
    const panel = document.getElementById('siigoFacturasVencidasPanel');
    document.body.classList.remove('body-siigo-vencidas-informe', 'body-siigo-vencidas-activo');
    if (!panel) return;
    panel._consultaVencidas?.abort();
    panel._scrollVencidas?.disconnect();
    panel.querySelector('.siigo-vencidas-visor').hidden = true;
    const inicio = panel.querySelector('[data-cartera-inicio]');
    if (panel.dataset.origen === 'comercial-cartera' && !enfocar && inicio) {
        inicio.hidden = false;
        panel.querySelector('[data-vencidas-filtros]').hidden = true;
        return;
    }
    if (inicio) inicio.hidden = true;
    panel.querySelector('[data-vencidas-filtros]').hidden = false;
    if (enfocar) {
        document.body.classList.add('body-siigo-vencidas-activo');
        actualizarModoCarteraSiigo(true);
        (panel.querySelector('#siigoVencidasCliente') || panel.querySelector('[data-vencidas-generar]'))?.focus();
        panel.scrollIntoView({ block: 'start' });
    }
}

function sincronizarBarraVencidasSiigo(panel) {
    panel._scrollVencidas?.disconnect();
    const tabla = panel.querySelector('.siigo-vencidas-datos > .siigo-tabla-con-encabezado-fijo');
    const barra = panel.querySelector('.siigo-vencidas-barra');
    if (!tabla) { barra.hidden = true; return; }
    barra.hidden = false;
    const ajustar = () => {
        // Igualar el ancho útil evita diferencias por la barra vertical de la tabla.
        barra.style.width = `${tabla.clientWidth}px`;
        barra.firstElementChild.style.width = `${tabla.scrollWidth}px`;
        barra.scrollLeft = tabla.scrollLeft;
    };
    let posicion = tabla.scrollLeft;
    tabla.addEventListener('scroll', () => {
        if (tabla.scrollLeft === posicion) return;
        posicion = tabla.scrollLeft;
        barra.scrollLeft = posicion;
    }, { passive: true });
    barra.onscroll = () => {
        if (barra.scrollLeft === posicion) return;
        posicion = barra.scrollLeft;
        tabla.scrollLeft = posicion;
    };
    panel._scrollVencidas = new ResizeObserver(ajustar);
    panel._scrollVencidas.observe(tabla);
    panel._scrollVencidas.observe(tabla.querySelector('table'));
    ajustar();
}

async function consultarFacturasVencidasSiigo(form) {
    if (!form.reportValidity()) return;
    const panel = form.closest('.recent-section');
    panel._consultaVencidas?.abort();
    const controller = new AbortController();
    panel._consultaVencidas = controller;
    const visor = panel.querySelector('.siigo-vencidas-visor');
    const estado = panel.querySelector(visor.hidden ? '[data-vencidas-estado]' : '#siigoVencidasCargaResultado');
    const anioSeleccionado = panel.dataset.origen === 'comercial-cartera' ? anioCarteraSeleccionadoSiigo(panel) : null;
    const fechaCorte = anioSeleccionado ? rangoAnioCarteraSiigo(anioSeleccionado).hasta : (form.elements.fecha_corte?.value || fechaCorteAnualCarteraSiigo());
    if (form.elements.fecha_corte) form.elements.fecha_corte.value = fechaCorte;
    const rangoConsulta = anioSeleccionado ? rangoAnioCarteraSiigo(anioSeleccionado) : null;
    const filtros = {
        ...valoresFiltrosMaestroSiigo(form),
        fecha_corte: fechaCorte,
        ...(rangoConsulta ? { desde: rangoConsulta.desde, hasta: rangoConsulta.hasta } : {}),
        cliente: form.elements.cliente.value.trim(),
        estado_facturas: form.elements.estado_facturas.value,
    };
    if (panel.dataset.origen === 'comercial-cartera' && panel._filtroVendedorCartera) {
        filtros.vendedor_id = panel._filtroVendedorCartera;
    }
    const params = new URLSearchParams({ informe: 'vencidas', ...filtros });
    const botones = [form.querySelector('[type="submit"]'), panel.querySelector('[data-vencidas-generar]')];
    botones.forEach(boton => { boton.disabled = true; });
    estado.textContent = 'Consultando facturas...';
    try {
        const response = await fetch(`/api/contable/cartera-dinamica?${params}`, { credentials: 'include', signal: controller.signal });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible calcular la cartera.');
        if (controller.signal.aborted) return;
        panel._filtrosConsultados = filtros;
        const estadoFacturas = form.elements.estado_facturas.selectedOptions[0].textContent;
        const nombre = filtros.cliente && (data.clientes?.length === 1 ? data.clientes[0].cliente : filtros.cliente);
        const filtroExtra = panel._filtroProximoHoyCartera ? ' · Próximo seguimiento hoy' : '';
        panel.querySelector('[data-vencidas-meta]').textContent = `Fecha de corte: ${formatoSiigoFecha(data.fecha_corte)} | ${estadoFacturas}${nombre ? ` · Cliente: ${nombre}` : ''}${filtroExtra}`;
        const resultado = panel.querySelector('.siigo-vencidas-datos');
        panel._datosVencidas = data;
        const dataTabla = panel._filtroAlertaCartera
            ? { ...data, clientes: (data.clientes || []).map((cliente, indiceOriginal) => ({ ...cliente, _indiceOriginal: indiceOriginal })).filter(cliente => estadoClienteCarteraSiigo(cliente) === panel._filtroAlertaCartera) }
            : panel._filtroProximoHoyCartera
                ? { ...data, clientes: (data.clientes || []).map((cliente, indiceOriginal) => ({ ...cliente, _indiceOriginal: indiceOriginal })).filter(cliente => (cliente.seguimientos || []).some(item => item.proximo_seguimiento === fechaHoyCarteraSiigo())) }
                : data;
        panel._clientesSeguimientoVisibles = dataTabla.clientes || [];
        resultado.innerHTML = tablaFacturasVencidasSiigo(dataTabla);
        actualizarAlertasCarteraSiigo(panel);
        resultado.onclick = event => {
            const boton = event.target.closest('[data-siigo-seguimiento]');
            if (!boton) return;
            const cliente = (panel._clientesSeguimientoVisibles || [])[Number(boton.dataset.siigoSeguimiento)];
            if (cliente) abrirSeguimientoCarteraSiigo(cliente);
        };
        estado.textContent = '';
        panel.querySelector('[data-vencidas-filtros]').hidden = true;
        visor.hidden = false;
        document.body.classList.add('body-siigo-vencidas-informe');
        sincronizarBarraVencidasSiigo(panel);
        panel.querySelector('.siigo-vencidas-cabecera h2').focus({ preventScroll: true });
    } catch (error) {
        if (error.name !== 'AbortError') estado.textContent = error.message;
    } finally {
        if (panel._consultaVencidas === controller) {
            botones.forEach(boton => { boton.disabled = false; });
            panel._consultaVencidas = null;
            if (controller.signal.aborted) estado.textContent = '';
        }
    }
}

function comprobantesPagoCarteraSiigo(item) {
    const archivos = item.comprobantes_pago || [];
    return `<section class="siigo-comprobantes-pago"><h5>Comprobantes de pago</h5>${archivos.length ? `<ul>${archivos.map(a => `<li>${escapeSiigo(a.nombre)} · ${Math.ceil(a.tamano_bytes / 1024)} KB <a href="${escapeSiigo(a.url)}" target="_blank" rel="noopener">Ver</a> · <a href="${escapeSiigo(a.url)}?descargar=1">Descargar</a></li>`).join('')}</ul>` : '<p>Sin comprobantes adjuntos.</p>'}<label for="siigoAdjuntos${item.id}">Subir comprobantes de pago</label><input id="siigoAdjuntos${item.id}" type="file" data-adjuntos-seguimiento="${item.id}" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple><small>PDF, JPG, PNG o WebP. Hasta 5 archivos, máximo 10 MB por archivo y 15 MB por carga.</small></section>`;
}

function datosComunicacionCompromisoSiigo(item, cliente) {
    if (!item?.fecha_compromiso) return null;
    const asunto = `Compromiso de pago ${cliente?.cliente || ''}`.trim();
    const texto = [
        `Cliente: ${cliente?.cliente || item.cliente_nombre || ''}`,
        `Identificación: ${cliente?.identificacion || item.identificacion || ''}`,
        `Fecha compromiso: ${formatoSiigoFecha(item.fecha_compromiso)}`,
        item.valor_compromiso != null ? `Valor compromiso: ${formatoSiigoNumero(item.valor_compromiso)}` : '',
        `Gestión: ${item.observaciones || ''}`,
    ].filter(Boolean).join('\n');
    return { asunto, texto };
}

function agregarAccionesComunicacionCompromisoSiigo(contenedor, registros, cliente) {
    contenedor.querySelectorAll('.siigo-seguimiento-registro').forEach((article, index) => {
        if (!article.querySelector('.siigo-estado-gestion-historial')) {
            const estado = normalizarEstadoGestionCarteraSiigo(registros[index]?.estado_gestion || (registros[index]?.fecha_compromiso ? 'con_compromiso' : 'en_proceso'));
            article.querySelector('h4')?.insertAdjacentHTML('afterend', `<p class="siigo-estado-gestion-historial"><span class="siigo-semaforo siigo-${estado}">${estadosGestionCarteraSiigo[estado] || 'Sin Gestión'}</span></p>`);
        }
    });
}

function historialSeguimientoCarteraSiigo(registros, cliente = null) {
    if (!registros.length) return '<p>Este cliente aún no tiene seguimientos registrados.</p>';
    return registros.map(item => `<article class="siigo-seguimiento-registro" data-seguimiento-id="${item.id}">${item.fecha_compromiso ? `<label class="siigo-seguimiento-seleccion"><input type="radio" name="siigoSeguimientoSeleccion" value="${item.id}"> Seleccionar este compromiso</label>` : ''}<h4>${escapeSiigo(formatoSiigoFechaHora(item.fecha_hora_gestion || item.created_at))} · ${escapeSiigo(item.medio)}</h4><p>Registrado por: <strong>${escapeSiigo(item.registrado_por)}</strong>${item.contacto ? ` · Contacto: ${escapeSiigo(item.contacto)}` : ''}</p><p class="siigo-seguimiento-nota">${escapeSiigo(item.observaciones)}</p>${item.fecha_compromiso ? `<p><span class="siigo-semaforo siigo-${item.estado_compromiso}">${estadosCompromisoSiigo[item.estado_compromiso]}</span> Compromiso de pago: ${escapeSiigo(formatoSiigoFecha(item.fecha_compromiso))}${item.valor_compromiso != null ? ` · ${formatoSiigoNumero(item.valor_compromiso)}` : ''}</p>` : ''}${item.compromiso_cumplido_at ? `<p>Cumplimiento registrado por ${escapeSiigo(item.compromiso_cumplido_por)} · ${escapeSiigo(formatoSiigoFecha(item.compromiso_cumplido_at.slice(0, 10)))}</p>` : ''}${item.proximo_seguimiento ? `<p>Próximo seguimiento: ${escapeSiigo(formatoSiigoFecha(item.proximo_seguimiento))}</p>` : ''}${comprobantesPagoCarteraSiigo(item)}</article>`).join('');
}

function etiquetaTipoChatCarteraSiigo(tipo) {
    return {
        AUTORIZACION_ARREGLO: 'Autorizacion de arreglo',
        SOLICITUD_INFO: 'Solicitud de informacion',
        GENERAL: 'General',
    }[tipo] || tipo || 'General';
}

function renderChatCarteraSiigo(hilos) {
    if (!hilos.length) return '<p class="form-help">Aun no hay conversaciones internas para este contexto.</p>';
    return hilos.map(hilo => `<article class="siigo-seguimiento-registro" data-chat-hilo="${hilo.id}"><h4>${escapeSiigo(hilo.asunto)} <span class="siigo-semaforo siigo-${String(hilo.estado || '').toLowerCase()}">${escapeSiigo(hilo.estado)}</span></h4><p>${escapeSiigo(etiquetaTipoChatCarteraSiigo(hilo.tipo))} · Vendedor: ${escapeSiigo(hilo.vendedor_nombre || '')}</p><div>${(hilo.mensajes || []).map(m => `<p class="siigo-seguimiento-nota"><strong>${escapeSiigo(m.remitente_nombre)}</strong> · ${escapeSiigo(formatoSiigoFecha((m.created_at || '').slice(0, 10)))}${m.decision ? ` · ${escapeSiigo(m.decision)}` : ''}<br>${escapeSiigo(m.mensaje)}</p>`).join('')}</div>${hilo.estado === 'ABIERTO' ? `<form data-chat-responder="${hilo.id}"><div class="form-group"><label>Responder</label><textarea name="mensaje" rows="2" maxlength="5000" required></textarea></div><div class="button-group"><button type="submit" class="btn btn-primary">Enviar respuesta</button><button type="submit" class="btn btn-secondary" name="decision" value="AUTORIZADO">Autorizar</button><button type="submit" class="btn btn-secondary" name="decision" value="RECHAZADO">Rechazar</button><button type="submit" class="btn btn-secondary" name="decision" value="CERRADO">Cerrar</button></div></form>` : ''}</article>`).join('');
}

function bloqueChatCarteraSiigo(cliente) {
    return `<section class="siigo-chat-cartera"><div class="siigo-seccion-titulo"><div><h3>Chat interno / autorizaciones</h3><p class="form-help">Solicitudes y conversaciones relacionadas con esta gestion.</p></div></div><form data-chat-nuevo class="siigo-chat-form"><div class="form-row"><div class="form-group"><label>Tipo</label><select name="tipo" required><option value="AUTORIZACION_ARREGLO">Autorizacion de arreglo</option><option value="SOLICITUD_INFO">Solicitud de informacion</option><option value="GENERAL">General</option></select></div><div class="form-group"><label>Asunto</label><input name="asunto" maxlength="200" required value="${escapeSiigo(cliente?.cliente ? `Autorizacion ${cliente.cliente}` : 'Autorizacion de cartera')}"></div></div><div class="form-group"><label>Mensaje</label><textarea name="mensaje" rows="3" maxlength="5000" required></textarea></div><div class="button-group"><button type="submit" class="btn btn-primary">Pedir autorizacion</button></div></form><p data-chat-estado role="status"></p><div data-chat-historial></div></section>`;
}

async function cargarChatCarteraSiigo(dialogo, cliente, vendedorId = '') {
    const estado = dialogo.querySelector('[data-chat-estado]');
    const historial = dialogo.querySelector('[data-chat-historial]');
    if (!estado || !historial) return;
    estado.textContent = 'Consultando conversaciones...';
    try {
        const params = new URLSearchParams();
        if (cliente?.identificacion) params.set('identificacion', cliente.identificacion);
        else if (vendedorId) params.set('vendedor_id', vendedorId);
        const response = await fetch(`/api/contable/chat-cartera?${params}`, { credentials: 'include' });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible consultar el chat.');
        historial.innerHTML = renderChatCarteraSiigo(data.hilos || []);
        if (!(currentUser?.role === 'Administrador' || currentUser?.is_superuser || currentUser?.is_easy)) {
            historial.querySelectorAll('button[name="decision"]').forEach(boton => boton.remove());
        }
        estado.textContent = '';
    } catch (error) {
        estado.textContent = error.message;
    }
}

async function enviarRespuestaChatCarteraSiigo(dialogo, chatForm, recargar) {
    const estadoChat = dialogo.querySelector('[data-chat-estado]');
    const datos = Object.fromEntries(new FormData(chatForm));
    if (chatForm._chatSubmitter?.name === 'decision') datos.decision = chatForm._chatSubmitter.value;
    estadoChat.textContent = 'Enviando mensaje...';
    try {
        const response = await fetch(`/api/contable/chat-cartera/${chatForm.dataset.chatResponder}/mensajes`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos),
        });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible enviar el mensaje.');
        chatForm.reset();
        await recargar();
        estadoChat.textContent = 'Mensaje guardado.';
    } catch (error) {
        estadoChat.textContent = error.message;
    } finally {
        chatForm._chatSubmitter = null;
    }
}

function vincularRespuestasChatCarteraSiigo(dialogo, recargar) {
    const historial = dialogo.querySelector('[data-chat-historial]');
    if (!historial || historial.dataset.respuestasVinculadas) return;
    historial.dataset.respuestasVinculadas = '1';
    historial.addEventListener('click', event => {
        const boton = event.target.closest('[data-chat-responder] button[type="submit"]');
        if (!boton) return;
        const chatForm = boton.closest('[data-chat-responder]');
        if (chatForm) chatForm._chatSubmitter = boton;
    });
    historial.addEventListener('submit', async event => {
        const chatForm = event.target.closest('[data-chat-responder]');
        if (!chatForm) return;
        event.preventDefault();
        await enviarRespuestaChatCarteraSiigo(dialogo, chatForm, recargar);
    });
}

function abrirChatVendedorCarteraSiigo(panel) {
    const vendedorId = panel?._filtroVendedorCartera || '';
    const dialogo = document.createElement('dialog');
    dialogo.className = 'siigo-seguimiento-dialogo';
    dialogo.innerHTML = `<div class="siigo-seguimiento-cabecera"><h2>Chat de cartera del vendedor</h2></div><div class="button-group"><button type="button" class="btn btn-primary" data-cerrar>Cerrar</button></div>${bloqueChatCarteraSiigo(null)}`;
    document.body.appendChild(dialogo);
    dialogo.querySelector('[data-cerrar]').addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('close', () => dialogo.remove(), { once: true });
    cargarChatCarteraSiigo(dialogo, null, vendedorId);
    dialogo.querySelector('[data-chat-nuevo]')?.addEventListener('submit', async event => {
        event.preventDefault();
        const chatForm = event.currentTarget;
        const estadoChat = dialogo.querySelector('[data-chat-estado]');
        const datos = Object.fromEntries(new FormData(chatForm));
        if (vendedorId) datos.vendedor_id = vendedorId;
        estadoChat.textContent = 'Guardando conversacion...';
        try {
            const response = await fetch('/api/contable/chat-cartera', {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos),
            });
            const data = await leerRespuestaSiigo(response);
            if (!response.ok) throw new Error(data.error || 'No fue posible guardar la conversacion.');
            chatForm.reset();
            await cargarChatCarteraSiigo(dialogo, null, vendedorId);
            estadoChat.textContent = 'Conversacion creada.';
        } catch (error) { estadoChat.textContent = error.message; }
    });
    vincularRespuestasChatCarteraSiigo(dialogo, () => cargarChatCarteraSiigo(dialogo, null, vendedorId));
    dialogo.showModal();
}

const estadosCompromisoSiigo = { vencido: 'Vencido', proximo: 'Próximo a vencer', cumplido: 'Cumplido', pendiente: 'Pendiente', sin_compromiso: 'Sin compromiso' };

const estadosGestionCarteraSiigo = {
    sin_gestion: 'Sin Gestión',
    no_localizado: 'No localizado',
    en_proceso: 'En proceso',
    con_compromiso: 'Con compromiso',
};
const ordenEstadosGestionCarteraSiigo = ['sin_gestion', 'no_localizado', 'en_proceso', 'con_compromiso'];

function normalizarEstadoGestionCarteraSiigo(valor) {
    return String(valor || '').toLowerCase();
}

function estadoClienteCarteraSiigo(cliente) {
    if (!cliente) return 'sin_gestion';
    const registros = cliente.seguimientos || [];
    if (!registros.length) return 'sin_gestion';
    const ultimo = registros[0] || {};
    if (ultimo.estado_gestion) return normalizarEstadoGestionCarteraSiigo(ultimo.estado_gestion);
    return ultimo.fecha_compromiso ? 'con_compromiso' : 'en_proceso';
}

function empresasResponsableCarteraSiigo(cliente) {
    const agrupacion = cliente.agrupacion_responsable;
    if (!agrupacion || !Array.isArray(agrupacion.empresas)) return [];
    return agrupacion.empresas.filter(empresa => empresa && empresa.identificacion);
}

function resumenResponsableCarteraSiigo(cliente) {
    const agrupacion = cliente.agrupacion_responsable;
    const empresas = empresasResponsableCarteraSiigo(cliente);
    if (!agrupacion || !agrupacion.responsable) return '';
    const lista = empresas.length
        ? `<ul class="siigo-responsable-empresas">${empresas.map(empresa => `<li><strong>${escapeSiigo(empresa.cliente || 'Sin nombre')}</strong> · ${escapeSiigo(empresa.identificacion)}${empresa.vendedor ? ` · ${escapeSiigo(empresa.vendedor)}` : ''}</li>`).join('')}</ul>`
        : '';
    return `<section class="siigo-responsable-grupo"><h3>Responsable del grupo</h3><p><strong>${escapeSiigo(agrupacion.responsable)}</strong>${agrupacion.telefono_responsable ? ` · ${escapeSiigo(agrupacion.telefono_responsable)}` : ''}</p>${lista}</section>`;
}

function estadoCuentaClienteCarteraSiigo(cliente) {
    const facturas = cliente.facturas || [];
    if (!facturas.length) return '';
    const total = facturas.reduce((suma, factura) => suma + Number(factura.saldo || 0), 0);
    const filaFactura = factura => `<tr><td><label><input type="checkbox" name="facturas" value="${escapeSiigo(factura.referencia)}"> ${escapeSiigo(factura.referencia)}</label></td><td>${escapeSiigo(formatoSiigoFecha(factura.fecha_factura))}</td><td>${formatoSiigoNumero(factura.facturado)}</td><td>${escapeSiigo(formatoSiigoFecha(factura.fecha_vencimiento))}</td><td>${Number(factura.dias_vencido || 0)}</td><td>${formatoSiigoNumero(factura.saldo)}</td></tr>`;
    const vencidas = facturas.filter(factura => Number(factura.dias_vencido || 0) > 0);
    const porVencer = facturas.filter(factura => Number(factura.dias_vencido || 0) <= 0);
    const tablaFacturas = items => items.length ? `<table class="data-table"><thead><tr><th>Factura</th><th>Fecha factura</th><th>Valor factura</th><th>Vencimiento</th><th>Dias</th><th>Saldo</th></tr></thead><tbody>${items.map(filaFactura).join('')}</tbody></table>` : '<p class="form-help">No hay facturas en esta pestaña.</p>';
    const recibos = cliente.recibos_caja || [];
    const filasRecibos = recibos.map(recibo => `<tr><td>${escapeSiigo(recibo.tipo || '')}</td><td>${escapeSiigo(recibo.recibo)}</td><td>${escapeSiigo(formatoSiigoFecha(recibo.fecha))}</td><td>${escapeSiigo(recibo.factura)}</td><td>${escapeSiigo(formatoSiigoFecha(recibo.fecha_factura))}</td><td>${formatoSiigoNumero(recibo.valor_factura)}</td><td>${formatoSiigoNumero(recibo.valor)}</td></tr>`).join('');
    const tablaRecibos = `<details class="siigo-recibos-caja"><summary>RC, NC, AC y cruces aplicados (${recibos.length})</summary>${filasRecibos ? `<table class="data-table"><thead><tr><th>Tipo</th><th>Comprobante</th><th>Fecha</th><th>Factura</th><th>Fecha factura</th><th>Valor factura</th><th>Valor aplicado</th></tr></thead><tbody>${filasRecibos}</tbody></table>` : '<p class="form-help">No hay movimientos aplicados a las facturas del cliente en esta consulta.</p>'}</details>`;
    const comprobanteForm = `<form class="siigo-comprobante-recibido" data-comprobante-recibido><h4>Adjuntar comprobante de pago</h4><input type="hidden" name="identificacion" value="${escapeSiigo(cliente.identificacion || '')}"><input type="hidden" name="cliente_nombre" value="${escapeSiigo(cliente.cliente || '')}"><div class="form-row siigo-form-dos"><div class="form-group"><label>Paciente</label><input name="paciente" maxlength="200"></div><div class="form-group"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div></div><div class="form-group"><label>Archivos *</label><input name="archivos" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple required></div><button type="submit" class="btn btn-primary">Guardar comprobante</button><p role="status"></p></form>`;
    return `<details class="siigo-estado-cuenta"><summary>Ver estado de cuenta</summary><p><strong>Total cartera: ${formatoSiigoNumero(total)}</strong></p><div class="siigo-tabs-cartera"><details open><summary>Vencidas (${vencidas.length})</summary>${tablaFacturas(vencidas)}</details><details><summary>Por vencer (${porVencer.length})</summary>${tablaFacturas(porVencer)}</details></div>${tablaRecibos}${comprobanteForm}</details>`;
}
async function guardarComprobanteRecibidoSiigo(form) {
    const estado = form.querySelector('[role="status"]');
    const archivos = form.querySelector('input[type="file"]')?.files || [];
    if (archivos.length > 5 || [...archivos].some(a => a.size > 10 * 1024 * 1024)) {
        estado.textContent = 'Seleccione hasta 5 archivos de maximo 10 MB cada uno.';
        return;
    }
    const datos = new FormData(form);
    const seleccionadas = form.closest('.siigo-estado-cuenta')?.querySelectorAll('input[name="facturas"]:checked') || [];
    datos.delete('facturas');
    seleccionadas.forEach(item => datos.append('facturas', item.value));
    estado.textContent = 'Guardando comprobante...';
    form.querySelectorAll('button, input').forEach(item => { item.disabled = true; });
    try {
        const response = await fetch('/api/contable/comprobantes-pago-recibidos', {
            method: 'POST',
            credentials: 'include',
            body: datos,
        });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible guardar el comprobante.');
        form.reset();
        estado.textContent = 'Comprobante guardado para conciliacion.';
    } catch (error) {
        estado.textContent = error.message;
    } finally {
        form.querySelectorAll('button, input').forEach(item => { item.disabled = false; });
    }
}

document.addEventListener('submit', event => {
    const form = event.target.closest('[data-comprobante-recibido]');
    if (!form) return;
    event.preventDefault();
    guardarComprobanteRecibidoSiigo(form);
});

function actualizarAlertasCarteraSiigo(panel) {
    const clientes = panel._datosVencidas?.clientes || [];
    panel.querySelector('[data-alertas-cartera]').innerHTML = ordenEstadosGestionCarteraSiigo.map(estado => `<button type="button" class="siigo-alerta-cartera siigo-${estado}" data-alerta-cartera="${estado}">${estadosGestionCarteraSiigo[estado]}: ${clientes.filter(c => estadoClienteCarteraSiigo(c) === estado).length}</button>`).join(' ');
    panel.querySelectorAll('[data-siigo-seguimiento]').forEach(boton => {
        const cliente = clientes[Number(boton.dataset.siigoSeguimiento)];
        const estado = estadoClienteCarteraSiigo(cliente);
        boton.className = `siigo-seguimiento-icono siigo-${estado}`;
        const etiqueta = `Seguimiento de cartera: ${estadosGestionCarteraSiigo[estado] || 'Sin Gestión'}`;
        boton.title = etiqueta;
        boton.setAttribute('aria-label', etiqueta);
    });
    panel.querySelectorAll('[data-alerta-cartera]').forEach(boton => {
        boton.addEventListener('click', () => {
            panel._filtroAlertaCartera = boton.dataset.alertaCartera;
            const form = panel.querySelector('form');
            if (form) consultarFacturasVencidasSiigo(form);
        });
    });
}

async function abrirSeguimientoCarteraSiigo(cliente) {
    const dialogo = document.createElement('dialog');
    dialogo.className = 'siigo-seguimiento-dialogo';
    dialogo.setAttribute('aria-labelledby', 'siigoSeguimientoTitulo');
    const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(new Date());
    const empresasGrupo = empresasResponsableCarteraSiigo(cliente);
    const opcionesAlcance = empresasGrupo.length > 1 ? `<div class="form-group"><label for="siigoGestionAlcance">Aplicar compromiso</label><select id="siigoGestionAlcance" name="alcance"><option value="empresa">Solo esta empresa</option><option value="grupo">Todas las empresas del responsable (${empresasGrupo.length})</option></select></div>` : '';
    dialogo.innerHTML = `<div class="siigo-seguimiento-shell"><div class="siigo-seguimiento-cabecera"><div><h2 id="siigoSeguimientoTitulo">Seguimiento de cartera</h2><p><strong>${escapeSiigo(cliente.cliente)}</strong> · ${escapeSiigo(cliente.identificacion)} · Vendedor: ${escapeSiigo(cliente.vendedor)}</p></div><button type="button" class="btn btn-primary" data-cerrar>Regresar</button></div><div class="button-group siigo-seguimiento-toolbar"><button type="button" class="btn btn-primary" data-nuevo disabled>Nuevo seguimiento</button><button type="button" class="btn btn-primary" data-marcar-cumplido disabled>Marcar cumplido</button><button type="button" class="btn btn-primary" data-enviar-correo disabled>Enviar por correo</button><button type="button" class="btn btn-primary" data-enviar-whatsapp disabled>Enviar por WhatsApp</button></div>${resumenResponsableCarteraSiigo(cliente)}<p data-estado role="status" aria-live="polite"></p><button type="button" class="btn btn-primary" data-reintentar hidden>Reintentar consulta</button><section class="siigo-historial-cartera"><div class="siigo-seccion-titulo"><div><h3>Historial de seguimientos</h3><p class="form-help">Historial completo del cliente, independiente de la fecha de corte.</p></div></div><div data-historial></div></section><form hidden class="siigo-nuevo-seguimiento"><h3>Nuevo seguimiento</h3>${opcionesAlcance}<div class="form-row siigo-form-dos"><div class="form-group"><label for="siigoGestionFecha">Fecha de gestión *</label><input id="siigoGestionFecha" name="fecha_gestion" type="date" required value="${hoy}" max="${hoy}"></div><div class="form-group"><label for="siigoGestionContacto">Persona contactada</label><input id="siigoGestionContacto" name="contacto" maxlength="200"></div></div><div class="form-group"><label for="siigoGestionMedio">Medio de contacto *</label><select id="siigoGestionMedio" name="medio" required><option value="">Seleccione</option><option value="LLAMADA">Llamada</option><option value="WHATSAPP">WhatsApp</option><option value="CORREO">Correo</option><option value="VISITA">Visita</option><option value="OTRO">Otro</option></select></div><div class="form-group"><label for="siigoGestionNota">Gestión realizada y acuerdos *</label><textarea id="siigoGestionNota" name="observaciones" rows="4" maxlength="5000" required></textarea></div><div class="form-row siigo-form-dos"><div class="form-group"><label for="siigoGestionCompromiso">Fecha compromiso de pago</label><input id="siigoGestionCompromiso" name="fecha_compromiso" type="date"></div><div class="form-group"><label for="siigoGestionValor">Valor compromiso (COP)</label><input id="siigoGestionValor" name="valor_compromiso" type="number" min="0.01" step="0.01"></div></div><div class="form-row siigo-form-dos"><div class="form-group"><label for="siigoGestionEstado">Estado del seguimiento *</label><select id="siigoGestionEstado" name="estado_gestion" required><option value="">Seleccione</option><option value="SIN_GESTION">Sin Gestión</option><option value="NO_LOCALIZADO">No localizado</option><option value="EN_PROCESO">En proceso</option><option value="CON_COMPROMISO">Con compromiso</option></select></div><div class="form-group"><label for="siigoGestionProximo">Próximo seguimiento</label><input id="siigoGestionProximo" name="proximo_seguimiento" type="date"></div></div><div class="button-group"><button type="submit" class="btn btn-primary">Guardar seguimiento</button><button type="button" class="btn btn-primary" data-cancelar>Cancelar</button></div></form></div>`;
    document.body.appendChild(dialogo);
    dialogo.querySelector('.siigo-historial-cartera').insertAdjacentHTML('beforebegin', estadoCuentaClienteCarteraSiigo(cliente));
    dialogo.querySelector('.siigo-seguimiento-shell').insertAdjacentHTML('beforeend', bloqueChatCarteraSiigo(cliente));
    const form = dialogo.querySelector('form.siigo-nuevo-seguimiento');
    if (!form) {
        dialogo.remove();
        alert('No fue posible abrir el formulario de seguimiento. Actualice la pagina e intente de nuevo.');
        return;
    }
    const estado = dialogo.querySelector('[data-estado]');
    const historial = dialogo.querySelector('[data-historial]');
    const nuevo = dialogo.querySelector('[data-nuevo]');
    const reintentar = dialogo.querySelector('[data-reintentar]');
    const fechaGestion = form.elements.fecha_gestion;
    fechaGestion.readOnly = true;
    fechaGestion.setAttribute('aria-readonly', 'true');
    const medioSelect = form.elements.medio;
    const medioOpciones = Array.from(medioSelect.options).filter(option => option.value);
    const medioGroup = document.createElement('fieldset');
    medioGroup.className = 'siigo-medios-contacto';
    medioGroup.innerHTML = `<legend>Medio de contacto *</legend><div class="siigo-medios-chips">${medioOpciones.map(option => `<label class="siigo-medio-chip"><input type="checkbox" name="medio_check" value="${escapeSiigo(option.value)}"><span>${escapeSiigo(option.textContent)}</span></label>`).join('')}</div>`;
    medioSelect.closest('.form-group').replaceWith(medioGroup);
    const mediosChecks = Array.from(medioGroup.querySelectorAll('input[name="medio_check"]'));
    const validarMedios = () => {
        const mensaje = mediosChecks.some(check => check.checked) ? '' : 'Seleccione al menos un medio de contacto.';
        mediosChecks[0]?.setCustomValidity(mensaje);
        return !mensaje;
    };
    mediosChecks.forEach(check => check.addEventListener('change', validarMedios));
    validarMedios();
    if (cliente.agrupacion_responsable?.responsable) {
        form.elements.contacto.value = cliente.agrupacion_responsable.responsable;
    }
    const valorCompromiso = form.elements.valor_compromiso;
    valorCompromiso.type = 'text';
    valorCompromiso.inputMode = 'decimal';
    valorCompromiso.placeholder = '0';
    const compromisoWraps = [form.elements.fecha_compromiso.closest('.form-group'), form.elements.valor_compromiso.closest('.form-group')];
    const actualizarCamposCompromiso = () => {
        const conCompromiso = form.elements.estado_gestion.value === 'CON_COMPROMISO';
        compromisoWraps.forEach(grupo => { if (grupo) grupo.hidden = !conCompromiso; });
        form.elements.fecha_compromiso.required = conCompromiso;
        form.elements.valor_compromiso.required = conCompromiso;
        if (!conCompromiso) {
            form.elements.fecha_compromiso.value = '';
            form.elements.valor_compromiso.value = '';
        }
    };
    form.elements.estado_gestion.addEventListener('change', actualizarCamposCompromiso);
    actualizarCamposCompromiso();
    valorCompromiso.addEventListener('input', () => {
        const limpio = valorCompromiso.value.replace(/[^\d,]/g, '');
        const partes = limpio.split(',');
        const entero = partes[0] ? Number(partes[0]).toLocaleString('es-CO') : '';
        valorCompromiso.value = partes.length > 1 ? `${entero},${partes.slice(1).join('').slice(0, 2)}` : entero;
    });
    let registros = [];
    let guardando = false;
    const cancelarNuevo = () => {
        if (guardando) return;
        form.reset();
        actualizarCamposCompromiso();
        form.hidden = true;
        nuevo.hidden = false;
        nuevo.focus();
    };
    dialogo.querySelector('[data-cerrar]').addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('close', () => dialogo.remove(), { once: true });
    nuevo.addEventListener('click', () => {
        form.hidden = false;
        nuevo.hidden = true;
        estado.textContent = '';
        if (cliente.agrupacion_responsable?.responsable && !form.elements.contacto.value) {
            form.elements.contacto.value = cliente.agrupacion_responsable.responsable;
        }
        form.elements.fecha_gestion.focus();
    });
    dialogo.querySelector('[data-cancelar]').addEventListener('click', cancelarNuevo);
    const marcarCumplidoBtn = dialogo.querySelector('[data-marcar-cumplido]');
    const enviarCorreoBtn = dialogo.querySelector('[data-enviar-correo]');
    const enviarWhatsappBtn = dialogo.querySelector('[data-enviar-whatsapp]');
    // Las 3 acciones del toolbar operan sobre el seguimiento con compromiso elegido en el historial.
    let seleccionId = null;
    const actualizarBotonesSeleccionSiigo = () => {
        const item = registros.find(r => r.id === seleccionId) || null;
        const datos = item ? datosComunicacionCompromisoSiigo(item, cliente) : null;
        marcarCumplidoBtn.disabled = !item || !!item.compromiso_cumplido_at;
        enviarCorreoBtn.disabled = !datos;
        enviarWhatsappBtn.disabled = !datos;
    };
    const vincularSeleccionHistorialSiigo = () => {
        if (!registros.some(r => r.id === seleccionId)) seleccionId = null;
        historial.querySelectorAll('input[name="siigoSeguimientoSeleccion"]').forEach(radio => {
            radio.checked = Number(radio.value) === seleccionId;
            // Un radio nativo no se puede desmarcar solo; permitimos volver a hacer clic para quitar la selección.
            radio.addEventListener('click', () => {
                const valor = Number(radio.value);
                if (valor === seleccionId) {
                    radio.checked = false;
                    seleccionId = null;
                } else {
                    seleccionId = valor;
                }
                actualizarBotonesSeleccionSiigo();
            });
        });
        actualizarBotonesSeleccionSiigo();
    };
    const cargarHistorial = async () => {
        estado.textContent = 'Consultando seguimientos...';
        reintentar.hidden = true;
        try {
            const params = new URLSearchParams({ identificacion: cliente.identificacion });
            const response = await fetch(`/api/contable/seguimiento-cartera?${params}`, { credentials: 'include' });
            const data = await leerRespuestaSiigo(response);
            if (!response.ok) throw new Error(data.error || 'No fue posible consultar el seguimiento.');
            registros = data.seguimientos;
            historial.innerHTML = historialSeguimientoCarteraSiigo(registros, cliente);
            agregarAccionesComunicacionCompromisoSiigo(historial, registros, cliente);
            vincularSeleccionHistorialSiigo();
            cliente.seguimientos = registros;
            actualizarAlertasCarteraSiigo(document.getElementById('siigoFacturasVencidasPanel'));
            estado.textContent = '';
            nuevo.disabled = false;
        } catch (error) {
            estado.textContent = error.message;
            reintentar.hidden = false;
        }
    };
    reintentar.addEventListener('click', cargarHistorial);
    cargarChatCarteraSiigo(dialogo, cliente);
    dialogo.querySelector('[data-chat-nuevo]')?.addEventListener('submit', async event => {
        event.preventDefault();
        const chatForm = event.currentTarget;
        const estadoChat = dialogo.querySelector('[data-chat-estado]');
        estadoChat.textContent = 'Guardando conversacion...';
        try {
            const datos = Object.fromEntries(new FormData(chatForm));
            datos.identificacion = cliente.identificacion;
            datos.cliente_nombre = cliente.cliente;
            const response = await fetch('/api/contable/chat-cartera', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos),
            });
            const data = await leerRespuestaSiigo(response);
            if (!response.ok) throw new Error(data.error || 'No fue posible guardar la conversacion.');
            chatForm.reset();
            await cargarChatCarteraSiigo(dialogo, cliente);
            estadoChat.textContent = 'Conversacion creada.';
        } catch (error) {
            estadoChat.textContent = error.message;
        }
    });
    vincularRespuestasChatCarteraSiigo(dialogo, () => cargarChatCarteraSiigo(dialogo, cliente));
    form.addEventListener('submit', async event => {
        event.preventDefault();
        validarMedios();
        if (guardando || !form.reportValidity()) return;
        guardando = true;
        const guardar = form.querySelector('[type="submit"]');
        guardar.disabled = true;
        estado.textContent = 'Guardando seguimiento...';
        try {
            const datos = Object.fromEntries(new FormData(form));
            datos.medio = mediosChecks.filter(check => check.checked).map(check => check.value);
            delete datos.medio_check;
            datos.valor_compromiso = (datos.valor_compromiso || '').replace(/\./g, '').replace(',', '.');
            datos.identificacion = cliente.identificacion;
            if (datos.alcance === 'grupo') {
                datos.identificaciones_grupo = empresasGrupo.map(empresa => empresa.identificacion);
            }
            const response = await fetch('/api/contable/seguimiento-cartera', {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos),
            });
            const data = await leerRespuestaSiigo(response);
            if (!response.ok) throw new Error(data.error || 'No fue posible guardar el seguimiento.');
            registros.push(data.seguimiento);
            registros.sort((a, b) => b.fecha_gestion.localeCompare(a.fecha_gestion) || b.created_at.localeCompare(a.created_at) || b.id - a.id);
            historial.innerHTML = historialSeguimientoCarteraSiigo(registros, cliente);
            agregarAccionesComunicacionCompromisoSiigo(historial, registros, cliente);
            vincularSeleccionHistorialSiigo();
            cliente.seguimientos = registros;
            if (Array.isArray(data.seguimientos) && data.seguimientos.length > 1) {
                const panel = document.getElementById('siigoFacturasVencidasPanel');
                const clientes = panel?._datosVencidas?.clientes || [];
                data.seguimientos.forEach(seguimiento => {
                    const empresa = clientes.find(item => item.identificacion === seguimiento.identificacion);
                    if (empresa) empresa.seguimientos = [...(empresa.seguimientos || []), seguimiento];
                });
                cliente.seguimientos = registros;
            }
            actualizarAlertasCarteraSiigo(document.getElementById('siigoFacturasVencidasPanel'));
            guardando = false;
            cancelarNuevo();
            estado.textContent = 'Seguimiento guardado correctamente.';
        } catch (error) {
            estado.textContent = error.message;
        } finally {
            guardando = false;
            guardar.disabled = false;
        }
    });
    historial.addEventListener('change', async event => {
        const input = event.target.closest('[data-adjuntos-seguimiento]');
        if (!input || !input.files.length || guardando) return;
        const archivos = [...input.files];
        if (archivos.length > 5 || archivos.some(a => a.size > 10 * 1024 * 1024) || archivos.reduce((n, a) => n + a.size, 0) > 15 * 1024 * 1024) {
            estado.textContent = 'Seleccione hasta 5 archivos: máximo 10 MB cada uno y 15 MB en total.';
            input.value = '';
            return;
        }
        guardando = true;
        input.disabled = true;
        estado.textContent = 'Subiendo comprobantes de pago...';
        try {
            const datos = new FormData();
            archivos.forEach(a => datos.append('archivos', a));
            const response = await fetch(`/api/contable/seguimiento-cartera/${input.dataset.adjuntosSeguimiento}/comprobantes`, {
                method: 'POST', credentials: 'include', body: datos,
            });
            const data = await leerRespuestaSiigo(response);
            if (!response.ok) throw new Error(data.error || 'No fue posible subir los comprobantes.');
            registros = registros.map(r => r.id === data.seguimiento.id ? data.seguimiento : r);
            cliente.seguimientos = registros;
            historial.innerHTML = historialSeguimientoCarteraSiigo(registros, cliente);
            agregarAccionesComunicacionCompromisoSiigo(historial, registros, cliente);
            vincularSeleccionHistorialSiigo();
            estado.textContent = 'Comprobantes guardados. Ya puede verlos o descargarlos.';
        } catch (error) {
            estado.textContent = error.message;
        } finally {
            guardando = false;
            input.disabled = false;
            input.value = '';
        }
    });
    marcarCumplidoBtn.addEventListener('click', async () => {
        const item = registros.find(r => r.id === seleccionId);
        if (!item || guardando) return;
        guardando = true;
        marcarCumplidoBtn.disabled = true;
        estado.textContent = 'Registrando cumplimiento...';
        try {
            const response = await fetch('/api/contable/seguimiento-cartera', {
                method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identificacion: cliente.identificacion, id: item.id }),
            });
            const data = await leerRespuestaSiigo(response);
            if (!response.ok) throw new Error(data.error || 'No fue posible registrar el cumplimiento.');
            registros = registros.map(r => r.id === data.seguimiento.id ? data.seguimiento : r);
            cliente.seguimientos = registros;
            historial.innerHTML = historialSeguimientoCarteraSiigo(registros, cliente);
            agregarAccionesComunicacionCompromisoSiigo(historial, registros, cliente);
            vincularSeleccionHistorialSiigo();
            actualizarAlertasCarteraSiigo(document.getElementById('siigoFacturasVencidasPanel'));
            estado.textContent = 'Compromiso marcado como cumplido.';
        } catch (error) {
            estado.textContent = error.message;
        } finally {
            guardando = false;
            actualizarBotonesSeleccionSiigo();
        }
    });
    enviarCorreoBtn.addEventListener('click', () => {
        const item = registros.find(r => r.id === seleccionId);
        const datos = item ? datosComunicacionCompromisoSiigo(item, cliente) : null;
        if (!datos) return;
        window.location.href = `mailto:?subject=${encodeURIComponent(datos.asunto)}&body=${encodeURIComponent(datos.texto)}`;
    });
    enviarWhatsappBtn.addEventListener('click', () => {
        const item = registros.find(r => r.id === seleccionId);
        const datos = item ? datosComunicacionCompromisoSiigo(item, cliente) : null;
        if (!datos) return;
        window.open(`https://wa.me/?text=${encodeURIComponent(datos.texto)}`, '_blank', 'noopener');
    });
    dialogo.showModal();
    await cargarHistorial();
}

function detalleCrucesFacturaSiigo(factura) {
    if (!factura.movimientos?.length) return formatoSiigoNumero(factura.saldo);
    const filas = factura.movimientos.map(mov => `<tr><td>${escapeSiigo(mov.comprobante)} / ${mov.secuencia}</td><td>${escapeSiigo(formatoSiigoFecha(mov.fecha))}</td><td>${formatoSiigoNumero(mov.debito)}</td><td>${formatoSiigoNumero(mov.credito)}</td></tr>`).join('');
    return `<details><summary>${formatoSiigoNumero(factura.saldo)} · Ver cruce</summary><p>Movimientos de cartera de ${escapeSiigo(factura.referencia)}</p><table><thead><tr><th>Comprobante / línea</th><th>Fecha</th><th>Débito</th><th>Crédito</th></tr></thead><tbody>${filas}</tbody></table></details>`;
}

function movimientosSinAsignarSiigo(movimientos) {
    if (!movimientos.length) return '';
    const filas = movimientos.map(item => `<tr><td>${escapeSiigo(item.comprobante)}</td><td>${escapeSiigo(formatoSiigoFecha(item.fecha))}</td><td>${escapeSiigo(item.identificacion)}</td><td>${escapeSiigo(item.referencia || 'Sin referencia')}</td><td>${formatoSiigoNumero(item.valor)}</td><td>${escapeSiigo(item.motivo)}</td></tr>`).join('');
    return `<details><summary><strong>Revisar ${movimientos.length} movimientos sin aplicar a las facturas de esta consulta</strong></summary><p class="form-help">Estos movimientos no se descontaron: falta identificar la factura, cargarla o verificar el tercero. Un valor positivo reduce cartera; uno negativo la aumenta.</p><div class="siigo-tabla-con-encabezado-fijo"><table class="data-table"><thead><tr><th>Comprobante</th><th>Fecha</th><th>Identificación</th><th>Factura</th><th>Valor</th><th>Motivo</th></tr></thead><tbody>${filas}</tbody></table></div></details>`;
}

function tablaFacturasVencidasSiigo(data) {
    const clientesOriginales = data.clientes || [];
    const clientes = clientesOriginales.map((cliente, indiceOriginal) => ({ cliente, indiceOriginal })).sort((a, b) => {
        const responsableA = a.cliente.agrupacion_responsable?.responsable || 'Sin responsable';
        const responsableB = b.cliente.agrupacion_responsable?.responsable || 'Sin responsable';
        return responsableA.localeCompare(responsableB, 'es') || (a.cliente.cliente || '').localeCompare(b.cliente.cliente || '', 'es');
    });
    if (!clientes.length) return '<p class="siigo-vencidas-vacio">No hay facturas con saldo pendiente para esta consulta.</p>';
    const totalClientes = clientes.reduce((suma, item) => suma + Number(item.cliente.total_cliente || 0), 0);
    const totalFacturas = clientes.reduce((suma, item) => suma + Number(item.cliente.cantidad_facturas || 0), 0);
    const resumen = `<div class="siigo-vencidas-resumen"><strong>${clientes.length}</strong> clientes <strong>${totalFacturas}</strong> facturas <strong>${formatoSiigoNumero(totalClientes)}</strong> total cartera</div>`;
    const cantidad = clientes.reduce((maximo, item) => Math.max(maximo, item.cliente.cantidad_facturas), 0);
    const encabezados = Array.from({ length: cantidad }, (_, indice) => `<th>N.º factura ${indice + 1}</th><th>Vencimiento</th><th>Valor</th>`).join('');
    let responsableActual = null;
    const filas = clientes.map(({ cliente, indiceOriginal }) => {
        const responsable = cliente.agrupacion_responsable?.responsable || 'Sin responsable';
        const totalResponsable = clientes
            .filter(item => (item.cliente.agrupacion_responsable?.responsable || 'Sin responsable') === responsable)
            .reduce((suma, item) => suma + Number(item.cliente.total_cliente || 0), 0);
        const encabezadoResponsable = responsable !== responsableActual
            ? `<tr class="siigo-responsable-fila"><th colspan="${cantidad * 3 + 6}">Responsable: ${escapeSiigo(responsable)} Â· Total cartera: ${formatoSiigoNumero(totalResponsable)}</th></tr>`
            : '';
        responsableActual = responsable;
        const detalle = cliente.facturas.map(factura => `<td>${escapeSiigo(factura.referencia)}</td><td>${factura.dias_vencido > 0 ? `Vencida hace ${factura.dias_vencido} días` : factura.dias_vencido === 0 ? 'Vence hoy' : `Por vencer en ${-factura.dias_vencido} días`}</td><td>${detalleCrucesFacturaSiigo(factura)}</td>`).join('');
        const vacias = '<td></td><td></td><td></td>'.repeat(cantidad - cliente.facturas.length);
        const seguimiento = cliente.identificacion
            ? `<button type="button" class="siigo-seguimiento-icono siigo-${estadoClienteCarteraSiigo(cliente)}" data-siigo-seguimiento="${indiceOriginal}" title="Seguimiento de cartera: ${estadosGestionCarteraSiigo[estadoClienteCarteraSiigo(cliente)] || 'Sin Gestión'}" aria-label="Seguimiento de cartera: ${estadosGestionCarteraSiigo[estadoClienteCarteraSiigo(cliente)] || 'Sin Gestión'}"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z"/><path d="M7 9h10M7 13h7"/></svg></button>`
            : '<span class="form-help">Sin identificación para seguimiento</span>';
        const estadoSeguimiento = estadoClienteCarteraSiigo(cliente);
        return `${encabezadoResponsable}<tr><td>${escapeSiigo(cliente.vendedor)}</td><td>${escapeSiigo(cliente.cliente)}</td><td>${cliente.cantidad_facturas}</td><td>${formatoSiigoNumero(cliente.total_cliente)}</td><td><span class="siigo-semaforo siigo-${estadoSeguimiento}">${estadosGestionCarteraSiigo[estadoSeguimiento] || 'Sin Gestión'}</span></td><td>${seguimiento}</td>${detalle}${vacias}</tr>`;
    }).join('');
    return `${resumen}<div class="siigo-tabla-con-encabezado-fijo" tabindex="0" role="region" aria-label="Seguimiento de cartera"><table class="data-table"><thead><tr><th>Vendedor</th><th>Cliente</th><th>Cantidad</th><th>Valor total cliente</th><th>Estado del seguimiento</th><th>Seguimiento</th>${encabezados}</tr></thead><tbody>${filas}</tbody></table></div>`;
}

async function consultarCarteraDinamicaSiigo(form, tipo) {
    if (tipo === 'vencidas') return consultarFacturasVencidasSiigo(form);
    const panel = form.closest('.recent-section');
    const result = panel.querySelector('.table-container');
    const fechaCorte = form.querySelector('input[type="date"]').value;
    const params = new URLSearchParams({ ...valoresFiltrosMaestroSiigo(form), fecha_corte: fechaCorte });
    if (tipo !== 'recaudo') actualizarModoCarteraSiigo(false);
    result.textContent = 'Calculando desde los comprobantes cargados...';
    try {
        const response = await fetch(`/api/contable/cartera-dinamica?${params.toString()}`, { credentials: 'include' });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible calcular la cartera.');
        if (tipo === 'pagos') {
            const rows = data.pagos_clientes || [];
            result.innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Cliente</th><th>Facturas pagadas</th><th>Promedio dias</th><th>Mas rapida</th><th>Dias</th><th>Mas lenta</th><th>Dias</th></tr></thead><tbody>${rows.map(item => `<tr><td>${escapeSiigo(item.cliente)}</td><td>${item.facturas_pagadas}</td><td>${item.promedio_dias}</td><td>${escapeSiigo(item.mas_rapida)}</td><td>${item.dias_mas_rapida}</td><td>${escapeSiigo(item.mas_lenta)}</td><td>${item.dias_mas_lenta}</td></tr>`).join('')}</tbody></table>` : 'No hay facturas totalmente pagadas para la fecha seleccionada.';
        } else {
            const rows = data.periodos || [];
            const tablaPeriodos = rows.length ? `<div class="siigo-tabla-con-encabezado-fijo"><table class="data-table"><thead><tr><th>Periodo</th><th>Facturado</th><th>Recaudado</th><th>Ajustes AC</th><th>Notas crédito</th><th>Notas débito</th><th>Otros cruces</th><th>Por vencer</th><th>1 a 30</th><th>31 a 60</th><th>61 a 90</th><th>Mas de 90</th><th>Saldo</th></tr></thead><tbody>${rows.map(item => `<tr><td>${item.periodo}</td><td>${formatoSiigoNumero(item.facturado)}</td><td>${formatoSiigoNumero(item.recaudado)}</td><td>${formatoSiigoNumero(item.ajustes_ac)}</td><td>${formatoSiigoNumero(item.notas_credito)}</td><td>${formatoSiigoNumero(item.notas_debito)}</td><td>${formatoSiigoNumero(item.otros_movimientos)}</td><td>${formatoSiigoNumero(item.por_vencer)}</td><td>${formatoSiigoNumero(item.vencido_1_30)}</td><td>${formatoSiigoNumero(item.vencido_31_60)}</td><td>${formatoSiigoNumero(item.vencido_61_90)}</td><td>${formatoSiigoNumero(item.vencido_91_mas)}</td><td>${formatoSiigoNumero(item.saldo)}</td></tr>`).join('')}</tbody></table></div>` : 'No se encontraron facturas para la fecha seleccionada.';
            result.innerHTML = `<p class="form-help">Fecha de corte: ${escapeSiigo(data.fecha_corte)}. Facturas analizadas: ${data.facturas}. Recibos sin factura cargada: ${data.pagos_sin_factura}. Movimientos AC sin factura asociada en esta consulta: ${data.ajustes_ac_sin_factura || 0} (${formatoSiigoNumero(data.valor_ac_sin_factura)}). Notas credito sin asignar: ${formatoSiigoNumero(data.notas_credito_sin_asignar)}.</p>${tablaPeriodos}${tablaCarteraClientesSiigo(data.cartera_clientes || [])}${movimientosSinAsignarSiigo(data.movimientos_sin_asignar || [])}`;
            const clientes = data.cartera_clientes || [];
            result.querySelectorAll('[data-siigo-cliente-index]').forEach(button => button.addEventListener('click', () => {
                const index = Number(button.dataset.siigoClienteIndex);
                const cliente = clientes[index];
                if (cliente) mostrarDetalleCarteraClienteSiigo(result, cliente, button);
            }));
        }
    } catch (error) {
        result.textContent = error.message;
    }
}

function descargarCarteraDinamicaSiigo(form, tipo, boton) {
    const result = form.closest('.recent-section')?.querySelector('.table-container');
    const fechaCorte = form.querySelector('input[type="date"]').value;
    const params = new URLSearchParams({ ...valoresFiltrosMaestroSiigo(form), fecha_corte: fechaCorte, formato: 'xlsx' });
    const nombre = tipo === 'pagos' ? 'analisis_pagos.xlsx' : 'cartera_y_recaudo.xlsx';
    descargarExcelSiigo(`/api/contable/cartera-dinamica?${params.toString()}`, nombre, result, boton);
}

async function cargarConfiguracionVentasSiigo() {
    const container = document.getElementById('siigoConfiguracionVentas');
    if (!container) return;
    try {
        const response = await fetch('/api/contable/configuracion-ventas', { credentials: 'include' });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible cargar la configuracion.');
        const rows = data.cuentas || [];
        const options = ['INGRESO', 'NOTA_CREDITO', 'IVA_GENERADO'];
        container.innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Codigo</th><th>Cuenta</th><th>Clasificacion</th><th>Activa</th><th></th></tr></thead><tbody>${rows.map(item => `<tr data-codigo="${escapeSiigo(item.codigo)}"><td>${escapeSiigo(item.codigo)}</td><td>${escapeSiigo(item.nombre)}</td><td><select>${options.map(option => `<option value="${option}" ${item.clasificacion === option ? 'selected' : ''}>${option}</option>`).join('')}</select></td><td><input type="checkbox" ${item.activo ? 'checked' : ''}></td><td><button type="button" class="action-btn">Guardar</button></td></tr>`).join('')}</tbody></table>` : 'No hay cuentas configuradas.';
        container.querySelectorAll('tr[data-codigo]').forEach(row => row.querySelector('button').addEventListener('click', () => guardarConfiguracionVentasSiigo(row)));
    } catch (error) {
        container.textContent = error.message;
    }
}

async function guardarConfiguracionVentasSiigo(row) {
    const codigo = row.dataset.codigo;
    const clasificacion = row.querySelector('select').value;
    const activo = row.querySelector('input[type="checkbox"]').checked;
    try {
        const response = await fetch('/api/contable/configuracion-ventas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ codigo_contable: codigo, clasificacion, activo }),
        });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible guardar la cuenta.');
        await cargarConfiguracionVentasSiigo();
    } catch (error) {
        alert(error.message);
    }
}

async function consultarVentasMensualesSiigo(event) {
    event.preventDefault();
    const params = new URLSearchParams({
        ...valoresFiltrosMaestroSiigo(event.currentTarget || event.target),
        anio: document.getElementById('siigoVentasAnio').value,
        incluir_nc: document.getElementById('siigoVentasIncluirNC').checked,
        incluir_iva: document.getElementById('siigoVentasIncluirIVA').checked,
    });
    const result = document.getElementById('siigoVentasMensualesResultado');
    result.textContent = 'Calculando ventas...';
    try {
        const response = await fetch(`/api/contable/ventas-mensuales?${params.toString()}`, { credentials: 'include' });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible calcular las ventas.');
        const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        result.innerHTML = `<p class="form-help">Cuentas utilizadas: ${data.cuentas.map(escapeSiigo).join(', ')}</p><table class="data-table"><thead><tr><th>Mes</th><th>Ventas PREVENT</th></tr></thead><tbody>${data.meses.map(item => `<tr><td>${meses[item.mes - 1]}</td><td>${formatoSiigoNumero(item.valor)}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th>${formatoSiigoNumero(data.total)}</th></tr></tfoot></table>`;
    } catch (error) {
        result.textContent = error.message;
    }
}

async function descargarVentasMensualesSiigo(event) {
    const boton = event.currentTarget;
    const form = boton.closest('form');
    const params = new URLSearchParams({
        ...valoresFiltrosMaestroSiigo(form),
        anio: document.getElementById('siigoVentasAnio').value,
        incluir_nc: document.getElementById('siigoVentasIncluirNC').checked,
        incluir_iva: document.getElementById('siigoVentasIncluirIVA').checked,
        formato: 'xlsx',
    });
    const result = document.getElementById('siigoVentasMensualesResultado');
    boton.disabled = true;
    if (result) result.textContent = 'Preparando Excel...';
    try {
        const response = await fetch(`/api/contable/ventas-mensuales?${params.toString()}`, { credentials: 'include' });
        if (!response.ok || !response.headers.get('content-type')?.includes('spreadsheetml')) {
            const data = await leerRespuestaSiigo(response);
            throw new Error(data.error || 'No fue posible descargar el Excel.');
        }
        const url = URL.createObjectURL(await response.blob());
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = `analisis_ventas_${params.get('anio')}.xlsx`;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (result) result.textContent = '';
    } catch (error) {
        if (result) result.textContent = error.message;
    } finally {
        boton.disabled = false;
    }
}

function configurarNavegacionVentasSiigo() {
    const cargas = document.getElementById('siigoCargaResultado').closest('.recent-section');
    const historial = document.getElementById('siigoCargasRecientes').closest('.recent-section');
    const consulta = document.getElementById('siigoConsultaResultado').closest('.recent-section');
    const comparativo = crearPanelComparativoSiigo();
    const analisis = crearPanelVentasMensualesSiigo();
    const pagos = crearPanelCarteraDinamicaSiigo('pagos');
    const cartera = crearPanelCarteraDinamicaSiigo('recaudo');
    const vencidas = crearPanelFacturasVencidasSiigo();
    if (!cargas || !historial || !consulta || document.getElementById('siigoVentasNavegacion')) return;

    cargas.id = 'siigoCarguePanel';
    historial.id = 'siigoHistorialCargasPanel';
    consulta.id = 'siigoConsultaClientePanel';
    const consultaTitulo = consulta.querySelector('h3');
    if (consultaTitulo) consultaTitulo.textContent = 'Consulta por cliente y comprobante';

    const navigation = document.createElement('div');
    navigation.id = 'siigoVentasNavegacion';
    navigation.className = 'module-header';
    navigation.style.marginBottom = '16px';
    navigation.innerHTML = `<div class="button-group module-actions"><button type="button" class="btn" data-siigo-section="cargue">Cargue de informacion</button><button type="button" class="btn" data-siigo-section="informes">Informes</button></div>`;
    cargas.insertAdjacentElement('beforebegin', navigation);

    const reportNavigation = document.createElement('div');
    reportNavigation.id = 'siigoInformesNavegacion';
    reportNavigation.className = 'button-group module-actions';
    reportNavigation.style.cssText = 'margin-bottom:16px; display:none;';
    reportNavigation.innerHTML = `<button type="button" class="btn btn-secondary" data-siigo-report="comparativo">Comparativo</button><button type="button" class="btn btn-secondary" data-siigo-report="consulta">Consulta por cliente</button><button type="button" class="btn btn-secondary" data-siigo-report="analisis">Analisis de ventas</button><button type="button" class="btn btn-secondary" data-siigo-report="pagos">Analisis de pagos</button><button type="button" class="btn btn-secondary" data-siigo-report="cartera">Cartera y recaudo</button>`;
    consulta.insertAdjacentElement('beforebegin', reportNavigation);
    reportNavigation.insertAdjacentHTML('beforeend', '<button type="button" class="btn btn-secondary" data-siigo-report="vencidas">Facturas vencidas</button>');

    navigation.querySelectorAll('button').forEach(button => button.addEventListener('click', () => mostrarSeccionVentasSiigo(button.dataset.siigoSection)));
    reportNavigation.querySelectorAll('button').forEach(button => button.addEventListener('click', () => mostrarInformeSiigo(button.dataset.siigoReport)));
    window._siigoPanels = { cargas, historial, consulta, comparativo, analisis, pagos, cartera, vencidas, navigation, reportNavigation };
    mostrarSeccionVentasSiigo(window._siigoSeccionActual || 'cargue');
}

function mostrarSeccionVentasSiigo(section) {
    const panels = window._siigoPanels;
    if (!panels) return;
    mostrarFiltrosVencidasSiigo();
    actualizarModoCarteraSiigo(false);
    window._siigoSeccionActual = section;
    const esCargue = section === 'cargue';
    panels.cargas.style.display = esCargue ? '' : 'none';
    panels.historial.style.display = esCargue ? '' : 'none';
    panels.reportNavigation.style.display = esCargue ? 'none' : 'flex';
    panels.consulta.style.display = 'none';
    panels.comparativo.style.display = 'none';
    panels.analisis.style.display = 'none';
    panels.pagos.style.display = 'none';
    panels.cartera.style.display = 'none';
    panels.vencidas.style.display = 'none';
    panels.navigation.querySelectorAll('button').forEach(button => {
        button.className = button.dataset.siigoSection === section ? 'btn btn-primary' : 'btn btn-secondary';
    });
    if (!esCargue) mostrarInformeSiigo(window._siigoInformeActual || 'comparativo');
}

function mostrarInformeSiigo(informe) {
    const panels = window._siigoPanels;
    if (!panels) return;
    if (panels.vencidas) {
        panels.vencidas.dataset.origen = 'ventas-informes';
        const volver = panels.vencidas.querySelector('[data-vencidas-informes]');
        if (volver) volver.textContent = 'Regresar a informes';
    }
    mostrarFiltrosVencidasSiigo();
    actualizarModoCarteraSiigo(['cartera', 'vencidas'].includes(informe));
    document.body.classList.toggle('body-siigo-vencidas-activo', informe === 'vencidas');
    window._siigoSeccionActual = 'informes';
    window._siigoInformeActual = informe;
    panels.cargas.style.display = 'none';
    panels.historial.style.display = 'none';
    panels.reportNavigation.style.display = 'flex';
    panels.consulta.style.display = informe === 'consulta' ? '' : 'none';
    panels.comparativo.style.display = informe === 'comparativo' ? '' : 'none';
    panels.analisis.style.display = informe === 'analisis' ? '' : 'none';
    panels.pagos.style.display = informe === 'pagos' ? '' : 'none';
    panels.cartera.style.display = informe === 'cartera' ? '' : 'none';
    panels.vencidas.style.display = informe === 'vencidas' ? '' : 'none';
    panels.navigation.querySelectorAll('button').forEach(button => {
        button.className = button.dataset.siigoSection === 'informes' ? 'btn btn-primary' : 'btn btn-secondary';
    });
    panels.reportNavigation.querySelectorAll('button').forEach(button => {
        button.className = button.dataset.siigoReport === informe ? 'btn btn-primary' : 'btn btn-secondary';
    });
}

async function consultarClientesSiigo() {
    const query = document.getElementById('siigoClienteFiltro').value.trim();
    const container = document.getElementById('siigoConsultaResultado');
    container.innerHTML = 'Consultando...';
    try {
        const response = await fetch(`/api/contable/clientes?q=${encodeURIComponent(query)}`, { credentials: 'include' });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible consultar clientes.');
        const rows = data.clientes || [];
        container.innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Identificacion</th><th>Sucursal</th><th>Nombre</th><th>Ciudad</th><th>Estado</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeSiigo(row.identificacion)}</td><td>${escapeSiigo(row.sucursal)}</td><td>${escapeSiigo(row.nombre)}</td><td>${escapeSiigo(row.ciudad)}</td><td>${escapeSiigo(row.estado)}</td></tr>`).join('')}</tbody></table>` : 'No se encontraron clientes.';
    } catch (error) {
        container.textContent = error.message;
    }
}

function inicializarVentasSiigo() {
    const form = document.getElementById('siigoConsultaForm');
    if (form && !form.dataset.bound) {
        form.addEventListener('submit', consultarComprobantesSiigo);
        const acciones = form.querySelector('.form-row:last-of-type .form-group:last-child');
        if (acciones && !acciones.querySelector('[data-siigo-exportar-consulta]')) {
            const botonExcel = document.createElement('button');
            botonExcel.type = 'button';
            botonExcel.className = 'btn btn-secondary';
            botonExcel.dataset.siigoExportarConsulta = '1';
            botonExcel.textContent = 'Descargar Excel';
            botonExcel.addEventListener('click', descargarComprobantesSiigo);
            acciones.append(' ', botonExcel);
        }
        form.dataset.bound = 'true';
    }
    configurarAutocompletadoTercerosSiigo();
    crearPanelComparativoSiigo();
    crearPanelVentasMensualesSiigo();
    configurarNavegacionVentasSiigo();
    cargarConfiguracionVentasSiigo();
    cargarResumenSiigo().catch(error => {
        const result = document.getElementById('siigoCargaResultado');
        if (result) result.textContent = error.message;
    });
}


function valoresFiltrosMaestroSiigo(form) {
    const filtros = {};
    for (const name of ['vendedor_id', 'contacto_id']) {
        const value = form?.elements?.namedItem(name)?.value;
        if (value) filtros[name] = value;
    }
    return filtros;
}

async function agregarFiltrosMaestroSiigo(form) {
    if (!form || form.dataset.maestroFiltros) return;
    form.dataset.maestroFiltros = '1';
    const box = document.createElement('div');
    box.className = 'form-row';
    const labelV = document.createElement('label'); labelV.textContent = 'Vendedor ';
    const labelC = document.createElement('label'); labelC.textContent = 'Contacto ';
    const vendedor = document.createElement('select'); vendedor.name = 'vendedor_id';
    const contacto = document.createElement('select'); contacto.name = 'contacto_id';
    vendedor.add(new Option('Todos los disponibles', '')); contacto.add(new Option('Todos los disponibles', ''));
    labelV.append(vendedor); labelC.append(contacto); box.append(labelV, labelC); form.append(box);
    try {
        const data = await cargarFiltrosClientesSiigo();
        if (data.es_administrador) {
            vendedor.add(new Option('Sin asignar', 'sin_asignar'));
        } else {
            labelV.hidden = true;
        }
        data.vendedores.forEach(v=>vendedor.add(new Option(v.nombre, v.id)));
        const cargarContactos = () => {
            contacto.replaceChildren(new Option('Todos los disponibles',''));
            data.contactos.filter(p=>!vendedor.value || String(p.vendedor_id)===vendedor.value || (vendedor.value==='sin_asignar' && !p.vendedor_id)).forEach(p=>contacto.add(new Option(p.nombre,p.id)));
        };
        vendedor.addEventListener('change', cargarContactos); cargarContactos();
        // Expuesto para que la pantalla de Gestión de Cartera pueda re-filtrar Contacto sin depender del evento 'change'.
        form._aplicarVendedorCarteraSiigo = valor => {
            vendedor.value = valor || '';
            labelV.hidden = true;
            cargarContactos();
        };
        const panelCartera = form.closest('#siigoFacturasVencidasPanel');
        if (panelCartera?.dataset.origen === 'comercial-cartera') {
            form._aplicarVendedorCarteraSiigo(panelCartera._filtroVendedorCartera);
        }
    } catch(error) {
        const aviso=document.createElement('span'); aviso.textContent=error.message; box.append(aviso);
    }
}
