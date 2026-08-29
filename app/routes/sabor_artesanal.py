import logging
import json
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from flask import jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import func, inspect, or_, text
from sqlalchemy.orm import selectinload

from app.models import (
    SaborArtesanalMenu,
    SaborArtesanalMenuCategoria,
    SaborArtesanalMenuComponente,
    SaborArtesanalMenuDia,
    SaborArtesanalPedido,
    SaborArtesanalTablaItem,
    db,
)
from app.routes import sabor_artesanal_bp

logger = logging.getLogger(__name__)

SABOR_ARTESANAL_CATEGORIAS = {
    'entradas': 'Entradas',
    'principios': 'Principios',
    'proteinas': 'Proteinas',
    'parrillas': 'Parrillas',
    'basicos': 'Basicos',
    'acompanamientos': 'Acompanamientos',
    'ensaladas': 'Ensaladas',
    'bebidas_frias': 'Bebidas Frias',
    'bebidas_calientes': 'Bebidas Calientes',
    'paquetes': 'Paquetes',
    'adicionales': 'Adicionales',
}

SABOR_ARTESANAL_PRINCIPIOS_GRUPOS = (
    ('granos', 'Granos'),
    ('verduras', 'Verduras'),
)

SABOR_ARTESANAL_PRINCIPIOS_OPCIONES_ESPECIALES = (
    ('mixto', 'Mixto'),
)

SABOR_ARTESANAL_MENU_CATEGORIAS_BASE = (
    {
        'codigo': 'desayunos',
        'nombre': 'Desayunos',
        'descripcion': 'Menus planeados para desayuno.',
        'orden': 10,
    },
    {
        'codigo': 'almuerzos',
        'nombre': 'Almuerzos',
        'descripcion': 'Menus planeados para almuerzo.',
        'orden': 20,
    },
    {
        'codigo': 'parrillas',
        'nombre': 'Parrillas',
        'descripcion': 'Menus especiales para parrilla o dobles porciones.',
        'orden': 30,
    },
    {
        'codigo': 'especiales',
        'nombre': 'Especiales',
        'descripcion': 'Menus especiales del restaurante.',
        'orden': 40,
    },
)

SABOR_ARTESANAL_TABLAS_CON_PRECIO = {
    'parrillas',
    'bebidas_frias',
    'bebidas_calientes',
    'paquetes',
    'adicionales',
}

SABOR_ARTESANAL_MENU_CATEGORIAS_CON_PRECIO = {
    'desayunos',
    'almuerzos',
    'parrillas',
    'especiales',
}

SABOR_ARTESANAL_MENU_MAX_PROTEINAS = 5

SABOR_ARTESANAL_PEDIDO_ESTADOS = {
    'ABIERTO',
    'FINALIZADO',
    'COBRADO',
}

SABOR_ARTESANAL_PEDIDO_MODOS_ENTREGA = {
    'SERVIDO',
    'ICOPOR',
    'DOMICILIO',
}

SABOR_ARTESANAL_PEDIDO_FORMAS_PAGO = {
    'EFECTIVO',
    'TRANSFERENCIA',
    'NEQUI',
    'DAVIPLATA',
    'MIXTO',
    'OTRO',
}

SABOR_ARTESANAL_MENU_BLOQUES_BASE = (
    {
        'codigo': 'entradas',
        'label': 'Sopa',
        'selector_tipo': 'single',
    },
    {
        'codigo': 'principios',
        'label': 'Principio',
        'selector_tipo': 'single',
    },
    {
        'codigo': 'proteinas',
        'label': 'Proteina',
        'selector_tipo': 'single',
    },
    {
        'codigo': 'ensaladas',
        'label': 'Ensaladas',
        'selector_tipo': 'multi',
    },
    {
        'codigo': 'complementos',
        'label': 'Complementos',
        'selector_tipo': 'multi',
    },
)


def _normalizar_categoria(valor):
    clave = (valor or '').strip().lower()
    if clave == 'poroteinas':
        clave = 'proteinas'
    return clave if clave in SABOR_ARTESANAL_CATEGORIAS else None


def _parse_bool(valor, default=True):
    if valor is None:
        return default
    if isinstance(valor, bool):
        return valor
    return str(valor).strip().lower() in {'1', 'true', 't', 'si', 'yes', 'y', 'on'}


def _slugify(value):
    raw = re.sub(r'[^a-z0-9]+', '-', (value or '').strip().lower())
    return raw.strip('-')


def _parse_decimal(valor, default=None):
    if valor in (None, ''):
        return default
    try:
        normalized = str(valor).strip().replace(',', '.')
        return Decimal(normalized)
    except (InvalidOperation, ValueError, TypeError):
        return None


def _parse_date(valor):
    if valor in (None, ''):
        return None
    if isinstance(valor, date):
        return valor
    try:
        return datetime.strptime(str(valor).strip(), '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return None


def _decimal_to_float(valor):
    return float(valor) if valor is not None else None


def _decimal_to_text(valor):
    if valor is None:
        return None
    return str(valor.quantize(Decimal('0.01')))


def _normalize_pedido_estado(valor, default='ABIERTO'):
    estado = (valor or default or 'ABIERTO').strip().upper()
    return estado if estado in SABOR_ARTESANAL_PEDIDO_ESTADOS else default


def _normalize_pedido_modo_entrega(valor, default='SERVIDO'):
    modo = (valor or default or 'SERVIDO').strip().upper()
    return modo if modo in SABOR_ARTESANAL_PEDIDO_MODOS_ENTREGA else default


def _normalize_pedido_forma_pago(valor, default='EFECTIVO'):
    forma = (valor or default or 'EFECTIVO').strip().upper()
    return forma if forma in SABOR_ARTESANAL_PEDIDO_FORMAS_PAGO else None


def _ensure_sabor_artesanal_schema():
    inspector = inspect(db.engine)
    models = (
        SaborArtesanalTablaItem,
        SaborArtesanalMenuCategoria,
        SaborArtesanalMenu,
        SaborArtesanalMenuComponente,
        SaborArtesanalMenuDia,
        SaborArtesanalPedido,
    )
    for model in models:
        if not inspector.has_table(model.__tablename__):
            model.__table__.create(bind=db.engine, checkfirst=True)

    current_columns = {
        SaborArtesanalTablaItem.__tablename__: {column['name'] for column in inspector.get_columns(SaborArtesanalTablaItem.__tablename__)},
        SaborArtesanalMenu.__tablename__: {column['name'] for column in inspector.get_columns(SaborArtesanalMenu.__tablename__)},
        SaborArtesanalMenuComponente.__tablename__: {column['name'] for column in inspector.get_columns(SaborArtesanalMenuComponente.__tablename__)},
    }

    if 'precio_venta' not in current_columns[SaborArtesanalTablaItem.__tablename__]:
        db.session.execute(
            text('ALTER TABLE sabor_artesanal_tabla_items ADD COLUMN precio_venta NUMERIC(15, 2)')
        )
        db.session.commit()

    if 'precio_venta' not in current_columns[SaborArtesanalMenu.__tablename__]:
        db.session.execute(
            text('ALTER TABLE sabor_artesanal_menus ADD COLUMN precio_venta NUMERIC(15, 2)')
        )
        db.session.commit()

    component_columns = current_columns[SaborArtesanalMenuComponente.__tablename__]
    component_schema_updates = (
        ('bloque_codigo', 'ALTER TABLE sabor_artesanal_menu_componentes ADD COLUMN bloque_codigo VARCHAR(40)'),
        ('bloque_label', 'ALTER TABLE sabor_artesanal_menu_componentes ADD COLUMN bloque_label VARCHAR(120)'),
        ('selector_tipo', "ALTER TABLE sabor_artesanal_menu_componentes ADD COLUMN selector_tipo VARCHAR(20) DEFAULT 'single'"),
        ('grupo_codigo', 'ALTER TABLE sabor_artesanal_menu_componentes ADD COLUMN grupo_codigo VARCHAR(40)'),
        ('grupo_label', 'ALTER TABLE sabor_artesanal_menu_componentes ADD COLUMN grupo_label VARCHAR(120)'),
        ('seleccion_default', 'ALTER TABLE sabor_artesanal_menu_componentes ADD COLUMN seleccion_default BOOLEAN'),
        ('presentacion', 'ALTER TABLE sabor_artesanal_menu_componentes ADD COLUMN presentacion VARCHAR(160)'),
        ('acompanamiento', 'ALTER TABLE sabor_artesanal_menu_componentes ADD COLUMN acompanamiento VARCHAR(160)'),
    )
    for column_name, statement in component_schema_updates:
        if column_name not in component_columns:
            db.session.execute(text(statement))
            db.session.commit()


def _es_categoria_principios(categoria):
    return (categoria or '').strip().lower() == 'principios'


def _es_principio_grupo_fijo(nombre):
    normalized = (nombre or '').strip().lower()
    return any(normalized == key for key, _label in SABOR_ARTESANAL_PRINCIPIOS_GRUPOS)


def _es_principio_opcion_especial(nombre):
    normalized = (nombre or '').strip().lower()
    return any(normalized == key for key, _label in SABOR_ARTESANAL_PRINCIPIOS_OPCIONES_ESPECIALES)


def _categoria_tabla_requiere_precio(categoria):
    return (categoria or '').strip().lower() in SABOR_ARTESANAL_TABLAS_CON_PRECIO


def _categoria_menu_requiere_precio(categoria_menu):
    codigo = getattr(categoria_menu, 'codigo', categoria_menu) or ''
    return str(codigo).strip().lower() in SABOR_ARTESANAL_MENU_CATEGORIAS_CON_PRECIO


def _menu_bloque_por_codigo(codigo):
    normalized = _slugify(codigo)
    for block in SABOR_ARTESANAL_MENU_BLOQUES_BASE:
        if block['codigo'] == normalized:
            return block
    return None


def _resolver_meta_bloque_menu(tabla_categoria, parent_nombre=None, bloque_codigo=None, bloque_label=None, selector_tipo=None):
    normalized_block = _slugify(bloque_codigo) if bloque_codigo else ''
    normalized_category = (tabla_categoria or '').strip().lower()

    if normalized_block:
        base = _menu_bloque_por_codigo(normalized_block)
        return {
            'bloque_codigo': normalized_block,
            'bloque_label': (bloque_label or (base['label'] if base else normalized_block.replace('-', ' ').title())).strip(),
            'selector_tipo': (selector_tipo or (base['selector_tipo'] if base else 'single')).strip().lower() or 'single',
        }

    if normalized_category == 'entradas':
        return {'bloque_codigo': 'entradas', 'bloque_label': 'Sopa', 'selector_tipo': 'single'}
    if normalized_category == 'principios':
        return {'bloque_codigo': 'principios', 'bloque_label': 'Principio', 'selector_tipo': 'single'}
    if normalized_category == 'proteinas':
        return {'bloque_codigo': 'proteinas', 'bloque_label': 'Proteina', 'selector_tipo': 'single'}
    if normalized_category == 'ensaladas':
        return {'bloque_codigo': 'ensaladas', 'bloque_label': 'Ensaladas', 'selector_tipo': 'multi'}
    if normalized_category in {'basicos', 'acompanamientos', 'ensaladas', 'bebidas_frias', 'bebidas_calientes', 'adicionales'}:
        return {'bloque_codigo': 'complementos', 'bloque_label': 'Complementos', 'selector_tipo': 'multi'}

    fallback_label = SABOR_ARTESANAL_CATEGORIAS.get(normalized_category, normalized_category.title())
    return {
        'bloque_codigo': normalized_category or 'otros',
        'bloque_label': bloque_label or fallback_label,
        'selector_tipo': selector_tipo or 'single',
    }


def _resolver_grupo_menu(tabla_categoria, parent, raw_group_code=None, raw_group_label=None):
    if raw_group_code or raw_group_label:
        return (
            _slugify(raw_group_code or raw_group_label),
            (raw_group_label or raw_group_code or '').strip() or None,
        )

    if (tabla_categoria or '').strip().lower() == 'principios':
        parent_name = (parent.nombre if parent else '') or ''
        normalized_parent = _slugify(parent_name)
        for key, label in SABOR_ARTESANAL_PRINCIPIOS_GRUPOS:
            if normalized_parent == key:
                return key, label
        if parent_name:
            return normalized_parent or None, parent_name

    if parent and parent.nombre:
        return _slugify(parent.nombre), parent.nombre

    return None, None


def _agrupar_componentes_menu_por_bloque(componentes):
    grouped = []
    seen = {}
    for component in componentes:
        component_payload = _serialize_menu_componente(component)
        block_code = component_payload['bloque_codigo']
        if block_code not in seen:
            block_payload = {
                'codigo': block_code,
                'label': component_payload['bloque_label'],
                'selector_tipo': component_payload['selector_tipo'],
                'orden': component_payload['orden'],
                'opciones': [],
            }
            seen[block_code] = block_payload
            grouped.append(block_payload)
        seen[block_code]['opciones'].append(component_payload)

    for block in grouped:
        block['opciones'] = sorted(block['opciones'], key=lambda item: (item.get('orden', 0), item.get('id', 0)))
    return grouped


def _ensure_principios_base_items():
    created = False
    for key, label in SABOR_ARTESANAL_PRINCIPIOS_GRUPOS:
        existing = (
            SaborArtesanalTablaItem.query.filter(
                SaborArtesanalTablaItem.categoria == 'principios',
                func.lower(SaborArtesanalTablaItem.nombre) == key,
                SaborArtesanalTablaItem.parent_id.is_(None),
            )
            .first()
        )
        if existing:
            if existing.nombre != label:
                existing.nombre = label
                created = True
            continue

        db.session.add(SaborArtesanalTablaItem(
            categoria='principios',
            nombre=label,
            descripcion=None,
            parent_id=None,
            activo=True,
            usuario_id=getattr(current_user, 'id', None),
        ))
        created = True

    for key, label in SABOR_ARTESANAL_PRINCIPIOS_OPCIONES_ESPECIALES:
        existing = (
            SaborArtesanalTablaItem.query.filter(
                SaborArtesanalTablaItem.categoria == 'principios',
                func.lower(SaborArtesanalTablaItem.nombre) == key,
                SaborArtesanalTablaItem.parent_id.is_(None),
            )
            .first()
        )
        if existing:
            if existing.nombre != label:
                existing.nombre = label
                created = True
            continue

        db.session.add(SaborArtesanalTablaItem(
            categoria='principios',
            nombre=label,
            descripcion='Combina grano y verdura en un solo principio.',
            parent_id=None,
            activo=True,
            usuario_id=getattr(current_user, 'id', None),
        ))
        created = True

    if created:
        db.session.commit()


def _ensure_menu_base_categories():
    created = False
    updated = False

    for default_category in SABOR_ARTESANAL_MENU_CATEGORIAS_BASE:
        existing = SaborArtesanalMenuCategoria.query.filter(
            func.lower(SaborArtesanalMenuCategoria.codigo) == default_category['codigo']
        ).first()
        if existing is None:
            db.session.add(SaborArtesanalMenuCategoria(
                codigo=default_category['codigo'],
                nombre=default_category['nombre'],
                descripcion=default_category['descripcion'],
                orden=default_category['orden'],
                activo=True,
                usuario_id=getattr(current_user, 'id', None),
            ))
            created = True
            continue

        if existing.nombre != default_category['nombre']:
            existing.nombre = default_category['nombre']
            updated = True
        if not existing.descripcion:
            existing.descripcion = default_category['descripcion']
            updated = True
        if existing.orden != default_category['orden']:
            existing.orden = default_category['orden']
            updated = True

    if created or updated:
        db.session.commit()


def _serialize_sabor_item(item):
    hijos = sorted(
        list(item.children or []),
        key=lambda child: ((child.nombre or '').strip().lower(), child.id),
    )
    return {
        'id': item.id,
        'categoria': item.categoria,
        'categoria_label': SABOR_ARTESANAL_CATEGORIAS.get(item.categoria, item.categoria),
        'nombre': item.nombre,
        'descripcion': item.descripcion,
        'parent_id': item.parent_id,
        'parent_nombre': item.parent.nombre if item.parent else None,
        'activo': bool(item.activo),
        'precio_venta': _decimal_to_float(item.precio_venta),
        'precio_venta_texto': _decimal_to_text(item.precio_venta),
        'requiere_precio_venta': _categoria_tabla_requiere_precio(item.categoria),
        'created_at': item.created_at.isoformat() if item.created_at else None,
        'updated_at': item.updated_at.isoformat() if item.updated_at else None,
        'children': [
            {
                'id': child.id,
                'categoria': child.categoria,
                'nombre': child.nombre,
                'descripcion': child.descripcion,
                'parent_id': child.parent_id,
                'parent_nombre': item.nombre,
                'activo': bool(child.activo),
                'precio_venta': _decimal_to_float(child.precio_venta),
                'precio_venta_texto': _decimal_to_text(child.precio_venta),
                'requiere_precio_venta': _categoria_tabla_requiere_precio(child.categoria),
                'created_at': child.created_at.isoformat() if child.created_at else None,
                'updated_at': child.updated_at.isoformat() if child.updated_at else None,
            }
            for child in hijos
        ],
        'children_count': len(hijos),
    }


def _serialize_menu_categoria(categoria):
    return {
        'id': categoria.id,
        'codigo': categoria.codigo,
        'nombre': categoria.nombre,
        'descripcion': categoria.descripcion,
        'orden': categoria.orden,
        'activo': bool(categoria.activo),
        'menus_count': categoria.menus.count(),
        'programaciones_count': categoria.programaciones.count(),
        'created_at': categoria.created_at.isoformat() if categoria.created_at else None,
        'updated_at': categoria.updated_at.isoformat() if categoria.updated_at else None,
    }


def _serialize_menu_componente(componente):
    principal_nombre = (
        componente.principal_nombre
        or (componente.parent.nombre if componente.parent else None)
        or (componente.item.nombre if componente.item else None)
    )
    item_nombre = componente.item_nombre or (componente.item.nombre if componente.item else None)
    cantidad = componente.cantidad if componente.cantidad is not None else Decimal('0')
    block_meta = _resolver_meta_bloque_menu(
        componente.tabla_categoria,
        parent_nombre=principal_nombre,
        bloque_codigo=getattr(componente, 'bloque_codigo', None),
        bloque_label=getattr(componente, 'bloque_label', None),
        selector_tipo=getattr(componente, 'selector_tipo', None),
    )
    group_code, group_label = _resolver_grupo_menu(
        componente.tabla_categoria,
        componente.parent,
        raw_group_code=getattr(componente, 'grupo_codigo', None),
        raw_group_label=getattr(componente, 'grupo_label', None),
    )
    return {
        'id': componente.id,
        'tabla_categoria': componente.tabla_categoria,
        'tabla_label': SABOR_ARTESANAL_CATEGORIAS.get(componente.tabla_categoria, componente.tabla_categoria),
        'tabla_item_id': componente.tabla_item_id,
        'parent_item_id': componente.parent_item_id,
        'principal_nombre': principal_nombre,
        'item_nombre': item_nombre,
        'descripcion': componente.descripcion,
        'bloque_codigo': block_meta['bloque_codigo'],
        'bloque_label': block_meta['bloque_label'],
        'selector_tipo': block_meta['selector_tipo'],
        'grupo_codigo': group_code,
        'grupo_label': group_label,
        'seleccion_default': bool(getattr(componente, 'seleccion_default', False)),
        'cantidad': float(cantidad),
        'cantidad_texto': str(cantidad.normalize()) if cantidad != cantidad.to_integral() else str(int(cantidad)),
        'unidad': componente.unidad,
        'presentacion': getattr(componente, 'presentacion', None),
        'acompanamiento': getattr(componente, 'acompanamiento', None),
        'orden': componente.orden,
        'observaciones': componente.observaciones,
    }


def _serialize_programacion(programacion):
    return {
        'id': programacion.id,
        'fecha_servicio': programacion.fecha_servicio.isoformat() if programacion.fecha_servicio else None,
        'categoria_id': programacion.categoria_id,
        'categoria_codigo': programacion.categoria_menu_programada.codigo if programacion.categoria_menu_programada else None,
        'categoria_nombre': programacion.categoria_menu_programada.nombre if programacion.categoria_menu_programada else None,
        'menu_id': programacion.menu_id,
        'menu_nombre': programacion.menu.nombre if programacion.menu else None,
        'menu_activo': bool(programacion.menu.activo) if programacion.menu else False,
        'observaciones': programacion.observaciones,
        'created_at': programacion.created_at.isoformat() if programacion.created_at else None,
        'updated_at': programacion.updated_at.isoformat() if programacion.updated_at else None,
    }


def _serialize_menu(menu, include_programaciones=True):
    componentes = sorted(
        list(menu.componentes or []),
        key=lambda item: (item.orden, item.id),
    )
    bloques = _agrupar_componentes_menu_por_bloque(componentes)
    payload = {
        'id': menu.id,
        'categoria_id': menu.categoria_id,
        'categoria_codigo': menu.categoria_menu.codigo if menu.categoria_menu else None,
        'categoria_nombre': menu.categoria_menu.nombre if menu.categoria_menu else None,
        'nombre': menu.nombre,
        'descripcion': menu.descripcion,
        'instrucciones': menu.instrucciones,
        'precio_venta': _decimal_to_float(menu.precio_venta),
        'precio_venta_texto': _decimal_to_text(menu.precio_venta),
        'requiere_precio_venta': _categoria_menu_requiere_precio(menu.categoria_menu),
        'activo': bool(menu.activo),
        'componentes': [_serialize_menu_componente(componente) for componente in componentes],
        'componentes_count': len(componentes),
        'bloques': bloques,
        'bloques_count': len(bloques),
        'created_at': menu.created_at.isoformat() if menu.created_at else None,
        'updated_at': menu.updated_at.isoformat() if menu.updated_at else None,
    }
    if include_programaciones:
        payload['programaciones'] = [_serialize_programacion(item) for item in list(menu.programaciones or [])]
    return payload


def _pedido_snapshot_from_record(pedido):
    raw = getattr(pedido, 'detalle_json', None) or '{}'
    try:
        snapshot = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        snapshot = {}

    if not isinstance(snapshot, dict):
        snapshot = {}

    guests = snapshot.get('guests')
    if not isinstance(guests, list) or len(guests) == 0:
        guests = [{
            'id': 1,
            'label': '1',
            'items': [],
            'observacion': '',
        }]

    snapshot['guests'] = guests
    snapshot['orderMeta'] = {
        'fecha_servicio': pedido.fecha_servicio.isoformat() if pedido.fecha_servicio else snapshot.get('orderMeta', {}).get('fecha_servicio'),
        'mesa': pedido.mesa or snapshot.get('orderMeta', {}).get('mesa') or '',
        'cliente': pedido.cliente or snapshot.get('orderMeta', {}).get('cliente') or '',
        'modo_entrega': pedido.modo_entrega or snapshot.get('orderMeta', {}).get('modo_entrega') or 'SERVIDO',
    }
    snapshot['selectedCategory'] = snapshot.get('selectedCategory') or 'almuerzos'
    snapshot['selectedMenus'] = snapshot.get('selectedMenus') if isinstance(snapshot.get('selectedMenus'), dict) else {}
    return snapshot


def _serialize_pedido(pedido):
    snapshot = _pedido_snapshot_from_record(pedido)
    return {
        'id': pedido.id,
        'codigo': pedido.codigo,
        'fecha_servicio': pedido.fecha_servicio.isoformat() if pedido.fecha_servicio else None,
        'mesa': pedido.mesa,
        'cliente': pedido.cliente,
        'modo_entrega': pedido.modo_entrega,
        'estado': pedido.estado,
        'items_count': int(pedido.items_count or 0),
        'comensales_count': int(pedido.comensales_count or 0),
        'total': _decimal_to_float(pedido.total),
        'total_texto': _decimal_to_text(pedido.total),
        'finalizado_at': pedido.finalizado_at.isoformat() if pedido.finalizado_at else None,
        'cobrado_at': pedido.cobrado_at.isoformat() if pedido.cobrado_at else None,
        'forma_pago': pedido.forma_pago,
        'valor_pagado': _decimal_to_float(pedido.valor_pagado),
        'valor_pagado_texto': _decimal_to_text(pedido.valor_pagado),
        'pago_referencia': pedido.pago_referencia,
        'pago_observaciones': pedido.pago_observaciones,
        'created_at': pedido.created_at.isoformat() if pedido.created_at else None,
        'updated_at': pedido.updated_at.isoformat() if pedido.updated_at else None,
        'snapshot': snapshot,
    }


def _build_pedido_codigo(pedido_id, fecha_servicio):
    fecha = fecha_servicio or date.today()
    return f'SA-{fecha.strftime("%Y%m%d")}-{int(pedido_id):04d}'


def _validate_pedido_payload(data):
    if not isinstance(data, dict):
        return None, 'El pedido enviado no tiene un formato valido.'

    fecha_servicio = _parse_date(data.get('fecha_servicio'))
    if fecha_servicio is None:
        return None, 'Debes seleccionar una fecha valida para el pedido.'

    mesa = str(data.get('mesa') or '').strip()
    if not mesa:
        return None, 'Debes indicar la mesa o numero del pedido.'

    cliente = str(data.get('cliente') or '').strip() or None
    modo_entrega = _normalize_pedido_modo_entrega(data.get('modo_entrega'))
    selected_category = str(data.get('selectedCategory') or 'almuerzos').strip().lower() or 'almuerzos'
    raw_selected_menus = data.get('selectedMenus') if isinstance(data.get('selectedMenus'), dict) else {}
    selected_menus = {
        str(key).strip(): str(value).strip()
        for key, value in raw_selected_menus.items()
        if str(key).strip() and str(value).strip()
    }

    raw_guests = data.get('guests')
    if not isinstance(raw_guests, list) or len(raw_guests) == 0:
        raw_guests = [{'id': 1, 'label': '1', 'items': [], 'observacion': ''}]

    guests = []
    total = Decimal('0')
    items_count = 0

    for guest_index, raw_guest in enumerate(raw_guests):
        if not isinstance(raw_guest, dict):
            return None, f'El comensal #{guest_index + 1} no tiene un formato valido.'

        try:
            guest_id = int(raw_guest.get('id') or (guest_index + 1))
        except (TypeError, ValueError):
            guest_id = guest_index + 1

        label = str(raw_guest.get('label') or guest_id).strip() or str(guest_id)
        observacion = str(raw_guest.get('observacion') or '').strip()
        raw_items = raw_guest.get('items')
        if not isinstance(raw_items, list):
            raw_items = []

        items = []
        for item_index, raw_item in enumerate(raw_items):
            if not isinstance(raw_item, dict):
                return None, f'El item #{item_index + 1} del comensal {label} no es valido.'

            title = str(raw_item.get('title') or '').strip()
            if not title:
                return None, f'Uno de los productos del comensal {label} no tiene nombre.'

            try:
                qty = int(raw_item.get('qty') or 1)
            except (TypeError, ValueError):
                return None, f'La cantidad de "{title}" en el comensal {label} no es valida.'
            if qty <= 0:
                return None, f'La cantidad de "{title}" en el comensal {label} debe ser mayor a cero.'

            price = _parse_decimal(raw_item.get('price'), default=Decimal('0'))
            if price is None or price < 0:
                return None, f'El precio de "{title}" en el comensal {label} no es valido.'

            components_summary = raw_item.get('components_summary') if isinstance(raw_item.get('components_summary'), list) else []
            normalized_components = [str(line).strip() for line in components_summary if str(line).strip()]

            item_payload = {
                'line_id': str(raw_item.get('line_id') or f'pedido-item-{guest_id}-{item_index + 1}').strip(),
                'option_id': str(raw_item.get('option_id') or '').strip() or None,
                'ref_id': raw_item.get('ref_id'),
                'category_key': str(raw_item.get('category_key') or '').strip() or None,
                'category_label': str(raw_item.get('category_label') or '').strip() or None,
                'title': title[:160],
                'subtitle': str(raw_item.get('subtitle') or '').strip() or None,
                'detail': str(raw_item.get('detail') or '').strip() or None,
                'components_summary': normalized_components,
                'source_type': str(raw_item.get('source_type') or '').strip() or None,
                'builder_signature': str(raw_item.get('builder_signature') or '').strip() or None,
                'price': float(price),
                'qty': qty,
            }
            items.append(item_payload)
            items_count += qty
            total += (price * qty)

        guests.append({
            'id': guest_id,
            'label': label[:20],
            'observacion': observacion or '',
            'items': items,
        })

    snapshot = {
        'selectedCategory': selected_category,
        'selectedMenus': selected_menus,
        'orderMeta': {
            'fecha_servicio': fecha_servicio.isoformat(),
            'mesa': mesa,
            'cliente': cliente or '',
            'modo_entrega': modo_entrega,
        },
        'guests': guests,
    }

    return {
        'fecha_servicio': fecha_servicio,
        'mesa': mesa[:80],
        'cliente': cliente[:160] if cliente else None,
        'modo_entrega': modo_entrega,
        'items_count': items_count,
        'comensales_count': len(guests),
        'total': total,
        'detalle_json': json.dumps(snapshot, ensure_ascii=True),
        'snapshot': snapshot,
    }, None


def _buscar_item_existente(categoria, nombre, parent_id, excluding_id=None):
    query = SaborArtesanalTablaItem.query.filter(
        SaborArtesanalTablaItem.categoria == categoria,
        func.lower(SaborArtesanalTablaItem.nombre) == (nombre or '').strip().lower(),
    )

    if parent_id is None:
        query = query.filter(SaborArtesanalTablaItem.parent_id.is_(None))
    else:
        query = query.filter(SaborArtesanalTablaItem.parent_id == parent_id)

    if excluding_id is not None:
        query = query.filter(SaborArtesanalTablaItem.id != excluding_id)

    return query.first()


def _buscar_menu_categoria_existente(codigo, nombre, excluding_id=None):
    query = SaborArtesanalMenuCategoria.query.filter(
        or_(
            func.lower(SaborArtesanalMenuCategoria.codigo) == (codigo or '').strip().lower(),
            func.lower(SaborArtesanalMenuCategoria.nombre) == (nombre or '').strip().lower(),
        )
    )
    if excluding_id is not None:
        query = query.filter(SaborArtesanalMenuCategoria.id != excluding_id)
    return query.first()


def _buscar_menu_existente(categoria_id, nombre, excluding_id=None):
    query = SaborArtesanalMenu.query.filter(
        SaborArtesanalMenu.categoria_id == categoria_id,
        func.lower(SaborArtesanalMenu.nombre) == (nombre or '').strip().lower(),
    )
    if excluding_id is not None:
        query = query.filter(SaborArtesanalMenu.id != excluding_id)
    return query.first()


def _construir_nombre_automatico_menu(categoria, componentes, excluding_id=None):
    categoria_nombre = (getattr(categoria, 'nombre', None) or 'Menu').strip() or 'Menu'
    bloques = {}
    for componente in componentes or []:
        bloques.setdefault(componente.get('bloque_codigo') or 'otros', []).append(componente)

    partes = [categoria_nombre]
    entrada = (bloques.get('entradas') or [None])[0]
    principio = (bloques.get('principios') or [None])[0]
    proteina = (bloques.get('proteinas') or [None])[0]

    for componente in (entrada, principio, proteina):
        if componente and componente.get('item_nombre'):
            partes.append(str(componente['item_nombre']).strip())

    base = ' | '.join([parte for parte in partes if parte])[:160].strip() or categoria_nombre[:160]
    candidato = base
    consecutivo = 2
    while _buscar_menu_existente(categoria.id, candidato, excluding_id=excluding_id):
        sufijo = f' #{consecutivo}'
        candidato = f"{base[:max(1, 160 - len(sufijo))]}{sufijo}"
        consecutivo += 1
    return candidato


def _resolver_parent_id(data, categoria_actual, item_actual=None):
    if 'parent_id' not in data and item_actual is not None:
        return item_actual.parent_id, None

    raw_parent_id = data.get('parent_id')
    if raw_parent_id in (None, '', 0, '0'):
        return None, None

    try:
        parent_id = int(raw_parent_id)
    except (TypeError, ValueError):
        return None, 'El item principal seleccionado no es valido.'

    parent = SaborArtesanalTablaItem.query.get(parent_id)
    if parent is None:
        return None, 'El item principal seleccionado no existe.'
    if parent.categoria != categoria_actual:
        return None, 'El item principal debe pertenecer a la misma categoria.'
    if parent.parent_id is not None:
        return None, 'Solo puedes asociar variantes directamente a un item principal.'
    if item_actual is not None and parent.id == item_actual.id:
        return None, 'Un item no puede depender de si mismo.'

    return parent_id, None


def _build_catalogo_tablas():
    catalogo = {}
    for categoria in SABOR_ARTESANAL_CATEGORIAS:
        if _es_categoria_principios(categoria):
            _ensure_principios_base_items()

        items = (
            SaborArtesanalTablaItem.query.options(
                selectinload(SaborArtesanalTablaItem.children),
                selectinload(SaborArtesanalTablaItem.parent),
            )
            .filter(
                SaborArtesanalTablaItem.categoria == categoria,
                SaborArtesanalTablaItem.parent_id.is_(None),
            )
            .order_by(
                SaborArtesanalTablaItem.activo.desc(),
                SaborArtesanalTablaItem.nombre.asc(),
                SaborArtesanalTablaItem.id.asc(),
            )
            .all()
        )
        catalogo[categoria] = {
            'categoria': categoria,
            'label': SABOR_ARTESANAL_CATEGORIAS[categoria],
            'items': [_serialize_sabor_item(item) for item in items],
        }
    return catalogo


def _validate_menu_componentes(payload_componentes):
    if not isinstance(payload_componentes, list) or len(payload_componentes) == 0:
        return None, 'Debes agregar al menos un componente al menu.'

    componentes = []
    seen_item_ids = set()
    protein_count = 0

    for index, raw in enumerate(payload_componentes):
        if not isinstance(raw, dict):
            return None, f'El componente #{index + 1} no tiene un formato valido.'

        tabla_categoria = _normalizar_categoria(raw.get('tabla_categoria'))
        if tabla_categoria is None:
            return None, f'El componente #{index + 1} tiene una tabla no valida.'

        try:
            tabla_item_id = int(raw.get('tabla_item_id'))
        except (TypeError, ValueError):
            return None, f'El componente #{index + 1} no tiene un item valido.'

        item = SaborArtesanalTablaItem.query.options(
            selectinload(SaborArtesanalTablaItem.parent)
        ).get(tabla_item_id)
        if item is None or item.categoria != tabla_categoria:
            return None, f'El item seleccionado en el componente #{index + 1} no existe en esa tabla.'

        if tabla_item_id in seen_item_ids:
            return None, 'No puedes repetir el mismo item dentro de un menu. Usa la cantidad para ajustar porciones.'

        cantidad = _parse_decimal(raw.get('cantidad'), default=Decimal('1'))
        if cantidad is None or cantidad <= 0:
            return None, f'La cantidad del componente #{index + 1} debe ser mayor a cero.'

        unidad = (raw.get('unidad') or 'porcion').strip() or 'porcion'
        parent = item.parent
        block_meta = _resolver_meta_bloque_menu(
            tabla_categoria,
            parent_nombre=parent.nombre if parent else item.nombre,
            bloque_codigo=raw.get('bloque_codigo'),
            bloque_label=raw.get('bloque_label'),
            selector_tipo=raw.get('selector_tipo'),
        )
        if block_meta['bloque_codigo'] == 'proteinas':
            protein_count += 1
            if protein_count > SABOR_ARTESANAL_MENU_MAX_PROTEINAS:
                return None, f'En "Proteina" solo puedes definir hasta {SABOR_ARTESANAL_MENU_MAX_PROTEINAS} alternativas.'
        group_code, group_label = _resolver_grupo_menu(
            tabla_categoria,
            parent,
            raw_group_code=raw.get('grupo_codigo'),
            raw_group_label=raw.get('grupo_label'),
        )
        componentes.append({
            'tabla_categoria': tabla_categoria,
            'tabla_item_id': item.id,
            'parent_item_id': parent.id if parent else None,
            'principal_nombre': parent.nombre if parent else item.nombre,
            'item_nombre': item.nombre,
            'descripcion': item.descripcion,
            'bloque_codigo': block_meta['bloque_codigo'],
            'bloque_label': block_meta['bloque_label'],
            'selector_tipo': block_meta['selector_tipo'],
            'grupo_codigo': group_code,
            'grupo_label': group_label,
            'seleccion_default': _parse_bool(raw.get('seleccion_default'), block_meta['selector_tipo'] == 'single' and index == 0),
            'cantidad': cantidad,
            'unidad': unidad[:40],
            'presentacion': (raw.get('presentacion') or '').strip()[:160] or None,
            'acompanamiento': (raw.get('acompanamiento') or '').strip()[:160] or None,
            'orden': index,
            'observaciones': (raw.get('observaciones') or '').strip() or None,
        })
        seen_item_ids.add(tabla_item_id)

    return componentes, None


def _validate_menu_bloques(payload_bloques):
    if not isinstance(payload_bloques, list) or len(payload_bloques) == 0:
        return None, 'Debes definir al menos un bloque para el menu.'

    componentes = []
    seen_item_ids = set()
    global_order = 0

    for block_index, raw_block in enumerate(payload_bloques):
        if not isinstance(raw_block, dict):
            return None, f'El bloque #{block_index + 1} no tiene un formato valido.'

        block_code = _slugify(raw_block.get('codigo') or raw_block.get('label') or f'bloque-{block_index + 1}')
        block_label = (raw_block.get('label') or raw_block.get('codigo') or f'Bloque {block_index + 1}').strip()
        selector_tipo = (raw_block.get('selector_tipo') or 'single').strip().lower() or 'single'
        if selector_tipo not in {'single', 'multi', 'grouped_single'}:
            return None, f'El bloque "{block_label}" tiene un tipo de seleccion no valido.'

        opciones = raw_block.get('opciones')
        if not isinstance(opciones, list) or len(opciones) == 0:
            return None, f'El bloque "{block_label}" debe tener al menos una alternativa.'
        if block_code == 'proteinas' and len(opciones) > SABOR_ARTESANAL_MENU_MAX_PROTEINAS:
            return None, f'En "Proteina" solo puedes definir hasta {SABOR_ARTESANAL_MENU_MAX_PROTEINAS} alternativas.'

        defaults_in_block = 0
        defaults_by_group = {}
        first_component_index = len(componentes)

        for option_index, raw_option in enumerate(opciones):
            if not isinstance(raw_option, dict):
                return None, f'La opcion #{option_index + 1} del bloque "{block_label}" no es valida.'

            tabla_categoria = _normalizar_categoria(raw_option.get('tabla_categoria'))
            if tabla_categoria is None:
                return None, f'La opcion #{option_index + 1} del bloque "{block_label}" usa una tabla no valida.'

            try:
                tabla_item_id = int(raw_option.get('tabla_item_id'))
            except (TypeError, ValueError):
                return None, f'La opcion #{option_index + 1} del bloque "{block_label}" no tiene un item valido.'

            item = SaborArtesanalTablaItem.query.options(
                selectinload(SaborArtesanalTablaItem.parent)
            ).get(tabla_item_id)
            if item is None or item.categoria != tabla_categoria:
                return None, f'El item seleccionado en "{block_label}" no existe en la tabla indicada.'

            if tabla_item_id in seen_item_ids:
                return None, 'No puedes repetir el mismo item dentro del mismo menu.'

            cantidad = _parse_decimal(raw_option.get('cantidad'), default=Decimal('1'))
            if cantidad is None or cantidad <= 0:
                return None, f'La cantidad de "{item.nombre}" en "{block_label}" debe ser mayor a cero.'

            unidad = (raw_option.get('unidad') or 'porcion').strip() or 'porcion'
            parent = item.parent
            group_code, group_label = _resolver_grupo_menu(
                tabla_categoria,
                parent,
                raw_group_code=raw_option.get('grupo_codigo'),
                raw_group_label=raw_option.get('grupo_label'),
            )
            selected_by_default = _parse_bool(
                raw_option.get('seleccion_default'),
                selector_tipo in {'single', 'grouped_single'} and option_index == 0,
            )
            if selected_by_default:
                if selector_tipo == 'grouped_single':
                    group_key = group_code or f'grupo-{option_index + 1}'
                    defaults_by_group[group_key] = defaults_by_group.get(group_key, 0) + 1
                else:
                    defaults_in_block += 1

            componentes.append({
                'tabla_categoria': tabla_categoria,
                'tabla_item_id': item.id,
                'parent_item_id': parent.id if parent else None,
                'principal_nombre': parent.nombre if parent else item.nombre,
                'item_nombre': item.nombre,
                'descripcion': item.descripcion,
                'bloque_codigo': block_code,
                'bloque_label': block_label[:120],
                'selector_tipo': selector_tipo,
                'grupo_codigo': group_code,
                'grupo_label': group_label,
                'seleccion_default': selected_by_default,
                'cantidad': cantidad,
                'unidad': unidad[:40],
                'presentacion': (raw_option.get('presentacion') or '').strip()[:160] or None,
                'acompanamiento': (raw_option.get('acompanamiento') or '').strip()[:160] or None,
                'orden': global_order,
                'observaciones': (raw_option.get('observaciones') or '').strip() or None,
            })
            seen_item_ids.add(tabla_item_id)
            global_order += 1

        if selector_tipo == 'single':
            if defaults_in_block > 1:
                return None, f'El bloque "{block_label}" solo puede tener una opcion marcada por defecto.'
            if defaults_in_block == 0 and len(componentes) > first_component_index:
                componentes[first_component_index]['seleccion_default'] = True
        elif selector_tipo == 'grouped_single':
            grouped_component_indexes = {}
            for component_index in range(first_component_index, len(componentes)):
                group_key = componentes[component_index].get('grupo_codigo') or f"grupo-{component_index}"
                grouped_component_indexes.setdefault(group_key, []).append(component_index)

            for group_key, indexes in grouped_component_indexes.items():
                defaults_count = defaults_by_group.get(group_key, 0)
                if defaults_count > 1:
                    return None, f'El bloque "{block_label}" solo puede tener una opcion marcada por defecto en cada grupo.'
                if defaults_count == 0 and indexes:
                    componentes[indexes[0]]['seleccion_default'] = True

            if block_code == 'principios':
                missing_groups = [label for key, label in SABOR_ARTESANAL_PRINCIPIOS_GRUPOS if key not in grouped_component_indexes]
                if missing_groups:
                    return None, f'En "{block_label}" debes seleccionar una opcion de {", ".join(missing_groups)}.'

    return componentes, None


def _validate_menu_payload(data):
    bloques = data.get('bloques')
    if isinstance(bloques, list) and len(bloques) > 0:
        return _validate_menu_bloques(bloques)
    return _validate_menu_componentes(data.get('componentes'))


def _load_menu_detail(menu_id):
    return SaborArtesanalMenu.query.options(
        selectinload(SaborArtesanalMenu.categoria_menu),
        selectinload(SaborArtesanalMenu.componentes).selectinload(SaborArtesanalMenuComponente.item),
        selectinload(SaborArtesanalMenu.componentes).selectinload(SaborArtesanalMenuComponente.parent),
        selectinload(SaborArtesanalMenu.programaciones).selectinload(SaborArtesanalMenuDia.categoria_menu_programada),
        selectinload(SaborArtesanalMenu.programaciones).selectinload(SaborArtesanalMenuDia.menu),
    ).get(menu_id)


def _prepare_sabor_artesanal_context():
    _ensure_sabor_artesanal_schema()
    _ensure_menu_base_categories()


@sabor_artesanal_bp.route('/tablas/<string:categoria>', methods=['GET'])
@login_required
def listar_tabla_sabor_artesanal(categoria):
    categoria_normalizada = _normalizar_categoria(categoria)
    if categoria_normalizada is None:
        return jsonify({'error': 'Categoria no valida'}), 400

    try:
        _prepare_sabor_artesanal_context()
        if _es_categoria_principios(categoria_normalizada):
            _ensure_principios_base_items()
        items = (
            SaborArtesanalTablaItem.query.options(
                selectinload(SaborArtesanalTablaItem.children),
                selectinload(SaborArtesanalTablaItem.parent),
            )
            .filter(
                SaborArtesanalTablaItem.categoria == categoria_normalizada,
                SaborArtesanalTablaItem.parent_id.is_(None),
            )
            .order_by(
                SaborArtesanalTablaItem.activo.desc(),
                SaborArtesanalTablaItem.nombre.asc(),
                SaborArtesanalTablaItem.id.asc(),
            )
            .all()
        )

        return jsonify({
            'categoria': categoria_normalizada,
            'label': SABOR_ARTESANAL_CATEGORIAS[categoria_normalizada],
            'items': [_serialize_sabor_item(item) for item in items],
        }), 200
    except Exception as exc:
        logger.error('Error listando tabla de Sabor Artesanal (%s): %s', categoria_normalizada, exc)
        return jsonify({'error': 'No se pudo cargar la tabla solicitada'}), 500


@sabor_artesanal_bp.route('/tablas/<string:categoria>', methods=['POST'])
@login_required
def crear_tabla_sabor_artesanal(categoria):
    categoria_normalizada = _normalizar_categoria(categoria)
    if categoria_normalizada is None:
        return jsonify({'error': 'Categoria no valida'}), 400

    data = request.get_json() or {}
    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        return jsonify({'error': 'El nombre es obligatorio'}), 400

    try:
        _prepare_sabor_artesanal_context()
        if _es_categoria_principios(categoria_normalizada):
            _ensure_principios_base_items()
    except Exception as exc:
        logger.error('No se pudo preparar el esquema de Sabor Artesanal: %s', exc)
        return jsonify({'error': 'No se pudo preparar la tabla de datos'}), 500

    parent_id, parent_error = _resolver_parent_id(data, categoria_normalizada)
    if parent_error:
        return jsonify({'error': parent_error}), 400

    precio_venta = _parse_decimal(data.get('precio_venta'))
    if _categoria_tabla_requiere_precio(categoria_normalizada):
        if precio_venta is None or precio_venta < 0:
            return jsonify({'error': 'Debes indicar un precio de venta valido para esta tabla.'}), 400

    if _es_categoria_principios(categoria_normalizada) and parent_id is None:
        if not (_es_principio_grupo_fijo(nombre) or _es_principio_opcion_especial(nombre)):
            return jsonify({'error': 'En Principios solo existen las raices fijas Granos, Verduras y Mixto. Agrega las demas opciones dentro de uno de esos grupos.'}), 400

    if _buscar_item_existente(categoria_normalizada, nombre, parent_id):
        return jsonify({'error': 'Ya existe un item con ese nombre en esta tabla'}), 409

    try:
        item = SaborArtesanalTablaItem(
            categoria=categoria_normalizada,
            nombre=nombre,
            descripcion=(data.get('descripcion') or '').strip() or None,
            parent_id=parent_id,
            activo=_parse_bool(data.get('activo'), True),
            precio_venta=precio_venta,
            usuario_id=getattr(current_user, 'id', None),
        )
        db.session.add(item)

        variantes = data.get('variantes') if isinstance(data.get('variantes'), list) else []
        if parent_id is None and variantes:
            seen = set()
            for variante in variantes:
                if isinstance(variante, dict):
                    variante_nombre = (variante.get('nombre') or '').strip()
                    variante_descripcion = (variante.get('descripcion') or '').strip() or None
                    variante_activo = _parse_bool(variante.get('activo'), True)
                    variante_precio_venta = _parse_decimal(variante.get('precio_venta'))
                else:
                    variante_nombre = str(variante or '').strip()
                    variante_descripcion = None
                    variante_activo = True
                    variante_precio_venta = None

                if not variante_nombre:
                    continue
                if variante_nombre.lower() == nombre.lower():
                    continue
                if variante_nombre.lower() in seen:
                    continue
                if _categoria_tabla_requiere_precio(categoria_normalizada) and (
                    variante_precio_venta is None or variante_precio_venta < 0
                ):
                    raise ValueError('Cada opcion de esta tabla debe tener un precio de venta valido.')

                seen.add(variante_nombre.lower())
                db.session.add(SaborArtesanalTablaItem(
                    categoria=categoria_normalizada,
                    nombre=variante_nombre,
                    descripcion=variante_descripcion,
                    parent=item,
                    activo=variante_activo,
                    precio_venta=variante_precio_venta,
                    usuario_id=getattr(current_user, 'id', None),
                ))

        db.session.commit()
        return jsonify({
            'mensaje': 'Item creado correctamente',
            'item': _serialize_sabor_item(item),
        }), 201
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        logger.error('Error creando item de Sabor Artesanal (%s): %s', categoria_normalizada, exc)
        return jsonify({'error': 'No se pudo crear el item'}), 500


@sabor_artesanal_bp.route('/tablas/items/<int:item_id>', methods=['PUT'])
@login_required
def actualizar_tabla_sabor_artesanal(item_id):
    _prepare_sabor_artesanal_context()
    item = SaborArtesanalTablaItem.query.options(
        selectinload(SaborArtesanalTablaItem.parent)
    ).get_or_404(item_id)
    if _es_categoria_principios(item.categoria):
        _ensure_principios_base_items()
    data = request.get_json() or {}

    nombre = (data.get('nombre') or item.nombre or '').strip()
    if not nombre:
        return jsonify({'error': 'El nombre es obligatorio'}), 400

    parent_id, parent_error = _resolver_parent_id(data, item.categoria, item_actual=item)
    if parent_error:
        return jsonify({'error': parent_error}), 400

    precio_venta = _parse_decimal(data.get('precio_venta')) if 'precio_venta' in data else item.precio_venta
    if _categoria_tabla_requiere_precio(item.categoria):
        if precio_venta is None or precio_venta < 0:
            return jsonify({'error': 'Debes indicar un precio de venta valido para esta tabla.'}), 400

    if _es_categoria_principios(item.categoria) and parent_id is None and not (_es_principio_grupo_fijo(nombre) or _es_principio_opcion_especial(nombre)):
        return jsonify({'error': 'En Principios solo existen las raices fijas Granos, Verduras y Mixto.'}), 400

    if _buscar_item_existente(item.categoria, nombre, parent_id, excluding_id=item.id):
        return jsonify({'error': 'Ya existe un item con ese nombre en esta tabla'}), 409

    try:
        item.nombre = nombre
        item.descripcion = (data.get('descripcion') or '').strip() or None
        item.parent_id = parent_id
        item.precio_venta = precio_venta
        if 'activo' in data:
            item.activo = _parse_bool(data.get('activo'), True)
        db.session.commit()
        return jsonify({
            'mensaje': 'Item actualizado correctamente',
            'item': _serialize_sabor_item(item),
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error actualizando item de Sabor Artesanal (%s): %s', item_id, exc)
        return jsonify({'error': 'No se pudo actualizar el item'}), 500


@sabor_artesanal_bp.route('/tablas/items/<int:item_id>', methods=['DELETE'])
@login_required
def eliminar_tabla_sabor_artesanal(item_id):
    _prepare_sabor_artesanal_context()
    item = SaborArtesanalTablaItem.query.options(
        selectinload(SaborArtesanalTablaItem.children)
    ).get_or_404(item_id)
    if _es_categoria_principios(item.categoria):
        _ensure_principios_base_items()

    if _es_categoria_principios(item.categoria) and item.parent_id is None and (
        _es_principio_grupo_fijo(item.nombre) or _es_principio_opcion_especial(item.nombre)
    ):
        return jsonify({'error': 'Las raices fijas Granos, Verduras y Mixto no se pueden eliminar.'}), 400

    try:
        item_nombre = item.nombre
        cantidad_hijos = len(item.children or [])
        db.session.delete(item)
        db.session.commit()

        if cantidad_hijos > 0:
            mensaje = f'Se elimino {item_nombre} junto con {cantidad_hijos} variante(s).'
        else:
            mensaje = f'Se elimino {item_nombre}.'

        return jsonify({'mensaje': mensaje}), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error eliminando item de Sabor Artesanal (%s): %s', item_id, exc)
        return jsonify({'error': 'No se pudo eliminar el item'}), 500


@sabor_artesanal_bp.route('/menu-categorias', methods=['GET'])
@login_required
def listar_menu_categorias_sabor_artesanal():
    try:
        _prepare_sabor_artesanal_context()
        categorias = SaborArtesanalMenuCategoria.query.order_by(
            SaborArtesanalMenuCategoria.activo.desc(),
            SaborArtesanalMenuCategoria.orden.asc(),
            SaborArtesanalMenuCategoria.nombre.asc(),
        ).all()
        return jsonify({
            'categorias': [_serialize_menu_categoria(categoria) for categoria in categorias],
        }), 200
    except Exception as exc:
        logger.error('Error listando categorias de menu de Sabor Artesanal: %s', exc)
        return jsonify({'error': 'No se pudieron cargar las categorias de menu'}), 500


@sabor_artesanal_bp.route('/menu-categorias', methods=['POST'])
@login_required
def crear_menu_categoria_sabor_artesanal():
    data = request.get_json() or {}
    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        return jsonify({'error': 'El nombre de la categoria es obligatorio'}), 400

    codigo = _slugify(data.get('codigo') or nombre)
    if not codigo:
        return jsonify({'error': 'El codigo de la categoria no es valido'}), 400

    try:
        _prepare_sabor_artesanal_context()
        if _buscar_menu_categoria_existente(codigo, nombre):
            return jsonify({'error': 'Ya existe una categoria con ese nombre o codigo'}), 409

        categoria = SaborArtesanalMenuCategoria(
            codigo=codigo[:50],
            nombre=nombre[:120],
            descripcion=(data.get('descripcion') or '').strip() or None,
            orden=int(data.get('orden') or 0),
            activo=_parse_bool(data.get('activo'), True),
            usuario_id=getattr(current_user, 'id', None),
        )
        db.session.add(categoria)
        db.session.commit()
        return jsonify({
            'mensaje': 'Categoria creada correctamente',
            'categoria': _serialize_menu_categoria(categoria),
        }), 201
    except Exception as exc:
        db.session.rollback()
        logger.error('Error creando categoria de menu de Sabor Artesanal: %s', exc)
        return jsonify({'error': 'No se pudo crear la categoria de menu'}), 500


@sabor_artesanal_bp.route('/menu-categorias/<int:categoria_id>', methods=['PUT'])
@login_required
def actualizar_menu_categoria_sabor_artesanal(categoria_id):
    _prepare_sabor_artesanal_context()
    categoria = SaborArtesanalMenuCategoria.query.get_or_404(categoria_id)
    data = request.get_json() or {}

    nombre = (data.get('nombre') or categoria.nombre or '').strip()
    if not nombre:
        return jsonify({'error': 'El nombre de la categoria es obligatorio'}), 400

    codigo = _slugify(data.get('codigo') or categoria.codigo or nombre)
    if not codigo:
        return jsonify({'error': 'El codigo de la categoria no es valido'}), 400

    if _buscar_menu_categoria_existente(codigo, nombre, excluding_id=categoria.id):
        return jsonify({'error': 'Ya existe otra categoria con ese nombre o codigo'}), 409

    try:
        categoria.codigo = codigo[:50]
        categoria.nombre = nombre[:120]
        categoria.descripcion = (data.get('descripcion') or '').strip() or None
        categoria.orden = int(data.get('orden') or categoria.orden or 0)
        if 'activo' in data:
            categoria.activo = _parse_bool(data.get('activo'), True)
        db.session.commit()
        return jsonify({
            'mensaje': 'Categoria actualizada correctamente',
            'categoria': _serialize_menu_categoria(categoria),
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error actualizando categoria de menu %s: %s', categoria_id, exc)
        return jsonify({'error': 'No se pudo actualizar la categoria de menu'}), 500


@sabor_artesanal_bp.route('/menu-categorias/<int:categoria_id>', methods=['DELETE'])
@login_required
def eliminar_menu_categoria_sabor_artesanal(categoria_id):
    _prepare_sabor_artesanal_context()
    categoria = SaborArtesanalMenuCategoria.query.get_or_404(categoria_id)

    if categoria.menus.count() > 0 or categoria.programaciones.count() > 0:
        return jsonify({
            'error': 'No puedes eliminar esta categoria porque ya tiene menus o dias programados. Puedes dejarla inactiva.'
        }), 409

    try:
        nombre = categoria.nombre
        db.session.delete(categoria)
        db.session.commit()
        return jsonify({'mensaje': f'Se elimino la categoria {nombre}.'}), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error eliminando categoria de menu %s: %s', categoria_id, exc)
        return jsonify({'error': 'No se pudo eliminar la categoria de menu'}), 500


@sabor_artesanal_bp.route('/menus/contexto', methods=['GET'])
@login_required
def obtener_contexto_menus_sabor_artesanal():
    try:
        _prepare_sabor_artesanal_context()
        fecha_servicio = _parse_date(request.args.get('fecha_servicio'))
        categorias_menu = SaborArtesanalMenuCategoria.query.order_by(
            SaborArtesanalMenuCategoria.activo.desc(),
            SaborArtesanalMenuCategoria.orden.asc(),
            SaborArtesanalMenuCategoria.nombre.asc(),
        ).all()
        menus = SaborArtesanalMenu.query.options(
            selectinload(SaborArtesanalMenu.categoria_menu),
            selectinload(SaborArtesanalMenu.componentes).selectinload(SaborArtesanalMenuComponente.item),
            selectinload(SaborArtesanalMenu.componentes).selectinload(SaborArtesanalMenuComponente.parent),
            selectinload(SaborArtesanalMenu.programaciones).selectinload(SaborArtesanalMenuDia.categoria_menu_programada),
            selectinload(SaborArtesanalMenu.programaciones).selectinload(SaborArtesanalMenuDia.menu),
        ).order_by(
            SaborArtesanalMenu.activo.desc(),
            SaborArtesanalMenu.nombre.asc(),
            SaborArtesanalMenu.id.asc(),
        ).all()
        programaciones = SaborArtesanalMenuDia.query.options(
            selectinload(SaborArtesanalMenuDia.menu),
            selectinload(SaborArtesanalMenuDia.categoria_menu_programada),
        ).order_by(
            SaborArtesanalMenuDia.fecha_servicio.asc(),
            SaborArtesanalMenuDia.id.asc(),
        ).all()
        pedidos = []
        if fecha_servicio:
            pedidos = SaborArtesanalPedido.query.filter(
                SaborArtesanalPedido.fecha_servicio == fecha_servicio
            ).order_by(
                SaborArtesanalPedido.updated_at.desc(),
                SaborArtesanalPedido.id.desc(),
            ).all()

        return jsonify({
            'categorias_menu': [_serialize_menu_categoria(item) for item in categorias_menu],
            'tablas_catalogo': _build_catalogo_tablas(),
            'menus': [_serialize_menu(item) for item in menus],
            'programaciones': [_serialize_programacion(item) for item in programaciones],
            'pedidos': [_serialize_pedido(item) for item in pedidos],
        }), 200
    except Exception as exc:
        logger.error('Error cargando contexto de menus de Sabor Artesanal: %s', exc)
        return jsonify({'error': 'No se pudo cargar el contexto de menus'}), 500


@sabor_artesanal_bp.route('/menus', methods=['GET'])
@login_required
def listar_menus_sabor_artesanal():
    try:
        _prepare_sabor_artesanal_context()
        query = SaborArtesanalMenu.query.options(
            selectinload(SaborArtesanalMenu.categoria_menu),
            selectinload(SaborArtesanalMenu.componentes).selectinload(SaborArtesanalMenuComponente.item),
            selectinload(SaborArtesanalMenu.componentes).selectinload(SaborArtesanalMenuComponente.parent),
            selectinload(SaborArtesanalMenu.programaciones).selectinload(SaborArtesanalMenuDia.categoria_menu_programada),
        )
        categoria_id = request.args.get('categoria_id')
        if categoria_id not in (None, ''):
            try:
                query = query.filter(SaborArtesanalMenu.categoria_id == int(categoria_id))
            except (TypeError, ValueError):
                return jsonify({'error': 'La categoria solicitada no es valida'}), 400

        activo = request.args.get('activo')
        if activo == 'true':
            query = query.filter(SaborArtesanalMenu.activo.is_(True))
        elif activo == 'false':
            query = query.filter(SaborArtesanalMenu.activo.is_(False))

        menus = query.order_by(
            SaborArtesanalMenu.activo.desc(),
            SaborArtesanalMenu.nombre.asc(),
            SaborArtesanalMenu.id.asc(),
        ).all()

        return jsonify({'menus': [_serialize_menu(menu) for menu in menus]}), 200
    except Exception as exc:
        logger.error('Error listando menus de Sabor Artesanal: %s', exc)
        return jsonify({'error': 'No se pudieron cargar los menus'}), 500


@sabor_artesanal_bp.route('/menus', methods=['POST'])
@login_required
def crear_menu_sabor_artesanal():
    data = request.get_json() or {}

    try:
        categoria_id = int(data.get('categoria_id'))
    except (TypeError, ValueError):
        return jsonify({'error': 'Debes seleccionar una categoria de menu'}), 400

    componentes, componentes_error = _validate_menu_payload(data)
    if componentes_error:
        return jsonify({'error': componentes_error}), 400

    try:
        _prepare_sabor_artesanal_context()
        categoria = SaborArtesanalMenuCategoria.query.get(categoria_id)
        if categoria is None:
            return jsonify({'error': 'La categoria de menu seleccionada no existe'}), 404
        precio_venta = _parse_decimal(data.get('precio_venta'))
        if _categoria_menu_requiere_precio(categoria):
            if precio_venta is None or precio_venta < 0:
                return jsonify({'error': 'Debes indicar el precio de venta del menu.'}), 400
        nombre = _construir_nombre_automatico_menu(categoria, componentes)

        menu = SaborArtesanalMenu(
            categoria_id=categoria_id,
            nombre=nombre[:160],
            descripcion=(data.get('descripcion') or '').strip() or None,
            instrucciones=(data.get('instrucciones') or '').strip() or None,
            precio_venta=precio_venta,
            activo=_parse_bool(data.get('activo'), True),
            usuario_id=getattr(current_user, 'id', None),
        )
        db.session.add(menu)
        db.session.flush()

        for componente in componentes:
            db.session.add(SaborArtesanalMenuComponente(menu_id=menu.id, **componente))

        db.session.commit()
        menu = _load_menu_detail(menu.id)
        return jsonify({
            'mensaje': 'Menu creado correctamente',
            'menu': _serialize_menu(menu),
        }), 201
    except Exception as exc:
        db.session.rollback()
        logger.error('Error creando menu de Sabor Artesanal: %s', exc)
        return jsonify({'error': 'No se pudo crear el menu'}), 500


@sabor_artesanal_bp.route('/menus/<int:menu_id>', methods=['PUT'])
@login_required
def actualizar_menu_sabor_artesanal(menu_id):
    _prepare_sabor_artesanal_context()
    menu = _load_menu_detail(menu_id)
    if menu is None:
        return jsonify({'error': 'El menu solicitado no existe'}), 404

    data = request.get_json() or {}

    try:
        categoria_id = int(data.get('categoria_id') or menu.categoria_id)
    except (TypeError, ValueError):
        return jsonify({'error': 'Debes seleccionar una categoria de menu valida'}), 400

    componentes, componentes_error = _validate_menu_payload(data)
    if componentes_error:
        return jsonify({'error': componentes_error}), 400

    categoria = SaborArtesanalMenuCategoria.query.get(categoria_id)
    if categoria is None:
        return jsonify({'error': 'La categoria de menu seleccionada no existe'}), 404
    precio_venta = _parse_decimal(data.get('precio_venta')) if 'precio_venta' in data else menu.precio_venta
    if _categoria_menu_requiere_precio(categoria):
        if precio_venta is None or precio_venta < 0:
            return jsonify({'error': 'Debes indicar el precio de venta del menu.'}), 400
    nombre = _construir_nombre_automatico_menu(categoria, componentes, excluding_id=menu.id)

    try:
        previous_categoria_id = menu.categoria_id
        menu.categoria_id = categoria_id
        menu.nombre = nombre[:160]
        menu.descripcion = (data.get('descripcion') or '').strip() or None
        menu.instrucciones = (data.get('instrucciones') or '').strip() or None
        menu.precio_venta = precio_venta
        if 'activo' in data:
            menu.activo = _parse_bool(data.get('activo'), True)

        if previous_categoria_id != categoria_id:
            for programacion in menu.programaciones:
                conflict = SaborArtesanalMenuDia.query.filter(
                    SaborArtesanalMenuDia.id != programacion.id,
                    SaborArtesanalMenuDia.fecha_servicio == programacion.fecha_servicio,
                    SaborArtesanalMenuDia.categoria_id == categoria_id,
                ).first()
                if conflict is not None:
                    return jsonify({
                        'error': 'No puedes mover este menu a esa categoria porque ya existe una programacion para una de sus fechas.'
                    }), 409
            for programacion in menu.programaciones:
                programacion.categoria_id = categoria_id

        for componente in list(menu.componentes or []):
            db.session.delete(componente)
        db.session.flush()

        for componente in componentes:
            db.session.add(SaborArtesanalMenuComponente(menu_id=menu.id, **componente))

        db.session.commit()
        menu = _load_menu_detail(menu.id)
        return jsonify({
            'mensaje': 'Menu actualizado correctamente',
            'menu': _serialize_menu(menu),
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error actualizando menu %s de Sabor Artesanal: %s', menu_id, exc)
        return jsonify({'error': 'No se pudo actualizar el menu'}), 500


@sabor_artesanal_bp.route('/menus/<int:menu_id>', methods=['DELETE'])
@login_required
def eliminar_menu_sabor_artesanal(menu_id):
    _prepare_sabor_artesanal_context()
    menu = SaborArtesanalMenu.query.get_or_404(menu_id)

    try:
        nombre = menu.nombre
        db.session.delete(menu)
        db.session.commit()
        return jsonify({'mensaje': f'Se elimino el menu {nombre}.'}), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error eliminando menu %s de Sabor Artesanal: %s', menu_id, exc)
        return jsonify({'error': 'No se pudo eliminar el menu'}), 500


@sabor_artesanal_bp.route('/menus/programacion', methods=['GET'])
@login_required
def listar_programacion_menus_sabor_artesanal():
    try:
        _prepare_sabor_artesanal_context()
        query = SaborArtesanalMenuDia.query.options(
            selectinload(SaborArtesanalMenuDia.menu),
            selectinload(SaborArtesanalMenuDia.categoria_menu_programada),
        )

        fecha_desde = _parse_date(request.args.get('fecha_desde'))
        fecha_hasta = _parse_date(request.args.get('fecha_hasta'))
        if fecha_desde:
            query = query.filter(SaborArtesanalMenuDia.fecha_servicio >= fecha_desde)
        if fecha_hasta:
            query = query.filter(SaborArtesanalMenuDia.fecha_servicio <= fecha_hasta)

        categoria_id = request.args.get('categoria_id')
        if categoria_id not in (None, ''):
            try:
                query = query.filter(SaborArtesanalMenuDia.categoria_id == int(categoria_id))
            except (TypeError, ValueError):
                return jsonify({'error': 'La categoria solicitada no es valida'}), 400

        programaciones = query.order_by(
            SaborArtesanalMenuDia.fecha_servicio.asc(),
            SaborArtesanalMenuDia.categoria_id.asc(),
            SaborArtesanalMenuDia.id.asc(),
        ).all()

        return jsonify({
            'programaciones': [_serialize_programacion(item) for item in programaciones],
        }), 200
    except Exception as exc:
        logger.error('Error listando programacion de menus de Sabor Artesanal: %s', exc)
        return jsonify({'error': 'No se pudo cargar la programacion de menus'}), 500


@sabor_artesanal_bp.route('/menus/programacion', methods=['POST'])
@login_required
def crear_programacion_menu_sabor_artesanal():
    data = request.get_json() or {}

    try:
        menu_id = int(data.get('menu_id'))
    except (TypeError, ValueError):
        return jsonify({'error': 'Debes seleccionar un menu para programar'}), 400

    fecha_servicio = _parse_date(data.get('fecha_servicio'))
    if fecha_servicio is None:
        return jsonify({'error': 'Debes indicar una fecha valida para programar el menu'}), 400

    try:
        _prepare_sabor_artesanal_context()
        menu = SaborArtesanalMenu.query.options(
            selectinload(SaborArtesanalMenu.categoria_menu)
        ).get(menu_id)
        if menu is None:
            return jsonify({'error': 'El menu seleccionado no existe'}), 404

        conflicto = SaborArtesanalMenuDia.query.filter(
            SaborArtesanalMenuDia.fecha_servicio == fecha_servicio,
            SaborArtesanalMenuDia.categoria_id == menu.categoria_id,
        ).first()
        if conflicto is not None:
            return jsonify({
                'error': 'Ya existe un menu asignado para esa fecha en la misma categoria.'
            }), 409

        programacion = SaborArtesanalMenuDia(
            menu_id=menu.id,
            categoria_id=menu.categoria_id,
            fecha_servicio=fecha_servicio,
            observaciones=(data.get('observaciones') or '').strip() or None,
            usuario_id=getattr(current_user, 'id', None),
        )
        db.session.add(programacion)
        db.session.commit()

        programacion = SaborArtesanalMenuDia.query.options(
            selectinload(SaborArtesanalMenuDia.menu),
            selectinload(SaborArtesanalMenuDia.categoria_menu_programada),
        ).get(programacion.id)
        return jsonify({
            'mensaje': 'Menu programado correctamente',
            'programacion': _serialize_programacion(programacion),
        }), 201
    except Exception as exc:
        db.session.rollback()
        logger.error('Error creando programacion de menu en Sabor Artesanal: %s', exc)
        return jsonify({'error': 'No se pudo programar el menu'}), 500


@sabor_artesanal_bp.route('/menus/programacion/<int:programacion_id>', methods=['PUT'])
@login_required
def actualizar_programacion_menu_sabor_artesanal(programacion_id):
    _prepare_sabor_artesanal_context()
    programacion = SaborArtesanalMenuDia.query.get_or_404(programacion_id)
    data = request.get_json() or {}

    try:
        menu_id = int(data.get('menu_id') or programacion.menu_id)
    except (TypeError, ValueError):
        return jsonify({'error': 'Debes seleccionar un menu valido'}), 400

    fecha_servicio = _parse_date(data.get('fecha_servicio') or programacion.fecha_servicio)
    if fecha_servicio is None:
        return jsonify({'error': 'Debes indicar una fecha valida'}), 400

    menu = SaborArtesanalMenu.query.options(
        selectinload(SaborArtesanalMenu.categoria_menu)
    ).get(menu_id)
    if menu is None:
        return jsonify({'error': 'El menu seleccionado no existe'}), 404

    conflicto = SaborArtesanalMenuDia.query.filter(
        SaborArtesanalMenuDia.id != programacion.id,
        SaborArtesanalMenuDia.fecha_servicio == fecha_servicio,
        SaborArtesanalMenuDia.categoria_id == menu.categoria_id,
    ).first()
    if conflicto is not None:
        return jsonify({'error': 'Ya existe otro menu programado para esa fecha en la misma categoria.'}), 409

    try:
        programacion.menu_id = menu.id
        programacion.categoria_id = menu.categoria_id
        programacion.fecha_servicio = fecha_servicio
        programacion.observaciones = (data.get('observaciones') or '').strip() or None
        db.session.commit()

        programacion = SaborArtesanalMenuDia.query.options(
            selectinload(SaborArtesanalMenuDia.menu),
            selectinload(SaborArtesanalMenuDia.categoria_menu_programada),
        ).get(programacion.id)
        return jsonify({
            'mensaje': 'Programacion actualizada correctamente',
            'programacion': _serialize_programacion(programacion),
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error actualizando programacion de menu %s: %s', programacion_id, exc)
        return jsonify({'error': 'No se pudo actualizar la programacion'}), 500


@sabor_artesanal_bp.route('/menus/programacion/<int:programacion_id>', methods=['DELETE'])
@login_required
def eliminar_programacion_menu_sabor_artesanal(programacion_id):
    _prepare_sabor_artesanal_context()
    programacion = SaborArtesanalMenuDia.query.options(
        selectinload(SaborArtesanalMenuDia.menu),
        selectinload(SaborArtesanalMenuDia.categoria_menu_programada),
    ).get_or_404(programacion_id)

    try:
        resumen = f"{programacion.fecha_servicio.isoformat()} / {programacion.categoria_menu_programada.nombre if programacion.categoria_menu_programada else 'Categoria'}"
        db.session.delete(programacion)
        db.session.commit()
        return jsonify({'mensaje': f'Se elimino la programacion {resumen}.'}), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error eliminando programacion de menu %s: %s', programacion_id, exc)
        return jsonify({'error': 'No se pudo eliminar la programacion'}), 500


@sabor_artesanal_bp.route('/ventas-dia/pedidos', methods=['GET'])
@sabor_artesanal_bp.route('/pedidos', methods=['GET'])
@login_required
def listar_pedidos_sabor_artesanal():
    try:
        _prepare_sabor_artesanal_context()
        query = SaborArtesanalPedido.query

        fecha_servicio = _parse_date(request.args.get('fecha_servicio'))
        if fecha_servicio:
            query = query.filter(SaborArtesanalPedido.fecha_servicio == fecha_servicio)

        estado = (request.args.get('estado') or '').strip().upper()
        if estado:
            if estado not in SABOR_ARTESANAL_PEDIDO_ESTADOS:
                return jsonify({'error': 'El estado del pedido no es valido'}), 400
            query = query.filter(SaborArtesanalPedido.estado == estado)

        pedidos = query.order_by(
            SaborArtesanalPedido.fecha_servicio.desc(),
            SaborArtesanalPedido.updated_at.desc(),
            SaborArtesanalPedido.id.desc(),
        ).all()
        return jsonify({'pedidos': [_serialize_pedido(item) for item in pedidos]}), 200
    except Exception as exc:
        logger.error('Error listando pedidos de Sabor Artesanal: %s', exc)
        return jsonify({'error': 'No se pudieron cargar los pedidos'}), 500


@sabor_artesanal_bp.route('/ventas-dia/pedidos/<int:pedido_id>', methods=['GET'])
@sabor_artesanal_bp.route('/pedidos/<int:pedido_id>', methods=['GET'])
@login_required
def obtener_pedido_sabor_artesanal(pedido_id):
    _prepare_sabor_artesanal_context()
    pedido = SaborArtesanalPedido.query.get(pedido_id)
    if pedido is None:
        return jsonify({'error': 'El pedido solicitado no existe'}), 404

    try:
        return jsonify({'pedido': _serialize_pedido(pedido)}), 200
    except Exception as exc:
        logger.error('Error cargando pedido %s de Sabor Artesanal: %s', pedido_id, exc)
        return jsonify({'error': 'No se pudo cargar el pedido'}), 500


@sabor_artesanal_bp.route('/ventas-dia/pedidos', methods=['POST'])
@sabor_artesanal_bp.route('/pedidos', methods=['POST'])
@login_required
def crear_pedido_sabor_artesanal():
    _prepare_sabor_artesanal_context()
    payload, error = _validate_pedido_payload(request.get_json() or {})
    if error:
        return jsonify({'error': error}), 400

    try:
        pedido = SaborArtesanalPedido(
            codigo='PENDIENTE',
            fecha_servicio=payload['fecha_servicio'],
            mesa=payload['mesa'],
            cliente=payload['cliente'],
            modo_entrega=payload['modo_entrega'],
            estado='ABIERTO',
            detalle_json=payload['detalle_json'],
            items_count=payload['items_count'],
            comensales_count=payload['comensales_count'],
            total=payload['total'],
            usuario_id=getattr(current_user, 'id', None),
        )
        db.session.add(pedido)
        db.session.flush()
        pedido.codigo = _build_pedido_codigo(pedido.id, pedido.fecha_servicio)
        db.session.commit()
        return jsonify({
            'mensaje': 'Pedido creado correctamente',
            'pedido': _serialize_pedido(pedido),
        }), 201
    except Exception as exc:
        db.session.rollback()
        logger.error('Error creando pedido de Sabor Artesanal: %s', exc)
        return jsonify({'error': 'No se pudo crear el pedido'}), 500


@sabor_artesanal_bp.route('/ventas-dia/pedidos/<int:pedido_id>', methods=['PUT'])
@sabor_artesanal_bp.route('/pedidos/<int:pedido_id>', methods=['PUT'])
@login_required
def actualizar_pedido_sabor_artesanal(pedido_id):
    _prepare_sabor_artesanal_context()
    pedido = SaborArtesanalPedido.query.get_or_404(pedido_id)
    if pedido.estado == 'COBRADO':
        return jsonify({'error': 'No puedes modificar un pedido que ya fue cobrado.'}), 409

    payload, error = _validate_pedido_payload(request.get_json() or {})
    if error:
        return jsonify({'error': error}), 400

    try:
        pedido.fecha_servicio = payload['fecha_servicio']
        pedido.mesa = payload['mesa']
        pedido.cliente = payload['cliente']
        pedido.modo_entrega = payload['modo_entrega']
        pedido.detalle_json = payload['detalle_json']
        pedido.items_count = payload['items_count']
        pedido.comensales_count = payload['comensales_count']
        pedido.total = payload['total']
        db.session.commit()
        return jsonify({
            'mensaje': 'Pedido actualizado correctamente',
            'pedido': _serialize_pedido(pedido),
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error actualizando pedido %s de Sabor Artesanal: %s', pedido_id, exc)
        return jsonify({'error': 'No se pudo actualizar el pedido'}), 500


@sabor_artesanal_bp.route('/ventas-dia/pedidos/<int:pedido_id>', methods=['DELETE'])
@sabor_artesanal_bp.route('/pedidos/<int:pedido_id>', methods=['DELETE'])
@login_required
def eliminar_pedido_sabor_artesanal(pedido_id):
    _prepare_sabor_artesanal_context()
    pedido = SaborArtesanalPedido.query.get_or_404(pedido_id)
    if pedido.estado == 'COBRADO':
        return jsonify({'error': 'No puedes eliminar un pedido que ya fue cobrado.'}), 409

    try:
        codigo = pedido.codigo
        db.session.delete(pedido)
        db.session.commit()
        return jsonify({'mensaje': f'Se elimino el pedido {codigo}.'}), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error eliminando pedido %s de Sabor Artesanal: %s', pedido_id, exc)
        return jsonify({'error': 'No se pudo eliminar el pedido'}), 500


@sabor_artesanal_bp.route('/ventas-dia/pedidos/<int:pedido_id>/finalizar', methods=['POST'])
@sabor_artesanal_bp.route('/pedidos/<int:pedido_id>/finalizar', methods=['POST'])
@login_required
def finalizar_pedido_sabor_artesanal(pedido_id):
    _prepare_sabor_artesanal_context()
    pedido = SaborArtesanalPedido.query.get_or_404(pedido_id)
    if pedido.estado == 'COBRADO':
        return jsonify({'error': 'El pedido ya fue cobrado y no se puede finalizar de nuevo.'}), 409
    if int(pedido.items_count or 0) <= 0:
        return jsonify({'error': 'No puedes finalizar un pedido sin productos.'}), 400

    try:
        pedido.estado = 'FINALIZADO'
        pedido.finalizado_at = datetime.utcnow()
        db.session.commit()
        return jsonify({
            'mensaje': 'Pedido finalizado correctamente',
            'pedido': _serialize_pedido(pedido),
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error finalizando pedido %s de Sabor Artesanal: %s', pedido_id, exc)
        return jsonify({'error': 'No se pudo finalizar el pedido'}), 500


@sabor_artesanal_bp.route('/ventas-dia/pedidos/<int:pedido_id>/reabrir', methods=['POST'])
@sabor_artesanal_bp.route('/pedidos/<int:pedido_id>/reabrir', methods=['POST'])
@login_required
def reabrir_pedido_sabor_artesanal(pedido_id):
    _prepare_sabor_artesanal_context()
    pedido = SaborArtesanalPedido.query.get_or_404(pedido_id)
    if pedido.estado == 'COBRADO':
        return jsonify({'error': 'No puedes reabrir un pedido que ya fue cobrado.'}), 409

    try:
        pedido.estado = 'ABIERTO'
        pedido.finalizado_at = None
        db.session.commit()
        return jsonify({
            'mensaje': 'Pedido reabierto correctamente',
            'pedido': _serialize_pedido(pedido),
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error reabriendo pedido %s de Sabor Artesanal: %s', pedido_id, exc)
        return jsonify({'error': 'No se pudo reabrir el pedido'}), 500


@sabor_artesanal_bp.route('/ventas-dia/pedidos/<int:pedido_id>/cobrar', methods=['POST'])
@sabor_artesanal_bp.route('/pedidos/<int:pedido_id>/cobrar', methods=['POST'])
@login_required
def cobrar_pedido_sabor_artesanal(pedido_id):
    _prepare_sabor_artesanal_context()
    pedido = SaborArtesanalPedido.query.get_or_404(pedido_id)
    if pedido.estado == 'COBRADO':
        return jsonify({'error': 'El pedido ya fue cobrado.'}), 409
    if pedido.estado != 'FINALIZADO':
        return jsonify({'error': 'Primero debes finalizar el pedido antes de registrar el cobro.'}), 409

    data = request.get_json() or {}
    forma_pago = _normalize_pedido_forma_pago(data.get('forma_pago'))
    if not forma_pago:
        return jsonify({'error': 'Debes seleccionar una forma de pago valida.'}), 400

    valor_pagado = _parse_decimal(data.get('valor_pagado'), default=pedido.total)
    if valor_pagado is None or valor_pagado < 0:
        return jsonify({'error': 'El valor pagado no es valido.'}), 400

    try:
        pedido.estado = 'COBRADO'
        pedido.cobrado_at = datetime.utcnow()
        pedido.forma_pago = forma_pago
        pedido.valor_pagado = valor_pagado
        pedido.pago_referencia = (data.get('pago_referencia') or '').strip()[:120] or None
        pedido.pago_observaciones = (data.get('pago_observaciones') or '').strip() or None
        db.session.commit()
        return jsonify({
            'mensaje': 'Cobro registrado correctamente',
            'pedido': _serialize_pedido(pedido),
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error cobrando pedido %s de Sabor Artesanal: %s', pedido_id, exc)
        return jsonify({'error': 'No se pudo registrar el cobro'}), 500
