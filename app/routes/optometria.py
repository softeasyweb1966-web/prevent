from decimal import Decimal, InvalidOperation
from flask import jsonify, request, send_file
from flask_login import login_required
from io import BytesIO
from datetime import datetime
import openpyxl

from app.models import OptometriaPedido, OptometriaPedidoItem, db
from app.routes import optometria_bp


def _money(value):
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, ValueError):
        raise ValueError('Los valores monetarios deben ser numericos.')


@optometria_bp.route('/pedidos/importar-excel', methods=['POST'])
@login_required
def importar_excel():
    archivo = request.files.get('archivo')
    cliente = (request.form.get('cliente') or '').strip()
    if not archivo or not archivo.filename.lower().endswith('.xlsx'):
        return jsonify({'error': 'Debe seleccionar un archivo Excel .xlsx.'}), 400
    if not cliente:
        return jsonify({'error': 'Debe indicar la empresa del archivo.'}), 400
    try:
        hoja = openpyxl.load_workbook(archivo, data_only=True, read_only=True).active
        filas = list(hoja.iter_rows(min_row=3, values_only=True))
        existentes = {str(p.cedula_paciente).strip() for p in OptometriaPedido.query.all()}
        grupos = {}
        cargados = omitidos = 0
        errores = []
        for numero, nombre, cedula, cuotas, valor_cuota, total, telefono, trabajo, observaciones, otros in filas:
            if not nombre and not cedula and not numero: continue
            if not nombre or not numero: continue
            nombre = str(nombre).strip()
            cedula = str(cedula).strip() if cedula not in (None, '') else None
            if not cedula:
                errores.append(f'Fila {numero}: falta la cédula de {nombre}.'); continue
            # El archivo representa un solo pedido; sus filas son los items/pacientes.
            grupos.setdefault('1', []).append((nombre, cedula, cuotas, valor_cuota, total, telefono, trabajo, observaciones, otros))
        if errores:
            db.session.rollback(); return jsonify({'error': 'Hay registros sin cédula.', 'errores': errores}), 400
        for filas_pedido in grupos.values():
            nombre, cedula, cuotas, valor_cuota, total, telefono, trabajo, observaciones, otros = filas_pedido[0]
            if cedula in existentes:
                omitidos += len(filas_pedido); continue
            total_pedido = sum((_money(fila[4]) for fila in filas_pedido), Decimal('0'))
            trabajos = [str(fila[6]).strip() for fila in filas_pedido if fila[6] not in (None, '')]
            notas = [' | '.join(str(v).strip() for v in (fila[7], fila[8]) if v not in (None, '')) for fila in filas_pedido]
            pedido = OptometriaPedido(
                cliente=cliente, nombre_paciente=nombre, cedula_paciente=cedula,
                celular_paciente=str(telefono).strip() if telefono not in (None, '') else None,
                nro_cuotas=int(cuotas or 1), valor_cuota=_money(valor_cuota), total_venta=total_pedido,
                estado_paciente='PENDIENTE', estado_gafas='PENDIENTE', estado_empresa='PENDIENTE_COBRO',
                trabajo_realizar=' | '.join(trabajos) or None,
                observaciones=' | '.join(n for n in notas if n) or None,
                created_at=datetime.utcnow(), updated_at=datetime.utcnow())
            db.session.add(pedido); db.session.flush()
            for fila in filas_pedido:
                db.session.add(OptometriaPedidoItem(
                    pedido_id=pedido.id, descripcion=str(fila[6] or 'Trabajo de optometria').strip(),
                    cantidad=1, valor_unitario=_money(fila[4]), total=_money(fila[4]),
                    observaciones=' | '.join(str(v).strip() for v in (fila[7], fila[8]) if v not in (None, '')) or None))
            existentes.add(cedula); cargados += 1
        db.session.commit()
        return jsonify({'cargados': cargados, 'omitidos': omitidos, 'errores': []}), 201
    except Exception as exc:
        db.session.rollback(); return jsonify({'error': f'No fue posible leer el Excel: {exc}'}), 400


def _json(pedido):
    return {
        'id': pedido.id, 'nro_pedido': pedido.nro_pedido, 'cliente': pedido.cliente, 'nombre_paciente': pedido.nombre_paciente,
        'cedula_paciente': pedido.cedula_paciente, 'celular_paciente': pedido.celular_paciente,
        'telefono_paciente': pedido.telefono_paciente, 'nro_cuotas': pedido.nro_cuotas,
        'valor_cuota': float(pedido.valor_cuota or 0), 'total_venta': float(pedido.total_venta or 0),
        'estado_paciente': pedido.estado_paciente, 'estado_gafas': pedido.estado_gafas,
        'estado_empresa': pedido.estado_empresa,
        'trabajo_realizar': pedido.trabajo_realizar, 'formula_nombre': pedido.formula_nombre,
        'autorizacion_nombre': pedido.autorizacion_nombre,
        'descripcion_marco': pedido.descripcion_marco, 'marco_nombre': pedido.marco_nombre,
        'observaciones': pedido.observaciones, 'created_at': pedido.created_at.isoformat(),
        'items': [{'id': i.id, 'descripcion': i.descripcion, 'cantidad': i.cantidad, 'valor_unitario': float(i.valor_unitario or 0), 'total': float(i.total or 0), 'observaciones': i.observaciones} for i in pedido.items],
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
            db.session.add(pedido); db.session.flush()
            if pedido.trabajo_realizar:
                db.session.add(OptometriaPedidoItem(pedido_id=pedido.id, descripcion=pedido.trabajo_realizar, cantidad=1, valor_unitario=pedido.total_venta, total=pedido.total_venta, observaciones=pedido.observaciones))
            db.session.commit()
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
