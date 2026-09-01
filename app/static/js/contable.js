function escapeSiigo(value) {
    const element = document.createElement('div');
    element.textContent = value == null ? '' : String(value);
    return element.innerHTML;
}

function formatoSiigoNumero(value) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }).format(value || 0);
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
    panel.innerHTML = `<h3 style="margin-top:0;">Clientes nuevos y clientes que no volvieron</h3><p class="form-help">Se comparan las facturas FV de dos periodos. Un cliente nuevo factura en el segundo periodo y no en el primero.</p><form id="siigoComparativoForm"><div class="form-row"><div class="form-group"><label>Periodo 1: desde</label><input id="siigoPeriodoADesde" type="date" required></div><div class="form-group"><label>Periodo 1: hasta</label><input id="siigoPeriodoAHasta" type="date" required></div><div class="form-group"><label>Periodo 2: desde</label><input id="siigoPeriodoBDesde" type="date" required></div><div class="form-group"><label>Periodo 2: hasta</label><input id="siigoPeriodoBHasta" type="date" required></div><div class="form-group" style="align-self:end;"><button class="btn btn-primary" type="submit">Generar comparativo</button></div></div></form><div id="siigoComparativoResultado" class="table-container" style="margin-top:16px;"></div>`;
    consulta.insertAdjacentElement('afterend', panel);
    panel.querySelector('form').addEventListener('submit', consultarComparativoClientesSiigo);
    return panel;
}

function mostrarComparativoClientes() {
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
    const result = document.getElementById('siigoComparativoResultado');
    result.textContent = 'Generando comparativo...';
    try {
        const response = await fetch(`/api/contable/comparativo-clientes?${params.toString()}`, { credentials: 'include' });
        const data = await leerRespuestaSiigo(response);
        if (!response.ok) throw new Error(data.error || 'No fue posible generar el comparativo.');
        const table = (items, empty) => items.length ? `<table class="data-table"><thead><tr><th>Identificacion</th><th>Cliente</th><th>Facturas</th></tr></thead><tbody>${items.map(item => `<tr><td>${escapeSiigo(item.identificacion)}</td><td>${escapeSiigo(item.nombre)}</td><td>${item.facturas}</td></tr>`).join('')}</tbody></table>` : `<p class="form-help">${empty}</p>`;
        result.innerHTML = `<div class="stats-grid"><div class="stat-card"><h3>Clientes periodo 1</h3><p class="stat-number">${data.clientes_periodo_a}</p></div><div class="stat-card"><h3>Clientes periodo 2</h3><p class="stat-number">${data.clientes_periodo_b}</p></div><div class="stat-card"><h3>Nuevos</h3><p class="stat-number">${data.nuevos.length}</p></div><div class="stat-card"><h3>No volvieron</h3><p class="stat-number">${data.no_volvieron.length}</p></div></div><div class="form-row" style="align-items:flex-start;"><div style="flex:1; min-width:280px;"><h4>Clientes nuevos</h4>${table(data.nuevos, 'No hubo clientes nuevos en el segundo periodo.')}</div><div style="flex:1; min-width:280px;"><h4>Clientes que no volvieron</h4>${table(data.no_volvieron, 'Todos los clientes del primer periodo volvieron a facturar.')}</div></div>`;
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
    cargarConfiguracionVentasSiigo();
    cargarResumenSiigo().catch(error => {
        const result = document.getElementById('siigoCargaResultado');
        if (result) result.textContent = error.message;
    });
}
