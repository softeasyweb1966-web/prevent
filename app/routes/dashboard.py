from datetime import datetime
import logging

from flask import jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import func

from app.models import ClienteComercial, ClienteSeguimientoDocumento, ClienteSeguimientoPago, ComisionLiquidacion, Usuario, Vendedor, db
from app.routes import dashboard_bp


logger = logging.getLogger(__name__)


@dashboard_bp.route('/stats', methods=['GET'])
@login_required
def dashboard_stats():
    return jsonify({
        'usuarios_activos': Usuario.query.filter_by(activo=True).count(),
        'vendedores_activos': Vendedor.query.filter_by(activo=True).count(),
        'clientes_activos': ClienteComercial.query.filter_by(activo=True).count(),
    })


@dashboard_bp.route('/comercial', methods=['GET'])
@login_required
def dashboard_comercial():
    try:
        hoy = datetime.utcnow()
        mes = request.args.get('referencia_mes', type=int) or request.args.get('mes', type=int) or hoy.month
        anio = request.args.get('referencia_anio', type=int) or request.args.get('anio', type=int) or hoy.year
        inicio = datetime(anio, mes, 1)
        fin = datetime(anio + 1, 1, 1) if mes == 12 else datetime(anio, mes + 1, 1)
        cartera = db.session.query(func.coalesce(func.sum(ClienteSeguimientoDocumento.saldo_actual), 0)).filter(
            ClienteSeguimientoDocumento.genera_cartera.is_(True),
            ClienteSeguimientoDocumento.estado_documento != 'ANULADO',
            ClienteSeguimientoDocumento.saldo_actual > 0,
        ).scalar() or 0
        recaudo = db.session.query(func.coalesce(func.sum(ClienteSeguimientoPago.valor_pago), 0)).filter(
            ClienteSeguimientoPago.fecha_pago >= inicio,
            ClienteSeguimientoPago.fecha_pago < fin,
        ).scalar() or 0
        comisiones = db.session.query(func.coalesce(func.sum(ComisionLiquidacion.total_comision_aprobada), 0)).filter_by(
            mes=mes, anio=anio
        ).scalar() or 0
        return jsonify({
            'nombre': 'Comercial',
            'total_vendedores': Vendedor.query.count(),
            'vendedores_activos': Vendedor.query.filter_by(activo=True).count(),
            'clientes_activos': ClienteComercial.query.filter_by(activo=True).count(),
            'cartera_pendiente': float(cartera),
            'recaudo_mes': float(recaudo),
            'comisiones_mes': float(comisiones),
            'rentabilidad_mes': 0.0,
            'periodo_actual': {'mes': mes, 'anio': anio},
        })
    except Exception as exc:
        logger.exception('Error dashboard comercial: %s', exc)
        return jsonify({'error': 'Error al cargar dashboard comercial'}), 500


@dashboard_bp.route('/compras', methods=['GET'])
@login_required
def dashboard_compras():
    return jsonify({'nombre': 'Compras', 'total_registros': 0})


@dashboard_bp.route('/ventas', methods=['GET'])
@login_required
def dashboard_ventas():
    return jsonify({'nombre': 'Ventas', 'total_registros': 0})


@dashboard_bp.route('/informes', methods=['GET'])
@login_required
def dashboard_informes():
    return jsonify({'nombre': 'Informes', 'informes': []})


@dashboard_bp.route('/usuarios', methods=['GET'])
@login_required
def dashboard_usuarios():
    return jsonify({'nombre': 'Usuarios', 'total_activos': Usuario.query.filter_by(activo=True).count()})


@dashboard_bp.route('/tablas', methods=['GET'])
@login_required
def dashboard_tablas():
    return jsonify({'nombre': 'Tablas', 'conteos': {
        'usuarios': Usuario.query.count(),
        'vendedores': Vendedor.query.count(),
        'clientes': ClienteComercial.query.count(),
    }})


@dashboard_bp.route('/resumen', methods=['GET'])
@login_required
def dashboard_resumen_general():
    return jsonify({
        'fecha_actual': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
        'usuario_actual': current_user.usuario,
        'modulos': ['atenciones', 'ventas', 'compras', 'vendedores', 'informes', 'usuarios', 'tablas'],
    })
