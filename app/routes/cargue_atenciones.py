"""Endpoints para cargue diario de atenciones desde Excel."""

from __future__ import annotations

import io
import logging
import os
import re
import unicodedata
import zipfile
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
from xml.etree import ElementTree as ET

from flask import jsonify, request, send_file
from flask_login import current_user, login_required
from sqlalchemy import BigInteger, cast, func, or_

from app.models import (
    AtencionDiaDetalle,
    CargueAtencionDia,
    ClienteComercial,
    ComercialCatalogoItem,
    Vendedor,
    db,
)
from app.routes import comercial_bp
from app.security import get_permission_names_for_user

logger = logging.getLogger(__name__)

COLUMNAS_ESPERADAS = [
    'NÃâÃÂ°. Orden Servicio',
    'NÃâÃÂ°. Factura',
    'Fecha de Factura',
    'Precio',
    'FormaPago',
    'Nombre del Producto o Servicio',
    'NÃâÃÂ°. de IdentificaciÃÆÃÂ³n',
    'Nombre del Paciente',
    'Nombre del Acuerdo Comercial',
    'Empresa en MisiÃÆÃÂ³n',
    'Sede',
    'Nombre del Vendedor',
    'Fecha de CreaciÃÆÃÂ³n Orden Servicio',
    'Usuario de CreaciÃÆÃÂ³n Orden Servicio',
    'Estado de la Orden Servicio',
    'Fecha de AnulaciÃÆÃÂ³n Orden Servicio',
]

PERMISO_CARGUE_ATENCIONES = 'comercial_atenciones_create'
PERMISO_CONSULTA_ATENCIONES = 'comercial_atenciones_read'

_FECHA_RE = re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})')
_XML_NS = {'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
_VALORES_EMPRESA_GENERICOS = {
    'principal',
    'particular',
    'ninguna',
    'na',
    'n a',
}


def _is_admin_user():
    return bool(getattr(current_user, 'is_easy', False)) or getattr(getattr(current_user, 'role', None), 'nombre', None) == 'Administrador'


def _get_current_permission_names():
    if _is_admin_user():
        return {'*'}
    return get_permission_names_for_user(current_user)


def _require_commercial_permission(permission_name):
    if '*' in _get_current_permission_names():
        return
    if permission_name not in _get_current_permission_names():
        raise PermissionError('No tienes permiso para realizar esta acciÃÆÃÂ³n en atenciones comerciales')


def _normalizar(valor):
    if valor is None:
        return None
    texto = str(valor).replace('\xa0', ' ').strip()
    return texto or None


def _normalizar_etiqueta(valor):
    texto = _normalizar(valor) or ''
    texto = unicodedata.normalize('NFKD', texto)
    texto = ''.join(ch for ch in texto if not unicodedata.combining(ch))
    texto = texto.lower().replace('nÃâÃÂ°.', 'nro').replace('nÃâÃÂ°', 'nro').replace('nÃâÃÂº', 'nro')
    texto = re.sub(r'[^a-z0-9]+', ' ', texto)
    return re.sub(r'\s+', ' ', texto).strip()


def _normalizar_match(valor):
    texto = _normalizar(valor) or ''
    texto = unicodedata.normalize('NFKD', texto)
    texto = ''.join(ch for ch in texto if not unicodedata.combining(ch))
    texto = texto.lower()
    texto = re.sub(r'[^a-z0-9]+', ' ', texto)
    return re.sub(r'\s+', ' ', texto).strip()


def _parse_fecha(valor):
    """Parsea fechas en formato dd/mm/yyyy hh:mm a./p. m."""
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor

    texto = _normalizar(valor)
    if not texto:
        return None

    for fmt in ('%Y-%m-%d', '%Y-%m-%d %H:%M:%S', '%d/%m/%Y', '%d/%m/%Y %H:%M'):
        try:
            return datetime.strptime(texto, fmt)
        except ValueError:
            pass

    match = _FECHA_RE.search(texto)
    if not match:
        return None

    dia, mes, anio, hora, minuto = (int(x) for x in match.groups())
    texto_lower = texto.lower()
    if 'p' in texto_lower and hora != 12:
        hora += 12
    elif 'a' in texto_lower and hora == 12:
        hora = 0

    try:
        return datetime(anio, mes, dia, hora, minuto)
    except ValueError:
        return None


def _parse_precio(valor):
    if valor is None:
        return None
    if isinstance(valor, Decimal):
        return valor
    if isinstance(valor, (int, float)):
        return Decimal(str(valor))

    texto = _normalizar(valor)
    if not texto:
        return None

    texto = texto.replace('$', '').replace(' ', '')
    if ',' in texto and '.' in texto:
        if texto.rfind(',') > texto.rfind('.'):
            texto = texto.replace('.', '').replace(',', '.')
        else:
            texto = texto.replace(',', '')
    elif ',' in texto:
        texto = texto.replace('.', '').replace(',', '.')

    try:
        return Decimal(texto)
    except InvalidOperation:
        return None


def _cargar_rows_openpyxl(contenido):
    import openpyxl

    workbook = openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
    worksheet = workbook.active
    return [list(row) for row in worksheet.iter_rows(values_only=True)]


def _cell_value_xml(cell, shared_strings):
    cell_type = cell.attrib.get('t')
    if cell_type == 'inlineStr':
        return ''.join(node.text or '' for node in cell.findall('.//a:t', _XML_NS))

    value_node = cell.find('a:v', _XML_NS)
    if value_node is None:
        return None

    raw_value = value_node.text
    if cell_type == 's':
        try:
            return shared_strings[int(raw_value)]
        except Exception:
            return raw_value
    return raw_value


def _columna_excel_a_indice(ref):
    indice = 0
    for caracter in ref:
        if not caracter.isalpha():
            break
        indice = (indice * 26) + (ord(caracter.upper()) - 64)
    return indice - 1


def _cargar_rows_xlsx_xml(contenido):
    with zipfile.ZipFile(io.BytesIO(contenido)) as zipped:
        shared_strings = []
        if 'xl/sharedStrings.xml' in zipped.namelist():
            root = ET.fromstring(zipped.read('xl/sharedStrings.xml'))
            for node in root.findall('a:si', _XML_NS):
                shared_strings.append(''.join(text_node.text or '' for text_node in node.findall('.//a:t', _XML_NS)))

        root = ET.fromstring(zipped.read('xl/worksheets/sheet1.xml'))
        rows = []
        for row in root.findall('.//a:sheetData/a:row', _XML_NS):
            values_by_index = {}
            max_index = -1
            for cell in row.findall('a:c', _XML_NS):
                reference = cell.attrib.get('r', '')
                column_index = _columna_excel_a_indice(reference)
                max_index = max(max_index, column_index)
                values_by_index[column_index] = _cell_value_xml(cell, shared_strings)

            if max_index < 0:
                rows.append([])
                continue

            dense_row = [None] * (max_index + 1)
            for column_index, value in values_by_index.items():
                dense_row[column_index] = value
            rows.append(dense_row)

    return rows


def _leer_excel_atenciones(contenido, nombre_archivo):
    if not str(nombre_archivo or '').lower().endswith('.xlsx'):
        raise ValueError('Solo se aceptan archivos .xlsx con la estructura de Estado-de-las-Atenciones.xlsx')

    try:
        return _cargar_rows_openpyxl(contenido)
    except ImportError:
        logger.warning('openpyxl no estÃÆÃÂ¡ disponible; se usarÃÆÃÂ¡ parser XML para %s', nombre_archivo)
    except Exception as exc:
        logger.warning('openpyxl no pudo leer %s (%s). Se intentarÃÆÃÂ¡ parser XML.', nombre_archivo, exc)

    try:
        return _cargar_rows_xlsx_xml(contenido)
    except Exception as exc:
        logger.error('Error leyendo Excel de atenciones con parser XML: %s', exc)
        raise ValueError(f'No se pudo leer el archivo Excel: {exc}') from exc


def _extraer_registros_excel(filas):
    if not filas:
        raise ValueError('El archivo estÃÆÃÂ¡ vacÃÆÃÂ­o')

    encabezados = [str(valor).strip() if valor is not None else '' for valor in filas[0]]
    headers_norm = {_normalizar_etiqueta(valor): index for index, valor in enumerate(encabezados) if _normalizar_etiqueta(valor)}

    required_map = {_normalizar_etiqueta(columna): columna for columna in COLUMNAS_ESPERADAS}
    faltantes = [columna for key, columna in required_map.items() if key not in headers_norm]
    if faltantes:
        raise ValueError(
            f'Columnas requeridas no encontradas: {", ".join(faltantes)}. '
            'Verifique que el archivo tenga el mismo formato de Estado-de-las-Atenciones.xlsx.'
        )

    registros = []
    for fila in filas[1:]:
        if not fila or all(valor in (None, '') for valor in fila):
            continue

        registro = {}
        for normalized_name, original_name in required_map.items():
            index = headers_norm[normalized_name]
            registro[original_name] = fila[index] if index < len(fila) else None
        registros.append(registro)

    return registros


def _resolver_vendedor_usuario_actual():
    if _is_admin_user():
        return None

    normalized_candidates = [
        _normalizar_match(getattr(current_user, 'email', None)),
        _normalizar_match(getattr(current_user, 'usuario', None)),
        _normalizar_match(getattr(current_user, 'nombre_completo', None)),
    ]
    normalized_candidates = [value for value in normalized_candidates if value]
    if not normalized_candidates:
        return None

    vendedores = Vendedor.query.all()
    for vendedor in vendedores:
        vendor_candidates = {
            _normalizar_match(vendedor.nombre),
            _normalizar_match(vendedor.email),
            _normalizar_match(vendedor.documento),
        }
        vendor_candidates.discard('')
        if any(candidate in vendor_candidates for candidate in normalized_candidates):
            return vendedor
    return None


def _construir_lookup_clientes():
    lookup = {}
    clientes = ClienteComercial.query.all()
    for cliente in clientes:
        for value in (cliente.razon_social, cliente.nombre_comercial, cliente.nit):
            normalized = _normalizar_match(value)
            if normalized and normalized not in lookup:
                lookup[normalized] = cliente
    return lookup


def _construir_lookup_vendedores():
    lookup = {}
    vendedores = Vendedor.query.all()
    for vendedor in vendedores:
        for value in (vendedor.nombre, vendedor.email, vendedor.documento):
            normalized = _normalizar_match(value)
            if normalized and normalized not in lookup:
                lookup[normalized] = vendedor
    return lookup


def _clientes_visibles_query(vendedor_scope):
    query = ClienteComercial.query
    if not _is_admin_user():
        if vendedor_scope is None:
            return query.filter(ClienteComercial.id == -1)
        query = query.filter(ClienteComercial.vendedor_id == vendedor_scope.id)
    return query


def _cliente_desde_registro(registro, clientes_lookup):
    for campo in ('Nombre del Acuerdo Comercial', 'Empresa en MisiÃÆÃÂ³n'):
        normalized = _normalizar_match(registro.get(campo))
        if not normalized or normalized in _VALORES_EMPRESA_GENERICOS:
            continue
        cliente = clientes_lookup.get(normalized)
        if cliente is not None:
            return cliente
    return None


def _vendedor_desde_registro(registro, vendedores_lookup):
    normalized = _normalizar_match(registro.get('Nombre del Vendedor'))
    if not normalized:
        return None
    return vendedores_lookup.get(normalized)


def _scope_descriptor(vendedor):
    if _is_admin_user():
        return 'admin'
    if vendedor is None:
        return 'sin_vendedor_asociado'
    return 'vendedor'


def _serialize_atencion_dia(registro):
    return {
        'id': registro.id,
        'cargue_id': registro.cargue_id,
        'cliente_id': registro.cliente_id,
        'cliente_nombre': registro.cliente.razon_social if registro.cliente else None,
        'vendedor_id': registro.vendedor_id,
        'vendedor_responsable': registro.vendedor.nombre if registro.vendedor else None,
        'nro_orden': registro.nro_orden,
        'nro_factura': registro.nro_factura,
        'fecha_factura': registro.fecha_factura.strftime('%Y-%m-%d') if registro.fecha_factura else None,
        'precio': float(registro.precio) if registro.precio is not None else 0,
        'forma_pago': registro.forma_pago,
        'servicio': registro.servicio,
        'nro_identificacion': registro.nro_identificacion,
        'nombre_paciente': registro.nombre_paciente,
        'acuerdo_comercial': registro.acuerdo_comercial,
        'empresa_mision': registro.empresa_mision,
        'sede': registro.sede,
        'nombre_vendedor': registro.nombre_vendedor,
        'fecha_creacion_orden': registro.fecha_creacion_orden.strftime('%Y-%m-%d %H:%M') if registro.fecha_creacion_orden else None,
        'usuario_creacion': registro.usuario_creacion,
        'estado_orden': registro.estado_orden,
        'fecha_anulacion': registro.fecha_anulacion.strftime('%Y-%m-%d') if registro.fecha_anulacion else None,
        'archivo_origen': registro.archivo_origen,
        'created_at': registro.created_at.strftime('%Y-%m-%d %H:%M:%S') if registro.created_at else None,
    }


@comercial_bp.route('/cargue-atenciones', methods=['POST'])
@login_required
def cargar_atenciones_dia():
    """Recibe un archivo Excel y carga las atenciones del dÃÆÃÂ­a."""
    try:
        _require_commercial_permission(PERMISO_CARGUE_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    if 'archivo' not in request.files:
        return jsonify({'error': 'No se enviÃÆÃÂ³ ningÃÆÃÂºn archivo'}), 400

    archivo = request.files['archivo']
    nombre = archivo.filename or 'sin_nombre.xlsx'
    if not nombre.lower().endswith('.xlsx'):
        return jsonify({'error': 'Solo se aceptan archivos .xlsx'}), 400

    try:
        contenido = archivo.read()
        filas = _leer_excel_atenciones(contenido, nombre)
        registros = _extraer_registros_excel(filas)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        logger.error('Error inesperado leyendo Excel de atenciones: %s', exc)
        return jsonify({'error': f'No se pudo leer el archivo: {exc}'}), 400

    clientes_lookup = _construir_lookup_clientes()
    vendedores_lookup = _construir_lookup_vendedores()
    existentes = set(
        db.session.query(
            AtencionDiaDetalle.nro_orden,
            AtencionDiaDetalle.servicio,
            AtencionDiaDetalle.nro_identificacion,
        ).all()
    )

    cargue = CargueAtencionDia(
        nombre_archivo=nombre,
        total_filas=len(registros),
        usuario_id=current_user.id,
    )
    db.session.add(cargue)
    db.session.flush()

    importadas = 0
    duplicadas = 0
    errores = 0
    relacionadas_cliente = 0
    relacionadas_vendedor = 0

    for registro in registros:
        try:
            nro_orden = _normalizar(registro.get('NÃâÃÂ°. Orden Servicio'))
            servicio = _normalizar(registro.get('Nombre del Producto o Servicio'))
            nro_identificacion = _normalizar(registro.get('NÃâÃÂ°. de IdentificaciÃÆÃÂ³n'))

            clave = (nro_orden, servicio, nro_identificacion)
            if clave in existentes:
                duplicadas += 1
                continue

            cliente = _cliente_desde_registro(registro, clientes_lookup)
            vendedor = cliente.vendedor if cliente and cliente.vendedor is not None else _vendedor_desde_registro(registro, vendedores_lookup)

            detalle = AtencionDiaDetalle(
                cargue_id=cargue.id,
                cliente_id=cliente.id if cliente else None,
                vendedor_id=vendedor.id if vendedor else None,
                nro_orden=nro_orden,
                nro_factura=_normalizar(registro.get('NÃâÃÂ°. Factura')),
                fecha_factura=_parse_fecha(registro.get('Fecha de Factura')),
                precio=_parse_precio(registro.get('Precio')),
                forma_pago=_normalizar(registro.get('FormaPago')),
                servicio=servicio,
                nro_identificacion=nro_identificacion,
                nombre_paciente=_normalizar(registro.get('Nombre del Paciente')),
                acuerdo_comercial=_normalizar(registro.get('Nombre del Acuerdo Comercial')),
                empresa_mision=_normalizar(registro.get('Empresa en MisiÃÆÃÂ³n')),
                sede=_normalizar(registro.get('Sede')),
                nombre_vendedor=_normalizar(registro.get('Nombre del Vendedor')),
                fecha_creacion_orden=_parse_fecha(registro.get('Fecha de CreaciÃÆÃÂ³n Orden Servicio')),
                usuario_creacion=_normalizar(registro.get('Usuario de CreaciÃÆÃÂ³n Orden Servicio')),
                estado_orden=_normalizar(registro.get('Estado de la Orden Servicio')),
                fecha_anulacion=_parse_fecha(registro.get('Fecha de AnulaciÃÆÃÂ³n Orden Servicio')),
                archivo_origen=nombre,
            )
            db.session.add(detalle)
            existentes.add(clave)
            importadas += 1
            if cliente is not None:
                relacionadas_cliente += 1
            if vendedor is not None:
                relacionadas_vendedor += 1
        except Exception as exc:
            logger.warning('Error procesando fila de atenciones: %s', exc)
            errores += 1

    cargue.filas_importadas = importadas
    cargue.filas_duplicadas = duplicadas
    cargue.filas_error = errores
    db.session.commit()

    logger.info(
        'Cargue atenciones: archivo=%s importadas=%d duplicadas=%d errores=%d relacionadas_cliente=%d relacionadas_vendedor=%d',
        nombre,
        importadas,
        duplicadas,
        errores,
        relacionadas_cliente,
        relacionadas_vendedor,
    )

    return jsonify({
        'mensaje': 'Cargue completado',
        'nombre_archivo': nombre,
        'total_filas': cargue.total_filas,
        'importadas': importadas,
        'duplicadas': duplicadas,
        'errores': errores,
        'relacionadas_cliente': relacionadas_cliente,
        'sin_cliente': max(importadas - relacionadas_cliente, 0),
        'relacionadas_vendedor': relacionadas_vendedor,
        'sin_vendedor': max(importadas - relacionadas_vendedor, 0),
    }), 201


@comercial_bp.route('/cargue-atenciones/historial', methods=['GET'])
@login_required
def historial_cargues_atenciones():
    """ÃÆÃÂ¡ltimos 20 cargues realizados."""
    try:
        _require_commercial_permission(PERMISO_CONSULTA_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    vendedor_scope = _resolver_vendedor_usuario_actual()
    scope = _scope_descriptor(vendedor_scope)

    if not _is_admin_user() and vendedor_scope is None:
        return jsonify({'scope': scope, 'registros': []}), 200

    if _is_admin_user():
        cargues = CargueAtencionDia.query.order_by(CargueAtencionDia.created_at.desc()).limit(20).all()
        registros = [{
            'id': cargue.id,
            'nombre_archivo': cargue.nombre_archivo,
            'total_filas': cargue.total_filas,
            'importadas': cargue.filas_importadas,
            'duplicadas': cargue.filas_duplicadas,
            'errores': cargue.filas_error,
            'usuario': cargue.usuario.usuario if cargue.usuario else 'Sistema',
            'fecha': cargue.created_at.strftime('%Y-%m-%d %H:%M') if cargue.created_at else None,
        } for cargue in cargues]
        return jsonify({'scope': scope, 'registros': registros}), 200

    cargues = (
        db.session.query(CargueAtencionDia)
        .join(AtencionDiaDetalle, AtencionDiaDetalle.cargue_id == CargueAtencionDia.id)
        .filter(AtencionDiaDetalle.vendedor_id == vendedor_scope.id)
        .order_by(CargueAtencionDia.created_at.desc())
        .distinct()
        .limit(20)
        .all()
    )

    registros = []
    for cargue in cargues:
        visibles = AtencionDiaDetalle.query.filter_by(cargue_id=cargue.id, vendedor_id=vendedor_scope.id).count()
        registros.append({
            'id': cargue.id,
            'nombre_archivo': cargue.nombre_archivo,
            'total_filas': visibles,
            'importadas': visibles,
            'duplicadas': None,
            'errores': None,
            'usuario': cargue.usuario.usuario if cargue.usuario else 'Sistema',
            'fecha': cargue.created_at.strftime('%Y-%m-%d %H:%M') if cargue.created_at else None,
        })

    return jsonify({'scope': scope, 'registros': registros}), 200


@comercial_bp.route('/cargue-atenciones/clientes-sugeridos', methods=['GET'])
@login_required
def clientes_sugeridos_atenciones():
    """Devuelve clientes visibles para autocompletar el filtro Cliente / Acuerdo."""
    try:
        _require_commercial_permission(PERMISO_CONSULTA_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    vendedor_scope = _resolver_vendedor_usuario_actual()
    scope = _scope_descriptor(vendedor_scope)
    if not _is_admin_user() and vendedor_scope is None:
        return jsonify({'scope': scope, 'clientes': []}), 200

    query_text = request.args.get('q', '').strip()
    if not query_text:
        return jsonify({'scope': scope, 'clientes': []}), 200

    query = _clientes_visibles_query(vendedor_scope)
    query = query.filter(
        or_(
            ClienteComercial.razon_social.ilike(f'%{query_text}%'),
            ClienteComercial.nombre_comercial.ilike(f'%{query_text}%'),
            ClienteComercial.nit.ilike(f'%{query_text}%'),
        )
    )

    clientes = query.order_by(
        ClienteComercial.activo.desc(),
        ClienteComercial.razon_social.asc(),
    ).limit(15).all()

    return jsonify({
        'scope': scope,
        'clientes': [
            {
                'id': cliente.id,
                'razon_social': cliente.razon_social,
                'nombre_comercial': cliente.nombre_comercial,
                'nit': cliente.nit,
                'vendedor_id': cliente.vendedor_id,
                'vendedor_nombre': cliente.vendedor.nombre if cliente.vendedor else None,
            }
            for cliente in clientes
        ],
    }), 200


@comercial_bp.route('/cargue-atenciones/consulta', methods=['GET'])
@login_required
def consultar_atenciones_dia():
    """Consulta de atenciones cargadas con alcance automÃÆÃÂ¡tico por vendedor."""
    try:
        _require_commercial_permission(PERMISO_CONSULTA_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    acuerdo = request.args.get('acuerdo', '').strip()
    vendedor = request.args.get('vendedor', '').strip()
    condicion_comercial = request.args.get('condicion_comercial', '').strip()
    estado = request.args.get('estado', '').strip()
    fecha_desde = request.args.get('fecha_desde', '').strip()
    fecha_hasta = request.args.get('fecha_hasta', '').strip()
    cargue_id = request.args.get('cargue_id', type=int)
    cliente_id = request.args.get('cliente_id', type=int)
    page = max(1, int(request.args.get('page', 1)))
    per_page = min(200, max(10, int(request.args.get('per_page', 50))))

    vendedor_scope = _resolver_vendedor_usuario_actual()
    scope = _scope_descriptor(vendedor_scope)
    if not _is_admin_user() and vendedor_scope is None:
        return jsonify({
            'scope': scope,
            'search_required': False,
            'total': 0,
            'page': page,
            'per_page': per_page,
            'pages': 0,
            'registros': [],
        }), 200

    has_filters = any([
        acuerdo,
        vendedor,
        condicion_comercial,
        estado,
        fecha_desde,
        fecha_hasta,
        cargue_id,
        cliente_id,
    ])
    if not has_filters:
        return jsonify({
            'scope': scope,
            'search_required': True,
            'vendedor_scope_id': vendedor_scope.id if vendedor_scope else None,
            'total': 0,
            'page': 1,
            'per_page': per_page,
            'pages': 0,
            'registros': [],
        }), 200

    query = AtencionDiaDetalle.query.outerjoin(AtencionDiaDetalle.cliente).outerjoin(AtencionDiaDetalle.vendedor)

    if not _is_admin_user():
        query = query.filter(AtencionDiaDetalle.vendedor_id == vendedor_scope.id)

    if acuerdo:
        query = query.filter(
            or_(
                AtencionDiaDetalle.acuerdo_comercial.ilike(f'%{acuerdo}%'),
                AtencionDiaDetalle.empresa_mision.ilike(f'%{acuerdo}%'),
                ClienteComercial.razon_social.ilike(f'%{acuerdo}%'),
                ClienteComercial.nombre_comercial.ilike(f'%{acuerdo}%'),
                ClienteComercial.nit.ilike(f'%{acuerdo}%'),
            )
        )
    if vendedor:
        query = query.filter(
            or_(
                AtencionDiaDetalle.nombre_vendedor.ilike(f'%{vendedor}%'),
                Vendedor.nombre.ilike(f'%{vendedor}%'),
            )
        )
    if condicion_comercial:
        query = query.filter(ClienteComercial.condicion_comercial == condicion_comercial.upper())
    if estado:
        query = query.filter(AtencionDiaDetalle.estado_orden == estado.upper())
    if cargue_id:
        query = query.filter(AtencionDiaDetalle.cargue_id == cargue_id)
    if cliente_id:
        query = query.filter(AtencionDiaDetalle.cliente_id == cliente_id)
    if fecha_desde:
        try:
            query = query.filter(AtencionDiaDetalle.fecha_creacion_orden >= datetime.strptime(fecha_desde, '%Y-%m-%d'))
        except ValueError:
            pass
    if fecha_hasta:
        try:
            fecha_fin = datetime.strptime(f'{fecha_hasta} 23:59:59', '%Y-%m-%d %H:%M:%S')
            query = query.filter(AtencionDiaDetalle.fecha_creacion_orden <= fecha_fin)
        except ValueError:
            pass

    total = query.count()
    orden_num_expr = cast(
        func.nullif(
            func.regexp_replace(
                func.coalesce(AtencionDiaDetalle.nro_orden, ''),
                r'[^0-9]',
                '',
                'g',
            ),
            '',
        ),
        BigInteger,
    )
    registros = (
        query.order_by(
            orden_num_expr.asc().nullslast(),
            AtencionDiaDetalle.nro_orden.asc().nullslast(),
            AtencionDiaDetalle.fecha_creacion_orden.asc().nullslast(),
            AtencionDiaDetalle.id.asc(),
        )
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return jsonify({
        'scope': scope,
        'search_required': False,
        'vendedor_scope_id': vendedor_scope.id if vendedor_scope else None,
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': (total + per_page - 1) // per_page,
        'registros': [_serialize_atencion_dia(registro) for registro in registros],
    }), 200



# ---------------------------------------------------------------------------
# PREFACTURAS
# ---------------------------------------------------------------------------

# Orden de clasificaciÃÂ³n para agrupar exÃÂ¡menes en la prefactura
_ORDEN_CLASIFICACION = ['CONSULTA', 'PARACLINICO', 'LABORATORIO', 'CURSOS', 'OTRO']

# Etiquetas legibles por clasificaciÃÂ³n
_LABEL_CLASIFICACION = {
    'CONSULTA': 'Consultas',
    'PARACLINICO': 'Paraclinicos',
    'LABORATORIO': 'Laboratorios',
    'CURSOS': 'Cursos',
    'OTRO': 'Otros',
}


def _construir_lookup_catalogo():
    """Devuelve dict nombre_upper -> dict con tipo_examen y nombre_corto."""
    items = ComercialCatalogoItem.query.all()
    lookup = {}
    for item in items:
        if item.nombre:
            lookup[item.nombre.upper().strip()] = {
                'tipo_examen': (item.tipo_examen or 'OTRO').upper(),
                'nombre_corto': (item.nombre_corto or '').strip() or None,
            }
    return lookup


def _clasificar_servicio(nombre_servicio, catalogo_lookup):
    """Retorna el tipo_examen del servicio segun el catalogo, o OTRO."""
    if not nombre_servicio:
        return 'OTRO'
    entrada = catalogo_lookup.get(nombre_servicio.upper().strip())
    if entrada is None:
        return 'OTRO'
    tipo = entrada['tipo_examen']
    if tipo in ('CONSULTA', 'PARACLINICO', 'LABORATORIO', 'CURSOS', 'ECOBABY'):
        return tipo
    return 'OTRO'


def _abreviar_servicio(nombre_servicio, tipo_examen, catalogo_lookup):
    """Aplica la regla de abreviacion segun la clasificacion:
    - Si el item tiene nombre_corto en el catalogo -> usar ese.
    - CONSULTA  -> nombre completo.
    - PARACLINICO / LABORATORIO -> primeras 5 letras (mayusculas).
    - CURSOS / OTRO -> nombre completo.
    """
    if not nombre_servicio:
        return ''
    entrada = catalogo_lookup.get(nombre_servicio.upper().strip())
    if entrada and entrada.get('nombre_corto'):
        return entrada['nombre_corto']
    if tipo_examen in ('PARACLINICO', 'LABORATORIO'):
        return nombre_servicio.strip()[:5].upper()
    return nombre_servicio.strip()

def _construir_examenes_str(regs_orden, catalogo_lookup):
    """Agrupa los servicios de una orden por clasificaciÃÂ³n y construye
    la cadena de exÃÂ¡menes con el formato:
      Consultas: <nombre completo> - <nombre completo> | ParaclÃÂ­nicos: <5let> - <5let> | ...
    """
    from collections import defaultdict
    grupos = defaultdict(list)
    for reg in regs_orden:
        if not reg.servicio:
            continue
        tipo = _clasificar_servicio(reg.servicio, catalogo_lookup)
        abrev = _abreviar_servicio(reg.servicio, tipo, catalogo_lookup)
        grupos[tipo].append(abrev)

    partes = []
    for clasificacion in _ORDEN_CLASIFICACION:
        items_grupo = grupos.get(clasificacion)
        if not items_grupo:
            continue
        label = _LABEL_CLASIFICACION.get(clasificacion, clasificacion.capitalize())
        # Ordenar alfabéticamente para que el mismo conjunto de exámenes
        # siempre produzca la misma cadena sin importar el orden de llegada
        items_ordenados = sorted(items_grupo)
        partes.append(f"{label}: {' - '.join(items_ordenados)}")

    return ' | '.join(partes) if partes else ''


def _normalizar_forma_pago(valor):
    """Normaliza forma_pago eliminando tildes para comparar con 'CREDITO'."""
    if not valor:
        return ''
    import unicodedata as _ud
    texto = _ud.normalize('NFKD', str(valor))
    texto = ''.join(ch for ch in texto if not _ud.combining(ch))
    return texto.upper().strip()


@comercial_bp.route('/prefacturas/generar', methods=['GET'])
@login_required
def generar_prefacturas():
    """Genera prefacturas en Excel por empresa para un rango de fechas.

    Reglas de negocio:
    - Solo ordenes con forma_pago == 'CREDITO' (normalizado sin tilde).
    - Excluir servicios cuyo tipo_examen en catalogo sea 'ECOBABY'.
    - Agrupar por empresa -> paciente -> nro_orden.
    - Dentro de cada orden, agrupar examenes por clasificacion y abreviar
      segun tipo: CONSULTA=nombre completo, PARACLINICO/LABORATORIO=5 letras.
    - Un archivo Excel por empresa, nombre: <RazonSocial>-<periodo>.xlsx
    - Todos los archivos se guardan en la carpeta indicada por el parametro
      'carpeta' y ademas se devuelven en un ZIP de descarga.
    """
    try:
        _require_commercial_permission(PERMISO_CONSULTA_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    fecha_desde_str = request.args.get('fecha_desde', '').strip()
    fecha_hasta_str = request.args.get('fecha_hasta', '').strip()

    if not fecha_desde_str or not fecha_hasta_str:
        return jsonify({'error': 'Se requieren fecha_desde y fecha_hasta (YYYY-MM-DD)'}), 400

    try:
        fecha_desde = datetime.strptime(fecha_desde_str, '%Y-%m-%d')
        fecha_hasta = datetime.strptime(f'{fecha_hasta_str} 23:59:59', '%Y-%m-%d %H:%M:%S')
    except ValueError:
        return jsonify({'error': 'Formato de fecha invalido. Use YYYY-MM-DD'}), 400

    vendedor_scope = _resolver_vendedor_usuario_actual()
    if not _is_admin_user() and vendedor_scope is None:
        return jsonify({'error': 'No tienes un vendedor asociado para generar prefacturas'}), 403

    # -----------------------------------------------------------------------
    # Consulta base: credito (normalizado), sin ECOBABY, en el rango de fechas
    # -----------------------------------------------------------------------
    # Traer todos los registros del rango y filtrar forma_pago en Python
    # para manejar variantes con/sin tilde ('CRÃâ°DITO', 'CREDITO', 'CrÃÂ©dito')
    query = (
        AtencionDiaDetalle.query
        .outerjoin(AtencionDiaDetalle.cliente)
        .filter(
            AtencionDiaDetalle.fecha_creacion_orden >= fecha_desde,
            AtencionDiaDetalle.fecha_creacion_orden <= fecha_hasta,
        )
    )

    if not _is_admin_user():
        query = query.filter(AtencionDiaDetalle.vendedor_id == vendedor_scope.id)

    todos = query.order_by(
        AtencionDiaDetalle.cliente_id.asc().nullslast(),
        AtencionDiaDetalle.acuerdo_comercial.asc().nullslast(),
        AtencionDiaDetalle.fecha_creacion_orden.asc().nullslast(),
        AtencionDiaDetalle.nro_identificacion.asc().nullslast(),
        AtencionDiaDetalle.nro_orden.asc().nullslast(),
    ).all()

    # Construir lookup del catalogo para clasificar servicios
    catalogo_lookup = _construir_lookup_catalogo()

    # Filtrar: solo CREDITO, no ANULADA, no ECOBABY
    registros = []
    for reg in todos:
        forma_norm = _normalizar_forma_pago(reg.forma_pago)
        if forma_norm != 'CREDITO':
            continue
        estado_norm = (reg.estado_orden or '').upper().strip()
        if estado_norm == 'ANULADA':
            continue
        tipo_servicio = _clasificar_servicio(reg.servicio, catalogo_lookup)
        if tipo_servicio == 'ECOBABY':
            continue
        # Tambien excluir por nombre si contiene ECOBABY (por si no esta en catalogo)
        if reg.servicio and 'ECOBABY' in reg.servicio.upper():
            continue
        registros.append(reg)

    if not registros:
        return jsonify({'error': 'No se encontraron atenciones a credito en el rango de fechas indicado'}), 404

    # -----------------------------------------------------------------------
    # Agrupar por empresa
    # -----------------------------------------------------------------------
    def _nombre_empresa(reg):
        if reg.cliente:
            return reg.cliente.razon_social or reg.acuerdo_comercial or 'SIN_EMPRESA'
        return reg.acuerdo_comercial or reg.empresa_mision or 'SIN_EMPRESA'

    empresas: dict = defaultdict(list)
    for reg in registros:
        empresas[_nombre_empresa(reg)].append(reg)

    periodo = f"{fecha_desde.strftime('%d%m%Y')}-{fecha_hasta.strftime('%d%m%Y')}"
    periodo_label = f"{fecha_desde.strftime('%d/%m/%Y')} al {fecha_hasta.strftime('%d/%m/%Y')}"

    # -----------------------------------------------------------------------
    # Construir Excel por empresa (2 hojas: relacion-pacientes y prefactura)
    # -----------------------------------------------------------------------
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    archivos: list = []  # (nombre_archivo, contenido_bytes)

    for nombre_empresa, filas in sorted(empresas.items()):
        wb = openpyxl.Workbook()

        # ---- Estilos compartidos ----
        font_titulo        = Font(name='Calibri', bold=True, size=14, color='FFFFFFFF')
        font_subtitulo     = Font(name='Calibri', bold=True, size=11, color='FFFFFFFF')
        font_header        = Font(name='Calibri', bold=True, size=10, color='FFFFFFFF')
        font_normal        = Font(name='Calibri', size=10)
        font_subtotal      = Font(name='Calibri', bold=True, size=10, color='FF1F4E79')
        font_total_empresa = Font(name='Calibri', bold=True, size=11, color='FF1F4E79')

        fill_titulo   = PatternFill('solid', fgColor='FF1F4E79')
        fill_azul     = PatternFill('solid', fgColor='FF2E75B6')
        fill_subtotal = PatternFill('solid', fgColor='FFDAE3F3')
        fill_total    = PatternFill('solid', fgColor='FFBDD7EE')

        thin        = Side(style='thin', color='FF9DC3E6')
        border_thin = Border(left=thin, right=thin, top=thin, bottom=thin)
        center   = Alignment(horizontal='center', vertical='center', wrap_text=True)
        left_al  = Alignment(horizontal='left',   vertical='center', wrap_text=True)
        right_al = Alignment(horizontal='right',  vertical='center')

        # -----------------------------------------------------------------------
        # Preparar datos: agrupar por orden -> (valor, examenes_str, fecha, id, nombre)
        # -----------------------------------------------------------------------
        ordenes_map: dict = defaultdict(list)
        for reg in filas:
            key_ord = (reg.nro_identificacion or '', reg.nro_orden or f'_sin_{reg.id}')
            ordenes_map[key_ord].append(reg)

        filas_detalle = []
        for (nro_id, _nro_ord), regs_orden in ordenes_map.items():
            fechas       = [r.fecha_creacion_orden for r in regs_orden if r.fecha_creacion_orden]
            fecha_str    = min(fechas).strftime('%d/%m/%Y') if fechas else ''
            examenes_str = _construir_examenes_str(regs_orden, catalogo_lookup)
            valor        = sum(float(r.precio) for r in regs_orden if r.precio is not None)
            nombre_pac   = (regs_orden[0].nombre_paciente or '').strip()
            filas_detalle.append((valor, examenes_str, fecha_str, nro_id, nombre_pac))

        # Ordenar: valor asc -> examenes asc -> fecha asc
        filas_detalle.sort(key=lambda x: (x[0], x[1], x[2]))

        # Calcular grupos para la hoja prefactura
        # grupo: (valor_grupo, examenes_grupo, lista_de_filas)
        grupos = []
        i = 0
        while i < len(filas_detalle):
            valor_grupo    = filas_detalle[i][0]
            examenes_grupo = filas_detalle[i][1]
            grupo_filas    = []
            while (i < len(filas_detalle)
                   and filas_detalle[i][0] == valor_grupo
                   and filas_detalle[i][1] == examenes_grupo):
                grupo_filas.append(filas_detalle[i])
                i += 1
            grupos.append((valor_grupo, examenes_grupo, grupo_filas))

        total_empresa = sum(vg * len(gf) for vg, _, gf in grupos)

        # -----------------------------------------------------------------------
        # Hoja 1: relacion-pacientes  (detalle sin subtotales)
        # -----------------------------------------------------------------------
        ws_rel = wb.active
        ws_rel.title = 'relacion-pacientes'

        def _escribir_cabecera(ws, titulo, subtitulo, headers_list, n_cols):
            col_letra = chr(ord('A') + n_cols - 1)
            rango = f'A1:{col_letra}1'
            ws.merge_cells(rango)
            c = ws['A1']
            c.value = titulo; c.font = font_titulo
            c.fill = fill_titulo; c.alignment = center
            ws.row_dimensions[1].height = 28

            ws.merge_cells(f'A2:{col_letra}2')
            c = ws['A2']
            c.value = subtitulo; c.font = font_subtitulo
            c.fill = fill_azul; c.alignment = center
            ws.row_dimensions[2].height = 20

            for ci, h in enumerate(headers_list, start=1):
                c = ws.cell(row=3, column=ci, value=h)
                c.font = font_header; c.fill = fill_azul
                c.alignment = center; c.border = border_thin
            ws.row_dimensions[3].height = 18

        _escribir_cabecera(
            ws_rel,
            nombre_empresa.upper(),
            f'RELACION DE PACIENTES  |  Periodo: {periodo_label}',
            ['Fecha Atencion', 'ID Paciente', 'Paciente', 'Examenes', 'Valor'],
            5,
        )

        fila_rel = 4
        for (valor, examenes_str, fecha_str, nro_id, nombre_pac) in filas_detalle:
            valores = [fecha_str, nro_id, nombre_pac, examenes_str, valor]
            for ci, v in enumerate(valores, start=1):
                c = ws_rel.cell(row=fila_rel, column=ci, value=v)
                c.font = font_normal; c.border = border_thin
                if ci in (1, 2):
                    c.alignment = center
                elif ci == 5:
                    c.alignment = right_al; c.number_format = '#,##0.00'
                else:
                    c.alignment = left_al
            fila_rel += 1

        # Total relacion-pacientes
        ws_rel.merge_cells(f'A{fila_rel}:D{fila_rel}')
        c = ws_rel.cell(row=fila_rel, column=1, value='TOTAL')
        c.font = font_total_empresa; c.fill = fill_total
        c.alignment = right_al; c.border = border_thin
        c2 = ws_rel.cell(row=fila_rel, column=5, value=total_empresa)
        c2.font = font_total_empresa; c2.fill = fill_total
        c2.alignment = right_al; c2.number_format = '#,##0.00'; c2.border = border_thin

        ws_rel.column_dimensions['A'].width = 16
        ws_rel.column_dimensions['B'].width = 16
        ws_rel.column_dimensions['C'].width = 32
        ws_rel.column_dimensions['D'].width = 70
        ws_rel.column_dimensions['E'].width = 16

        # -----------------------------------------------------------------------
        # Hoja 2: prefactura  (solo subtotales por grupo)
        # Columnas: Examenes | Cant. Pacientes | Valor Unit. | Total
        # -----------------------------------------------------------------------
        ws_pf = wb.create_sheet(title='prefactura')

        _escribir_cabecera(
            ws_pf,
            nombre_empresa.upper(),
            f'PREFACTURA  |  Periodo: {periodo_label}',
            ['Examenes', 'Cant. Pacientes', 'Valor Unit.', 'Total'],
            4,
        )

        fila_pf = 4
        for (valor_grupo, examenes_grupo, grupo_filas) in grupos:
            cant          = len(grupo_filas)
            subtotal_grup = valor_grupo * cant

            valores_pf = [examenes_grupo, cant, valor_grupo, subtotal_grup]
            for ci, v in enumerate(valores_pf, start=1):
                c = ws_pf.cell(row=fila_pf, column=ci, value=v)
                c.font = font_normal; c.border = border_thin
                if ci == 1:
                    c.alignment = left_al
                elif ci == 2:
                    c.alignment = center
                else:
                    c.alignment = right_al; c.number_format = '#,##0.00'
            fila_pf += 1

        # Total prefactura
        ws_pf.merge_cells(f'A{fila_pf}:C{fila_pf}')
        c = ws_pf.cell(row=fila_pf, column=1, value='TOTAL')
        c.font = font_total_empresa; c.fill = fill_total
        c.alignment = right_al; c.border = border_thin
        c2 = ws_pf.cell(row=fila_pf, column=4, value=total_empresa)
        c2.font = font_total_empresa; c2.fill = fill_total
        c2.alignment = right_al; c2.number_format = '#,##0.00'; c2.border = border_thin

        ws_pf.column_dimensions['A'].width = 70
        ws_pf.column_dimensions['B'].width = 18
        ws_pf.column_dimensions['C'].width = 16
        ws_pf.column_dimensions['D'].width = 16

        # -----------------------------------------------------------------------
        # Guardar workbook
        # -----------------------------------------------------------------------
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        nombre_safe  = re.sub(r'[^\w\s\-]', '', nombre_empresa).strip()
        nombre_safe  = re.sub(r'\s+', '_', nombre_safe)
        nombre_archivo = f'{nombre_safe}-{periodo}.xlsx'
        archivos.append((nombre_archivo, buf.read()))

    # -----------------------------------------------------------------------
    # Generar resumen_<periodo>.xlsx
    # -----------------------------------------------------------------------
    import openpyxl as _openpyxl
    from openpyxl.styles import (
        Font as _Font, PatternFill as _Fill,
        Alignment as _Align, Border as _Border, Side as _Side,
    )

    wb_res = _openpyxl.Workbook()
    ws_res = wb_res.active
    ws_res.title = 'Resumen'

    _thin   = _Side(style='thin', color='FF9DC3E6')
    _border = _Border(left=_thin, right=_thin, top=_thin, bottom=_thin)
    _center = _Align(horizontal='center', vertical='center', wrap_text=True)
    _left   = _Align(horizontal='left',   vertical='center', wrap_text=True)
    _right  = _Align(horizontal='right',  vertical='center')

    # Fila 1: titulo
    ws_res.merge_cells('A1:F1')
    c = ws_res['A1']
    c.value     = f'RESUMEN PREFACTURAS  |  Periodo: {periodo_label}'
    c.font      = _Font(name='Calibri', bold=True, size=13, color='FFFFFFFF')
    c.fill      = _Fill('solid', fgColor='FF1F4E79')
    c.alignment = _center
    ws_res.row_dimensions[1].height = 26

    # Fila 2: encabezados
    # Columnas: Empresa | Cantidad de Pacientes | Valor Total | Fecha Factura | Nro Factura | Valor Factura
    _encabezados = [
        'Empresa', 'Cantidad de Pacientes', 'Valor Total',
        'Fecha Factura', 'Nro Factura', 'Valor Factura',
    ]
    for _ci, _enc in enumerate(_encabezados, start=1):
        _c = ws_res.cell(row=2, column=_ci, value=_enc)
        _c.font      = _Font(name='Calibri', bold=True, size=10, color='FFFFFFFF')
        _c.fill      = _Fill('solid', fgColor='FF2E75B6')
        _c.alignment = _center
        _c.border    = _border
    ws_res.row_dimensions[2].height = 18

    _font_data  = _Font(name='Calibri', size=10)
    _font_total = _Font(name='Calibri', bold=True, size=10, color='FF1F4E79')
    _fill_total = _Fill('solid', fgColor='FFBDD7EE')

    _gran_pac = 0
    _gran_val = 0.0
    _fila_res = 3

    # Ordenar empresas por nombre (A-Z)
    for _emp, _filas_emp in sorted(empresas.items(), key=lambda x: x[0].upper()):
        _pacs = len({
            (r.nro_identificacion or '', r.nombre_paciente or '')
            for r in _filas_emp
        })
        _val_emp = sum(float(r.precio) for r in _filas_emp if r.precio is not None)
        _gran_pac += _pacs
        _gran_val += _val_emp

        # 6 columnas: Empresa, Cant. Pacientes, Valor Total, Fecha Factura (vacío), Nro Factura (vacío), Valor Factura (vacío)
        _row = [_emp, _pacs, _val_emp, '', '', '']
        for _ci, _v in enumerate(_row, start=1):
            _c = ws_res.cell(row=_fila_res, column=_ci, value=_v)
            _c.font   = _font_data
            _c.border = _border
            if _ci == 1:
                _c.alignment = _left
            elif _ci == 2:
                _c.alignment = _center
            elif _ci == 3:
                _c.alignment = _right
                _c.number_format = '#,##0.00'
            else:
                _c.alignment = _center
        _fila_res += 1

    # Fila de totales
    _ct = ws_res.cell(row=_fila_res, column=1, value='TOTAL')
    _ct.font = _font_total; _ct.fill = _fill_total
    _ct.alignment = _right; _ct.border = _border

    _cp = ws_res.cell(row=_fila_res, column=2, value=_gran_pac)
    _cp.font = _font_total; _cp.fill = _fill_total
    _cp.alignment = _center; _cp.border = _border

    _cv = ws_res.cell(row=_fila_res, column=3, value=_gran_val)
    _cv.font = _font_total; _cv.fill = _fill_total
    _cv.alignment = _right; _cv.number_format = '#,##0.00'; _cv.border = _border

    for _ci in (4, 5, 6):
        _c = ws_res.cell(row=_fila_res, column=_ci, value='')
        _c.fill = _fill_total; _c.border = _border

    ws_res.column_dimensions['A'].width = 45
    ws_res.column_dimensions['B'].width = 22
    ws_res.column_dimensions['C'].width = 18
    ws_res.column_dimensions['D'].width = 16
    ws_res.column_dimensions['E'].width = 18
    ws_res.column_dimensions['F'].width = 16

    _buf_res = io.BytesIO()
    wb_res.save(_buf_res)
    _buf_res.seek(0)
    archivos.append(('resumen_periodo.xlsx', _buf_res.read()))

    # -----------------------------------------------------------------------
    # Guardar en carpeta del servidor si se especifico
    # -----------------------------------------------------------------------
    carpeta_destino = request.args.get('carpeta', '').strip()
    if carpeta_destino:
        try:
            os.makedirs(carpeta_destino, exist_ok=True)
            for nombre_archivo, contenido in archivos:
                ruta_completa = os.path.join(carpeta_destino, nombre_archivo)
                with open(ruta_completa, 'wb') as f_out:
                    f_out.write(contenido)
            logger.info('Prefacturas guardadas en carpeta: %s (%d archivos)', carpeta_destino, len(archivos))
        except Exception as exc:
            logger.warning('No se pudo guardar en carpeta %s: %s', carpeta_destino, exc)

    # -----------------------------------------------------------------------
    # Respuesta: ZIP con todos los archivos
    # -----------------------------------------------------------------------
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for nombre_archivo, contenido in archivos:
            zf.writestr(nombre_archivo, contenido)
    zip_buf.seek(0)

    nombre_zip = f'Prefacturas-{periodo}.zip'
    return send_file(
        zip_buf,
        mimetype='application/zip',
        as_attachment=True,
        download_name=nombre_zip,
    )
