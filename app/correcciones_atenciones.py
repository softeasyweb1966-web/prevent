"""Excel editable de atenciones: identidad firmada, control de versiones y auditoria."""
from datetime import datetime
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from io import BytesIO
import json
from uuid import uuid4

from flask import current_app, jsonify, request, send_file
from flask_login import login_required
from itsdangerous import URLSafeSerializer, URLSafeTimedSerializer, BadSignature
from openpyxl import load_workbook, Workbook
from openpyxl.styles import Font, PatternFill
from sqlalchemy import or_
from werkzeug.exceptions import RequestEntityTooLarge

from app.models import db, AtencionDiaDetalle, AuditLog, PrefacturaComercial, Usuario
from app.routes import comercial_bp

HOJA = 'corregir-atenciones'
CAMPOS = {
    'nro_orden': 'Orden', 'fecha_creacion_orden': 'Fecha atencion',
    'nro_identificacion': 'Documento paciente', 'nombre_paciente': 'Paciente',
    'servicio': 'Examen completo', 'precio': 'Valor examen',
    'forma_pago': 'Forma de pago', 'estado_orden': 'Estado orden',
}
ENCABEZADOS = ['ID atencion', *CAMPOS.values(), 'Control (no modificar)']


def snapshot(reg):
    def valor(v):
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, Decimal):
            return str(v)
        return v
    return {c.name: valor(getattr(reg, c.name)) for c in reg.__table__.columns}


def firma():
    return URLSafeSerializer(current_app.config['SECRET_KEY'], salt='correccion-atencion-v1')


def revision():
    return URLSafeTimedSerializer(current_app.config['SECRET_KEY'], salt='revision-correcciones-v1')


def agregar_hoja_correcciones(wb, registros, desde, hasta):
    ws = wb.create_sheet(HOJA)
    ws.append(ENCABEZADOS)
    for reg in sorted({r.id: r for r in registros}.values(), key=lambda r: r.id):
        original = snapshot(reg)
        control = firma().dumps({'original': original, 'desde': desde.strftime('%Y-%m-%d'),
                                 'hasta': hasta.strftime('%Y-%m-%d')})
        ws.append([reg.id, *[getattr(reg, campo) for campo in CAMPOS], control])
        for cell in ws[ws.max_row]:
            if isinstance(cell.value, str):
                cell.data_type = 's'
        ws.cell(ws.max_row, 3).number_format = 'yyyy-mm-dd hh:mm:ss'
        ws.cell(ws.max_row, 4).number_format = '@'
        ws.cell(ws.max_row, 7).number_format = '#,##0.00'
    ws.freeze_panes = 'D2'
    ws.auto_filter.ref = ws.dimensions
    for cell in ws[1]:
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor='1F4E79')
    for col, width in {'A': 14, 'B': 18, 'C': 23, 'D': 23, 'E': 38, 'F': 55,
                       'G': 18, 'H': 20, 'I': 20}.items():
        ws.column_dimensions[col].width = width
    ws.column_dimensions['J'].hidden = True


def _leer_valor(campo, celda):
    if celda.data_type == 'f':
        raise ValueError('Usa valores, no formulas, en las celdas corregidas')
    valor = celda.value
    if campo == 'fecha_creacion_orden':
        if isinstance(valor, datetime):
            return valor
        for formato in ('%Y-%m-%d', '%d/%m/%Y', '%Y-%m-%d %H:%M:%S'):
            try:
                return datetime.strptime(str(valor).strip(), formato)
            except ValueError:
                pass
        raise ValueError('Fecha invalida; usa una fecha de Excel o DD/MM/AAAA')
    if campo == 'precio':
        try:
            numero = Decimal(str(valor))
            if not numero.is_finite() or numero < 0 or numero >= Decimal('10000000000000'):
                raise ValueError
            if numero != numero.quantize(Decimal('.01')):
                raise ValueError
            return numero.quantize(Decimal('.01'))
        except (ValueError, InvalidOperation):
            raise ValueError('Valor invalido; debe ser un numero no negativo con hasta dos decimales')
    if isinstance(valor, float) and valor.is_integer():
        valor = int(valor)
    texto = str(valor).strip() if valor is not None else ''
    maximo = AtencionDiaDetalle.__table__.columns[campo].type.length
    if not texto or len(texto) > maximo:
        raise ValueError(f'{CAMPOS[campo]} es obligatorio y admite hasta {maximo} caracteres')
    return texto


def _comprobar_editable(reg, scope, fecha=None):
    from app.routes import cargue_atenciones as ca
    ca._asegurar_acceso_registro_atencion(reg, scope)
    if (reg.estado_gestion or '').upper() != 'CARGADA':
        raise ValueError('La atencion ya no esta en estado CARGADA')
    empresa = (PrefacturaComercial.cliente_id == reg.cliente_id if reg.cliente_id is not None
               else PrefacturaComercial.nombre_empresa == (reg.acuerdo_comercial or reg.empresa_mision or 'SIN_EMPRESA'))
    bloqueada = PrefacturaComercial.query.filter(
        empresa, PrefacturaComercial.fecha_desde <= (fecha or reg.fecha_creacion_orden),
        PrefacturaComercial.fecha_hasta >= (fecha or reg.fecha_creacion_orden),
        or_(PrefacturaComercial.estado == 'CERRADA', PrefacturaComercial.bloqueada_por_pago.is_(True),
            PrefacturaComercial.pagos_cartera.any()),
    ).first()
    if bloqueada:
        raise ValueError('La atencion pertenece a una prefactura cerrada o con pagos')


def _leer_archivos(archivos, scope, bloquear=False):
    from app.routes import cargue_atenciones as ca
    cambios, vistos, huellas = [], set(), []
    for archivo in archivos:
        nombre = (archivo.filename or '').replace('\\', '/').split('/')[-1]
        if not nombre.lower().endswith('.xlsx'):
            raise ValueError('Solo se aceptan archivos Excel .xlsx')
        contenido = archivo.read(20 * 1024 * 1024 + 1)
        if len(contenido) > 20 * 1024 * 1024:
            raise ValueError(f'{nombre}: el archivo supera 20 MB')
        huellas.append([nombre, sha256(contenido).hexdigest()])
        try:
            wb = load_workbook(BytesIO(contenido), read_only=True, data_only=False)
        except Exception:
            raise ValueError(f'{nombre}: no se pudo leer el Excel')
        try:
            if HOJA not in wb.sheetnames:
                raise ValueError(f'{nombre}: genera nuevamente el Excel para incluir la hoja {HOJA}')
            ws = wb[HOJA]
            filas = ws.iter_rows()
            if [c.value for c in next(filas, [])] != ENCABEZADOS:
                raise ValueError(f'{nombre}: no modifiques los encabezados de {HOJA}')
            for numero, fila in enumerate(filas, 2):
                if numero > 50001:
                    raise ValueError(f'{nombre}: demasiadas filas; maximo 50000')
                if all(c.value is None for c in fila):
                    continue
                try:
                    firmado = firma().loads(str(fila[9].value))
                    original = firmado['original']
                    reg_id = original['id']
                    if str(fila[0].value) != str(reg_id):
                        raise ValueError('No modifiques el ID de la atencion')
                    if reg_id in vistos:
                        raise ValueError('La misma atencion aparece mas de una vez en los archivos')
                    vistos.add(reg_id)
                    query = AtencionDiaDetalle.query.filter_by(id=reg_id)
                    reg = (query.with_for_update() if bloquear else query).first()
                    if reg is None:
                        raise ValueError('La atencion original ya no existe')
                    ca._asegurar_acceso_registro_atencion(reg, scope)
                    valores = {}
                    for i, campo in enumerate(CAMPOS, 1):
                        # Celdas sin cambios conservan incluso nulos y formatos historicos.
                        previo = original[campo]
                        bruto = fila[i].value
                        if campo == 'fecha_creacion_orden' and isinstance(bruto, datetime) and previo:
                            if abs((bruto - datetime.fromisoformat(previo)).total_seconds()) < .001:
                                continue  # Excel conserva milisegundos, no todos los microsegundos.
                        comparable = bruto.isoformat() if isinstance(bruto, datetime) else str(bruto) if bruto is not None else None
                        if campo == 'precio' and bruto is not None and previo is not None:
                            try:
                                if Decimal(str(bruto)) == Decimal(previo):
                                    continue
                            except InvalidOperation:
                                pass
                        if comparable == previo or (bruto is None and previo == ''):
                            continue
                        valores[campo] = _leer_valor(campo, fila[i])
                    if not valores:
                        continue
                    if snapshot(reg) != original:
                        raise ValueError('La atencion cambio desde la descarga; genera un Excel nuevo')
                    _comprobar_editable(reg, scope)
                    fecha = valores.get('fecha_creacion_orden', reg.fecha_creacion_orden)
                    if not firmado['desde'] <= fecha.strftime('%Y-%m-%d') <= firmado['hasta']:
                        raise ValueError('La fecha corregida debe permanecer dentro del periodo del archivo')
                    _comprobar_editable(reg, scope, fecha)
                    if 'forma_pago' in valores:
                        valores['forma_pago'] = ca._normalizar_forma_pago(valores['forma_pago'])
                        if valores['forma_pago'] not in ('CREDITO', 'EFECTIVO', 'CONTADO', 'PARTICULAR', 'PARTICULARES'):
                            raise ValueError('Forma de pago no admitida para prefacturas')
                    if 'estado_orden' in valores:
                        valores['estado_orden'] = valores['estado_orden'].upper()
                        if valores['estado_orden'] not in ('ACTIVA', 'ANULADA'):
                            raise ValueError('Para corregir el estado usa ACTIVA o ANULADA')
                    cambios.append((reg, valores, original, nombre, firmado))
                except (ValueError, BadSignature) as exc:
                    mensaje = 'El control del registro no es valido; genera un Excel nuevo' if isinstance(exc, BadSignature) else str(exc)
                    raise ValueError(f'{nombre}, fila {numero}: {mensaje}')
        finally:
            wb.close()
    return cambios, huellas


def _resumen(cambios):
    salida = []
    for reg, valores, original, archivo, firmado in cambios:
        for campo, valor in valores.items():
            salida.append({'atencion_id': reg.id, 'empresa': reg.cliente.razon_social if reg.cliente else reg.acuerdo_comercial,
                           'archivo': archivo, 'campo': CAMPOS[campo], 'antes': original[campo],
                           'despues': valor.isoformat() if isinstance(valor, datetime) else str(valor)})
    return salida


def _actualizar_borradores(cambios):
    """Mantener los totales persistidos consistentes, incluso al anular la ultima fila."""
    from app.routes import cargue_atenciones as ca
    catalogo = ca._construir_lookup_catalogo()
    revisadas = set()
    for reg, _, original, _, _ in cambios:
        empresa = reg.cliente.razon_social if reg.cliente else reg.acuerdo_comercial or reg.empresa_mision or 'SIN_EMPRESA'
        fechas = [datetime.fromisoformat(original['fecha_creacion_orden']), reg.fecha_creacion_orden]
        prefs = PrefacturaComercial.query.filter(
            PrefacturaComercial.nombre_empresa == empresa, PrefacturaComercial.estado == 'BORRADOR',
            PrefacturaComercial.origen == 'ATENCIONES',
            PrefacturaComercial.fecha_desde <= max(fechas), PrefacturaComercial.fecha_hasta >= min(fechas),
        ).with_for_update().all()
        for pref in prefs:
            if pref.id in revisadas:
                continue
            revisadas.add(pref.id)
            duplicadas = PrefacturaComercial.query.filter_by(
                nombre_empresa=empresa, fecha_desde=pref.fecha_desde, fecha_hasta=pref.fecha_hasta,
                origen='ATENCIONES').count()
            if duplicadas > 1:
                raise ValueError(f'{empresa}: hay varias prefacturas del mismo periodo; revisalas antes de corregir')
            query = AtencionDiaDetalle.query.filter(
                AtencionDiaDetalle.fecha_creacion_orden >= pref.fecha_desde,
                AtencionDiaDetalle.fecha_creacion_orden <= pref.fecha_hasta)
            if reg.cliente_id is not None:
                query = query.filter(AtencionDiaDetalle.cliente_id == reg.cliente_id)
            else:
                query = query.filter(AtencionDiaDetalle.cliente_id.is_(None))
            elegibles, formas = [], set()
            for fila in query.all():
                nombre = fila.cliente.razon_social if fila.cliente else fila.acuerdo_comercial or fila.empresa_mision or 'SIN_EMPRESA'
                pago = ca._normalizar_forma_pago(fila.forma_pago)
                if nombre != empresa or (fila.estado_orden or '').strip().upper() == 'ANULADA':
                    continue
                if pago not in ('CREDITO', 'CONTADO', 'EFECTIVO', 'PARTICULAR', 'PARTICULARES'):
                    continue
                if ca._clasificar_servicio(fila.servicio, catalogo) == 'ECOBABY' or 'ECOBABY' in (fila.servicio or '').upper():
                    continue
                elegibles.append(fila)
                formas.add('CREDITO' if pago == 'CREDITO' else 'EFECTIVO')
            pref.valor_total = sum((fila.precio or Decimal(0) for fila in elegibles), Decimal(0))
            pref.cant_pacientes = len({(fila.nro_identificacion or '', fila.nombre_paciente or '') for fila in elegibles})
            if formas:
                pref.forma_pago = 'MIXTO' if len(formas) > 1 else next(iter(formas))
            pref.usuario_genera_id = ca.current_user.id


@comercial_bp.route('/atenciones-dia/correcciones-excel', methods=['POST'])
@login_required
def cargar_correcciones_excel():
    from app.routes import cargue_atenciones as ca
    try:
        ca._require_commercial_permission(ca.PERMISO_EDICION_ATENCIONES)
        scope = ca._resolver_vendedor_usuario_actual()
        if not ca._is_admin_user() and scope is None:
            raise PermissionError('No tienes un vendedor asociado')
        archivos = request.files.getlist('archivos')
        if not archivos or len(archivos) > 20:
            raise ValueError('Selecciona entre 1 y 20 archivos Excel')
        aplicar = request.form.get('accion', 'revisar') == 'aplicar'
        cambios, huellas = _leer_archivos(archivos, scope, bloquear=aplicar)
        resumen = _resumen(cambios)
        sello = {'usuario': ca.current_user.id, 'archivos': huellas,
                 'cambios': sha256(json.dumps(resumen, sort_keys=True).encode()).hexdigest()}
        if not aplicar:
            return jsonify(cambios=resumen, atenciones=len(cambios), token=revision().dumps(sello))
        try:
            aprobado = revision().loads(request.form.get('token', ''), max_age=3600)
        except BadSignature:
            raise ValueError('Revisa los archivos de nuevo antes de aplicar los cambios')
        if aprobado != sello:
            raise ValueError('Los archivos o las atenciones cambiaron; revisa nuevamente')
        lote, periodos = str(uuid4()), {}
        for reg, valores, original, archivo, firmado in cambios:
            ca._desvincular_prefacturas_de_atencion(reg)
            for campo, valor in valores.items():
                setattr(reg, campo, valor)
            if 'estado_orden' in valores:
                reg.fecha_anulacion = datetime.utcnow() if reg.estado_orden == 'ANULADA' else None
            db.session.flush()
            ca._sincronizar_cruce_prefacturas_con_atencion(reg)
            nuevo = snapshot(reg)
            empresa = reg.cliente.razon_social if reg.cliente else reg.acuerdo_comercial or reg.empresa_mision or 'SIN_EMPRESA'
            nuevo['_correccion'] = {'archivo': archivo, 'lote': lote, 'empresa': empresa,
                                     'usuario': str(getattr(ca.current_user, 'usuario', ''))}
            db.session.add(AuditLog(usuario_id=ca.current_user.id, tabla=AtencionDiaDetalle.__tablename__,
                                   registro_id=reg.id, accion='CORRECCION_EXCEL', datos_anteriores=original,
                                   datos_nuevos=nuevo, ip_address=request.remote_addr))
            key = (empresa, firmado['desde'], firmado['hasta'])
            periodos[key] = {'empresa': empresa, 'cliente_id': reg.cliente_id,
                            'fecha_desde': firmado['desde'], 'fecha_hasta': firmado['hasta']}
        _actualizar_borradores(cambios)
        db.session.commit()
        return jsonify(actualizadas=len(cambios), lote=lote, periodos=list(periodos.values()))
    except RequestEntityTooLarge:
        db.session.rollback()
        return jsonify(error='Los archivos superan el limite de carga. Divide la carga en grupos mas pequenos'), 413
    except (ValueError, PermissionError) as exc:
        db.session.rollback()
        return jsonify(error=str(exc)), 403 if isinstance(exc, PermissionError) else 400
    except Exception:
        db.session.rollback()
        current_app.logger.exception('Error aplicando correcciones Excel')
        return jsonify(error='No se pudieron guardar las correcciones; no se aplicaron cambios'), 500


@comercial_bp.route('/atenciones-dia/correcciones-informe', methods=['GET'])
@login_required
def informe_correcciones():
    from app.routes import cargue_atenciones as ca
    try:
        ca._require_commercial_permission(ca.PERMISO_CONSULTA_ATENCIONES)
        scope = ca._resolver_vendedor_usuario_actual()
        if not ca._is_admin_user() and scope is None:
            raise PermissionError('No tienes un vendedor asociado')
        query = db.session.query(AuditLog, AtencionDiaDetalle, Usuario).outerjoin(
            AtencionDiaDetalle, AtencionDiaDetalle.id == AuditLog.registro_id
        ).outerjoin(Usuario, Usuario.id == AuditLog.usuario_id).filter(
            AuditLog.tabla == AtencionDiaDetalle.__tablename__, AuditLog.accion == 'CORRECCION_EXCEL')
        if not ca._is_admin_user():
            clientes = ca._clientes_visibles_query(scope).with_entities(ca.ClienteComercial.id)
            query = query.filter(or_(
                AuditLog.datos_anteriores['cliente_id'].as_integer().in_(clientes),
                (AuditLog.datos_anteriores['cliente_id'].as_integer().is_(None)) &
                (AuditLog.datos_anteriores['vendedor_id'].as_integer() == scope.id)))
        for parametro, final in [('desde', False), ('hasta', True)]:
            if request.args.get(parametro):
                fecha = datetime.strptime(request.args[parametro], '%Y-%m-%d')
                if final:
                    fecha = fecha.replace(hour=23, minute=59, second=59, microsecond=999999)
                query = query.filter(AuditLog.created_at <= fecha if final else AuditLog.created_at >= fecha)
        if request.args.get('cliente_id'):
            query = query.filter(AuditLog.datos_anteriores['cliente_id'].as_integer() == int(request.args['cliente_id']))
        pagina = max(1, int(request.args.get('pagina', 1)))
        total = query.count()
        exportar = request.args.get('formato') == 'xlsx'
        query = query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        if not exportar:
            query = query.offset((pagina - 1) * 50).limit(50)
        filas = []
        for log, reg, usuario in query.all():
            anterior, nuevo = log.datos_anteriores or {}, log.datos_nuevos or {}
            meta = nuevo.get('_correccion', {})
            for campo in CAMPOS:
                if anterior.get(campo) == nuevo.get(campo):
                    continue
                filas.append({'fecha': log.created_at.isoformat() + 'Z', 'usuario': meta.get('usuario') or (usuario.usuario if usuario else str(log.usuario_id)),
                              'empresa': meta.get('empresa', ''), 'archivo': meta.get('archivo', ''),
                              'lote': meta.get('lote', ''), 'atencion_id': log.registro_id, 'campo': CAMPOS[campo],
                              'antes': anterior.get(campo), 'despues': nuevo.get(campo)})
        if exportar:
            wb = Workbook()
            ws = wb.active
            ws.title = 'Antes y despues'
            headers = ['fecha', 'usuario', 'empresa', 'archivo', 'lote', 'atencion_id', 'campo', 'antes', 'despues']
            ws.append(headers)
            for fila in filas:
                ws.append([fila[h] for h in headers])
                for cell in ws[ws.max_row]:
                    if isinstance(cell.value, str):
                        cell.data_type = 's'
            ws.freeze_panes = 'A2'
            ws.auto_filter.ref = ws.dimensions
            buf = BytesIO()
            wb.save(buf)
            buf.seek(0)
            return send_file(buf, as_attachment=True, download_name='Correcciones-atenciones.xlsx')
        return jsonify(filas=filas, total=total, pagina=pagina, paginas=(total + 49) // 50)
    except PermissionError as exc:
        return jsonify(error=str(exc)), 403
    except ValueError:
        return jsonify(error='Filtros invalidos'), 400
