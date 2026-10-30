from datetime import datetime
import logging

from flask import jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import func

from app.models import ClienteComercial, ClienteSeguimientoDocumento, ClienteSeguimientoPago, ComisionLiquidacion, RetencionFuente, Usuario, Vendedor, db
from app.routes import dashboard_bp
from app.clientes_scope import clientes_visibles, filtrar_vendedor, filtrar_cliente


logger = logging.getLogger(__name__)


@dashboard_bp.route('/stats', methods=['GET'])
@login_required
def dashboard_stats():
    return jsonify({
        'usuarios_activos': Usuario.query.filter_by(activo=True).count(),
        'vendedores_activos': filtrar_vendedor(Vendedor.query, Vendedor.id).filter_by(activo=True).count(),
        'clientes_activos': clientes_visibles().filter_by(activo=True).count(),
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
        cartera = filtrar_cliente(db.session.query(func.coalesce(func.sum(ClienteSeguimientoDocumento.saldo_actual), 0)), ClienteSeguimientoDocumento.cliente_id).filter(
            ClienteSeguimientoDocumento.genera_cartera.is_(True),
            ClienteSeguimientoDocumento.estado_documento != 'ANULADO',
            ClienteSeguimientoDocumento.saldo_actual > 0,
        ).scalar() or 0
        recaudo = filtrar_vendedor(db.session.query(func.coalesce(func.sum(ClienteSeguimientoPago.valor_pago), 0)), ClienteSeguimientoPago.vendedor_id).filter(
            ClienteSeguimientoPago.fecha_pago >= inicio,
            ClienteSeguimientoPago.fecha_pago < fin,
        ).scalar() or 0
        comisiones = filtrar_vendedor(db.session.query(func.coalesce(func.sum(ComisionLiquidacion.total_comision_aprobada), 0)), ComisionLiquidacion.vendedor_id).filter_by(
            mes=mes, anio=anio
        ).scalar() or 0
        return jsonify({
            'nombre': 'Comercial',
            'total_vendedores': filtrar_vendedor(Vendedor.query, Vendedor.id).count(),
            'vendedores_activos': filtrar_vendedor(Vendedor.query, Vendedor.id).filter_by(activo=True).count(),
            'clientes_activos': clientes_visibles().filter_by(activo=True).count(),
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


def _retencion_json(item):
    return {c: (float(getattr(item, c)) if c in ('base_uvt', 'base_pesos', 'tarifa_porcentaje') and getattr(item, c) is not None else (getattr(item, c).isoformat() if c.startswith('vigencia_') and getattr(item, c) else getattr(item, c))) for c in ('id', 'codigo', 'categoria', 'concepto', 'base_uvt', 'base_pesos', 'tarifa_porcentaje', 'comparador', 'aplicacion_automatica', 'observaciones', 'norma_referencia', 'vigencia_desde', 'vigencia_hasta', 'activo')}


@dashboard_bp.route('/retenciones-fuente', methods=['GET', 'POST'])
@login_required
def retenciones_fuente_api():
    if request.method == 'GET':
        return jsonify([_retencion_json(x) for x in RetencionFuente.query.order_by(RetencionFuente.categoria, RetencionFuente.codigo).all()])
    data = request.get_json(silent=True) or {}
    item = RetencionFuente(codigo=data.get('codigo', '').strip(), categoria=data.get('categoria', '').strip(), concepto=data.get('concepto', '').strip())
    for key in ('base_uvt', 'base_pesos', 'tarifa_porcentaje'):
        setattr(item, key, data.get(key) if data.get(key) not in ('', None) else None)
    for key in ('comparador', 'aplicacion_automatica', 'observaciones', 'norma_referencia'):
        setattr(item, key, data.get(key))
    item.activo = bool(data.get('activo', True))
    if not item.codigo or not item.categoria or not item.concepto:
        return jsonify(error='Código, categoría y concepto son obligatorios.'), 400
    db.session.add(item); db.session.commit()
    return jsonify(_retencion_json(item)), 201


@dashboard_bp.route('/retenciones-fuente/<int:item_id>', methods=['PUT', 'DELETE'])
@login_required
def retencion_fuente_detalle(item_id):
    item = db.session.get(RetencionFuente, item_id)
    if not item: return jsonify(error='Registro no encontrado.'), 404
    if request.method == 'DELETE':
        db.session.delete(item); db.session.commit(); return jsonify(ok=True)
    data = request.get_json(silent=True) or {}
    for key in ('codigo', 'categoria', 'concepto', 'comparador', 'aplicacion_automatica', 'observaciones', 'norma_referencia'):
        if key in data: setattr(item, key, data[key])
    for key in ('base_uvt', 'base_pesos', 'tarifa_porcentaje'):
        if key in data: setattr(item, key, data[key] if data[key] != '' else None)
    if 'activo' in data: item.activo = bool(data['activo'])
    db.session.commit(); return jsonify(_retencion_json(item))


@dashboard_bp.route('/usuarios', methods=['GET'])
@login_required
def dashboard_usuarios():
    return jsonify({'nombre': 'Usuarios', 'total_activos': Usuario.query.filter_by(activo=True).count()})


@dashboard_bp.route('/tablas', methods=['GET'])
@login_required
def dashboard_tablas():
    return jsonify({'nombre': 'Tablas', 'conteos': {
        'usuarios': Usuario.query.count(),
        'vendedores': filtrar_vendedor(Vendedor.query, Vendedor.id).count(),
        'clientes': clientes_visibles().count(),
    }})


@dashboard_bp.route('/resumen', methods=['GET'])
@login_required
def dashboard_resumen_general():
    return jsonify({
        'fecha_actual': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
        'usuario_actual': current_user.usuario,
        'modulos': ['atenciones', 'ventas', 'compras', 'vendedores', 'informes', 'usuarios', 'tablas'],
    })
