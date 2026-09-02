from datetime import datetime
from decimal import Decimal, InvalidOperation
import json
import logging
import os
import shutil
import unicodedata
import uuid

from flask import current_app, jsonify, request, send_file
from flask_login import current_user, login_required
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename

from app.models import (
    AtencionDiaDetalle,
    ClienteComercial,
    ClienteComercialAdjunto,
    ClienteAtencion,
    ClienteAtencionDetalle,
    ClienteSeguimientoDocumento,
    ClienteSeguimientoPago,
    ClienteComercialTarifa,
    ComercialCatalogoItem,
    ComercialPaqueteDetalle,
    ComercialRecaudo,
    ComercialRecaudoAtencion,
    ComisionLiquidacion,
    ComisionLiquidacionDetalle,
    SiigoCliente,
    Usuario,
    Vendedor,
    db,
)
from app.routes import comercial_bp
from app.security import get_permission_names_for_role


logger = logging.getLogger(__name__)

CONDICIONES_COMERCIALES = {'EFECTIVO', 'CREDITO', 'MIXTO'}
ESTADOS_CLIENTE = {'ACTIVO', 'INACTIVO', 'BLOQUEO_TEMPORAL'}
MEDIOS_AUTORIZACION = {'WHATSAPP', 'EMAIL', 'PAGINA_WEB'}
TIPOS_CATALOGO_COMERCIAL = {'EXAMEN', 'PAQUETE', 'SERVICIO'}
TIPOS_EXAMEN_COMERCIAL = {'CONSULTA', 'LABORATORIO', 'PARACLINICO', 'ECOBABY', 'CURSOS'}
TIPOS_SUBTIPO_LABORATORIO = {'REMITIDO', 'REALIZADO', 'NO_REMITIDO'}
TIPOS_SEGUIMIENTO_DOCUMENTO = {'FACTURA', 'CUENTA_COBRO', 'VENTA_DIRECTA', 'INGRESO_SIN_FACTURA'}
ESTADOS_SEGUIMIENTO_DOCUMENTO = {'PENDIENTE', 'PARCIAL', 'PAGADO', 'VENCIDO', 'ANULADO'}
TIPOS_SEGUIMIENTO_PAGO = {'ABONO', 'PAGO_TOTAL'}
MEDIOS_SEGUIMIENTO_PAGO = {'EFECTIVO', 'TRANSFERENCIA'}
CANALES_TRANSFERENCIA = {'NEQUI', 'DAVIPLATA', 'BANCO'}
COMMERCIAL_PERMISSIONS = {
    'vendedores': {
        'read': 'comercial_vendedores_read',
        'create': 'comercial_vendedores_create',
        'update': 'comercial_vendedores_update',
        'delete': 'comercial_vendedores_delete',
    },
    'clientes': {
        'read': 'comercial_clientes_read',
        'create': 'comercial_clientes_create',
        'update': 'comercial_clientes_update',
        'delete': 'comercial_clientes_delete',
    },
    'examenes': {
        'read': 'comercial_examenes_read',
        'create': 'comercial_examenes_create',
        'update': 'comercial_examenes_update',
        'delete': 'comercial_examenes_delete',
    },
    'paquetes': {
        'read': 'comercial_paquetes_read',
        'create': 'comercial_paquetes_create',
        'update': 'comercial_paquetes_update',
        'delete': 'comercial_paquetes_delete',
    },
    'tarifas': {
        'read': 'comercial_tarifas_read',
        'create': 'comercial_tarifas_create',
        'update': 'comercial_tarifas_update',
        'delete': 'comercial_tarifas_delete',
    },
    'atenciones': {
        'read': 'comercial_atenciones_read',
        'create': 'comercial_atenciones_create',
        'update': 'comercial_atenciones_update',
        'delete': 'comercial_atenciones_delete',
    },
    'documentos': {
        'read': 'comercial_documentos_read',
        'create': 'comercial_documentos_create',
        'update': 'comercial_documentos_update',
        'delete': 'comercial_documentos_delete',
    },
    'pagos': {
        'read': 'comercial_pagos_read',
        'create': 'comercial_pagos_create',
        'update': 'comercial_pagos_update',
        'delete': 'comercial_pagos_delete',
    },
    'comisiones': {
        'read': 'comercial_comisiones_read',
        'create': 'comercial_comisiones_create',
        'update': 'comercial_comisiones_update',
        'delete': 'comercial_comisiones_delete',
        'validate': 'comercial_comisiones_validate',
    },
}


def _normalize_optional_text(value):
    return (value or '').strip() or None


def _parse_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {'1', 'true', 'si', 'sí', 'yes', 'on'}


def _parse_int_field(data, field_name, *, required=False):
    raw_value = data.get(field_name)
    if raw_value in (None, ''):
        if required:
            raise ValueError(f'El campo {field_name} es obligatorio')
        return None

    try:
        return int(raw_value)
    except (ValueError, TypeError):
        raise ValueError(f'El campo {field_name} debe ser numérico')


def _parse_date_field(data, field_name):
    raw_value = data.get(field_name)
    if raw_value in (None, ''):
        return None

    try:
        return datetime.strptime(str(raw_value), '%Y-%m-%d')
    except ValueError:
        raise ValueError(f'El campo {field_name} debe tener formato YYYY-MM-DD')


def _parse_decimal_field(data, field_name, *, minimum=0, maximum=None):
    raw_value = data.get(field_name)

    if raw_value in (None, ''):
        return Decimal('0')

    try:
        value = Decimal(str(raw_value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError(f'El campo {field_name} debe ser numérico')

    if value < Decimal(str(minimum)):
        raise ValueError(f'El campo {field_name} no puede ser menor que {minimum}')

    if maximum is not None and value > Decimal(str(maximum)):
        raise ValueError(f'El campo {field_name} no puede ser mayor que {maximum}')

    return value


def _get_payload():
    if request.is_json:
        return request.get_json() or {}
    return request.form.to_dict()


def _parse_int_list_field(data, field_name):
    raw_value = data.get(field_name)
    if raw_value in (None, '', []):
        return []

    if isinstance(raw_value, str):
        values = [value.strip() for value in raw_value.split(',') if value.strip()]
    elif isinstance(raw_value, (list, tuple, set)):
        values = list(raw_value)
    else:
        raise ValueError(f'El campo {field_name} debe ser una lista')

    parsed = []
    seen = set()
    for value in values:
        try:
            parsed_value = int(value)
        except (ValueError, TypeError):
            raise ValueError(f'El campo {field_name} debe contener identificadores numericos')

        if parsed_value not in seen:
            parsed.append(parsed_value)
            seen.add(parsed_value)

    return parsed


def _is_admin_user():
    return getattr(getattr(current_user, 'role', None), 'nombre', None) == 'Administrador'


def _get_current_permission_names():
    if _is_admin_user():
        permission_names = set()
        for entity_actions in COMMERCIAL_PERMISSIONS.values():
            permission_names.update(entity_actions.values())
        return permission_names
    return get_permission_names_for_role(getattr(current_user, 'role', None))


def _has_commercial_permission(entity, action):
    if _is_admin_user():
        return True
    permission_name = COMMERCIAL_PERMISSIONS.get(entity, {}).get(action)
    if not permission_name:
        return False
    return permission_name in _get_current_permission_names()


def _require_commercial_permission(entity, action):
    if not _has_commercial_permission(entity, action):
        raise PermissionError(f'No tienes permiso para {action} en {entity}')


def _has_any_commercial_permission(*entity_action_pairs):
    return any(_has_commercial_permission(entity, action) for entity, action in entity_action_pairs)


def _get_catalog_permission_entity(tipo_item):
    normalized = str(tipo_item or '').strip().upper()
    if normalized == 'EXAMEN':
        return 'examenes'
    return 'paquetes'


def _can_read_catalog_item(item):
    if item is None:
        return False
    return _has_commercial_permission(_get_catalog_permission_entity(getattr(item, 'tipo_item', None)), 'read')


def _normalize_choice(value):
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return None
    return str(normalized).strip().upper()


def _normalize_text_for_matching(value):
    normalized = unicodedata.normalize('NFD', str(value or ''))
    normalized = ''.join(char for char in normalized if unicodedata.category(char) != 'Mn')
    return ' '.join(normalized.lower().strip().split())


def _resolver_vendedor_usuario_actual():
    if _is_admin_user():
        return None

    # 1) Vinculo directo por usuario_id (login real del vendedor).
    usuario_id = getattr(current_user, 'id', None)
    if usuario_id is not None:
        vendedor_directo = Vendedor.query.filter_by(usuario_id=usuario_id).first()
        if vendedor_directo is not None:
            return vendedor_directo

    # 2) Respaldo por coincidencia de texto (compatibilidad con datos previos
    #    a la vinculacion directa usuario<->vendedor).
    normalized_candidates = [
        _normalize_text_for_matching(getattr(current_user, 'email', None)),
        _normalize_text_for_matching(getattr(current_user, 'usuario', None)),
        _normalize_text_for_matching(getattr(current_user, 'nombre_completo', None)),
    ]
    normalized_candidates = [value for value in normalized_candidates if value]
    if not normalized_candidates:
        return None

    vendedores = Vendedor.query.all()
    for vendedor in vendedores:
        vendor_candidates = {
            _normalize_text_for_matching(vendedor.nombre),
            _normalize_text_for_matching(vendedor.email),
            _normalize_text_for_matching(vendedor.documento),
        }
        vendor_candidates.discard('')
        if any(candidate in vendor_candidates for candidate in normalized_candidates):
            return vendedor
    return None


def _asegurar_cliente_en_scope(cliente):
    if cliente is None or _is_admin_user():
        return cliente

    vendedor_scope = _resolver_vendedor_usuario_actual()
    if vendedor_scope is None:
        raise PermissionError('No tienes un vendedor asociado')
    if cliente.vendedor_id != vendedor_scope.id:
        raise PermissionError('No tienes acceso a este cliente')
    return cliente


def _obtener_cliente_comercial_en_scope(cliente_id):
    cliente = ClienteComercial.query.get_or_404(cliente_id)
    return _asegurar_cliente_en_scope(cliente)


def _split_convenio_tokens(value):
    tokens = []
    for line in str(value or '').replace('\r', '\n').split('\n'):
        for token in line.split(','):
            cleaned = token.strip()
            if cleaned:
                tokens.append(cleaned)
    return tokens


def _build_clasificacion_examen(tipo_item, tipo_examen, subtipo_laboratorio):
    if tipo_item != 'EXAMEN':
        return None, None, True

    tipo_examen = _normalize_choice(tipo_examen)
    subtipo_laboratorio = _normalize_choice(subtipo_laboratorio)

    if tipo_examen is not None and tipo_examen not in TIPOS_EXAMEN_COMERCIAL:
        raise ValueError('El tipo de examen debe ser CONSULTA, LABORATORIO, PARACLINICO, ECOBABY o CURSOS')

    if tipo_examen not in {'LABORATORIO', 'CURSOS'}:
        subtipo_laboratorio = None

    if subtipo_laboratorio is not None and subtipo_laboratorio not in TIPOS_SUBTIPO_LABORATORIO:
        raise ValueError('El subtipo del examen debe ser REMITIDO, REALIZADO o NO REMITIDO')

    if tipo_examen == 'CURSOS' and subtipo_laboratorio == 'REALIZADO':
        raise ValueError('Para CURSOS el subtipo debe ser REMITIDO o NO REMITIDO')

    clasificacion_completa = bool(tipo_examen) and (
        tipo_examen not in {'LABORATORIO', 'CURSOS'} or bool(subtipo_laboratorio)
    )

    return tipo_examen, subtipo_laboratorio, clasificacion_completa


def _format_subtipo_laboratorio(subtipo_laboratorio):
    if subtipo_laboratorio == 'REMITIDO':
        return 'REMITIDO'
    if subtipo_laboratorio == 'REALIZADO':
        return 'REALIZADO EN LABORATORIO'
    if subtipo_laboratorio == 'NO_REMITIDO':
        return 'NO REMITIDO'
    return None


def _format_clasificacion_catalogo(item):
    if item.tipo_item != 'EXAMEN':
        return item.tipo_item

    if not item.tipo_examen:
        return 'PENDIENTE DE CLASIFICAR'

    if item.tipo_examen not in {'LABORATORIO', 'CURSOS'}:
        return item.tipo_examen

    subtipo = _format_subtipo_laboratorio(item.subtipo_laboratorio)
    if subtipo:
        return f'{item.tipo_examen} / {subtipo}'
    return f'{item.tipo_examen} / SUBTIPO PENDIENTE'


def _build_vendedor_payload(data):
    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        raise ValueError('El nombre del vendedor es obligatorio')

    usuario_id = _parse_int_field(data, 'usuario_id')
    if usuario_id is not None and Usuario.query.get(usuario_id) is None:
        raise ValueError('El usuario seleccionado no existe')

    return {
        'nombre': nombre,
        'cargo': _normalize_optional_text(data.get('cargo')),
        'documento': _normalize_optional_text(data.get('documento')),
        'usuario_id': usuario_id,
        'telefono': _normalize_optional_text(data.get('telefono')),
        'email': _normalize_optional_text(data.get('email')),
        'porcentaje_comision_venta': _parse_decimal_field(
            data,
            'porcentaje_comision_venta',
            minimum=0,
            maximum=100,
        ),
        'porcentaje_comision_recaudo': _parse_decimal_field(
            data,
            'porcentaje_comision_recaudo',
            minimum=0,
            maximum=100,
        ),
        'monto_base_comision': _parse_decimal_field(
            data,
            'monto_base_comision',
            minimum=0,
        ),
        'descripcion': _normalize_optional_text(data.get('descripcion')),
        'activo': _parse_bool(data.get('activo'), True),
    }


def _build_cliente_payload(data):
    # Si el usuario logueado es un vendedor, sus clientes se asignan
    # automaticamente a el y no debe enviar (ni escoger) vendedor_id.
    vendedor_actual = _resolver_vendedor_usuario_actual()
    if vendedor_actual is not None:
        vendedor = vendedor_actual
        vendedor_id = vendedor_actual.id
    else:
        vendedor_id = _parse_int_field(data, 'vendedor_id', required=True)
        vendedor = Vendedor.query.get(vendedor_id)
        if not vendedor:
            raise ValueError('Debe seleccionar un vendedor válido')

    razon_social = (data.get('razon_social') or '').strip()
    if not razon_social:
        raise ValueError('El nombre / razón social es obligatorio')

    contacto_principal = (data.get('contacto_principal') or '').strip()
    if not contacto_principal:
        raise ValueError('La persona de contacto es obligatoria')

    telefono_empresa = (data.get('telefono_empresa') or '').strip()
    if not telefono_empresa:
        raise ValueError('El teléfono es obligatorio')

    email_empresa = (data.get('email_empresa') or '').strip()
    if not email_empresa:
        raise ValueError('El correo es obligatorio')

    # Campos que dejaron de ser obligatorios al simplificar el formulario.
    direccion = (data.get('direccion') or '').strip()
    celular_contacto_principal = (data.get('celular_contacto_principal') or '').strip()

    estado_cliente = str(data.get('estado_cliente') or 'ACTIVO').strip().upper()
    if estado_cliente not in ESTADOS_CLIENTE:
        raise ValueError('El estado del cliente debe ser ACTIVO, INACTIVO o BLOQUEO_TEMPORAL')

    medio_autorizacion = str(data.get('medio_autorizacion') or 'WHATSAPP').strip().upper()
    if medio_autorizacion not in MEDIOS_AUTORIZACION:
        raise ValueError('El medio de autorización debe ser WHATSAPP, EMAIL o PAGINA_WEB')

    condicion = str(data.get('condicion_comercial') or 'EFECTIVO').strip().upper()
    if condicion not in CONDICIONES_COMERCIALES:
        raise ValueError('La condición comercial debe ser EFECTIVO, CREDITO o MIXTO')

    requiere_factura = _parse_bool(data.get('requiere_factura'), False)
    fechas_facturacion = _normalize_optional_text(data.get('fechas_facturacion'))
    fecha_solicitud_factura = _parse_date_field(data, 'fecha_solicitud_factura')

    # Sin factura, el cliente queda como pago de contado (EFECTIVO) y sin datos
    # de facturacion. Con factura, se respeta la condicion elegida (EFECTIVO/CREDITO).
    if not requiere_factura:
        condicion = 'EFECTIVO'
        fechas_facturacion = None
        fecha_solicitud_factura = None

    return {
        'vendedor_id': vendedor_id,
        'razon_social': razon_social,
        'nombre_comercial': _normalize_optional_text(data.get('nombre_comercial')),
        'nit': _normalize_optional_text(data.get('nit')),
        'ciudad': _normalize_optional_text(data.get('ciudad')),
        'direccion': direccion,
        'telefono_empresa': telefono_empresa,
        'email_empresa': email_empresa,
        'contacto_principal': contacto_principal,
        'cargo_contacto_principal': _normalize_optional_text(data.get('cargo_contacto_principal')),
        'celular_contacto_principal': celular_contacto_principal,
        'email_contacto_principal': _normalize_optional_text(data.get('email_contacto_principal')),
        'contacto_facturacion': _normalize_optional_text(data.get('contacto_facturacion')),
        'cargo_contacto_facturacion': _normalize_optional_text(data.get('cargo_contacto_facturacion')),
        'celular_facturacion': _normalize_optional_text(data.get('celular_facturacion')),
        'email_facturacion': _normalize_optional_text(data.get('email_facturacion')),
        'medio_autorizacion': medio_autorizacion,
        'puntos_atencion_recepcion': _normalize_optional_text(data.get('puntos_atencion_recepcion')),
        'estado_cliente': estado_cliente,
        'condicion_comercial': condicion,
        'requiere_factura': requiere_factura,
        'fechas_facturacion': fechas_facturacion,
        'fecha_solicitud_factura': fecha_solicitud_factura,
        'examenes_convenidos': _normalize_optional_text(data.get('examenes_convenidos')),
        'servicios_convenidos': _normalize_optional_text(data.get('servicios_convenidos')),
        'tarifas_convenidas': _normalize_optional_text(data.get('tarifas_convenidas')),
        'documentos_legales_completos': _parse_bool(data.get('documentos_legales_completos'), False),
        'documentos_legales_detalle': _normalize_optional_text(data.get('documentos_legales_detalle')),
        'confirmado_administrativo': _parse_bool(data.get('confirmado_administrativo'), False),
        'pagare_firmado': _parse_bool(data.get('pagare_firmado'), False),
        'pagare_detalle': _normalize_optional_text(data.get('pagare_detalle')),
        'observaciones': _normalize_optional_text(data.get('observaciones')),
        'activo': estado_cliente != 'INACTIVO',
    }


def _validar_pagare_cliente(payload, cliente=None):
    # Los documentos (incluido el pagaré) ahora son opcionales y se controlan
    # con un semáforo en el formulario. No se bloquea el guardado si faltan.
    return


# Tipos de documento admitidos para el semáforo de soportes del cliente.
DOCUMENTOS_CLIENTE_TIPOS = {
    'RUT', 'CAMARA_COMERCIO', 'CEDULA_REP_LEGAL', 'CONTRATO',
    'FORMULARIO', 'ACUERDO', 'PAGARE',
}


def _guardar_documentos_cliente_por_tipo(cliente, data):
    """Guarda los archivos enviados como campos documento_<TIPO> con su tipo."""
    import json as _json
    try:
        tipos = _json.loads(data.get('documentos_tipos') or '[]')
    except (ValueError, TypeError):
        tipos = []

    for tipo in tipos:
        tipo_norm = str(tipo or '').strip().upper()
        if tipo_norm not in DOCUMENTOS_CLIENTE_TIPOS:
            continue
        archivos = [a for a in request.files.getlist(f'documento_{tipo_norm}') if getattr(a, 'filename', '')]
        if archivos:
            _guardar_adjuntos(cliente, archivos, tipo_norm)


def _build_catalogo_item_payload(data):
    tipo_item = str(data.get('tipo_item') or '').strip().upper()
    tipo_examen = data.get('tipo_examen')
    subtipo_laboratorio = data.get('subtipo_laboratorio')
    nombre = (data.get('nombre') or '').strip()

    if tipo_item not in TIPOS_CATALOGO_COMERCIAL:
        raise ValueError('El tipo de item debe ser EXAMEN, PAQUETE o SERVICIO')
    if not nombre:
        raise ValueError('El nombre del item comercial es obligatorio')

    tipo_examen, subtipo_laboratorio, clasificacion_completa = _build_clasificacion_examen(
        tipo_item,
        tipo_examen,
        subtipo_laboratorio,
    )

    return {
        'tipo_item': tipo_item,
        'tipo_examen': tipo_examen,
        'subtipo_laboratorio': subtipo_laboratorio,
        'clasificacion_completa': clasificacion_completa,
        'nombre': nombre,
        'nombre_corto': _normalize_optional_text(data.get('nombre_corto')),
        'codigo': _normalize_optional_text(data.get('codigo')),
        'descripcion': _normalize_optional_text(data.get('descripcion')),
        'tarifa_base': _parse_decimal_field(data, 'tarifa_base', minimum=0),
        'activo': _parse_bool(data.get('activo'), True),
    }


def _build_paquete_componentes_payload(data, *, item_id=None, tipo_item=None):
    tipo_validado = str(tipo_item or data.get('tipo_item') or '').strip().upper()
    componentes_ids = _parse_int_list_field(data, 'componentes_ids')

    if tipo_validado != 'PAQUETE':
        return []

    if not componentes_ids:
        raise ValueError('Debe seleccionar al menos un examen para el paquete')

    if item_id and item_id in componentes_ids:
        raise ValueError('Un paquete no puede incluirse a si mismo')

    examenes = ComercialCatalogoItem.query.filter(
        ComercialCatalogoItem.id.in_(componentes_ids)
    ).all()

    if len(examenes) != len(componentes_ids):
        raise ValueError('Uno o mas examenes seleccionados no existen en el catalogo')

    examenes_invalidos = [
        examen.nombre for examen in examenes
        if (
            examen.tipo_item != 'EXAMEN'
            or examen.tipo_examen not in TIPOS_EXAMEN_COMERCIAL
            or not examen.clasificacion_completa
        )
    ]
    if examenes_invalidos:
        raise ValueError(
            'Los componentes del paquete deben ser examenes completamente clasificados '
            'como CONSULTA, PARACLINICO, ECOBABY, CURSOS o LABORATORIO con subtipo definido'
        )

    return componentes_ids


def _build_tarifa_cliente_payload(data):
    cliente_id = _parse_int_field(data, 'cliente_id', required=True)
    item_id = _parse_int_field(data, 'catalogo_item_id', required=True)

    cliente = ClienteComercial.query.get(cliente_id)
    if not cliente:
        raise ValueError('Debe seleccionar un cliente comercial válido')

    item = ComercialCatalogoItem.query.get(item_id)
    if not item:
        raise ValueError('Debe seleccionar un examen o paquete válido')

    return {
        'cliente_id': cliente_id,
        'catalogo_item_id': item_id,
        'tarifa_negociada': _parse_decimal_field(data, 'tarifa_negociada', minimum=0),
        'vigencia_desde': _parse_date_field(data, 'vigencia_desde'),
        'vigencia_hasta': _parse_date_field(data, 'vigencia_hasta'),
        'observacion': _normalize_optional_text(data.get('observacion')),
        'activo': _parse_bool(data.get('activo'), True),
    }


def _build_seguimiento_documento_payload(data, cliente, documento=None):
    tipo_documento = str(data.get('tipo_documento') or '').strip().upper()
    if tipo_documento not in TIPOS_SEGUIMIENTO_DOCUMENTO:
        raise ValueError('El tipo de documento debe ser FACTURA, CUENTA_COBRO, VENTA_DIRECTA o INGRESO_SIN_FACTURA')

    numero_documento = _normalize_optional_text(data.get('numero_documento'))
    if tipo_documento in {'FACTURA', 'CUENTA_COBRO'} and not numero_documento:
        raise ValueError('Debes registrar el número del documento para facturas o cuentas de cobro')

    fecha_documento = _parse_date_field(data, 'fecha_documento')
    if not fecha_documento:
        raise ValueError('La fecha del documento es obligatoria')

    genera_cartera = _parse_bool(data.get('genera_cartera'), False)
    fecha_vencimiento = _parse_date_field(data, 'fecha_vencimiento')
    if genera_cartera and not fecha_vencimiento:
        raise ValueError('Debes registrar la fecha de vencimiento cuando el documento genera cartera')
    if fecha_vencimiento and fecha_vencimiento < fecha_documento:
        raise ValueError('La fecha de vencimiento no puede ser anterior a la fecha del documento')

    valor_documento = _parse_decimal_field(data, 'valor_documento', minimum=0.01)
    saldo_actual_raw = data.get('saldo_actual')
    if saldo_actual_raw not in (None, ''):
        saldo_actual = _parse_decimal_field(data, 'saldo_actual', minimum=0)
    elif documento and Decimal(str(documento.saldo_actual or 0)) != Decimal(str(documento.valor_documento or 0)):
        saldo_actual = Decimal(str(documento.saldo_actual or 0))
    else:
        saldo_actual = valor_documento

    if saldo_actual > valor_documento:
        raise ValueError('El saldo actual no puede ser mayor que el valor del documento')

    estado_documento = str(data.get('estado_documento') or (documento.estado_documento if documento else 'PENDIENTE')).strip().upper()
    if estado_documento not in ESTADOS_SEGUIMIENTO_DOCUMENTO:
        estado_documento = 'PENDIENTE'

    return {
        'cliente_id': cliente.id,
        'vendedor_id': documento.vendedor_id if documento else cliente.vendedor_id,
        'tipo_documento': tipo_documento,
        'numero_documento': numero_documento,
        'fecha_documento': fecha_documento,
        'fecha_vencimiento': fecha_vencimiento,
        'valor_documento': valor_documento,
        'saldo_actual': saldo_actual,
        'genera_cartera': genera_cartera,
        'estado_documento': estado_documento,
        'observaciones': _normalize_optional_text(data.get('observaciones')),
    }


def _build_seguimiento_pago_payload(data, documento, pago=None):
    fecha_pago = _parse_date_field(data, 'fecha_pago')
    if not fecha_pago:
        raise ValueError('La fecha del pago es obligatoria')

    valor_pago = _parse_decimal_field(data, 'valor_pago', minimum=0.01)
    tipo_pago = str(data.get('tipo_pago') or 'ABONO').strip().upper()
    if tipo_pago not in TIPOS_SEGUIMIENTO_PAGO:
        raise ValueError('El tipo de pago debe ser ABONO o PAGO_TOTAL')

    medio_pago = str(data.get('medio_pago') or 'EFECTIVO').strip().upper()
    if medio_pago not in MEDIOS_SEGUIMIENTO_PAGO:
        raise ValueError('El medio de pago debe ser EFECTIVO o TRANSFERENCIA')

    canal_transferencia = _normalize_optional_text(data.get('canal_transferencia'))
    if medio_pago == 'TRANSFERENCIA':
        canal_transferencia = str(canal_transferencia or '').strip().upper()
        if canal_transferencia not in CANALES_TRANSFERENCIA:
            raise ValueError('Debes indicar si la transferencia fue por Nequi, Daviplata o Banco')
    else:
        canal_transferencia = None

    fecha_recibo = _parse_date_field(data, 'fecha_recibo')
    paciente_documento = _normalize_optional_text(data.get('paciente_documento'))
    paciente_nombre = _normalize_optional_text(data.get('paciente_nombre'))
    fecha_atencion = _parse_date_field(data, 'fecha_atencion')
    examenes_realizados = _normalize_optional_text(data.get('examenes_realizados'))

    requiere_recibo_caja = _documento_requiere_recibo_caja(documento, medio_pago)
    if requiere_recibo_caja:
        fecha_recibo = fecha_recibo or fecha_pago
        if not paciente_documento:
            raise ValueError('Debes registrar el documento de identificación del paciente para el recibo de caja')
        if not paciente_nombre:
            raise ValueError('Debes registrar el nombre del paciente para el recibo de caja')
        if not fecha_atencion:
            raise ValueError('Debes registrar la fecha de atención para el recibo de caja')
        if not examenes_realizados:
            raise ValueError('Debes registrar los exámenes realizados para el recibo de caja')
    else:
        fecha_recibo = None
        paciente_documento = None
        paciente_nombre = None
        fecha_atencion = None
        examenes_realizados = None

    total_otros_pagos = Decimal('0')
    for pago_existente in documento.pagos.all():
        if pago and pago_existente.id == pago.id:
            continue
        total_otros_pagos += Decimal(str(pago_existente.valor_pago or 0))

    valor_documento = Decimal(str(documento.valor_documento or 0))
    if total_otros_pagos + valor_pago > valor_documento:
        raise ValueError('El pago no puede superar el saldo disponible del documento')

    return {
        'documento_id': documento.id,
        'cliente_id': documento.cliente_id,
        'vendedor_id': documento.vendedor_id,
        'fecha_pago': fecha_pago,
        'valor_pago': valor_pago,
        'tipo_pago': tipo_pago,
        'medio_pago': medio_pago,
        'canal_transferencia': canal_transferencia,
        'fecha_recibo': fecha_recibo,
        'paciente_documento': paciente_documento,
        'paciente_nombre': paciente_nombre,
        'fecha_atencion': fecha_atencion,
        'examenes_realizados': examenes_realizados,
        'observaciones': _normalize_optional_text(data.get('observaciones')),
    }


def _tarifa_cliente_aplica_en_fecha(tarifa, fecha_referencia):
    if tarifa is None or tarifa.activo is not True:
        return False

    fecha_base = (fecha_referencia or datetime.utcnow()).date()
    if tarifa.vigencia_desde and tarifa.vigencia_desde.date() > fecha_base:
        return False
    if tarifa.vigencia_hasta and tarifa.vigencia_hasta.date() < fecha_base:
        return False
    return True


def _resolver_valor_cliente_item(item, tarifa, fecha_referencia):
    if tarifa and _tarifa_cliente_aplica_en_fecha(tarifa, fecha_referencia):
        return Decimal(str(tarifa.tarifa_negociada or 0)), True
    return Decimal(str(item.tarifa_base or 0)), False


def _build_cliente_convenio_items(cliente, fecha_referencia=None):
    items_catalogo = ComercialCatalogoItem.query.filter_by(activo=True).order_by(
        ComercialCatalogoItem.tipo_item.asc(),
        ComercialCatalogoItem.nombre.asc(),
    ).all()
    tarifas_cliente = ClienteComercialTarifa.query.filter_by(
        cliente_id=cliente.id,
        activo=True,
    ).all()
    tarifas_por_item = {
        tarifa.catalogo_item_id: tarifa
        for tarifa in tarifas_cliente
        if tarifa.item_catalogo is not None and tarifa.item_catalogo.activo is True
    }

    items_por_clave = {}
    items_examen = []
    items_servicio = []
    for item in items_catalogo:
        if item.tipo_item == 'EXAMEN' and item.clasificacion_completa is not True:
            continue

        keys = {
            _normalize_text_for_matching(item.nombre),
            _normalize_text_for_matching(item.codigo),
        }
        for key in keys:
            if key:
                items_por_clave[key] = item

        if item.tipo_item == 'EXAMEN':
            items_examen.append(item)
        elif item.tipo_item in {'PAQUETE', 'SERVICIO'}:
            items_servicio.append(item)

    permitidos_ids = set(tarifas_por_item.keys())
    for token in _split_convenio_tokens(cliente.examenes_convenidos):
        item = items_por_clave.get(_normalize_text_for_matching(token))
        if item and item.tipo_item == 'EXAMEN':
            permitidos_ids.add(item.id)

    for token in _split_convenio_tokens(cliente.servicios_convenidos):
        item = items_por_clave.get(_normalize_text_for_matching(token))
        if item and item.tipo_item in {'PAQUETE', 'SERVICIO'}:
            permitidos_ids.add(item.id)

    convenio_items = []
    for item in items_catalogo:
        if item.id not in permitidos_ids:
            continue
        tarifa = tarifas_por_item.get(item.id)
        valor_unitario, tiene_tarifa_vigente = _resolver_valor_cliente_item(item, tarifa, fecha_referencia)
        convenio_items.append({
            'id': item.id,
            'tipo_item': item.tipo_item,
            'tipo_examen': item.tipo_examen,
            'subtipo_laboratorio': item.subtipo_laboratorio,
            'clasificacion_resumen': _format_clasificacion_catalogo(item),
            'nombre': item.nombre,
            'codigo': item.codigo,
            'valor_unitario': float(valor_unitario),
            'tarifa_base': float(item.tarifa_base or 0),
            'tiene_tarifa_negociada': tarifa is not None,
            'tarifa_vigente': tiene_tarifa_vigente,
            'componentes': [
                detalle.examen.nombre
                for detalle in (item.paquete_componentes or [])
                if detalle.examen is not None and detalle.examen.nombre
            ] if item.tipo_item == 'PAQUETE' else [],
        })

    convenio_items.sort(key=lambda item: ((item['tipo_item'] or ''), (item['nombre'] or '').lower()))
    return convenio_items


def _build_cliente_convenio_items_index(cliente, fecha_referencia=None):
    return {
        item['id']: item
        for item in _build_cliente_convenio_items(cliente, fecha_referencia)
    }


def _parse_atencion_detalles(raw_value):
    if raw_value in (None, '', []):
        return []

    parsed = raw_value
    if isinstance(raw_value, str):
        try:
            parsed = json.loads(raw_value)
        except json.JSONDecodeError:
            raise ValueError('El detalle de la atencion debe enviarse como una lista valida')

    if not isinstance(parsed, (list, tuple)):
        raise ValueError('El detalle de la atencion debe enviarse como una lista')

    return list(parsed)


def _resolver_estado_cobro_atencion(valor_total, saldo_pendiente):
    total = Decimal(str(valor_total or 0))
    saldo = Decimal(str(saldo_pendiente or 0))
    if saldo <= 0:
        return 'PAGADO'
    if saldo < total:
        return 'PARCIAL'
    return 'PENDIENTE'


def _generar_numero_atencion(atencion):
    fecha_base = atencion.fecha_atencion or datetime.utcnow()
    return f'AT-{fecha_base.strftime("%Y%m%d")}-{int(atencion.id):06d}'


def _build_atencion_payload(data, cliente):
    fecha_atencion = _parse_date_field(data, 'fecha_atencion')
    if not fecha_atencion:
        raise ValueError('La fecha de atencion es obligatoria')

    detalles_payload = _parse_atencion_detalles(data.get('detalles'))
    if not detalles_payload:
        raise ValueError('Debes seleccionar al menos un examen o paquete convenido')

    items_convenio = _build_cliente_convenio_items_index(cliente, fecha_atencion)
    detalles = []
    total = Decimal('0')
    pacientes_unicos = []
    pacientes_seen = set()

    for detalle in detalles_payload:
        raw_item_id = detalle
        paciente_documento = None
        paciente_nombre = None
        if isinstance(detalle, dict):
            raw_item_id = detalle.get('catalogo_item_id') or detalle.get('id')
            paciente_documento = _normalize_optional_text(detalle.get('paciente_documento'))
            paciente_nombre = _normalize_optional_text(detalle.get('paciente_nombre'))

        try:
            item_id = int(raw_item_id)
        except (TypeError, ValueError):
            raise ValueError('Cada detalle de la atencion debe incluir un item comercial valido')

        if not paciente_documento:
            raise ValueError('Cada detalle debe registrar el documento del paciente')
        if not paciente_nombre:
            raise ValueError('Cada detalle debe registrar el nombre del paciente')

        item = items_convenio.get(item_id)
        if item is None:
            raise ValueError('Solo puedes registrar examenes o paquetes convenidos para este cliente')

        valor_item = Decimal(str(item['valor_unitario'] or 0))
        if valor_item < Decimal('0'):
            raise ValueError('El valor del item convenido no es valido')

        detalles.append({
            'paciente_documento': paciente_documento,
            'paciente_nombre': paciente_nombre,
            'catalogo_item_id': item_id,
            'tipo_item': item['tipo_item'],
            'nombre_item': item['nombre'],
            'valor_item': valor_item,
        })
        total += valor_item
        paciente_key = (paciente_documento, paciente_nombre)
        if paciente_key not in pacientes_seen:
            pacientes_unicos.append({
                'documento': paciente_documento,
                'nombre': paciente_nombre,
            })
            pacientes_seen.add(paciente_key)

    if not detalles:
        raise ValueError('Debes seleccionar al menos un examen o paquete convenido')
    if total <= Decimal('0'):
        raise ValueError('La atencion debe tener un valor mayor que cero')

    paciente_principal = pacientes_unicos[0]
    if len(pacientes_unicos) == 1:
        paciente_documento_resumen = paciente_principal['documento']
        paciente_nombre_resumen = paciente_principal['nombre']
    else:
        paciente_documento_resumen = 'VARIOS'
        paciente_nombre_resumen = f'{len(pacientes_unicos)} pacientes'

    return {
        'cliente_id': cliente.id,
        'vendedor_id': cliente.vendedor_id,
        'fecha_atencion': fecha_atencion,
        'paciente_documento': paciente_documento_resumen,
        'paciente_nombre': paciente_nombre_resumen,
        'valor_total': total,
        'saldo_pendiente': total,
        'estado_cobro': _resolver_estado_cobro_atencion(total, total),
        'observaciones': _normalize_optional_text(data.get('observaciones')),
        'detalles': detalles,
    }


def _serialize_atencion_detalle(detalle):
    return {
        'id': detalle.id,
        'paciente_documento': detalle.paciente_documento,
        'paciente_nombre': detalle.paciente_nombre,
        'catalogo_item_id': detalle.catalogo_item_id,
        'tipo_item': detalle.tipo_item,
        'nombre_item': detalle.nombre_item,
        'valor_item': float(detalle.valor_item or 0),
    }


def _serialize_atencion(atencion):
    detalles = sorted(
        atencion.detalles or [],
        key=lambda detalle: (
            (detalle.paciente_nombre or '').lower(),
            (detalle.nombre_item or '').lower(),
            detalle.id or 0,
        ),
    )
    pacientes = []
    pacientes_seen = set()
    for detalle in detalles:
        paciente_key = (detalle.paciente_documento or '', detalle.paciente_nombre or '')
        if paciente_key in pacientes_seen:
            continue
        pacientes.append({
            'documento': detalle.paciente_documento,
            'nombre': detalle.paciente_nombre,
        })
        pacientes_seen.add(paciente_key)

    pacientes_resumen = ', '.join(
        paciente['nombre'] for paciente in pacientes if paciente.get('nombre')
    ) or atencion.paciente_nombre

    return {
        'id': atencion.id,
        'nro_atencion': atencion.nro_atencion,
        'cliente_id': atencion.cliente_id,
        'cliente_nombre': atencion.cliente.razon_social if atencion.cliente else None,
        'vendedor_id': atencion.vendedor_id,
        'vendedor_nombre': atencion.vendedor.nombre if atencion.vendedor else None,
        'fecha_atencion': atencion.fecha_atencion.strftime('%Y-%m-%d') if atencion.fecha_atencion else None,
        'paciente_documento': atencion.paciente_documento,
        'paciente_nombre': atencion.paciente_nombre,
        'cantidad_pacientes': len(pacientes),
        'pacientes_resumen': pacientes_resumen,
        'pacientes': pacientes,
        'valor_total': float(atencion.valor_total or 0),
        'saldo_pendiente': float(atencion.saldo_pendiente or 0),
        'estado_cobro': atencion.estado_cobro,
        'observaciones': atencion.observaciones,
        'documento_id': atencion.documento_cobro.id if atencion.documento_cobro else None,
        'documento_tipo': atencion.documento_cobro.tipo_documento if atencion.documento_cobro else None,
        'documento_numero': atencion.documento_cobro.numero_documento if atencion.documento_cobro else None,
        'detalle_resumen': ', '.join(
            f'{detalle.paciente_nombre}: {detalle.nombre_item}'
            for detalle in detalles
            if detalle.nombre_item
        ),
        'detalle_items_resumen': ', '.join(detalle.nombre_item for detalle in detalles if detalle.nombre_item),
        'detalles': [_serialize_atencion_detalle(detalle) for detalle in detalles],
        'created_at': atencion.created_at.strftime('%Y-%m-%d %H:%M:%S') if atencion.created_at else None,
        'updated_at': atencion.updated_at.strftime('%Y-%m-%d %H:%M:%S') if atencion.updated_at else None,
    }


def _construir_resumen_anticipo_detalles(detalles_payload):
    pacientes = []
    pacientes_seen = set()
    examenes = []
    examenes_seen = set()

    for detalle in detalles_payload or []:
        paciente_key = (
            _normalize_optional_text(detalle.get('paciente_documento')) or '',
            _normalize_optional_text(detalle.get('paciente_nombre')) or '',
        )
        if paciente_key not in pacientes_seen and any(paciente_key):
            pacientes.append({
                'documento': paciente_key[0],
                'nombre': paciente_key[1],
            })
            pacientes_seen.add(paciente_key)

        nombre_item = _normalize_optional_text(detalle.get('nombre_item'))
        if nombre_item and nombre_item not in examenes_seen:
            examenes.append(nombre_item)
            examenes_seen.add(nombre_item)

    if len(pacientes) == 1:
        paciente_documento = pacientes[0]['documento']
        paciente_nombre = pacientes[0]['nombre']
    elif pacientes:
        paciente_documento = 'VARIOS'
        paciente_nombre = f'{len(pacientes)} pacientes'
    else:
        paciente_documento = None
        paciente_nombre = None

    return {
        'paciente_documento': paciente_documento,
        'paciente_nombre': paciente_nombre,
        'examenes_realizados': ', '.join(examenes),
    }


def _sincronizar_atencion_desde_documento(documento):
    if documento is None or documento.atencion is None:
        return

    atencion = documento.atencion
    atencion.valor_total = documento.valor_documento
    atencion.saldo_pendiente = documento.saldo_actual
    atencion.estado_cobro = _resolver_estado_cobro_atencion(documento.valor_documento, documento.saldo_actual)


def _serialize_vendedor(vendedor):
    return {
        'id': vendedor.id,
        'nombre': vendedor.nombre,
        'cargo': vendedor.cargo,
        'documento': vendedor.documento,
        'telefono': vendedor.telefono,
        'email': vendedor.email,
        'usuario_id': vendedor.usuario_id,
        'usuario_nombre': vendedor.usuario.nombre_completo if vendedor.usuario else None,
        'usuario_login': vendedor.usuario.usuario if vendedor.usuario else None,
        'porcentaje_comision_venta': float(vendedor.porcentaje_comision_venta or 0),
        'porcentaje_comision_recaudo': float(vendedor.porcentaje_comision_recaudo or 0),
        'monto_base_comision': float(vendedor.monto_base_comision or 0),
        'descripcion': vendedor.descripcion,
        'activo': vendedor.activo,
    }


def _serialize_adjunto(cliente, adjunto):
    return {
        'id': adjunto.id,
        'tipo_documento': adjunto.tipo_documento,
        'nombre_original': adjunto.nombre_original,
        'mime_type': adjunto.mime_type,
        'tamano_bytes': adjunto.tamano_bytes,
        'created_at': adjunto.created_at.strftime('%Y-%m-%d %H:%M:%S') if adjunto.created_at else None,
        'download_url': f'/api/comercial/clientes/{cliente.id}/adjuntos/{adjunto.id}',
    }


def _serialize_catalogo_item(item):
    componentes = sorted(
        [
            {
                'id': detalle.examen_id,
                'nombre': detalle.examen.nombre if detalle.examen else None,
                'codigo': detalle.examen.codigo if detalle.examen else None,
                'tipo_examen': detalle.examen.tipo_examen if detalle.examen else None,
                'subtipo_laboratorio': detalle.examen.subtipo_laboratorio if detalle.examen else None,
                'clasificacion_resumen': _format_clasificacion_catalogo(detalle.examen) if detalle.examen else None,
                'cantidad': detalle.cantidad,
            }
            for detalle in (item.paquete_componentes or [])
            if detalle.examen is not None
        ],
        key=lambda componente: (componente['nombre'] or '').lower()
    )

    return {
        'id': item.id,
        'tipo_item': item.tipo_item,
        'tipo_examen': item.tipo_examen,
        'subtipo_laboratorio': item.subtipo_laboratorio,
        'clasificacion_completa': item.clasificacion_completa,
        'clasificacion_resumen': _format_clasificacion_catalogo(item),
        'nombre': item.nombre,
        'nombre_corto': item.nombre_corto,
        'codigo': item.codigo,
        'descripcion': item.descripcion,
        'tarifa_base': float(item.tarifa_base or 0),
        'activo': item.activo,
        'componentes_ids': [componente['id'] for componente in componentes],
        'componentes': componentes,
        'cantidad_componentes': len(componentes),
        'resumen_componentes': ', '.join(
            componente['nombre'] for componente in componentes if componente['nombre']
        ) or None,
        'created_at': item.created_at.strftime('%Y-%m-%d %H:%M:%S') if item.created_at else None,
        'updated_at': item.updated_at.strftime('%Y-%m-%d %H:%M:%S') if item.updated_at else None,
    }


def _serialize_tarifa_cliente(tarifa):
    return {
        'id': tarifa.id,
        'cliente_id': tarifa.cliente_id,
        'cliente_nombre': tarifa.cliente.razon_social if tarifa.cliente else None,
        'catalogo_item_id': tarifa.catalogo_item_id,
        'item_nombre': tarifa.item_catalogo.nombre if tarifa.item_catalogo else None,
        'tipo_item': tarifa.item_catalogo.tipo_item if tarifa.item_catalogo else None,
        'tipo_examen': tarifa.item_catalogo.tipo_examen if tarifa.item_catalogo else None,
        'subtipo_laboratorio': tarifa.item_catalogo.subtipo_laboratorio if tarifa.item_catalogo else None,
        'clasificacion_completa': tarifa.item_catalogo.clasificacion_completa if tarifa.item_catalogo else None,
        'clasificacion_resumen': _format_clasificacion_catalogo(tarifa.item_catalogo) if tarifa.item_catalogo else None,
        'tarifa_base': float(tarifa.item_catalogo.tarifa_base or 0) if tarifa.item_catalogo else 0,
        'tarifa_negociada': float(tarifa.tarifa_negociada or 0),
        'vigencia_desde': tarifa.vigencia_desde.strftime('%Y-%m-%d') if tarifa.vigencia_desde else None,
        'vigencia_hasta': tarifa.vigencia_hasta.strftime('%Y-%m-%d') if tarifa.vigencia_hasta else None,
        'observacion': tarifa.observacion,
        'activo': tarifa.activo,
    }


def _guardar_componentes_paquete(item, componentes_ids):
    # Eliminar explícitamente los componentes existentes en la BD
    # antes de insertar los nuevos, para evitar violación de unicidad
    # cuando SQLAlchemy intenta hacer INSERT antes del DELETE en la misma transacción.
    if item.id:
        ComercialPaqueteDetalle.query.filter_by(paquete_id=item.id).delete()
        db.session.flush()

    item.paquete_componentes = []

    if item.tipo_item != 'PAQUETE':
        return

    for examen_id in componentes_ids:
        item.paquete_componentes.append(
            ComercialPaqueteDetalle(examen_id=examen_id, cantidad=1)
        )


def _resumen_facturacion(cliente):
    if not cliente.requiere_factura:
        return 'Cliente en efectivo. Si luego requiere factura, la primera factura se registrará desde el módulo de facturación.'

    partes = ['Factura requerida']
    if cliente.fechas_facturacion:
        partes.append(f'Fechas: {cliente.fechas_facturacion}')
    if cliente.fecha_solicitud_factura:
        partes.append(f'Primera factura: {cliente.fecha_solicitud_factura.strftime("%Y-%m-%d")}')
    return ' | '.join(partes)


def _resolver_estado_seguimiento_documento(documento):
    estado_actual = str(documento.estado_documento or 'PENDIENTE').upper()
    if estado_actual == 'ANULADO':
        return 'ANULADO'

    saldo_actual = Decimal(str(documento.saldo_actual or 0))
    valor_documento = Decimal(str(documento.valor_documento or 0))

    if saldo_actual <= 0:
        return 'PAGADO'
    if saldo_actual < valor_documento:
        return 'PARCIAL'
    if documento.genera_cartera and documento.fecha_vencimiento and documento.fecha_vencimiento.date() < datetime.utcnow().date():
        return 'VENCIDO'
    return 'PENDIENTE'


def _serialize_seguimiento_documento(documento):
    return {
        'id': documento.id,
        'cliente_id': documento.cliente_id,
        'atencion_id': documento.atencion_id,
        'es_atencion': documento.atencion_id is not None,
        'cliente_nombre': documento.cliente.razon_social if documento.cliente else None,
        'vendedor_id': documento.vendedor_id,
        'vendedor_nombre': documento.vendedor.nombre if documento.vendedor else None,
        'tipo_documento': documento.tipo_documento,
        'numero_documento': documento.numero_documento,
        'fecha_documento': documento.fecha_documento.strftime('%Y-%m-%d') if documento.fecha_documento else None,
        'fecha_vencimiento': documento.fecha_vencimiento.strftime('%Y-%m-%d') if documento.fecha_vencimiento else None,
        'valor_documento': float(documento.valor_documento or 0),
        'saldo_actual': float(documento.saldo_actual or 0),
        'genera_cartera': documento.genera_cartera,
        'estado_documento': _resolver_estado_seguimiento_documento(documento),
        'observaciones': documento.observaciones,
        'created_at': documento.created_at.strftime('%Y-%m-%d %H:%M:%S') if documento.created_at else None,
        'updated_at': documento.updated_at.strftime('%Y-%m-%d %H:%M:%S') if documento.updated_at else None,
    }


def _serialize_seguimiento_pago(pago):
    return {
        'id': pago.id,
        'documento_id': pago.documento_id,
        'cliente_id': pago.cliente_id,
        'cliente_nombre': pago.cliente.razon_social if pago.cliente else None,
        'vendedor_id': pago.vendedor_id,
        'vendedor_nombre': pago.vendedor.nombre if pago.vendedor else None,
        'documento_numero': pago.documento.numero_documento if pago.documento else None,
        'documento_tipo': pago.documento.tipo_documento if pago.documento else None,
        'fecha_pago': pago.fecha_pago.strftime('%Y-%m-%d') if pago.fecha_pago else None,
        'fecha_recibo': pago.fecha_recibo.strftime('%Y-%m-%d') if pago.fecha_recibo else None,
        'valor_pago': float(pago.valor_pago or 0),
        'tipo_pago': pago.tipo_pago,
        'medio_pago': pago.medio_pago,
        'canal_transferencia': pago.canal_transferencia,
        'numero_recibo_caja': pago.numero_recibo_caja,
        'paciente_documento': pago.paciente_documento,
        'paciente_nombre': pago.paciente_nombre,
        'fecha_atencion': pago.fecha_atencion.strftime('%Y-%m-%d') if pago.fecha_atencion else None,
        'examenes_realizados': pago.examenes_realizados,
        'requiere_recibo_caja': _documento_requiere_recibo_caja(pago.documento, pago.medio_pago),
        'observaciones': pago.observaciones,
        'comprobante_nombre': pago.nombre_comprobante,
        'comprobante_url': f'/api/comercial/seguimiento-pagos/{pago.id}/comprobante' if pago.ruta_comprobante else None,
        'created_at': pago.created_at.strftime('%Y-%m-%d %H:%M:%S') if pago.created_at else None,
        'updated_at': pago.updated_at.strftime('%Y-%m-%d %H:%M:%S') if pago.updated_at else None,
    }


def _serialize_cliente(cliente):
    adjuntos = cliente.adjuntos.order_by(ClienteComercialAdjunto.created_at.desc(), ClienteComercialAdjunto.id.desc()).all()
    documentos_legales = [
        _serialize_adjunto(cliente, adjunto)
        for adjunto in adjuntos
        if adjunto.tipo_documento == 'DOCUMENTO_LEGAL'
    ]
    pagares = [
        _serialize_adjunto(cliente, adjunto)
        for adjunto in adjuntos
        if adjunto.tipo_documento == 'PAGARE'
    ]
    nit = (cliente.nit or '').strip()
    nit_sin_digito = nit.split('-', 1)[0].strip()
    confirmado_contable = bool(nit and SiigoCliente.query.filter(
        SiigoCliente.identificacion.in_([nit, nit_sin_digito])
    ).first())
    estado_integracion = (
        'LISTO' if cliente.confirmado_administrativo and confirmado_contable
        else 'PENDIENTE_AMBOS' if not cliente.confirmado_administrativo and not confirmado_contable
        else 'PENDIENTE_ADMINISTRATIVO' if not cliente.confirmado_administrativo
        else 'PENDIENTE_CONTABLE'
    )

    return {
        'id': cliente.id,
        'vendedor_id': cliente.vendedor_id,
        'vendedor_nombre': cliente.vendedor.nombre if cliente.vendedor else None,
        'razon_social': cliente.razon_social,
        'nombre_comercial': cliente.nombre_comercial,
        'nit': cliente.nit,
        'ciudad': cliente.ciudad,
        'direccion': cliente.direccion,
        'telefono_empresa': cliente.telefono_empresa,
        'email_empresa': cliente.email_empresa,
        'contacto_principal': cliente.contacto_principal,
        'cargo_contacto_principal': cliente.cargo_contacto_principal,
        'celular_contacto_principal': cliente.celular_contacto_principal,
        'email_contacto_principal': cliente.email_contacto_principal,
        'contacto_facturacion': cliente.contacto_facturacion,
        'cargo_contacto_facturacion': cliente.cargo_contacto_facturacion,
        'celular_facturacion': cliente.celular_facturacion,
        'email_facturacion': cliente.email_facturacion,
        'medio_autorizacion': cliente.medio_autorizacion,
        'puntos_atencion_recepcion': cliente.puntos_atencion_recepcion,
        'estado_cliente': cliente.estado_cliente or ('ACTIVO' if cliente.activo else 'INACTIVO'),
        'condicion_comercial': cliente.condicion_comercial,
        'requiere_factura': cliente.requiere_factura,
        'fechas_facturacion': cliente.fechas_facturacion,
        'fecha_solicitud_factura': cliente.fecha_solicitud_factura.strftime('%Y-%m-%d') if cliente.fecha_solicitud_factura else None,
        'resumen_facturacion': _resumen_facturacion(cliente),
        'examenes_convenidos': cliente.examenes_convenidos,
        'servicios_convenidos': cliente.servicios_convenidos,
        'tarifas_convenidas': cliente.tarifas_convenidas,
        'documentos_legales_completos': cliente.documentos_legales_completos,
        'documentos_legales_detalle': cliente.documentos_legales_detalle,
        'confirmado_administrativo': cliente.confirmado_administrativo,
        'confirmado_administrativo_at': cliente.confirmado_administrativo_at.strftime('%Y-%m-%d %H:%M:%S') if cliente.confirmado_administrativo_at else None,
        'confirmado_contable': confirmado_contable,
        'estado_integracion': estado_integracion,
        'pagare_firmado': cliente.pagare_firmado,
        'pagare_detalle': cliente.pagare_detalle,
        'observaciones': cliente.observaciones,
        'activo': cliente.activo,
        'documentos_legales_adjuntos': documentos_legales,
        'pagare_adjuntos': pagares,
        'adjuntos': [_serialize_adjunto(cliente, adjunto) for adjunto in adjuntos],
        'created_at': cliente.created_at.strftime('%Y-%m-%d %H:%M:%S') if cliente.created_at else None,
        'updated_at': cliente.updated_at.strftime('%Y-%m-%d %H:%M:%S') if cliente.updated_at else None,
    }


def _cliente_ya_existe_en_interfaces(nit, razon_social):
    nit = (nit or '').strip()
    nit_base = nit.split('-', 1)[0].strip()
    if nit and SiigoCliente.query.filter(SiigoCliente.identificacion.in_([nit, nit_base])).first():
        return 'Contable (SIIGO)'
    if razon_social and AtencionDiaDetalle.query.filter(
        AtencionDiaDetalle.acuerdo_comercial.ilike(razon_social.strip())
    ).first():
        return 'Administrativo'
    return None


def _cliente_habilitado_para_atenciones(cliente):
    nit = (cliente.nit or '').strip()
    nit_sin_digito = nit.split('-', 1)[0].strip()
    confirmado_contable = bool(nit and SiigoCliente.query.filter(
        SiigoCliente.identificacion.in_([nit, nit_sin_digito])
    ).first())
    return bool(cliente.confirmado_administrativo and confirmado_contable)


def _guardar_adjuntos(cliente, archivos, tipo_documento):
    upload_root = current_app.config['UPLOAD_FOLDER']
    cliente_dir = os.path.join(upload_root, 'comercial', 'clientes', str(cliente.id), tipo_documento.lower())
    os.makedirs(cliente_dir, exist_ok=True)

    for archivo in archivos:
        if not archivo or not archivo.filename:
            continue

        nombre_original = secure_filename(archivo.filename)
        if not nombre_original:
            continue

        nombre_guardado = f'{uuid.uuid4().hex}_{nombre_original}'
        ruta_absoluta = os.path.join(cliente_dir, nombre_guardado)
        archivo.save(ruta_absoluta)

        adjunto = ClienteComercialAdjunto(
            cliente_id=cliente.id,
            tipo_documento=tipo_documento,
            nombre_original=nombre_original,
            nombre_guardado=nombre_guardado,
            ruta_relativa=os.path.relpath(ruta_absoluta, upload_root),
            mime_type=archivo.mimetype,
            tamano_bytes=os.path.getsize(ruta_absoluta),
        )
        db.session.add(adjunto)


def _guardar_comprobante_pago(pago, archivo):
    if not archivo or not archivo.filename:
        return

    upload_root = current_app.config['UPLOAD_FOLDER']
    pago_dir = os.path.join(upload_root, 'comercial', 'clientes', str(pago.cliente_id), 'seguimiento_pagos')
    os.makedirs(pago_dir, exist_ok=True)

    nombre_original = secure_filename(archivo.filename)
    if not nombre_original:
        return

    nombre_guardado = f'{uuid.uuid4().hex}_{nombre_original}'
    ruta_absoluta = os.path.join(pago_dir, nombre_guardado)
    archivo.save(ruta_absoluta)

    _eliminar_comprobante_pago(pago)

    pago.nombre_comprobante = nombre_original
    pago.ruta_comprobante = os.path.relpath(ruta_absoluta, upload_root)
    pago.mime_type = archivo.mimetype
    pago.tamano_bytes = os.path.getsize(ruta_absoluta)


def _eliminar_comprobante_pago(pago):
    if not pago.ruta_comprobante:
        return

    upload_root = os.path.abspath(current_app.config['UPLOAD_FOLDER'])
    ruta = os.path.abspath(os.path.join(upload_root, pago.ruta_comprobante))
    if ruta.startswith(upload_root) and os.path.exists(ruta):
        try:
            os.remove(ruta)
        except OSError:
            logger.warning('No se pudo eliminar el comprobante de pago %s', ruta)

    pago.nombre_comprobante = None
    pago.ruta_comprobante = None
    pago.mime_type = None
    pago.tamano_bytes = None


def _get_pago_comprobante_path(pago):
    if not pago.ruta_comprobante:
        raise FileNotFoundError('Comprobante no encontrado')
    upload_root = os.path.abspath(current_app.config['UPLOAD_FOLDER'])
    ruta = os.path.abspath(os.path.join(upload_root, pago.ruta_comprobante))
    if not ruta.startswith(upload_root):
        raise FileNotFoundError('Ruta de comprobante inválida')
    if not os.path.exists(ruta):
        raise FileNotFoundError('Comprobante no encontrado')
    return ruta


def _eliminar_adjunto_cliente(adjunto):
    if not adjunto.ruta_relativa:
        return

    upload_root = os.path.abspath(current_app.config['UPLOAD_FOLDER'])
    ruta = os.path.abspath(os.path.join(upload_root, adjunto.ruta_relativa))
    if ruta.startswith(upload_root) and os.path.exists(ruta):
        try:
            os.remove(ruta)
        except OSError:
            logger.warning('No se pudo eliminar el adjunto comercial %s', ruta)


def _eliminar_directorio_cliente(cliente_id):
    upload_root = os.path.abspath(current_app.config['UPLOAD_FOLDER'])
    cliente_dir = os.path.abspath(os.path.join(upload_root, 'comercial', 'clientes', str(cliente_id)))
    if cliente_dir.startswith(upload_root) and os.path.isdir(cliente_dir):
        try:
            shutil.rmtree(cliente_dir)
        except OSError:
            logger.warning('No se pudo eliminar el directorio comercial del cliente %s', cliente_dir)


def _documento_requiere_recibo_caja(documento, medio_pago):
    if documento is None:
        return False
    cliente = documento.cliente
    return (
        medio_pago == 'EFECTIVO'
        and cliente is not None
        and cliente.requiere_factura is False
    )


def _generar_numero_recibo_caja(pago):
    fecha_base = pago.fecha_recibo or pago.fecha_pago or datetime.utcnow()
    return f'RC-{fecha_base.strftime("%Y%m%d")}-{int(pago.id):06d}'


def _recalcular_documento_con_pagos(documento):
    total_pagado = Decimal('0')
    for pago in documento.pagos.all():
        total_pagado += Decimal(str(pago.valor_pago or 0))

    valor_documento = Decimal(str(documento.valor_documento or 0))
    saldo = valor_documento - total_pagado
    if saldo < Decimal('0'):
        saldo = Decimal('0')

    documento.saldo_actual = saldo
    documento.estado_documento = _resolver_estado_seguimiento_documento(documento)
    _sincronizar_atencion_desde_documento(documento)


def _get_adjunto_path(adjunto):
    upload_root = os.path.abspath(current_app.config['UPLOAD_FOLDER'])
    ruta = os.path.abspath(os.path.join(upload_root, adjunto.ruta_relativa))
    if not ruta.startswith(upload_root):
        raise FileNotFoundError('Ruta de adjunto inválida')
    if not os.path.exists(ruta):
        raise FileNotFoundError('Adjunto no encontrado')
    return ruta


@comercial_bp.route('/vendedores', methods=['GET'])
@login_required
def get_vendedores():
    try:
        _require_commercial_permission('vendedores', 'read')
        vendedores = Vendedor.query.order_by(Vendedor.activo.desc(), Vendedor.nombre.asc()).all()
        return jsonify([_serialize_vendedor(vendedor) for vendedor in vendedores]), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        logger.error("Error obteniendo vendedores comerciales: %s", exc)
        return jsonify({'error': 'Error al obtener vendedores'}), 500


@comercial_bp.route('/vendedores/usuarios-asignables', methods=['GET'])
@login_required
def get_usuarios_asignables_vendedor():
    """Usuarios del sistema que el admin puede vincular como login de un vendedor.

    Devuelve los usuarios activos e indica cuáles ya están ocupados por otro
    vendedor (para poder mostrarlos deshabilitados en el selector)."""
    try:
        _require_commercial_permission('vendedores', 'read')

        vendedor_id = request.args.get('vendedor_id', type=int)
        ocupados = {
            v.usuario_id: v.nombre
            for v in Vendedor.query.filter(Vendedor.usuario_id.isnot(None)).all()
            if v.usuario_id is not None
        }

        usuarios = Usuario.query.filter_by(activo=True).order_by(Usuario.nombre_completo.asc()).all()
        resultado = []
        for usuario in usuarios:
            asignado_a = ocupados.get(usuario.id)
            disponible = asignado_a is None or (
                vendedor_id is not None and usuario.id == _usuario_id_del_vendedor(vendedor_id)
            )
            resultado.append({
                'id': usuario.id,
                'nombre_completo': usuario.nombre_completo,
                'usuario': usuario.usuario,
                'email': usuario.email,
                'disponible': disponible,
                'vendedor_asignado': asignado_a if not disponible else None,
            })
        return jsonify(resultado), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        logger.error("Error obteniendo usuarios asignables a vendedor: %s", exc)
        return jsonify({'error': 'Error al obtener usuarios asignables'}), 500


def _usuario_id_del_vendedor(vendedor_id):
    vendedor = Vendedor.query.get(vendedor_id)
    return vendedor.usuario_id if vendedor else None


@comercial_bp.route('/vendedores', methods=['POST'])
@login_required
def crear_vendedor():
    data = _get_payload()

    try:
        _require_commercial_permission('vendedores', 'create')
        payload = _build_vendedor_payload(data)
        documento = payload['documento']

        if documento and Vendedor.query.filter_by(documento=documento).first():
            return jsonify({'error': 'Ya existe un vendedor con ese documento'}), 409

        usuario_id = payload.get('usuario_id')
        if usuario_id and Vendedor.query.filter_by(usuario_id=usuario_id).first():
            return jsonify({'error': 'Ese usuario ya está vinculado a otro vendedor'}), 409

        vendedor = Vendedor(**payload)
        db.session.add(vendedor)
        db.session.commit()
        return jsonify({'mensaje': 'Vendedor creado', 'id': vendedor.id}), 201
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando vendedor comercial: %s", exc)
        return jsonify({'error': 'Error al crear vendedor'}), 500


@comercial_bp.route('/vendedores/<int:vendedor_id>', methods=['PUT'])
@login_required
def actualizar_vendedor(vendedor_id):
    data = _get_payload()

    try:
        _require_commercial_permission('vendedores', 'update')
        vendedor = Vendedor.query.get_or_404(vendedor_id)
        payload = _build_vendedor_payload(data)
        documento = payload['documento']

        if documento:
            existente = Vendedor.query.filter(
                Vendedor.documento == documento,
                Vendedor.id != vendedor_id
            ).first()
            if existente:
                return jsonify({'error': 'Ya existe un vendedor con ese documento'}), 409

        usuario_id = payload.get('usuario_id')
        if usuario_id:
            usuario_ocupado = Vendedor.query.filter(
                Vendedor.usuario_id == usuario_id,
                Vendedor.id != vendedor_id
            ).first()
            if usuario_ocupado:
                return jsonify({'error': 'Ese usuario ya está vinculado a otro vendedor'}), 409

        vendedor.nombre = payload['nombre']
        vendedor.cargo = payload['cargo']
        vendedor.documento = payload['documento']
        vendedor.telefono = payload['telefono']
        vendedor.email = payload['email']
        vendedor.usuario_id = payload['usuario_id']
        vendedor.porcentaje_comision_venta = payload['porcentaje_comision_venta']
        vendedor.porcentaje_comision_recaudo = payload['porcentaje_comision_recaudo']
        vendedor.monto_base_comision = payload['monto_base_comision']
        vendedor.descripcion = payload['descripcion']
        vendedor.activo = payload['activo']

        db.session.commit()
        return jsonify({'mensaje': 'Vendedor actualizado'}), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando vendedor comercial: %s", exc)
        return jsonify({'error': 'Error al actualizar vendedor'}), 500


@comercial_bp.route('/vendedores/<int:vendedor_id>', methods=['DELETE'])
@login_required
def eliminar_vendedor(vendedor_id):
    try:
        _require_commercial_permission('vendedores', 'delete')
        vendedor = Vendedor.query.get_or_404(vendedor_id)
        clientes_count = vendedor.clientes_comerciales.count()
        atenciones_count = ClienteAtencion.query.filter_by(vendedor_id=vendedor.id).count()
        documentos_count = ClienteSeguimientoDocumento.query.filter_by(vendedor_id=vendedor.id).count()
        pagos_count = ClienteSeguimientoPago.query.filter_by(vendedor_id=vendedor.id).count()

        if any([clientes_count, atenciones_count, documentos_count, pagos_count]):
            return jsonify({
                'error': 'No se puede eliminar el vendedor porque tiene movimientos o clientes asociados.',
                'details': {
                    'clientes': clientes_count,
                    'atenciones': atenciones_count,
                    'documentos': documentos_count,
                    'pagos': pagos_count,
                }
            }), 409

        db.session.delete(vendedor)
        db.session.commit()
        return jsonify({'mensaje': 'Vendedor eliminado'}), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error eliminando vendedor comercial %s: %s", vendedor_id, exc)
        return jsonify({'error': 'Error al eliminar vendedor'}), 500


@comercial_bp.route('/catalogo', methods=['GET'])
@login_required
def get_catalogo_comercial():
    try:
        can_read_examenes = _has_commercial_permission('examenes', 'read')
        can_read_paquetes = _has_commercial_permission('paquetes', 'read')
        if not can_read_examenes and not can_read_paquetes:
            raise PermissionError('No tienes permiso para consultar examenes o paquetes')
        items = ComercialCatalogoItem.query.order_by(
            ComercialCatalogoItem.activo.desc(),
            ComercialCatalogoItem.tipo_item.asc(),
            ComercialCatalogoItem.nombre.asc()
        ).all()
        visibles = [item for item in items if _can_read_catalog_item(item)]
        return jsonify([_serialize_catalogo_item(item) for item in visibles]), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        logger.error("Error obteniendo catalogo comercial: %s", exc)
        return jsonify({'error': 'Error al obtener catálogo comercial'}), 500


@comercial_bp.route('/catalogo', methods=['POST'])
@login_required
def crear_catalogo_comercial():
    data = _get_payload()

    try:
        payload = _build_catalogo_item_payload(data)
        _require_commercial_permission(_get_catalog_permission_entity(payload.get('tipo_item')), 'create')
        componentes_ids = _build_paquete_componentes_payload(data, tipo_item=payload['tipo_item'])
        codigo = payload['codigo']
        if codigo and ComercialCatalogoItem.query.filter_by(codigo=codigo).first():
            return jsonify({'error': 'Ya existe un item comercial con ese código'}), 409

        item = ComercialCatalogoItem(**payload)
        db.session.add(item)
        db.session.flush()
        _guardar_componentes_paquete(item, componentes_ids)
        db.session.commit()
        return jsonify({'mensaje': 'Item comercial creado', 'id': item.id}), 201
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando item comercial: %s", exc)
        return jsonify({'error': 'Error al crear item comercial'}), 500


@comercial_bp.route('/catalogo/<int:item_id>', methods=['PUT'])
@login_required
def actualizar_catalogo_comercial(item_id):
    data = _get_payload()

    try:
        item = ComercialCatalogoItem.query.get_or_404(item_id)
        _require_commercial_permission(_get_catalog_permission_entity(item.tipo_item), 'update')
        payload = _build_catalogo_item_payload(data)
        _require_commercial_permission(_get_catalog_permission_entity(payload.get('tipo_item')), 'update')
        componentes_ids = _build_paquete_componentes_payload(
            data,
            item_id=item_id,
            tipo_item=payload['tipo_item']
        )
        codigo = payload['codigo']
        if codigo:
            existente = ComercialCatalogoItem.query.filter(
                ComercialCatalogoItem.codigo == codigo,
                ComercialCatalogoItem.id != item_id
            ).first()
            if existente:
                return jsonify({'error': 'Ya existe un item comercial con ese código'}), 409

        if (
            item.tipo_item == 'EXAMEN'
            and payload['tipo_item'] != 'EXAMEN'
            and item.examen_en_paquetes.count() > 0
        ):
            raise ValueError(
                'No puedes cambiar este examen a paquete o servicio porque ya hace parte de uno o mÃ¡s paquetes.'
            )

        for field, value in payload.items():
            setattr(item, field, value)

        _guardar_componentes_paquete(item, componentes_ids)
        db.session.commit()
        return jsonify({'mensaje': 'Item comercial actualizado'}), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando item comercial: %s", exc)
        return jsonify({'error': 'Error al actualizar item comercial'}), 500


@comercial_bp.route('/catalogo/<int:item_id>', methods=['DELETE'])
@login_required
def eliminar_catalogo_comercial(item_id):
    try:
        item = ComercialCatalogoItem.query.get_or_404(item_id)
        _require_commercial_permission(_get_catalog_permission_entity(item.tipo_item), 'delete')
        soft_delete = _parse_bool(request.args.get('soft'), False)
        tarifas_count = item.tarifas_cliente.count()
        atenciones_count = item.atenciones_detalle.count()
        usado_en_paquetes_count = item.examen_en_paquetes.count()

        if any([tarifas_count, atenciones_count, usado_en_paquetes_count]):
            if soft_delete:
                item.activo = False
                db.session.commit()
                return jsonify({'mensaje': 'Item comercial inactivado'}), 200
            return jsonify({
                'error': 'No se puede eliminar el item porque ya tiene uso comercial registrado.',
                'details': {
                    'tarifas': tarifas_count,
                    'atenciones': atenciones_count,
                    'paquetes': usado_en_paquetes_count,
                }
            }), 409

        db.session.delete(item)
        db.session.commit()
        return jsonify({'mensaje': 'Item comercial eliminado'}), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error eliminando item comercial %s: %s", item_id, exc)
        return jsonify({'error': 'Error al eliminar item comercial'}), 500


@comercial_bp.route('/tarifas', methods=['GET'])
@login_required
def get_tarifas_comerciales():
    try:
        _require_commercial_permission('tarifas', 'read')
        tarifas_query = ClienteComercialTarifa.query
        if not _is_admin_user():
            vendedor_scope = _resolver_vendedor_usuario_actual()
            if vendedor_scope is None:
                return jsonify([]), 200
            tarifas_query = tarifas_query.join(
                ClienteComercial,
                ClienteComercial.id == ClienteComercialTarifa.cliente_id,
            ).filter(ClienteComercial.vendedor_id == vendedor_scope.id)

        tarifas = tarifas_query.order_by(
            ClienteComercialTarifa.activo.desc(),
            ClienteComercialTarifa.id.desc()
        ).all()
        return jsonify([_serialize_tarifa_cliente(tarifa) for tarifa in tarifas]), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        logger.error("Error obteniendo tarifas comerciales: %s", exc)
        return jsonify({'error': 'Error al obtener tarifas comerciales'}), 500


@comercial_bp.route('/tarifas', methods=['POST'])
@login_required
def crear_tarifa_comercial():
    data = _get_payload()

    try:
        _require_commercial_permission('tarifas', 'create')
        payload = _build_tarifa_cliente_payload(data)
        _obtener_cliente_comercial_en_scope(payload['cliente_id'])
        existente = ClienteComercialTarifa.query.filter_by(
            cliente_id=payload['cliente_id'],
            catalogo_item_id=payload['catalogo_item_id']
        ).first()
        if existente:
            return jsonify({'error': 'Ese cliente ya tiene una tarifa configurada para este item'}), 409

        tarifa = ClienteComercialTarifa(**payload)
        db.session.add(tarifa)
        db.session.commit()
        return jsonify({'mensaje': 'Tarifa comercial creada', 'id': tarifa.id}), 201
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando tarifa comercial: %s", exc)
        return jsonify({'error': 'Error al crear tarifa comercial'}), 500


@comercial_bp.route('/tarifas/<int:tarifa_id>', methods=['PUT'])
@login_required
def actualizar_tarifa_comercial(tarifa_id):
    data = _get_payload()

    try:
        _require_commercial_permission('tarifas', 'update')
        tarifa = ClienteComercialTarifa.query.get_or_404(tarifa_id)
        _asegurar_cliente_en_scope(tarifa.cliente)
        payload = _build_tarifa_cliente_payload(data)
        _obtener_cliente_comercial_en_scope(payload['cliente_id'])
        existente = ClienteComercialTarifa.query.filter(
            ClienteComercialTarifa.cliente_id == payload['cliente_id'],
            ClienteComercialTarifa.catalogo_item_id == payload['catalogo_item_id'],
            ClienteComercialTarifa.id != tarifa_id
        ).first()
        if existente:
            return jsonify({'error': 'Ese cliente ya tiene una tarifa configurada para este item'}), 409

        for field, value in payload.items():
            setattr(tarifa, field, value)

        db.session.commit()
        return jsonify({'mensaje': 'Tarifa comercial actualizada'}), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando tarifa comercial: %s", exc)
        return jsonify({'error': 'Error al actualizar tarifa comercial'}), 500


@comercial_bp.route('/tarifas/<int:tarifa_id>', methods=['DELETE'])
@login_required
def eliminar_tarifa_comercial(tarifa_id):
    try:
        _require_commercial_permission('tarifas', 'delete')
        tarifa = ClienteComercialTarifa.query.get_or_404(tarifa_id)
        _asegurar_cliente_en_scope(tarifa.cliente)
        db.session.delete(tarifa)
        db.session.commit()
        return jsonify({'mensaje': 'Tarifa comercial eliminada'}), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        db.session.rollback()
        logger.error("Error eliminando tarifa comercial: %s", exc)
        return jsonify({'error': 'Error al eliminar tarifa comercial'}), 500


@comercial_bp.route('/clientes', methods=['GET'])
@login_required
def get_clientes():
    try:
        _require_commercial_permission('clientes', 'read')
        clientes_query = ClienteComercial.query
        if not _is_admin_user():
            vendedor_scope = _resolver_vendedor_usuario_actual()
            if vendedor_scope is None:
                return jsonify([]), 200
            clientes_query = clientes_query.filter(ClienteComercial.vendedor_id == vendedor_scope.id)

        clientes = clientes_query.order_by(
            ClienteComercial.activo.desc(),
            ClienteComercial.razon_social.asc()
        ).all()
        return jsonify([_serialize_cliente(cliente) for cliente in clientes]), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        logger.error("Error obteniendo clientes comerciales: %s", exc)
        return jsonify({'error': 'Error al obtener clientes comerciales'}), 500


@comercial_bp.route('/clientes', methods=['POST'])
@login_required
def crear_cliente():
    data = _get_payload()

    try:
        _require_commercial_permission('clientes', 'create')
        payload = _build_cliente_payload(data)
        if not _is_admin_user():
            vendedor_scope = _resolver_vendedor_usuario_actual()
            if vendedor_scope is None:
                raise PermissionError('No tienes un vendedor asociado')
            payload['vendedor_id'] = vendedor_scope.id
        nit = payload['nit']
        if nit and ClienteComercial.query.filter_by(nit=nit).first():
            return jsonify({'error': 'Ya existe un cliente con ese NIT'}), 409
        origen_existente = _cliente_ya_existe_en_interfaces(nit, payload['razon_social'])
        if origen_existente:
            return jsonify({'error': f'El cliente ya existe en {origen_existente}. Debe gestionarse como cliente existente, no crearse de nuevo.'}), 409

        _validar_pagare_cliente(payload)

        cliente = ClienteComercial(**payload)
        if cliente.confirmado_administrativo:
            cliente.confirmado_administrativo_at = datetime.utcnow()
            cliente.confirmado_administrativo_por_id = current_user.id
        db.session.add(cliente)
        db.session.flush()

        _guardar_adjuntos(cliente, request.files.getlist('documentos_legales_adjuntos'), 'DOCUMENTO_LEGAL')
        _guardar_adjuntos(cliente, request.files.getlist('pagare_adjuntos'), 'PAGARE')
        _guardar_documentos_cliente_por_tipo(cliente, data)

        db.session.commit()
        return jsonify({'mensaje': 'Cliente comercial creado', 'id': cliente.id}), 201
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando cliente comercial: %s", exc)
        return jsonify({'error': 'Error al crear cliente comercial'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>', methods=['PUT'])
@login_required
def actualizar_cliente(cliente_id):
    data = _get_payload()

    try:
        _require_commercial_permission('clientes', 'update')
        cliente = _obtener_cliente_comercial_en_scope(cliente_id)
        payload = _build_cliente_payload(data)
        if not _is_admin_user():
            vendedor_scope = _resolver_vendedor_usuario_actual()
            if vendedor_scope is None:
                raise PermissionError('No tienes un vendedor asociado')
            payload['vendedor_id'] = vendedor_scope.id
        nit = payload['nit']
        if nit:
            existente = ClienteComercial.query.filter(
                ClienteComercial.nit == nit,
                ClienteComercial.id != cliente_id
            ).first()
            if existente:
                return jsonify({'error': 'Ya existe un cliente con ese NIT'}), 409

        _validar_pagare_cliente(payload, cliente=cliente)

        for field, value in payload.items():
            setattr(cliente, field, value)
        if cliente.confirmado_administrativo:
            if cliente.confirmado_administrativo_at is None:
                cliente.confirmado_administrativo_at = datetime.utcnow()
                cliente.confirmado_administrativo_por_id = current_user.id
        else:
            cliente.confirmado_administrativo_at = None
            cliente.confirmado_administrativo_por_id = None

        _guardar_adjuntos(cliente, request.files.getlist('documentos_legales_adjuntos'), 'DOCUMENTO_LEGAL')
        _guardar_adjuntos(cliente, request.files.getlist('pagare_adjuntos'), 'PAGARE')
        _guardar_documentos_cliente_por_tipo(cliente, data)

        db.session.commit()
        return jsonify({'mensaje': 'Cliente comercial actualizado'}), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando cliente comercial: %s", exc)
        return jsonify({'error': 'Error al actualizar cliente comercial'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>', methods=['DELETE'])
@login_required
def eliminar_cliente(cliente_id):
    try:
        _require_commercial_permission('clientes', 'delete')
        cliente = _obtener_cliente_comercial_en_scope(cliente_id)
        atenciones_count = cliente.atenciones.count()
        documentos_count = cliente.seguimiento_documentos.count()
        pagos_count = cliente.seguimiento_pagos.count()

        if any([atenciones_count, documentos_count, pagos_count]):
            return jsonify({
                'error': 'No se puede eliminar el cliente porque ya tiene movimiento comercial registrado.',
                'details': {
                    'atenciones': atenciones_count,
                    'documentos': documentos_count,
                    'pagos': pagos_count,
                }
            }), 409

        for adjunto in cliente.adjuntos.all():
            _eliminar_adjunto_cliente(adjunto)

        cliente_id_value = cliente.id
        db.session.delete(cliente)
        db.session.commit()
        _eliminar_directorio_cliente(cliente_id_value)
        return jsonify({'mensaje': 'Cliente comercial eliminado'}), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error eliminando cliente comercial %s: %s", cliente_id, exc)
        return jsonify({'error': 'Error al eliminar cliente comercial'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>/convenio-items', methods=['GET'])
@login_required
def get_cliente_convenio_items(cliente_id):
    try:
        if not _has_any_commercial_permission(
            ('clientes', 'read'),
            ('atenciones', 'read'),
            ('atenciones', 'create'),
            ('atenciones', 'update'),
        ):
            raise PermissionError('No tienes permiso para consultar items convenidos del cliente')
        cliente = _obtener_cliente_comercial_en_scope(cliente_id)
        fecha_atencion = None
        raw_fecha = request.args.get('fecha_atencion')
        if raw_fecha:
            try:
                fecha_atencion = datetime.strptime(str(raw_fecha), '%Y-%m-%d')
            except ValueError:
                return jsonify({'error': 'La fecha de atencion debe tener formato YYYY-MM-DD'}), 400
        items = _build_cliente_convenio_items(cliente, fecha_atencion)
        visibles = [
            item for item in items
            if (
                (
                    item.get('tipo_item') == 'EXAMEN'
                    and _has_any_commercial_permission(
                        ('examenes', 'read'),
                        ('atenciones', 'read'),
                        ('atenciones', 'create'),
                        ('atenciones', 'update'),
                    )
                )
                or (
                    item.get('tipo_item') != 'EXAMEN'
                    and _has_any_commercial_permission(
                        ('paquetes', 'read'),
                        ('atenciones', 'read'),
                        ('atenciones', 'create'),
                        ('atenciones', 'update'),
                    )
                )
            )
        ]
        return jsonify(visibles), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error obteniendo convenio del cliente %s: %s", cliente_id, exc)
        return jsonify({'error': 'Error al obtener los items convenidos del cliente'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>/atenciones', methods=['GET'])
@login_required
def get_atenciones_cliente(cliente_id):
    try:
        _require_commercial_permission('atenciones', 'read')
        cliente = _obtener_cliente_comercial_en_scope(cliente_id)
        atenciones = ClienteAtencion.query.filter_by(cliente_id=cliente.id).order_by(
            ClienteAtencion.fecha_atencion.desc(),
            ClienteAtencion.id.desc(),
        ).all()
        return jsonify([_serialize_atencion(atencion) for atencion in atenciones]), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error obteniendo atenciones del cliente %s: %s", cliente_id, exc)
        return jsonify({'error': 'Error al obtener las atenciones del cliente'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>/atenciones', methods=['POST'])
@login_required
def crear_atencion_cliente(cliente_id):
    data = _get_payload()

    try:
        _require_commercial_permission('atenciones', 'create')
        cliente = _obtener_cliente_comercial_en_scope(cliente_id)
        if not _cliente_habilitado_para_atenciones(cliente):
            return jsonify({'error': 'El cliente esta pendiente de confirmacion en Administrativo y/o Contable. No se pueden registrar atenciones todavia.'}), 409
        payload = _build_atencion_payload(data, cliente)
        detalles_payload = payload.pop('detalles')

        atencion = ClienteAtencion(**payload)
        db.session.add(atencion)
        db.session.flush()

        atencion.nro_atencion = _generar_numero_atencion(atencion)
        for detalle_payload in detalles_payload:
            db.session.add(ClienteAtencionDetalle(atencion_id=atencion.id, **detalle_payload))

        genera_cartera = cliente.condicion_comercial in {'CREDITO', 'MIXTO'} or cliente.requiere_factura is True
        documento = ClienteSeguimientoDocumento(
            cliente_id=cliente.id,
            vendedor_id=cliente.vendedor_id,
            atencion_id=atencion.id,
            tipo_documento='INGRESO_SIN_FACTURA',
            numero_documento=atencion.nro_atencion,
            fecha_documento=atencion.fecha_atencion,
            fecha_vencimiento=atencion.fecha_atencion if genera_cartera else None,
            valor_documento=atencion.valor_total,
            saldo_actual=atencion.saldo_pendiente,
            genera_cartera=genera_cartera,
            estado_documento='PENDIENTE',
            observaciones=atencion.observaciones,
        )
        db.session.add(documento)
        db.session.flush()

        _sincronizar_atencion_desde_documento(documento)
        db.session.commit()
        return jsonify({
            'mensaje': 'Atencion registrada',
            'id': atencion.id,
            'nro_atencion': atencion.nro_atencion,
            'documento_id': documento.id,
        }), 201
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando atencion para cliente %s: %s", cliente_id, exc)
        return jsonify({'error': 'Error al registrar la atencion'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>/anticipos-programados', methods=['POST'])
@login_required
def crear_anticipo_programado_cliente(cliente_id):
    data = _get_payload()

    try:
        if not _has_any_commercial_permission(
            ('atenciones', 'create'),
            ('documentos', 'create'),
            ('pagos', 'create'),
        ):
            raise PermissionError('No tienes permiso para programar anticipos comerciales')

        cliente = _obtener_cliente_comercial_en_scope(cliente_id)
        if cliente.condicion_comercial not in {'EFECTIVO', 'MIXTO'}:
            return jsonify({'error': 'Por ahora solo puedes programar anticipos para empresas EFECTIVO o MIXTO'}), 409

        payload = _build_atencion_payload(data, cliente)
        detalles_payload = payload.pop('detalles')
        resumen_detalle = _construir_resumen_anticipo_detalles(detalles_payload)
        valor_anticipo = _parse_decimal_field(data, 'valor_pago', minimum=0.01)

        atencion = ClienteAtencion(**payload)
        db.session.add(atencion)
        db.session.flush()

        atencion.nro_atencion = _generar_numero_atencion(atencion)
        for detalle_payload in detalles_payload:
            db.session.add(ClienteAtencionDetalle(atencion_id=atencion.id, **detalle_payload))

        genera_cartera = (
            cliente.condicion_comercial == 'MIXTO'
            or cliente.requiere_factura is True
            or valor_anticipo < Decimal(str(atencion.valor_total or 0))
        )
        documento = ClienteSeguimientoDocumento(
            cliente_id=cliente.id,
            vendedor_id=cliente.vendedor_id,
            atencion_id=atencion.id,
            tipo_documento='INGRESO_SIN_FACTURA',
            numero_documento=f'ANT-{atencion.nro_atencion}',
            fecha_documento=atencion.fecha_atencion,
            fecha_vencimiento=atencion.fecha_atencion if genera_cartera else None,
            valor_documento=atencion.valor_total,
            saldo_actual=atencion.saldo_pendiente,
            genera_cartera=genera_cartera,
            estado_documento='PENDIENTE',
            observaciones=atencion.observaciones,
        )
        db.session.add(documento)
        db.session.flush()

        pago_data = dict(data)
        pago_data['tipo_pago'] = 'PAGO_TOTAL' if valor_anticipo >= Decimal(str(atencion.valor_total or 0)) else 'ABONO'
        pago_data['fecha_atencion'] = atencion.fecha_atencion.strftime('%Y-%m-%d') if atencion.fecha_atencion else ''
        pago_data['paciente_documento'] = resumen_detalle['paciente_documento']
        pago_data['paciente_nombre'] = resumen_detalle['paciente_nombre']
        pago_data['examenes_realizados'] = resumen_detalle['examenes_realizados']

        pago_payload = _build_seguimiento_pago_payload(pago_data, documento)
        pago = ClienteSeguimientoPago(**pago_payload)
        db.session.add(pago)
        db.session.flush()

        if _documento_requiere_recibo_caja(documento, pago.medio_pago):
            pago.numero_recibo_caja = _generar_numero_recibo_caja(pago)

        comprobante = request.files.get('comprobante_pago')
        if pago.medio_pago == 'TRANSFERENCIA' and not comprobante:
            raise ValueError('Debes cargar el comprobante cuando el anticipo se registra por transferencia')
        if comprobante:
            _guardar_comprobante_pago(pago, comprobante)

        _recalcular_documento_con_pagos(documento)
        db.session.commit()
        return jsonify({
            'mensaje': 'Anticipo programado',
            'atencion_id': atencion.id,
            'nro_atencion': atencion.nro_atencion,
            'documento_id': documento.id,
            'pago_id': pago.id,
        }), 201
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando anticipo programado para cliente %s: %s", cliente_id, exc)
        return jsonify({'error': 'Error al programar el anticipo'}), 500


@comercial_bp.route('/atenciones/<int:atencion_id>', methods=['PUT'])
@login_required
def actualizar_atencion_cliente(atencion_id):
    data = _get_payload()

    try:
        _require_commercial_permission('atenciones', 'update')
        atencion = ClienteAtencion.query.get_or_404(atencion_id)
        _asegurar_cliente_en_scope(atencion.cliente)
        documento = atencion.documento_cobro
        pagos_count = documento.pagos.count() if documento is not None else 0
        if pagos_count:
            return jsonify({
                'error': 'No se puede editar la atencion porque ya tiene pagos registrados.',
                'details': {'pagos': pagos_count}
            }), 409

        cliente = atencion.cliente
        payload = _build_atencion_payload(data, cliente)
        detalles_payload = payload.pop('detalles')

        for field, value in payload.items():
            setattr(atencion, field, value)

        atencion.detalles.clear()
        for detalle_payload in detalles_payload:
            atencion.detalles.append(ClienteAtencionDetalle(**detalle_payload))

        genera_cartera = cliente.condicion_comercial in {'CREDITO', 'MIXTO'} or cliente.requiere_factura is True
        if documento is None:
            documento = ClienteSeguimientoDocumento(
                cliente_id=cliente.id,
                atencion_id=atencion.id,
            )
            db.session.add(documento)

        documento.vendedor_id = cliente.vendedor_id
        documento.tipo_documento = 'INGRESO_SIN_FACTURA'
        documento.numero_documento = atencion.nro_atencion
        documento.fecha_documento = atencion.fecha_atencion
        documento.fecha_vencimiento = atencion.fecha_atencion if genera_cartera else None
        documento.valor_documento = atencion.valor_total
        documento.saldo_actual = atencion.saldo_pendiente
        documento.genera_cartera = genera_cartera
        documento.estado_documento = 'PENDIENTE'
        documento.observaciones = atencion.observaciones

        _sincronizar_atencion_desde_documento(documento)
        db.session.commit()
        return jsonify({'mensaje': 'Atencion actualizada'}), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando atencion %s: %s", atencion_id, exc)
        return jsonify({'error': 'Error al actualizar la atencion'}), 500


@comercial_bp.route('/atenciones/<int:atencion_id>', methods=['DELETE'])
@login_required
def eliminar_atencion_cliente(atencion_id):
    try:
        _require_commercial_permission('atenciones', 'delete')
        atencion = ClienteAtencion.query.get_or_404(atencion_id)
        _asegurar_cliente_en_scope(atencion.cliente)
        documento = atencion.documento_cobro
        pagos_count = documento.pagos.count() if documento is not None else 0

        if pagos_count:
            return jsonify({
                'error': 'No se puede eliminar la atencion porque ya tiene pagos registrados.',
                'details': {'pagos': pagos_count}
            }), 409

        if documento is not None:
            db.session.delete(documento)
        db.session.delete(atencion)
        db.session.commit()
        return jsonify({'mensaje': 'Atencion eliminada'}), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error eliminando atencion %s: %s", atencion_id, exc)
        return jsonify({'error': 'Error al eliminar la atencion'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>/seguimiento-documentos', methods=['GET'])
@login_required
def get_seguimiento_documentos_cliente(cliente_id):
    try:
        _require_commercial_permission('documentos', 'read')
        cliente = _obtener_cliente_comercial_en_scope(cliente_id)
        documentos = ClienteSeguimientoDocumento.query.filter_by(cliente_id=cliente.id).order_by(
            ClienteSeguimientoDocumento.fecha_documento.desc(),
            ClienteSeguimientoDocumento.id.desc()
        ).all()
        return jsonify([_serialize_seguimiento_documento(documento) for documento in documentos]), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error obteniendo seguimiento comercial del cliente %s: %s", cliente_id, exc)
        return jsonify({'error': 'Error al obtener el seguimiento comercial del cliente'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>/seguimiento-documentos', methods=['POST'])
@login_required
def crear_seguimiento_documento_cliente(cliente_id):
    data = _get_payload()

    try:
        _require_commercial_permission('documentos', 'create')
        cliente = _obtener_cliente_comercial_en_scope(cliente_id)
        payload = _build_seguimiento_documento_payload(data, cliente)
        documento = ClienteSeguimientoDocumento(**payload)
        db.session.add(documento)
        db.session.commit()
        return jsonify({'mensaje': 'Documento comercial registrado', 'id': documento.id}), 201
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando documento de seguimiento para cliente %s: %s", cliente_id, exc)
        return jsonify({'error': 'Error al crear el documento comercial'}), 500


@comercial_bp.route('/seguimiento-documentos/<int:documento_id>', methods=['PUT'])
@login_required
def actualizar_seguimiento_documento(documento_id):
    data = _get_payload()

    try:
        _require_commercial_permission('documentos', 'update')
        documento = ClienteSeguimientoDocumento.query.get_or_404(documento_id)
        _asegurar_cliente_en_scope(documento.cliente)
        if documento.atencion_id:
            return jsonify({'error': 'Este documento fue generado desde una atencion y no se edita manualmente'}), 400
        payload = _build_seguimiento_documento_payload(data, documento.cliente, documento=documento)
        for field, value in payload.items():
            setattr(documento, field, value)

        db.session.commit()
        return jsonify({'mensaje': 'Documento comercial actualizado'}), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando documento de seguimiento %s: %s", documento_id, exc)
        return jsonify({'error': 'Error al actualizar el documento comercial'}), 500


@comercial_bp.route('/seguimiento-documentos/<int:documento_id>', methods=['DELETE'])
@login_required
def eliminar_seguimiento_documento(documento_id):
    try:
        _require_commercial_permission('documentos', 'delete')
        documento = ClienteSeguimientoDocumento.query.get_or_404(documento_id)
        _asegurar_cliente_en_scope(documento.cliente)
        if documento.atencion_id:
            return jsonify({'error': 'Este documento fue generado desde una atencion y no se elimina manualmente'}), 400
        db.session.delete(documento)
        db.session.commit()
        return jsonify({'mensaje': 'Documento comercial eliminado'}), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error eliminando documento de seguimiento %s: %s", documento_id, exc)
        return jsonify({'error': 'Error al eliminar el documento comercial'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>/seguimiento-pagos', methods=['GET'])
@login_required
def get_seguimiento_pagos_cliente(cliente_id):
    try:
        _require_commercial_permission('pagos', 'read')
        cliente = _obtener_cliente_comercial_en_scope(cliente_id)
        pagos = ClienteSeguimientoPago.query.filter_by(cliente_id=cliente.id).order_by(
            ClienteSeguimientoPago.fecha_pago.desc(),
            ClienteSeguimientoPago.id.desc()
        ).all()
        return jsonify([_serialize_seguimiento_pago(pago) for pago in pagos]), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error obteniendo pagos de seguimiento del cliente %s: %s", cliente_id, exc)
        return jsonify({'error': 'Error al obtener los pagos del cliente'}), 500


@comercial_bp.route('/seguimiento-documentos/<int:documento_id>/pagos', methods=['POST'])
@login_required
def crear_seguimiento_pago(documento_id):
    data = _get_payload()

    try:
        _require_commercial_permission('pagos', 'create')
        documento = ClienteSeguimientoDocumento.query.get_or_404(documento_id)
        _asegurar_cliente_en_scope(documento.cliente)
        payload = _build_seguimiento_pago_payload(data, documento)
        pago = ClienteSeguimientoPago(**payload)
        db.session.add(pago)
        db.session.flush()

        if _documento_requiere_recibo_caja(documento, pago.medio_pago):
            pago.numero_recibo_caja = _generar_numero_recibo_caja(pago)

        comprobante = request.files.get('comprobante_pago')
        if payload['medio_pago'] == 'TRANSFERENCIA' and not comprobante:
            raise ValueError('Debes cargar el comprobante cuando el pago se registra por transferencia')
        if comprobante:
            _guardar_comprobante_pago(pago, comprobante)

        _recalcular_documento_con_pagos(documento)
        db.session.commit()
        return jsonify({'mensaje': 'Pago registrado', 'id': pago.id}), 201
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando pago de seguimiento para documento %s: %s", documento_id, exc)
        return jsonify({'error': 'Error al registrar el pago'}), 500


@comercial_bp.route('/seguimiento-pagos/<int:pago_id>', methods=['PUT'])
@login_required
def actualizar_seguimiento_pago(pago_id):
    data = _get_payload()

    try:
        _require_commercial_permission('pagos', 'update')
        pago = ClienteSeguimientoPago.query.get_or_404(pago_id)
        _asegurar_cliente_en_scope(getattr(pago, 'cliente', None) or getattr(pago.documento, 'cliente', None))
        payload = _build_seguimiento_pago_payload(data, pago.documento, pago=pago)
        for field, value in payload.items():
            setattr(pago, field, value)

        if _documento_requiere_recibo_caja(pago.documento, pago.medio_pago):
            if not pago.numero_recibo_caja:
                pago.numero_recibo_caja = _generar_numero_recibo_caja(pago)
        else:
            pago.numero_recibo_caja = None

        comprobante = request.files.get('comprobante_pago')
        if pago.medio_pago == 'TRANSFERENCIA' and not comprobante and not pago.ruta_comprobante:
            raise ValueError('Debes cargar el comprobante cuando el pago se registra por transferencia')
        if pago.medio_pago != 'TRANSFERENCIA':
            _eliminar_comprobante_pago(pago)
        elif comprobante:
            _guardar_comprobante_pago(pago, comprobante)

        _recalcular_documento_con_pagos(pago.documento)
        db.session.commit()
        return jsonify({'mensaje': 'Pago actualizado'}), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando pago de seguimiento %s: %s", pago_id, exc)
        return jsonify({'error': 'Error al actualizar el pago'}), 500


@comercial_bp.route('/seguimiento-pagos/<int:pago_id>', methods=['DELETE'])
@login_required
def eliminar_seguimiento_pago(pago_id):
    try:
        _require_commercial_permission('pagos', 'delete')
        pago = ClienteSeguimientoPago.query.get_or_404(pago_id)
        _asegurar_cliente_en_scope(getattr(pago, 'cliente', None) or getattr(pago.documento, 'cliente', None))
        documento = pago.documento
        _eliminar_comprobante_pago(pago)
        db.session.delete(pago)
        db.session.flush()
        _recalcular_documento_con_pagos(documento)
        db.session.commit()
        return jsonify({'mensaje': 'Pago eliminado'}), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error eliminando pago de seguimiento %s: %s", pago_id, exc)
        return jsonify({'error': 'Error al eliminar el pago'}), 500


@comercial_bp.route('/seguimiento-pagos/<int:pago_id>/comprobante', methods=['GET'])
@login_required
def descargar_comprobante_pago(pago_id):
    try:
        _require_commercial_permission('pagos', 'read')
        pago = ClienteSeguimientoPago.query.get_or_404(pago_id)
        _asegurar_cliente_en_scope(getattr(pago, 'cliente', None) or getattr(pago.documento, 'cliente', None))
        ruta = _get_pago_comprobante_path(pago)
        return send_file(ruta, as_attachment=True, download_name=pago.nombre_comprobante or 'comprobante_pago')
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except FileNotFoundError as exc:
        return jsonify({'error': str(exc)}), 404
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error descargando comprobante de pago %s: %s", pago_id, exc)
        return jsonify({'error': 'Error al descargar el comprobante de pago'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>/adjuntos/<int:adjunto_id>', methods=['GET'])
@login_required
def descargar_adjunto_cliente(cliente_id, adjunto_id):
    try:
        _require_commercial_permission('clientes', 'read')
        cliente = _obtener_cliente_comercial_en_scope(cliente_id)
        adjunto = ClienteComercialAdjunto.query.filter_by(id=adjunto_id, cliente_id=cliente.id).first_or_404()
        ruta = _get_adjunto_path(adjunto)
        return send_file(ruta, as_attachment=True, download_name=adjunto.nombre_original)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except FileNotFoundError as exc:
        return jsonify({'error': str(exc)}), 404
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error descargando adjunto comercial: %s", exc)
        return jsonify({'error': 'Error al descargar adjunto'}), 500


# ---------------------------------------------------------------------------
# POST /api/comercial/catalogo/cargar-excel
# Carga masiva de servicios y paquetes desde un archivo .xlsx
# Columnas requeridas: codigo, nombre, tipo_item, tipo_examen,
#                      subtipo_laboratorio, tarifa_base, activo
# ---------------------------------------------------------------------------
@comercial_bp.route('/catalogo/cargar-excel', methods=['POST'])
@login_required
def cargar_catalogo_excel():
    """Importa o actualiza items del catálogo comercial desde un archivo Excel."""
    try:
        _require_commercial_permission('examenes', 'create')
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    if 'archivo' not in request.files:
        return jsonify({'error': 'No se envió ningún archivo'}), 400

    archivo = request.files['archivo']
    nombre = archivo.filename or ''
    if not nombre.lower().endswith('.xlsx'):
        return jsonify({'error': 'Solo se aceptan archivos .xlsx'}), 400

    try:
        import openpyxl
        contenido = archivo.read()
        import io
        wb = openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
        ws = wb.active
        filas = list(ws.iter_rows(values_only=True))
        wb.close()
    except Exception as exc:
        logger.error("Error leyendo Excel de catálogo: %s", exc)
        return jsonify({'error': f'No se pudo leer el archivo: {exc}'}), 400

    if not filas:
        return jsonify({'error': 'El archivo está vacío'}), 400

    # Normalizar encabezados
    encabezados = [str(c).strip().lower() if c is not None else '' for c in filas[0]]

    COLS_REQUERIDAS = {'codigo', 'nombre', 'tipo_item'}
    faltantes = COLS_REQUERIDAS - set(encabezados)
    if faltantes:
        return jsonify({
            'error': f'Faltan columnas requeridas: {", ".join(sorted(faltantes))}. '
                     'El archivo debe tener al menos: codigo, nombre, tipo_item'
        }), 400

    def _col(fila, nombre_col):
        try:
            idx = encabezados.index(nombre_col)
            val = fila[idx]
            return str(val).strip() if val is not None else ''
        except (ValueError, IndexError):
            return ''

    def _flag(fila, nombre_col, default=True):
        val = _col(fila, nombre_col).lower()
        if val in ('1', 'true', 'si', 'sí', 'yes', 'activo'):
            return True
        if val in ('0', 'false', 'no', 'inactivo'):
            return False
        return default

    TIPOS_VALIDOS = {'EXAMEN', 'PAQUETE', 'SERVICIO'}
    TIPOS_EXAMEN_VALIDOS = {'CONSULTA', 'LABORATORIO', 'PARACLINICO', 'ECOBABY', 'CURSOS', ''}
    SUBTIPOS_VALIDOS = {'REMITIDO', 'REALIZADO', 'NO_REMITIDO', ''}

    creados = 0
    actualizados = 0
    errores = []

    for idx, fila in enumerate(filas[1:], start=2):
        if all(c is None for c in fila):
            continue  # saltar filas vacías

        codigo = _col(fila, 'codigo')
        nombre_item = _col(fila, 'nombre')
        tipo_item = _col(fila, 'tipo_item').upper()
        tipo_examen = _col(fila, 'tipo_examen').upper() if 'tipo_examen' in encabezados else ''
        subtipo_lab = _col(fila, 'subtipo_laboratorio').upper() if 'subtipo_laboratorio' in encabezados else ''
        nombre_corto = _col(fila, 'nombre_corto') if 'nombre_corto' in encabezados else ''
        descripcion = _col(fila, 'descripcion') if 'descripcion' in encabezados else ''
        activo = _flag(fila, 'activo') if 'activo' in encabezados else True

        tarifa_raw = _col(fila, 'tarifa_base') if 'tarifa_base' in encabezados else '0'
        try:
            tarifa_base = Decimal(tarifa_raw.replace(',', '.') or '0')
        except InvalidOperation:
            errores.append(f'Fila {idx}: tarifa_base inválida ("{tarifa_raw}")')
            continue

        if not codigo:
            errores.append(f'Fila {idx}: código vacío, se omite')
            continue
        if not nombre_item:
            errores.append(f'Fila {idx}: nombre vacío, se omite')
            continue
        if tipo_item not in TIPOS_VALIDOS:
            errores.append(f'Fila {idx}: tipo_item "{tipo_item}" inválido (valores: EXAMEN, PAQUETE, SERVICIO)')
            continue
        if tipo_examen and tipo_examen not in TIPOS_EXAMEN_VALIDOS:
            errores.append(f'Fila {idx}: tipo_examen "{tipo_examen}" inválido')
            continue
        if subtipo_lab and subtipo_lab not in SUBTIPOS_VALIDOS:
            errores.append(f'Fila {idx}: subtipo_laboratorio "{subtipo_lab}" inválido')
            continue

        # clasificacion_completa: True si tipo_examen definido; y subtipo solo cuando aplica
        necesita_subtipo = tipo_examen in ('LABORATORIO', 'CURSOS')
        clasificacion_completa = bool(tipo_examen) and (not necesita_subtipo or bool(subtipo_lab))

        try:
            item = ComercialCatalogoItem.query.filter_by(codigo=codigo).first()
            if item is None:
                item = ComercialCatalogoItem(
                    codigo=codigo,
                    nombre=nombre_item,
                    nombre_corto=nombre_corto or None,
                    tipo_item=tipo_item,
                    tipo_examen=tipo_examen or None,
                    subtipo_laboratorio=subtipo_lab or None,
                    clasificacion_completa=clasificacion_completa,
                    descripcion=descripcion or None,
                    tarifa_base=tarifa_base,
                    activo=activo,
                )
                db.session.add(item)
                creados += 1
            else:
                item.nombre = nombre_item
                item.nombre_corto = nombre_corto or item.nombre_corto
                item.tipo_item = tipo_item
                item.tipo_examen = tipo_examen or None
                item.subtipo_laboratorio = subtipo_lab or None
                item.clasificacion_completa = clasificacion_completa
                item.descripcion = descripcion or item.descripcion
                item.tarifa_base = tarifa_base
                item.activo = activo
                actualizados += 1
        except Exception as exc:
            db.session.rollback()
            errores.append(f'Fila {idx}: error guardando "{codigo}" — {exc}')
            continue

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.error("Error en commit de carga Excel catálogo: %s", exc)
        return jsonify({'error': f'Error al guardar en base de datos: {exc}'}), 500

    return jsonify({
        'mensaje': f'Carga completada: {creados} creados, {actualizados} actualizados.',
        'creados': creados,
        'actualizados': actualizados,
        'errores': errores,
        'total_errores': len(errores),
    }), 200


# ==================== LIQUIDACION DE COMISIONES ====================

ESTADOS_LIQUIDACION_COMISION = {'BORRADOR', 'CERRADA'}
ESTADOS_VALIDACION_COMISION = {'APROBADA', 'PENDIENTE_VALIDACION', 'RECHAZADA'}


def _pago_tiene_soporte(pago):
    """Un pago tiene soporte cuando trae comprobante adjunto."""
    return bool(getattr(pago, 'ruta_comprobante', None))


def _rango_periodo(mes, anio):
    inicio = datetime(anio, mes, 1)
    if mes == 12:
        fin = datetime(anio + 1, 1, 1)
    else:
        fin = datetime(anio, mes + 1, 1)
    return inicio, fin


def _quantize_money(value):
    return Decimal(str(value or 0)).quantize(Decimal('0.01'))


def _recalcular_totales_liquidacion(liquidacion):
    total_con_soporte = Decimal('0')
    total_sin_soporte = Decimal('0')
    comision_aprobada = Decimal('0')
    comision_pendiente = Decimal('0')
    comision_rechazada = Decimal('0')

    for detalle in liquidacion.detalles:
        recaudo = Decimal(str(detalle.valor_recaudo or 0))
        comision = Decimal(str(detalle.comision or 0))
        if detalle.tiene_soporte:
            total_con_soporte += recaudo
        else:
            total_sin_soporte += recaudo

        if detalle.estado_validacion == 'APROBADA':
            comision_aprobada += comision
        elif detalle.estado_validacion == 'RECHAZADA':
            comision_rechazada += comision
        else:
            comision_pendiente += comision

    liquidacion.total_recaudo_con_soporte = _quantize_money(total_con_soporte)
    liquidacion.total_recaudo_sin_soporte = _quantize_money(total_sin_soporte)
    liquidacion.total_comision_aprobada = _quantize_money(comision_aprobada)
    liquidacion.total_comision_pendiente = _quantize_money(comision_pendiente)
    liquidacion.total_comision_rechazada = _quantize_money(comision_rechazada)


def _serialize_comision_detalle(detalle):
    pago = detalle.pago
    return {
        'id': detalle.id,
        'pago_id': detalle.pago_id,
        'cliente_id': detalle.cliente_id,
        'cliente_nombre': detalle.cliente.razon_social if detalle.cliente else None,
        'fecha_pago': pago.fecha_pago.strftime('%Y-%m-%d') if pago and pago.fecha_pago else None,
        'medio_pago': pago.medio_pago if pago else None,
        'forma_pago': pago.medio_pago if pago else None,
        'descripcion': pago.observaciones if pago else None,
        'valor_recaudo': float(detalle.valor_recaudo or 0),
        'porcentaje_aplicado': float(detalle.porcentaje_aplicado or 0),
        'comision': float(detalle.comision or 0),
        'tiene_soporte': detalle.tiene_soporte,
        'comprobante_url': f'/api/comercial/seguimiento-pagos/{detalle.pago_id}/comprobante' if (pago and pago.ruta_comprobante) else None,
        'estado_validacion': detalle.estado_validacion,
        'validado_por_id': detalle.validado_por_id,
        'validado_at': detalle.validado_at.strftime('%Y-%m-%d %H:%M:%S') if detalle.validado_at else None,
        'observacion': detalle.observacion,
    }


def _serialize_comision_liquidacion(liquidacion, incluir_detalle=False):
    pagable = Decimal(str(liquidacion.total_comision_aprobada or 0))
    data = {
        'id': liquidacion.id,
        'vendedor_id': liquidacion.vendedor_id,
        'vendedor_nombre': liquidacion.vendedor.nombre if liquidacion.vendedor else None,
        'mes': liquidacion.mes,
        'anio': liquidacion.anio,
        'estado': liquidacion.estado,
        'porcentaje_recaudo': float(liquidacion.porcentaje_recaudo or 0),
        'total_recaudo_con_soporte': float(liquidacion.total_recaudo_con_soporte or 0),
        'total_recaudo_sin_soporte': float(liquidacion.total_recaudo_sin_soporte or 0),
        'total_comision_aprobada': float(liquidacion.total_comision_aprobada or 0),
        'total_comision_pendiente': float(liquidacion.total_comision_pendiente or 0),
        'total_comision_rechazada': float(liquidacion.total_comision_rechazada or 0),
        'total_comision_pagable': float(_quantize_money(pagable)),
        'usuario_genera_id': liquidacion.usuario_genera_id,
        'usuario_cierra_id': liquidacion.usuario_cierra_id,
        'fecha_cierre': liquidacion.fecha_cierre.strftime('%Y-%m-%d %H:%M:%S') if liquidacion.fecha_cierre else None,
        'observaciones': liquidacion.observaciones,
        'created_at': liquidacion.created_at.strftime('%Y-%m-%d %H:%M:%S') if liquidacion.created_at else None,
        'updated_at': liquidacion.updated_at.strftime('%Y-%m-%d %H:%M:%S') if liquidacion.updated_at else None,
    }
    if incluir_detalle:
        detalles = sorted(
            liquidacion.detalles,
            key=lambda d: (0 if not d.tiene_soporte else 1, d.id),
        )
        data['detalles'] = [_serialize_comision_detalle(detalle) for detalle in detalles]
    return data


def _validar_periodo_comision(data):
    mes = _parse_int_field(data, 'mes', required=True)
    anio = _parse_int_field(data, 'anio', required=True)
    if mes < 1 or mes > 12:
        raise ValueError('El mes debe estar entre 1 y 12')
    if anio < 2000 or anio > 2100:
        raise ValueError('El anio no es valido')
    return mes, anio


def _generar_o_recalcular_liquidacion(vendedor, mes, anio):
    """Crea o regenera la liquidacion de un vendedor para un periodo.

    Toma todos los recibos de pago (recaudo) del periodo y calcula la comision
    con el porcentaje de recaudo del vendedor. Conserva las decisiones de
    validacion (aprobada/rechazada) previas de cada pago sin soporte."""
    liquidacion = ComisionLiquidacion.query.filter_by(
        vendedor_id=vendedor.id, mes=mes, anio=anio
    ).first()

    if liquidacion and liquidacion.estado == 'CERRADA':
        raise ValueError('La liquidacion de este periodo ya esta cerrada y no se puede recalcular')

    inicio, fin = _rango_periodo(mes, anio)
    porcentaje = Decimal(str(vendedor.porcentaje_comision_recaudo or 0))

    pagos = ClienteSeguimientoPago.query.filter(
        ClienteSeguimientoPago.vendedor_id == vendedor.id,
        ClienteSeguimientoPago.fecha_pago >= inicio,
        ClienteSeguimientoPago.fecha_pago < fin,
    ).all()

    if liquidacion is None:
        liquidacion = ComisionLiquidacion(
            vendedor_id=vendedor.id,
            mes=mes,
            anio=anio,
            estado='BORRADOR',
        )
        db.session.add(liquidacion)
        db.session.flush()

    liquidacion.porcentaje_recaudo = porcentaje

    # Preservar decisiones previas por pago (aprobar/rechazar sin soporte).
    decisiones_previas = {
        detalle.pago_id: detalle
        for detalle in liquidacion.detalles
    }

    pagos_por_id = {}
    for pago in pagos:
        comision = _quantize_money(Decimal(str(pago.valor_pago or 0)) * porcentaje / Decimal('100'))
        tiene_soporte = _pago_tiene_soporte(pago)
        pagos_por_id[pago.id] = pago

        detalle = decisiones_previas.get(pago.id)
        if detalle is None:
            detalle = ComisionLiquidacionDetalle(
                liquidacion_id=liquidacion.id,
                pago_id=pago.id,
            )
            db.session.add(detalle)

        detalle.cliente_id = pago.cliente_id
        detalle.valor_recaudo = _quantize_money(pago.valor_pago)
        detalle.porcentaje_aplicado = porcentaje
        detalle.comision = comision
        detalle.tiene_soporte = tiene_soporte

        if tiene_soporte:
            # Con soporte: se aprueba automaticamente.
            detalle.estado_validacion = 'APROBADA'
        elif detalle.estado_validacion not in {'APROBADA', 'RECHAZADA'}:
            # Sin soporte y sin decision previa: queda pendiente de validacion.
            detalle.estado_validacion = 'PENDIENTE_VALIDACION'

    # Eliminar detalles cuyos pagos ya no existen en el periodo.
    for pago_id, detalle in decisiones_previas.items():
        if pago_id not in pagos_por_id:
            db.session.delete(detalle)

    db.session.flush()
    db.session.refresh(liquidacion)
    _recalcular_totales_liquidacion(liquidacion)
    return liquidacion


@comercial_bp.route('/comisiones/liquidaciones', methods=['GET'])
@login_required
def get_liquidaciones_comision():
    try:
        _require_commercial_permission('comisiones', 'read')

        query = ComisionLiquidacion.query
        vendedor_scope = _resolver_vendedor_usuario_actual()
        if vendedor_scope is not None:
            query = query.filter_by(vendedor_id=vendedor_scope.id)
        else:
            vendedor_id = request.args.get('vendedor_id', type=int)
            if vendedor_id:
                query = query.filter_by(vendedor_id=vendedor_id)

        mes = request.args.get('mes', type=int)
        anio = request.args.get('anio', type=int)
        if mes:
            query = query.filter_by(mes=mes)
        if anio:
            query = query.filter_by(anio=anio)

        liquidaciones = query.order_by(
            ComisionLiquidacion.anio.desc(),
            ComisionLiquidacion.mes.desc(),
            ComisionLiquidacion.vendedor_id.asc(),
        ).all()
        return jsonify([_serialize_comision_liquidacion(l) for l in liquidaciones]), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        logger.error("Error obteniendo liquidaciones de comision: %s", exc)
        return jsonify({'error': 'Error al obtener liquidaciones de comision'}), 500


@comercial_bp.route('/comisiones/liquidaciones/<int:liquidacion_id>', methods=['GET'])
@login_required
def get_liquidacion_comision(liquidacion_id):
    try:
        _require_commercial_permission('comisiones', 'read')
        liquidacion = ComisionLiquidacion.query.get_or_404(liquidacion_id)

        vendedor_scope = _resolver_vendedor_usuario_actual()
        if vendedor_scope is not None and liquidacion.vendedor_id != vendedor_scope.id:
            raise PermissionError('No tienes acceso a esta liquidacion')

        return jsonify(_serialize_comision_liquidacion(liquidacion, incluir_detalle=True)), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error obteniendo liquidacion de comision %s: %s", liquidacion_id, exc)
        return jsonify({'error': 'Error al obtener la liquidacion'}), 500


@comercial_bp.route('/comisiones/liquidaciones', methods=['POST'])
@login_required
def generar_liquidacion_comision():
    data = _get_payload()
    try:
        _require_commercial_permission('comisiones', 'create')
        mes, anio = _validar_periodo_comision(data)

        vendedor_id = _parse_int_field(data, 'vendedor_id', required=True)
        vendedor = Vendedor.query.get(vendedor_id)
        if not vendedor:
            raise ValueError('Debe seleccionar un vendedor valido')

        liquidacion = _generar_o_recalcular_liquidacion(vendedor, mes, anio)
        if liquidacion.usuario_genera_id is None:
            liquidacion.usuario_genera_id = current_user.id

        db.session.commit()
        return jsonify({
            'mensaje': 'Liquidacion generada',
            'id': liquidacion.id,
            'liquidacion': _serialize_comision_liquidacion(liquidacion, incluir_detalle=True),
        }), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        db.session.rollback()
        logger.error("Error generando liquidacion de comision: %s", exc)
        return jsonify({'error': 'Error al generar la liquidacion de comision'}), 500


@comercial_bp.route('/comisiones/detalle/<int:detalle_id>/validar', methods=['POST'])
@login_required
def validar_comision_detalle(detalle_id):
    """Aprueba o rechaza una comision de un pago SIN soporte."""
    data = _get_payload()
    try:
        _require_commercial_permission('comisiones', 'validate')
        detalle = ComisionLiquidacionDetalle.query.get_or_404(detalle_id)

        if detalle.liquidacion and detalle.liquidacion.estado == 'CERRADA':
            return jsonify({'error': 'La liquidacion ya esta cerrada'}), 409
        if detalle.tiene_soporte:
            return jsonify({'error': 'Este pago tiene soporte; no requiere validacion manual'}), 409

        decision = str(data.get('decision') or '').strip().upper()
        if decision not in {'APROBAR', 'RECHAZAR'}:
            raise ValueError('La decision debe ser APROBAR o RECHAZAR')

        detalle.estado_validacion = 'APROBADA' if decision == 'APROBAR' else 'RECHAZADA'
        detalle.validado_por_id = current_user.id
        detalle.validado_at = datetime.utcnow()
        detalle.observacion = _normalize_optional_text(data.get('observacion'))

        _recalcular_totales_liquidacion(detalle.liquidacion)
        db.session.commit()
        return jsonify({
            'mensaje': 'Comision validada',
            'liquidacion': _serialize_comision_liquidacion(detalle.liquidacion, incluir_detalle=True),
        }), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error validando comision %s: %s", detalle_id, exc)
        return jsonify({'error': 'Error al validar la comision'}), 500


@comercial_bp.route('/comisiones/liquidaciones/<int:liquidacion_id>/cerrar', methods=['POST'])
@login_required
def cerrar_liquidacion_comision(liquidacion_id):
    try:
        _require_commercial_permission('comisiones', 'update')
        liquidacion = ComisionLiquidacion.query.get_or_404(liquidacion_id)

        if liquidacion.estado == 'CERRADA':
            return jsonify({'error': 'La liquidacion ya esta cerrada'}), 409

        pendientes = [d for d in liquidacion.detalles if d.estado_validacion == 'PENDIENTE_VALIDACION']
        if pendientes:
            return jsonify({
                'error': f'No puedes cerrar la liquidacion: hay {len(pendientes)} comision(es) sin soporte pendientes de validar',
            }), 409

        _recalcular_totales_liquidacion(liquidacion)
        liquidacion.estado = 'CERRADA'
        liquidacion.usuario_cierra_id = current_user.id
        liquidacion.fecha_cierre = datetime.utcnow()
        db.session.commit()
        return jsonify({
            'mensaje': 'Liquidacion cerrada',
            'liquidacion': _serialize_comision_liquidacion(liquidacion, incluir_detalle=True),
        }), 200
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error cerrando liquidacion de comision %s: %s", liquidacion_id, exc)
        return jsonify({'error': 'Error al cerrar la liquidacion'}), 500


@comercial_bp.route('/comisiones/liquidaciones/<int:liquidacion_id>', methods=['DELETE'])
@login_required
def eliminar_liquidacion_comision(liquidacion_id):
    try:
        _require_commercial_permission('comisiones', 'delete')
        liquidacion = ComisionLiquidacion.query.get_or_404(liquidacion_id)
        if liquidacion.estado == 'CERRADA':
            return jsonify({'error': 'No se puede eliminar una liquidacion cerrada'}), 409
        db.session.delete(liquidacion)
        db.session.commit()
        return jsonify({'mensaje': 'Liquidacion eliminada'}), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error eliminando liquidacion de comision %s: %s", liquidacion_id, exc)
        return jsonify({'error': 'Error al eliminar la liquidacion'}), 500


# ==================== RECAUDOS (COMPROBANTES DE PAGO AGRUPADOS) ====================

MEDIOS_RECAUDO = {'EFECTIVO', 'TRANSFERENCIA', 'CONSIGNACION', 'CHEQUE', 'OTRO'}


def _guardar_comprobante_recaudo(recaudo, archivo):
    """Guarda el soporte de pago del recaudo bajo la carpeta del cliente."""
    if not archivo or not archivo.filename:
        return

    upload_root = current_app.config['UPLOAD_FOLDER']
    recaudo_dir = os.path.join(upload_root, 'comercial', 'clientes', str(recaudo.cliente_id), 'recaudos')
    os.makedirs(recaudo_dir, exist_ok=True)

    nombre_original = secure_filename(archivo.filename)
    if not nombre_original:
        return

    nombre_guardado = f'{uuid.uuid4().hex}_{nombre_original}'
    ruta_absoluta = os.path.join(recaudo_dir, nombre_guardado)
    archivo.save(ruta_absoluta)

    recaudo.nombre_comprobante = nombre_original
    recaudo.ruta_comprobante = os.path.relpath(ruta_absoluta, upload_root)
    recaudo.mime_type = archivo.mimetype
    recaudo.tamano_bytes = os.path.getsize(ruta_absoluta)


def _get_recaudo_comprobante_path(recaudo):
    if not recaudo.ruta_comprobante:
        raise FileNotFoundError('Comprobante no encontrado')
    upload_root = os.path.abspath(current_app.config['UPLOAD_FOLDER'])
    ruta = os.path.abspath(os.path.join(upload_root, recaudo.ruta_comprobante))
    if not ruta.startswith(upload_root):
        raise FileNotFoundError('Ruta de comprobante invalida')
    if not os.path.exists(ruta):
        raise FileNotFoundError('Comprobante no encontrado')
    return ruta


def _calcular_comision_recaudo(recaudo, vendedor):
    """Comision = valor del comprobante x % de recaudo del vendedor."""
    porcentaje = Decimal(str((vendedor.porcentaje_comision_recaudo if vendedor else 0) or 0))
    valor = Decimal(str(recaudo.valor_comprobante or 0))
    comision = (valor * porcentaje / Decimal('100')).quantize(Decimal('0.01'))
    recaudo.porcentaje_aplicado = porcentaje
    recaudo.comision_calculada = comision


def _serialize_recaudo(recaudo, incluir_atenciones=False):
    data = {
        'id': recaudo.id,
        'cliente_id': recaudo.cliente_id,
        'cliente_nombre': recaudo.cliente.razon_social if recaudo.cliente else None,
        'vendedor_id': recaudo.vendedor_id,
        'vendedor_nombre': recaudo.vendedor.nombre if recaudo.vendedor else None,
        'fecha_pago': recaudo.fecha_pago.strftime('%Y-%m-%d') if recaudo.fecha_pago else None,
        'valor_comprobante': float(recaudo.valor_comprobante or 0),
        'medio_pago': recaudo.medio_pago,
        'canal_transferencia': recaudo.canal_transferencia,
        'porcentaje_aplicado': float(recaudo.porcentaje_aplicado or 0),
        'comision_calculada': float(recaudo.comision_calculada or 0),
        'estado': recaudo.estado,
        'observaciones': recaudo.observaciones,
        'nombre_comprobante': recaudo.nombre_comprobante,
        'comprobante_url': f'/api/comercial/recaudos/{recaudo.id}/comprobante' if recaudo.ruta_comprobante else None,
        'cantidad_atenciones': recaudo.atenciones.count(),
        'created_at': recaudo.created_at.strftime('%Y-%m-%d %H:%M:%S') if recaudo.created_at else None,
    }
    if incluir_atenciones:
        asociaciones = recaudo.atenciones.all()
        data['atenciones'] = [{
            'id': asoc.id,
            'atencion_id': asoc.atencion_id,
            'nro_atencion': asoc.atencion.nro_atencion if asoc.atencion else None,
            'paciente_nombre': asoc.atencion.paciente_nombre if asoc.atencion else None,
            'valor_atencion': float(asoc.atencion.valor_total or 0) if asoc.atencion else 0,
            'valor_aplicado': float(asoc.valor_aplicado or 0),
        } for asoc in asociaciones]
    return data


def _resolver_atenciones_del_cliente_en_scope(cliente):
    """Lista atenciones del cliente (respetando scope de vendedor)."""
    return ClienteAtencion.query.filter_by(cliente_id=cliente.id).order_by(
        ClienteAtencion.fecha_atencion.desc(),
        ClienteAtencion.id.desc(),
    ).all()


def _aplicar_atenciones_a_recaudo(recaudo, atencion_ids):
    """Reemplaza las atenciones asociadas al recaudo por la lista dada.

    Solo permite atenciones del mismo cliente del recaudo."""
    ids = []
    for raw in (atencion_ids or []):
        try:
            ids.append(int(raw))
        except (TypeError, ValueError):
            continue
    ids = list(dict.fromkeys(ids))  # unicos, preserva orden

    # Borrar asociaciones actuales
    for asoc in recaudo.atenciones.all():
        db.session.delete(asoc)
    db.session.flush()

    for atencion_id in ids:
        atencion = ClienteAtencion.query.get(atencion_id)
        if atencion is None or atencion.cliente_id != recaudo.cliente_id:
            raise ValueError('Solo puedes asociar atenciones del mismo cliente del recaudo')
        db.session.add(ComercialRecaudoAtencion(
            recaudo_id=recaudo.id,
            atencion_id=atencion_id,
            valor_aplicado=Decimal(str(atencion.valor_total or 0)),
        ))


@comercial_bp.route('/clientes/<int:cliente_id>/atenciones-pendientes', methods=['GET'])
@login_required
def get_atenciones_pendientes_recaudo(cliente_id):
    """Atenciones del cliente para poder marcarlas en un recaudo agrupado.

    Incluye si ya estan asociadas a algun recaudo (para el agrupado dinamico)."""
    try:
        _require_commercial_permission('atenciones', 'read')
        cliente = _obtener_cliente_comercial_en_scope(cliente_id)
        atenciones = _resolver_atenciones_del_cliente_en_scope(cliente)
        resultado = []
        for atencion in atenciones:
            asociaciones = atencion.recaudo_asociaciones.all()
            resultado.append({
                'id': atencion.id,
                'nro_atencion': atencion.nro_atencion,
                'fecha_atencion': atencion.fecha_atencion.strftime('%Y-%m-%d') if atencion.fecha_atencion else None,
                'paciente_nombre': atencion.paciente_nombre,
                'paciente_documento': atencion.paciente_documento,
                'valor_total': float(atencion.valor_total or 0),
                'estado_cobro': atencion.estado_cobro,
                'recaudos_asociados': [asoc.recaudo_id for asoc in asociaciones],
                'tiene_recaudo': len(asociaciones) > 0,
            })
        return jsonify(resultado), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error obteniendo atenciones pendientes del cliente %s: %s", cliente_id, exc)
        return jsonify({'error': 'Error al obtener las atenciones del cliente'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>/recaudos', methods=['GET'])
@login_required
def get_recaudos_cliente(cliente_id):
    try:
        _require_commercial_permission('pagos', 'read')
        cliente = _obtener_cliente_comercial_en_scope(cliente_id)
        recaudos = ComercialRecaudo.query.filter_by(cliente_id=cliente.id).order_by(
            ComercialRecaudo.fecha_pago.desc(),
            ComercialRecaudo.id.desc(),
        ).all()
        return jsonify([_serialize_recaudo(r, incluir_atenciones=True) for r in recaudos]), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error obteniendo recaudos del cliente %s: %s", cliente_id, exc)
        return jsonify({'error': 'Error al obtener los recaudos del cliente'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>/recaudos', methods=['POST'])
@login_required
def crear_recaudo_cliente(cliente_id):
    """Crea un recaudo (comprobante de pago). Puede venir con o sin atenciones.

    La comision se calcula sobre el valor del comprobante x % recaudo del
    vendedor. El soporte de pago es opcional al crear (se puede subir despues)."""
    data = _get_payload()
    try:
        _require_commercial_permission('pagos', 'create')
        cliente = _obtener_cliente_comercial_en_scope(cliente_id)

        fecha_pago = _parse_date_field(data, 'fecha_pago')
        if not fecha_pago:
            raise ValueError('La fecha del pago es obligatoria')
        valor_comprobante = _parse_decimal_field(data, 'valor_comprobante', minimum=0.01)

        medio_pago = str(data.get('medio_pago') or 'TRANSFERENCIA').strip().upper()
        if medio_pago not in MEDIOS_RECAUDO:
            raise ValueError('El medio de pago del recaudo no es valido')

        canal = _normalize_optional_text(data.get('canal_transferencia'))
        if medio_pago == 'TRANSFERENCIA':
            canal = str(canal or '').strip().upper()
            if canal not in CANALES_TRANSFERENCIA:
                raise ValueError('Indica si la transferencia fue por Nequi, Daviplata o Banco')
        else:
            canal = None

        recaudo = ComercialRecaudo(
            cliente_id=cliente.id,
            vendedor_id=cliente.vendedor_id,
            fecha_pago=fecha_pago,
            valor_comprobante=valor_comprobante,
            medio_pago=medio_pago,
            canal_transferencia=canal,
            estado='REGISTRADO',
            observaciones=_normalize_optional_text(data.get('observaciones')),
            usuario_id=current_user.id,
        )
        _calcular_comision_recaudo(recaudo, cliente.vendedor)
        db.session.add(recaudo)
        db.session.flush()

        # Atenciones opcionales (agrupado dinamico)
        atencion_ids = _parse_int_list_field(data, 'atencion_ids')
        if atencion_ids:
            _aplicar_atenciones_a_recaudo(recaudo, atencion_ids)

        # Soporte opcional
        comprobante = request.files.get('comprobante_pago')
        if comprobante:
            _guardar_comprobante_recaudo(recaudo, comprobante)

        db.session.commit()
        return jsonify({
            'mensaje': 'Recaudo registrado',
            'id': recaudo.id,
            'comision_calculada': float(recaudo.comision_calculada or 0),
        }), 201
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando recaudo para cliente %s: %s", cliente_id, exc)
        return jsonify({'error': 'Error al registrar el recaudo'}), 500


@comercial_bp.route('/recaudos/<int:recaudo_id>', methods=['PUT'])
@login_required
def actualizar_recaudo(recaudo_id):
    """Actualiza un recaudo: valor, datos, atenciones asociadas y/o soporte.

    Recalcula la comision si cambia el valor del comprobante."""
    data = _get_payload()
    try:
        _require_commercial_permission('pagos', 'update')
        recaudo = ComercialRecaudo.query.get_or_404(recaudo_id)
        _asegurar_cliente_en_scope(recaudo.cliente)

        fecha_pago = _parse_date_field(data, 'fecha_pago')
        if fecha_pago:
            recaudo.fecha_pago = fecha_pago
        if data.get('valor_comprobante') not in (None, ''):
            recaudo.valor_comprobante = _parse_decimal_field(data, 'valor_comprobante', minimum=0.01)
        if data.get('medio_pago'):
            medio_pago = str(data.get('medio_pago')).strip().upper()
            if medio_pago not in MEDIOS_RECAUDO:
                raise ValueError('El medio de pago del recaudo no es valido')
            recaudo.medio_pago = medio_pago
            if medio_pago == 'TRANSFERENCIA':
                canal = str(_normalize_optional_text(data.get('canal_transferencia')) or '').strip().upper()
                if canal not in CANALES_TRANSFERENCIA:
                    raise ValueError('Indica si la transferencia fue por Nequi, Daviplata o Banco')
                recaudo.canal_transferencia = canal
            else:
                recaudo.canal_transferencia = None
        if 'observaciones' in data:
            recaudo.observaciones = _normalize_optional_text(data.get('observaciones'))

        _calcular_comision_recaudo(recaudo, recaudo.vendedor)

        if data.get('atencion_ids') is not None:
            atencion_ids = _parse_int_list_field(data, 'atencion_ids')
            _aplicar_atenciones_a_recaudo(recaudo, atencion_ids)

        comprobante = request.files.get('comprobante_pago')
        if comprobante:
            _guardar_comprobante_recaudo(recaudo, comprobante)

        db.session.commit()
        return jsonify({
            'mensaje': 'Recaudo actualizado',
            'comision_calculada': float(recaudo.comision_calculada or 0),
        }), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando recaudo %s: %s", recaudo_id, exc)
        return jsonify({'error': 'Error al actualizar el recaudo'}), 500


@comercial_bp.route('/recaudos/<int:recaudo_id>', methods=['DELETE'])
@login_required
def eliminar_recaudo(recaudo_id):
    try:
        _require_commercial_permission('pagos', 'delete')
        recaudo = ComercialRecaudo.query.get_or_404(recaudo_id)
        _asegurar_cliente_en_scope(recaudo.cliente)
        if recaudo.ruta_comprobante:
            try:
                ruta = _get_recaudo_comprobante_path(recaudo)
                if os.path.exists(ruta):
                    os.remove(ruta)
            except (FileNotFoundError, OSError):
                pass
        db.session.delete(recaudo)
        db.session.commit()
        return jsonify({'mensaje': 'Recaudo eliminado'}), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except HTTPException:
        raise
    except Exception as exc:
        db.session.rollback()
        logger.error("Error eliminando recaudo %s: %s", recaudo_id, exc)
        return jsonify({'error': 'Error al eliminar el recaudo'}), 500


@comercial_bp.route('/recaudos/<int:recaudo_id>/comprobante', methods=['GET'])
@login_required
def descargar_comprobante_recaudo(recaudo_id):
    try:
        _require_commercial_permission('pagos', 'read')
        recaudo = ComercialRecaudo.query.get_or_404(recaudo_id)
        _asegurar_cliente_en_scope(recaudo.cliente)
        ruta = _get_recaudo_comprobante_path(recaudo)
        return send_file(ruta, as_attachment=True, download_name=recaudo.nombre_comprobante or 'comprobante_recaudo')
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except FileNotFoundError as exc:
        return jsonify({'error': str(exc)}), 404
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error descargando comprobante de recaudo %s: %s", recaudo_id, exc)
        return jsonify({'error': 'Error al descargar el comprobante'}), 500


@comercial_bp.route('/recaudos/comision-acumulada', methods=['GET'])
@login_required
def get_comision_acumulada_recaudos():
    """Comision acumulada por recaudos, filtrable por vendedor/periodo.

    Para un usuario-vendedor, se limita a su propia comision."""
    try:
        _require_commercial_permission('comisiones', 'read')
        query = ComercialRecaudo.query

        vendedor_scope = _resolver_vendedor_usuario_actual()
        if vendedor_scope is not None:
            query = query.filter_by(vendedor_id=vendedor_scope.id)
        else:
            vendedor_id = request.args.get('vendedor_id', type=int)
            if vendedor_id:
                query = query.filter_by(vendedor_id=vendedor_id)

        mes = request.args.get('mes', type=int)
        anio = request.args.get('anio', type=int)
        if mes and anio:
            inicio, fin = _rango_periodo(mes, anio)
            query = query.filter(
                ComercialRecaudo.fecha_pago >= inicio,
                ComercialRecaudo.fecha_pago < fin,
            )

        recaudos = query.order_by(ComercialRecaudo.fecha_pago.desc(), ComercialRecaudo.id.desc()).all()
        total_recaudado = sum(Decimal(str(r.valor_comprobante or 0)) for r in recaudos)
        total_comision = sum(Decimal(str(r.comision_calculada or 0)) for r in recaudos)
        return jsonify({
            'total_recaudado': float(total_recaudado),
            'total_comision': float(total_comision),
            'cantidad_recaudos': len(recaudos),
            'recaudos': [_serialize_recaudo(r, incluir_atenciones=True) for r in recaudos],
        }), 200
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        logger.error("Error obteniendo comision acumulada de recaudos: %s", exc)
        return jsonify({'error': 'Error al obtener la comision acumulada'}), 500
