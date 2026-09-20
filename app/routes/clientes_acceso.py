"""Controles de propiedad antes de consultar o modificar registros comerciales."""
from flask import jsonify, request
from flask_login import current_user

from app.clientes_scope import es_administrador, vendedor_actual, exigir_cliente
from app.models import (db, PrefacturaComercial, PrefacturaComercialDetalle,
                        CarteraPrefactura, OrdenServicioCaja)
from app.routes import comercial_bp, contable_bp


@comercial_bp.errorhandler(PermissionError)
@contable_bp.errorhandler(PermissionError)
def acceso_denegado(exc):
    db.session.rollback()
    return jsonify(error=str(exc)), 403


@comercial_bp.before_request
def proteger_registros_comerciales():
    if not current_user.is_authenticated or es_administrador():
        return
    if vendedor_actual() is None:
        return jsonify(error='El administrador debe asociar tu usuario a un vendedor activo.'), 403
    if '/vendedores' in request.path and request.method != 'GET':
        return jsonify(error='La administraci?n de vendedores requiere un administrador.'), 403
    args = request.view_args or {}
    if 'pref_id' in args:
        exigir_cliente(PrefacturaComercial.query.get_or_404(args['pref_id']).cliente_id)
    if 'orden_id' in args:
        exigir_cliente(OrdenServicioCaja.query.get_or_404(args['orden_id']).cliente_id)
    if '/prefacturas/detalles/' in request.path and 'detalle_id' in args:
        detalle = PrefacturaComercialDetalle.query.get_or_404(args['detalle_id'])
        exigir_cliente(PrefacturaComercial.query.get_or_404(detalle.prefactura_id).cliente_id)
    if '/comercial/cartera/' in request.path and 'pago_id' in args:
        pago = CarteraPrefactura.query.get_or_404(args['pago_id'])
        exigir_cliente(PrefacturaComercial.query.get_or_404(pago.prefactura_id).cliente_id)
    if request.method in {'POST', 'PUT', 'PATCH'}:
        data = request.get_json(silent=True) if request.is_json else request.form
        if data and data.get('cliente_id'):
            exigir_cliente(data['cliente_id'])
        if request.path.endswith('/caja') or '/caja/' in request.path and request.method == 'PUT':
            if data is not None and not data.get('cliente_id'):
                return jsonify(error='Selecciona un cliente de tu cartera para la orden.'), 400


@contable_bp.before_request
def proteger_cargues_globales():
    vendedor = request.args.get('vendedor_id')
    contacto = request.args.get('contacto_id')
    if vendedor and vendedor != 'sin_asignar' and not vendedor.isdecimal():
        return jsonify(error='Selecciona un vendedor válido.'), 400
    if contacto and not contacto.isdecimal():
        return jsonify(error='Selecciona un contacto válido.'), 400
    if not current_user.is_authenticated or es_administrador():
        return
    if vendedor_actual() is None:
        return jsonify(error='El administrador debe asociar tu usuario a un vendedor activo.'), 403
    if request.method != 'GET' and request.endpoint not in {
        'contable.seguimiento_cartera', 'contable.subir_comprobantes_cartera',
        'contable.chat_cartera', 'contable.responder_chat_cartera',
    }:
        return jsonify(error='La configuración y los cargues globales requieren un administrador.'), 403
