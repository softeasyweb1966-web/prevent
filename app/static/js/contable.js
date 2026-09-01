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
        panel.innerHTML = `<strong>Alerta: comprobantes sin actualizar</strong><span>Aun no hay comprobantes cargados. Debe existir informacion al menos hasta el ${escapeSiigo(fechaRequerida)}. En SIIGO genere el Excel desde: <strong>Informes &gt; Contables &gt; Consecutivo de comprobantes</strong>, y luego carguelo aqui.</span>`;
        return;
    }
    const detalleAtraso = `Hay ${atraso} dia${atraso === 1 ? '' : 's'} de atraso frente al minimo requerido.`;
    panel.innerHTML = `<strong>Alerta: comprobantes sin actualizar</strong><span>Informacion cargada hasta el ${escapeSiigo(ultimaFecha)}. Debe estar cargada al menos hasta el ${escapeSiigo(fechaRequerida)}. ${escapeSiigo(detalleAtraso)} En SIIGO genere el Excel desde: <strong>Informes &gt; Contables &gt; Consecutivo de comprobantes</strong>, y luego carguelo aqui.</span>`;
}

function tablaCarteraClientesSiigo(clientes) {
    if (!clientes.length) return '';
    const filas = clientes.map((cliente, index) => {
        const detalleId = `siigoCarteraClienteDetalle${index}`;
        const facturas = cliente.facturas || [];
        const detalle = facturas.map(factura => `<tr><td>${escapeSiigo(factura.referencia)}</td><td>${escapeSiigo(formatoSiigoFecha(factura.fecha_factura))}</td><td>${escapeSiigo(formatoSiigoFecha(factura.fecha_vencimiento))}</td><td>${formatoSiigoNumero(factura.facturado)}</td><td>${formatoSiigoNumero(factura.recaudado)}</td><td>${formatoSiigoNumero(factura.saldo)}</td><td>${factura.dias_vencido}</td></tr>`).join('');
        return `<tr><td>${escapeSiigo(cliente.identificacion)}</td><td>${escapeSiigo(cliente.cliente)}</td><td>${formatoSiigoNumero(cliente.facturado)}</td><td>${formatoSiigoNumero(cliente.recaudado)}</td><td>${formatoSiigoNumero(cliente.por_vencer)}</td><td>${formatoSiigoNumero(cliente.vencido_1_30)}</td><td>${formatoSiigoNumero(cliente.vencido_31_60)}</td><td>${formatoSiigoNumero(cliente.vencido_61_90)}</td><td>${formatoSiigoNumero(cliente.vencido_91_mas)}</td><td>${formatoSiigoNumero(cliente.saldo)}</td><td><button type="button" class="action-btn" data-siigo-detalle="${detalleId}">Ver detalle</button></td></tr><tr id="${detalleId}" class="siigo-detalle-cliente" hidden><td colspan="11"><div class="siigo-tabla-con-encabezado-fijo siigo-tabla-detalle"><table class="data-table"><thead><tr><th>Factura</th><th>Fecha</th><th>Vencimiento</th><th>Facturado</th><th>Recaudado</th><th>Saldo</th><th>Dias vencido</th></tr></thead><tbody>${detalle}</tbody></table></div></td></tr>`;
    }).join('');
    return `<h4 style="margin:20px 0 8px;">Detalle de cartera por cliente</h4><p class="form-help">Seleccione “Ver detalle” para consultar las facturas que componen cada saldo.</p><div class="siigo-tabla-con-encabezado-fijo"><table class="data-table"><thead><tr><th>Identificacion</th><th>Cliente</th><th>Facturado</th><th>Recaudado</th><th>Por vencer</th><th>1 a 30</th><th>31 a 60</th><th>61 a 90</th><th>Mas de 90</th><th>Saldo</th><th>Detalle</th></tr></thead><tbody>${filas}</tbody></table></div>`;
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
    document.getElementById('siigoCuentasCount').textContent = data.cuentas || 0;
    document.getElementById('siigoComprobantesCount').textContent = data.comprobantes || 0;
    document.getElementById('siigoMovimientosCount').textContent = data.movimientos || 0;
    mostrarVigenciaComprobantes(data.vigencia_comprobantes);
    const cargas = data.cargas || [];
    document.getElementById('siigoCargasRecientes').innerHTML = cargas.length ? cargas.map(carga => `<div><strong>${escapeSiigo(carga.tipo)}</strong> - ${escapeSiigo(carga.archivo)} (${escapeSiigo(carga.fecha)}): ${carga.importados} importados, ${carga.omitidos} omitidos.</div>`).join('') : 'Aun no hay cargues registrados.';
}

function seleccionarArchivoSiigo(tipo) {
    const input = document.getElementById('siigoArchivoInput');
    input.value = '';
    input.onchange = () => importarArchivoSiigo(tipo, input.files[0]);
    input.click();
}

async function importarArchivoSiigo(tipo, archivo) {
    if (!archivo) return;
    const result = document.getElementById('siigoCargaResultado');
    result.textContent = `Cargando ${archivo.name}...`;
    const formData = new FormData();
    formData.append('archivo', archivo);
    try {
        const response = await fetch(`/api/contable/cargar-${tipo}`, { method: 'POST', body: formData, credentials: 'include' });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible procesar el archivo.');
        result.textContent = `${data.mensaje} ${data.creados != null ? `Creados: ${data.creados}. Actualizados: ${data.actualizados}.` : `Comprobantes: ${data.comprobantes}. Movimientos: ${data.movimientos}. Omitidos: ${data.omitidos}.`}`;
        await cargarResumenSiigo();
    } catch (error) {
        result.textContent = error.message;
    }
}

async function consultarComprobantesSiigo(event) {
    if (event) event.preventDefault();
    const params = new URLSearchParams();
    [['cliente', 'siigoClienteFiltro'], ['tipo', 'siigoTipoFiltro'], ['numero', 'siigoNumeroFiltro'], ['desde', 'siigoDesdeFiltro'], ['hasta', 'siigoHastaFiltro']].forEach(([key, id]) => {
        const input = document.getElementById(id);
        const value = key === 'cliente' && input.dataset.identificacion ? input.dataset.identificacion : input.value.trim();
        if (value) params.set(key, value);
    });
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
    panel.innerHTML = `<h3 style="margin-top:0;">Clientes nuevos y clientes que no volvieron</h3><p class="form-help">Se comparan las facturas FV de dos periodos. La cartera cruza facturas y recibos de caja hasta la fecha de corte indicada.</p><form id="siigoComparativoForm"><div class="form-row"><div class="form-group"><label>Periodo 1: desde</label><input id="siigoPeriodoADesde" type="date" required></div><div class="form-group"><label>Periodo 1: hasta</label><input id="siigoPeriodoAHasta" type="date" required></div><div class="form-group"><label>Periodo 2: desde</label><input id="siigoPeriodoBDesde" type="date" required></div><div class="form-group"><label>Periodo 2: hasta</label><input id="siigoPeriodoBHasta" type="date" required></div><div class="form-group"><label>Cartera a fecha de corte</label><input id="siigoComparativoFechaCorte" type="date"></div><div class="form-group" style="align-self:end;"><button class="btn btn-primary" type="submit">Generar comparativo</button></div></div></form><div id="siigoComparativoResultado" class="table-container" style="margin-top:16px;"></div>`;
    consulta.insertAdjacentElement('afterend', panel);
    panel.querySelector('form').addEventListener('submit', consultarComparativoClientesSiigo);
    return panel;
}

function mostrarComparativoClientes() {
    mostrarInformeSiigo('comparativo');
    const panel = crearPanelComparativoSiigo();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function consultarComparativoClientesSiigo(event) {
    event.preventDefault();
    const params = new URLSearchParams({
        periodo_a_desde: document.getElementById('siigoPeriodoADesde').value,
        periodo_a_hasta: document.getElementById('siigoPeriodoAHasta').value,
        periodo_b_desde: document.getElementById('siigoPeriodoBDesde').value,
        periodo_b_hasta: document.getElementById('siigoPeriodoBHasta').value,
    });
    const fechaCorte = document.getElementById('siigoComparativoFechaCorte').value;
    if (fechaCorte) params.set('fecha_corte_cartera', fechaCorte);
    const result = document.getElementById('siigoComparativoResultado');
    result.textContent = 'Generando comparativo...';
    try {
        const response = await fetch(`/api/contable/comparativo-clientes?${params.toString()}`, { credentials: 'include' });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible generar el comparativo.');
        const table = (items, empty) => items.length ? `<table class="data-table"><thead><tr><th>Identificacion</th><th>Cliente</th><th>Facturas</th></tr></thead><tbody>${items.map(item => `<tr><td>${escapeSiigo(item.identificacion)}</td><td>${escapeSiigo(item.nombre)}</td><td>${item.facturas}</td></tr>`).join('')}</tbody></table>` : `<p class="form-help">${empty}</p>`;
        const resumenGrupo = (titulo, total) => `<div class="recent-section" style="flex:1; min-width:280px;"><h4 style="margin-top:0;">${titulo}</h4><p class="form-help">Cartera conciliada por factura al ${escapeSiigo(data.fecha_cartera)}.</p><div class="stats-grid"><div class="stat-card"><h3>Facturacion</h3><p class="stat-number" style="font-size:1.35rem;">${formatoSiigoNumero(total.facturacion)}</p></div><div class="stat-card"><h3>Cartera pendiente</h3><p class="stat-number" style="font-size:1.35rem;">${formatoSiigoNumero(total.cartera)}</p></div><div class="stat-card"><h3>Pagos por conciliar</h3><p class="stat-number" style="font-size:1.35rem;">${formatoSiigoNumero(total.pagos_pendientes_conciliar)}</p></div></div></div>`;
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
    panel.innerHTML = `<h3 style="margin-top:0;">Control mensual de ventas</h3><p class="form-help">Calculado desde PREVENT con las mismas reglas de FV, NC e IVA que se compararan contra SIIGO.</p><form id="siigoVentasMensualesForm"><div class="form-row"><div class="form-group"><label for="siigoVentasAnio">Ano</label><input id="siigoVentasAnio" type="number" min="2000" max="2100" value="${new Date().getFullYear()}" required></div><div class="form-group" style="align-self:end;"><label><input id="siigoVentasIncluirNC" type="checkbox" checked> Incluir notas credito</label></div><div class="form-group" style="align-self:end;"><label><input id="siigoVentasIncluirIVA" type="checkbox"> Incluir impuesto</label></div><div class="form-group" style="align-self:end;"><button class="btn btn-primary" type="submit">Calcular ventas</button></div></div></form><div id="siigoVentasMensualesResultado" class="table-container" style="margin-top:16px;"></div><h4 style="margin:20px 0 8px;">Cuentas incluidas en el calculo</h4><div id="siigoConfiguracionVentas" class="table-container"></div>`;
    anchor.insertAdjacentElement('afterend', panel);
    panel.querySelector('form').addEventListener('submit', consultarVentasMensualesSiigo);
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
        ? `<h3 style="margin-top:0;">Analisis de pago de clientes</h3><p class="form-help">Cruza cada recibo de caja RC con la factura FV indicada en la descripcion. El promedio considera facturas totalmente pagadas.</p><form data-siigo-cartera="pagos"><div class="form-row"><div class="form-group"><label>Fecha de corte</label><input type="date" required value="${new Date().toISOString().slice(0, 10)}"></div><div class="form-group" style="align-self:end;"><button class="btn btn-primary" type="submit">Generar analisis</button></div></div></form><div class="table-container" style="margin-top:16px;"></div>`
        : `<h3 style="margin-top:0;">Cartera y recaudo por periodo</h3><p class="form-help">Calculado desde las facturas FV y sus recibos de caja RC. La fecha de vencimiento corresponde a la cuota indicada por SIIGO.</p><form data-siigo-cartera="recaudo"><div class="form-row"><div class="form-group"><label>Fecha de corte</label><input type="date" required value="${new Date().toISOString().slice(0, 10)}"></div><div class="form-group" style="align-self:end;"><button class="btn btn-primary" type="submit">Generar cartera</button></div></div></form><div class="table-container" style="margin-top:16px;"></div>`;
    const form = panel.querySelector('form');
    anchor.insertAdjacentElement('afterend', panel);
    const boton = form.querySelector('button[type="submit"]');
    boton.type = 'button';
    boton.addEventListener('click', () => consultarCarteraDinamicaSiigo(form, tipo));
    form.addEventListener('submit', event => {
        event.preventDefault();
        consultarCarteraDinamicaSiigo(form, tipo);
    });
    return panel;
}

async function consultarCarteraDinamicaSiigo(form, tipo) {
    const panel = form.closest('.recent-section');
    const result = panel.querySelector('.table-container');
    const fechaCorte = form.querySelector('input[type="date"]').value;
    const params = new URLSearchParams({ fecha_corte: fechaCorte });
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
            const tablaPeriodos = rows.length ? `<div class="siigo-tabla-con-encabezado-fijo"><table class="data-table"><thead><tr><th>Periodo</th><th>Facturado</th><th>Recaudado</th><th>Por vencer</th><th>1 a 30</th><th>31 a 60</th><th>61 a 90</th><th>Mas de 90</th><th>Saldo</th></tr></thead><tbody>${rows.map(item => `<tr><td>${item.periodo}</td><td>${formatoSiigoNumero(item.facturado)}</td><td>${formatoSiigoNumero(item.recaudado)}</td><td>${formatoSiigoNumero(item.por_vencer)}</td><td>${formatoSiigoNumero(item.vencido_1_30)}</td><td>${formatoSiigoNumero(item.vencido_31_60)}</td><td>${formatoSiigoNumero(item.vencido_61_90)}</td><td>${formatoSiigoNumero(item.vencido_91_mas)}</td><td>${formatoSiigoNumero(item.saldo)}</td></tr>`).join('')}</tbody></table></div>` : 'No se encontraron facturas para la fecha seleccionada.';
            result.innerHTML = `<p class="form-help">Fecha de corte: ${escapeSiigo(data.fecha_corte)}. Facturas analizadas: ${data.facturas}. Recibos sin factura cargada: ${data.pagos_sin_factura}. Notas credito sin asignar: ${formatoSiigoNumero(data.notas_credito_sin_asignar)}.</p>${tablaPeriodos}${tablaCarteraClientesSiigo(data.cartera_clientes || [])}`;
            result.querySelectorAll('[data-siigo-detalle]').forEach(button => button.addEventListener('click', () => {
                const detalle = document.getElementById(button.dataset.siigoDetalle);
                if (!detalle) return;
                const visible = !detalle.hidden;
                detalle.hidden = visible;
                button.textContent = visible ? 'Ver detalle' : 'Ocultar detalle';
            }));
        }
    } catch (error) {
        result.textContent = error.message;
    }
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

function configurarNavegacionVentasSiigo() {
    const cargas = document.getElementById('siigoCargaResultado').closest('.recent-section');
    const historial = document.getElementById('siigoCargasRecientes').closest('.recent-section');
    const consulta = document.getElementById('siigoConsultaResultado').closest('.recent-section');
    const comparativo = crearPanelComparativoSiigo();
    const analisis = crearPanelVentasMensualesSiigo();
    const pagos = crearPanelCarteraDinamicaSiigo('pagos');
    const cartera = crearPanelCarteraDinamicaSiigo('recaudo');
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

    navigation.querySelectorAll('button').forEach(button => button.addEventListener('click', () => mostrarSeccionVentasSiigo(button.dataset.siigoSection)));
    reportNavigation.querySelectorAll('button').forEach(button => button.addEventListener('click', () => mostrarInformeSiigo(button.dataset.siigoReport)));
    window._siigoPanels = { cargas, historial, consulta, comparativo, analisis, pagos, cartera, navigation, reportNavigation };
    mostrarSeccionVentasSiigo(window._siigoSeccionActual || 'cargue');
}

function mostrarSeccionVentasSiigo(section) {
    const panels = window._siigoPanels;
    if (!panels) return;
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
    panels.navigation.querySelectorAll('button').forEach(button => {
        button.className = button.dataset.siigoSection === section ? 'btn btn-primary' : 'btn btn-secondary';
    });
    if (!esCargue) mostrarInformeSiigo(window._siigoInformeActual || 'comparativo');
}

function mostrarInformeSiigo(informe) {
    const panels = window._siigoPanels;
    if (!panels) return;
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
