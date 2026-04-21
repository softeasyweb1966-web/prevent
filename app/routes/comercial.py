from datetime import datetime
from decimal import Decimal, InvalidOperation
import logging
import os
import uuid

from flask import current_app, jsonify, request, send_file
from flask_login import login_required
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename

from app.models import (
    ClienteComercial,
    ClienteComercialAdjunto,
    ClienteComercialTarifa,
    ComercialCatalogoItem,
    ComercialPaqueteDetalle,
    Vendedor,
    db,
)
from app.routes import comercial_bp


logger = logging.getLogger(__name__)

CONDICIONES_COMERCIALES = {'EFECTIVO', 'CREDITO', 'MIXTO'}
TIPOS_CATALOGO_COMERCIAL = {'EXAMEN', 'PAQUETE', 'SERVICIO'}
TIPOS_EXAMEN_COMERCIAL = {'CONSULTA', 'LABORATORIO', 'PARACLINICO'}


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


def _build_vendedor_payload(data):
    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        raise ValueError('El nombre del vendedor es obligatorio')

    return {
        'nombre': nombre,
        'documento': _normalize_optional_text(data.get('documento')),
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
    vendedor_id = _parse_int_field(data, 'vendedor_id', required=True)
    vendedor = Vendedor.query.get(vendedor_id)
    if not vendedor:
        raise ValueError('Debe seleccionar un vendedor válido')

    razon_social = (data.get('razon_social') or '').strip()
    if not razon_social:
        raise ValueError('La razón social es obligatoria')

    condicion = str(data.get('condicion_comercial') or 'EFECTIVO').strip().upper()
    if condicion not in CONDICIONES_COMERCIALES:
        raise ValueError('La condición comercial debe ser EFECTIVO, CREDITO o MIXTO')

    requiere_factura = _parse_bool(data.get('requiere_factura'), False)
    fechas_facturacion = _normalize_optional_text(data.get('fechas_facturacion'))
    fecha_solicitud_factura = _parse_date_field(data, 'fecha_solicitud_factura')

    if requiere_factura:
        if not fechas_facturacion:
            raise ValueError('Debe indicar las fechas de facturación cuando el cliente requiere factura')
    else:
        condicion = 'EFECTIVO'
        fechas_facturacion = None
        fecha_solicitud_factura = None

    return {
        'vendedor_id': vendedor_id,
        'razon_social': razon_social,
        'nombre_comercial': _normalize_optional_text(data.get('nombre_comercial')),
        'nit': _normalize_optional_text(data.get('nit')),
        'ciudad': _normalize_optional_text(data.get('ciudad')),
        'direccion': _normalize_optional_text(data.get('direccion')),
        'telefono_empresa': _normalize_optional_text(data.get('telefono_empresa')),
        'email_empresa': _normalize_optional_text(data.get('email_empresa')),
        'contacto_principal': _normalize_optional_text(data.get('contacto_principal')),
        'celular_contacto_principal': _normalize_optional_text(data.get('celular_contacto_principal')),
        'email_contacto_principal': _normalize_optional_text(data.get('email_contacto_principal')),
        'contacto_facturacion': _normalize_optional_text(data.get('contacto_facturacion')),
        'celular_facturacion': _normalize_optional_text(data.get('celular_facturacion')),
        'email_facturacion': _normalize_optional_text(data.get('email_facturacion')),
        'condicion_comercial': condicion,
        'requiere_factura': requiere_factura,
        'fechas_facturacion': fechas_facturacion,
        'fecha_solicitud_factura': fecha_solicitud_factura,
        'examenes_convenidos': _normalize_optional_text(data.get('examenes_convenidos')),
        'servicios_convenidos': _normalize_optional_text(data.get('servicios_convenidos')),
        'tarifas_convenidas': _normalize_optional_text(data.get('tarifas_convenidas')),
        'documentos_legales_completos': _parse_bool(data.get('documentos_legales_completos'), False),
        'documentos_legales_detalle': _normalize_optional_text(data.get('documentos_legales_detalle')),
        'pagare_firmado': _parse_bool(data.get('pagare_firmado'), False),
        'pagare_detalle': _normalize_optional_text(data.get('pagare_detalle')),
        'observaciones': _normalize_optional_text(data.get('observaciones')),
        'activo': _parse_bool(data.get('activo'), True),
    }


def _build_catalogo_item_payload(data):
    tipo_item = str(data.get('tipo_item') or '').strip().upper()
    tipo_examen = _normalize_optional_text(data.get('tipo_examen'))
    nombre = (data.get('nombre') or '').strip()

    if tipo_item not in TIPOS_CATALOGO_COMERCIAL:
        raise ValueError('El tipo de item debe ser EXAMEN, PAQUETE o SERVICIO')
    if not nombre:
        raise ValueError('El nombre del item comercial es obligatorio')
    if tipo_item == 'EXAMEN':
        tipo_examen = str(tipo_examen or '').strip().upper()
        if tipo_examen not in TIPOS_EXAMEN_COMERCIAL:
            raise ValueError('Debe seleccionar si el examen es CONSULTA, LABORATORIO o PARACLINICO')
    else:
        tipo_examen = None

    return {
        'tipo_item': tipo_item,
        'tipo_examen': tipo_examen,
        'nombre': nombre,
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
        if examen.tipo_item != 'EXAMEN' or examen.tipo_examen not in TIPOS_EXAMEN_COMERCIAL
    ]
    if examenes_invalidos:
        raise ValueError('Los componentes del paquete deben ser examenes clasificados como CONSULTA, LABORATORIO o PARACLINICO')

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


def _serialize_vendedor(vendedor):
    return {
        'id': vendedor.id,
        'nombre': vendedor.nombre,
        'documento': vendedor.documento,
        'telefono': vendedor.telefono,
        'email': vendedor.email,
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
        'nombre': item.nombre,
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
        'tarifa_base': float(tarifa.item_catalogo.tarifa_base or 0) if tarifa.item_catalogo else 0,
        'tarifa_negociada': float(tarifa.tarifa_negociada or 0),
        'vigencia_desde': tarifa.vigencia_desde.strftime('%Y-%m-%d') if tarifa.vigencia_desde else None,
        'vigencia_hasta': tarifa.vigencia_hasta.strftime('%Y-%m-%d') if tarifa.vigencia_hasta else None,
        'observacion': tarifa.observacion,
        'activo': tarifa.activo,
    }


def _guardar_componentes_paquete(item, componentes_ids):
    item.paquete_componentes.clear()

    if item.tipo_item != 'PAQUETE':
        return

    for examen_id in componentes_ids:
        item.paquete_componentes.append(
            ComercialPaqueteDetalle(examen_id=examen_id, cantidad=1)
        )


def _resumen_facturacion(cliente):
    if not cliente.requiere_factura:
        return 'Cliente en efectivo. Si solicita facturación, aplica desde la fecha de solicitud.'

    partes = ['Factura requerida']
    if cliente.fechas_facturacion:
        partes.append(f'Fechas: {cliente.fechas_facturacion}')
    if cliente.fecha_solicitud_factura:
        partes.append(f'Solicitud: {cliente.fecha_solicitud_factura.strftime("%Y-%m-%d")}')
    return ' | '.join(partes)


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
        'celular_contacto_principal': cliente.celular_contacto_principal,
        'email_contacto_principal': cliente.email_contacto_principal,
        'contacto_facturacion': cliente.contacto_facturacion,
        'celular_facturacion': cliente.celular_facturacion,
        'email_facturacion': cliente.email_facturacion,
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
        'pagare_firmado': cliente.pagare_firmado,
        'pagare_detalle': cliente.pagare_detalle,
        'observaciones': cliente.observaciones,
        'activo': cliente.activo,
        'documentos_legales_adjuntos': documentos_legales,
        'pagare_adjuntos': pagares,
        'created_at': cliente.created_at.strftime('%Y-%m-%d %H:%M:%S') if cliente.created_at else None,
        'updated_at': cliente.updated_at.strftime('%Y-%m-%d %H:%M:%S') if cliente.updated_at else None,
    }


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
        vendedores = Vendedor.query.order_by(Vendedor.activo.desc(), Vendedor.nombre.asc()).all()
        return jsonify([_serialize_vendedor(vendedor) for vendedor in vendedores]), 200
    except Exception as exc:
        logger.error("Error obteniendo vendedores comerciales: %s", exc)
        return jsonify({'error': 'Error al obtener vendedores'}), 500


@comercial_bp.route('/vendedores', methods=['POST'])
@login_required
def crear_vendedor():
    data = _get_payload()

    try:
        payload = _build_vendedor_payload(data)
        documento = payload['documento']

        if documento and Vendedor.query.filter_by(documento=documento).first():
            return jsonify({'error': 'Ya existe un vendedor con ese documento'}), 409

        vendedor = Vendedor(**payload)
        db.session.add(vendedor)
        db.session.commit()
        return jsonify({'mensaje': 'Vendedor creado', 'id': vendedor.id}), 201
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando vendedor comercial: %s", exc)
        return jsonify({'error': 'Error al crear vendedor'}), 500


@comercial_bp.route('/vendedores/<int:vendedor_id>', methods=['PUT'])
@login_required
def actualizar_vendedor(vendedor_id):
    data = _get_payload()

    try:
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

        vendedor.nombre = payload['nombre']
        vendedor.documento = payload['documento']
        vendedor.telefono = payload['telefono']
        vendedor.email = payload['email']
        vendedor.porcentaje_comision_venta = payload['porcentaje_comision_venta']
        vendedor.porcentaje_comision_recaudo = payload['porcentaje_comision_recaudo']
        vendedor.monto_base_comision = payload['monto_base_comision']
        vendedor.descripcion = payload['descripcion']
        vendedor.activo = payload['activo']

        db.session.commit()
        return jsonify({'mensaje': 'Vendedor actualizado'}), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando vendedor comercial: %s", exc)
        return jsonify({'error': 'Error al actualizar vendedor'}), 500


@comercial_bp.route('/catalogo', methods=['GET'])
@login_required
def get_catalogo_comercial():
    try:
        items = ComercialCatalogoItem.query.order_by(
            ComercialCatalogoItem.activo.desc(),
            ComercialCatalogoItem.tipo_item.asc(),
            ComercialCatalogoItem.nombre.asc()
        ).all()
        return jsonify([_serialize_catalogo_item(item) for item in items]), 200
    except Exception as exc:
        logger.error("Error obteniendo catalogo comercial: %s", exc)
        return jsonify({'error': 'Error al obtener catálogo comercial'}), 500


@comercial_bp.route('/catalogo', methods=['POST'])
@login_required
def crear_catalogo_comercial():
    data = _get_payload()

    try:
        payload = _build_catalogo_item_payload(data)
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
        payload = _build_catalogo_item_payload(data)
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

        for field, value in payload.items():
            setattr(item, field, value)

        _guardar_componentes_paquete(item, componentes_ids)
        db.session.commit()
        return jsonify({'mensaje': 'Item comercial actualizado'}), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando item comercial: %s", exc)
        return jsonify({'error': 'Error al actualizar item comercial'}), 500


@comercial_bp.route('/tarifas', methods=['GET'])
@login_required
def get_tarifas_comerciales():
    try:
        tarifas = ClienteComercialTarifa.query.order_by(
            ClienteComercialTarifa.activo.desc(),
            ClienteComercialTarifa.id.desc()
        ).all()
        return jsonify([_serialize_tarifa_cliente(tarifa) for tarifa in tarifas]), 200
    except Exception as exc:
        logger.error("Error obteniendo tarifas comerciales: %s", exc)
        return jsonify({'error': 'Error al obtener tarifas comerciales'}), 500


@comercial_bp.route('/tarifas', methods=['POST'])
@login_required
def crear_tarifa_comercial():
    data = _get_payload()

    try:
        payload = _build_tarifa_cliente_payload(data)
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
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando tarifa comercial: %s", exc)
        return jsonify({'error': 'Error al crear tarifa comercial'}), 500


@comercial_bp.route('/tarifas/<int:tarifa_id>', methods=['PUT'])
@login_required
def actualizar_tarifa_comercial(tarifa_id):
    data = _get_payload()

    try:
        tarifa = ClienteComercialTarifa.query.get_or_404(tarifa_id)
        payload = _build_tarifa_cliente_payload(data)
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
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando tarifa comercial: %s", exc)
        return jsonify({'error': 'Error al actualizar tarifa comercial'}), 500


@comercial_bp.route('/clientes', methods=['GET'])
@login_required
def get_clientes():
    try:
        clientes = ClienteComercial.query.order_by(
            ClienteComercial.activo.desc(),
            ClienteComercial.razon_social.asc()
        ).all()
        return jsonify([_serialize_cliente(cliente) for cliente in clientes]), 200
    except Exception as exc:
        logger.error("Error obteniendo clientes comerciales: %s", exc)
        return jsonify({'error': 'Error al obtener clientes comerciales'}), 500


@comercial_bp.route('/clientes', methods=['POST'])
@login_required
def crear_cliente():
    data = _get_payload()

    try:
        payload = _build_cliente_payload(data)
        nit = payload['nit']
        if nit and ClienteComercial.query.filter_by(nit=nit).first():
            return jsonify({'error': 'Ya existe un cliente con ese NIT'}), 409

        cliente = ClienteComercial(**payload)
        db.session.add(cliente)
        db.session.flush()

        _guardar_adjuntos(cliente, request.files.getlist('documentos_legales_adjuntos'), 'DOCUMENTO_LEGAL')
        _guardar_adjuntos(cliente, request.files.getlist('pagare_adjuntos'), 'PAGARE')

        db.session.commit()
        return jsonify({'mensaje': 'Cliente comercial creado', 'id': cliente.id}), 201
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando cliente comercial: %s", exc)
        return jsonify({'error': 'Error al crear cliente comercial'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>', methods=['PUT'])
@login_required
def actualizar_cliente(cliente_id):
    data = _get_payload()

    try:
        cliente = ClienteComercial.query.get_or_404(cliente_id)
        payload = _build_cliente_payload(data)
        nit = payload['nit']
        if nit:
            existente = ClienteComercial.query.filter(
                ClienteComercial.nit == nit,
                ClienteComercial.id != cliente_id
            ).first()
            if existente:
                return jsonify({'error': 'Ya existe un cliente con ese NIT'}), 409

        for field, value in payload.items():
            setattr(cliente, field, value)

        _guardar_adjuntos(cliente, request.files.getlist('documentos_legales_adjuntos'), 'DOCUMENTO_LEGAL')
        _guardar_adjuntos(cliente, request.files.getlist('pagare_adjuntos'), 'PAGARE')

        db.session.commit()
        return jsonify({'mensaje': 'Cliente comercial actualizado'}), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando cliente comercial: %s", exc)
        return jsonify({'error': 'Error al actualizar cliente comercial'}), 500


@comercial_bp.route('/clientes/<int:cliente_id>/adjuntos/<int:adjunto_id>', methods=['GET'])
@login_required
def descargar_adjunto_cliente(cliente_id, adjunto_id):
    try:
        cliente = ClienteComercial.query.get_or_404(cliente_id)
        adjunto = ClienteComercialAdjunto.query.filter_by(id=adjunto_id, cliente_id=cliente.id).first_or_404()
        ruta = _get_adjunto_path(adjunto)
        return send_file(ruta, as_attachment=True, download_name=adjunto.nombre_original)
    except FileNotFoundError as exc:
        return jsonify({'error': str(exc)}), 404
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error descargando adjunto comercial: %s", exc)
        return jsonify({'error': 'Error al descargar adjunto'}), 500
