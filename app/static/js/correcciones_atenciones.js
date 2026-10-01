let correccionesToken = '';
let correccionesPagina = 1;
let correccionesOcupado = false;

function abrirCorreccionesDesdeCargue() {
    document.getElementById('correccionesPeriodoDesde').value = document.getElementById('cargueAtencionesDiaPeriodoDesde').value;
    document.getElementById('correccionesPeriodoHasta').value = document.getElementById('cargueAtencionesDiaPeriodoHasta').value;
    invalidarRevisionCorrecciones();
    setIngresoInformacionSection('correcciones');
}

function invalidarRevisionCorrecciones() {
    correccionesToken = '';
    document.getElementById('correccionesAplicar').disabled = true;
    document.getElementById('correccionesVista').replaceChildren();
    document.getElementById('correccionesDescargas').replaceChildren();
    document.getElementById('correccionesMensaje').textContent = 'Carga el Excel corregido para validar los cambios.';
}

function tablaCorrecciones(containerId, filas, historial = false) {
    const columnas = historial
        ? [['fecha', 'Fecha del cambio'], ['usuario', 'Usuario'], ['empresa', 'Empresa'], ['archivo', 'Archivo'], ['atencion_id', 'Atencion'], ['campo', 'Campo'], ['antes', 'Antes'], ['despues', 'Despues']]
        : [['empresa', 'Empresa'], ['archivo', 'Archivo'], ['atencion_id', 'Atencion'], ['campo', 'Campo'], ['antes', 'Antes'], ['despues', 'Despues']];
    const tabla = document.createElement('table');
    tabla.className = 'data-table';
    const cabecera = tabla.createTHead().insertRow();
    columnas.forEach(([, titulo]) => {
        const th = document.createElement('th');
        th.textContent = titulo;
        cabecera.appendChild(th);
    });
    const cuerpo = tabla.createTBody();
    filas.forEach(fila => {
        const tr = cuerpo.insertRow();
        columnas.forEach(([campo]) => {
            tr.insertCell().textContent = campo === 'fecha'
                ? new Date(fila[campo]).toLocaleString('es-CO')
                : String(fila[campo] ?? '');
        });
    });
    document.getElementById(containerId).replaceChildren(tabla);
}

async function descargarArchivoCorrecciones(url, nombre) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo descargar el archivo');
    }
    const blob = await response.blob();
    const enlace = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    enlace.href = objectUrl;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    setTimeout(() => { URL.revokeObjectURL(objectUrl); enlace.remove(); }, 2000);
}

function nombreArchivoSabana(periodo) {
    return `Sabana-corregida-${String(periodo.empresa || 'empresa').replace(/[^a-z0-9_-]+/gi, '_')}.zip`;
}

async function descargarSabanaPeriodoCorreccion(periodo, mensaje) {
    const params = new URLSearchParams({ empresa: periodo.empresa, fecha_desde: periodo.fecha_desde, fecha_hasta: periodo.fecha_hasta });
    const endpoint = periodo.cliente_id ? 'generar' : 'regenerar-empresa';
    if (periodo.cliente_id) params.set('cliente_id', periodo.cliente_id);
    await descargarArchivoCorrecciones(`/api/comercial/prefacturas/${endpoint}?${params}`, nombreArchivoSabana(periodo));
    if (mensaje) mensaje.textContent = `Sabana corregida generada: ${periodo.empresa}.`;
}

async function descargarSabanasCorregidas(periodos, mensaje) {
    for (const periodo of periodos || []) {
        await descargarSabanaPeriodoCorreccion(periodo, mensaje);
    }
}

async function enviarCorreccionesExcel(aplicar, opciones = {}) {
    if (correccionesOcupado) return null;
    const input = document.getElementById('correccionesArchivos');
    const mensaje = document.getElementById('correccionesMensaje');
    if (!input.files.length || input.files.length > 20) {
        mensaje.textContent = 'Selecciona entre 1 y 20 archivos Excel.';
        return null;
    }
    if (aplicar && !correccionesToken) return null;
    const desde = document.getElementById('correccionesPeriodoDesde').value;
    const hasta = document.getElementById('correccionesPeriodoHasta').value;
    if (!desde || !hasta || desde > hasta) {
        mensaje.textContent = 'Selecciona un periodo valido para las atenciones que vas a corregir.';
        return null;
    }
    const datos = new FormData();
    datos.append('periodo_desde', desde);
    datos.append('periodo_hasta', hasta);
    [...input.files].forEach(archivo => datos.append('archivos', archivo));
    datos.append('accion', aplicar ? 'aplicar' : 'revisar');
    datos.append('modo_reemplazo', '1');
    if (aplicar) datos.append('token', correccionesToken);
    correccionesOcupado = true;
    input.disabled = true;
    document.getElementById('correccionesRevisar').disabled = true;
    document.getElementById('correccionesAplicar').disabled = true;
    mensaje.textContent = aplicar ? 'Guardando correcciones y generando sabana...' : 'Validando Excel corregido...';
    try {
        const response = await fetch('/api/comercial/atenciones-dia/correcciones-excel', {
            method: 'POST', credentials: 'same-origin', body: datos
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo procesar el archivo');
        if (!aplicar) {
            correccionesToken = data.token || '';
            tablaCorrecciones('correccionesVista', data.cambios || []);
            mensaje.textContent = data.atenciones
                ? `${data.atenciones} atenciones listas. Ahora pulsa Generar sabana corregida.`
                : 'No hay diferencias entre el Excel de Cargue Atenciones y las atenciones guardadas. Puedes generar la sabana desde los datos guardados.';
        } else {
            correccionesToken = '';
            input.value = '';
            mensaje.textContent = `${data.actualizadas} atenciones actualizadas. Generando sabana corregida...`;
            const descargas = document.getElementById('correccionesDescargas');
            descargas.replaceChildren();
            (data.periodos || []).forEach(periodo => {
                const boton = document.createElement('button');
                boton.type = 'button';
                boton.className = 'btn btn-secondary btn-sm';
                boton.textContent = `Descargar ${periodo.empresa}`;
                boton.onclick = async () => {
                    boton.disabled = true;
                    try {
                        await descargarSabanaPeriodoCorreccion(periodo, mensaje);
                    } catch (error) {
                        mensaje.textContent = `Las correcciones estan guardadas. ${error.message}`;
                    } finally { boton.disabled = false; }
                };
                descargas.appendChild(boton);
            });
            if (opciones.descargar) {
                await descargarSabanasCorregidas(data.periodos, mensaje);
                mensaje.textContent = `${data.actualizadas} atenciones actualizadas. Sabana corregida generada.`;
            } else {
                mensaje.textContent = `${data.actualizadas} atenciones actualizadas. Descarga la sabana corregida.`;
            }
            await consultarInformeCorrecciones(1);
        }
        return data;
    } catch (error) {
        correccionesToken = '';
        mensaje.textContent = error.message;
        return null;
    } finally {
        correccionesOcupado = false;
        input.disabled = false;
        document.getElementById('correccionesRevisar').disabled = false;
        document.getElementById('correccionesAplicar').disabled = !correccionesToken;
    }
}

async function cargarSabanaCorregida() {
    await enviarCorreccionesExcel(false);
}

async function generarSabanaCorregida() {
    if (!correccionesToken) {
        const data = await enviarCorreccionesExcel(false);
        if (!data?.token) return;
    }
    await enviarCorreccionesExcel(true, { descargar: true });
}

function filtrosInformeCorrecciones() {
    const params = new URLSearchParams();
    ['desde', 'hasta'].forEach(campo => {
        const valor = document.getElementById(campo === 'desde' ? 'correccionesDesde' : 'correccionesHasta').value;
        if (valor) params.set(campo, valor);
    });
    return params;
}

async function consultarInformeCorrecciones(pagina = 1) {
    const mensaje = document.getElementById('correccionesInformeMensaje');
    mensaje.textContent = 'Consultando historial...';
    try {
        const params = filtrosInformeCorrecciones();
        params.set('pagina', pagina);
        const response = await fetch(`/api/comercial/atenciones-dia/correcciones-informe?${params}`, { credentials: 'same-origin' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo consultar el historial');
        correccionesPagina = data.pagina;
        tablaCorrecciones('correccionesInforme', data.filas, true);
        mensaje.textContent = data.total ? `${data.total} correcciones. Pagina ${data.pagina} de ${data.paginas}.` : 'No hay correcciones para estos filtros.';
        document.getElementById('correccionesAnterior').disabled = data.pagina <= 1;
        document.getElementById('correccionesSiguiente').disabled = data.pagina >= data.paginas;
    } catch (error) { mensaje.textContent = error.message; }
}

async function descargarInformeCorrecciones() {
    const params = filtrosInformeCorrecciones();
    params.set('formato', 'xlsx');
    try {
        await descargarArchivoCorrecciones(`/api/comercial/atenciones-dia/correcciones-informe?${params}`, 'Correcciones-atenciones.xlsx');
    } catch (error) { document.getElementById('correccionesInformeMensaje').textContent = error.message; }
}
