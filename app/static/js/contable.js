function escapeSiigo(value) {
    const element = document.createElement('div');
    element.textContent = value == null ? '' : String(value);
    return element.innerHTML;
}

function formatoSiigoNumero(value) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }).format(value || 0);
}

async function cargarResumenSiigo() {
    const response = await fetch('/api/contable/resumen', { credentials: 'include' });
    const data = await response.json();
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
        const data = await response.json();
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
        const value = document.getElementById(id).value.trim();
        if (value) params.set(key, value);
    });
    const container = document.getElementById('siigoConsultaResultado');
    container.innerHTML = 'Consultando...';
    try {
        const response = await fetch(`/api/contable/comprobantes?${params.toString()}`, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No fue posible consultar comprobantes.');
        const rows = data.comprobantes || [];
        container.innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Documento</th><th>Fecha</th><th>Movimientos</th><th>Debito</th><th>Credito</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeSiigo(`${row.tipo}-${row.codigo}-${row.numero}`)}</td><td>${escapeSiigo(row.fecha)}</td><td>${row.movimientos}</td><td>${formatoSiigoNumero(row.debito)}</td><td>${formatoSiigoNumero(row.credito)}</td></tr>`).join('')}</tbody></table>` : 'No se encontraron comprobantes con esos filtros.';
    } catch (error) {
        container.textContent = error.message;
    }
}

async function consultarClientesSiigo() {
    const query = document.getElementById('siigoClienteFiltro').value.trim();
    const container = document.getElementById('siigoConsultaResultado');
    container.innerHTML = 'Consultando...';
    try {
        const response = await fetch(`/api/contable/clientes?q=${encodeURIComponent(query)}`, { credentials: 'include' });
        const data = await response.json();
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
    cargarResumenSiigo().catch(error => {
        const result = document.getElementById('siigoCargaResultado');
        if (result) result.textContent = error.message;
    });
}
