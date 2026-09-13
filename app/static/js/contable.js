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

function actualizarModoCarteraSiigo(ocultarMenu) {
    document.body.classList.toggle('body-siigo-cartera-focus', ocultarMenu);
    document.querySelectorAll('#siigoAlternarMenuCartera, #siigoAlternarMenuVencidas').forEach(boton => {
        boton.textContent = ocultarMenu ? 'Mostrar menú lateral' : 'Ocultar menú lateral';
        boton.setAttribute('aria-expanded', String(!ocultarMenu));
    });
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
        if (!response.ok) throw new Error(data.error || 'No fue posible procesar el archivo.');
        result.textContent = `${data.mensaje} ${data.creados != null ? `Creados: ${data.creados}. Actualizados: ${data.actualizados}.` : `Comprobantes: ${data.comprobantes}. Movimientos: ${data.movimientos}. Omitidos: ${data.omitidos}.`}`;
        await cargarResumenSiigo();
        if (alCompletar) await alCompletar();
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
    agregarFiltrosMaestroSiigo(panel.querySelector('form'));
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
        ...valoresFiltrosMaestroSiigo(event.currentTarget || event.target),
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
    panel.innerHTML = `<h3 style="margin-top:0;">Control mensual de ventas</h3><p class="form-help">Calculado desde PREVENT con las mismas reglas de FV, NC e IVA que se compararan contra SIIGO.</p><form id="siigoVentasMensualesForm"><div class="form-row"><div class="form-group"><label for="siigoVentasAnio">Ano</label><input id="siigoVentasAnio" type="number" min="2000" max="2100" value="${new Date().getFullYear()}" required></div><div class="form-group" style="align-self:end;"><label><input id="siigoVentasIncluirNC" type="checkbox" checked> Incluir notas credito</label></div><div class="form-group" style="align-self:end;"><label><input id="siigoVentasIncluirIVA" type="checkbox"> Incluir impuesto</label></div><div class="form-group" style="align-self:end;"><button class="btn btn-primary" type="submit">Calcular ventas</button></div></div></form><div id="siigoVentasMensualesResultado" class="table-container" style="margin-top:16px;"></div><h4 style="margin:20px 0 8px;">Cuentas incluidas en el calculo</h4><div id="siigoConfiguracionVentas" class="table-container"></div>`;
    anchor.insertAdjacentElement('afterend', panel);
    panel.querySelector('form').addEventListener('submit', consultarVentasMensualesSiigo);
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
    const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(new Date());
    panel.innerHTML = `<div data-vencidas-filtros><h3>Facturas vencidas y por vencer por cliente</h3><form class="siigo-vencidas-filtros"><div class="form-group"><label for="siigoVencidasCorte">Fecha de corte</label><input id="siigoVencidasCorte" type="date" required value="${hoy}"></div><div class="form-group"><label for="siigoVencidasCliente">Cliente o identificación (opcional)</label><input id="siigoVencidasCliente" name="cliente" type="text"></div><div class="form-group"><label for="siigoEstadoFacturas">Facturas</label><select id="siigoEstadoFacturas" name="estado_facturas"><option value="todos">Todos</option><option value="vencidos">Solo vencidos</option><option value="por_vencer">Por vencer</option></select><small>Por vencer incluye las que vencen hoy. Cantidad y total corresponden al filtro.</small></div><button class="btn btn-primary" type="submit">Generar informe</button></form><p data-vencidas-estado role="status"></p></div><div class="siigo-vencidas-visor" hidden><header class="siigo-vencidas-cabecera"><div><h2 tabindex="-1">Facturas vencidas y por vencer por cliente</h2><p data-vencidas-meta></p><p data-alertas-cartera role="status" aria-live="polite"></p></div><button type="button" class="btn btn-secondary" data-vencidas-regresar>Regresar</button></header><div class="table-container siigo-vencidas-datos"></div><footer class="siigo-vencidas-pie"><div class="siigo-vencidas-barra" tabindex="0" role="region" aria-label="Desplazamiento horizontal de las facturas"><div></div></div><div class="siigo-vencidas-acciones"><button class="btn btn-primary" type="button" data-vencidas-generar>Generar informe</button><button class="btn btn-secondary" type="button" data-siigo-exportar-vencidas>Descargar Excel</button><button class="btn btn-secondary" type="button" id="siigoAlternarMenuVencidas">Mostrar menú lateral</button><button class="btn btn-secondary" type="button" data-vencidas-actualizar>Actualizar comprobantes</button></div><p id="siigoVencidasCargaResultado" role="status" aria-live="polite"></p></footer></div>`;
    crearPanelCarteraDinamicaSiigo('recaudo').insertAdjacentElement('afterend', panel);
    const tituloFiltros = panel.querySelector('[data-vencidas-filtros] h3');
    const cabeceraFiltros = document.createElement('div');
    cabeceraFiltros.className = 'siigo-vencidas-cabecera';
    tituloFiltros.replaceWith(cabeceraFiltros);
    cabeceraFiltros.appendChild(tituloFiltros);
    cabeceraFiltros.insertAdjacentHTML('beforeend', '<button type="button" class="btn btn-secondary" data-vencidas-informes>Regresar a informes</button>');
    cabeceraFiltros.querySelector('button').addEventListener('click', () => mostrarInformeSiigo('comparativo'));
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

function mostrarFiltrosVencidasSiigo(enfocar = false) {
    const panel = document.getElementById('siigoFacturasVencidasPanel');
    document.body.classList.remove('body-siigo-vencidas-informe', 'body-siigo-vencidas-activo');
    if (!panel) return;
    panel._consultaVencidas?.abort();
    panel._scrollVencidas?.disconnect();
    panel.querySelector('.siigo-vencidas-visor').hidden = true;
    panel.querySelector('[data-vencidas-filtros]').hidden = false;
    if (enfocar) {
        document.body.classList.add('body-siigo-vencidas-activo');
        actualizarModoCarteraSiigo(true);
        panel.querySelector('#siigoVencidasCorte').focus();
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
    const filtros = { ...valoresFiltrosMaestroSiigo(form), fecha_corte: form.querySelector('input[type="date"]').value, cliente: form.elements.cliente.value.trim(), estado_facturas: form.elements.estado_facturas.value };
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
        panel.querySelector('[data-vencidas-meta]').textContent = `Fecha de corte: ${formatoSiigoFecha(data.fecha_corte)} | ${estadoFacturas}${nombre ? ` · Cliente: ${nombre}` : ''}`;
        const resultado = panel.querySelector('.siigo-vencidas-datos');
        panel._datosVencidas = data;
        resultado.innerHTML = tablaFacturasVencidasSiigo(data);
        actualizarAlertasCarteraSiigo(panel);
        resultado.querySelectorAll('[data-siigo-seguimiento]').forEach(boton => {
            boton.addEventListener('click', () => abrirSeguimientoCarteraSiigo(data.clientes[Number(boton.dataset.siigoSeguimiento)]));
        });
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

function historialSeguimientoCarteraSiigo(registros) {
    if (!registros.length) return '<p>Este cliente aún no tiene seguimientos registrados.</p>';
    return registros.map(item => `<article class="siigo-seguimiento-registro"><h4>${escapeSiigo(formatoSiigoFecha(item.fecha_gestion))} · ${escapeSiigo(item.medio)}</h4><p>Registrado por: <strong>${escapeSiigo(item.registrado_por)}</strong>${item.contacto ? ` · Contacto: ${escapeSiigo(item.contacto)}` : ''}</p><p class="siigo-seguimiento-nota">${escapeSiigo(item.observaciones)}</p>${item.fecha_compromiso ? `<p><span class="siigo-semaforo siigo-${item.estado_compromiso}">${estadosCompromisoSiigo[item.estado_compromiso]}</span> Compromiso de pago: ${escapeSiigo(formatoSiigoFecha(item.fecha_compromiso))}${item.valor_compromiso != null ? ` · ${formatoSiigoNumero(item.valor_compromiso)}` : ''}</p>` : ''}${item.fecha_compromiso && !item.compromiso_cumplido_at ? `<button type="button" class="btn btn-secondary" data-cumplir="${item.id}">Marcar cumplido</button>` : ''}${item.compromiso_cumplido_at ? `<p>Cumplimiento registrado por ${escapeSiigo(item.compromiso_cumplido_por)} · ${escapeSiigo(formatoSiigoFecha(item.compromiso_cumplido_at.slice(0, 10)))}</p>` : ''}${item.proximo_seguimiento ? `<p>Próximo seguimiento: ${escapeSiigo(formatoSiigoFecha(item.proximo_seguimiento))}</p>` : ''}</article>`).join('');
}

const estadosCompromisoSiigo = { vencido: 'Vencido', proximo: 'Próximo a vencer', cumplido: 'Cumplido', pendiente: 'Pendiente', sin_compromiso: 'Sin compromiso' };

function estadoClienteCarteraSiigo(cliente) {
    const registros = cliente.seguimientos || [];
    return ['vencido', 'proximo', 'pendiente', 'cumplido'].find(estado => registros.some(r => r.estado_compromiso === estado)) || (registros.length ? 'con_seguimiento' : 'sin_seguimiento');
}

function actualizarAlertasCarteraSiigo(panel) {
    const clientes = panel._datosVencidas?.clientes || [];
    const registros = clientes.flatMap(c => c.seguimientos || []);
    panel.querySelector('[data-alertas-cartera]').innerHTML = ['vencido', 'proximo', 'cumplido'].map(estado => `<span class="siigo-semaforo siigo-${estado}">${estadosCompromisoSiigo[estado]}: ${registros.filter(r => r.estado_compromiso === estado).length}</span>`).join(' ') + '<br><small>Compromisos a hoy: amarillo hasta 3 días; azul con seguimiento o compromiso posterior; gris sin seguimiento.</small>';
    panel.querySelectorAll('[data-siigo-seguimiento]').forEach(boton => {
        const cliente = clientes[Number(boton.dataset.siigoSeguimiento)];
        const estado = estadoClienteCarteraSiigo(cliente);
        boton.className = `siigo-seguimiento-icono siigo-${estado}`;
        const etiqueta = `Seguimiento de cartera: ${estadosCompromisoSiigo[estado] || (estado === 'con_seguimiento' ? 'Con seguimiento' : 'Sin seguimiento')}`;
        boton.title = etiqueta;
        boton.setAttribute('aria-label', etiqueta);
    });
}

async function abrirSeguimientoCarteraSiigo(cliente) {
    const dialogo = document.createElement('dialog');
    dialogo.className = 'siigo-seguimiento-dialogo';
    dialogo.setAttribute('aria-labelledby', 'siigoSeguimientoTitulo');
    const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(new Date());
    dialogo.innerHTML = `<div class="siigo-seguimiento-cabecera"><h2 id="siigoSeguimientoTitulo">Seguimiento de cartera</h2><button type="button" class="btn btn-secondary" data-cerrar>Cerrar</button></div><p><strong>${escapeSiigo(cliente.cliente)}</strong> · ${escapeSiigo(cliente.identificacion)}<br>Vendedor: ${escapeSiigo(cliente.vendedor)}</p><p class="form-help">Historial completo del cliente, independiente de la fecha de corte del informe.</p><div class="button-group"><button type="button" class="btn btn-primary" data-nuevo disabled>Nuevo seguimiento</button><button type="button" class="btn btn-secondary" data-reintentar hidden>Reintentar consulta</button></div><p data-estado role="status" aria-live="polite"></p><form hidden><h3>Nuevo seguimiento</h3><div class="form-row"><div class="form-group"><label for="siigoGestionFecha">Fecha de gestión *</label><input id="siigoGestionFecha" name="fecha_gestion" type="date" required value="${hoy}" max="${hoy}"></div><div class="form-group"><label for="siigoGestionMedio">Medio de contacto *</label><select id="siigoGestionMedio" name="medio" required><option value="">Seleccione</option><option value="LLAMADA">Llamada</option><option value="WHATSAPP">WhatsApp</option><option value="CORREO">Correo</option><option value="VISITA">Visita</option><option value="OTRO">Otro</option></select></div></div><div class="form-group"><label for="siigoGestionContacto">Persona contactada</label><input id="siigoGestionContacto" name="contacto" maxlength="200"></div><div class="form-group"><label for="siigoGestionNota">Gestión realizada y acuerdos *</label><textarea id="siigoGestionNota" name="observaciones" rows="4" maxlength="5000" required></textarea></div><div class="form-row"><div class="form-group"><label for="siigoGestionCompromiso">Fecha compromiso de pago</label><input id="siigoGestionCompromiso" name="fecha_compromiso" type="date"></div><div class="form-group"><label for="siigoGestionValor">Valor compromiso (COP)</label><input id="siigoGestionValor" name="valor_compromiso" type="number" min="0.01" step="0.01"></div><div class="form-group"><label for="siigoGestionProximo">Próximo seguimiento</label><input id="siigoGestionProximo" name="proximo_seguimiento" type="date"></div></div><div class="button-group"><button type="submit" class="btn btn-primary">Guardar seguimiento</button><button type="button" class="btn btn-secondary" data-cancelar>Cancelar</button></div></form><h3>Historial de seguimientos</h3><div data-historial></div>`;
    document.body.appendChild(dialogo);
    const form = dialogo.querySelector('form');
    const estado = dialogo.querySelector('[data-estado]');
    const historial = dialogo.querySelector('[data-historial]');
    const nuevo = dialogo.querySelector('[data-nuevo]');
    const reintentar = dialogo.querySelector('[data-reintentar]');
    let registros = [];
    let guardando = false;
    const cancelarNuevo = () => {
        if (guardando) return;
        form.reset();
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
        form.elements.fecha_gestion.focus();
    });
    dialogo.querySelector('[data-cancelar]').addEventListener('click', cancelarNuevo);
    const cargarHistorial = async () => {
        estado.textContent = 'Consultando seguimientos...';
        reintentar.hidden = true;
        try {
            const params = new URLSearchParams({ identificacion: cliente.identificacion });
            const response = await fetch(`/api/contable/seguimiento-cartera?${params}`, { credentials: 'include' });
            const data = await leerRespuestaSiigo(response);
            if (!response.ok) throw new Error(data.error || 'No fue posible consultar el seguimiento.');
            registros = data.seguimientos;
            historial.innerHTML = historialSeguimientoCarteraSiigo(registros);
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
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (guardando || !form.reportValidity()) return;
        guardando = true;
        const guardar = form.querySelector('[type="submit"]');
        guardar.disabled = true;
        estado.textContent = 'Guardando seguimiento...';
        try {
            const datos = Object.fromEntries(new FormData(form));
            datos.identificacion = cliente.identificacion;
            const response = await fetch('/api/contable/seguimiento-cartera', {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos),
            });
            const data = await leerRespuestaSiigo(response);
            if (!response.ok) throw new Error(data.error || 'No fue posible guardar el seguimiento.');
            registros.push(data.seguimiento);
            registros.sort((a, b) => b.fecha_gestion.localeCompare(a.fecha_gestion) || b.created_at.localeCompare(a.created_at) || b.id - a.id);
            historial.innerHTML = historialSeguimientoCarteraSiigo(registros);
            cliente.seguimientos = registros;
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
    historial.addEventListener('click', async event => {
        const boton = event.target.closest('[data-cumplir]');
        if (!boton) return;
        boton.disabled = true;
        estado.textContent = 'Registrando cumplimiento...';
        try {
            const response = await fetch('/api/contable/seguimiento-cartera', {
                method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identificacion: cliente.identificacion, id: Number(boton.dataset.cumplir) }),
            });
            const data = await leerRespuestaSiigo(response);
            if (!response.ok) throw new Error(data.error || 'No fue posible registrar el cumplimiento.');
            registros = registros.map(r => r.id === data.seguimiento.id ? data.seguimiento : r);
            cliente.seguimientos = registros;
            historial.innerHTML = historialSeguimientoCarteraSiigo(registros);
            actualizarAlertasCarteraSiigo(document.getElementById('siigoFacturasVencidasPanel'));
            estado.textContent = 'Compromiso marcado como cumplido.';
        } catch (error) {
            estado.textContent = error.message;
            boton.disabled = false;
        }
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
    const clientes = data.clientes || [];
    if (!clientes.length) return '<p class="siigo-vencidas-vacio">No hay facturas con saldo pendiente para esta consulta.</p>';
    const cantidad = clientes.reduce((maximo, cliente) => Math.max(maximo, cliente.cantidad_facturas), 0);
    const encabezados = Array.from({ length: cantidad }, (_, indice) => `<th>N.º factura ${indice + 1}</th><th>Vencimiento</th><th>Valor</th>`).join('');
    const filas = clientes.map((cliente, indice) => {
        const detalle = cliente.facturas.map(factura => `<td>${escapeSiigo(factura.referencia)}</td><td>${factura.dias_vencido > 0 ? `Vencida hace ${factura.dias_vencido} días` : factura.dias_vencido === 0 ? 'Vence hoy' : `Por vencer en ${-factura.dias_vencido} días`}</td><td>${detalleCrucesFacturaSiigo(factura)}</td>`).join('');
        const vacias = '<td></td><td></td><td></td>'.repeat(cantidad - cliente.facturas.length);
        const seguimiento = cliente.identificacion
            ? `<button type="button" class="siigo-seguimiento-icono siigo-${estadoClienteCarteraSiigo(cliente)}" data-siigo-seguimiento="${indice}" title="Seguimiento de cartera: ${estadosCompromisoSiigo[estadoClienteCarteraSiigo(cliente)] || (cliente.seguimientos?.length ? 'Con seguimiento' : 'Sin seguimiento')}" aria-label="Seguimiento de cartera: ${estadosCompromisoSiigo[estadoClienteCarteraSiigo(cliente)] || (cliente.seguimientos?.length ? 'Con seguimiento' : 'Sin seguimiento')}"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z"/><path d="M7 9h10M7 13h7"/></svg></button>`
            : '<span class="form-help">Sin identificación para seguimiento</span>';
        return `<tr><td>${escapeSiigo(cliente.vendedor)}</td><td>${escapeSiigo(cliente.cliente)}</td><td>${cliente.cantidad_facturas}</td><td>${formatoSiigoNumero(cliente.total_cliente)}</td><td>${seguimiento}</td>${detalle}${vacias}</tr>`;
    }).join('');
    return `<div class="siigo-tabla-con-encabezado-fijo" tabindex="0" role="region" aria-label="Facturas vencidas y por vencer por cliente"><table class="data-table"><thead><tr><th>Vendedor</th><th>Cliente</th><th>Cantidad</th><th>Valor total cliente</th><th>Seguimiento</th>${encabezados}</tr></thead><tbody>${filas}</tbody></table></div>`;
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
        const response = await fetch('/api/contable/filtros-clientes', {credentials:'include'});
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los filtros.');
        if (data.es_administrador) vendedor.add(new Option('Sin asignar', 'sin_asignar'));
        data.vendedores.forEach(v=>vendedor.add(new Option(v.nombre, v.id)));
        const cargarContactos = () => {
            contacto.replaceChildren(new Option('Todos los disponibles',''));
            data.contactos.filter(p=>!vendedor.value || String(p.vendedor_id)===vendedor.value || (vendedor.value==='sin_asignar' && !p.vendedor_id)).forEach(p=>contacto.add(new Option(p.nombre,p.id)));
        };
        vendedor.addEventListener('change', cargarContactos); cargarContactos();
    } catch(error) {
        const aviso=document.createElement('span'); aviso.textContent=error.message; box.append(aviso);
    }
}
