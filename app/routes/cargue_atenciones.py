"""Endpoints para cargue diario de atenciones desde Excel."""
import io
import logging
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

from flask import jsonify, request
from flask_login import current_user, login_required

from app.models import AtencionDiaDetalle, CargueAtencionDia, db
from app.routes import comercial_bp

logger = logging.getLogger(__name__)

COLUMNAS_ESPERADAS = [
    'N°. Orden Servicio',
    'N°. Factura',
    'Fecha de Factura',
    'Precio',
    'FormaPago',
    'Nombre del Producto o Servicio',
    'N°. de Identificación',
    'Nombre del Paciente',
    'Nombre del Acuerdo Comercial',
    'Empresa en Misión',
    'Sede',
    'Nombre del Vendedor',
    'Fecha de Creación Orden Servicio',
    'Usuario de Creación Orden Servicio',
    'Estado de la Orden Servicio',
    'Fecha de Anulación Orden Servicio',
]

_FECHA_RE = re.compile(
    r'(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})'
)


def _parse_fecha(valor):
    """Parsea fechas en formato dd/mm/yyyy hh:mm a./p. m."""
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor
    texto = str(valor).replace('\xa0', ' ').strip()
    m = _FECHA_RE.search(texto)
    if not m:
        return None
    dia, mes, anio, hora, minuto = (int(x) for x in m.groups())
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
    try:
        return Decimal(str(valor).replace(',', '.').strip())
    except InvalidOperation:
        return None


def _normalizar(valor):
    if valor is None:
        return None
    return str(valor).strip() or None


@comercial_bp.route('/cargue-atenciones', methods=['POST'])
@login_required
def cargar_atenciones_dia():
    """Recibe un archivo Excel y carga las atenciones del día."""
    try:
        import openpyxl
    except ImportError:
        return jsonify({'error': 'El servidor no tiene openpyxl instalado. Ejecute: pip install openpyxl'}), 500

    if 'archivo' not in request.files:
        return jsonify({'error': 'No se envió ningún archivo'}), 400

    archivo = request.files['archivo']
    nombre = archivo.filename or 'sin_nombre.xlsx'

    if not nombre.lower().endswith(('.xlsx', '.xls')):
        return jsonify({'error': 'Solo se aceptan archivos Excel (.xlsx o .xls)'}), 400

    try:
        contenido = archivo.read()
        wb = openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
        ws = wb.active
        filas = list(ws.iter_rows(values_only=True))
    except Exception as exc:
        logger.error("Error leyendo Excel de atenciones: %s", exc)
        return jsonify({'error': f'No se pudo leer el archivo: {exc}'}), 400

    if not filas:
        return jsonify({'error': 'El archivo está vacío'}), 400

    # Validar encabezados mínimos
    encabezados = [str(v).strip() if v else '' for v in filas[0]]
    for col_esperada in COLUMNAS_ESPERADAS[:9]:  # mínimo las primeras 9
        if col_esperada not in encabezados:
            return jsonify({
                'error': f'Columna requerida no encontrada: "{col_esperada}". '
                         f'Verifique que el archivo tenga el formato correcto.'
            }), 400

    # Mapear índices por nombre de columna
    idx = {nombre: i for i, nombre in enumerate(encabezados) if nombre}

    def get(row, col, default=None):
        i = idx.get(col)
        return row[i] if i is not None and i < len(row) else default

    # Construir set de duplicados existentes (orden+servicio+paciente)
    existentes = set(
        db.session.query(
            AtencionDiaDetalle.nro_orden,
            AtencionDiaDetalle.servicio,
            AtencionDiaDetalle.nro_identificacion,
        ).all()
    )

    cargue = CargueAtencionDia(
        nombre_archivo=nombre,
        total_filas=len(filas) - 1,
        usuario_id=current_user.id,
    )
    db.session.add(cargue)
    db.session.flush()

    importadas = 0
    duplicadas = 0
    errores = 0

    for fila in filas[1:]:
        if all(v is None for v in fila):
            continue
        try:
            nro_orden = _normalizar(get(fila, 'N°. Orden Servicio'))
            servicio = _normalizar(get(fila, 'Nombre del Producto o Servicio'))
            nro_id = _normalizar(get(fila, 'N°. de Identificación'))

            clave = (nro_orden, servicio, nro_id)
            if clave in existentes:
                duplicadas += 1
                continue

            detalle = AtencionDiaDetalle(
                cargue_id=cargue.id,
                nro_orden=nro_orden,
                nro_factura=_normalizar(get(fila, 'N°. Factura')),
                fecha_factura=_parse_fecha(get(fila, 'Fecha de Factura')),
                precio=_parse_precio(get(fila, 'Precio')),
                forma_pago=_normalizar(get(fila, 'FormaPago')),
                servicio=servicio,
                nro_identificacion=nro_id,
                nombre_paciente=_normalizar(get(fila, 'Nombre del Paciente')),
                acuerdo_comercial=_normalizar(get(fila, 'Nombre del Acuerdo Comercial')),
                empresa_mision=_normalizar(get(fila, 'Empresa en Misión')),
                sede=_normalizar(get(fila, 'Sede')),
                nombre_vendedor=_normalizar(get(fila, 'Nombre del Vendedor')),
                fecha_creacion_orden=_parse_fecha(get(fila, 'Fecha de Creación Orden Servicio')),
                usuario_creacion=_normalizar(get(fila, 'Usuario de Creación Orden Servicio')),
                estado_orden=_normalizar(get(fila, 'Estado de la Orden Servicio')),
                fecha_anulacion=_parse_fecha(get(fila, 'Fecha de Anulación Orden Servicio')),
                archivo_origen=_normalizar(get(fila, '_archivo_origen')),
            )
            db.session.add(detalle)
            existentes.add(clave)
            importadas += 1

        except Exception as exc:
            logger.warning("Error procesando fila de atenciones: %s", exc)
            errores += 1

    cargue.filas_importadas = importadas
    cargue.filas_duplicadas = duplicadas
    cargue.filas_error = errores

    db.session.commit()
    logger.info(
        "Cargue atenciones: archivo=%s importadas=%d duplicadas=%d errores=%d",
        nombre, importadas, duplicadas, errores,
    )

    return jsonify({
        'mensaje': 'Cargue completado',
        'nombre_archivo': nombre,
        'total_filas': cargue.total_filas,
        'importadas': importadas,
        'duplicadas': duplicadas,
        'errores': errores,
    }), 201


@comercial_bp.route('/cargue-atenciones/historial', methods=['GET'])
@login_required
def historial_cargues_atenciones():
    """Últimos 20 cargues realizados."""
    cargues = CargueAtencionDia.query.order_by(
        CargueAtencionDia.created_at.desc()
    ).limit(20).all()
    return jsonify([{
        'id': c.id,
        'nombre_archivo': c.nombre_archivo,
        'total_filas': c.total_filas,
        'importadas': c.filas_importadas,
        'duplicadas': c.filas_duplicadas,
        'errores': c.filas_error,
        'usuario': c.usuario.usuario if c.usuario else 'Sistema',
        'fecha': c.created_at.strftime('%Y-%m-%d %H:%M') if c.created_at else None,
    } for c in cargues]), 200


@comercial_bp.route('/cargue-atenciones/consulta', methods=['GET'])
@login_required
def consultar_atenciones_dia():
    """Consulta de atenciones con filtros: acuerdo, vendedor, estado, fecha_desde, fecha_hasta."""
    acuerdo = request.args.get('acuerdo', '').strip()
    vendedor = request.args.get('vendedor', '').strip()
    estado = request.args.get('estado', '').strip()
    fecha_desde = request.args.get('fecha_desde', '').strip()
    fecha_hasta = request.args.get('fecha_hasta', '').strip()
    page = max(1, int(request.args.get('page', 1)))
    per_page = min(200, max(10, int(request.args.get('per_page', 50))))

    q = AtencionDiaDetalle.query

    if acuerdo:
        q = q.filter(AtencionDiaDetalle.acuerdo_comercial.ilike(f'%{acuerdo}%'))
    if vendedor:
        q = q.filter(AtencionDiaDetalle.nombre_vendedor.ilike(f'%{vendedor}%'))
    if estado:
        q = q.filter(AtencionDiaDetalle.estado_orden == estado.upper())
    if fecha_desde:
        try:
            q = q.filter(AtencionDiaDetalle.fecha_creacion_orden >= datetime.strptime(fecha_desde, '%Y-%m-%d'))
        except ValueError:
            pass
    if fecha_hasta:
        try:
            q = q.filter(AtencionDiaDetalle.fecha_creacion_orden <= datetime.strptime(fecha_hasta + ' 23:59:59', '%Y-%m-%d %H:%M:%S'))
        except ValueError:
            pass

    total = q.count()
    registros = q.order_by(
        AtencionDiaDetalle.fecha_creacion_orden.desc(),
        AtencionDiaDetalle.nro_orden,
    ).offset((page - 1) * per_page).limit(per_page).all()

    return jsonify({
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': (total + per_page - 1) // per_page,
        'registros': [{
            'id': r.id,
            'nro_orden': r.nro_orden,
            'nro_factura': r.nro_factura,
            'fecha_factura': r.fecha_factura.strftime('%Y-%m-%d') if r.fecha_factura else None,
            'precio': float(r.precio) if r.precio else 0,
            'forma_pago': r.forma_pago,
            'servicio': r.servicio,
            'nro_identificacion': r.nro_identificacion,
            'nombre_paciente': r.nombre_paciente,
            'acuerdo_comercial': r.acuerdo_comercial,
            'empresa_mision': r.empresa_mision,
            'sede': r.sede,
            'nombre_vendedor': r.nombre_vendedor,
            'fecha_creacion_orden': r.fecha_creacion_orden.strftime('%Y-%m-%d %H:%M') if r.fecha_creacion_orden else None,
            'usuario_creacion': r.usuario_creacion,
            'estado_orden': r.estado_orden,
            'fecha_anulacion': r.fecha_anulacion.strftime('%Y-%m-%d') if r.fecha_anulacion else None,
        } for r in registros],
    }), 200
