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
    Novedad,
    NovedadAplicada,
    TipoNovedad,
    PrestamoEmpresa,
    PrestamoPago,
)
from flask_login import login_required, current_user
from datetime import datetime, timedelta
from sqlalchemy import func
import logging

logger = logging.getLogger(__name__)

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
        from decimal import Decimal

        # Total de empleados activos
        total_empleados = Empleado.query.filter_by(activo=True).count()
        
        # Total empleados afiliados a planilla
        empleados_planilla = Empleado.query.filter_by(planilla_afiliado=True, activo=True).count()
        
        # Quincena actual
        hoy = datetime.now()
        quincena_actual = None
        if hoy.day <= 5:
            # Primera quincena
            fecha_inicio = datetime(hoy.year, hoy.month, 1)
            fecha_fin = datetime(hoy.year, hoy.month, 5)
        elif hoy.day <= 20:
            # Primera quincena o segunda quincena
            fecha_inicio = datetime(hoy.year, hoy.month, 6)
            fecha_fin = datetime(hoy.year, hoy.month, 20)
        else:
            # Segunda quincena
            fecha_inicio = datetime(hoy.year, hoy.month, 21)
            if hoy.month == 12:
                fecha_fin = datetime(hoy.year + 1, 1, 5)
            else:
                fecha_fin = datetime(hoy.year, hoy.month + 1, 5)
        
        # Obtener quincena si existe
        quincena_actual = Quincena.query.filter(
            Quincena.fecha_inicio <= hoy,
            Quincena.fecha_fin >= hoy
        ).first()
        
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

        datos = {
            'total_empleados': total_empleados,
            'empleados_planilla': empleados_planilla,
            'ultima_nomina_pagada': datetime.now().strftime('%Y-%m-%d'),
            'nomina_pagada_mes': float(nomina_pagada_mes),
            'pendiente_por_pagar': float(pendiente),
            'total_mes_nomina': float(total_mes_nomina_dec),
            'detalle_quincenas': detalle_quincenas,
            'quincena_actual': {
                'fecha_inicio': quincena_actual.fecha_inicio.strftime('%Y-%m-%d') if quincena_actual else None,
                'fecha_fin': quincena_actual.fecha_fin.strftime('%Y-%m-%d') if quincena_actual else None,
                'procesada': quincena_actual.procesada if quincena_actual else False
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

        datos = {
            'total_servicios': total_servicios,
            'novedades_ultimos_30_dias': int(novedades_30),
            'pagos_ultimos_30_dias': int(pagos_30),
            'pagos_mes_actual': float(pagos_mes)
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

        datos = {
            'nombre': 'Préstamos Empresa',
            'total_prestamos': int(total_prestamos),
            'total_prestamos_activos': int(total_prestamos_activos),
            'monto_total_prestado': float(monto_total),
            'saldo_total_pendiente': float(saldo_total),
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
