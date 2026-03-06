from flask import jsonify, request
from app.routes import servicios_bp
from app.models import db, Servicio, ServicioNovedad, ServicioPago, ServicioPeriodo
from flask_login import login_required
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


def _fmt_date(d):
    try:
        return d.strftime('%Y-%m-%d') if d else None
    except Exception:
        return None


def _parse_date(s):
    if not s:
        return None
    try:
        # Accept date-only or full ISO
        if 'T' in s:
            return datetime.fromisoformat(s)
        return datetime.strptime(s, '%Y-%m-%d')
    except Exception:
        try:
            return datetime.fromisoformat(s)
        except Exception:
            return None


def _calcular_siguiente_mes_anio(mes: int, anio: int):
    """Calcular el mes/año siguiente dado un mes/año actual."""
    if mes == 12:
        return 1, anio + 1
    return mes + 1, anio


def _obtener_periodo_en_proceso():
    """Obtener o inicializar el periodo de servicios actualmente en proceso.

    Regla:
      - Si existe un registro con en_proceso=True, se devuelve ese.
      - Si no existe ninguno:
          * Si hay periodos finalizados, se crea/marca en_proceso el mes
            siguiente al último finalizado.
          * Si no hay registros, se crea un periodo inicial en enero del
            año actual.
    """
    ahora = datetime.utcnow()

    actual = (
        ServicioPeriodo.query
        .filter_by(en_proceso=True)
        .order_by(ServicioPeriodo.anio.desc(), ServicioPeriodo.mes.desc())
        .first()
    )
    if actual:
        return actual

    # No hay periodo en proceso: buscar el último finalizado
    ultimo_finalizado = (
        ServicioPeriodo.query
        .filter_by(finalizado=True)
        .order_by(ServicioPeriodo.anio.desc(), ServicioPeriodo.mes.desc())
        .first()
    )

    if ultimo_finalizado:
        sig_mes, sig_anio = _calcular_siguiente_mes_anio(ultimo_finalizado.mes, ultimo_finalizado.anio)
    else:
        # Sin registros previos: arrancar en enero del año actual
        sig_mes, sig_anio = 1, ahora.year

    # Crear o reutilizar registro para el periodo sugerido y marcarlo en proceso
    periodo = (
        ServicioPeriodo.query
        .filter_by(mes=sig_mes, anio=sig_anio)
        .first()
    )
    if not periodo:
        periodo = ServicioPeriodo(
            mes=sig_mes,
            anio=sig_anio,
            en_proceso=True,
            finalizado=False,
            fecha_inicio=ahora
        )
        db.session.add(periodo)
    else:
        periodo.en_proceso = True
        periodo.finalizado = False
        if not periodo.fecha_inicio:
            periodo.fecha_inicio = ahora

    # Asegurar que los demás periodos no queden marcados como en_proceso
    ServicioPeriodo.query.filter(ServicioPeriodo.id != periodo.id).update({"en_proceso": False}, synchronize_session=False)
    db.session.commit()

    return periodo


@servicios_bp.route('/list', methods=['GET'])
@login_required
def list_servicios():
    """Listar servicios activos (respuesta estandarizada)."""
    try:
        servicios = Servicio.query.filter_by(activo=True).order_by(Servicio.nombre).all()

        # Filtro opcional por mes liquidado: devuelve solo los servicios que
        # deben pagarse en ese mes según modalidad_pago_meses y mes_inicio_pago.
        mes_liquidado = request.args.get('mes_liquidado', type=int)
        if mes_liquidado:
            def debe_pagarse_en_mes(s):
                try:
                    periodo = int(s.modalidad_pago_meses or 1)
                    mes_inicio = int(s.mes_inicio_pago or 1)
                except Exception:
                    return True

                if periodo <= 0:
                    return True
                if not (1 <= mes_inicio <= 12) or not (1 <= mes_liquidado <= 12):
                    return True

                # Patrón cíclico: se paga cuando la diferencia de meses es múltiplo del periodo
                return ((mes_liquidado - mes_inicio) % periodo) == 0

            servicios = [s for s in servicios if debe_pagarse_en_mes(s)]
        data = [{
            'id': s.id,
            'nombre': s.nombre,
            'referencia_pago': s.referencia_pago,
            'dia_pago': s.dia_pago,
            'valor_aproximado': float(s.valor_aproximado or 0),
            'modalidad_pago_meses': s.modalidad_pago_meses,
            'mes_inicio_pago': s.mes_inicio_pago
        } for s in servicios]
        return jsonify({'total': len(data), 'data': data}), 200
    except Exception as e:
        logger.exception('Error listando servicios')
        return jsonify({'error': 'Error al listar servicios'}), 500


@servicios_bp.route('/periodo-actual', methods=['GET'])
@login_required
def periodo_actual_servicios():
    """Obtener el periodo (mes/año) actual del módulo de servicios.

    Reglas:
      - Si hay un periodo marcado como en_proceso, se devuelve ese.
      - Si no hay ninguno en_proceso pero hay periodos finalizados, se
        inicializa y devuelve el mes siguiente al último finalizado.
      - Si no existen registros, se crea enero del año actual como
        periodo inicial en proceso.
    """
    try:
        periodo = _obtener_periodo_en_proceso()
        if not periodo:
            # Fallback muy defensivo: enero del año actual sin tocar DB
            ahora = datetime.utcnow()
            return jsonify({
                'mes': 1,
                'anio': ahora.year,
                'estado': 'INICIAL_SIN_DB'
            }), 200

        return jsonify({
            'mes': periodo.mes,
            'anio': periodo.anio,
            'estado': 'EN_PROCESO'
        }), 200
    except Exception:
        logger.exception('Error obteniendo periodo actual de servicios')
        return jsonify({'error': 'Error al obtener periodo actual de servicios'}), 500


def _debe_pagarse_en_mes(servicio, mes_liquidado: int) -> bool:
    """Determina si un servicio debe pagarse en el mes dado según su modalidad.

    Reutiliza la misma regla que list_servicios para mantener consistencia.
    """
    try:
        periodo = int(servicio.modalidad_pago_meses or 1)
        mes_inicio = int(servicio.mes_inicio_pago or 1)
    except Exception:
        return True

    if periodo <= 0:
        return True
    if not (1 <= mes_inicio <= 12) or not (1 <= mes_liquidado <= 12):
        return True

    return ((mes_liquidado - mes_inicio) % periodo) == 0


@servicios_bp.route('/<int:servicio_id>', methods=['GET'])
@login_required
def get_servicio(servicio_id):
    try:
        s = Servicio.query.get_or_404(servicio_id)
        payload = {
            'id': s.id,
            'nombre': s.nombre,
            'referencia_pago': s.referencia_pago,
            'dia_pago': s.dia_pago,
            'valor_aproximado': float(s.valor_aproximado or 0),
            'modalidad_pago_meses': s.modalidad_pago_meses,
            'mes_inicio_pago': s.mes_inicio_pago,
            'activo': s.activo
        }
        return jsonify({'total': 1, 'data': payload}), 200
    except Exception as e:
        logger.exception('Error obteniendo servicio %s', servicio_id)
        return jsonify({'error': 'Servicio no encontrado'}), 404


@servicios_bp.route('/<int:servicio_id>', methods=['PUT'])
@login_required
def update_servicio(servicio_id):
    payload = request.get_json() or {}
    try:
        s = Servicio.query.get_or_404(servicio_id)
        s.nombre = payload.get('nombre', s.nombre)
        s.referencia_pago = payload.get('referencia_pago', s.referencia_pago)
        s.dia_pago = payload.get('dia_pago', s.dia_pago)
        s.valor_aproximado = payload.get('valor_aproximado', s.valor_aproximado)
        if 'modalidad_pago_meses' in payload:
            s.modalidad_pago_meses = payload.get('modalidad_pago_meses') or s.modalidad_pago_meses
        if 'mes_inicio_pago' in payload:
            s.mes_inicio_pago = payload.get('mes_inicio_pago') or s.mes_inicio_pago
        s.activo = payload.get('activo', s.activo)
        db.session.commit()
        return jsonify({'total': 1, 'data': {'id': s.id}}), 200
    except Exception as e:
        db.session.rollback()
        logger.exception('Error actualizando servicio %s', servicio_id)
        return jsonify({'error': 'Error al actualizar servicio'}), 500


@servicios_bp.route('/<int:servicio_id>', methods=['DELETE'])
@login_required
def delete_servicio(servicio_id):
    try:
        s = Servicio.query.get_or_404(servicio_id)
        db.session.delete(s)
        db.session.commit()
        return jsonify({'total': 1, 'data': {'id': servicio_id}}), 200
    except Exception as e:
        db.session.rollback()
        logger.exception('Error eliminando servicio %s', servicio_id)
        return jsonify({'error': 'Error al eliminar servicio'}), 500


@servicios_bp.route('/create', methods=['POST'])
@login_required
def create_servicio():
    payload = request.get_json() or {}
    nombre = payload.get('nombre')
    if not nombre:
        return jsonify({'error': 'El campo nombre es obligatorio'}), 400

    try:
        servicio = Servicio(
            nombre=nombre,
            referencia_pago=payload.get('referencia_pago'),
            dia_pago=payload.get('dia_pago'),
            valor_aproximado=payload.get('valor_aproximado') or 0,
            modalidad_pago_meses=payload.get('modalidad_pago_meses') or 1,
            mes_inicio_pago=payload.get('mes_inicio_pago')
        )
        db.session.add(servicio)
        db.session.commit()
        return jsonify({'total': 1, 'data': {'id': servicio.id}}), 201
    except Exception as e:
        db.session.rollback()
        logger.exception('Error creando servicio')
        return jsonify({'error': 'Error al crear servicio'}), 500


@servicios_bp.route('/novedades', methods=['POST'])
@login_required
def create_novedad():
    payload = request.get_json() or {}
    servicio_id = payload.get('servicio_id')
    try:
        valor_real = float(payload.get('valor_real', 0))
    except Exception:
        return jsonify({'error': 'valor_real inválido'}), 400

    fecha_recibo_dt = _parse_date(payload.get('fecha_recibo')) or datetime.utcnow()
    fecha_limite_dt = _parse_date(payload.get('fecha_limite_primer_pago'))
    fecha_corte_dt = _parse_date(payload.get('fecha_corte'))

    try:
        nov = ServicioNovedad(
            servicio_id=servicio_id,
            valor_real=valor_real,
            fecha_recibo=fecha_recibo_dt,
            fecha_limite_primer_pago=fecha_limite_dt,
            fecha_corte=fecha_corte_dt,
            referencia=payload.get('referencia'),
            descripcion=payload.get('descripcion')
        )
        db.session.add(nov)
        db.session.commit()
        return jsonify({'total': 1, 'data': {'id': nov.id}}), 201
    except Exception as e:
        db.session.rollback()
        logger.exception('Error creando novedad de servicio')
        return jsonify({'error': 'Error al crear novedad'}), 500


@servicios_bp.route('/novedades/list', methods=['GET'])
@login_required
def list_novedades():
    try:
        q = ServicioNovedad.query.order_by(ServicioNovedad.fecha_recibo.desc())
        servicio_id = request.args.get('servicio_id')
        if servicio_id:
            q = q.filter_by(servicio_id=servicio_id)
        items = [{
            'id': n.id,
            'servicio_id': n.servicio_id,
            'valor_real': float(n.valor_real),
            'fecha_recibo': _fmt_date(n.fecha_recibo),
            'fecha_limite_primer_pago': _fmt_date(n.fecha_limite_primer_pago),
            'fecha_corte': _fmt_date(n.fecha_corte),
            'referencia': n.referencia,
            'descripcion': n.descripcion
        } for n in q.all()]
        return jsonify({'total': len(items), 'data': items}), 200
    except Exception as e:
        logger.exception('Error listando novedades')
        return jsonify({'error': 'Error al listar novedades'}), 500


@servicios_bp.route('/novedades/por-mes', methods=['GET'])
@login_required
def novedades_por_mes():
    """Listar novedades de servicios por mes/año, con estado de pago estimado.

    Params:
      - mes: 1-12 (obligatorio)
      - anio: año numérico (obligatorio)
      - servicio_id: opcional, filtra por servicio

    Marca cada novedad con 'saldo_pendiente' y 'pagada' en función de los pagos
    acumulados del servicio hasta fin de mes, asumiendo que los pagos aplican
    primero a las novedades más antiguas.
    """
    try:
        mes = int(request.args.get('mes'))
        anio = int(request.args.get('anio'))
    except Exception:
        return jsonify({'error': 'Parámetros mes y anio son obligatorios y deben ser enteros'}), 400

    if not (1 <= mes <= 12):
        return jsonify({'error': 'El mes debe estar entre 1 y 12'}), 400

    servicio_id = request.args.get('servicio_id')

    inicio_mes = datetime(anio, mes, 1)
    if mes == 12:
        fin_mes = datetime(anio + 1, 1, 1)
    else:
        fin_mes = datetime(anio, mes + 1, 1)

    try:
        q_mes = ServicioNovedad.query.filter(
            ServicioNovedad.fecha_recibo >= inicio_mes,
            ServicioNovedad.fecha_recibo < fin_mes
        )
        if servicio_id:
            q_mes = q_mes.filter_by(servicio_id=servicio_id)
        novedades_mes = q_mes.order_by(ServicioNovedad.fecha_recibo).all()
    except Exception:
        logger.exception('Error consultando novedades por mes')
        return jsonify({'error': 'Error al consultar novedades'}), 500

    # Agrupar por servicio y calcular saldo por novedad contra pagos
    novedades_por_servicio = {}
    for n in novedades_mes:
        novedades_por_servicio.setdefault(n.servicio_id, []).append(n)

    resultado = []

    for sid, novedades in novedades_por_servicio.items():
        try:
            # Todas las novedades del servicio hasta fin de mes
            todas_nov = ServicioNovedad.query.filter(
                ServicioNovedad.servicio_id == sid,
                ServicioNovedad.fecha_recibo <= fin_mes
            ).order_by(ServicioNovedad.fecha_recibo).all()

            # Todos los pagos del servicio hasta fin de mes
            pagos = ServicioPago.query.filter(
                ServicioPago.servicio_id == sid,
                ServicioPago.fecha_pago <= fin_mes
            ).order_by(ServicioPago.fecha_pago).all()
        except Exception:
            logger.exception('Error consultando historial de pagos/novedades para servicio %s', sid)
            return jsonify({'error': 'Error al calcular saldos de novedades'}), 500

        # Distribuir pagos sobre novedades (primero las más antiguas)
        remaining_pago = sum(float(p.valor_pagado or 0) for p in pagos)
        saldos_por_id = {}
        for n in todas_nov:
            valor = float(n.valor_real or 0)
            aplicado = min(valor, remaining_pago)
            saldo = valor - aplicado
            remaining_pago -= aplicado
            saldos_por_id[n.id] = saldo

        # Construir respuesta solo para las novedades del mes consultado
        for n in novedades:
            saldo = max(0.0, float(saldos_por_id.get(n.id, n.valor_real or 0)))
            pagada = saldo <= 0.01
            resultado.append({
                'id': n.id,
                'servicio_id': n.servicio_id,
                'valor_real': float(n.valor_real or 0),
                'fecha_recibo': _fmt_date(n.fecha_recibo),
                'fecha_limite_primer_pago': _fmt_date(n.fecha_limite_primer_pago),
                'fecha_corte': _fmt_date(n.fecha_corte),
                'referencia': n.referencia,
                'descripcion': n.descripcion,
                'saldo_pendiente': round(saldo, 2),
                'pagada': pagada
            })

    # Ordenar por fecha y servicio para una vista más clara
    resultado.sort(key=lambda x: (x['fecha_recibo'] or '', x['servicio_id'], x['id']))

    return jsonify({'mes': mes, 'anio': anio, 'total': len(resultado), 'data': resultado}), 200


@servicios_bp.route('/novedades/<int:id>', methods=['GET','PUT','DELETE'])
@login_required
def novedad_detail(id):
    if request.method == 'GET':
        try:
            n = ServicioNovedad.query.get_or_404(id)
            item = {
                'id': n.id,
                'servicio_id': n.servicio_id,
                'valor_real': float(n.valor_real),
                'fecha_recibo': _fmt_date(n.fecha_recibo),
                'fecha_limite_primer_pago': _fmt_date(n.fecha_limite_primer_pago),
                'fecha_corte': _fmt_date(n.fecha_corte),
                'referencia': n.referencia,
                'descripcion': n.descripcion
            }
            return jsonify({'total': 1, 'data': item}), 200
        except Exception:
            logger.exception('Error obteniendo novedad %s', id)
            return jsonify({'error': 'Novedad no encontrada'}), 404
    if request.method == 'PUT':
        payload = request.get_json() or {}
        try:
            n = ServicioNovedad.query.get_or_404(id)
            if 'valor_real' in payload:
                n.valor_real = float(payload.get('valor_real', n.valor_real))
            for fld in ('fecha_recibo','fecha_limite_primer_pago','fecha_corte'):
                if payload.get(fld):
                    dt = _parse_date(payload.get(fld))
                    if dt:
                        setattr(n, fld, dt)
            n.referencia = payload.get('referencia', n.referencia)
            n.descripcion = payload.get('descripcion', n.descripcion)
            db.session.commit()
            return jsonify({'total': 1, 'data': {'id': n.id}}), 200
        except Exception:
            db.session.rollback()
            logger.exception('Error actualizando novedad %s', id)
            return jsonify({'error': 'Error al actualizar novedad'}), 500
    if request.method == 'DELETE':
        try:
            n = ServicioNovedad.query.get_or_404(id)
            db.session.delete(n)
            db.session.commit()
            return jsonify({'total': 1, 'data': {'id': id}}), 200
        except Exception:
            db.session.rollback()
            logger.exception('Error eliminando novedad %s', id)
            return jsonify({'error': 'Error al eliminar novedad'}), 500


@servicios_bp.route('/pagos', methods=['POST'])
@login_required
def create_pago():
    payload = request.get_json() or {}
    servicio_id = payload.get('servicio_id')
    try:
        valor_pagado = float(payload.get('valor_pagado', 0))
    except Exception:
        return jsonify({'error': 'valor_pagado inválido'}), 400

    fecha_pago_dt = _parse_date(payload.get('fecha_pago')) or datetime.utcnow()

    try:
        pago = ServicioPago(
            servicio_id=servicio_id,
            fecha_pago=fecha_pago_dt,
            forma_pago=payload.get('forma_pago'),
            valor_pagado=valor_pagado,
            observaciones=payload.get('observaciones')
        )
        db.session.add(pago)
        db.session.commit()
        return jsonify({'total': 1, 'data': {'id': pago.id}}), 201
    except Exception:
        db.session.rollback()
        logger.exception('Error creando pago de servicio')
        return jsonify({'error': 'Error al crear pago'}), 500


@servicios_bp.route('/pagos/list', methods=['GET'])
@login_required
def list_pagos():
    try:
        q = ServicioPago.query.order_by(ServicioPago.fecha_pago.desc())
        servicio_id = request.args.get('servicio_id')
        if servicio_id:
            q = q.filter_by(servicio_id=servicio_id)
        items = [{
            'id': p.id,
            'servicio_id': p.servicio_id,
            'fecha_pago': _fmt_date(p.fecha_pago),
            'forma_pago': p.forma_pago,
            'valor_pagado': float(p.valor_pagado),
            'observaciones': p.observaciones
        } for p in q.all()]
        return jsonify({'total': len(items), 'data': items}), 200
    except Exception:
        logger.exception('Error listando pagos')
        return jsonify({'error': 'Error al listar pagos'}), 500


@servicios_bp.route('/pagos/<int:id>', methods=['GET','PUT','DELETE'])
@login_required
def pago_detail(id):
    if request.method == 'GET':
        try:
            p = ServicioPago.query.get_or_404(id)
            item = {
                'id': p.id,
                'servicio_id': p.servicio_id,
                'fecha_pago': _fmt_date(p.fecha_pago),
                'forma_pago': p.forma_pago,
                'valor_pagado': float(p.valor_pagado),
                'observaciones': p.observaciones
            }
            return jsonify({'total': 1, 'data': item}), 200
        except Exception:
            logger.exception('Pago no encontrado %s', id)
            return jsonify({'error': 'Pago no encontrado'}), 404
    if request.method == 'PUT':
        payload = request.get_json() or {}
        try:
            p = ServicioPago.query.get_or_404(id)
            p.forma_pago = payload.get('forma_pago', p.forma_pago)
            if 'valor_pagado' in payload:
                p.valor_pagado = float(payload.get('valor_pagado', p.valor_pagado))
            if payload.get('fecha_pago'):
                dt = _parse_date(payload.get('fecha_pago'))
                if dt:
                    p.fecha_pago = dt
            p.observaciones = payload.get('observaciones', p.observaciones)
            db.session.commit()
            return jsonify({'total': 1, 'data': {'id': p.id}}), 200
        except Exception:
            db.session.rollback()
            logger.exception('Error actualizando pago %s', id)
            return jsonify({'error': 'Error al actualizar pago'}), 500
    if request.method == 'DELETE':
        try:
            p = ServicioPago.query.get_or_404(id)
            db.session.delete(p)
            db.session.commit()
            return jsonify({'total': 1, 'data': {'id': id}}), 200
        except Exception:
            db.session.rollback()
            logger.exception('Error eliminando pago %s', id)
            return jsonify({'error': 'Error al eliminar pago'}), 500


@servicios_bp.route('/historial', methods=['GET'])
def historial():
    # Params: desde_mes, desde_anio, hasta_mes, hasta_anio, servicio_id (optional)
    try:
        desde_mes = int(request.args.get('desde_mes'))
        desde_anio = int(request.args.get('desde_anio'))
        hasta_mes = int(request.args.get('hasta_mes'))
        hasta_anio = int(request.args.get('hasta_anio'))
    except Exception:
        return jsonify({'error': 'Parámetros de periodo obligatorios: desde_mes, desde_anio, hasta_mes, hasta_anio'}), 400

    servicio_id = request.args.get('servicio_id')

    # Build date range (start at first day of desde_mes, end at last day of hasta_mes)
    desde = datetime(desde_anio, desde_mes, 1)
    # crude end: month+1 day1 minus 1 second; to keep simple use month end by next month start
    if hasta_mes == 12:
        hasta = datetime(hasta_anio + 1, 1, 1)
    else:
        hasta = datetime(hasta_anio, hasta_mes + 1, 1)

    # Query novedades and pagos in range
    try:
        novedades_q = ServicioNovedad.query.filter(ServicioNovedad.fecha_recibo >= desde, ServicioNovedad.fecha_recibo < hasta)
        pagos_q = ServicioPago.query.filter(ServicioPago.fecha_pago >= desde, ServicioPago.fecha_pago < hasta)
    except Exception:
        logger.exception('Error construyendo consultas de historial')
        return jsonify({'error': 'Error al consultar historial'}), 500

    if servicio_id:
        novedades_q = novedades_q.filter_by(servicio_id=servicio_id)
        pagos_q = pagos_q.filter_by(servicio_id=servicio_id)

    novedades = [{
        'id': n.id,
        'servicio_id': n.servicio_id,
        'valor_real': float(n.valor_real),
        'fecha_recibo': _fmt_date(n.fecha_recibo),
        'fecha_limite_primer_pago': _fmt_date(n.fecha_limite_primer_pago),
        'fecha_corte': _fmt_date(n.fecha_corte),
        'referencia': n.referencia,
        'descripcion': n.descripcion
    } for n in novedades_q.order_by(ServicioNovedad.fecha_recibo).all()]

    pagos = [{
        'id': p.id,
        'servicio_id': p.servicio_id,
        'fecha_pago': _fmt_date(p.fecha_pago),
        'forma_pago': p.forma_pago,
        'valor_pagado': float(p.valor_pagado),
        'observaciones': p.observaciones
    } for p in pagos_q.order_by(ServicioPago.fecha_pago).all()]

    # Return combined structure similar to historial de nómina: agrupado por servicio
    servicios_ids = set([d['servicio_id'] for d in (novedades + pagos)])
    servicios_data = []
    for sid in servicios_ids:
        svc = None
        try:
            svc = Servicio.query.get(sid)
        except Exception:
            svc = None
        servicios_data.append({
            'servicio_id': sid,
            'servicio_nombre': svc.nombre if svc else None,
            'novedades': [n for n in novedades if n['servicio_id'] == sid],
            'pagos': [p for p in pagos if p['servicio_id'] == sid]
        })

    return jsonify({'periodo': {'desde': _fmt_date(desde), 'hasta': _fmt_date(hasta)}, 'total': len(servicios_data), 'data': servicios_data}), 200


@servicios_bp.route('/periodos/finalizar', methods=['POST'])
@login_required
def finalizar_periodo_servicios():
    """Finalizar un mes de servicios y preparar el siguiente como "en proceso".

    Espera JSON con:
      - mes (1-12)
      - anio

    Marca el periodo indicado como finalizado/en_proceso=False y crea o
    marca el siguiente mes como en_proceso=True.
    """
    payload = request.get_json() or {}
    try:
        mes = int(payload.get('mes'))
        anio = int(payload.get('anio'))
    except Exception:
        return jsonify({'error': 'Parámetros mes y anio son obligatorios y deben ser enteros'}), 400

    if not (1 <= mes <= 12):
        return jsonify({'error': 'El mes debe estar entre 1 y 12'}), 400

    ahora = datetime.utcnow()

    try:
        periodo = ServicioPeriodo.query.filter_by(mes=mes, anio=anio).first()
        if not periodo:
            periodo = ServicioPeriodo(
                mes=mes,
                anio=anio,
                en_proceso=False,
                finalizado=True,
                fecha_finalizacion=ahora
            )
            db.session.add(periodo)
        else:
            periodo.en_proceso = False
            periodo.finalizado = True
            periodo.fecha_finalizacion = ahora

        # Calcular siguiente mes/año y marcarlo como en proceso
        sig_mes, sig_anio = _calcular_siguiente_mes_anio(mes, anio)
        siguiente = ServicioPeriodo.query.filter_by(mes=sig_mes, anio=sig_anio).first()
        if not siguiente:
            siguiente = ServicioPeriodo(
                mes=sig_mes,
                anio=sig_anio,
                en_proceso=True,
                finalizado=False,
                fecha_inicio=ahora
            )
            db.session.add(siguiente)
        else:
            siguiente.en_proceso = True
            siguiente.finalizado = False
            if not siguiente.fecha_inicio:
                siguiente.fecha_inicio = ahora

        # Asegurar que ningún otro periodo quede marcado como en_proceso
        ServicioPeriodo.query.filter(ServicioPeriodo.id.notin_([periodo.id, siguiente.id])).update(
            {"en_proceso": False}, synchronize_session=False
        )

        db.session.commit()

        return jsonify({
            'mensaje': 'Mes de servicios finalizado correctamente',
            'periodo_finalizado': {'mes': mes, 'anio': anio},
            'siguiente_periodo': {'mes': sig_mes, 'anio': sig_anio}
        }), 200
    except Exception:
        db.session.rollback()
        logger.exception('Error finalizando periodo de servicios')
        return jsonify({'error': 'Error al finalizar periodo de servicios'}), 500


@servicios_bp.route('/liquidacion-mensual', methods=['GET'])
@login_required
def liquidacion_mensual():
    """Resumen por servicio de lo que debe pagarse en un mes.

    Params: mes (1-12, obligatorio), anio (opcional, por defecto año actual).

    Para cada servicio activo que:
      - esté programado para pagarse en ese mes según modalidad_pago_meses/mes_inicio_pago, o
      - tenga saldo pendiente de meses anteriores,
    se calcula:
      - saldo_anterior: novedades hasta fin de mes anterior menos pagos hasta fin de mes anterior
      - valor_mes: novedades del mes seleccionado; si no hay novedades pero el servicio está programado
        para ese mes, se usa valor_aproximado como referencia.
    """
    try:
        mes = int(request.args.get('mes'))
    except Exception:
        return jsonify({'error': 'Parámetro "mes" (1-12) es obligatorio'}), 400

    if not (1 <= mes <= 12):
        return jsonify({'error': 'El mes debe estar entre 1 y 12'}), 400

    try:
        anio = int(request.args.get('anio') or datetime.utcnow().year)
    except Exception:
        anio = datetime.utcnow().year

    # Rango del mes objetivo
    inicio_mes = datetime(anio, mes, 1)
    if mes == 12:
        inicio_mes_siguiente = datetime(anio + 1, 1, 1)
    else:
        inicio_mes_siguiente = datetime(anio, mes + 1, 1)

    # Fechas de corte para saldo anterior (todo antes de inicio_mes)
    corte_saldo = inicio_mes

    try:
        servicios = Servicio.query.filter_by(activo=True).order_by(Servicio.nombre).all()
    except Exception:
        logger.exception('Error consultando servicios para liquidación mensual')
        return jsonify({'error': 'Error al consultar servicios'}), 500

    resultados = []

    for s in servicios:
        # Totales de novedades y pagos anteriores al mes
        try:
            total_novedades_prev = (
                db.session.query(db.func.coalesce(db.func.sum(ServicioNovedad.valor_real), 0))
                .filter(
                    ServicioNovedad.servicio_id == s.id,
                    ServicioNovedad.fecha_recibo < corte_saldo,
                    ServicioNovedad.activo.is_(True)
                )
                .scalar()
            )

            total_pagos_prev = (
                db.session.query(db.func.coalesce(db.func.sum(ServicioPago.valor_pagado), 0))
                .filter(
                    ServicioPago.servicio_id == s.id,
                    ServicioPago.fecha_pago < corte_saldo
                )
                .scalar()
            )

            saldo_anterior = float((total_novedades_prev or 0) - (total_pagos_prev or 0))
            if saldo_anterior < 0:
                saldo_anterior = 0.0

            # Novedades y pagos del mes seleccionado. Solo se consideran como
            # "cargo del mes" si el servicio está programado para pagarse en
            # este mes; de lo contrario, esas novedades se acumulan como saldo
            # para el siguiente mes de pago.
            if _debe_pagarse_en_mes(s, mes):
                total_novedades_mes = (
                    db.session.query(db.func.coalesce(db.func.sum(ServicioNovedad.valor_real), 0))
                    .filter(
                        ServicioNovedad.servicio_id == s.id,
                        ServicioNovedad.fecha_recibo >= inicio_mes,
                        ServicioNovedad.fecha_recibo < inicio_mes_siguiente,
                        ServicioNovedad.activo.is_(True)
                    )
                    .scalar()
                )
            else:
                total_novedades_mes = 0

            total_pagos_mes = (
                db.session.query(db.func.coalesce(db.func.sum(ServicioPago.valor_pagado), 0))
                .filter(
                    ServicioPago.servicio_id == s.id,
                    ServicioPago.fecha_pago >= inicio_mes,
                    ServicioPago.fecha_pago < inicio_mes_siguiente
                )
                .scalar()
            )
        except Exception:
            logger.exception('Error calculando totales para servicio %s', s.id)
            return jsonify({'error': 'Error al calcular liquidación mensual'}), 500

        # Valor del mes: por defecto las novedades del mes (solo si el servicio
        # está programado en este mes); si no hay y el servicio está programado,
        # usar valor_aproximado como referencia.
        valor_mes_novedades = float(total_novedades_mes or 0)
        programado_en_mes = _debe_pagarse_en_mes(s, mes)
        if valor_mes_novedades > 0:
            valor_mes = valor_mes_novedades
        elif programado_en_mes:
            valor_mes = float(s.valor_aproximado or 0)
        else:
            valor_mes = 0.0

        total_a_pagar = saldo_anterior + valor_mes

        # Incluir sólo servicios que tengan algo por pagar (saldo anterior o cargo del mes)
        if saldo_anterior > 0 or valor_mes > 0:
            resultados.append({
                'servicio_id': s.id,
                'servicio_nombre': s.nombre,
                'referencia_pago': s.referencia_pago,
                'dia_pago': s.dia_pago,
                'modalidad_pago_meses': s.modalidad_pago_meses,
                'mes_inicio_pago': s.mes_inicio_pago,
                'saldo_anterior': round(saldo_anterior, 2),
                'valor_mes': round(valor_mes, 2),
                'total_a_pagar': round(total_a_pagar, 2),
                'total_novedades_prev': float(total_novedades_prev or 0),
                'total_pagos_prev': float(total_pagos_prev or 0),
                'total_novedades_mes': float(total_novedades_mes or 0),
                'total_pagos_mes': float(total_pagos_mes or 0),
            })

    return jsonify({
        'mes': mes,
        'anio': anio,
        'total': len(resultados),
        'data': resultados
    }), 200
