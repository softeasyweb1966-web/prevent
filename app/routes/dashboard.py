from flask import request, jsonify
from app.routes import dashboard_bp
from app.models import (
    db,
    Empleado,
    Quincena,
    LiquidoQuincena,
    Pago,
    Servicio,
    ServicioNovedad,
    ServicioPago,
    ServicioPeriodo,
    Novedad,
    NovedadAplicada,
    TipoNovedad,
    PrestamoEmpresa,
    PrestamoNovedad,
    PrestamoPago,
)
from flask_login import login_required, current_user
from datetime import datetime, timedelta
from sqlalchemy import func, or_
from decimal import Decimal
import calendar
import logging

logger = logging.getLogger(__name__)


def _periodo_quincena(anio, mes, numero_quincena):
    if numero_quincena == 1:
        return (
            datetime(anio, mes, 1),
            datetime(anio, mes, 15, 23, 59, 59)
        )

    ultimo_dia = calendar.monthrange(anio, mes)[1]
    return (
        datetime(anio, mes, 16),
        datetime(anio, mes, ultimo_dia, 23, 59, 59)
    )


def _empleado_aplica_en_periodo(empleado, fecha_inicio, fecha_fin, numero_quincena):
    if empleado.fecha_inicio and empleado.fecha_inicio > fecha_fin:
        return False, 'BLANK'

    if empleado.fecha_retiro and empleado.fecha_retiro < fecha_inicio:
        return False, 'BLANK'

    if empleado.forma_pago == 'QUINCENAL':
        return True, 'APLICA'

    dia_pago = empleado.dia_pago or 5
    if numero_quincena == 1 and dia_pago == 5:
        return True, 'APLICA'
    if numero_quincena == 2 and dia_pago == 20:
        return True, 'APLICA'

    return False, 'NA'


def _periodo_siguiente(mes, numero_quincena, anio):
    if numero_quincena == 1:
        return mes, 2, anio
    if mes == 12:
        return 1, 1, anio + 1
    return mes + 1, 1, anio


def _periodo_mensual(anio, mes):
    ultimo_dia = calendar.monthrange(anio, mes)[1]
    return (
        datetime(anio, mes, 1),
        datetime(anio, mes, ultimo_dia, 23, 59, 59)
    )


def _mes_siguiente(mes, anio):
    if mes == 12:
        return 1, anio + 1
    return mes + 1, anio


def _debe_pagarse_servicio_en_mes(servicio, mes):
    try:
        periodo = int(servicio.modalidad_pago_meses or 1)
        mes_inicio = int(servicio.mes_inicio_pago or 1)
    except Exception:
        return True

    if periodo <= 0:
        return True
    if not (1 <= mes_inicio <= 12) or not (1 <= mes <= 12):
        return True

    return ((mes - mes_inicio) % periodo) == 0


def _serialize_month_matrix_summary(matriz, mes_referencia):
    key = f'm{mes_referencia}'
    con_movimiento = 0
    total_programado = Decimal('0')
    total_pagado = Decimal('0')

    for fila in matriz.get('filas', []):
        celda = next((c for c in fila.get('celdas', []) if c.get('key') == key), None)
        if not celda:
            continue
        valor = Decimal(str(celda.get('valor') or 0))
        valor_pagado = Decimal(str(celda.get('valor_pagado') or 0))
        if valor > 0:
            con_movimiento += 1
            total_programado += valor
        total_pagado += valor_pagado

    return {
        'con_movimiento': con_movimiento,
        'total_programado': float(total_programado),
        'total_pagado': float(total_pagado),
    }


def _build_servicios_matrix(anio, hoy, mes_referencia=None, anio_referencia=None):
    meses = {
        1: 'Ene', 2: 'Feb', 3: 'Mar', 4: 'Abr', 5: 'May', 6: 'Jun',
        7: 'Jul', 8: 'Ago', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dic'
    }

    if not mes_referencia or not anio_referencia:
        periodo_actual = (
            ServicioPeriodo.query
            .filter_by(en_proceso=True)
            .order_by(ServicioPeriodo.anio.desc(), ServicioPeriodo.mes.desc())
            .first()
        )
        if periodo_actual:
            mes_referencia = periodo_actual.mes
            anio_referencia = periodo_actual.anio
        else:
            mes_referencia = hoy.month
            anio_referencia = hoy.year

    limite_mes, limite_anio = _mes_siguiente(mes_referencia, anio_referencia)
    periodos = [{
        'key': f'm{mes}',
        'mes': mes,
        'label': meses[mes],
    } for mes in range(1, 13)]

    servicios = Servicio.query.order_by(Servicio.activo.desc(), Servicio.nombre.asc()).all()

    novedades_rows = db.session.query(
        ServicioNovedad.servicio_id,
        func.extract('month', ServicioNovedad.fecha_recibo),
        func.coalesce(func.sum(ServicioNovedad.valor_real), 0)
    ).filter(
        func.extract('year', ServicioNovedad.fecha_recibo) == anio
    ).group_by(
        ServicioNovedad.servicio_id,
        func.extract('month', ServicioNovedad.fecha_recibo)
    ).all()

    pagos_rows = db.session.query(
        ServicioPago.servicio_id,
        func.extract('month', ServicioPago.fecha_pago),
        func.coalesce(func.sum(ServicioPago.valor_pagado), 0)
    ).filter(
        func.extract('year', ServicioPago.fecha_pago) == anio
    ).group_by(
        ServicioPago.servicio_id,
        func.extract('month', ServicioPago.fecha_pago)
    ).all()

    novedades_por_periodo = {
        (servicio_id, int(mes)): Decimal(str(valor or 0))
        for servicio_id, mes, valor in novedades_rows
    }
    pagos_por_periodo = {
        (servicio_id, int(mes)): Decimal(str(valor or 0))
        for servicio_id, mes, valor in pagos_rows
    }

    totales_por_periodo = {periodo['key']: Decimal('0') for periodo in periodos}
    total_base = Decimal('0')
    total_cancelado = Decimal('0')
    total_pendiente = Decimal('0')
    filas = []

    for servicio in servicios:
        valor_base = Decimal(str(servicio.valor_aproximado or 0))
        total_base += valor_base
        fila_cancelado = Decimal('0')
        fila_pendiente = Decimal('0')
        fila = {
            'item_id': servicio.id,
            'item': servicio.nombre,
            'valor_base': float(valor_base),
            'celdas': [],
            'total_cancelado': 0.0,
            'saldo_pendiente': 0.0,
        }

        for periodo in periodos:
            _, fecha_fin = _periodo_mensual(anio, periodo['mes'])
            aplica = _debe_pagarse_servicio_en_mes(servicio, periodo['mes'])
            beyond_limit = (anio, periodo['mes']) > (limite_anio, limite_mes)
            future_to_reference = (anio, periodo['mes']) > (anio_referencia, mes_referencia)

            celda = {
                'key': periodo['key'],
                'estado': 'BLANK',
                'valor': None,
                'valor_pagado': 0.0,
                'saldo_pendiente': 0.0,
                'texto': '',
                'titulo': '',
            }

            if beyond_limit:
                fila['celdas'].append(celda)
                continue

            if not aplica:
                celda['estado'] = 'NA'
                celda['texto'] = 'NA'
                celda['titulo'] = 'No aplica pago en este mes'
                fila['celdas'].append(celda)
                continue

            cargo = novedades_por_periodo.get((servicio.id, periodo['mes']))
            if cargo is None or cargo <= 0:
                cargo = valor_base
            pagado = pagos_por_periodo.get((servicio.id, periodo['mes']), Decimal('0'))
            saldo = max(Decimal('0'), cargo - pagado)

            if future_to_reference and pagado <= 0:
                fila['celdas'].append(celda)
                continue

            celda['valor'] = float(cargo)
            celda['valor_pagado'] = float(pagado)
            celda['saldo_pendiente'] = float(saldo)
            celda['texto'] = f"{float(cargo):,.0f}" if cargo > 0 else ''
            celda['titulo'] = (
                f"Programado: {float(cargo):,.2f} | "
                f"Pagado: {float(pagado):,.2f} | "
                f"Saldo: {float(saldo):,.2f}"
            )

            if cargo <= 0 and pagado <= 0:
                celda['estado'] = 'NA'
                celda['texto'] = 'NA'
                celda['titulo'] = 'No hay cargo programado para este mes'
            elif pagado > 0 and saldo > 0:
                celda['estado'] = 'PARTIAL'
            elif pagado >= cargo and cargo > 0:
                celda['estado'] = 'PAID'
            elif fecha_fin.date() <= hoy.date():
                celda['estado'] = 'PENDING'
            else:
                celda['estado'] = 'BLANK'
                celda['texto'] = ''
                celda['titulo'] = 'Mes futuro dentro del horizonte visible'

            if celda['estado'] != 'BLANK' and cargo > 0:
                totales_por_periodo[periodo['key']] += cargo
                fila_cancelado += pagado
                fila_pendiente += saldo

            fila['celdas'].append(celda)

        fila['total_cancelado'] = float(fila_cancelado)
        fila['saldo_pendiente'] = float(fila_pendiente)
        total_cancelado += fila_cancelado
        total_pendiente += fila_pendiente
        filas.append(fila)

    return {
        'anio': anio,
        'referencia_mes': mes_referencia,
        'referencia_anio': anio_referencia,
        'periodos': periodos,
        'filas': filas,
        'totales': {
            'valor_base': float(total_base),
            'periodos': {key: float(valor) for key, valor in totales_por_periodo.items()},
            'total_cancelado': float(total_cancelado),
            'saldo_pendiente': float(total_pendiente),
        }
    }


def _build_bancos_matrix(anio, hoy, mes_referencia=None, anio_referencia=None):
    meses = {
        1: 'Ene', 2: 'Feb', 3: 'Mar', 4: 'Abr', 5: 'May', 6: 'Jun',
        7: 'Jul', 8: 'Ago', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dic'
    }

    if not mes_referencia or not anio_referencia:
        mes_referencia = hoy.month
        anio_referencia = hoy.year

    limite_mes, limite_anio = _mes_siguiente(mes_referencia, anio_referencia)
    periodos = [{
        'key': f'm{mes}',
        'mes': mes,
        'label': meses[mes],
    } for mes in range(1, 13)]

    prestamos = PrestamoEmpresa.query.order_by(PrestamoEmpresa.activo.desc(), PrestamoEmpresa.nombre.asc()).all()

    novedades_rows = db.session.query(
        PrestamoNovedad.prestamo_id,
        func.extract('month', PrestamoNovedad.fecha_limite_pago),
        func.coalesce(func.sum(PrestamoNovedad.valor_a_pagar), 0)
    ).filter(
        func.extract('year', PrestamoNovedad.fecha_limite_pago) == anio
    ).group_by(
        PrestamoNovedad.prestamo_id,
        func.extract('month', PrestamoNovedad.fecha_limite_pago)
    ).all()

    pagos_rows = db.session.query(
        PrestamoPago.prestamo_id,
        func.extract('month', PrestamoPago.fecha_pago),
        func.coalesce(func.sum(PrestamoPago.valor_pagado), 0)
    ).filter(
        func.extract('year', PrestamoPago.fecha_pago) == anio
    ).group_by(
        PrestamoPago.prestamo_id,
        func.extract('month', PrestamoPago.fecha_pago)
    ).all()

    novedades_por_periodo = {
        (prestamo_id, int(mes)): Decimal(str(valor or 0))
        for prestamo_id, mes, valor in novedades_rows
    }
    pagos_por_periodo = {
        (prestamo_id, int(mes)): Decimal(str(valor or 0))
        for prestamo_id, mes, valor in pagos_rows
    }

    totales_por_periodo = {periodo['key']: Decimal('0') for periodo in periodos}
    total_base = Decimal('0')
    total_cancelado = Decimal('0')
    total_pendiente = Decimal('0')
    filas = []

    for prestamo in prestamos:
        valor_base = Decimal(str(prestamo.valor_cuota or prestamo.valor_prestamo or 0))
        total_base += valor_base
        fila_cancelado = Decimal('0')
        fila_pendiente = Decimal('0')
        fila = {
            'item_id': prestamo.id,
            'item': prestamo.nombre,
            'valor_base': float(valor_base),
            'celdas': [],
            'total_cancelado': 0.0,
            'saldo_pendiente': 0.0,
        }

        for periodo in periodos:
            fecha_inicio, fecha_fin = _periodo_mensual(anio, periodo['mes'])
            beyond_limit = (anio, periodo['mes']) > (limite_anio, limite_mes)
            future_to_reference = (anio, periodo['mes']) > (anio_referencia, mes_referencia)

            celda = {
                'key': periodo['key'],
                'estado': 'BLANK',
                'valor': None,
                'valor_pagado': 0.0,
                'saldo_pendiente': 0.0,
                'texto': '',
                'titulo': '',
            }

            if beyond_limit:
                fila['celdas'].append(celda)
                continue

            if prestamo.fecha_inicio and prestamo.fecha_inicio > fecha_fin:
                fila['celdas'].append(celda)
                continue

            if prestamo.fecha_final and prestamo.fecha_final < fecha_inicio:
                fila['celdas'].append(celda)
                continue

            cargo = novedades_por_periodo.get((prestamo.id, periodo['mes']))
            if cargo is None or cargo <= 0:
                cargo = Decimal(str(prestamo.valor_cuota or 0))

            pagado = pagos_por_periodo.get((prestamo.id, periodo['mes']), Decimal('0'))
            saldo = max(Decimal('0'), cargo - pagado)

            if future_to_reference and pagado <= 0:
                fila['celdas'].append(celda)
                continue

            if cargo <= 0 and pagado <= 0:
                celda['estado'] = 'NA'
                celda['texto'] = 'NA'
                celda['titulo'] = 'No hay cuota programada para este mes'
                fila['celdas'].append(celda)
                continue

            celda['valor'] = float(cargo)
            celda['valor_pagado'] = float(pagado)
            celda['saldo_pendiente'] = float(saldo)
            celda['texto'] = f"{float(cargo):,.0f}" if cargo > 0 else ''
            celda['titulo'] = (
                f"Programado: {float(cargo):,.2f} | "
                f"Pagado: {float(pagado):,.2f} | "
                f"Saldo: {float(saldo):,.2f}"
            )

            if pagado > 0 and saldo > 0:
                celda['estado'] = 'PARTIAL'
            elif pagado >= cargo and cargo > 0:
                celda['estado'] = 'PAID'
            elif fecha_fin.date() <= hoy.date():
                celda['estado'] = 'PENDING'
            else:
                celda['estado'] = 'BLANK'
                celda['texto'] = ''
                celda['titulo'] = 'Mes futuro dentro del horizonte visible'

            if celda['estado'] != 'BLANK' and cargo > 0:
                totales_por_periodo[periodo['key']] += cargo
                fila_cancelado += pagado
                fila_pendiente += saldo

            fila['celdas'].append(celda)

        fila['total_cancelado'] = float(fila_cancelado)
        fila['saldo_pendiente'] = float(fila_pendiente)
        total_cancelado += fila_cancelado
        total_pendiente += fila_pendiente
        filas.append(fila)

    return {
        'anio': anio,
        'referencia_mes': mes_referencia,
        'referencia_anio': anio_referencia,
        'periodos': periodos,
        'filas': filas,
        'totales': {
            'valor_base': float(total_base),
            'periodos': {key: float(valor) for key, valor in totales_por_periodo.items()},
            'total_cancelado': float(total_cancelado),
            'saldo_pendiente': float(total_pendiente),
        }
    }


def _quincena_referencia_dashboard(hoy, mes=None, numero_quincena=None, anio=None):
    if mes and numero_quincena and anio:
        return mes, numero_quincena, anio
    if hoy.day <= 15:
        return hoy.month, 1, hoy.year
    return hoy.month, 2, hoy.year


def _obtener_quincena_dashboard_actual(hoy, mes=None, numero_quincena=None, anio=None):
    if mes and numero_quincena and anio:
        quincena = Quincena.query.filter_by(
            mes=mes,
            numero_quincena=numero_quincena,
            anio=anio
        ).first()
        if quincena:
            return quincena

    quincena = Quincena.query.filter(
        Quincena.procesada == True,
        Quincena.pagos_finalizados == False
    ).order_by(
        Quincena.anio.desc(),
        Quincena.mes.desc(),
        Quincena.numero_quincena.desc()
    ).first()

    if quincena:
        return quincena

    mes, numero_quincena, anio = _quincena_referencia_dashboard(hoy, mes, numero_quincena, anio)
    return Quincena.query.filter_by(
        mes=mes,
        numero_quincena=numero_quincena,
        anio=anio
    ).first()


def _build_nomina_matrix(anio, hoy, mes_referencia=None, numero_referencia=None, anio_referencia=None):
    meses = {
        1: 'Ene', 2: 'Feb', 3: 'Mar', 4: 'Abr', 5: 'May', 6: 'Jun',
        7: 'Jul', 8: 'Ago', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dic'
    }

    periodos = []
    mes_referencia, numero_referencia, anio_referencia = _quincena_referencia_dashboard(
        hoy,
        mes_referencia,
        numero_referencia,
        anio_referencia
    )
    limite_mes, limite_numero, limite_anio = _periodo_siguiente(mes_referencia, numero_referencia, anio_referencia)

    for mes in range(1, 13):
        for numero_quincena in (1, 2):
            fecha_inicio, fecha_fin = _periodo_quincena(anio, mes, numero_quincena)
            periodos.append({
                'key': f'm{mes}_q{numero_quincena}',
                'mes': mes,
                'numero_quincena': numero_quincena,
                'label': f"{meses[mes]} Q{numero_quincena}",
                'fecha_inicio': fecha_inicio,
                'fecha_fin': fecha_fin,
            })

    inicio_anio = datetime(anio, 1, 1)
    fin_anio = datetime(anio, 12, 31, 23, 59, 59)

    empleados = Empleado.query.filter(
        Empleado.fecha_inicio <= fin_anio,
        or_(Empleado.fecha_retiro.is_(None), Empleado.fecha_retiro >= inicio_anio)
    ).order_by(
        Empleado.activo.desc(),
        Empleado.nombres.asc(),
        Empleado.apellidos.asc()
    ).all()

    quincenas = Quincena.query.filter_by(anio=anio).all()
    quincenas_por_id = {q.id: q for q in quincenas}
    quincena_ids = [q.id for q in quincenas]

    liquidos = []
    if quincena_ids:
        liquidos = LiquidoQuincena.query.filter(LiquidoQuincena.quincena_id.in_(quincena_ids)).all()

    liquidos_por_periodo = {}
    liquido_ids = []
    for liquido in liquidos:
        quincena = quincenas_por_id.get(liquido.quincena_id)
        if not quincena:
            continue
        liquidos_por_periodo[(liquido.empleado_id, quincena.mes, quincena.numero_quincena)] = liquido
        liquido_ids.append(liquido.id)

    pagos_por_liquido = {}
    if liquido_ids:
        pagos_rows = db.session.query(
            Pago.liquido_quincena_id,
            func.coalesce(func.sum(Pago.valor_pagado), 0)
        ).filter(
            Pago.liquido_quincena_id.in_(liquido_ids)
        ).group_by(
            Pago.liquido_quincena_id
        ).all()
        pagos_por_liquido = {
            liquido_id: Decimal(str(total_pagado or 0))
            for liquido_id, total_pagado in pagos_rows
        }

    totales_por_periodo = {periodo['key']: Decimal('0') for periodo in periodos}
    total_sueldos = Decimal('0')
    total_cancelado = Decimal('0')
    total_pendiente = Decimal('0')
    filas = []

    for empleado in empleados:
        sueldo_base = Decimal(str(empleado.sueldo_base or 0))
        total_sueldos += sueldo_base

        fila = {
            'empleado_id': empleado.id,
            'empleado': f"{empleado.nombres} {empleado.apellidos}",
            'sueldo_base': float(sueldo_base),
            'celdas': [],
            'total_cancelado': 0.0,
            'saldo_pendiente': 0.0,
        }

        fila_cancelado = Decimal('0')
        fila_pendiente = Decimal('0')

        for periodo in periodos:
            aplica, modo = _empleado_aplica_en_periodo(
                empleado,
                periodo['fecha_inicio'],
                periodo['fecha_fin'],
                periodo['numero_quincena']
            )

            celda = {
                'key': periodo['key'],
                'estado': 'BLANK',
                'valor': None,
                'valor_pagado': 0.0,
                'saldo_pendiente': 0.0,
                'texto': '',
                'titulo': '',
            }

            if not aplica:
                if (anio, periodo['mes'], periodo['numero_quincena']) > (limite_anio, limite_mes, limite_numero):
                    fila['celdas'].append(celda)
                    continue
                if modo == 'NA':
                    celda['estado'] = 'NA'
                    celda['texto'] = 'NA'
                    celda['titulo'] = 'No aplica pago en esta quincena'
                fila['celdas'].append(celda)
                continue

            liquido = liquidos_por_periodo.get((empleado.id, periodo['mes'], periodo['numero_quincena']))
            if not liquido:
                if (anio, periodo['mes'], periodo['numero_quincena']) > (limite_anio, limite_mes, limite_numero):
                    celda['estado'] = 'BLANK'
                    celda['texto'] = ''
                    celda['titulo'] = 'Quincena fuera del horizonte visible del tablero'
                elif periodo['fecha_fin'].date() < hoy.date():
                    celda['estado'] = 'PENDING'
                    celda['texto'] = 'Pend.'
                    celda['titulo'] = 'Quincena vencida sin liquidacion o pago registrado'
                else:
                    celda['estado'] = 'BLANK'
                    celda['titulo'] = 'Quincena futura o aun sin procesar'
                fila['celdas'].append(celda)
                continue

            total_a_pagar = Decimal(str(liquido.total_a_pagar or 0))
            total_pagado = pagos_por_liquido.get(liquido.id, Decimal('0'))
            saldo_pendiente = Decimal(str(liquido.saldo_pendiente or 0))

            celda['valor'] = float(total_a_pagar)
            celda['valor_pagado'] = float(total_pagado)
            celda['saldo_pendiente'] = float(saldo_pendiente)
            celda['texto'] = f"{float(total_a_pagar):,.0f}"
            celda['titulo'] = (
                f"Total a pagar: {float(total_a_pagar):,.2f} | "
                f"Pagado: {float(total_pagado):,.2f} | "
                f"Saldo: {float(saldo_pendiente):,.2f}"
            )

            if total_pagado > 0 and saldo_pendiente > 0:
                celda['estado'] = 'PARTIAL'
            elif saldo_pendiente <= 0 or liquido.pagada:
                celda['estado'] = 'PAID'
            elif periodo['fecha_fin'].date() < hoy.date():
                celda['estado'] = 'PENDING'
            else:
                celda['estado'] = 'BLANK'

            fila_cancelado += total_pagado
            fila_pendiente += max(Decimal('0'), saldo_pendiente)
            totales_por_periodo[periodo['key']] += total_a_pagar
            fila['celdas'].append(celda)

        fila['total_cancelado'] = float(fila_cancelado)
        fila['saldo_pendiente'] = float(fila_pendiente)
        total_cancelado += fila_cancelado
        total_pendiente += fila_pendiente
        filas.append(fila)

    return {
        'anio': anio,
        'periodos': [
            {
                'key': periodo['key'],
                'mes': periodo['mes'],
                'numero_quincena': periodo['numero_quincena'],
                'label': periodo['label'],
            }
            for periodo in periodos
        ],
        'filas': filas,
        'totales': {
            'sueldo_base': float(total_sueldos),
            'periodos': {key: float(valor) for key, valor in totales_por_periodo.items()},
            'total_cancelado': float(total_cancelado),
            'saldo_pendiente': float(total_pendiente),
        },
    }

@dashboard_bp.route('/stats', methods=['GET'])
@login_required
def dashboard_stats():
    """Estadísticas generales del dashboard"""
    try:
        # Total de empleados activos
        total_empleados = Empleado.query.filter_by(activo=True).count()
        
        # Quincena actual
        hoy = datetime.now()
        quincena_actual = Quincena.query.filter(
            Quincena.fecha_inicio <= hoy,
            Quincena.fecha_fin >= hoy
        ).first()
        
        # Total de usuarios (importar Usuario si es necesario)
        from app.models import Usuario
        total_usuarios = Usuario.query.filter_by(activo=True).count()
        
        # Return structured quincena data so frontend can read fields
        datos = {
            'total_empleados': total_empleados,
            'quincena_actual': {
                'numero': quincena_actual.numero_quincena if quincena_actual else None,
                'mes': quincena_actual.mes if quincena_actual else None,
                'año': quincena_actual.anio if quincena_actual else None
            } if quincena_actual else None,
            'total_usuarios': total_usuarios
        }
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error en dashboard stats: {str(e)}")
        return jsonify({'error': 'Error al cargar estadísticas'}), 500


@dashboard_bp.route('/nomina', methods=['GET'])
@login_required
def dashboard_nomina():
    """Dashboard del módulo de nómina"""
    try:
        # Total de empleados activos
        total_empleados = Empleado.query.filter_by(activo=True).count()
        
        # Total empleados afiliados a planilla
        empleados_planilla = Empleado.query.filter_by(planilla_afiliado=True, activo=True).count()
        
        hoy = datetime.now()
        anio_matriz = request.args.get('anio', type=int) or hoy.year
        referencia_mes = request.args.get('referencia_mes', type=int)
        referencia_numero = request.args.get('referencia_numero_quincena', type=int)
        referencia_anio = request.args.get('referencia_anio', type=int) or anio_matriz
        
        quincena_actual = _obtener_quincena_dashboard_actual(
            hoy,
            referencia_mes,
            referencia_numero,
            referencia_anio if referencia_mes and referencia_numero else None
        )
        
        # Nómina pagada este mes
        este_mes_inicio = datetime(hoy.year, hoy.month, 1)
        if hoy.month == 12:
            este_mes_fin = datetime(hoy.year + 1, 1, 1) - timedelta(days=1)
        else:
            este_mes_fin = datetime(hoy.year, hoy.month + 1, 1) - timedelta(days=1)
        
        nomina_pagada_mes = db.session.query(func.sum(Pago.valor_pagado)).filter(
            Pago.fecha_pago >= este_mes_inicio,
            Pago.fecha_pago <= este_mes_fin
        ).scalar() or 0
        
        # Pendiente por pagar
        pendiente = db.session.query(func.sum(LiquidoQuincena.saldo_pendiente)).filter(
            LiquidoQuincena.pagada == False
        ).scalar() or 0

        # Detalle por quincena del mes actual (1 y 2) para estimar el costo mensual
        quincenas_mes = Quincena.query.filter(
            Quincena.mes == hoy.month,
            Quincena.anio == hoy.year
        ).all()

        detalle_quincenas = []
        total_mes_nomina_dec = Decimal('0')

        for numero in (1, 2):
            q = next((q for q in quincenas_mes if q.numero_quincena == numero), None)
            if not q:
                detalle_quincenas.append({
                    'numero_quincena': numero,
                    'mes': hoy.month,
                    'anio': hoy.year,
                    'existe': False,
                    'total_a_pagar': 0.0,
                    'total_pagado': 0.0,
                    'saldo_pendiente': 0.0,
                })
                continue

            liquidos = LiquidoQuincena.query.filter_by(quincena_id=q.id).all()

            total_a_pagar_dec = Decimal('0')
            saldo_pendiente_dec = Decimal('0')
            total_pagado_dec = Decimal('0')

            for l in liquidos:
                total_a_pagar_dec += Decimal(str(l.total_a_pagar or 0))
                saldo_pendiente_dec += Decimal(str(l.saldo_pendiente or 0))
                # Sumar pagos asociados a este liquido
                for p in l.pagos:
                    total_pagado_dec += Decimal(str(p.valor_pagado or 0))

            total_mes_nomina_dec += total_a_pagar_dec

            detalle_quincenas.append({
                'numero_quincena': numero,
                'mes': q.mes,
                'anio': q.anio,
                'existe': True,
                'total_a_pagar': float(total_a_pagar_dec),
                'total_pagado': float(total_pagado_dec),
                'saldo_pendiente': float(saldo_pendiente_dec),
            })

        mes_ref_matriz = referencia_mes
        numero_ref_matriz = referencia_numero
        anio_ref_matriz = referencia_anio if referencia_mes and referencia_numero else None

        if not (mes_ref_matriz and numero_ref_matriz) and quincena_actual:
            mes_ref_matriz = quincena_actual.mes
            numero_ref_matriz = quincena_actual.numero_quincena
            anio_ref_matriz = quincena_actual.anio

        matriz_anual = _build_nomina_matrix(
            anio_matriz,
            hoy,
            mes_ref_matriz,
            numero_ref_matriz,
            anio_ref_matriz
        )

        datos = {
            'total_empleados': total_empleados,
            'empleados_planilla': empleados_planilla,
            'ultima_nomina_pagada': datetime.now().strftime('%Y-%m-%d'),
            'nomina_pagada_mes': float(nomina_pagada_mes),
            'pendiente_por_pagar': float(pendiente),
            'total_mes_nomina': float(total_mes_nomina_dec),
            'detalle_quincenas': detalle_quincenas,
            'matriz_anual': matriz_anual,
            'quincena_actual': {
                'mes': quincena_actual.mes if quincena_actual else None,
                'numero_quincena': quincena_actual.numero_quincena if quincena_actual else None,
                'anio': quincena_actual.anio if quincena_actual else None,
                'fecha_inicio': quincena_actual.fecha_inicio.strftime('%Y-%m-%d') if quincena_actual else None,
                'fecha_fin': quincena_actual.fecha_fin.strftime('%Y-%m-%d') if quincena_actual else None,
                'procesada': quincena_actual.procesada if quincena_actual else False,
                'pagos_finalizados': quincena_actual.pagos_finalizados if quincena_actual else False
            }
        }
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error en dashboard nómina: {str(e)}")
        return jsonify({'error': 'Error al cargar dashboard'}), 500


@dashboard_bp.route('/servicios', methods=['GET'])
@login_required
def dashboard_servicios():
    """Dashboard del módulo de servicios: resumen y métricas básicas"""
    try:
        total_servicios = Servicio.query.filter_by(activo=True).count()

        # métricas recientes (últimos 30 días)
        desde_30 = datetime.utcnow() - timedelta(days=30)
        novedades_30 = ServicioNovedad.query.filter(ServicioNovedad.fecha_recibo >= desde_30).count()
        pagos_30 = ServicioPago.query.filter(ServicioPago.fecha_pago >= desde_30).count()

        # total pagado en el mes actual
        ahora = datetime.utcnow()
        mes_inicio = datetime(ahora.year, ahora.month, 1)
        pagos_mes = db.session.query(func.sum(ServicioPago.valor_pagado)).filter(ServicioPago.fecha_pago >= mes_inicio).scalar() or 0
        periodo_actual = (
            ServicioPeriodo.query
            .filter_by(en_proceso=True)
            .order_by(ServicioPeriodo.anio.desc(), ServicioPeriodo.mes.desc())
            .first()
        )
        referencia_mes = request.args.get('referencia_mes', type=int) or (periodo_actual.mes if periodo_actual else ahora.month)
        referencia_anio = request.args.get('referencia_anio', type=int) or (periodo_actual.anio if periodo_actual else ahora.year)
        anio_matriz = request.args.get('anio', type=int) or referencia_anio
        matriz_anual = _build_servicios_matrix(
            anio_matriz,
            ahora,
            mes_referencia=referencia_mes,
            anio_referencia=referencia_anio
        )
        resumen_mes = _serialize_month_matrix_summary(matriz_anual, referencia_mes)
        pagos_mes = resumen_mes['total_pagado']

        datos = {
            'total_servicios': total_servicios,
            'novedades_ultimos_30_dias': int(novedades_30),
            'pagos_ultimos_30_dias': int(pagos_30),
            'pagos_mes_actual': float(pagos_mes),
            'servicios_con_cargo_mes': int(resumen_mes['con_movimiento']),
            'total_programado_mes': float(resumen_mes['total_programado']),
            'matriz_anual': matriz_anual,
            'periodo_actual': {
                'mes': referencia_mes,
                'anio': referencia_anio,
                'en_proceso': True if periodo_actual else False
            }
        }

        return jsonify(datos), 200

    except Exception as e:
        logger.error(f"Error en dashboard servicios: {str(e)}")
        return jsonify({'error': 'Error al cargar dashboard de servicios'}), 500


def _safe_count(model_name):
    """Intentar contar registros de un modelo por nombre; si no existe, devolver None."""
    try:
        mdl = globals().get(model_name)
        if mdl is None:
            # intentar import dinámico desde app.models
            from app import create_app
            from app.models import db as _db
            import importlib
            m = importlib.import_module('app.models')
            mdl = getattr(m, model_name, None)
        if mdl is None:
            return None
        return mdl.query.count()
    except Exception:
        return None


@dashboard_bp.route('/bancos', methods=['GET'])
@login_required
def dashboard_bancos():
    """Dashboard del módulo Bancos/Préstamos de la empresa.

    Usa los modelos de préstamos de empresa (no nómina) para construir
    métricas simples que alimentan el mini-dashboard del módulo Bancos.
    """
    try:
        from decimal import Decimal
        from sqlalchemy import func as _func
        hoy = datetime.utcnow()
        referencia_mes = request.args.get('referencia_mes', type=int) or request.args.get('mes', type=int) or hoy.month
        referencia_anio = request.args.get('referencia_anio', type=int) or request.args.get('anio', type=int) or hoy.year
        anio_matriz = request.args.get('anio', type=int) or referencia_anio

        total_prestamos = PrestamoEmpresa.query.count()
        total_prestamos_activos = PrestamoEmpresa.query.filter_by(activo=True).count()

        prestamos_activos = PrestamoEmpresa.query.filter_by(activo=True).all()

        monto_total = Decimal('0')
        saldo_total = Decimal('0')

        for p in prestamos_activos:
            valor_total = Decimal(str(p.valor_prestamo or 0))
            monto_total += valor_total

            pagado_sum = db.session.query(_func.coalesce(_func.sum(PrestamoPago.valor_pagado), 0)).filter_by(
                prestamo_id=p.id
            ).scalar() or 0
            pagado_sum = Decimal(str(pagado_sum))
            saldo = max(Decimal('0'), valor_total - pagado_sum)
            saldo_total += saldo

        matriz_anual = _build_bancos_matrix(
            anio_matriz,
            hoy,
            mes_referencia=referencia_mes,
            anio_referencia=referencia_anio
        )
        resumen_mes = _serialize_month_matrix_summary(matriz_anual, referencia_mes)

        datos = {
            'nombre': 'Préstamos Empresa',
            'total_prestamos': int(total_prestamos),
            'total_prestamos_activos': int(total_prestamos_activos),
            'monto_total_prestado': float(monto_total),
            'saldo_total_pendiente': float(saldo_total),
            'prestamos_con_cargo_mes': int(resumen_mes['con_movimiento']),
            'total_programado_mes': float(resumen_mes['total_programado']),
            'total_pagado_mes': float(resumen_mes['total_pagado']),
            'matriz_anual': matriz_anual,
            'periodo_actual': {
                'mes': referencia_mes,
                'anio': referencia_anio
            },
        }

        return jsonify(datos), 200
    except Exception as e:
        logger.error(f"Error dashboard bancos: {str(e)}")
        return jsonify({'error': 'Error al cargar dashboard bancos'}), 500


@dashboard_bp.route('/comisiones', methods=['GET'])
@login_required
def dashboard_comisiones():
    try:
        return jsonify({
            'nombre': 'Comisiones',
            'periodicidad': 'Mensual',
            'total_registros': 0,
            'mensaje': 'Modulo base de comisiones listo para desarrollo'
        }), 200
    except Exception as e:
        logger.error(f"Error dashboard comisiones: {str(e)}")
        return jsonify({'error': 'Error al cargar dashboard comisiones'}), 500


@dashboard_bp.route('/impuestos', methods=['GET'])
@login_required
def dashboard_impuestos():
    try:
        # usar parámetros y conceptos automáticos como proxy
        desde = datetime.utcnow() - timedelta(days=90)
        conceptos = _safe_count('ParametroDescuento')
        return jsonify({'nombre': 'Impuestos', 'parametros_configurados': conceptos or 0, 'mensaje': 'Resumen básico de impuestos'}), 200
    except Exception as e:
        logger.error(f"Error dashboard impuestos: {str(e)}")
        return jsonify({'error': 'Error al cargar dashboard impuestos'}), 500


@dashboard_bp.route('/compras', methods=['GET'])
@login_required
def dashboard_compras():
    try:
        count = _safe_count('Compra')
        return jsonify({'nombre': 'Compras', 'total_registros': count if count is not None else 0, 'mensaje': 'Placeholder - modelo Compra no encontrado'}), 200
    except Exception as e:
        logger.error(f"Error dashboard compras: {str(e)}")
        return jsonify({'error': 'Error al cargar dashboard compras'}), 500


@dashboard_bp.route('/ventas', methods=['GET'])
@login_required
def dashboard_ventas():
    try:
        count = _safe_count('Venta')
        return jsonify({'nombre': 'Ventas', 'total_registros': count if count is not None else 0, 'mensaje': 'Placeholder - modelo Venta no encontrado'}), 200
    except Exception as e:
        logger.error(f"Error dashboard ventas: {str(e)}")
        return jsonify({'error': 'Error al cargar dashboard ventas'}), 500


@dashboard_bp.route('/informes', methods=['GET'])
@login_required
def dashboard_informes():
    try:
        # devolvemos lista de informes disponibles (placeholder)
        informes = [{'id': 'liquidacion', 'nombre': 'Liquidación'}, {'id': 'pagos', 'nombre': 'Pagos por periodo'}]
        return jsonify({'nombre': 'Informes', 'informes': informes}), 200
    except Exception as e:
        logger.error(f"Error dashboard informes: {str(e)}")
        return jsonify({'error': 'Error al cargar dashboard informes'}), 500


@dashboard_bp.route('/usuarios', methods=['GET'])
@login_required
def dashboard_usuarios():
    try:
        from app.models import Usuario
        total = Usuario.query.filter_by(activo=True).count()
        return jsonify({'nombre': 'Usuarios', 'total_activos': int(total)}), 200
    except Exception as e:
        logger.error(f"Error dashboard usuarios: {str(e)}")
        return jsonify({'error': 'Error al cargar dashboard usuarios'}), 500


@dashboard_bp.route('/tablas', methods=['GET'])
@login_required
def dashboard_tablas():
    try:
        # Mostrar conteo de tablas clave como marcador
        datos = {
            'empleados': _safe_count('Empleado') or 0,
            'servicios': _safe_count('Servicio') or 0,
            'usuarios': _safe_count('Usuario') or 0
        }
        return jsonify({'nombre': 'Tablas', 'conteos': datos}), 200
    except Exception as e:
        logger.error(f"Error dashboard tablas: {str(e)}")
        return jsonify({'error': 'Error al cargar dashboard tablas'}), 500


@dashboard_bp.route('/resumen', methods=['GET'])
@login_required
def dashboard_resumen_general():
    """Dashboard resumen general de todos los módulos"""
    try:
        datos = {
            'fecha_actual': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'usuario_actual': current_user.usuario,
            'modulos': {
                'nomina': {
                    'nombre': 'Nómina',
                    'ruta': '/nomina',
                    'empleados': Empleado.query.filter_by(activo=True).count()
                }
            }
        }
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error en resumen general: {str(e)}")
        return jsonify({'error': 'Error al cargar resumen'}), 500
