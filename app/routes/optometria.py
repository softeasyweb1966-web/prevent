from decimal import Decimal, InvalidOperation
from flask import jsonify, request, send_file
from flask_login import login_required
from io import BytesIO

from app.models import OptometriaPedido, db
from app.routes import optometria_bp


def _money(value):
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, ValueError):
        raise ValueError('Los valores monetarios deben ser numericos.')


def _json(pedido):
    return {
        'id': pedido.id, 'cliente': pedido.cliente, 'nombre_paciente': pedido.nombre_paciente,
        'cedula_paciente': pedido.cedula_paciente, 'celular_paciente': pedido.celular_paciente,
        'telefono_paciente': pedido.telefono_paciente, 'nro_cuotas': pedido.nro_cuotas,
        'valor_cuota': float(pedido.valor_cuota or 0), 'total_venta': float(pedido.total_venta or 0),
        'estado_paciente': pedido.estado_paciente, 'estado_gafas': pedido.estado_gafas,
        'estado_empresa': pedido.estado_empresa,
        'trabajo_realizar': pedido.trabajo_realizar, 'formula_nombre': pedido.formula_nombre,
        'autorizacion_nombre': pedido.autorizacion_nombre,
        'descripcion_marco': pedido.descripcion_marco, 'marco_nombre': pedido.marco_nombre,
        'observaciones': pedido.observaciones, 'created_at': pedido.created_at.isoformat(),
        'formula_url': f'/api/optometria/pedidos/{pedido.id}/archivo/formula' if pedido.formula_archivo else None,
        'autorizacion_url': f'/api/optometria/pedidos/{pedido.id}/archivo/autorizacion' if pedido.autorizacion_archivo else None,
        'marco_url': f'/api/optometria/pedidos/{pedido.id}/archivo/marco' if pedido.marco_archivo else None,
    }


def _apply(pedido, form, files):
    for field in ('cliente', 'nombre_paciente', 'cedula_paciente', 'celular_paciente', 'telefono_paciente',
                  'trabajo_realizar', 'descripcion_marco', 'observaciones'):
        setattr(pedido, field, (form.get(field) or '').strip() or None)
    if not pedido.cliente or not pedido.nombre_paciente or not pedido.cedula_paciente:
        raise ValueError('Cliente, nombre y cedula del paciente son obligatorios.')
    if not pedido.id and not files.get('autorizacion'):
        raise ValueError('Debe adjuntar la autorizacion firmada por el paciente.')
    pedido.nro_cuotas = int(form.get('nro_cuotas') or 1)
    pedido.valor_cuota = _money(form.get('valor_cuota'))
    pedido.total_venta = _money(form.get('total_venta'))
    pedido.estado_paciente = form.get('estado_paciente') or 'PENDIENTE'
    pedido.estado_gafas = form.get('estado_gafas') or 'PENDIENTE'
    pedido.estado_empresa = form.get('estado_empresa') or 'PENDIENTE_COBRO'
    for key, label in (('autorizacion', 'autorizacion'), ('formula', 'formula'), ('marco', 'marco')):
        uploaded = files.get(key)
        if uploaded and uploaded.filename:
            data = uploaded.read()
            if len(data) > 10 * 1024 * 1024:
                raise ValueError('Cada archivo puede pesar maximo 10 MB.')
            setattr(pedido, f'{label}_archivo', data)
            setattr(pedido, f'{label}_nombre', uploaded.filename)
            setattr(pedido, f'{label}_mime', uploaded.mimetype)


@optometria_bp.route('/pedidos', methods=['GET', 'POST'])
@login_required
def pedidos():
    if request.method == 'POST':
        try:
            pedido = OptometriaPedido()
            _apply(pedido, request.form, request.files)
            db.session.add(pedido); db.session.commit()
            return jsonify(_json(pedido)), 201
        except (ValueError, TypeError) as exc:
            db.session.rollback(); return jsonify({'error': str(exc)}), 400
    return jsonify([_json(p) for p in OptometriaPedido.query.order_by(OptometriaPedido.id.desc()).all()])


@optometria_bp.route('/pedidos/<int:pedido_id>', methods=['PUT', 'DELETE'])
@login_required
def pedido_detail(pedido_id):
    pedido = OptometriaPedido.query.get_or_404(pedido_id)
    if request.method == 'DELETE':
        db.session.delete(pedido); db.session.commit(); return jsonify({'ok': True})
    try:
        _apply(pedido, request.form, request.files); db.session.commit(); return jsonify(_json(pedido))
    except (ValueError, TypeError) as exc:
        db.session.rollback(); return jsonify({'error': str(exc)}), 400


@optometria_bp.route('/pedidos/<int:pedido_id>/archivo/<tipo>')
@login_required
def archivo(pedido_id, tipo):
    pedido = OptometriaPedido.query.get_or_404(pedido_id)
    if tipo not in ('autorizacion', 'formula', 'marco') or not getattr(pedido, f'{tipo}_archivo'):
        return jsonify({'error': 'Archivo no encontrado'}), 404
    return send_file(BytesIO(getattr(pedido, f'{tipo}_archivo')), mimetype=getattr(pedido, f'{tipo}_mime') or 'application/octet-stream', download_name=getattr(pedido, f'{tipo}_nombre') or tipo)
