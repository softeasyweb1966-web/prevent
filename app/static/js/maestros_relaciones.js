/* Consultas sobre el mismo maestro y CRUD de tarifas comerciales existente. */
function inicializarFiltrosMaestro() {
  document.getElementById('filtroVendedorMaestro').innerHTML =
    (M.esAdmin ? '<option value="">Todos los vendedores disponibles</option>' : '') +
    M.vendedores.map(v=>`<option value="${v.id}">${esc(v.nombre)}</option>`).join('');
  document.getElementById('filtroVendedorMaestro').disabled = !M.esAdmin;
  document.getElementById('btnNuevaTarifa').hidden = !M.permisos.tarifas?.create;
  if (M.esAdmin && !document.getElementById('conciliacionMaestro')) {
    const panel = document.createElement('section'); panel.id='conciliacionMaestro';
    panel.innerHTML='<h3>Atenciones pendientes de vincular</h3><button type="button" class="m-btn m-btn-secondary" onclick="conciliarAtencionesMaestro(false)">Revisar coincidencias</button> <button type="button" id="aplicarConciliacionMaestro" hidden class="m-btn m-btn-primary" onclick="conciliarAtencionesMaestro(true)">Vincular coincidencias únicas</button><p id="resultadoConciliacionMaestro" role="status"></p>';
    document.getElementById('maestroResumen').after(panel);
  }
}

async function conciliarAtencionesMaestro(aplicar) {
  const result=document.getElementById('resultadoConciliacionMaestro');
  const boton=document.getElementById('aplicarConciliacionMaestro');
  boton.disabled=true; result.textContent='Revisando atenciones…';
  try {
    const data=await api('/api/comercial/maestro/conciliar-atenciones',{method:aplicar?'POST':'GET',body:aplicar?'{}':undefined});
    result.textContent=`${data.pendientes} pendientes · ${aplicar?data.vinculadas:data.vinculables} ${aplicar?'vinculadas':'con coincidencia única'} · ${data.ambiguas} ambiguas · ${data.sin_coincidencia} sin coincidencia. Se conserva el vendedor histórico (${data.vendedor_historico_distinto} diferencias con el responsable actual).`;
    boton.hidden=aplicar || !data.vinculables;
  } catch(e) { result.textContent=e.message; boton.hidden=true; }
  finally { boton.disabled=false; }
}

const vistaMaestro = { abiertos:new Set(), paginas:new Map(), grupos:[], firma:'', timer:null };
function panelMaestroActivo(nombre) { return document.getElementById('panel-'+nombre).classList.contains('active'); }
function normalizarBusquedaMaestro(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function coincideBusquedaMaestro(c) {
  const q = normalizarBusquedaMaestro(document.getElementById('buscarMaestro').value);
  const contactos = [...(c.contactos_agrupacion ?? []), ...(c.contactos ?? [])];
  const campos = [c.razon_social,c.nombre_comercial,c.nit,c.vendedor_nombre,c.telefono_empresa,
    c.responsable,c.telefono_responsable,...contactos.flatMap(p=>[p.nombre,p.telefono])].map(normalizarBusquedaMaestro);
  return !q || campos.some(x=>x.includes(q)) || (/\d/.test(q) && /^[\d\s()+.\-]+$/.test(q) &&
    campos.some(x=>x.replace(/\D/g,'').includes(q.replace(/\D/g,''))));
}
function buscarEnMaestro() {
  clearTimeout(vistaMaestro.timer);
  vistaMaestro.timer = setTimeout(refrescarMaestro, 180);
}
function cantidadEmpresasMaestro(n) { return `${n} ${n===1?'empresa':'empresas'}`; }
function paginaClientesMaestro(rows) {
  let nav=document.getElementById('paginasClientesMaestro');
  if (!nav) { nav=document.createElement('div'); nav.id='paginasClientesMaestro'; document.querySelector('#panel-clientes .maestros-scroll').after(nav); }
  const firma=rows.map(c=>c.id).join(',');
  if (nav.dataset.firma!==firma) { nav.dataset.firma=firma; vistaMaestro.paginas.set('clientes',0); }
  const pagina=Math.min(vistaMaestro.paginas.get('clientes')||0, Math.max(0,Math.ceil(rows.length/50)-1));
  nav.innerHTML=paginacionMaestro('clientes',pagina,rows.length);
  return rows.slice(pagina*50,(pagina+1)*50);
}
function paginacionMaestro(clave,pagina,total) {
  if (total<=50) return '';
  return `<nav class="maestro-paginacion" aria-label="Páginas de empresas"><button type="button" class="m-btn m-btn-secondary" data-pagina="${esc(clave)}" data-numero="${pagina-1}" ${pagina===0?'disabled':''}>Anterior</button><span>${pagina*50+1}–${Math.min((pagina+1)*50,total)} de ${total}</span><button type="button" class="m-btn m-btn-secondary" data-pagina="${esc(clave)}" data-numero="${pagina+1}" ${(pagina+1)*50>=total?'disabled':''}>Siguiente</button></nav>`;
}
document.addEventListener('click', event=>{
  const boton=event.target.closest('[data-pagina]');
  if (!boton) return;
  vistaMaestro.paginas.set(boton.dataset.pagina,Number(boton.dataset.numero));
  if (boton.dataset.pagina==='clientes') renderClientes();
  else {
    const grupo=boton.closest('.grupo-contacto');
    pintarEmpresasGrupoMaestro(grupo);
    grupo.querySelector('[data-pagina]:not(:disabled)')?.focus();
  }
});
function clientesFiltradosMaestro() {
  const vendedor = document.getElementById('filtroVendedorMaestro').value;
  const revision = document.getElementById('filtroRevisionMaestro').value;
  return M.clientes.filter(c => coincideBusquedaMaestro(c) && (!vendedor || String(c.vendedor_id)===vendedor) &&
    (!revision || (revision==='sin_vendedor' && !c.vendedor_id) ||
    (revision==='sin_contacto' && !(c.contactos_agrupacion ?? c.contactos).length) ||
    (revision==='sin_paquete' && !c.paquetes_vigentes) ||
    (revision==='sin_servicios' && !c.servicios_vigentes) ||
    (revision==='revision' && c.revision_importacion)));
}

function refrescarMaestro() {
  const clientes = clientesFiltradosMaestro();
  document.getElementById('maestroResumen').textContent = `${clientes.length} clientes en esta consulta · ${M.clientes.length} disponibles · ${M.clientes.filter(c=>!c.vendedor_id).length} sin vendedor · ${M.clientes.filter(c=>!c.paquetes_vigentes).length} sin paquete vigente`;
  if (panelMaestroActivo('servicios')) actualizarSelectorServiciosMaestro(clientes);
  renderClientes(); renderContactos(); renderGruposMaestro(); renderServiciosMaestro();
}

function actualizarSelectorServiciosMaestro(clientes) {
  const selector = document.getElementById('serviciosCliente');
  const anterior = selector.value;
  selector.innerHTML = '<option value="">Selecciona una empresa</option>' + clientes.map(c=>`<option value="${c.id}">${esc(c.razon_social)} · ${esc(c.nit)}</option>`).join('');
  if (clientes.some(c=>String(c.id)===anterior)) selector.value = anterior;
}

function agruparEmpresasMaestro(clientes) {
    const vendedores = new Map();
    for (const c of clientes) {
        const vid = c.vendedor_id || 0;
    if (!vendedores.has(vid)) vendedores.set(vid, {id:vid,nombre:c.vendedor_nombre || 'Sin asignar', clientes:new Set(), contactos:new Map()});
    const vendedor = vendedores.get(vid);
    vendedor.clientes.add(c.id);
    const contactos = c.contactos_agrupacion ?? c.contactos ?? [];
    for (const p of (contactos.length ? contactos : [{nombre:'',telefono:''}])) {
      const nombre = (p.nombre || '').trim().replace(/\s+/g, ' ');
      const clave = vid && nombre ? nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() : nombre ? `sin-datos:${c.id}` : 'sin-contacto';
      if (!vendedor.contactos.has(clave)) vendedor.contactos.set(clave,{clave,nombre:nombre || 'Empresas sin contacto',sinContacto:!nombre,telefonos:new Set(),empresas:new Map()});
      const grupo = vendedor.contactos.get(clave);
      if (p.telefono) grupo.telefonos.add(p.telefono.trim());
      grupo.empresas.set(c.id, c);
    }
  }
  return [...vendedores.entries()].sort(([a], [b]) => (a === 0) - (b === 0)).map(([,v]) => ({...v,
    contactos:[...v.contactos.values()].map(p=>({...p,telefonos:[...p.telefonos],empresas:[...p.empresas.values()].sort((a,b)=>a.razon_social.localeCompare(b.razon_social,'es'))}))
      .sort((a,b)=>Number(a.sinContacto)-Number(b.sinContacto) || b.empresas.length-a.empresas.length || a.nombre.localeCompare(b.nombre, 'es'))}));
}

function filaEmpresaMaestro(c) {
  return `<div class="empresa-fila"><div class="empresa-datos"><button type="button" class="empresa-nombre" onclick="verEmpresaMaestro(${c.id})">${esc(c.razon_social)}</button><small>NIT ${esc(c.nit)}</small></div><button type="button" class="m-btn m-btn-secondary m-btn-sm" onclick="verEmpresaMaestro(${c.id})" aria-label="Ver ${esc(c.razon_social)}">Ver</button></div>`;
}
function verEmpresaMaestro(id) {
  const c=M.clientes.find(c=>c.id===id);
  if (!c) return;
  const contactos=(c.contactos||[]).map(p=>[p.nombre,p.telefono,p.email].filter(Boolean).join(' · ')).join('\n');
  const agrupacion=(c.contactos_agrupacion||[]).map(p=>[p.nombre,p.telefono].filter(Boolean).join(' · ')).join('\n');
  const campos=[['NIT / Identificación',c.nit],['Nombre comercial',c.nombre_comercial],['Vendedor',c.vendedor_nombre||'Sin asignar'],
    ['Estado',c.estado_cliente],['Teléfono empresa',c.telefono_empresa],['Email empresa',c.email_empresa],['Ciudad',c.ciudad],['Dirección',c.direccion],
    ['Responsable',c.responsable],['Teléfono responsable',c.telefono_responsable],['Tipo de identificación',c.tipo_identificacion],['Dígito de verificación',c.digito_verificacion],
    ['Régimen IVA',c.regimen_iva],['Contactos vinculados',contactos],['Contactos de agrupación',agrupacion],['Nombres alternativos',(c.nombres_alternativos||[]).join(' · ')],
    ['Observaciones',c.observaciones],['Revisión de importación',c.revision_importacion],['Servicios vigentes',c.servicios_vigentes??0],['Paquetes vigentes',c.paquetes_vigentes??0]];
  document.getElementById('tituloVerEmpresa').textContent=c.razon_social;
  document.getElementById('detalleVerEmpresa').innerHTML=campos.map(([nombre,valor])=>`<div><dt>${esc(nombre)}</dt><dd>${esc(valor ?? '') || '—'}</dd></div>`).join('');
  document.getElementById('accionesVerEmpresa').innerHTML=
    `${M.permisos.clientes?.update?`<button type="button" class="m-btn m-btn-primary" onclick="cerrarModal('modalVerEmpresa'); abrirModalCliente(${id})">Editar</button>`:''}
    ${M.permisos.tarifas?.read?`<button type="button" class="m-btn m-btn-secondary" onclick="cerrarModal('modalVerEmpresa'); verServiciosCliente(${id})">Servicios</button>`:''}
    <button type="button" class="m-btn m-btn-secondary" onclick="cerrarModal('modalVerEmpresa'); verOrigenMaestro(${id})">Origen e historial</button>
    ${!(c.contactos_agrupacion??c.contactos??[]).length && M.permisos.clientes?.create?`<button type="button" class="m-btn m-btn-secondary" onclick="cerrarModal('modalVerEmpresa'); agregarContactoEmpresaMaestro(${id})">Agregar contacto</button>`:''}
    <button type="button" class="m-btn m-btn-secondary" onclick="cerrarModal('modalVerEmpresa')">Cerrar</button>`;
  document.getElementById('modalVerEmpresa').classList.add('active');
  document.getElementById('tituloVerEmpresa').focus({preventScroll:true});
  document.getElementById('modalVerEmpresa').scrollTop=0;
}

function agregarContactoEmpresaMaestro(id) {
  const cliente = M.clientes.find(c=>c.id===id);
  if (!cliente || !M.permisos.clientes?.create) return;
  abrirModalContacto();
  document.getElementById('tituloModalContacto').textContent = `Agregar contacto: ${cliente.razon_social}`;
  document.getElementById('contactoVendedor').value = cliente.vendedor_id || '';
  document.querySelectorAll('#contactoClientes input').forEach(input => { input.checked = Number(input.value) === id; });
  document.getElementById('contactoNombre').focus();
}

function renderGruposMaestro() {
  if (!panelMaestroActivo('grupos')) return;
  const firma=[document.getElementById('buscarMaestro').value,document.getElementById('filtroVendedorMaestro').value,document.getElementById('filtroRevisionMaestro').value].join('|');
  const nueva=firma!==vistaMaestro.firma;
  if (nueva) { vistaMaestro.abiertos.clear(); vistaMaestro.paginas.clear(); vistaMaestro.firma=firma; }
  const clientes=clientesFiltradosMaestro();
  vistaMaestro.grupos=agruparEmpresasMaestro(clientes);
  const busqueda=!!document.getElementById('buscarMaestro').value.trim();
  const panel=document.getElementById('gruposEmpresas');
  panel.innerHTML=vistaMaestro.grupos.map((v,i)=>`<details class="grupo-vendedor" data-vendedor="${i}" data-clave="v${v.id}"><summary>${esc(v.nombre)} <span class="grupo-conteo">· ${cantidadEmpresasMaestro(v.clientes.size)}</span></summary><div class="grupo-contenido"></div></details>`).join('') || '<p role="status">No hay empresas para esta búsqueda y filtros.</p>';
  panel.querySelectorAll('.grupo-vendedor').forEach(el=>{
    el.addEventListener('toggle',()=>{
      if (!el.isConnected) return;
      if (el.open) { vistaMaestro.abiertos.add(el.dataset.clave); pintarContactosGrupoMaestro(el); }
      else { vistaMaestro.abiertos.delete(el.dataset.clave); el.querySelector('.grupo-contenido').replaceChildren(); }
    });
    if (vistaMaestro.abiertos.has(el.dataset.clave) || (nueva && busqueda)) {
      el.open=true;
      pintarContactosGrupoMaestro(el,nueva && busqueda && clientes.length<=50);
    }
  });
}
function pintarContactosGrupoMaestro(el,expandir=false) {
  const contenido=el.querySelector('.grupo-contenido');
  if (contenido.childElementCount) return;
  const v=vistaMaestro.grupos[Number(el.dataset.vendedor)];
  contenido.innerHTML=v.contactos.map((p,i)=>`<details class="grupo-contacto" data-vendedor="${el.dataset.vendedor}" data-contacto="${i}" data-clave="${esc(JSON.stringify([v.id,p.clave]))}"><summary>${esc(p.nombre)} ${p.sinContacto?'':`<span class="grupo-conteo">${esc(p.telefonos.join(' / '))}</span>`} <span class="grupo-conteo">· ${cantidadEmpresasMaestro(p.empresas.length)}</span></summary><div class="grupo-empresas"></div></details>`).join('');
  contenido.querySelectorAll('.grupo-contacto').forEach(grupo=>{
    grupo.addEventListener('toggle',()=>{
      if (!grupo.isConnected) return;
      if (grupo.open) { vistaMaestro.abiertos.add(grupo.dataset.clave); pintarEmpresasGrupoMaestro(grupo); }
      else { vistaMaestro.abiertos.delete(grupo.dataset.clave); grupo.querySelector('.grupo-empresas').replaceChildren(); }
    });
    if (expandir || vistaMaestro.abiertos.has(grupo.dataset.clave)) { grupo.open=true; pintarEmpresasGrupoMaestro(grupo); }
  });
}
function pintarEmpresasGrupoMaestro(grupo) {
  const p=vistaMaestro.grupos[Number(grupo.dataset.vendedor)].contactos[Number(grupo.dataset.contacto)];
  const pagina=Math.min(vistaMaestro.paginas.get(grupo.dataset.clave)||0,Math.max(0,Math.ceil(p.empresas.length/50)-1));
  grupo.querySelector('.grupo-empresas').innerHTML=p.empresas.slice(pagina*50,(pagina+1)*50).map(filaEmpresaMaestro).join('')+paginacionMaestro(grupo.dataset.clave,pagina,p.empresas.length);
}

async function cargarTarifasMaestro() {
  M.tarifas = M.tarifas || []; M.errorTarifas = '';
  if (!M.permisos.tarifas?.read) { M.errorTarifas='Tu perfil no tiene permiso para consultar tarifas.'; return; }
  try { M.tarifas = await api('/api/comercial/tarifas'); }
  catch(e) { M.errorTarifas=e.message; }
  renderServiciosMaestro();
}

function verServiciosCliente(id) {
  maestrosTab('servicios');
  document.getElementById('serviciosCliente').value = id;
  renderServiciosMaestro();
}

function renderServiciosMaestro() {
  if (!panelMaestroActivo('servicios')) return;
  const cid = Number(document.getElementById('serviciosCliente').value);
  const panel = document.getElementById('serviciosEmpresaDetalle');
  document.getElementById('btnNuevaTarifa').disabled = !cid;
  if (M.errorTarifas) { panel.textContent=M.errorTarifas; return; }
  if (!cid) { panel.textContent='Selecciona una empresa para consultar sus productos, servicios y paquetes.'; return; }
  const rows = (M.tarifas||[]).filter(t=>t.cliente_id===cid);
  panel.innerHTML = rows.length ? `<table class="maestros-table"><thead><tr><th>Producto/servicio</th><th>Tipo</th><th>Tarifa</th><th>Vigencia</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.map(t=>`<tr><td>${esc(t.item_nombre)}</td><td>${esc(t.tipo_item)}</td><td>${money(t.tarifa_negociada)}</td><td>${esc(t.vigencia_desde||'Sin inicio')} — ${esc(t.vigencia_hasta||'Sin fin')}</td><td>${t.activo?'Activo':'Inactivo'}</td><td>${M.permisos.tarifas?.update?`<button class="m-btn m-btn-secondary" onclick="abrirTarifaMaestro(${t.id})">Editar</button>`:''} ${M.permisos.tarifas?.delete?`<button class="m-btn m-btn-danger" onclick="borrarTarifaMaestro(${t.id})">Eliminar</button>`:''}</td></tr>`).join('')}</tbody></table>` : '<p>Esta empresa no tiene productos, servicios ni paquetes asignados.</p>';
}

function abrirTarifaMaestro(id) {
  const t = (M.tarifas||[]).find(t=>t.id===id);
  document.getElementById('tarifaMaestroId').value = id || '';
  document.getElementById('tarifaMaestroItem').innerHTML = '<option value="">Selecciona un producto/servicio</option>' + M.catalogo.map(i=>`<option value="${i.id}">${esc(i.nombre)} · ${esc(i.tipo_item)}</option>`).join('');
  document.getElementById('tarifaMaestroItem').value = t?.catalogo_item_id || '';
  document.getElementById('tarifaMaestroValor').value = t?.tarifa_negociada ?? '';
  document.getElementById('tarifaMaestroDesde').value = t?.vigencia_desde || '';
  document.getElementById('tarifaMaestroHasta').value = t?.vigencia_hasta || '';
  document.getElementById('tarifaMaestroActivo').value = String(t?.activo ?? true);
  document.getElementById('tarifaMaestroObservacion').value = t?.observacion || '';
  document.getElementById('modalTarifaMaestro').classList.add('active');
}

async function guardarTarifaMaestro(event) {
  event.preventDefault();
  const id = document.getElementById('tarifaMaestroId').value;
  const data = {
    cliente_id:Number(document.getElementById('serviciosCliente').value),
    catalogo_item_id:Number(document.getElementById('tarifaMaestroItem').value),
    tarifa_negociada:document.getElementById('tarifaMaestroValor').value,
    vigencia_desde:document.getElementById('tarifaMaestroDesde').value || null,
    vigencia_hasta:document.getElementById('tarifaMaestroHasta').value || null,
    activo:document.getElementById('tarifaMaestroActivo').value==='true',
    observacion:document.getElementById('tarifaMaestroObservacion').value
  };
  try {
    await api(id?`/api/comercial/tarifas/${id}`:'/api/comercial/tarifas',{method:id?'PUT':'POST',body:JSON.stringify(data)});
    cerrarModal('modalTarifaMaestro'); mToast('Relación guardada.');
    await Promise.all([cargarClientes(),cargarTarifasMaestro()]);
  } catch(e) { mToast(e.message,false); }
}

async function borrarTarifaMaestro(id) {
  if (!confirm('¿Eliminar esta tarifa del cliente? También puedes editarla e inactivarla.')) return;
  try {
    await api(`/api/comercial/tarifas/${id}`,{method:'DELETE'});
    await Promise.all([cargarClientes(),cargarTarifasMaestro()]); mToast('Relación eliminada.');
  } catch(e) { mToast(e.message,false); }
}

async function verOrigenMaestro(id) {
  const panel = document.getElementById('origenMaestroDetalle');
  panel.textContent='Consultando…';
  document.getElementById('modalOrigenMaestro').classList.add('active');
  try {
    const [origen,historial] = await Promise.all([api(`/api/comercial/maestro/clientes/${id}/origen`),api(`/api/comercial/maestro/clientes/${id}/historial-vendedor`)]);
    const c = M.clientes.find(c=>c.id===id);
    panel.innerHTML = `<p>${esc(c?.razon_social)} · ${esc(c?.nit)}</p><p>${esc(c?.revision_importacion||'Sin observaciones de importación.')}</p><p>${origen.length?origen.map(f=>`Carga ${f.carga_id}, fila ${f.fila}`).join(' · '):'Sin filas de Excel asociadas.'}</p><ul>${historial.map(h=>`<li>${esc(h.fecha)}: ${esc(h.anterior)} → ${esc(h.nuevo)} (${esc(h.origen)})</li>`).join('')}</ul>${historial.length?'':'<p>No hay cambios de vendedor registrados desde la activación del historial.</p>'}`;
  } catch(e) { panel.textContent=e.message; }
}
