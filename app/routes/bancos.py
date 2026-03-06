from flask import jsonify, request
from app.routes import bancos_bp
from app.models import db, PrestamoEmpresa, PrestamoNovedad, PrestamoPago
from flask_login import login_required
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


def _parse_date(value):
    """Parsear fechas en formato 'YYYY-MM-DD' o ISO; devolver None si vacío o inválido."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        # Aceptar fecha con o sin tiempo
        if 'T' in value:
            return datetime.fromisoformat(value)
        return datetime.strptime(value, '%Y-%m-%d')
    except Exception:
        try:
            return datetime.fromisoformat(value)
        except Exception:
            return None


# ==================== ENCABEZADOS / PRÉSTAMOS ====================


@bancos_bp.route('/prestamos', methods=['GET'])
@login_required
def list_prestamos_empresa():
    """Listar préstamos de la empresa (encabezados).

    Opcionales:
      - activos=true/false
    """
    try:
        activos = request.args.get('activos')
        query = PrestamoEmpresa.query
        if activos is not None:
            flag = activos.lower() == 'true'
            query = query.filter_by(activo=flag)

        prestamos = query.order_by(PrestamoEmpresa.fecha_inicio.desc()).all()
        data = []
        for p in prestamos:
            data.append({
                'id': p.id,
                'nombre': p.nombre,
                'tipo_prestatario': p.tipo_prestatario,
                'fecha_inicio': p.fecha_inicio.strftime('%Y-%m-%d') if p.fecha_inicio else None,
                'fecha_final': p.fecha_final.strftime('%Y-%m-%d') if p.fecha_final else None,
                'cantidad_cuotas': p.cantidad_cuotas,
                'valor_prestamo': float(p.valor_prestamo or 0),
                'porcentaje_interes': float(p.porcentaje_interes or 0) if p.porcentaje_interes is not None else None,
                'valor_cuota': float(p.valor_cuota or 0) if p.valor_cuota is not None else None,
                'dia_pago': p.dia_pago,
                'modalidad_pago': p.modalidad_pago,
                'frecuencia_cadena': p.frecuencia_cadena,
                'fecha_recibe_cadena': p.fecha_recibe_cadena.strftime('%Y-%m-%d') if p.fecha_recibe_cadena else None,
                'activo': p.activo,
            })
        return jsonify({'total': len(data), 'data': data}), 200
    except Exception:
        logger.exception('Error listando préstamos de empresa')
        return jsonify({'error': 'Error al listar préstamos'}), 500


@bancos_bp.route('/prestamos', methods=['POST'])
@login_required
def create_prestamo_empresa():
    payload = request.get_json() or {}
    try:
        p = PrestamoEmpresa(
            nombre=payload.get('nombre'),
            tipo_prestatario=payload.get('tipo_prestatario'),
            fecha_inicio=_parse_date(payload.get('fecha_inicio')) or datetime.utcnow(),
            fecha_final=_parse_date(payload.get('fecha_final')),
            cantidad_cuotas=payload.get('cantidad_cuotas'),
            valor_prestamo=payload.get('valor_prestamo') or 0,
            porcentaje_interes=payload.get('porcentaje_interes'),
            valor_cuota=payload.get('valor_cuota'),
            dia_pago=payload.get('dia_pago'),
            modalidad_pago=payload.get('modalidad_pago') or 'BANCARIO',
            frecuencia_cadena=payload.get('frecuencia_cadena'),
            fecha_recibe_cadena=_parse_date(payload.get('fecha_recibe_cadena')),
            activo=True,
        )
        db.session.add(p)
        db.session.commit()
        return jsonify({'id': p.id}), 201
    except Exception:
        db.session.rollback()
        logger.exception('Error creando préstamo de empresa')
        return jsonify({'error': 'Error al crear préstamo'}), 500


@bancos_bp.route('/prestamos/<int:prestamo_id>', methods=['GET'])
@login_required
def get_prestamo_empresa(prestamo_id):
    try:
        p = PrestamoEmpresa.query.get_or_404(prestamo_id)
        data = {
            'id': p.id,
            'nombre': p.nombre,
            'tipo_prestatario': p.tipo_prestatario,
            'fecha_inicio': p.fecha_inicio.strftime('%Y-%m-%d') if p.fecha_inicio else None,
            'fecha_final': p.fecha_final.strftime('%Y-%m-%d') if p.fecha_final else None,
            'cantidad_cuotas': p.cantidad_cuotas,
            'valor_prestamo': float(p.valor_prestamo or 0),
            'porcentaje_interes': float(p.porcentaje_interes or 0) if p.porcentaje_interes is not None else None,
            'valor_cuota': float(p.valor_cuota or 0) if p.valor_cuota is not None else None,
            'dia_pago': p.dia_pago,
            'modalidad_pago': p.modalidad_pago,
            'frecuencia_cadena': p.frecuencia_cadena,
            'fecha_recibe_cadena': p.fecha_recibe_cadena.strftime('%Y-%m-%d') if p.fecha_recibe_cadena else None,
            'activo': p.activo,
        }
        return jsonify(data), 200
    except Exception:
        logger.exception('Error obteniendo préstamo %s', prestamo_id)
        return jsonify({'error': 'Préstamo no encontrado'}), 404


@bancos_bp.route('/prestamos/<int:prestamo_id>', methods=['PUT'])
@login_required
def update_prestamo_empresa(prestamo_id):
    payload = request.get_json() or {}
    try:
        p = PrestamoEmpresa.query.get_or_404(prestamo_id)
        p.nombre = payload.get('nombre', p.nombre)
        p.tipo_prestatario = payload.get('tipo_prestatario', p.tipo_prestatario)
        if 'fecha_inicio' in payload:
            p.fecha_inicio = _parse_date(payload.get('fecha_inicio')) or p.fecha_inicio
        if 'fecha_final' in payload:
            p.fecha_final = _parse_date(payload.get('fecha_final'))
        if 'cantidad_cuotas' in payload:
            p.cantidad_cuotas = payload.get('cantidad_cuotas')
        if 'valor_prestamo' in payload:
            p.valor_prestamo = payload.get('valor_prestamo')
        if 'porcentaje_interes' in payload:
            p.porcentaje_interes = payload.get('porcentaje_interes')
        if 'valor_cuota' in payload:
            p.valor_cuota = payload.get('valor_cuota')
        if 'dia_pago' in payload:
            p.dia_pago = payload.get('dia_pago')
        if 'modalidad_pago' in payload:
            p.modalidad_pago = payload.get('modalidad_pago') or p.modalidad_pago
        if 'frecuencia_cadena' in payload:
            p.frecuencia_cadena = payload.get('frecuencia_cadena')
        if 'fecha_recibe_cadena' in payload:
            p.fecha_recibe_cadena = _parse_date(payload.get('fecha_recibe_cadena'))
        if 'activo' in payload:
            p.activo = bool(payload.get('activo'))
        db.session.commit()
        return jsonify({'id': p.id}), 200
    except Exception:
        db.session.rollback()
        logger.exception('Error actualizando préstamo %s', prestamo_id)
        return jsonify({'error': 'Error al actualizar préstamo'}), 500


@bancos_bp.route('/prestamos/<int:prestamo_id>', methods=['DELETE'])
@login_required
def delete_prestamo_empresa(prestamo_id):
    """Desactivar lógicamente un préstamo de empresa."""
    try:
        p = PrestamoEmpresa.query.get_or_404(prestamo_id)
        p.activo = False
        db.session.commit()
        return jsonify({'id': prestamo_id, 'activo': False}), 200
    except Exception:
        db.session.rollback()
        logger.exception('Error desactivando préstamo %s', prestamo_id)
        return jsonify({'error': 'Error al desactivar préstamo'}), 500


# ==================== NOVEDADES ====================


@bancos_bp.route('/prestamos/<int:prestamo_id>/novedades', methods=['GET'])
@login_required
def list_prestamo_novedades(prestamo_id):
    try:
        novedades = PrestamoNovedad.query.filter_by(prestamo_id=prestamo_id).order_by(PrestamoNovedad.fecha_limite_pago.asc()).all()
        data = []
        for n in novedades:
            data.append({
                'id': n.id,
                'prestamo_id': n.prestamo_id,
                'valor_a_pagar': float(n.valor_a_pagar or 0),
                'fecha_limite_pago': n.fecha_limite_pago.strftime('%Y-%m-%d') if n.fecha_limite_pago else None,
                'descripcion': n.descripcion,
                'cumplida': n.cumplida,
            })
        return jsonify({'total': len(data), 'data': data}), 200
    except Exception:
        logger.exception('Error listando novedades de préstamo %s', prestamo_id)
        return jsonify({'error': 'Error al listar novedades'}), 500


@bancos_bp.route('/prestamos/<int:prestamo_id>/novedades', methods=['POST'])
@login_required
def create_prestamo_novedad(prestamo_id):
    payload = request.get_json() or {}
    try:
        n = PrestamoNovedad(
            prestamo_id=prestamo_id,
            valor_a_pagar=payload.get('valor_a_pagar') or 0,
            fecha_limite_pago=_parse_date(payload.get('fecha_limite_pago')) or datetime.utcnow(),
            descripcion=payload.get('descripcion'),
            cumplida=bool(payload.get('cumplida', False)),
        )
        db.session.add(n)
        db.session.commit()
        return jsonify({'id': n.id}), 201
    except Exception:
        db.session.rollback()
        logger.exception('Error creando novedad para préstamo %s', prestamo_id)
        return jsonify({'error': 'Error al crear novedad'}), 500


@bancos_bp.route('/novedades/<int:novedad_id>', methods=['PUT'])
@login_required
def update_prestamo_novedad(novedad_id):
    payload = request.get_json() or {}
    try:
        n = PrestamoNovedad.query.get_or_404(novedad_id)
        if 'valor_a_pagar' in payload:
            n.valor_a_pagar = payload.get('valor_a_pagar')
        if 'fecha_limite_pago' in payload:
            n.fecha_limite_pago = _parse_date(payload.get('fecha_limite_pago')) or n.fecha_limite_pago
        if 'descripcion' in payload:
            n.descripcion = payload.get('descripcion')
        if 'cumplida' in payload:
            n.cumplida = bool(payload.get('cumplida'))
        db.session.commit()
        return jsonify({'id': n.id}), 200
    except Exception:
        db.session.rollback()
        logger.exception('Error actualizando novedad %s', novedad_id)
        return jsonify({'error': 'Error al actualizar novedad'}), 500


@bancos_bp.route('/novedades/<int:novedad_id>', methods=['DELETE'])
@login_required
def delete_prestamo_novedad(novedad_id):
    try:
        n = PrestamoNovedad.query.get_or_404(novedad_id)
        db.session.delete(n)
        db.session.commit()
        return jsonify({'id': novedad_id}), 200
    except Exception:
        db.session.rollback()
        logger.exception('Error eliminando novedad %s', novedad_id)
        return jsonify({'error': 'Error al eliminar novedad'}), 500


# ==================== PAGOS ====================


@bancos_bp.route('/prestamos/<int:prestamo_id>/pagos', methods=['GET'])
@login_required
def list_prestamo_pagos(prestamo_id):
    try:
        pagos = PrestamoPago.query.filter_by(prestamo_id=prestamo_id).order_by(PrestamoPago.fecha_pago.asc()).all()
        data = []
        for p in pagos:
            data.append({
                'id': p.id,
                'prestamo_id': p.prestamo_id,
                'fecha_pago': p.fecha_pago.strftime('%Y-%m-%d') if p.fecha_pago else None,
                'forma_pago': p.forma_pago,
                'valor_pagado': float(p.valor_pagado or 0),
                'observaciones': p.observaciones,
            })
        return jsonify({'total': len(data), 'data': data}), 200
    except Exception:
        logger.exception('Error listando pagos de préstamo %s', prestamo_id)
        return jsonify({'error': 'Error al listar pagos'}), 500


@bancos_bp.route('/prestamos/<int:prestamo_id>/pagos', methods=['POST'])
@login_required
def create_prestamo_pago(prestamo_id):
    payload = request.get_json() or {}
    try:
        p = PrestamoPago(
            prestamo_id=prestamo_id,
            fecha_pago=_parse_date(payload.get('fecha_pago')) or datetime.utcnow(),
            forma_pago=payload.get('forma_pago'),
            valor_pagado=payload.get('valor_pagado') or 0,
            observaciones=payload.get('observaciones'),
            usuario_registra_id=None,
        )
        db.session.add(p)
        db.session.commit()
        return jsonify({'id': p.id}), 201
    except Exception:
        db.session.rollback()
        logger.exception('Error creando pago para préstamo %s', prestamo_id)
        return jsonify({'error': 'Error al crear pago'}), 500


@bancos_bp.route('/pagos/<int:pago_id>', methods=['PUT'])
@login_required
def update_prestamo_pago(pago_id):
    payload = request.get_json() or {}
    try:
        p = PrestamoPago.query.get_or_404(pago_id)
        if 'fecha_pago' in payload:
            p.fecha_pago = _parse_date(payload.get('fecha_pago')) or p.fecha_pago
        if 'forma_pago' in payload:
            p.forma_pago = payload.get('forma_pago')
        if 'valor_pagado' in payload:
            p.valor_pagado = payload.get('valor_pagado')
        if 'observaciones' in payload:
            p.observaciones = payload.get('observaciones')
        db.session.commit()
        return jsonify({'id': p.id}), 200
    except Exception:
        db.session.rollback()
        logger.exception('Error actualizando pago %s', pago_id)
        return jsonify({'error': 'Error al actualizar pago'}), 500


@bancos_bp.route('/pagos/<int:pago_id>', methods=['DELETE'])
@login_required
def delete_prestamo_pago(pago_id):
    try:
        p = PrestamoPago.query.get_or_404(pago_id)
        db.session.delete(p)
        db.session.commit()
        return jsonify({'id': pago_id}), 200
    except Exception:
        db.session.rollback()
        logger.exception('Error eliminando pago %s', pago_id)
        return jsonify({'error': 'Error al eliminar pago'}), 500


# ==================== HISTORIAL ====================


@bancos_bp.route('/historial', methods=['GET'])
@login_required
def historial_prestamos():
    """Historial de préstamos de la empresa en un rango de meses.

    Parámetros:
      - desde_mes, desde_anio
      - hasta_mes, hasta_anio
      - prestamo_id (opcional)
    """
    try:
        desde_mes = request.args.get('desde_mes', type=int)
        desde_anio = request.args.get('desde_anio', type=int)
        hasta_mes = request.args.get('hasta_mes', type=int)
        hasta_anio = request.args.get('hasta_anio', type=int)
        prestamo_id = request.args.get('prestamo_id', type=int)

        if not (desde_mes and desde_anio and hasta_mes and hasta_anio):
            return jsonify({'error': 'Debe indicar rango de meses'}), 400

        desde = datetime(desde_anio, desde_mes, 1)
        if hasta_mes == 12:
            hasta = datetime(hasta_anio + 1, 1, 1)
        else:
            hasta = datetime(hasta_anio, hasta_mes + 1, 1)

        prestamos_q = PrestamoEmpresa.query
        if prestamo_id:
            prestamos_q = prestamos_q.filter_by(id=prestamo_id)
        prestamos = prestamos_q.all()

        resultados = []
        for p in prestamos:
            pagos_q = PrestamoPago.query.filter(
                PrestamoPago.prestamo_id == p.id,
                PrestamoPago.fecha_pago >= desde,
                PrestamoPago.fecha_pago < hasta,
            )
            pagos = pagos_q.order_by(PrestamoPago.fecha_pago.asc()).all()

            novedades_q = PrestamoNovedad.query.filter(
                PrestamoNovedad.prestamo_id == p.id,
                PrestamoNovedad.fecha_limite_pago >= desde,
                PrestamoNovedad.fecha_limite_pago < hasta,
            )
            novedades = novedades_q.order_by(PrestamoNovedad.fecha_limite_pago.asc()).all()

            total_pagado = sum((pp.valor_pagado or 0) for pp in pagos)
            total_programado = sum((nn.valor_a_pagar or 0) for nn in novedades)

            resultados.append({
                'prestamo': {
                    'id': p.id,
                    'nombre': p.nombre,
                    'valor_prestamo': float(p.valor_prestamo or 0),
                    'porcentaje_interes': float(p.porcentaje_interes or 0) if p.porcentaje_interes is not None else None,
                    'fecha_inicio': p.fecha_inicio.strftime('%Y-%m-%d') if p.fecha_inicio else None,
                    'fecha_final': p.fecha_final.strftime('%Y-%m-%d') if p.fecha_final else None,
                    'cantidad_cuotas': p.cantidad_cuotas,
                    'modalidad_pago': p.modalidad_pago,
                },
                'novedades': [
                    {
                        'id': n.id,
                        'fecha_limite_pago': n.fecha_limite_pago.strftime('%Y-%m-%d') if n.fecha_limite_pago else None,
                        'valor_a_pagar': float(n.valor_a_pagar or 0),
                        'descripcion': n.descripcion,
                        'cumplida': n.cumplida,
                    }
                    for n in novedades
                ],
                'pagos': [
                    {
                        'id': pp.id,
                        'fecha_pago': pp.fecha_pago.strftime('%Y-%m-%d') if pp.fecha_pago else None,
                        'valor_pagado': float(pp.valor_pagado or 0),
                        'forma_pago': pp.forma_pago,
                        'observaciones': pp.observaciones,
                    }
                    for pp in pagos
                ],
                'totales': {
                    'total_programado': float(total_programado),
                    'total_pagado': float(total_pagado),
                },
            })

        return jsonify(resultados), 200
    except Exception:
        logger.exception('Error consultando historial de préstamos')
        return jsonify({'error': 'Error al consultar historial de préstamos'}), 500
