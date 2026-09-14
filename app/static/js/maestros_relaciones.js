/* Consultas sobre el mismo maestro y CRUD de tarifas comerciales existente. */
function inicializarFiltrosMaestro() {
  document.getElementById('filtroVendedorMaestro').innerHTML =
    '<option value="">Todos los vendedores disponibles</option>' +
    M.vendedores.map(v=>`<option value="${v.id}">${esc(v.nombre)}</option>`).join('');
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

function clientesFiltradosMaestro() {
  const vendedor = document.getElementById('filtroVendedorMaestro').value;
  const revision = document.getElementById('filtroRevisionMaestro').value;
  return M.clientes.filter(c => (!vendedor || String(c.vendedor_id)===vendedor) &&
    (!revision || (revision==='sin_vendedor' && !c.vendedor_id) ||
    (revision==='sin_contacto' && !c.contactos.length) ||
    (revision==='sin_paquete' && !c.paquetes_vigentes) ||
    (revision==='sin_servicios' && !c.servicios_vigentes) ||
    (revision==='revision' && c.revision_importacion)));
}

function refrescarMaestro() {
  const clientes = clientesFiltradosMaestro();
  document.getElementById('maestroResumen').textContent = `${clientes.length} clientes en esta consulta · ${M.clientes.length} disponibles · ${M.clientes.filter(c=>!c.vendedor_id).length} sin vendedor · ${M.clientes.filter(c=>!c.paquetes_vigentes).length} sin paquete vigente`;
  const selector = document.getElementById('serviciosCliente');
  const anterior = selector.value;
  selector.innerHTML = '<option value="">Selecciona una empresa</option>' + clientes.map(c=>`<option value="${c.id}">${esc(c.razon_social)} · ${esc(c.nit)}</option>`).join('');
  if (clientes.some(c=>String(c.id)===anterior)) selector.value = anterior;
  renderClientes(); renderContactos(); renderGruposMaestro(); renderServiciosMaestro();
}

function agruparEmpresasMaestro(clientes) {
    const vendedores = new Map();
    for (const c of clientes) {
        const vid = c.vendedor_id || 0;
    if (!vendedores.has(vid)) vendedores.set(vid, {nombre:c.vendedor_nombre, clientes:new Set(), contactos:new Map()});
    const vendedor = vendedores.get(vid);
    vendedor.clientes.add(c.id);
    const contactos = c.contactos_agrupacion ?? c.contactos ?? [];
    for (const p of (contactos.length ? contactos : [{nombre:'',telefono:''}])) {
      const nombre = (p.nombre || '').trim().replace(/\s+/g, ' ');
      const clave = vid && nombre ? nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() : `sin-datos:${c.id}`;
      if (!vendedor.contactos.has(clave)) vendedor.contactos.set(clave,{nombre:nombre || 'Sin CONTACTO',telefonos:new Set(),empresas:new Map()});
      const grupo = vendedor.contactos.get(clave);
      if (p.telefono) grupo.telefonos.add(p.telefono.trim());
      grupo.empresas.set(c.id, c);
    }
  }
  return [...vendedores.entries()].sort(([a], [b]) => (a === 0) - (b === 0)).map(([,v]) => ({...v,
    contactos:[...v.contactos.values()].map(p=>({...p,telefonos:[...p.telefonos],empresas:[...p.empresas.values()]}))
      .sort((a,b)=>b.empresas.length-a.empresas.length || a.nombre.localeCompare(b.nombre, 'es'))}));
}

function renderGruposMaestro() {
  const vendedores = agruparEmpresasMaestro(clientesFiltradosMaestro());
  document.getElementById('gruposEmpresas').innerHTML = vendedores.map(v=>`<details open><summary><strong>${esc(v.nombre)}</strong> · ${v.clientes.size} empresas</summary>${v.contactos.map(p=>`<details style="margin:12px 20px"><summary>${esc(p.nombre)} ${esc(p.telefonos.join(' / '))} · ${p.empresas.length} empresas</summary><ul>${p.empresas.map(c=>`<li>${esc(c.razon_social)} · ${esc(c.nit)} · ${c.paquetes_vigentes||0} paquete(s) vigente(s) <button class="m-btn m-btn-secondary m-btn-sm" onclick="verServiciosCliente(${c.id})">Servicios</button></li>`).join('')}</ul></details>`).join('')}</details>`).join('') || '<p>No hay empresas para estos filtros.</p>';
}

async function cargarTarifasMaestro() {
  M.tarifas = M.tarifas || []; M.errorTarifas = '';
  if (!M.permisos.tarifas?.read) { M.errorTarifas='Tu perfil no tiene permiso para consultar tarifas.'; return; }
  try { M.tarifas = await api('/api/comercial/tarifas'); }
  catch(e) { M.errorTarifas=e.message; }
  renderServiciosMaestro();
}

function verServiciosCliente(id) {
  document.getElementById('serviciosCliente').value = id;
  maestrosTab('servicios'); renderServiciosMaestro();
}

function renderServiciosMaestro() {
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
