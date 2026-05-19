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
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.models import (
    AtencionDiaDetalle,
    CarteraPrefactura,
    CargueAtencionDia,
    ClienteComercial,
    ComercialCatalogoItem,
    PrefacturaComercial,
    Vendedor,
    db,
)
from app.routes import comercial_bp
from app.security import get_permission_names_for_user

logger = logging.getLogger(__name__)


def _mensaje_error_estado_gestion_atenciones(exc: Exception) -> str | None:
    detalle = f'{exc} {getattr(exc, "orig", "")}'.lower()
    if 'estado_gestion' not in detalle:
        return None
    return (
        'La base de datos aun no tiene el nuevo campo "estado_gestion" de Atenciones. '
        'Aplica la migracion pendiente con "flask db upgrade".'
    )

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
PERMISO_EDICION_ATENCIONES = 'comercial_atenciones_update'
PERMISO_ELIMINACION_ATENCIONES = 'comercial_atenciones_delete'
NOMBRE_CARGUE_MANUAL = 'REGISTRO_MANUAL_ATENCIONES'
ESTADOS_GESTION_ATENCION = {'CARGADA', 'CON_FACTURA', 'TERMINADA', 'ANULADA'}

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


def _asegurar_acceso_registro_atencion(registro, vendedor_scope):
    if _is_admin_user():
        return
    if vendedor_scope is None or registro.vendedor_id != vendedor_scope.id:
        raise PermissionError('No tienes permiso para acceder a esta atencion comercial')


def _construir_lookup_clientes_visibles(vendedor_scope):
    lookup = {}
    clientes = _clientes_visibles_query(vendedor_scope).all()
    for cliente in clientes:
        for value in (cliente.razon_social, cliente.nombre_comercial, cliente.nit):
            normalized = _normalizar_match(value)
            if normalized and normalized not in lookup:
                lookup[normalized] = cliente
    return lookup


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
        'estado_gestion': registro.estado_gestion,
        'es_editable': (registro.estado_gestion or '').upper() == 'CARGADA',
        'fecha_anulacion': registro.fecha_anulacion.strftime('%Y-%m-%d') if registro.fecha_anulacion else None,
        'archivo_origen': registro.archivo_origen,
        'created_at': registro.created_at.strftime('%Y-%m-%d %H:%M:%S') if registro.created_at else None,
    }


def _parse_fecha_iso(valor, field_name):
    texto = _normalizar(valor)
    if not texto:
        return None
    try:
        return datetime.strptime(texto, '%Y-%m-%d')
    except ValueError as exc:
        raise ValueError(f'Formato de {field_name} invalido (YYYY-MM-DD)') from exc


def _validar_periodo_cargue(desde, hasta):
    if bool(desde) != bool(hasta):
        raise ValueError('Debes registrar tanto la fecha inicial como la fecha final del periodo')
    if desde and hasta and hasta < desde:
        raise ValueError('La fecha final del periodo no puede ser anterior a la fecha inicial')


def _formatear_periodo_cargue(desde, hasta):
    if not desde or not hasta:
        return None
    return f'{desde.strftime("%Y-%m-%d")} a {hasta.strftime("%Y-%m-%d")}'


def _serializar_periodo_cargue(desde, hasta, *, source='CARGUE'):
    if not desde or not hasta:
        return None
    return {
        'fecha_desde': desde.strftime('%Y-%m-%d'),
        'fecha_hasta': hasta.strftime('%Y-%m-%d'),
        'label': _formatear_periodo_cargue(desde, hasta),
        'source': source,
        'key': f'{desde.strftime("%Y-%m-%d")}|{hasta.strftime("%Y-%m-%d")}|{source}',
    }


def _parse_int_optional(valor, field_name):
    if valor in (None, ''):
        return None
    try:
        return int(valor)
    except (TypeError, ValueError) as exc:
        raise ValueError(f'El campo {field_name} debe ser numerico') from exc


def _resolver_cliente_desde_payload(data, vendedor_scope):
    cliente_id = _parse_int_optional(data.get('cliente_id'), 'cliente_id')
    if cliente_id is not None:
        cliente = _clientes_visibles_query(vendedor_scope).filter(ClienteComercial.id == cliente_id).first()
        if cliente is None:
            raise ValueError('El cliente seleccionado no esta disponible para tu perfil')
        return cliente

    clientes_lookup = _construir_lookup_clientes_visibles(vendedor_scope)
    for campo in ('acuerdo_comercial', 'empresa_mision'):
        normalized = _normalizar_match(data.get(campo))
        if not normalized or normalized in _VALORES_EMPRESA_GENERICOS:
            continue
        cliente = clientes_lookup.get(normalized)
        if cliente is not None:
            return cliente
    return None


def _resolver_vendedor_desde_payload(data, vendedor_scope, cliente):
    if not _is_admin_user():
        if vendedor_scope is None:
            raise PermissionError('No tienes un vendedor asociado para registrar atenciones')
        return vendedor_scope

    vendedor_id = _parse_int_optional(data.get('vendedor_id'), 'vendedor_id')
    if vendedor_id is not None:
        vendedor = Vendedor.query.get(vendedor_id)
        if vendedor is None:
            raise ValueError('El vendedor seleccionado no existe')
        return vendedor

    nombre_vendedor = _normalizar(data.get('nombre_vendedor'))
    if nombre_vendedor:
        vendedor = _construir_lookup_vendedores().get(_normalizar_match(nombre_vendedor))
        if vendedor is not None:
            return vendedor

    if cliente is not None and cliente.vendedor is not None:
        return cliente.vendedor
    return None


def _build_atencion_dia_payload(data, vendedor_scope):
    fecha_creacion_orden = _parse_fecha_iso(data.get('fecha_creacion_orden'), 'fecha_creacion_orden') or datetime.utcnow()
    fecha_factura = _parse_fecha_iso(data.get('fecha_factura'), 'fecha_factura')
    precio = _parse_precio(data.get('precio'))
    if precio is None:
        raise ValueError('El precio es obligatorio')
    if precio < 0:
        raise ValueError('El precio no puede ser negativo')

    nro_identificacion = _normalizar(data.get('nro_identificacion'))
    nombre_paciente = _normalizar(data.get('nombre_paciente'))
    servicio = _normalizar(data.get('servicio'))
    if not nro_identificacion:
        raise ValueError('El numero de identificacion es obligatorio')
    if not nombre_paciente:
        raise ValueError('El nombre del paciente es obligatorio')
    if not servicio:
        raise ValueError('El servicio es obligatorio')

    cliente = _resolver_cliente_desde_payload(data, vendedor_scope)
    vendedor = _resolver_vendedor_desde_payload(data, vendedor_scope, cliente)
    estado_orden = (_normalizar(data.get('estado_orden')) or 'PROCESADA').upper()
    forma_pago = (_normalizar(data.get('forma_pago')) or None)
    if forma_pago:
        forma_pago = forma_pago.upper()

    acuerdo_comercial = _normalizar(data.get('acuerdo_comercial'))
    empresa_mision = _normalizar(data.get('empresa_mision'))
    nombre_vendedor = _normalizar(data.get('nombre_vendedor'))
    if vendedor is not None and not nombre_vendedor:
        nombre_vendedor = vendedor.nombre

    fecha_anulacion = None
    if estado_orden == 'ANULADA':
        fecha_anulacion = _parse_fecha_iso(data.get('fecha_anulacion'), 'fecha_anulacion') or fecha_creacion_orden

    return {
        'cliente_id': cliente.id if cliente is not None else None,
        'vendedor_id': vendedor.id if vendedor is not None else None,
        'nro_orden': _normalizar(data.get('nro_orden')),
        'nro_factura': _normalizar(data.get('nro_factura')),
        'fecha_factura': fecha_factura,
        'precio': precio,
        'forma_pago': forma_pago,
        'servicio': servicio,
        'nro_identificacion': nro_identificacion,
        'nombre_paciente': nombre_paciente,
        'acuerdo_comercial': acuerdo_comercial,
        'empresa_mision': empresa_mision,
        'sede': _normalizar(data.get('sede')),
        'nombre_vendedor': nombre_vendedor,
        'fecha_creacion_orden': fecha_creacion_orden,
        'usuario_creacion': _normalizar(data.get('usuario_creacion')) or getattr(current_user, 'usuario', None),
        'estado_orden': estado_orden,
        'estado_gestion': 'CARGADA',
        'fecha_anulacion': fecha_anulacion,
        'archivo_origen': _normalizar(data.get('archivo_origen')) or NOMBRE_CARGUE_MANUAL,
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
        periodo_desde = _parse_fecha_iso(request.form.get('periodo_desde'), 'periodo_desde')
        periodo_hasta = _parse_fecha_iso(request.form.get('periodo_hasta'), 'periodo_hasta')
        _validar_periodo_cargue(periodo_desde, periodo_hasta)
        if not periodo_desde or not periodo_hasta:
            return jsonify({'error': 'Debes indicar el periodo inicial del cargue (fecha desde y fecha hasta)'}), 400
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

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
        periodo_desde=periodo_desde,
        periodo_hasta=periodo_hasta,
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
                estado_gestion='CARGADA',
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
        'periodo': _serializar_periodo_cargue(cargue.periodo_desde, cargue.periodo_hasta),
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
            'periodo': _formatear_periodo_cargue(cargue.periodo_desde, cargue.periodo_hasta),
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
            'periodo': _formatear_periodo_cargue(cargue.periodo_desde, cargue.periodo_hasta),
        })

    return jsonify({'scope': scope, 'registros': registros}), 200


@comercial_bp.route('/cargue-atenciones/periodos', methods=['GET'])
@login_required
def listar_periodos_cargue_atenciones():
    try:
        _require_commercial_permission(PERMISO_CONSULTA_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    vendedor_scope = _resolver_vendedor_usuario_actual()
    scope = _scope_descriptor(vendedor_scope)
    if not _is_admin_user() and vendedor_scope is None:
        return jsonify({'scope': scope, 'periodos': []}), 200

    periodos = []
    vistos = set()

    query_cargues = CargueAtencionDia.query.filter(
        CargueAtencionDia.periodo_desde.isnot(None),
        CargueAtencionDia.periodo_hasta.isnot(None),
    )
    if not _is_admin_user():
        query_cargues = (
            query_cargues
            .join(AtencionDiaDetalle, AtencionDiaDetalle.cargue_id == CargueAtencionDia.id)
            .filter(AtencionDiaDetalle.vendedor_id == vendedor_scope.id)
        )

    for cargue in query_cargues.order_by(CargueAtencionDia.periodo_desde.desc(), CargueAtencionDia.periodo_hasta.desc()).all():
        periodo = _serializar_periodo_cargue(cargue.periodo_desde, cargue.periodo_hasta, source='CARGUE')
        if not periodo:
            continue
        key = (periodo['fecha_desde'], periodo['fecha_hasta'])
        if key in vistos:
            continue
        vistos.add(key)
        periodos.append(periodo)

    query_prefacturas = PrefacturaComercial.query.filter(
        PrefacturaComercial.fecha_desde.isnot(None),
        PrefacturaComercial.fecha_hasta.isnot(None),
    )
    if not _is_admin_user():
        cliente_ids = [c.id for c in ClienteComercial.query.filter_by(vendedor_id=vendedor_scope.id).all()]
        if not cliente_ids:
            return jsonify({'scope': scope, 'periodos': periodos}), 200
        query_prefacturas = query_prefacturas.filter(PrefacturaComercial.cliente_id.in_(cliente_ids))

    for pref in query_prefacturas.order_by(PrefacturaComercial.fecha_desde.desc(), PrefacturaComercial.fecha_hasta.desc()).all():
        periodo = _serializar_periodo_cargue(pref.fecha_desde, pref.fecha_hasta, source='PREFACTURA')
        if not periodo:
            continue
        key = (periodo['fecha_desde'], periodo['fecha_hasta'])
        if key in vistos:
            continue
        vistos.add(key)
        periodos.append(periodo)

    periodos.sort(key=lambda item: (item['fecha_desde'], item['fecha_hasta']), reverse=True)
    return jsonify({'scope': scope, 'periodos': periodos}), 200


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
        query = query.filter(AtencionDiaDetalle.estado_gestion == estado.upper())
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

    try:
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
    except (ProgrammingError, OperationalError) as exc:
        db.session.rollback()
        mensaje_estado = _mensaje_error_estado_gestion_atenciones(exc)
        logger.exception('Error consultando atenciones dia')
        return jsonify({'error': mensaje_estado or 'No se pudo consultar la informacion cargada'}), 500

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
# GET /api/comercial/atenciones-dia/<id>  — detalle de un registro
# ---------------------------------------------------------------------------
@comercial_bp.route('/atenciones-dia/<int:reg_id>', methods=['GET'])
@login_required
def obtener_atencion_dia(reg_id):
    try:
        _require_commercial_permission(PERMISO_CONSULTA_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    vendedor_scope = _resolver_vendedor_usuario_actual()
    if not _is_admin_user() and vendedor_scope is None:
        return jsonify({'error': 'No tienes un vendedor asociado'}), 403

    try:
        reg = AtencionDiaDetalle.query.get_or_404(reg_id)
    except (ProgrammingError, OperationalError) as exc:
        db.session.rollback()
        mensaje_estado = _mensaje_error_estado_gestion_atenciones(exc)
        logger.exception('Error obteniendo detalle de atencion dia %s', reg_id)
        return jsonify({'error': mensaje_estado or 'No se pudo consultar la atencion'}), 500

    try:
        _asegurar_acceso_registro_atencion(reg, vendedor_scope)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    return jsonify({'registro': _serialize_atencion_dia(reg)}), 200


# ---------------------------------------------------------------------------
# POST /api/comercial/atenciones-dia  — crear registro manual
# ---------------------------------------------------------------------------
@comercial_bp.route('/atenciones-dia', methods=['POST'])
@login_required
def crear_atencion_dia_manual():
    try:
        _require_commercial_permission(PERMISO_CARGUE_ATENCIONES)
        vendedor_scope = _resolver_vendedor_usuario_actual()
        if not _is_admin_user() and vendedor_scope is None:
            return jsonify({'error': 'No tienes un vendedor asociado'}), 403

        data = request.get_json() or {}
        payload = _build_atencion_dia_payload(data, vendedor_scope)
        payload['estado_gestion'] = 'CARGADA'

        cargue = CargueAtencionDia(
            nombre_archivo=NOMBRE_CARGUE_MANUAL,
            total_filas=1,
            filas_importadas=1,
            filas_duplicadas=0,
            filas_error=0,
            usuario_id=getattr(current_user, 'id', None),
        )
        db.session.add(cargue)
        db.session.flush()

        registro = AtencionDiaDetalle(
            cargue_id=cargue.id,
            **payload,
        )
        db.session.add(registro)
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 403
    except Exception as exc:
        db.session.rollback()
        logger.error('Error creando atencion manual: %s', exc)
        return jsonify({'error': 'No se pudo crear la atencion'}), 500

    return jsonify({'mensaje': 'Atencion creada', 'registro': _serialize_atencion_dia(registro)}), 201


@comercial_bp.route('/atenciones-dia/<int:reg_id>', methods=['PUT'])
@login_required
def editar_atencion_dia(reg_id):
    try:
        _require_commercial_permission(PERMISO_EDICION_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    vendedor_scope = _resolver_vendedor_usuario_actual()
    if not _is_admin_user() and vendedor_scope is None:
        return jsonify({'error': 'No tienes un vendedor asociado'}), 403

    reg = AtencionDiaDetalle.query.get_or_404(reg_id)
    try:
        _asegurar_acceso_registro_atencion(reg, vendedor_scope)
        if (reg.estado_gestion or '').upper() != 'CARGADA':
            return jsonify({'error': 'Solo se pueden editar atenciones en estado CARGADA'}), 409
        data = request.get_json() or {}
        payload = _build_atencion_dia_payload(data, vendedor_scope)
        payload['archivo_origen'] = reg.archivo_origen or payload.get('archivo_origen')
        payload['estado_gestion'] = reg.estado_gestion or 'CARGADA'
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    for campo, valor in payload.items():
        setattr(reg, campo, valor)

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.error('Error editando atencion dia %s: %s', reg_id, exc)
        return jsonify({'error': 'No se pudo guardar el cambio'}), 500

    return jsonify({'registro': _serialize_atencion_dia(reg)}), 200

    reg  = AtencionDiaDetalle.query.get_or_404(reg_id)
    data = request.get_json() or {}

    # Campos editables
    campos = [
        'nro_orden', 'nro_factura', 'servicio', 'nro_identificacion',
        'nombre_paciente', 'acuerdo_comercial', 'empresa_mision',
        'sede', 'nombre_vendedor', 'estado_orden', 'forma_pago',
    ]
    for campo in campos:
        if campo in data:
            setattr(reg, campo, (_normalizar(data[campo]) if data[campo] not in (None, '') else None))

    if 'precio' in data:
        reg.precio = _parse_precio(data['precio'])

    if 'fecha_creacion_orden' in data and data['fecha_creacion_orden']:
        try:
            reg.fecha_creacion_orden = datetime.strptime(
                str(data['fecha_creacion_orden']).strip(), '%Y-%m-%d'
            )
        except ValueError:
            return jsonify({'error': 'Formato de fecha_creacion_orden inválido (YYYY-MM-DD)'}), 400

    if 'fecha_factura' in data and data['fecha_factura']:
        try:
            reg.fecha_factura = datetime.strptime(
                str(data['fecha_factura']).strip(), '%Y-%m-%d'
            )
        except ValueError:
            return jsonify({'error': 'Formato de fecha_factura inválido (YYYY-MM-DD)'}), 400

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.error('Error editando atencion dia %s: %s', reg_id, exc)
        return jsonify({'error': 'No se pudo guardar el cambio'}), 500

    return jsonify({'registro': _serialize_atencion_dia(reg)}), 200


# ---------------------------------------------------------------------------
# POST /api/comercial/prefacturas/regenerar-empresa
# Regenera el Excel de una empresa específica para un periodo y lo descarga
# ---------------------------------------------------------------------------
@comercial_bp.route('/atenciones-dia/<int:reg_id>', methods=['DELETE'])
@login_required
def eliminar_atencion_dia(reg_id):
    try:
        _require_commercial_permission(PERMISO_ELIMINACION_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    vendedor_scope = _resolver_vendedor_usuario_actual()
    if not _is_admin_user() and vendedor_scope is None:
        return jsonify({'error': 'No tienes un vendedor asociado'}), 403

    reg = AtencionDiaDetalle.query.get_or_404(reg_id)
    try:
        _asegurar_acceso_registro_atencion(reg, vendedor_scope)
        if (reg.estado_gestion or '').upper() != 'CARGADA':
            return jsonify({'error': 'Solo se pueden eliminar atenciones en estado CARGADA'}), 409
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    cargue = reg.cargue

    try:
        db.session.delete(reg)
        db.session.flush()

        if cargue is not None and cargue.nombre_archivo == NOMBRE_CARGUE_MANUAL:
            restantes = AtencionDiaDetalle.query.filter_by(cargue_id=cargue.id).count()
            if restantes == 0:
                db.session.delete(cargue)
            else:
                cargue.total_filas = restantes
                cargue.filas_importadas = restantes
                cargue.filas_duplicadas = 0
                cargue.filas_error = 0

        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.error('Error eliminando atencion dia %s: %s', reg_id, exc)
        return jsonify({'error': 'No se pudo eliminar la atencion'}), 500

    return jsonify({'mensaje': 'Atencion eliminada'}), 200


@comercial_bp.route('/prefacturas/regenerar-empresa', methods=['GET'])
@login_required
def regenerar_prefactura_empresa():
    """Regenera el Excel de prefactura para una empresa y periodo específicos.
    Parámetros: empresa (nombre), fecha_desde, fecha_hasta
    Actualiza el registro BORRADOR en BD y devuelve el ZIP con los archivos de esa empresa.
    """
    try:
        _require_commercial_permission(PERMISO_CONSULTA_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    empresa_nombre = (request.args.get('empresa') or '').strip()
    fecha_desde_str = (request.args.get('fecha_desde') or '').strip()
    fecha_hasta_str = (request.args.get('fecha_hasta') or '').strip()

    if not empresa_nombre or not fecha_desde_str or not fecha_hasta_str:
        return jsonify({'error': 'Se requieren empresa, fecha_desde y fecha_hasta'}), 400

    try:
        fecha_desde = datetime.strptime(fecha_desde_str, '%Y-%m-%d')
        fecha_hasta = datetime.strptime(f'{fecha_hasta_str} 23:59:59', '%Y-%m-%d %H:%M:%S')
    except ValueError:
        return jsonify({'error': 'Formato de fecha inválido (YYYY-MM-DD)'}), 400

    vendedor_scope = _resolver_vendedor_usuario_actual()
    if not _is_admin_user() and vendedor_scope is None:
        return jsonify({'error': 'No tienes un vendedor asociado'}), 403

    # Traer registros de esa empresa en el periodo
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

    todos = query.all()
    catalogo_lookup = _construir_lookup_catalogo()

    def _nombre_empresa_reg(reg):
        if reg.cliente:
            return reg.cliente.razon_social or reg.acuerdo_comercial or 'SIN_EMPRESA'
        return reg.acuerdo_comercial or reg.empresa_mision or 'SIN_EMPRESA'

    def _bucket_forma(valor):
        norm = _normalizar_forma_pago(valor)
        if norm == 'CREDITO':
            return 'CREDITO'
        if norm in ('EFECTIVO', 'CONTADO', 'PARTICULAR', 'PARTICULARES'):
            return 'EFECTIVO'
        return None

    # Filtrar registros de la empresa solicitada
    buckets: dict = defaultdict(list)
    for reg in todos:
        if _nombre_empresa_reg(reg).upper() != empresa_nombre.upper():
            continue
        bucket = _bucket_forma(reg.forma_pago)
        if bucket is None:
            continue
        estado_norm = (reg.estado_orden or '').upper().strip()
        if estado_norm == 'ANULADA':
            continue
        tipo_servicio = _clasificar_servicio(reg.servicio, catalogo_lookup)
        if tipo_servicio == 'ECOBABY':
            continue
        if reg.servicio and 'ECOBABY' in reg.servicio.upper():
            continue
        buckets[bucket].append(reg)

    if not buckets:
        return jsonify({'error': f'No se encontraron atenciones para {empresa_nombre} en el periodo indicado'}), 404

    periodo       = f"{fecha_desde.strftime('%d%m%Y')}-{fecha_hasta.strftime('%d%m%Y')}"
    periodo_label = f"{fecha_desde.strftime('%d/%m/%Y')} al {fecha_hasta.strftime('%d/%m/%Y')}"

    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    tiene_cred = bool(buckets.get('CREDITO'))
    tiene_efec = bool(buckets.get('EFECTIVO'))

    if tiene_cred and tiene_efec:
        prefijo   = 'mixto'
        secciones = [('-- CREDITO --', buckets['CREDITO']), ('-- EFECTIVO --', buckets['EFECTIVO'])]
        forma_bd  = 'MIXTO'
        regs_bd   = buckets['CREDITO'] + buckets['EFECTIVO']
    elif tiene_cred:
        prefijo   = 'cred'
        secciones = [('CREDITO', buckets['CREDITO'])]
        forma_bd  = 'CREDITO'
        regs_bd   = buckets['CREDITO']
    else:
        prefijo   = 'efec'
        secciones = [('EFECTIVO', buckets['EFECTIVO'])]
        forma_bd  = 'EFECTIVO'
        regs_bd   = buckets['EFECTIVO']

    # Reutilizar _construir_workbook definida en generar_prefacturas no es posible
    # (es una función local), así que llamamos directamente a generar_prefacturas
    # redirigiendo los parámetros. En su lugar construimos el workbook aquí.
    # Importar helpers de estilos
    font_titulo        = Font(name='Calibri', bold=True, size=14, color='FFFFFFFF')
    font_subtitulo     = Font(name='Calibri', bold=True, size=11, color='FFFFFFFF')
    font_header        = Font(name='Calibri', bold=True, size=10, color='FFFFFFFF')
    font_normal        = Font(name='Calibri', size=10)
    font_total_empresa = Font(name='Calibri', bold=True, size=11, color='FF1F4E79')
    fill_titulo   = PatternFill('solid', fgColor='FF1F4E79')
    fill_azul     = PatternFill('solid', fgColor='FF2E75B6')
    fill_total    = PatternFill('solid', fgColor='FFBDD7EE')
    thin        = Side(style='thin', color='FF9DC3E6')
    border_thin = Border(left=thin, right=thin, top=thin, bottom=thin)
    center   = Alignment(horizontal='center', vertical='center', wrap_text=True)
    left_al  = Alignment(horizontal='left',   vertical='center', wrap_text=True)
    right_al = Alignment(horizontal='right',  vertical='center')

    def _prep_filas(filas_regs):
        om = defaultdict(list)
        for r in filas_regs:
            k = (r.nro_identificacion or '', r.nro_orden or f'_sin_{r.id}')
            om[k].append(r)
        fd = []
        for (nid, _), regs in om.items():
            fechas = [r.fecha_creacion_orden for r in regs if r.fecha_creacion_orden]
            fs = min(fechas).strftime('%d/%m/%Y') if fechas else ''
            es = _construir_examenes_str(regs, catalogo_lookup)
            v  = sum(float(r.precio) for r in regs if r.precio is not None)
            np = (regs[0].nombre_paciente or '').strip()
            fd.append((v, es, fs, nid, np))
        fd.sort(key=lambda x: (x[0], x[1], x[2]))
        return fd

    def _calc_grupos(fd):
        grupos = []
        i = 0
        while i < len(fd):
            vg, eg = fd[i][0], fd[i][1]
            gf = []
            while i < len(fd) and fd[i][0] == vg and fd[i][1] == eg:
                gf.append(fd[i]); i += 1
            grupos.append((vg, eg, gf))
        return grupos

    def _cab(ws, titulo, sub, hdrs, n):
        cl = chr(ord('A') + n - 1)
        ws.merge_cells(f'A1:{cl}1')
        c = ws['A1']; c.value = titulo; c.font = font_titulo
        c.fill = fill_titulo; c.alignment = center; ws.row_dimensions[1].height = 28
        ws.merge_cells(f'A2:{cl}2')
        c = ws['A2']; c.value = sub; c.font = font_subtitulo
        c.fill = fill_azul; c.alignment = center; ws.row_dimensions[2].height = 20
        for ci, h in enumerate(hdrs, start=1):
            c = ws.cell(row=3, column=ci, value=h)
            c.font = font_header; c.fill = fill_azul
            c.alignment = center; c.border = border_thin
        ws.row_dimensions[3].height = 18

    wb = openpyxl.Workbook()
    ws_rel = wb.active; ws_rel.title = 'relacion-pacientes'
    ws_pf  = wb.create_sheet(title='prefactura')
    _cab(ws_rel, empresa_nombre.upper(), f'RELACION DE PACIENTES  |  Periodo: {periodo_label}',
         ['Fecha Atencion', 'ID Paciente', 'Paciente', 'Examenes', 'Valor'], 5)
    _cab(ws_pf, empresa_nombre.upper(), f'PREFACTURA  |  Periodo: {periodo_label}',
         ['Examenes', 'Cant. Pacientes', 'Valor Unit.', 'Total'], 4)

    fila_rel = 4; fila_pf = 4; total_emp = 0.0

    for label, filas_regs in secciones:
        fd     = _prep_filas(filas_regs)
        grupos = _calc_grupos(fd)
        total  = sum(vg * len(gf) for vg, _, gf in grupos)
        total_emp += total

        # Separador si no es primera seccion
        if fila_rel > 4:
            ws_rel.merge_cells(f'A{fila_rel}:E{fila_rel}')
            c = ws_rel.cell(row=fila_rel, column=1, value=label)
            c.font = font_subtitulo; c.fill = fill_azul
            c.alignment = center; c.border = border_thin
            ws_rel.row_dimensions[fila_rel].height = 20; fila_rel += 1
            ws_pf.merge_cells(f'A{fila_pf}:D{fila_pf}')
            c = ws_pf.cell(row=fila_pf, column=1, value=label)
            c.font = font_subtitulo; c.fill = fill_azul
            c.alignment = center; c.border = border_thin
            ws_pf.row_dimensions[fila_pf].height = 20; fila_pf += 1

        for (v, es, fs, nid, np) in fd:
            for ci, val in enumerate([fs, nid, np, es, v], start=1):
                c = ws_rel.cell(row=fila_rel, column=ci, value=val)
                c.font = font_normal; c.border = border_thin
                if ci in (1, 2): c.alignment = center
                elif ci == 5: c.alignment = right_al; c.number_format = '#,##0.00'
                else: c.alignment = left_al
            fila_rel += 1

        for (vg, eg, gf) in grupos:
            for ci, val in enumerate([eg, len(gf), vg, vg * len(gf)], start=1):
                c = ws_pf.cell(row=fila_pf, column=ci, value=val)
                c.font = font_normal; c.border = border_thin
                if ci == 1: c.alignment = left_al
                elif ci == 2: c.alignment = center
                else: c.alignment = right_al; c.number_format = '#,##0.00'
            fila_pf += 1

        # Total seccion
        ws_rel.merge_cells(f'A{fila_rel}:D{fila_rel}')
        c = ws_rel.cell(row=fila_rel, column=1, value='TOTAL')
        c.font = font_total_empresa; c.fill = fill_total
        c.alignment = right_al; c.border = border_thin
        c2 = ws_rel.cell(row=fila_rel, column=5, value=total)
        c2.font = font_total_empresa; c2.fill = fill_total
        c2.alignment = right_al; c2.number_format = '#,##0.00'; c2.border = border_thin
        fila_rel += 1

        ws_pf.merge_cells(f'A{fila_pf}:C{fila_pf}')
        c = ws_pf.cell(row=fila_pf, column=1, value='TOTAL')
        c.font = font_total_empresa; c.fill = fill_total
        c.alignment = right_al; c.border = border_thin
        c2 = ws_pf.cell(row=fila_pf, column=4, value=total)
        c2.font = font_total_empresa; c2.fill = fill_total
        c2.alignment = right_al; c2.number_format = '#,##0.00'; c2.border = border_thin
        fila_pf += 1

    ws_rel.column_dimensions['A'].width = 16; ws_rel.column_dimensions['B'].width = 16
    ws_rel.column_dimensions['C'].width = 32; ws_rel.column_dimensions['D'].width = 70
    ws_rel.column_dimensions['E'].width = 16
    ws_pf.column_dimensions['A'].width = 70; ws_pf.column_dimensions['B'].width = 18
    ws_pf.column_dimensions['C'].width = 16; ws_pf.column_dimensions['D'].width = 16

    # Actualizar prefactura BORRADOR en BD
    pref = PrefacturaComercial.query.filter_by(
        nombre_empresa=empresa_nombre,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        forma_pago=forma_bd,
        estado='BORRADOR',
    ).first()
    if pref:
        pacs = len({(r.nro_identificacion or '', r.nombre_paciente or '') for r in regs_bd})
        val  = sum(float(r.precio) for r in regs_bd if r.precio is not None)
        pref.cant_pacientes  = pacs
        pref.valor_total     = val
        pref.usuario_genera_id = current_user.id
        try:
            db.session.commit()
        except Exception as exc_bd:
            db.session.rollback()
            logger.warning('No se pudo actualizar prefactura en BD: %s', exc_bd)

    buf = io.BytesIO()
    wb.save(buf); buf.seek(0)
    nombre_safe = re.sub(r'[^\w\s\-]', '', empresa_nombre).strip()
    nombre_safe = re.sub(r'\s+', '_', nombre_safe)
    nombre_zip  = f'{prefijo}-{nombre_safe}-{periodo}.zip'

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f'{prefijo}-{nombre_safe}-{periodo}.xlsx', buf.read())
    zip_buf.seek(0)

    return send_file(
        zip_buf,
        mimetype='application/zip',
        as_attachment=True,
        download_name=nombre_zip,
    )

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
    # Consulta base: CREDITO / CONTADO / EFECTIVO / PARTICULAR, sin ECOBABY
    # -----------------------------------------------------------------------
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

    catalogo_lookup = _construir_lookup_catalogo()

    def _bucket_forma(valor):
        """Clasifica la forma de pago en 'CREDITO' o 'EFECTIVO' (bucket)."""
        norm = _normalizar_forma_pago(valor)
        if norm == 'CREDITO':
            return 'CREDITO'
        if norm in ('EFECTIVO', 'CONTADO', 'PARTICULAR', 'PARTICULARES'):
            return 'EFECTIVO'
        return None   # ignorar el resto

    def _nombre_empresa(reg):
        if reg.cliente:
            return reg.cliente.razon_social or reg.acuerdo_comercial or 'SIN_EMPRESA'
        return reg.acuerdo_comercial or reg.empresa_mision or 'SIN_EMPRESA'

    # Agrupar: empresa -> bucket -> [registros]
    # empresa_buckets: { nombre_empresa -> { 'CREDITO': [...], 'EFECTIVO': [...] } }
    empresa_buckets: dict = defaultdict(lambda: defaultdict(list))
    for reg in todos:
        bucket = _bucket_forma(reg.forma_pago)
        if bucket is None:
            continue
        estado_norm = (reg.estado_orden or '').upper().strip()
        if estado_norm == 'ANULADA':
            continue
        tipo_servicio = _clasificar_servicio(reg.servicio, catalogo_lookup)
        if tipo_servicio == 'ECOBABY':
            continue
        if reg.servicio and 'ECOBABY' in reg.servicio.upper():
            continue
        empresa_buckets[_nombre_empresa(reg)][bucket].append(reg)

    if not empresa_buckets:
        return jsonify({'error': 'No se encontraron atenciones en el rango de fechas indicado'}), 404

    # Para el resumen seguimos usando solo CREDITO
    empresas = {
        emp: buckets['CREDITO']
        for emp, buckets in empresa_buckets.items()
        if buckets.get('CREDITO')
    }

    periodo      = f"{fecha_desde.strftime('%d%m%Y')}-{fecha_hasta.strftime('%d%m%Y')}"
    periodo_label = f"{fecha_desde.strftime('%d/%m/%Y')} al {fecha_hasta.strftime('%d/%m/%Y')}"

    # -----------------------------------------------------------------------
    # Construir Excel por empresa
    # Reglas de prefijo y contenido:
    #   - Solo CREDITO          -> cred-Empresa.xlsx   (1 seccion: credito)
    #   - Solo EFECTIVO         -> efec-Empresa.xlsx   (1 seccion: efectivo)
    #   - CREDITO + EFECTIVO    -> mixto-Empresa.xlsx  (2 secciones: credito arriba, efectivo abajo)
    # Cada archivo tiene 2 hojas: relacion-pacientes y prefactura
    # -----------------------------------------------------------------------
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    archivos: list = []

    # ---- Estilos (definidos una vez, reutilizados en todas las funciones) ----
    def _make_styles():
        return dict(
            font_titulo        = Font(name='Calibri', bold=True, size=14, color='FFFFFFFF'),
            font_subtitulo     = Font(name='Calibri', bold=True, size=11, color='FFFFFFFF'),
            font_header        = Font(name='Calibri', bold=True, size=10, color='FFFFFFFF'),
            font_normal        = Font(name='Calibri', size=10),
            font_total_empresa = Font(name='Calibri', bold=True, size=11, color='FF1F4E79'),
            fill_titulo        = PatternFill('solid', fgColor='FF1F4E79'),
            fill_azul          = PatternFill('solid', fgColor='FF2E75B6'),
            fill_total         = PatternFill('solid', fgColor='FFBDD7EE'),
            thin               = Side(style='thin', color='FF9DC3E6'),
            center             = Alignment(horizontal='center', vertical='center', wrap_text=True),
            left_al            = Alignment(horizontal='left',   vertical='center', wrap_text=True),
            right_al           = Alignment(horizontal='right',  vertical='center'),
        )

    def _preparar_filas(filas_regs):
        """Convierte registros en lista de (valor, examenes_str, fecha_str, nro_id, nombre_pac)
        ordenada por valor asc -> examenes asc -> fecha asc."""
        ordenes_map = defaultdict(list)
        for reg in filas_regs:
            key_ord = (reg.nro_identificacion or '', reg.nro_orden or f'_sin_{reg.id}')
            ordenes_map[key_ord].append(reg)

        filas_detalle = []
        for (nro_id, _), regs_orden in ordenes_map.items():
            fechas       = [r.fecha_creacion_orden for r in regs_orden if r.fecha_creacion_orden]
            fecha_str    = min(fechas).strftime('%d/%m/%Y') if fechas else ''
            examenes_str = _construir_examenes_str(regs_orden, catalogo_lookup)
            valor        = sum(float(r.precio) for r in regs_orden if r.precio is not None)
            nombre_pac   = (regs_orden[0].nombre_paciente or '').strip()
            filas_detalle.append((valor, examenes_str, fecha_str, nro_id, nombre_pac))

        filas_detalle.sort(key=lambda x: (x[0], x[1], x[2]))
        return filas_detalle

    def _calcular_grupos(filas_detalle):
        """Agrupa filas por (valor, examenes) para la hoja prefactura."""
        grupos = []
        i = 0
        while i < len(filas_detalle):
            vg = filas_detalle[i][0]
            eg = filas_detalle[i][1]
            gf = []
            while i < len(filas_detalle) and filas_detalle[i][0] == vg and filas_detalle[i][1] == eg:
                gf.append(filas_detalle[i])
                i += 1
            grupos.append((vg, eg, gf))
        return grupos

    def _escribir_cabecera_ws(ws, titulo, subtitulo, headers_list, st):
        n = len(headers_list)
        col_fin = chr(ord('A') + n - 1)
        ws.merge_cells(f'A1:{col_fin}1')
        c = ws['A1']
        c.value = titulo; c.font = st['font_titulo']
        c.fill = st['fill_titulo']; c.alignment = st['center']
        ws.row_dimensions[1].height = 28

        ws.merge_cells(f'A2:{col_fin}2')
        c = ws['A2']
        c.value = subtitulo; c.font = st['font_subtitulo']
        c.fill = st['fill_azul']; c.alignment = st['center']
        ws.row_dimensions[2].height = 20

        border = Border(left=st['thin'], right=st['thin'], top=st['thin'], bottom=st['thin'])
        for ci, h in enumerate(headers_list, start=1):
            c = ws.cell(row=3, column=ci, value=h)
            c.font = st['font_header']; c.fill = st['fill_azul']
            c.alignment = st['center']; c.border = border
        ws.row_dimensions[3].height = 18
        return border

    def _escribir_seccion_relacion(ws, fila_inicio, filas_detalle, total, label_seccion, st):
        """Escribe una seccion de detalle en la hoja relacion-pacientes.
        Devuelve la siguiente fila disponible."""
        border = Border(left=st['thin'], right=st['thin'], top=st['thin'], bottom=st['thin'])

        # Separador de seccion si no es la primera (fila_inicio > 4)
        if fila_inicio > 4:
            fill_sep = PatternFill('solid', fgColor='FF1F4E79')
            ws.merge_cells(f'A{fila_inicio}:E{fila_inicio}')
            c = ws.cell(row=fila_inicio, column=1, value=label_seccion)
            c.font = st['font_subtitulo']; c.fill = fill_sep
            c.alignment = st['center']; c.border = border
            ws.row_dimensions[fila_inicio].height = 20
            fila_inicio += 1

        for (valor, examenes_str, fecha_str, nro_id, nombre_pac) in filas_detalle:
            for ci, v in enumerate([fecha_str, nro_id, nombre_pac, examenes_str, valor], start=1):
                c = ws.cell(row=fila_inicio, column=ci, value=v)
                c.font = st['font_normal']; c.border = border
                if ci in (1, 2):
                    c.alignment = st['center']
                elif ci == 5:
                    c.alignment = st['right_al']; c.number_format = '#,##0.00'
                else:
                    c.alignment = st['left_al']
            fila_inicio += 1

        # Total de seccion
        ws.merge_cells(f'A{fila_inicio}:D{fila_inicio}')
        c = ws.cell(row=fila_inicio, column=1, value='TOTAL')
        c.font = st['font_total_empresa']; c.fill = st['fill_total']
        c.alignment = st['right_al']; c.border = border
        c2 = ws.cell(row=fila_inicio, column=5, value=total)
        c2.font = st['font_total_empresa']; c2.fill = st['fill_total']
        c2.alignment = st['right_al']; c2.number_format = '#,##0.00'; c2.border = border
        return fila_inicio + 1

    def _escribir_seccion_prefactura(ws, fila_inicio, grupos, total, label_seccion, st):
        """Escribe una seccion de grupos en la hoja prefactura.
        Devuelve la siguiente fila disponible."""
        border = Border(left=st['thin'], right=st['thin'], top=st['thin'], bottom=st['thin'])

        if fila_inicio > 4:
            fill_sep = PatternFill('solid', fgColor='FF1F4E79')
            ws.merge_cells(f'A{fila_inicio}:D{fila_inicio}')
            c = ws.cell(row=fila_inicio, column=1, value=label_seccion)
            c.font = st['font_subtitulo']; c.fill = fill_sep
            c.alignment = st['center']; c.border = border
            ws.row_dimensions[fila_inicio].height = 20
            fila_inicio += 1

        for (vg, eg, gf) in grupos:
            cant = len(gf)
            for ci, v in enumerate([eg, cant, vg, vg * cant], start=1):
                c = ws.cell(row=fila_inicio, column=ci, value=v)
                c.font = st['font_normal']; c.border = border
                if ci == 1:
                    c.alignment = st['left_al']
                elif ci == 2:
                    c.alignment = st['center']
                else:
                    c.alignment = st['right_al']; c.number_format = '#,##0.00'
            fila_inicio += 1

        ws.merge_cells(f'A{fila_inicio}:C{fila_inicio}')
        c = ws.cell(row=fila_inicio, column=1, value='TOTAL')
        c.font = st['font_total_empresa']; c.fill = st['fill_total']
        c.alignment = st['right_al']; c.border = border
        c2 = ws.cell(row=fila_inicio, column=4, value=total)
        c2.font = st['font_total_empresa']; c2.fill = st['fill_total']
        c2.alignment = st['right_al']; c2.number_format = '#,##0.00'; c2.border = border
        return fila_inicio + 1

    def _construir_workbook(nombre_empresa, secciones):
        """secciones: lista de (label, filas_regs) en orden de aparicion."""
        st  = _make_styles()
        wb  = openpyxl.Workbook()
        ws_rel = wb.active
        ws_rel.title = 'relacion-pacientes'
        ws_pf  = wb.create_sheet(title='prefactura')

        _escribir_cabecera_ws(
            ws_rel, nombre_empresa.upper(),
            f'RELACION DE PACIENTES  |  Periodo: {periodo_label}',
            ['Fecha Atencion', 'ID Paciente', 'Paciente', 'Examenes', 'Valor'], st)
        _escribir_cabecera_ws(
            ws_pf, nombre_empresa.upper(),
            f'PREFACTURA  |  Periodo: {periodo_label}',
            ['Examenes', 'Cant. Pacientes', 'Valor Unit.', 'Total'], st)

        fila_rel = 4
        fila_pf  = 4

        for label, filas_regs in secciones:
            fd     = _preparar_filas(filas_regs)
            grupos = _calcular_grupos(fd)
            total  = sum(vg * len(gf) for vg, _, gf in grupos)
            fila_rel = _escribir_seccion_relacion(ws_rel, fila_rel, fd, total, label, st)
            fila_pf  = _escribir_seccion_prefactura(ws_pf, fila_pf, grupos, total, label, st)

        ws_rel.column_dimensions['A'].width = 16
        ws_rel.column_dimensions['B'].width = 16
        ws_rel.column_dimensions['C'].width = 32
        ws_rel.column_dimensions['D'].width = 70
        ws_rel.column_dimensions['E'].width = 16

        ws_pf.column_dimensions['A'].width = 70
        ws_pf.column_dimensions['B'].width = 18
        ws_pf.column_dimensions['C'].width = 16
        ws_pf.column_dimensions['D'].width = 16

        return wb

    # Generar un archivo por empresa con el prefijo correcto
    for nombre_empresa, buckets in sorted(empresa_buckets.items()):
        tiene_cred = bool(buckets.get('CREDITO'))
        tiene_efec = bool(buckets.get('EFECTIVO'))

        if tiene_cred and tiene_efec:
            prefijo   = 'mixto'
            secciones = [
                ('-- CREDITO --',  buckets['CREDITO']),
                ('-- EFECTIVO --', buckets['EFECTIVO']),
            ]
        elif tiene_cred:
            prefijo   = 'cred'
            secciones = [('CREDITO', buckets['CREDITO'])]
        else:
            prefijo   = 'efec'
            secciones = [('EFECTIVO', buckets['EFECTIVO'])]

        wb = _construir_workbook(nombre_empresa, secciones)
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        nombre_safe    = re.sub(r'[^\w\s\-]', '', nombre_empresa).strip()
        nombre_safe    = re.sub(r'\s+', '_', nombre_safe)
        nombre_archivo = f'{prefijo}-{nombre_safe}-{periodo}.xlsx'
        archivos.append((nombre_archivo, buf.read()))

    # -----------------------------------------------------------------------
    # Generar resumen_periodo.xlsx
    # Secciones: CREDITO | MIXTO | EFECTIVO, cada una con sus empresas A-Z,
    # subtotal por seccion y total general al final.
    # -----------------------------------------------------------------------
    import openpyxl as _openpyxl
    from openpyxl.styles import (
        Font as _Font, PatternFill as _Fill,
        Alignment as _Align, Border as _Border, Side as _Side,
    )

    wb_res = _openpyxl.Workbook()
    ws_res = wb_res.active
    ws_res.title = 'Resumen'

    _thin    = _Side(style='thin', color='FF9DC3E6')
    _border  = _Border(left=_thin, right=_thin, top=_thin, bottom=_thin)
    _center  = _Align(horizontal='center', vertical='center', wrap_text=True)
    _left    = _Align(horizontal='left',   vertical='center', wrap_text=True)
    _right   = _Align(horizontal='right',  vertical='center')

    _font_titulo   = _Font(name='Calibri', bold=True, size=13, color='FFFFFFFF')
    _font_seccion  = _Font(name='Calibri', bold=True, size=11, color='FFFFFFFF')
    _font_header   = _Font(name='Calibri', bold=True, size=10, color='FFFFFFFF')
    _font_data     = _Font(name='Calibri', size=10)
    _font_subtotal = _Font(name='Calibri', bold=True, size=10, color='FF1F4E79')
    _font_total    = _Font(name='Calibri', bold=True, size=11, color='FF1F4E79')

    _fill_titulo   = _Fill('solid', fgColor='FF1F4E79')
    _fill_azul     = _Fill('solid', fgColor='FF2E75B6')
    _fill_subtotal = _Fill('solid', fgColor='FFDAE3F3')
    _fill_total    = _Fill('solid', fgColor='FFBDD7EE')

    _encabezados = ['Empresa', 'Cantidad de Pacientes', 'Valor Total',
                    'Fecha Factura', 'Nro Factura', 'Valor Factura']

    # Fila 1: titulo general
    ws_res.merge_cells('A1:F1')
    c = ws_res['A1']
    c.value = f'RESUMEN PREFACTURAS  |  Periodo: {periodo_label}'
    c.font = _font_titulo; c.fill = _fill_titulo
    c.alignment = _center
    ws_res.row_dimensions[1].height = 26

    # Fila 2: encabezados de columna
    for _ci, _enc in enumerate(_encabezados, start=1):
        _c = ws_res.cell(row=2, column=_ci, value=_enc)
        _c.font = _font_header; _c.fill = _fill_azul
        _c.alignment = _center; _c.border = _border
    ws_res.row_dimensions[2].height = 18

    _fila_res   = 3
    _gran_pac   = 0
    _gran_val   = 0.0

    def _escribir_fila_empresa(ws, fila, emp, pacs, val):
        _row = [emp, pacs, val, '', '', '']
        for _ci, _v in enumerate(_row, start=1):
            _c = ws.cell(row=fila, column=_ci, value=_v)
            _c.font = _font_data; _c.border = _border
            if _ci == 1:
                _c.alignment = _left
            elif _ci == 2:
                _c.alignment = _center
            elif _ci == 3:
                _c.alignment = _right; _c.number_format = '#,##0.00'
            else:
                _c.alignment = _center

    def _escribir_subtotal(ws, fila, label, pacs, val):
        _c = ws.cell(row=fila, column=1, value=label)
        _c.font = _font_subtotal; _c.fill = _fill_subtotal
        _c.alignment = _right; _c.border = _border
        _c2 = ws.cell(row=fila, column=2, value=pacs)
        _c2.font = _font_subtotal; _c2.fill = _fill_subtotal
        _c2.alignment = _center; _c2.border = _border
        _c3 = ws.cell(row=fila, column=3, value=val)
        _c3.font = _font_subtotal; _c3.fill = _fill_subtotal
        _c3.alignment = _right; _c3.number_format = '#,##0.00'; _c3.border = _border
        for _ci in (4, 5, 6):
            _cx = ws.cell(row=fila, column=_ci, value='')
            _cx.fill = _fill_subtotal; _cx.border = _border

    # Construir datos por seccion: CREDITO, MIXTO, EFECTIVO
    # Una empresa es MIXTO si tiene ambos buckets, CREDITO si solo credito, EFECTIVO si solo efectivo
    _secciones_resumen = [
        ('CREDITO',  'CRÉDITO'),
        ('MIXTO',    'MIXTO'),
        ('EFECTIVO', 'EFECTIVO'),
    ]

    for _bucket_key, _label_sec in _secciones_resumen:
        # Recoger empresas que pertenecen a esta seccion
        _empresas_sec = {}
        for _emp, _buckets in sorted(empresa_buckets.items(), key=lambda x: x[0].upper()):
            _tiene_cred = bool(_buckets.get('CREDITO'))
            _tiene_efec = bool(_buckets.get('EFECTIVO'))
            if _bucket_key == 'CREDITO' and _tiene_cred and not _tiene_efec:
                _empresas_sec[_emp] = _buckets['CREDITO']
            elif _bucket_key == 'MIXTO' and _tiene_cred and _tiene_efec:
                _empresas_sec[_emp] = _buckets['CREDITO'] + _buckets['EFECTIVO']
            elif _bucket_key == 'EFECTIVO' and _tiene_efec and not _tiene_cred:
                _empresas_sec[_emp] = _buckets['EFECTIVO']

        if not _empresas_sec:
            continue

        # Fila separador de seccion
        ws_res.merge_cells(f'A{_fila_res}:F{_fila_res}')
        _cs = ws_res.cell(row=_fila_res, column=1, value=f'── {_label_sec} ──')
        _cs.font = _font_seccion; _cs.fill = _fill_azul
        _cs.alignment = _center; _cs.border = _border
        ws_res.row_dimensions[_fila_res].height = 20
        _fila_res += 1

        # Titulos de columna para esta seccion (solo MIXTO y EFECTIVO, CREDITO ya los tiene en fila 2)
        if _bucket_key != 'CREDITO':
            for _ci, _enc in enumerate(_encabezados, start=1):
                _c = ws_res.cell(row=_fila_res, column=_ci, value=_enc)
                _c.font = _font_header; _c.fill = _fill_azul
                _c.alignment = _center; _c.border = _border
            ws_res.row_dimensions[_fila_res].height = 18
            _fila_res += 1

        _sec_pac = 0
        _sec_val = 0.0

        for _emp, _regs_emp in _empresas_sec.items():
            _pacs = len({(r.nro_identificacion or '', r.nombre_paciente or '') for r in _regs_emp})
            _val  = sum(float(r.precio) for r in _regs_emp if r.precio is not None)
            _sec_pac += _pacs
            _sec_val += _val
            _escribir_fila_empresa(ws_res, _fila_res, _emp, _pacs, _val)
            _fila_res += 1

        # Subtotal de seccion
        _escribir_subtotal(ws_res, _fila_res, f'Subtotal {_label_sec}', _sec_pac, _sec_val)
        _fila_res += 1

        _gran_pac += _sec_pac
        _gran_val += _sec_val

    # Fila en blanco separadora antes del total general
    for _ci in range(1, 7):
        _c = ws_res.cell(row=_fila_res, column=_ci, value='')
        _c.border = _border
    _fila_res += 1

    # Fila total general
    _ct = ws_res.cell(row=_fila_res, column=1, value='TOTAL GENERAL')
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
    # Persistir / actualizar prefacturas en BD (estado BORRADOR)
    # Solo se actualizan las que están en BORRADOR; las CERRADAS no se tocan.
    # -----------------------------------------------------------------------
    for nombre_empresa, buckets in empresa_buckets.items():
        tiene_cred = bool(buckets.get('CREDITO'))
        tiene_efec = bool(buckets.get('EFECTIVO'))

        if tiene_cred and tiene_efec:
            formas_guardar = [('MIXTO', buckets['CREDITO'] + buckets['EFECTIVO'])]
        elif tiene_cred:
            formas_guardar = [('CREDITO', buckets['CREDITO'])]
        else:
            formas_guardar = [('EFECTIVO', buckets['EFECTIVO'])]

        for forma_bd, regs_bd in formas_guardar:
            pacs_bd = len({
                (r.nro_identificacion or '', r.nombre_paciente or '')
                for r in regs_bd
            })
            val_bd = sum(float(r.precio) for r in regs_bd if r.precio is not None)

            cliente_bd = next(
                (r.cliente for r in regs_bd if r.cliente is not None), None
            )

            pref = PrefacturaComercial.query.filter_by(
                nombre_empresa=nombre_empresa,
                fecha_desde=fecha_desde,
                fecha_hasta=fecha_hasta,
                forma_pago=forma_bd,
            ).first()

            if pref is None:
                pref = PrefacturaComercial(
                    nombre_empresa=nombre_empresa,
                    fecha_desde=fecha_desde,
                    fecha_hasta=fecha_hasta,
                    forma_pago=forma_bd,
                    estado='BORRADOR',
                    usuario_genera_id=current_user.id,
                )
                db.session.add(pref)

            # Solo actualizar si sigue en BORRADOR
            if pref.estado == 'BORRADOR':
                pref.cliente_id      = cliente_bd.id if cliente_bd else pref.cliente_id
                pref.cant_pacientes  = pacs_bd
                pref.valor_total     = val_bd
                pref.usuario_genera_id = current_user.id

    try:
        db.session.commit()
    except Exception as exc_bd:
        db.session.rollback()
        logger.warning('No se pudo guardar prefacturas en BD: %s', exc_bd)

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


# ===========================================================================
# ENDPOINTS DE PREFACTURAS (CRUD + CONSULTA + CARTERA)
# ===========================================================================

def _prefactura_to_dict(p):
    """Serializa una PrefacturaComercial a dict."""
    pagos_total = sum(
        float(pg.valor_pago) for pg in p.pagos_cartera
        if pg.estado != 'ANULADO'
    )
    saldo = float(p.valor_factura or p.valor_total or 0) - pagos_total
    return {
        'id':              p.id,
        'cliente_id':      p.cliente_id,
        'nombre_empresa':  p.nombre_empresa,
        'fecha_desde':     p.fecha_desde.strftime('%Y-%m-%d') if p.fecha_desde else None,
        'fecha_hasta':     p.fecha_hasta.strftime('%Y-%m-%d') if p.fecha_hasta else None,
        'forma_pago':      p.forma_pago,
        'cant_pacientes':  p.cant_pacientes,
        'valor_total':     float(p.valor_total or 0),
        'estado':          p.estado,
        'fecha_factura':   p.fecha_factura.strftime('%Y-%m-%d') if p.fecha_factura else None,
        'nro_factura':     p.nro_factura,
        'valor_factura':   float(p.valor_factura) if p.valor_factura is not None else None,
        'fecha_cierre':    p.fecha_cierre.strftime('%Y-%m-%d %H:%M') if p.fecha_cierre else None,
        'observaciones':   p.observaciones,
        'total_pagado':    pagos_total,
        'saldo_pendiente': saldo,
        'created_at':      p.created_at.strftime('%Y-%m-%d %H:%M') if p.created_at else None,
        'updated_at':      p.updated_at.strftime('%Y-%m-%d %H:%M') if p.updated_at else None,
    }


def _pago_cartera_to_dict(pg):
    return {
        'id':              pg.id,
        'prefactura_id':   pg.prefactura_id,
        'tipo_movimiento': pg.tipo_movimiento,
        'fecha_pago':      pg.fecha_pago.strftime('%Y-%m-%d') if pg.fecha_pago else None,
        'valor_pago':      float(pg.valor_pago or 0),
        'medio_pago':      pg.medio_pago,
        'nro_comprobante': pg.nro_comprobante,
        'estado':          pg.estado,
        'observaciones':   pg.observaciones,
        'created_at':      pg.created_at.strftime('%Y-%m-%d %H:%M') if pg.created_at else None,
    }


# ---------------------------------------------------------------------------
# GET /api/comercial/prefacturas  — consulta con filtros
# ---------------------------------------------------------------------------
@comercial_bp.route('/prefacturas', methods=['GET'])
@login_required
def listar_prefacturas():
    """Consulta prefacturas con filtros opcionales:
    empresa, fecha_desde, fecha_hasta, forma_pago, estado.
    """
    try:
        _require_commercial_permission(PERMISO_CONSULTA_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    empresa    = (request.args.get('empresa') or '').strip()
    fd_str     = (request.args.get('fecha_desde') or '').strip()
    fh_str     = (request.args.get('fecha_hasta') or '').strip()
    forma      = (request.args.get('forma_pago') or '').strip().upper()
    estado     = (request.args.get('estado') or '').strip().upper()

    q = PrefacturaComercial.query

    if empresa:
        q = q.filter(PrefacturaComercial.nombre_empresa.ilike(f'%{empresa}%'))
    if fd_str:
        try:
            q = q.filter(PrefacturaComercial.fecha_desde >= datetime.strptime(fd_str, '%Y-%m-%d'))
        except ValueError:
            return jsonify({'error': 'fecha_desde invalida'}), 400
    if fh_str:
        try:
            q = q.filter(PrefacturaComercial.fecha_hasta <= datetime.strptime(f'{fh_str} 23:59:59', '%Y-%m-%d %H:%M:%S'))
        except ValueError:
            return jsonify({'error': 'fecha_hasta invalida'}), 400
    if forma:
        q = q.filter(PrefacturaComercial.forma_pago == forma)
    if estado:
        q = q.filter(PrefacturaComercial.estado == estado)

    # Scope por vendedor
    vendedor_scope = _resolver_vendedor_usuario_actual()
    if not _is_admin_user():
        if vendedor_scope is None:
            return jsonify({'prefacturas': []}), 200
        cliente_ids = [
            c.id for c in ClienteComercial.query.filter_by(vendedor_id=vendedor_scope.id).all()
        ]
        q = q.filter(PrefacturaComercial.cliente_id.in_(cliente_ids))

    prefacturas = q.order_by(
        PrefacturaComercial.fecha_desde.desc(),
        PrefacturaComercial.nombre_empresa.asc(),
    ).all()

    return jsonify({'prefacturas': [_prefactura_to_dict(p) for p in prefacturas]}), 200


# ---------------------------------------------------------------------------
# GET /api/comercial/prefacturas/<id>  — detalle de una prefactura
# ---------------------------------------------------------------------------
@comercial_bp.route('/prefacturas/<int:pref_id>', methods=['GET'])
@login_required
def obtener_prefactura(pref_id):
    try:
        _require_commercial_permission(PERMISO_CONSULTA_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    pref = PrefacturaComercial.query.get_or_404(pref_id)
    pagos = [_pago_cartera_to_dict(pg) for pg in pref.pagos_cartera.order_by(CarteraPrefactura.fecha_pago.asc()).all()]
    data = _prefactura_to_dict(pref)
    data['pagos'] = pagos
    return jsonify({'prefactura': data}), 200


# ---------------------------------------------------------------------------
# PUT /api/comercial/prefacturas/<id>  — editar (solo BORRADOR)
# Permite actualizar observaciones y datos de factura mientras esté en BORRADOR
# ---------------------------------------------------------------------------
@comercial_bp.route('/prefacturas/<int:pref_id>', methods=['PUT'])
@login_required
def actualizar_prefactura(pref_id):
    try:
        _require_commercial_permission(PERMISO_CARGUE_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    pref = PrefacturaComercial.query.get_or_404(pref_id)
    if pref.estado == 'CERRADA':
        return jsonify({'error': 'La prefactura está cerrada y no puede modificarse'}), 409

    data = request.get_json() or {}
    if 'observaciones' in data:
        pref.observaciones = (data['observaciones'] or '').strip() or None

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.error('Error actualizando prefactura %s: %s', pref_id, exc)
        return jsonify({'error': 'No se pudo actualizar la prefactura'}), 500

    return jsonify({'prefactura': _prefactura_to_dict(pref)}), 200


# ---------------------------------------------------------------------------
# POST /api/comercial/prefacturas/<id>/cerrar  — cerrar periodo de una prefactura
# Registra fecha_factura, nro_factura, valor_factura y pasa a CERRADA
# ---------------------------------------------------------------------------
@comercial_bp.route('/prefacturas/<int:pref_id>/cerrar', methods=['POST'])
@login_required
def cerrar_prefactura(pref_id):
    try:
        _require_commercial_permission(PERMISO_CARGUE_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    pref = PrefacturaComercial.query.get_or_404(pref_id)
    if pref.estado == 'CERRADA':
        return jsonify({'error': 'La prefactura ya está cerrada'}), 409

    data = request.get_json() or {}

    # Para crédito: fecha y nro factura son obligatorios
    if pref.forma_pago in ('CREDITO', 'MIXTO'):
        fecha_fac_str = (data.get('fecha_factura') or '').strip()
        nro_fac       = (data.get('nro_factura') or '').strip()
        if not fecha_fac_str:
            return jsonify({'error': 'La fecha de factura es obligatoria para cerrar'}), 400
        if not nro_fac:
            return jsonify({'error': 'El número de factura es obligatorio para cerrar'}), 400
        try:
            pref.fecha_factura = datetime.strptime(fecha_fac_str, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Formato de fecha_factura inválido (YYYY-MM-DD)'}), 400
        pref.nro_factura = nro_fac

    valor_fac_raw = data.get('valor_factura')
    if valor_fac_raw not in (None, ''):
        try:
            from decimal import Decimal as _Dec
            pref.valor_factura = _Dec(str(valor_fac_raw))
        except Exception:
            return jsonify({'error': 'valor_factura inválido'}), 400
    else:
        pref.valor_factura = pref.valor_total

    pref.estado           = 'CERRADA'
    pref.fecha_cierre     = datetime.utcnow()
    pref.usuario_cierra_id = current_user.id
    if data.get('observaciones'):
        pref.observaciones = str(data['observaciones']).strip()

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.error('Error cerrando prefactura %s: %s', pref_id, exc)
        return jsonify({'error': 'No se pudo cerrar la prefactura'}), 500

    return jsonify({'prefactura': _prefactura_to_dict(pref)}), 200


# ---------------------------------------------------------------------------
# POST /api/comercial/prefacturas/<id>/reabrir  — reabrir a BORRADOR (admin)
# ---------------------------------------------------------------------------
@comercial_bp.route('/prefacturas/<int:pref_id>/reabrir', methods=['POST'])
@login_required
def reabrir_prefactura(pref_id):
    if not _is_admin_user():
        return jsonify({'error': 'Solo el administrador puede reabrir una prefactura cerrada'}), 403

    pref = PrefacturaComercial.query.get_or_404(pref_id)
    if pref.estado != 'CERRADA':
        return jsonify({'error': 'La prefactura no está cerrada'}), 409

    pref.estado            = 'BORRADOR'
    pref.fecha_cierre      = None
    pref.usuario_cierra_id = None

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({'error': 'No se pudo reabrir la prefactura'}), 500

    return jsonify({'prefactura': _prefactura_to_dict(pref)}), 200


# ---------------------------------------------------------------------------
# DELETE /api/comercial/prefacturas/<id>  — eliminar (solo BORRADOR, admin)
# ---------------------------------------------------------------------------
@comercial_bp.route('/prefacturas/<int:pref_id>', methods=['DELETE'])
@login_required
def eliminar_prefactura(pref_id):
    if not _is_admin_user():
        return jsonify({'error': 'Solo el administrador puede eliminar prefacturas'}), 403

    pref = PrefacturaComercial.query.get_or_404(pref_id)
    if pref.estado == 'CERRADA':
        return jsonify({'error': 'No se puede eliminar una prefactura cerrada'}), 409

    try:
        db.session.delete(pref)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({'error': 'No se pudo eliminar la prefactura'}), 500

    return jsonify({'ok': True}), 200


# ---------------------------------------------------------------------------
# POST /api/comercial/prefacturas/cargar-resumen
# Carga masiva desde resumen_periodo.xlsx: actualiza fecha/nro/valor factura
# en las prefacturas BORRADOR de crédito que coincidan por nombre de empresa
# ---------------------------------------------------------------------------
@comercial_bp.route('/prefacturas/cargar-resumen', methods=['POST'])
@login_required
def cargar_resumen_prefacturas():
    try:
        _require_commercial_permission(PERMISO_CARGUE_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    if 'archivo' not in request.files:
        return jsonify({'error': 'No se envió ningún archivo'}), 400

    archivo = request.files['archivo']
    if not (archivo.filename or '').lower().endswith('.xlsx'):
        return jsonify({'error': 'Solo se aceptan archivos .xlsx'}), 400

    import openpyxl as _xl
    try:
        wb = _xl.load_workbook(filename=io.BytesIO(archivo.read()), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
    except Exception as exc:
        return jsonify({'error': f'No se pudo leer el archivo: {exc}'}), 400

    # Buscar fila de encabezados (contiene 'Empresa')
    header_row = None
    for i, row in enumerate(rows):
        vals = [str(v or '').strip().lower() for v in row]
        if 'empresa' in vals:
            header_row = i
            break

    if header_row is None:
        return jsonify({'error': 'No se encontró la fila de encabezados en el archivo'}), 400

    headers = [str(v or '').strip().lower() for v in rows[header_row]]

    def _col(name):
        for i, h in enumerate(headers):
            if name in h:
                return i
        return None

    col_empresa      = _col('empresa')
    col_fecha_fac    = _col('fecha factura')
    col_nro_fac      = _col('nro factura')
    col_valor_fac    = _col('valor factura')

    if col_empresa is None:
        return jsonify({'error': 'No se encontró la columna Empresa en el archivo'}), 400

    actualizadas = 0
    no_encontradas = []

    for row in rows[header_row + 1:]:
        if not row or all(v in (None, '') for v in row):
            continue
        nombre_emp = str(row[col_empresa] or '').strip()
        if not nombre_emp or nombre_emp.upper() in ('TOTAL', 'TOTAL GENERAL', ''):
            continue

        fecha_fac_val  = row[col_fecha_fac]  if col_fecha_fac  is not None else None
        nro_fac_val    = row[col_nro_fac]    if col_nro_fac    is not None else None
        valor_fac_val  = row[col_valor_fac]  if col_valor_fac  is not None else None

        # Parsear fecha
        fecha_fac = None
        if fecha_fac_val:
            if isinstance(fecha_fac_val, datetime):
                fecha_fac = fecha_fac_val
            else:
                for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y'):
                    try:
                        fecha_fac = datetime.strptime(str(fecha_fac_val).strip(), fmt)
                        break
                    except ValueError:
                        pass

        nro_fac = str(nro_fac_val or '').strip() or None

        valor_fac = None
        if valor_fac_val not in (None, ''):
            try:
                from decimal import Decimal as _Dec
                valor_fac = _Dec(str(valor_fac_val).replace(',', '.'))
            except Exception:
                pass

        # Buscar prefactura BORRADOR de crédito o mixto para esta empresa
        prefs = PrefacturaComercial.query.filter(
            PrefacturaComercial.nombre_empresa.ilike(nombre_emp),
            PrefacturaComercial.estado == 'BORRADOR',
            PrefacturaComercial.forma_pago.in_(['CREDITO', 'MIXTO']),
        ).all()

        if not prefs:
            no_encontradas.append(nombre_emp)
            continue

        for pref in prefs:
            if fecha_fac:
                pref.fecha_factura = fecha_fac
            if nro_fac:
                pref.nro_factura = nro_fac
            if valor_fac is not None:
                pref.valor_factura = valor_fac
            actualizadas += 1

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({'error': f'Error guardando cambios: {exc}'}), 500

    return jsonify({
        'actualizadas':    actualizadas,
        'no_encontradas':  no_encontradas,
        'mensaje': f'{actualizadas} prefactura(s) actualizadas.',
    }), 200


# ===========================================================================
# ENDPOINTS DE CARTERA (pagos sobre prefacturas)
# ===========================================================================

# ---------------------------------------------------------------------------
# GET /api/comercial/prefacturas/<id>/cartera  — pagos de una prefactura
# ---------------------------------------------------------------------------
@comercial_bp.route('/prefacturas/<int:pref_id>/cartera', methods=['GET'])
@login_required
def listar_cartera_prefactura(pref_id):
    try:
        _require_commercial_permission(PERMISO_CONSULTA_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    pref = PrefacturaComercial.query.get_or_404(pref_id)
    pagos = pref.pagos_cartera.order_by(CarteraPrefactura.fecha_pago.asc()).all()
    return jsonify({'pagos': [_pago_cartera_to_dict(pg) for pg in pagos]}), 200


# ---------------------------------------------------------------------------
# POST /api/comercial/prefacturas/<id>/cartera  — registrar pago/anticipo
# ---------------------------------------------------------------------------
_TIPOS_MOVIMIENTO_CARTERA  = {'PAGO_FACTURA', 'ANTICIPO', 'ABONO', 'NOTA_CREDITO'}
_MEDIOS_PAGO_CARTERA       = {'EFECTIVO', 'TRANSFERENCIA', 'CHEQUE'}
_ESTADOS_CARTERA           = {'APLICADO', 'PENDIENTE', 'ANULADO'}


@comercial_bp.route('/prefacturas/<int:pref_id>/cartera', methods=['POST'])
@login_required
def registrar_pago_cartera(pref_id):
    try:
        _require_commercial_permission(PERMISO_CARGUE_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    pref = PrefacturaComercial.query.get_or_404(pref_id)
    data = request.get_json() or {}

    tipo = str(data.get('tipo_movimiento') or 'PAGO_FACTURA').strip().upper()
    if tipo not in _TIPOS_MOVIMIENTO_CARTERA:
        return jsonify({'error': f'tipo_movimiento debe ser: {", ".join(_TIPOS_MOVIMIENTO_CARTERA)}'}), 400

    fecha_str = (data.get('fecha_pago') or '').strip()
    if not fecha_str:
        return jsonify({'error': 'La fecha de pago es obligatoria'}), 400
    try:
        fecha_pago = datetime.strptime(fecha_str, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': 'Formato de fecha_pago inválido (YYYY-MM-DD)'}), 400

    try:
        from decimal import Decimal as _Dec
        valor_pago = _Dec(str(data.get('valor_pago') or 0))
        if valor_pago <= 0:
            raise ValueError
    except (ValueError, Exception):
        return jsonify({'error': 'valor_pago debe ser un número mayor que cero'}), 400

    medio = str(data.get('medio_pago') or 'EFECTIVO').strip().upper()
    if medio not in _MEDIOS_PAGO_CARTERA:
        medio = 'EFECTIVO'

    pg = CarteraPrefactura(
        prefactura_id   = pref.id,
        tipo_movimiento = tipo,
        fecha_pago      = fecha_pago,
        valor_pago      = valor_pago,
        medio_pago      = medio,
        nro_comprobante = (data.get('nro_comprobante') or '').strip() or None,
        estado          = 'APLICADO',
        observaciones   = (data.get('observaciones') or '').strip() or None,
        usuario_id      = current_user.id,
    )
    db.session.add(pg)

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({'error': 'No se pudo registrar el pago'}), 500

    return jsonify({'pago': _pago_cartera_to_dict(pg)}), 201


# ---------------------------------------------------------------------------
# PUT /api/comercial/cartera/<id>  — editar pago de cartera
# ---------------------------------------------------------------------------
@comercial_bp.route('/cartera/<int:pago_id>', methods=['PUT'])
@login_required
def actualizar_pago_cartera(pago_id):
    try:
        _require_commercial_permission(PERMISO_CARGUE_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    pg   = CarteraPrefactura.query.get_or_404(pago_id)
    data = request.get_json() or {}

    if 'fecha_pago' in data and data['fecha_pago']:
        try:
            pg.fecha_pago = datetime.strptime(str(data['fecha_pago']).strip(), '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Formato de fecha_pago inválido'}), 400

    if 'valor_pago' in data:
        try:
            from decimal import Decimal as _Dec
            v = _Dec(str(data['valor_pago']))
            if v <= 0:
                raise ValueError
            pg.valor_pago = v
        except Exception:
            return jsonify({'error': 'valor_pago inválido'}), 400

    if 'medio_pago' in data:
        medio = str(data['medio_pago'] or '').strip().upper()
        if medio in _MEDIOS_PAGO_CARTERA:
            pg.medio_pago = medio

    if 'nro_comprobante' in data:
        pg.nro_comprobante = (data['nro_comprobante'] or '').strip() or None

    if 'estado' in data:
        est = str(data['estado'] or '').strip().upper()
        if est in _ESTADOS_CARTERA:
            pg.estado = est

    if 'observaciones' in data:
        pg.observaciones = (data['observaciones'] or '').strip() or None

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({'error': 'No se pudo actualizar el pago'}), 500

    return jsonify({'pago': _pago_cartera_to_dict(pg)}), 200


# ---------------------------------------------------------------------------
# DELETE /api/comercial/cartera/<id>  — anular pago de cartera
# ---------------------------------------------------------------------------
@comercial_bp.route('/cartera/<int:pago_id>', methods=['DELETE'])
@login_required
def anular_pago_cartera(pago_id):
    try:
        _require_commercial_permission(PERMISO_CARGUE_ATENCIONES)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403

    pg = CarteraPrefactura.query.get_or_404(pago_id)
    pg.estado = 'ANULADO'

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({'error': 'No se pudo anular el pago'}), 500

    return jsonify({'pago': _pago_cartera_to_dict(pg)}), 200
