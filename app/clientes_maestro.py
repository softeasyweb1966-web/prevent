"""Reglas compartidas por el CRUD y la importación del maestro único."""
from collections import defaultdict
from hashlib import sha256
import re
import unicodedata

from sqlalchemy import text
from app.models import (db, ClienteComercial, ContactoCliente, ClienteImportacionFila,
                        Vendedor, SiigoCarga)


def texto(value):
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return ' '.join(str(value).split())


def normalizar(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', texto(value).upper()) if c.isalnum())


def identificacion(value):
    return normalizar(texto(value).split('-', 1)[0])


def bloquear_maestros():
    # Serializa comprobación y escritura también ante dos importaciones simultáneas.
    if db.engine.dialect.name == 'postgresql':
        db.session.execute(text('SELECT pg_advisory_xact_lock(6040040)'))


def validar_cliente(nit, nombre, excluir=None):
    bloquear_maestros()
    key = identificacion(nit)
    for item in ClienteComercial.query.all():
        if item.id == excluir:
            continue
        if key and identificacion(item.nit) == key:
            raise ValueError(f'Ya existe el cliente {item.razon_social} con esta identificación (ID {item.id}).')
        if normalizar(item.razon_social) == normalizar(nombre) and (not key or not item.nit):
            raise ValueError(f'Existe una ficha con ese nombre (ID {item.id}); complete esa ficha para evitar duplicados.')
    return key or None


def validar_paquete(nombre, excluir=None):
    bloquear_maestros()
    for item in __import__('app.models', fromlist=['ComercialCatalogoItem']).ComercialCatalogoItem.query.filter_by(tipo_item='PAQUETE'):
        if item.id != excluir and normalizar(item.nombre) == normalizar(nombre):
            raise ValueError('Ya existe un paquete con ese nombre. Edite el paquete existente.')


def clave_contacto(vendedor_id, nombre, telefono, email, aislado=None):
    medio = normalizar(telefono) or texto(email).lower()
    if not medio or vendedor_id is None:
        medio += f'|cliente:{aislado}'
    return sha256(f'{vendedor_id}|{normalizar(nombre)}|{medio}'.encode()).hexdigest()


def buscar_contacto(vendedor_id, nombre, telefono, email):
    matches = []
    for item in ContactoCliente.query.filter_by(vendedor_id=vendedor_id):
        if normalizar(item.nombre) != normalizar(nombre):
            continue
        if (telefono and normalizar(item.telefono) == normalizar(telefono)) or (email and texto(item.email).lower() == texto(email).lower()):
            matches.append(item)
    return matches


def vincular_contacto(cliente, nombre, telefono=None, email=None, cargo=None):
    if not texto(nombre):
        return None
    key = clave_contacto(cliente.vendedor_id, nombre, telefono, email, cliente.id)
    found = buscar_contacto(cliente.vendedor_id, nombre, telefono, email) if cliente.vendedor_id else []
    contacto = found[0] if len(found) == 1 else ContactoCliente.query.filter_by(clave=key).first()
    if contacto is None:
        contacto = ContactoCliente(nombre=texto(nombre), telefono=texto(telefono) or None,
                                   email=texto(email) or None, cargo=texto(cargo) or None,
                                   vendedor_id=cliente.vendedor_id, clave=key, activo=True)
        db.session.add(contacto)
    if contacto not in cliente.contactos:
        cliente.contactos.append(contacto)
    return contacto


def sincronizar_contacto_legacy(cliente):
    """Conserva los contactos capturados en la ficha anterior como relaciones."""
    vincular_contacto(cliente, cliente.contacto_principal, cliente.celular_contacto_principal,
                      cliente.email_contacto_principal, cliente.cargo_contacto_principal)
    vincular_contacto(cliente, cliente.contacto_facturacion, cliente.celular_facturacion,
                      cliente.email_facturacion, cliente.cargo_contacto_facturacion)


def cambiar_vendedor_cliente(cliente, vendedor_id, contactos=None):
    """Conserva los contactos del cliente sin reasignar los de otras empresas."""
    contactos = list(cliente.contactos if contactos is None else contactos)
    if cliente.vendedor_id == vendedor_id:
        cliente.contactos = contactos
        return
    cliente.contactos = []
    db.session.flush()
    cliente.vendedor_id = vendedor_id
    db.session.flush()
    for contacto in contactos:
        if contacto.vendedor_id == vendedor_id:
            cliente.contactos.append(contacto)
        else:
            vincular_contacto(cliente, contacto.nombre, contacto.telefono, contacto.email, contacto.cargo)


def preparar_filas(filas):
    requeridos = {'NOMBRETERCERO', 'IDENTIFICACION'}
    for index, fila in enumerate(filas):
        headers = [normalizar(x) for x in fila]
        if requeridos.issubset(headers):
            break
    else:
        raise ValueError('El Excel debe incluir Nombre tercero e Identificación.')
    grupos = defaultdict(list)
    for numero, fila in enumerate(filas[index + 1:], index + 2):
        if not any(texto(v) for v in fila):
            continue
        raw = {headers[i]: texto(v) for i, v in enumerate(fila) if i < len(headers) and headers[i]}
        nit = identificacion(raw.get('IDENTIFICACION'))
        if not nit or not raw.get('NOMBRETERCERO'):
            raise ValueError(f'Fila {numero}: falta identificación o nombre; no se aplicó la importación.')
        if len(nit) > 50 or len(raw['NOMBRETERCERO']) > 200:
            raise ValueError(f'Fila {numero}: identificación o nombre demasiado largo.')
        grupos[nit].append((numero, raw))
    if not grupos:
        raise ValueError('El Excel no contiene clientes.')
    return grupos


def conciliar_atenciones(aplicar=False):
    """Vincula solo coincidencias únicas; nunca reasigna clientes ya vinculados."""
    from app.models import AtencionDiaDetalle
    if aplicar:
        bloquear_maestros()
    lookup = defaultdict(set)
    clientes = {c.id: c for c in ClienteComercial.query.all()}
    for c in clientes.values():
        for value in (c.nit, c.razon_social, c.nombre_comercial, *(c.nombres_alternativos or [])):
            key = normalizar(value)
            if key:
                lookup[key].add(c.id)
    resumen = dict(pendientes=0, vinculables=0, ambiguas=0, sin_coincidencia=0,
                   vendedor_historico_distinto=0, vinculadas=0)
    query = AtencionDiaDetalle.query.filter(AtencionDiaDetalle.cliente_id.is_(None))
    if aplicar:
        query = query.with_for_update()
    for atencion in query:
        resumen['pendientes'] += 1
        candidatos = set()
        for value in (atencion.acuerdo_comercial, atencion.empresa_mision):
            candidatos.update(lookup.get(normalizar(value), set()))
        if not candidatos:
            resumen['sin_coincidencia'] += 1
        elif len(candidatos) != 1:
            resumen['ambiguas'] += 1
        else:
            cliente = clientes[next(iter(candidatos))]
            resumen['vinculables'] += 1
            if atencion.vendedor_id is not None and atencion.vendedor_id != cliente.vendedor_id:
                resumen['vendedor_historico_distinto'] += 1
            if aplicar:
                atencion.cliente_id = cliente.id
                if atencion.vendedor_id is None:
                    atencion.vendedor_id = cliente.vendedor_id
                resumen['vinculadas'] += 1
    if aplicar:
        db.session.flush()
    return resumen


def importar_clientes(filas, contenido, archivo, usuario_id=None, reemplazar=False):
    if reemplazar:
        raise ValueError('El maestro se actualiza conservando clientes y relaciones. El reemplazo destructivo no est? permitido.')
    grupos = preparar_filas(filas)
    bloquear_maestros()
    digest = sha256(contenido).hexdigest()
    previa = SiigoCarga.query.filter_by(hash_archivo=digest).first()
    if previa and ClienteImportacionFila.query.filter_by(carga_id=previa.id).count() == sum(map(len, grupos.values())):
        return {'sin_cambios': True, 'mensaje': 'El archivo ya está importado; no se duplicaron registros.', 'carga_id': previa.id}
    carga = previa or SiigoCarga(tipo_archivo='CLIENTES', nombre_archivo=archivo, hash_archivo=digest, usuario_id=usuario_id)
    db.session.add(carga)
    db.session.flush()
    actuales = ClienteComercial.query.all()
    por_nit = {identificacion(c.nit): c for c in actuales if c.nit}
    por_nombre = defaultdict(list)
    nombres_fuente = defaultdict(set)
    for c in actuales:
        por_nombre[normalizar(c.razon_social)].append(c)
    for nit, registros in grupos.items():
        for _, row in registros:
            nombres_fuente[normalizar(row['NOMBRETERCERO'])].add(nit)
    vendedores = Vendedor.query.all()
    vistos = set()
    resumen = dict(creados=0, actualizados=0, identificaciones=len(grupos), filas=sum(map(len, grupos.values())),
                   identificaciones_repetidas=0, revision=0, inactivados=0)
    for nit, registros in grupos.items():
        row = registros[0][1]
        nombres = list(dict.fromkeys(r['NOMBRETERCERO'] for _, r in registros))
        revision = []
        c = por_nit.get(nit)
        if c is None:
            candidatos = {x.id: x for nombre in nombres for x in por_nombre[normalizar(nombre)]
                          if not x.nit and len(nombres_fuente[normalizar(nombre)]) == 1 and x.id not in vistos}
            if len(candidatos) == 1:
                c = next(iter(candidatos.values()))
            elif candidatos:
                revision.append('Más de una ficha anterior coincide por nombre; revisar vínculos.')
        nuevo = c is None
        if nuevo:
            c = ClienteComercial(nit=nit, razon_social=row['NOMBRETERCERO'], medio_autorizacion='WHATSAPP')
            db.session.add(c)
            resumen['creados'] += 1
        else:
            resumen['actualizados'] += 1
            if c.razon_social not in nombres:
                nombres.append(c.razon_social)
        nombres_vendedor = list(dict.fromkeys(r.get('VENDEDOR') for _, r in registros if r.get('VENDEDOR')))
        vendedor = None
        if len(nombres_vendedor) == 1:
            key = normalizar(nombres_vendedor[0])
            exactos = [v for v in vendedores if normalizar(v.nombre) == key]
            candidatos = exactos  # No asignar por coincidencias parciales de nombres.
            if len(candidatos) == 1:
                vendedor = candidatos[0]
            elif len(candidatos) > 1:
                revision.append('Vendedor ambiguo: ' + nombres_vendedor[0])
            else:
                vendedor = Vendedor(nombre=nombres_vendedor[0], activo=True)
                db.session.add(vendedor)
                db.session.flush()
                vendedores.append(vendedor)
        elif len(nombres_vendedor) > 1:
            revision.append('Vendedores diferentes en filas del mismo NIT: ' + ', '.join(nombres_vendedor))
        # No descarta una asignación operativa preexistente si el Excel está vacío/ambiguo.
        if vendedor and c.vendedor_id != vendedor.id:
            if c.contactos:
                revision.append('Vendedor del Excel difiere del contacto vinculado; se conserva la asignación para revisión.')
            else:
                c.vendedor_id = vendedor.id
        c.vendedor_nombre_origen = ', '.join(nombres_vendedor) or None
        c.nit = nit
        c.razon_social = row['NOMBRETERCERO']
        c.nombres_alternativos = list(dict.fromkeys((c.nombres_alternativos or []) + nombres[1:]))
        for campo, header in [('tipo_identificacion', 'TIPODEIDENTIFICACION'), ('digito_verificacion', 'DIGITOVERIFICACION'),
                              ('direccion', 'DIRECCION'), ('ciudad', 'CIUDAD'), ('telefono_empresa', 'TELEFONO'),
                              ('regimen_iva', 'TIPODEREGIMENIVA')]:
            if row.get(header) or nuevo:
                setattr(c, campo, row.get(header) or None)
        c.sucursal = row.get('SUCURSAL') or '0'
        c.importado_siigo = True
        c.carga_id = carga.id
        c.estado_cliente = 'INACTIVO' if normalizar(row.get('ESTADO')) == 'INACTIVO' else 'ACTIVO'
        c.activo = c.estado_cliente == 'ACTIVO'
        if len(registros) > 1:
            resumen['identificaciones_repetidas'] += 1
            if len({normalizar(r['NOMBRETERCERO']) for _, r in registros}) > 1:
                revision.append('Un NIT con varios nombres: se conservan todas las filas y nombres alternativos.')
        db.session.flush()
        vistos.add(c.id)
        for numero, r in registros:
            db.session.add(ClienteImportacionFila(carga_id=carga.id, numero_fila=numero, cliente_id=c.id, datos=r))
            nombre = r.get('CONTACTO') or r.get('NOMBRESCONTACTO')
            telefono = r.get('TELEFONOCONTACTO')
            if nombre:
                vincular_contacto(c, nombre, telefono)
                if r.get('CONTACTO') or not c.contacto_principal:
                    c.contacto_principal = nombre
                    c.celular_contacto_principal = telefono or None
                # Campos adicionales del maestro: responsable y su telefono.
                if r.get('CONTACTO') or not c.responsable:
                    c.responsable = nombre
                    c.telefono_responsable = telefono or None
        c.revision_importacion = '\n'.join(revision) or None
        if revision:
            resumen['revision'] += 1
    # Los clientes creados en el aplicativo y los ausentes del Excel conservan
    # su estado, tarifas, contactos y movimientos.
    resumen['conservados_fuera_archivo'] = sum(c.id not in vistos for c in actuales)
    for c in actuales:
        sincronizar_contacto_legacy(c)
    carga.registros_leidos = resumen['filas']
    carga.registros_importados = len(grupos)
    carga.registros_omitidos = 0
    db.session.flush()
    return {**resumen, 'carga_id': carga.id}
