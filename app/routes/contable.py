"""Importación y consulta de la información contable exportada desde SIIGO."""

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from io import BytesIO
import re
import unicodedata

from flask import jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import func, or_

from app.models import (
    SiigoCarga,
    SiigoCliente,
    SiigoComprobante,
    SiigoCuentaContable,
    SiigoMovimiento,
    db,
)
from app.routes import contable_bp
from app.security import get_permission_names_for_user


TIPOS_COMPROBANTE_PERMITIDOS = {'FV', 'RC', 'NC', 'ND'}


def _texto(value):
    return str(value).strip() if value is not None else ''


def _normalizar(value):
    text = unicodedata.normalize('NFD', _texto(value).lower())
    return ''.join(char for char in text if unicodedata.category(char) != 'Mn')


def _decimal(value):
    if value in (None, ''):
        return Decimal('0')
    try:
        return Decimal(str(value).replace(',', '.'))
    except InvalidOperation as exc:
        raise ValueError(f'Valor monetario inválido: {value}') from exc


def _fecha(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    for formato in ('%d/%m/%Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(_texto(value), formato).date()
        except ValueError:
            continue
    raise ValueError(f'Fecha inválida: {value}')


def _puede_usar_ventas():
    if getattr(current_user, 'is_easy', False) or getattr(getattr(current_user, 'role', None), 'nombre', None) == 'Administrador':
        return True
    return 'menu_ventas' in get_permission_names_for_user(current_user)


def _requiere_ventas():
    if not _puede_usar_ventas():
        raise PermissionError('No tienes permiso para consultar o cargar información de ventas.')


def _leer_excel():
    archivo = request.files.get('archivo')
    if archivo is None or not archivo.filename:
        raise ValueError('Debe seleccionar un archivo Excel.')
    if not archivo.filename.lower().endswith('.xlsx'):
        raise ValueError('Solo se aceptan archivos .xlsx.')

    contenido = archivo.read()
    if not contenido:
        raise ValueError('El archivo está vacío.')
    try:
        import openpyxl
        libro = openpyxl.load_workbook(BytesIO(contenido), read_only=True, data_only=True)
        filas = list(libro.active.iter_rows(values_only=True))
        libro.close()
    except Exception as exc:
        raise ValueError(f'No fue posible leer el archivo Excel: {exc}') from exc
    return archivo.filename, contenido, filas


def _indice_encabezados(filas, requeridos):
    required = {_normalizar(value) for value in requeridos}
    for index, fila in enumerate(filas):
        headers = [_normalizar(value) for value in fila]
        if required.issubset(set(headers)):
            return index, {header: position for position, header in enumerate(headers) if header}
    raise ValueError(f'No se encontraron las columnas requeridas: {", ".join(requeridos)}.')


def _valor(fila, columns, name):
    index = columns.get(_normalizar(name))
    return fila[index] if index is not None and index < len(fila) else None


def _crear_carga(tipo_archivo, nombre_archivo, contenido):
    digest = sha256(contenido).hexdigest()
    existente = SiigoCarga.query.filter_by(hash_archivo=digest).first()
    if existente:
        raise ValueError(f'Este archivo ya fue cargado el {existente.created_at:%Y-%m-%d %H:%M}.')
    carga = SiigoCarga(
        tipo_archivo=tipo_archivo,
        nombre_archivo=nombre_archivo,
        hash_archivo=digest,
        usuario_id=current_user.id,
    )
    db.session.add(carga)
    db.session.flush()
    return carga


def _extraer_comprobantes(filas, inicio):
    """Agrupa las secuencias de SIIGO bajo su fila separadora de comprobante."""
    actual = None
    for fila in filas[inicio:]:
        first = _texto(fila[0] if fila else None)
        if first.startswith('Comprobante:'):
            if actual and actual['lineas']:
                yield actual
            match = re.match(r'^Comprobante:\s*([^\-\s]+)-([^\-\s]+)-(.+?)\s*$', first)
            if not match:
                raise ValueError(f'Formato de comprobante no reconocido: {first}')
            tipo, codigo, numero = (group.strip() for group in match.groups())
            actual = {'tipo': tipo, 'codigo': codigo, 'numero': numero, 'lineas': []}
        elif actual and isinstance(fila[0] if fila else None, (int, float)):
            actual['lineas'].append(fila)
    if actual and actual['lineas']:
        yield actual


def _guardar_comprobantes_en_lote(carga, filas, header_row, columns):
    """Evita miles de consultas individuales que pueden agotar el tiempo web."""
    documentos = list(_extraer_comprobantes(filas, header_row + 1))
    permitidos = [documento for documento in documentos if documento['tipo'] in TIPOS_COMPROBANTE_PERMITIDOS]
    existentes = {
        (tipo, codigo, numero)
        for tipo, codigo, numero in db.session.query(
            SiigoComprobante.tipo_documento,
            SiigoComprobante.codigo_comprobante,
            SiigoComprobante.numero_comprobante,
        ).filter(SiigoComprobante.tipo_documento.in_(TIPOS_COMPROBANTE_PERMITIDOS)).all()
    }
    imported = movements = 0
    total_debito = total_credito = Decimal('0')

    for documento in permitidos:
        key = (documento['tipo'], documento['codigo'], documento['numero'])
        if key in existentes:
            continue
        fecha = _fecha(_valor(documento['lineas'][0], columns, 'Fecha elaboracion'))
        document_debito = sum((_decimal(_valor(line, columns, 'Debito')) for line in documento['lineas']), Decimal('0'))
        document_credito = sum((_decimal(_valor(line, columns, 'Credito')) for line in documento['lineas']), Decimal('0'))
        if document_debito.quantize(Decimal('0.01')) != document_credito.quantize(Decimal('0.01')):
            reference = '-'.join(key)
            raise ValueError(f'El comprobante {reference} no cuadra: dÃ©bito {document_debito} / crÃ©dito {document_credito}.')

        comprobante = SiigoComprobante(
            tipo_documento=documento['tipo'], codigo_comprobante=documento['codigo'], numero_comprobante=documento['numero'],
            fecha_elaboracion=fecha, total_debito=document_debito, total_credito=document_credito, carga_id=carga.id,
        )
        for line in documento['lineas']:
            comprobante.movimientos.append(SiigoMovimiento(
                secuencia=int(_valor(line, columns, 'Secuencia')),
                codigo_contable=_texto(_valor(line, columns, 'Codigo contable')),
                cuenta_contable=_texto(_valor(line, columns, 'Cuenta contable')),
                identificacion=_texto(_valor(line, columns, 'Identificacion')) or None,
                sucursal=_texto(_valor(line, columns, 'Sucursal')) or None,
                nombre_tercero=_texto(_valor(line, columns, 'Nombre tercero')) or None,
                descripcion=_texto(_valor(line, columns, 'Descripcion')) or None,
                detalle=_texto(_valor(line, columns, 'Detalle')) or None,
                centro_costo=_texto(_valor(line, columns, 'Centro de costo')) or None,
                debito=_decimal(_valor(line, columns, 'Debito')),
                credito=_decimal(_valor(line, columns, 'Credito')),
            ))
            movements += 1
        db.session.add(comprobante)
        existentes.add(key)
        imported += 1
        total_debito += document_debito
        total_credito += document_credito

    carga.registros_leidos = len(documentos)
    carga.registros_importados = imported
    carga.registros_omitidos = len(documentos) - imported
    carga.total_debito = total_debito
    carga.total_credito = total_credito
    db.session.commit()
    return jsonify({'mensaje': 'Comprobantes cargados correctamente.', 'comprobantes': imported, 'movimientos': movements, 'omitidos': carga.registros_omitidos})


@contable_bp.route('/resumen', methods=['GET'])
@login_required
def resumen():
    try:
        _requiere_ventas()
        return jsonify({
            'clientes': SiigoCliente.query.count(),
            'cuentas': SiigoCuentaContable.query.count(),
            'comprobantes': SiigoComprobante.query.count(),
            'movimientos': SiigoMovimiento.query.count(),
            'cargas': SiigoCarga.query.order_by(SiigoCarga.created_at.desc()).limit(8).all() and [
                {
                    'tipo': carga.tipo_archivo,
                    'archivo': carga.nombre_archivo,
                    'fecha': carga.created_at.strftime('%Y-%m-%d %H:%M'),
                    'importados': carga.registros_importados,
                    'omitidos': carga.registros_omitidos,
                }
                for carga in SiigoCarga.query.order_by(SiigoCarga.created_at.desc()).limit(8).all()
            ],
        })
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403


@contable_bp.route('/cargar-clientes', methods=['POST'])
@login_required
def cargar_clientes():
    try:
        _requiere_ventas()
        nombre_archivo, contenido, filas = _leer_excel()
        header_row, columns = _indice_encabezados(filas, ['Nombre tercero', 'Identificación', 'Sucursal'])
        carga = _crear_carga('CLIENTES', nombre_archivo, contenido)
        creados = actualizados = 0

        for fila in filas[header_row + 1:]:
            identificacion = _texto(_valor(fila, columns, 'Identificación'))
            nombre = _texto(_valor(fila, columns, 'Nombre tercero'))
            if not identificacion or not nombre:
                continue
            sucursal = _texto(_valor(fila, columns, 'Sucursal')) or '0'
            cliente = SiigoCliente.query.filter_by(identificacion=identificacion, sucursal=sucursal).first()
            fields = {
                'tipo_identificacion': _texto(_valor(fila, columns, 'Tipo de identificación')) or None,
                'digito_verificacion': _texto(_valor(fila, columns, 'Digito verificación')) or None,
                'nombre': nombre,
                'direccion': _texto(_valor(fila, columns, 'Dirección')) or None,
                'ciudad': _texto(_valor(fila, columns, 'Ciudad')) or None,
                'telefono': _texto(_valor(fila, columns, 'Teléfono.')) or None,
                'estado': _texto(_valor(fila, columns, 'Estado')) or None,
                'carga_id': carga.id,
            }
            if cliente is None:
                cliente = SiigoCliente(identificacion=identificacion, sucursal=sucursal, **fields)
                db.session.add(cliente)
                creados += 1
            else:
                for field, value in fields.items():
                    setattr(cliente, field, value)
                actualizados += 1

        carga.registros_leidos = len(filas) - header_row - 1
        carga.registros_importados = creados + actualizados
        db.session.commit()
        return jsonify({'mensaje': 'Clientes cargados correctamente.', 'creados': creados, 'actualizados': actualizados})
    except (ValueError, PermissionError) as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400 if isinstance(exc, ValueError) else 403
    except Exception as exc:
        db.session.rollback()
        return jsonify({'error': f'No fue posible cargar clientes: {exc}'}), 500


@contable_bp.route('/cargar-cuentas', methods=['POST'])
@login_required
def cargar_cuentas():
    try:
        _requiere_ventas()
        nombre_archivo, contenido, filas = _leer_excel()
        header_row, columns = _indice_encabezados(filas, ['Código', 'Nombre'])
        carga = _crear_carga('CUENTAS', nombre_archivo, contenido)
        creados = actualizados = 0

        for fila in filas[header_row + 1:]:
            codigo = _texto(_valor(fila, columns, 'Código'))
            nombre = _texto(_valor(fila, columns, 'Nombre'))
            if not codigo or not nombre:
                continue
            cuenta = SiigoCuentaContable.query.filter_by(codigo=codigo).first()
            fields = {
                'nombre': nombre,
                'categoria': _texto(_valor(fila, columns, 'Categoría')) or None,
                'clase': _texto(_valor(fila, columns, 'Clase')) or None,
                'relacion_con': _texto(_valor(fila, columns, 'Relación con')) or None,
                'maneja_vencimientos': _texto(_valor(fila, columns, 'Maneja vencimientos')) or None,
                'activo': _normalizar(_valor(fila, columns, 'Activo')) in {'si', 'sí', 'true', '1'},
                'carga_id': carga.id,
            }
            if cuenta is None:
                db.session.add(SiigoCuentaContable(codigo=codigo, **fields))
                creados += 1
            else:
                for field, value in fields.items():
                    setattr(cuenta, field, value)
                actualizados += 1

        carga.registros_leidos = len(filas) - header_row - 1
        carga.registros_importados = creados + actualizados
        db.session.commit()
        return jsonify({'mensaje': 'Plan de cuentas cargado correctamente.', 'creados': creados, 'actualizados': actualizados})
    except (ValueError, PermissionError) as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400 if isinstance(exc, ValueError) else 403
    except Exception as exc:
        db.session.rollback()
        return jsonify({'error': f'No fue posible cargar cuentas: {exc}'}), 500


@contable_bp.route('/cargar-comprobantes', methods=['POST'])
@login_required
def cargar_comprobantes():
    try:
        _requiere_ventas()
        nombre_archivo, contenido, filas = _leer_excel()
        header_row, columns = _indice_encabezados(filas, ['Secuencia', 'Fecha elaboración', 'Código contable', 'Débito', 'Crédito'])
        carga = _crear_carga('COMPROBANTES', nombre_archivo, contenido)
        return _guardar_comprobantes_en_lote(carga, filas, header_row, columns)

        current = None
        imported = omitted = movements = 0
        total_debito = total_credito = Decimal('0')

        for row_index, fila in enumerate(filas[header_row + 1:], start=header_row + 1):
            first = _texto(fila[0] if fila else None)
            if first.startswith('Comprobante:'):
                match = re.match(r'^Comprobante:\s*([^-\s]+)-([^-\s]+)-(.+?)\s*$', first)
                if not match:
                    raise ValueError(f'Formato de comprobante no reconocido: {first}')
                tipo, codigo, numero = (group.strip() for group in match.groups())
                current = {'tipo': tipo, 'codigo': codigo, 'numero': numero, 'lines': []}
                continue

            if not isinstance(fila[0] if fila else None, (int, float)):
                continue
            if current is None:
                raise ValueError('Se encontró una secuencia sin comprobante asociado.')
            current['lines'].append(fila)

            # El bloque se procesa al encontrar el siguiente encabezado o al final.
            # Una secuencia termina cuando la siguiente fila deja de ser numérica.
            # SIIGO puede insertar una fila vacía o un pie de página al final del archivo.
            next_row = filas[row_index + 1] if row_index + 1 < len(filas) else None
            if next_row is not None and isinstance(next_row[0] if next_row else None, (int, float)):
                continue
            if current['tipo'] not in TIPOS_COMPROBANTE_PERMITIDOS:
                omitted += 1
                current = None
                continue

            existing = SiigoComprobante.query.filter_by(
                tipo_documento=current['tipo'],
                codigo_comprobante=current['codigo'],
                numero_comprobante=current['numero'],
            ).first()
            if existing:
                omitted += 1
                current = None
                continue

            fecha = _fecha(_valor(current['lines'][0], columns, 'Fecha elaboración'))
            document_debito = sum((_decimal(_valor(line, columns, 'Débito')) for line in current['lines']), Decimal('0'))
            document_credito = sum((_decimal(_valor(line, columns, 'Crédito')) for line in current['lines']), Decimal('0'))
            if document_debito.quantize(Decimal('0.01')) != document_credito.quantize(Decimal('0.01')):
                raise ValueError(f"El comprobante {first} no cuadra: débito {document_debito} / crédito {document_credito}.")

            comprobante = SiigoComprobante(
                tipo_documento=current['tipo'], codigo_comprobante=current['codigo'], numero_comprobante=current['numero'],
                fecha_elaboracion=fecha, total_debito=document_debito, total_credito=document_credito, carga_id=carga.id,
            )
            db.session.add(comprobante)
            db.session.flush()
            for line in current['lines']:
                db.session.add(SiigoMovimiento(
                    comprobante_id=comprobante.id,
                    secuencia=int(_valor(line, columns, 'Secuencia')),
                    codigo_contable=_texto(_valor(line, columns, 'Código contable')),
                    cuenta_contable=_texto(_valor(line, columns, 'Cuenta contable')),
                    identificacion=_texto(_valor(line, columns, 'Identificación')) or None,
                    sucursal=_texto(_valor(line, columns, 'Sucursal')) or None,
                    nombre_tercero=_texto(_valor(line, columns, 'Nombre tercero')) or None,
                    descripcion=_texto(_valor(line, columns, 'Descripción')) or None,
                    detalle=_texto(_valor(line, columns, 'Detalle')) or None,
                    centro_costo=_texto(_valor(line, columns, 'Centro de costo')) or None,
                    debito=_decimal(_valor(line, columns, 'Débito')),
                    credito=_decimal(_valor(line, columns, 'Crédito')),
                ))
                movements += 1
            imported += 1
            total_debito += document_debito
            total_credito += document_credito
            current = None

        carga.registros_leidos = imported + omitted
        carga.registros_importados = imported
        carga.registros_omitidos = omitted
        carga.total_debito = total_debito
        carga.total_credito = total_credito
        db.session.commit()
        return jsonify({'mensaje': 'Comprobantes cargados correctamente.', 'comprobantes': imported, 'movimientos': movements, 'omitidos': omitted})
    except (ValueError, PermissionError) as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400 if isinstance(exc, ValueError) else 403
    except Exception as exc:
        db.session.rollback()
        return jsonify({'error': f'No fue posible cargar comprobantes: {exc}'}), 500


@contable_bp.route('/clientes', methods=['GET'])
@login_required
def consultar_clientes():
    try:
        _requiere_ventas()
        search = _texto(request.args.get('q'))
        query = SiigoCliente.query
        if search:
            like = f'%{search}%'
            query = query.filter(or_(SiigoCliente.identificacion.ilike(like), SiigoCliente.nombre.ilike(like)))
        items = query.order_by(SiigoCliente.nombre).limit(100).all()
        clientes = [{'identificacion': item.identificacion, 'sucursal': item.sucursal, 'nombre': item.nombre, 'ciudad': item.ciudad, 'estado': item.estado} for item in items]
        if not clientes:
            # Los comprobantes permiten buscar terceros incluso si el catálogo aún no se ha cargado.
            terceros = db.session.query(
                SiigoMovimiento.identificacion,
                SiigoMovimiento.sucursal,
                SiigoMovimiento.nombre_tercero,
            ).filter(SiigoMovimiento.identificacion.isnot(None))
            if search:
                like = f'%{search}%'
                terceros = terceros.filter(or_(SiigoMovimiento.identificacion.ilike(like), SiigoMovimiento.nombre_tercero.ilike(like)))
            clientes = [
                {'identificacion': identificacion, 'sucursal': sucursal or '0', 'nombre': nombre or '', 'ciudad': None, 'estado': None}
                for identificacion, sucursal, nombre in terceros.distinct().order_by(SiigoMovimiento.nombre_tercero).limit(100).all()
            ]
        return jsonify({'clientes': clientes})
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403


@contable_bp.route('/comprobantes', methods=['GET'])
@login_required
def consultar_comprobantes():
    try:
        _requiere_ventas()
        query = SiigoComprobante.query
        tipo = _texto(request.args.get('tipo')).upper()
        numero = _texto(request.args.get('numero'))
        desde = _texto(request.args.get('desde'))
        hasta = _texto(request.args.get('hasta'))
        cliente = _texto(request.args.get('cliente'))
        if tipo:
            query = query.filter_by(tipo_documento=tipo)
        if numero:
            query = query.filter(SiigoComprobante.numero_comprobante.ilike(f'%{numero}%'))
        if desde:
            query = query.filter(SiigoComprobante.fecha_elaboracion >= _fecha(desde))
        if hasta:
            query = query.filter(SiigoComprobante.fecha_elaboracion <= _fecha(hasta))
        if cliente:
            like = f'%{cliente}%'
            query = query.join(SiigoMovimiento).filter(or_(SiigoMovimiento.identificacion.ilike(like), SiigoMovimiento.nombre_tercero.ilike(like))).distinct()
        items = query.order_by(SiigoComprobante.fecha_elaboracion.desc()).limit(200).all()
        return jsonify({'comprobantes': [{
            'tipo': item.tipo_documento, 'codigo': item.codigo_comprobante, 'numero': item.numero_comprobante,
            'fecha': item.fecha_elaboracion.isoformat(), 'debito': float(item.total_debito), 'credito': float(item.total_credito),
            'movimientos': len(item.movimientos),
        } for item in items]})
    except (ValueError, PermissionError) as exc:
        return jsonify({'error': str(exc)}), 400 if isinstance(exc, ValueError) else 403


@contable_bp.route('/comparativo-clientes', methods=['GET'])
@login_required
def comparativo_clientes():
    try:
        _requiere_ventas()
        periodo_a_desde = _fecha(request.args.get('periodo_a_desde'))
        periodo_a_hasta = _fecha(request.args.get('periodo_a_hasta'))
        periodo_b_desde = _fecha(request.args.get('periodo_b_desde'))
        periodo_b_hasta = _fecha(request.args.get('periodo_b_hasta'))
        if periodo_a_desde > periodo_a_hasta or periodo_b_desde > periodo_b_hasta:
            raise ValueError('La fecha inicial no puede ser posterior a la fecha final.')

        def terceros_del_periodo(desde, hasta):
            rows = db.session.query(
                SiigoMovimiento.identificacion,
                func.max(SiigoMovimiento.nombre_tercero),
                func.count(func.distinct(SiigoComprobante.id)),
            ).join(SiigoComprobante).filter(
                SiigoComprobante.tipo_documento == 'FV',
                SiigoComprobante.fecha_elaboracion.between(desde, hasta),
                SiigoMovimiento.identificacion.isnot(None),
            ).group_by(SiigoMovimiento.identificacion).all()
            return {
                identificacion: {'identificacion': identificacion, 'nombre': nombre or '', 'facturas': int(facturas)}
                for identificacion, nombre, facturas in rows
            }

        periodo_a = terceros_del_periodo(periodo_a_desde, periodo_a_hasta)
        periodo_b = terceros_del_periodo(periodo_b_desde, periodo_b_hasta)
        nuevos = sorted((periodo_b[key] for key in periodo_b.keys() - periodo_a.keys()), key=lambda item: item['nombre'])
        no_volvieron = sorted((periodo_a[key] for key in periodo_a.keys() - periodo_b.keys()), key=lambda item: item['nombre'])
        return jsonify({
            'clientes_periodo_a': len(periodo_a),
            'clientes_periodo_b': len(periodo_b),
            'nuevos': nuevos,
            'no_volvieron': no_volvieron,
        })
    except (ValueError, PermissionError) as exc:
        return jsonify({'error': str(exc)}), 400 if isinstance(exc, ValueError) else 403
