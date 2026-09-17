let correccionesToken = '';
let correccionesPagina = 1;
let correccionesOcupado = false;

function invalidarRevisionCorrecciones() {
    correccionesToken = '';
    document.getElementById('correccionesAplicar').disabled = true;
    document.getElementById('correccionesVista').replaceChildren();
    document.getElementById('correccionesDescargas').replaceChildren();
    document.getElementById('correccionesMensaje').textContent = 'Revisa los archivos seleccionados antes de aplicar los cambios.';
}

function tablaCorrecciones(containerId, filas, historial = false) {
    const columnas = historial
        ? [['fecha', 'Fecha del cambio'], ['usuario', 'Usuario'], ['empresa', 'Empresa'], ['archivo', 'Archivo'], ['atencion_id', 'Atención'], ['campo', 'Campo'], ['antes', 'Antes'], ['despues', 'Después']]
        : [['empresa', 'Empresa'], ['archivo', 'Archivo'], ['atencion_id', 'Atención'], ['campo', 'Campo'], ['antes', 'Antes'], ['despues', 'Después']];
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
                ? new Date(fila[campo]).toLocaleString('es-CO') : String(fila[campo] ?? '');
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

async function enviarCorreccionesExcel(aplicar) {
    if (correccionesOcupado) return;
    const input = document.getElementById('correccionesArchivos');
    const mensaje = document.getElementById('correccionesMensaje');
    if (!input.files.length || input.files.length > 20) {
        mensaje.textContent = 'Selecciona entre 1 y 20 archivos Excel.';
        return;
    }
    if (aplicar && !correccionesToken) return;
    const datos = new FormData();
    [...input.files].forEach(archivo => datos.append('archivos', archivo));
    datos.append('accion', aplicar ? 'aplicar' : 'revisar');
    if (aplicar) datos.append('token', correccionesToken);
    correccionesOcupado = true;
    input.disabled = true;
    document.getElementById('correccionesRevisar').disabled = true;
    document.getElementById('correccionesAplicar').disabled = true;
    mensaje.textContent = aplicar ? 'Guardando correcciones y su historial...' : 'Validando archivos y comparando las atenciones...';
    try {
        const response = await fetch('/api/comercial/atenciones-dia/correcciones-excel', {
            method: 'POST', credentials: 'same-origin', body: datos
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo procesar el archivo');
        if (!aplicar) {
            correccionesToken = data.atenciones ? data.token : '';
            tablaCorrecciones('correccionesVista', data.cambios);
            mensaje.textContent = data.atenciones
                ? `${data.atenciones} atenciones por corregir. Revisa el antes y después y pulsa Aplicar cambios revisados.`
                : 'No hay cambios en la hoja corregir-atenciones. Las otras hojas no se importan.';
        } else {
            correccionesToken = '';
            input.value = '';
            mensaje.textContent = `${data.actualizadas} atenciones actualizadas con su historial. Descarga las prefacturas recalculadas a continuación.`;
            const descargas = document.getElementById('correccionesDescargas');
            descargas.replaceChildren();
            data.periodos.forEach(periodo => {
                const boton = document.createElement('button');
                boton.type = 'button';
                boton.className = 'btn btn-primary';
                boton.textContent = `Regenerar ${periodo.empresa} (${periodo.fecha_desde} a ${periodo.fecha_hasta})`;
                boton.onclick = async () => {
                    boton.disabled = true;
                    try {
                        const params = new URLSearchParams({ empresa: periodo.empresa, fecha_desde: periodo.fecha_desde, fecha_hasta: periodo.fecha_hasta });
                        await descargarArchivoCorrecciones(`/api/comercial/prefacturas/regenerar-empresa?${params}`, 'Prefacturas-corregidas.zip');
                    } catch (error) {
                        mensaje.textContent = `Las correcciones están guardadas. ${error.message}`;
                    } finally { boton.disabled = false; }
                };
                descargas.appendChild(boton);
            });
            await consultarInformeCorrecciones(1);
        }
    } catch (error) {
        correccionesToken = '';
        mensaje.textContent = error.message;
    } finally {
        correccionesOcupado = false;
        input.disabled = false;
        document.getElementById('correccionesRevisar').disabled = false;
        document.getElementById('correccionesAplicar').disabled = !correccionesToken;
    }
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
        mensaje.textContent = data.total ? `${data.total} correcciones. Página ${data.pagina} de ${data.paginas}.` : 'No hay correcciones para estos filtros.';
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
