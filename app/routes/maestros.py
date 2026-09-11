"""CRUD del maestro único y contactos que comparten vendedor."""
from functools import wraps
from flask import jsonify, request, render_template
from flask_login import login_required
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from app.models import (db, ClienteComercial, ContactoCliente, ClienteImportacionFila,
                        ComercialCatalogoItem, ClienteComercialTarifa, Vendedor)
from app.clientes_maestro import (texto, normalizar, bloquear_maestros, validar_cliente,
                                  clave_contacto, buscar_contacto)
from app.routes import comercial_bp
from app.routes.comercial import (_require_commercial_permission, _is_admin_user,
    _resolver_vendedor_usuario_actual, _obtener_cliente_comercial_en_scope,
    _asegurar_cliente_en_scope, _has_commercial_permission)


def api(action):
    def decorate(fn):
        @wraps(fn)
        @login_required
        def wrapped(*args, **kwargs):
            try:
                _require_commercial_permission('clientes', action)
                if action != 'read':
                    bloquear_maestros()
                return fn(*args, **kwargs)
            except PermissionError as exc:
                db.session.rollback()
                return jsonify(error=str(exc)), 403
            except (ValueError, TypeError) as exc:
                db.session.rollback()
                return jsonify(error=str(exc)), 400
            except IntegrityError:
                db.session.rollback()
                return jsonify(error='El registro ya existe o tiene relaciones que impiden este cambio.'), 409
        return wrapped
    return decorate


def query_clientes():
    query = ClienteComercial.query
    if not _is_admin_user():
        vendedor = _resolver_vendedor_usuario_actual()
        query = query.filter(ClienteComercial.vendedor_id == vendedor.id) if vendedor else query.filter(text('false'))
    return query


def query_contactos():
    query = ContactoCliente.query
    if not _is_admin_user():
        vendedor = _resolver_vendedor_usuario_actual()
        query = query.filter(ContactoCliente.vendedor_id == vendedor.id) if vendedor else query.filter(text('false'))
    return query


def datos_cliente(c):
    return {**{key: getattr(c, key) for key in (
        'id', 'nit', 'razon_social', 'nombre_comercial', 'vendedor_id', 'ciudad', 'direccion',
        'telefono_empresa', 'email_empresa', 'tipo_identificacion', 'digito_verificacion', 'regimen_iva',
        'estado_cliente', 'activo', 'importado_siigo', 'revision_importacion', 'vendedor_nombre_origen',
        'nombres_alternativos', 'observaciones')},
        'vendedor_nombre': c.vendedor.nombre if c.vendedor else 'Sin asignar',
        'contactos_ids': [p.id for p in c.contactos],
        'contactos': [{'id': p.id, 'nombre': p.nombre, 'telefono': p.telefono, 'email': p.email} for p in c.contactos]}


def datos_contacto(c):
    return {**{key: getattr(c, key) for key in ('id', 'nombre', 'telefono', 'email', 'cargo', 'vendedor_id', 'activo')},
            'vendedor_nombre': c.vendedor.nombre if c.vendedor else 'Sin asignar',
            'clientes_ids': [x.id for x in c.clientes],
            'clientes': [{'id': x.id, 'nombre': x.razon_social, 'nit': x.nit} for x in c.clientes]}


def vendedor_permitido(value):
    vid = int(value) if value not in (None, '') else None
    if vid is not None and db.session.get(Vendedor, vid) is None:
        raise ValueError('El vendedor no existe.')
    if not _is_admin_user():
        vendedor = _resolver_vendedor_usuario_actual()
        if vendedor is None or vid != vendedor.id:
            raise PermissionError('Solo puede gestionar registros de su vendedor.')
    return vid


def lista_ids(value):
    if not isinstance(value, list):
        raise ValueError('Las relaciones deben enviarse como una lista de identificadores.')
    return list(dict.fromkeys(int(x) for x in value))


def validar_texto(data, campo, maximo, obligatorio=False):
    value = texto(data.get(campo))
    if obligatorio and not value:
        raise ValueError(f'El campo {campo} es obligatorio.')
    if len(value) > maximo:
        raise ValueError(f'{campo}: máximo {maximo} caracteres.')
    return value or None


def referencias_cliente(cid):
    result = {}
    inspector = inspect(db.engine)
    for tabla in inspector.get_table_names():
        for fk in inspector.get_foreign_keys(tabla):
            if fk['referred_table'] == 'clientes_comerciales':
                columna = fk['constrained_columns'][0]
                cantidad = db.session.execute(text(f'SELECT count(*) FROM "{tabla}" WHERE "{columna}"=:cid'), {'cid': cid}).scalar()
                if cantidad:
                    result[tabla] = cantidad
    return result


@comercial_bp.route('/maestros')
@api('read')
def pantalla_maestros():
    return render_template('maestros.html')


@comercial_bp.route('/maestro/opciones')
@api('read')
def opciones_maestros():
    vendedores = Vendedor.query.order_by(Vendedor.nombre).all() if _is_admin_user() else [_resolver_vendedor_usuario_actual()]
    return jsonify(vendedores=[{'id': v.id, 'nombre': v.nombre} for v in vendedores if v],
                   permisos={entity: {action: _has_commercial_permission(entity, action) for action in ('read', 'create', 'update', 'delete')}
                             for entity in ('clientes', 'paquetes', 'examenes', 'tarifas')})


@comercial_bp.route('/maestro/clientes')
@api('read')
def listar_clientes():
    return jsonify([datos_cliente(c) for c in query_clientes().order_by(ClienteComercial.razon_social)])


def guardar_cliente(cid=None):
    data = request.get_json() or {}
    c = _obtener_cliente_comercial_en_scope(cid) if cid else ClienteComercial()
    nombre = validar_texto(data, 'razon_social', 200, True)
    nit = validar_texto(data, 'nit', 50, not bool(cid))
    c.nit = validar_cliente(nit, nombre, cid)
    vid = vendedor_permitido(data.get('vendedor_id', c.vendedor_id))
    contactos = c.contactos
    if 'contactos_ids' in data:
        contactos = [query_contactos().filter_by(id=pk).first_or_404() for pk in lista_ids(data['contactos_ids'])]
    if any(p.vendedor_id != vid for p in contactos):
        raise ValueError('Todos los contactos y la empresa deben tener el mismo vendedor. Desvincule primero los contactos de otro vendedor.')
    if vid is None and any(any(x.id != cid for x in p.clientes) for p in contactos):
        raise ValueError('Asigne vendedor antes de compartir un contacto entre empresas.')
    if cid and vid != c.vendedor_id:
        c.contactos = []
        db.session.flush()
    c.vendedor_id = vid
    c.razon_social = nombre
    for campo, limite in [('nombre_comercial', 200), ('ciudad', 120), ('direccion', 255), ('telefono_empresa', 80),
                          ('email_empresa', 120), ('tipo_identificacion', 30), ('digito_verificacion', 10),
                          ('regimen_iva', 80), ('observaciones', 10000)]:
        if campo in data:
            setattr(c, campo, validar_texto(data, campo, limite))
    estado = data.get('estado_cliente', c.estado_cliente or 'ACTIVO')
    if estado not in {'ACTIVO', 'INACTIVO', 'BLOQUEO_TEMPORAL'}:
        raise ValueError('Estado de cliente inválido.')
    c.estado_cliente = estado
    c.activo = estado != 'INACTIVO'
    db.session.add(c)
    db.session.flush()
    c.contactos = contactos
    # Compatibilidad para documentos y pantallas anteriores.
    principal = contactos[0] if contactos else None
    c.contacto_principal = principal.nombre if principal else None
    c.celular_contacto_principal = principal.telefono if principal else None
    c.email_contacto_principal = principal.email if principal else None
    db.session.commit()
    return jsonify(datos_cliente(c)), 200 if cid else 201


@comercial_bp.route('/maestro/clientes', methods=['POST'])
@api('create')
def nuevo_cliente():
    return guardar_cliente()


@comercial_bp.route('/maestro/clientes/<int:cid>', methods=['PUT'])
@api('update')
def editar_cliente(cid):
    return guardar_cliente(cid)


@comercial_bp.route('/maestro/clientes/<int:cid>', methods=['DELETE'])
@api('delete')
def borrar_cliente(cid):
    c = _obtener_cliente_comercial_en_scope(cid)
    relaciones = referencias_cliente(cid)
    if relaciones:
        return jsonify(error='El cliente tiene relaciones. Puede inactivarlo sin perder su historial.', relaciones=relaciones), 409
    db.session.delete(c)
    db.session.commit()
    return jsonify(mensaje='Cliente eliminado.')


@comercial_bp.route('/maestro/clientes/<int:cid>/origen')
@api('read')
def origen_cliente(cid):
    _obtener_cliente_comercial_en_scope(cid)
    return jsonify([{'carga_id': x.carga_id, 'fila': x.numero_fila, 'datos': x.datos}
                    for x in ClienteImportacionFila.query.filter_by(cliente_id=cid).order_by(ClienteImportacionFila.id)])


@comercial_bp.route('/maestro/contactos')
@api('read')
def listar_contactos():
    return jsonify([datos_contacto(c) for c in query_contactos().order_by(ContactoCliente.nombre)])


def guardar_contacto(pk=None):
    data = request.get_json() or {}
    c = query_contactos().filter_by(id=pk).first_or_404() if pk else ContactoCliente()
    nombre = validar_texto(data, 'nombre', 150, True)
    telefono = validar_texto(data, 'telefono', 80)
    email = validar_texto(data, 'email', 120)
    vid = vendedor_permitido(data.get('vendedor_id'))
    clientes = [_obtener_cliente_comercial_en_scope(cid) for cid in lista_ids(data.get('clientes_ids', []))]
    if any(x.vendedor_id != vid for x in clientes):
        raise ValueError('Las empresas del contacto deben tener el mismo vendedor.')
    if vid is None and len(clientes) > 1:
        raise ValueError('Asigne vendedor antes de agrupar empresas.')
    if not telefono and not email and not pk:
        raise ValueError('Indique teléfono o correo para identificar al contacto y evitar duplicados.')
    coincidencias = [x for x in buscar_contacto(vid, nombre, telefono, email) if x.id != pk]
    if coincidencias:
        raise ValueError(f'El contacto ya existe (ID {coincidencias[0].id}). Vincule las empresas a ese registro.')
    if pk and vid != c.vendedor_id:
        c.clientes = []
        db.session.flush()
    anterior = (c.nombre, c.telefono, c.email)
    c.nombre, c.telefono, c.email, c.vendedor_id = nombre, telefono, email, vid
    c.cargo = validar_texto(data, 'cargo', 150)
    if not isinstance(data.get('activo', True), bool):
        raise ValueError('Activo debe ser verdadero o falso.')
    c.activo = data.get('activo', True)
    c.clave = clave_contacto(vid, nombre, telefono, email, clientes[0].id if clientes else pk)
    db.session.add(c)
    db.session.flush()
    anteriores = list(c.clientes)
    c.clientes = clientes
    for x in anteriores:
        if (x.contacto_principal, x.celular_contacto_principal, x.email_contacto_principal) == anterior:
            x.contacto_principal = nombre if x in clientes else None
            x.celular_contacto_principal = telefono if x in clientes else None
            x.email_contacto_principal = email if x in clientes else None
    db.session.commit()
    return jsonify(datos_contacto(c)), 200 if pk else 201


@comercial_bp.route('/maestro/contactos', methods=['POST'])
@api('create')
def nuevo_contacto():
    return guardar_contacto()


@comercial_bp.route('/maestro/contactos/<int:pk>', methods=['PUT'])
@api('update')
def editar_contacto(pk):
    return guardar_contacto(pk)


@comercial_bp.route('/maestro/contactos/<int:pk>', methods=['DELETE'])
@api('delete')
def borrar_contacto(pk):
    c = query_contactos().filter_by(id=pk).first_or_404()
    if c.clientes:
        return jsonify(error='Desvincule las empresas o inactive el contacto antes de eliminarlo.'), 409
    db.session.delete(c)
    db.session.commit()
    return jsonify(mensaje='Contacto eliminado.')
