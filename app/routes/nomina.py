from flask import request, jsonify
from app.routes import nomina_bp
from app.models import db, Empleado, Novedad, NovedadAplicada, TipoNovedad, Quincena, LiquidoQuincena, Pago, ConceptoAutomatico, ParametroDescuento
from flask_login import login_required, current_user
from datetime import datetime, timedelta
from decimal import Decimal
import logging

logger = logging.getLogger(__name__)

# ==================== EMPLEADOS ====================

@nomina_bp.route('/empleados', methods=['GET'])
@login_required
def get_empleados():
    """Obtener lista de empleados"""
    try:
        activos_only = request.args.get('activos', 'true').lower() == 'true'
        
        query = Empleado.query
        if activos_only:
            query = query.filter_by(activo=True)
        
        empleados = query.all()
        
        datos = [{
            'id': e.id,
            'cedula': e.nro_documento,
            'nro_documento': e.nro_documento,
            'nombres': e.nombres,
            'apellidos': e.apellidos,
            'nombre_completo': f"{e.nombres} {e.apellidos}",
            'cargo': e.cargo,
            'forma_pago': e.forma_pago,
            'dia_pago': e.dia_pago,
            'sueldo_base': float(e.sueldo_base),
            'sueldo_quincena': float(e.sueldo_base) / 2 if e.forma_pago == 'QUINCENAL' else float(e.sueldo_base),
            'planilla_afiliado': e.planilla_afiliado,
            'activo': e.activo,
            'fecha_inicio': e.fecha_inicio.strftime('%Y-%m-%d'),
            'fecha_ingreso': e.fecha_inicio.strftime('%Y-%m-%d'),
            'fecha_retiro': e.fecha_retiro.strftime('%Y-%m-%d') if e.fecha_retiro else None
        } for e in empleados]
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo empleados: {str(e)}")
        return jsonify({'error': 'Error al obtener empleados'}), 500


@nomina_bp.route('/empleados', methods=['POST'])
@login_required
def crear_empleado():
    """Crear nuevo empleado"""
    data = request.get_json()
    
    try:
        # Validar que el documento sea único
        if Empleado.query.filter_by(nro_documento=data.get('nro_documento')).first():
            return jsonify({'error': 'El documento ya está registrado'}), 409
        
        # Usar fecha_ingreso si se envía, si no fecha_inicio
        fecha = data.get('fecha_ingreso') or data.get('fecha_inicio')
        
        empleado = Empleado(
            nro_documento=data.get('nro_documento'),
            nombres=data.get('nombres'),
            apellidos=data.get('apellidos'),
            cargo=data.get('cargo', 'Sin cargo'),
            forma_pago=data.get('forma_pago', 'QUINCENAL'),
            dia_pago=data.get('dia_pago'),
            sueldo_base=Decimal(str(data.get('sueldo_base'))),
            planilla_afiliado=data.get('planilla_afiliado', False),
            banco=data.get('banco'),
            numero_cuenta=data.get('numero_cuenta'),
            fecha_inicio=datetime.fromisoformat(fecha) if isinstance(fecha, str) else fecha,
            activo=data.get('activo', True)
        )
        
        db.session.add(empleado)
        db.session.commit()
        
        logger.info(f"Empleado creado: {empleado.nro_documento}")
        return jsonify({'mensaje': 'Empleado creado', 'id': empleado.id}), 201
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error creando empleado: {str(e)}")
        return jsonify({'error': 'Error al crear empleado'}), 500


@nomina_bp.route('/empleados/<int:empleado_id>', methods=['GET'])
@login_required
def get_empleado(empleado_id):
    """Obtener detalle de un empleado"""
    try:
        empleado = Empleado.query.get_or_404(empleado_id)
        
        datos = {
            'id': empleado.id,
            'nro_documento': empleado.nro_documento,
            'nombres': empleado.nombres,
            'apellidos': empleado.apellidos,
            'cargo': empleado.cargo,
            'forma_pago': empleado.forma_pago,
            'dia_pago': empleado.dia_pago,
            'sueldo_base': float(empleado.sueldo_base),
            'planilla_afiliado': empleado.planilla_afiliado,
            'banco': empleado.banco,
            'numero_cuenta': empleado.numero_cuenta,
            'fecha_inicio': empleado.fecha_inicio.strftime('%Y-%m-%d'),
            'fecha_ingreso': empleado.fecha_inicio.strftime('%Y-%m-%d'),
            'fecha_retiro': empleado.fecha_retiro.strftime('%Y-%m-%d') if empleado.fecha_retiro else None,
            'activo': empleado.activo
        }
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo empleado: {str(e)}")
        return jsonify({'error': 'Error al obtener empleado'}), 500


@nomina_bp.route('/empleados/<int:empleado_id>', methods=['PUT'])
@login_required
def actualizar_empleado(empleado_id):
    """Actualizar empleado"""
    data = request.get_json()
    
    try:
        empleado = Empleado.query.get_or_404(empleado_id)
        
        # Actualizar campos
        empleado.nombres = data.get('nombres', empleado.nombres)
        empleado.apellidos = data.get('apellidos', empleado.apellidos)
        empleado.cargo = data.get('cargo', empleado.cargo)
        empleado.forma_pago = data.get('forma_pago', empleado.forma_pago)
        empleado.dia_pago = data.get('dia_pago', empleado.dia_pago)
        empleado.sueldo_base = Decimal(str(data.get('sueldo_base', empleado.sueldo_base)))
        empleado.planilla_afiliado = data.get('planilla_afiliado', empleado.planilla_afiliado)
        empleado.banco = data.get('banco', empleado.banco)
        empleado.numero_cuenta = data.get('numero_cuenta', empleado.numero_cuenta)

        # Permitir actualizar fecha de ingreso/inicio si viene en la petición
        # Usar fecha_ingreso si se envía, si no fecha_inicio
        fecha = data.get('fecha_ingreso') or data.get('fecha_inicio')
        if fecha:
            empleado.fecha_inicio = datetime.fromisoformat(fecha) if isinstance(fecha, str) else fecha
        
        # Permitir actualizar estado activo
        if 'activo' in data:
            empleado.activo = data.get('activo')
        
        db.session.commit()
        logger.info(f"Empleado actualizado: {empleado.nro_documento}")
        
        return jsonify({'mensaje': 'Empleado actualizado'}), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error actualizando empleado: {str(e)}")
        return jsonify({'error': 'Error al actualizar empleado'}), 500


@nomina_bp.route('/empleados/<int:empleado_id>', methods=['DELETE'])
@login_required
def eliminar_empleado(empleado_id):
    """Eliminar (desactivar) empleado"""
    try:
        empleado = Empleado.query.get_or_404(empleado_id)
        
        # En lugar de eliminar, desactivamos el empleado
        empleado.activo = False
        empleado.fecha_retiro = datetime.utcnow()
        
        db.session.commit()
        logger.info(f"Empleado desactivado: {empleado.nro_documento}")
        
        return jsonify({'mensaje': 'Empleado desactivado'}), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error eliminando empleado: {str(e)}")
        return jsonify({'error': 'Error al eliminar empleado'}), 500


# ==================== NOVEDADES ====================

@nomina_bp.route('/tipos-novedad', methods=['GET'])
@login_required
def get_tipos_novedad():
    """Obtener tipos de novedad"""
    try:
        # Si se pasa ?todos=true se devuelven activos e inactivos (para pantallas de configuración)
        todos = request.args.get('todos', 'false').lower() == 'true'

        if todos:
            tipos = TipoNovedad.query.all()
        else:
            tipos = TipoNovedad.query.filter_by(activo=True).all()

        # Si no hay tipos activos y la tabla está vacía, inicializar
        if not tipos:
            total_tipos = TipoNovedad.query.count()
            if total_tipos == 0:
                logger.info("Inicializando tipos de novedad por defecto")
                defaults = [
                    # nombre, tipo_movimiento, categoria, tipo_funcional, requiere_autorizacion, descripcion
                    # Por defecto, la mayoría son movimientos de PERIODO; Préstamo se modela como RECURRENTE.
                    ('Anticipo', 'CREDITO', 'ANTICIPO', 'PERIODO', False, 'Anticipo de salario'),
                    ('Préstamo', 'CREDITO', 'PRESTAMO', 'RECURRENTE', True, 'Préstamo a empleado'),
                    ('Hora Extra', 'DEBITO', 'INGRESO_EXTRA', 'PERIODO', False, 'Hora extra autorizada'),
                    ('Incapacidad', 'DEBITO', 'INCAPACIDAD', 'PERIODO', True, 'Incapacidad médica'),
                    ('Licencia', 'DEBITO', 'LICENCIA', 'PERIODO', True, 'Licencia autorizada'),
                    ('Pensión', 'CREDITO', 'AUTOMATICO', 'PERIODO', False, 'Aporte pensión (automático)'),
                    ('Salud', 'CREDITO', 'AUTOMATICO', 'PERIODO', False, 'Aporte salud (automático)'),
                    ('Caja Compensación', 'CREDITO', 'AUTOMATICO', 'PERIODO', False, 'Caja de compensación (automático)')
                ]

                for nombre, tipo_mov, categoria, tipo_funcional, requiere_auth, desc in defaults:
                    if not TipoNovedad.query.filter_by(nombre=nombre).first():
                        db.session.add(TipoNovedad(
                            nombre=nombre,
                            tipo_movimiento=tipo_mov,
                            categoria=categoria,
                            tipo_funcional=tipo_funcional,
                            requiere_autorizacion=requiere_auth,
                            descripcion=desc,
                            activo=True
                        ))
                db.session.commit()
                tipos = TipoNovedad.query.filter_by(activo=True).all()
        
        datos = [{
            'id': t.id,
            'nombre': t.nombre,
            'tipo_movimiento': t.tipo_movimiento,
            'categoria': t.categoria,
            'tipo_funcional': getattr(t, 'tipo_funcional', 'PERIODO'),
            'requiere_autorizacion': t.requiere_autorizacion,
            'descripcion': t.descripcion,
            'activo': t.activo
        } for t in tipos]
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo tipos de novedad: {str(e)}")
        return jsonify({'error': 'Error al obtener tipos de novedad'}), 500


@nomina_bp.route('/tipos-novedad', methods=['POST'])
@login_required
def crear_tipo_novedad():
    """Crear un nuevo tipo/clase de novedad"""
    data = request.get_json() or {}

    try:
        nombre = (data.get('nombre') or '').strip()
        if not nombre:
            return jsonify({'error': 'El nombre es obligatorio'}), 400

        if TipoNovedad.query.filter_by(nombre=nombre).first():
            return jsonify({'error': 'Ya existe un tipo de novedad con ese nombre'}), 409

        tipo = TipoNovedad(
            nombre=nombre,
            tipo_movimiento=(data.get('tipo_movimiento') or 'DEBITO').strip().upper(),
            categoria=(data.get('categoria') or 'INGRESO_EXTRA').strip().upper(),
            tipo_funcional=(data.get('tipo_funcional') or 'PERIODO').strip().upper(),
            requiere_autorizacion=bool(data.get('requiere_autorizacion', False)),
            descripcion=data.get('descripcion'),
            activo=bool(data.get('activo', True))
        )

        db.session.add(tipo)
        db.session.commit()

        logger.info(f"TipoNovedad creado: {tipo.nombre}")
        return jsonify({'mensaje': 'Tipo de novedad creado', 'id': tipo.id}), 201

    except Exception as e:
        db.session.rollback()
        logger.error(f"Error creando tipo de novedad: {str(e)}")
        return jsonify({'error': 'Error al crear tipo de novedad'}), 500


@nomina_bp.route('/tipos-novedad/<int:tipo_id>', methods=['PUT'])
@login_required
def actualizar_tipo_novedad(tipo_id):
    """Actualizar un tipo/clase de novedad"""
    data = request.get_json() or {}

    try:
        tipo = TipoNovedad.query.get_or_404(tipo_id)

        nuevo_nombre = (data.get('nombre') or tipo.nombre).strip()
        if not nuevo_nombre:
            return jsonify({'error': 'El nombre es obligatorio'}), 400

        # Validar unicidad de nombre si cambia
        if nuevo_nombre != tipo.nombre and TipoNovedad.query.filter_by(nombre=nuevo_nombre).first():
            return jsonify({'error': 'Ya existe otro tipo de novedad con ese nombre'}), 409

        tipo.nombre = nuevo_nombre
        if 'tipo_movimiento' in data:
            tipo.tipo_movimiento = (data.get('tipo_movimiento') or tipo.tipo_movimiento).strip().upper()
        if 'categoria' in data:
            tipo.categoria = (data.get('categoria') or tipo.categoria).strip().upper()
        if 'tipo_funcional' in data:
            tipo.tipo_funcional = (data.get('tipo_funcional') or tipo.tipo_funcional).strip().upper()
        if 'requiere_autorizacion' in data:
            tipo.requiere_autorizacion = bool(data.get('requiere_autorizacion'))
        if 'descripcion' in data:
            tipo.descripcion = data.get('descripcion')
        if 'activo' in data:
            tipo.activo = bool(data.get('activo'))

        db.session.commit()
        logger.info(f"TipoNovedad actualizado: {tipo.nombre}")

        return jsonify({'mensaje': 'Tipo de novedad actualizado'}), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f"Error actualizando tipo de novedad: {str(e)}")
        return jsonify({'error': 'Error al actualizar tipo de novedad'}), 500


@nomina_bp.route('/novedades', methods=['GET'])
@login_required
def get_novedades():
    """Obtener novedades"""
    try:
        empleado_id = request.args.get('empleado_id')
        mes = request.args.get('mes')
        numero_quincena = request.args.get('numero_quincena')
        anio = request.args.get('anio')
        
        query = Novedad.query
        
        if empleado_id:
            query = query.filter_by(empleado_id=empleado_id)

        # Calcular fechas del período
        if mes and numero_quincena:
            anio = int(anio) if anio else datetime.now().year
            mes = int(mes)
            numero_quincena = int(numero_quincena)

            if numero_quincena == 1:
                fecha_inicio = datetime(anio, mes, 1)
                fecha_fin = datetime(anio, mes, 15)
            else:
                fecha_inicio = datetime(anio, mes, 16)
                if mes == 12:
                    fecha_fin = datetime(anio + 1, 1, 1) - timedelta(days=1)
                else:
                    fecha_fin = datetime(anio, mes + 1, 1) - timedelta(days=1)

            # Obtener novedades que podrían aplicar
            novedades = query.all()
            
            # Filtrar manualmente según tipo de novedad
            novedades_filtradas = []
            for n in novedades:
                aplica = False
                
                if n.tipo.nombre == 'Anticipo' and n.fecha_descuento:
                    # Anticipo: se muestra si fecha_descuento está en el período
                    if fecha_inicio <= n.fecha_descuento <= fecha_fin:
                        aplica = True
                elif n.tipo.nombre == 'Préstamo' and n.quincena_inicio_descuento:
                    # Préstamo: se muestra si está en rango de aplicación
                    # Comienza en quincena_inicio_descuento y termina en quincena_inicio + numero_cuotas
                    fecha_inicio_descuento = n.quincena_inicio_descuento
                    numero_cuotas = n.numero_cuotas or 1
                    
                    # Para este período, verificar si aún aplica
                    if empleado_id_temp := n.empleado_id:
                        empleado = Empleado.query.get(empleado_id_temp)
                        if empleado:
                            if empleado.forma_pago == 'MENSUAL':
                                # Para MENSUAL: meses transcurridos
                                meses_transcurridos = (fecha_fin.year - fecha_inicio_descuento.year) * 12 + (fecha_fin.month - fecha_inicio_descuento.month)
                                if (fecha_inicio_descuento.year < fecha_fin.year or 
                                    (fecha_inicio_descuento.year == fecha_fin.year and fecha_inicio_descuento.month <= fecha_fin.month)):
                                    # Préstamo comenzó en o antes de este mes
                                    if meses_transcurridos < numero_cuotas:
                                        aplica = True
                            else:  # QUINCENAL
                                # Para QUINCENAL: con base en quincenas
                                if fecha_inicio >= fecha_inicio_descuento:
                                    # Calcular cuotas
                                    def quincena_index(fecha):
                                        return (fecha.year * 24) + (fecha.month * 2) + (1 if fecha.day <= 15 else 2)
                                    
                                    inicio_idx = quincena_index(fecha_inicio_descuento)
                                    actual_idx = quincena_index(fecha_inicio)
                                    cuotas_transcurridas = actual_idx - inicio_idx + 1
                                    
                                    if cuotas_transcurridas <= numero_cuotas:
                                        aplica = True
                else:
                    # Otros tipos: fecha_novedad en el período
                    if fecha_inicio <= n.fecha_novedad <= fecha_fin:
                        aplica = True
                
                if aplica:
                    novedades_filtradas.append(n)
        else:
            # Si no hay filtro de período, retornar todas
            novedades_filtradas = query.all()
        
        # Construir respuesta
        datos = []
        for n in novedades_filtradas:
            # Calcular valor a mostrar
            valor_mostrar = float(n.valor)
            
            if n.tipo.nombre == 'Préstamo' and n.numero_cuotas:
                # Para préstamos, mostrar la cuota
                valor_mostrar = float(n.valor) / n.numero_cuotas
            
            datos.append({
                'id': n.id,
                'empleado_id': n.empleado_id,
                'empleado_nombre': f"{n.empleado.nombres} {n.empleado.apellidos}" if n.empleado else 'N/A',
                'nro_documento': n.empleado.nro_documento if n.empleado else 'N/A',
                'tipo_novedad': n.tipo.nombre,
                'tipo_movimiento': n.tipo.tipo_movimiento,
                'valor': valor_mostrar,
                'valor_total': float(n.valor),  # Valor original para referencia
                'numero_cuotas': n.numero_cuotas,
                'descripcion': n.descripcion,
                'fecha_novedad': n.fecha_novedad.strftime('%Y-%m-%d'),
                'aprobada': n.aprobada,
                'activa': n.activa
            })
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo novedades: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Error al obtener novedades: {str(e)}'}), 500


@nomina_bp.route('/prestamos/resumen', methods=['GET'])
@login_required
def resumen_prestamos():
    """Resumen de préstamos por empleado.

    Devuelve una lista de novedades de tipo "Préstamo" con información
    agregada: valor total, valor de cuota, cuotas aplicadas y saldo
    pendiente. Similar al enfoque de servicios (encabezado + movimientos),
    pero apoyado en la estructura de Novedad/NovedadAplicada.
    """
    try:
        empleado_id = request.args.get('empleado_id', type=int)
        solo_activos = request.args.get('solo_activos', 'true').lower() == 'true'

        query = Novedad.query.join(TipoNovedad).filter(TipoNovedad.nombre == 'Préstamo')

        if empleado_id:
            query = query.filter(Novedad.empleado_id == empleado_id)
        if solo_activos:
            query = query.filter(Novedad.activa == True)

        prestamos = query.all()

        resultado = []
        for n in prestamos:
            # Total aplicado vía nómina a este préstamo
            aplicaciones = NovedadAplicada.query.filter_by(novedad_id=n.id).all()
            total_aplicado = sum((Decimal(str(ap.valor_aplicado)) for ap in aplicaciones), Decimal('0'))

            valor_total = Decimal(str(n.valor))
            numero_cuotas = n.numero_cuotas or 1
            valor_cuota = (valor_total / Decimal(str(numero_cuotas))) if numero_cuotas else valor_total
            cuotas_aplicadas = len(aplicaciones)
            saldo_pendiente = max(Decimal('0'), valor_total - total_aplicado)

            empleado = n.empleado  # backref desde Novedad

            resultado.append({
                'id': n.id,
                'empleado_id': n.empleado_id,
                'empleado_nombre': f"{empleado.nombres} {empleado.apellidos}" if empleado else 'N/A',
                'nro_documento': empleado.nro_documento if empleado else None,
                'valor_total': float(valor_total),
                'numero_cuotas': int(numero_cuotas),
                'valor_cuota': float(valor_cuota),
                'cuotas_aplicadas': int(cuotas_aplicadas),
                'saldo_pendiente': float(saldo_pendiente),
                'fecha_inicio_descuento': n.quincena_inicio_descuento.strftime('%Y-%m-%d') if n.quincena_inicio_descuento else None,
                'fecha_novedad': n.fecha_novedad.strftime('%Y-%m-%d') if n.fecha_novedad else None,
                'activa': bool(n.activa)
            })

        return jsonify(resultado), 200

    except Exception as e:
        logger.error(f"Error obteniendo resumen de prestamos: {str(e)}")
        return jsonify({'error': 'Error al obtener resumen de préstamos'}), 500


@nomina_bp.route('/novedades/<int:novedad_id>', methods=['GET'])
@login_required
def get_novedad(novedad_id):
    """Obtener novedad por ID"""
    novedad = Novedad.query.get(novedad_id)
    
    if not novedad:
        return jsonify({'error': 'Novedad no encontrada'}), 404
    
    try:
        datos = {
            'id': novedad.id,
            'empleado_id': novedad.empleado_id,
            'empleado_nombre': f"{novedad.empleado.nombres} {novedad.empleado.apellidos}" if novedad.empleado else 'N/A',
            'nro_documento': novedad.empleado.nro_documento if novedad.empleado else 'N/A',
            'tipo_novedad': novedad.tipo.nombre if novedad.tipo else '',
            'tipo_movimiento': novedad.tipo.tipo_movimiento if novedad.tipo else '',
            'valor': float(novedad.valor),
            'descripcion': novedad.descripcion,
            'fecha_novedad': novedad.fecha_novedad.strftime('%Y-%m-%d') if novedad.fecha_novedad else '',
            'numero_cuotas': novedad.numero_cuotas,
            'quincena_inicio_descuento': novedad.quincena_inicio_descuento.strftime('%Y-%m-%d') if novedad.quincena_inicio_descuento else None,
            'aprobada': novedad.aprobada,
            'activa': novedad.activa
        }
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo novedad: {str(e)}")
        return jsonify({'error': 'Error al obtener novedad'}), 500


@nomina_bp.route('/novedades/<int:novedad_id>', methods=['PUT'])
@login_required
def actualizar_novedad(novedad_id):
    """Actualizar novedad"""
    novedad = Novedad.query.get_or_404(novedad_id)
    data = request.get_json()
    
    try:
        # Función auxiliar para parsear fechas
        def parse_date(date_str):
            if not date_str:
                return None
            try:
                if 'T' not in str(date_str):
                    return datetime.strptime(date_str, '%Y-%m-%d')
                else:
                    return datetime.fromisoformat(date_str)
            except:
                return None
        
        if 'activa' in data:
            novedad.activa = data.get('activa')
        if 'aprobada' in data:
            novedad.aprobada = data.get('aprobada')
        if 'descripcion' in data:
            novedad.descripcion = data.get('descripcion')
        if 'fecha_novedad' in data:
            nueva_fecha = parse_date(data.get('fecha_novedad'))
            if nueva_fecha:
                novedad.fecha_novedad = nueva_fecha
        if 'valor' in data:
            novedad.valor = Decimal(str(data.get('valor')))
        if 'numero_cuotas' in data and data.get('numero_cuotas'):
            novedad.numero_cuotas = int(data.get('numero_cuotas'))
        if 'quincena_inicio_descuento' in data:
            nueva_quincena_inicio = parse_date(data.get('quincena_inicio_descuento'))
            novedad.quincena_inicio_descuento = nueva_quincena_inicio
        if 'fecha_descuento' in data:
            nueva_fecha_descuento = parse_date(data.get('fecha_descuento'))
            novedad.fecha_descuento = nueva_fecha_descuento
        
        db.session.commit()
        logger.info(f"Novedad actualizada: {novedad_id}")
        return jsonify({'mensaje': 'Novedad actualizada', 'id': novedad.id}), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error actualizando novedad: {str(e)}")
        return jsonify({'error': f'Error al actualizar novedad: {str(e)}'}), 500


@nomina_bp.route('/novedades/<int:novedad_id>', methods=['DELETE'])
@login_required
def eliminar_novedad(novedad_id):
    """Eliminar (desactivar) novedad.

    En lugar de borrar físicamente el registro, se marca como inactiva para
    preservar la trazabilidad y evitar errores de integridad referencial con
    `NovedadAplicada`.
    """
    novedad = Novedad.query.get_or_404(novedad_id)

    try:
        novedad.activa = False
        db.session.add(novedad)
        db.session.commit()
        logger.info(f"Novedad desactivada: {novedad_id}")
        return jsonify({'mensaje': 'Novedad desactivada'}), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f"Error desactivando novedad: {str(e)}")
        return jsonify({'error': 'Error al desactivar novedad'}), 500


@nomina_bp.route('/novedades', methods=['POST'])
@login_required
def crear_novedad():
    """Crear novedad"""
    data = request.get_json()
    
    try:
        # Función auxiliar para parsear fechas en formato ISO (YYYY-MM-DD)
        def parse_date(date_str):
            if not date_str:
                return None
            try:
                # Si es ISO date format (YYYY-MM-DD) from HTML input
                if 'T' not in str(date_str):
                    return datetime.strptime(date_str, '%Y-%m-%d')
                else:
                    return datetime.fromisoformat(date_str)
            except:
                return None
        
        # VALIDACIÓN: Verificar que la quincena no esté pagada
        fecha_novedad = parse_date(data.get('fecha_novedad')) if data.get('fecha_novedad') else datetime.utcnow()
        mes = fecha_novedad.month
        anio = fecha_novedad.year
        numero_quincena = 1 if fecha_novedad.day <= 15 else 2
        
        quincena = Quincena.query.filter_by(
            mes=mes, anio=anio, numero_quincena=numero_quincena
        ).first()
        
        if quincena and quincena.pagada:
            return jsonify({'error': 'No se pueden agregar novedades a quincenas que ya están pagadas. Solo consulta permitida.'}), 400
        
        novedad = Novedad(
            empleado_id=data.get('empleado_id'),
            tipo_novedad_id=data.get('tipo_novedad_id'),
            valor=Decimal(str(data.get('valor'))),
            descripcion=data.get('descripcion'),
            fecha_novedad=parse_date(data.get('fecha_novedad')) if data.get('fecha_novedad') else datetime.utcnow(),
            numero_cuotas=data.get('numero_cuotas'),
            quincena_inicio_descuento=parse_date(data.get('quincena_inicio_descuento')),
            fecha_descuento=parse_date(data.get('fecha_descuento')),
            autorizado_por=data.get('autorizado_por'),
            aprobada=data.get('aprobada', False),
            activa=True
        )
        
        db.session.add(novedad)
        db.session.commit()
        
        logger.info(f"Novedad creada para empleado: {novedad.empleado_id}")
        return jsonify({'mensaje': 'Novedad creada', 'id': novedad.id}), 201
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error creando novedad: {str(e)}")
        return jsonify({'error': f'Error al crear novedad: {str(e)}'}), 500


# ==================== QUINCENAS ====================

@nomina_bp.route('/quincenas', methods=['GET'])
@login_required
def get_quincenas():
    """Obtener quincenas"""
    try:
        quincenas = Quincena.query.order_by(Quincena.anio.desc(), Quincena.mes.desc()).all()
        
        datos = [{
            'id': q.id,
            'fecha_inicio': q.fecha_inicio.strftime('%Y-%m-%d'),
            'fecha_fin': q.fecha_fin.strftime('%Y-%m-%d'),
            'numero_quincena': q.numero_quincena,
            'mes': q.mes,
            'anio': q.anio,
            'procesada': q.procesada,
            'pagada': q.pagada
        } for q in quincenas]
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo quincenas: {str(e)}")
        return jsonify({'error': 'Error al obtener quincenas'}), 500


@nomina_bp.route('/quincenas/actual', methods=['GET'])
@login_required
def get_quincena_actual():
    """Obtener quincena en proceso o la siguiente sugerida"""
    try:
        quincena = _obtener_quincena_en_proceso()
        
        if not quincena:
            quincena_siguiente = _obtener_siguiente_quincena_pendiente()
            if not quincena_siguiente:
                return jsonify({
                    'existe': False,
                    'mensaje': 'No hay quincena en proceso ni sugerida'
                }), 200

            return jsonify({
                'existe': True,
                'id': getattr(quincena_siguiente, 'id', None),
                'mes': quincena_siguiente.mes,
                'numero_quincena': quincena_siguiente.numero_quincena,
                'anio': quincena_siguiente.anio,
                'fecha_inicio': None,
                'fecha_fin': None,
                'procesada': getattr(quincena_siguiente, 'procesada', False),
                'pagos_finalizados': getattr(quincena_siguiente, 'pagos_finalizados', False),
                'modo': 'siguiente',
                'mensaje': f'Quincena sugerida {quincena_siguiente.mes}/{quincena_siguiente.numero_quincena}/{quincena_siguiente.anio}'
            }), 200
        
        datos = {
            'existe': True,
            'id': quincena.id,
            'mes': quincena.mes,
            'numero_quincena': quincena.numero_quincena,
            'anio': quincena.anio,
            'fecha_inicio': quincena.fecha_inicio.strftime('%Y-%m-%d'),
            'fecha_fin': quincena.fecha_fin.strftime('%Y-%m-%d'),
            'procesada': quincena.procesada,
            'pagos_finalizados': quincena.pagos_finalizados,
            'modo': 'en_proceso',
            'mensaje': f'Quincena {quincena.mes}/{quincena.numero_quincena}/{quincena.anio} en proceso'
        }
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo quincena actual: {str(e)}")
        return jsonify({'error': f'Error al obtener quincena actual: {str(e)}'}), 500



@nomina_bp.route('/pagos', methods=['POST'])
@login_required
def registrar_pago():
    """Registrar pago a empleado"""
    data = request.get_json()
    
    logger.info(f"📥 RECIBIENDO PAGO: {data}")
    
    try:
        # Obtener el liquido ANTES de crear el pago
        liquido = LiquidoQuincena.query.get(data.get('liquido_quincena_id'))
        if not liquido:
            return jsonify({'error': 'Liquidación no encontrada'}), 404
        
        valor_pago = Decimal(str(data.get('valor_pagado')))
        
        logger.info(f"💰 ANTES DEL PAGO - Liquido ID: {liquido.id}, Total: {liquido.total_a_pagar}, Saldo Pendiente: {liquido.saldo_pendiente}")
        
        # Crear el pago
        pago = Pago(
            empleado_id=data.get('empleado_id'),
            liquido_quincena_id=data.get('liquido_quincena_id'),
            fecha_pago=datetime.fromisoformat(data.get('fecha_pago')),
            valor_pagado=valor_pago,
            pago_saldo_anterior=Decimal(str(data.get('pago_saldo_anterior', 0))),
            pago_quincena_actual=Decimal(str(data.get('pago_quincena_actual', 0))),
            forma_pago=data.get('forma_pago'),
            efectivo=Decimal(str(data.get('efectivo', 0))),
            transferencia=Decimal(str(data.get('transferencia', 0))),
            numero_comprobante=data.get('numero_comprobante'),
            observaciones=data.get('observaciones'),
            usuario_registra_id=current_user.id
        )
        
        db.session.add(pago)
        db.session.flush()  # Asegurar que el pago se registre
        
        # AHORA recalcular el saldo pendiente incluyendo este pago
        from sqlalchemy import func
        total_pagado = db.session.query(func.sum(Pago.valor_pagado)).filter_by(
            liquido_quincena_id=liquido.id
        ).scalar() or Decimal('0')
        
        logger.info(f"💵 Total pagado DESPUÉS (incluyendo este pago): {total_pagado}")
        
        # El saldo pendiente es lo que falta por pagar
        liquido.saldo_pendiente = max(Decimal('0'), liquido.total_a_pagar - total_pagado)
        # Solo marcar como pagada si el saldo pendiente es cero
        liquido.pagada = (liquido.saldo_pendiente == Decimal('0'))
        
        logger.info(f"💰 DESPUÉS DEL PAGO - Saldo Pendiente: {liquido.saldo_pendiente}, Pagada: {liquido.pagada}")
        
        db.session.commit()
        logger.info(f"✅ Pago registrado exitosamente ID: {pago.id} para empleado: {pago.empleado_id}")
        
        return jsonify({'mensaje': 'Pago registrado', 'id': pago.id}), 201
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error registrando pago: {str(e)}")
        return jsonify({'error': 'Error al registrar pago'}), 500


@nomina_bp.route('/pagos', methods=['GET'])
@login_required
def listar_pagos():
    """Listar pagos realizados"""
    try:
        mes = request.args.get('mes')
        anio = request.args.get('anio')
        numero_quincena = request.args.get('numero_quincena')
        empleado_id = request.args.get('empleado_id')
        
        query = Pago.query
        
        if empleado_id:
            query = query.filter_by(empleado_id=empleado_id)
        
        if mes and anio:
            mes = int(mes)
            anio = int(anio)
            
            # Si se especifica numero_quincena, filtrar por esa quincena exacta
            if numero_quincena:
                numero_quincena = int(numero_quincena)
                quincena = Quincena.query.filter_by(mes=mes, anio=anio, numero_quincena=numero_quincena).first()
                if quincena:
                    # Filtrar pagos relacionados a esa quincena
                    query = query.join(LiquidoQuincena, Pago.liquido_quincena_id == LiquidoQuincena.id)
                    query = query.filter(LiquidoQuincena.quincena_id == quincena.id)
            else:
                # Si no se especifica numero_quincena, filtrar por mes/año
                fecha_inicio = datetime(anio, mes, 1)
                if mes == 12:
                    fecha_fin = datetime(anio + 1, 1, 1)
                else:
                    fecha_fin = datetime(anio, mes + 1, 1)
                
                query = query.filter(
                    Pago.fecha_pago >= fecha_inicio,
                    Pago.fecha_pago < fecha_fin
                )
        
        pagos = query.order_by(Pago.fecha_pago.desc()).all()
        
        resultado = []
        for p in pagos:
            empleado = Empleado.query.get(p.empleado_id)
            liquido = LiquidoQuincena.query.get(p.liquido_quincena_id)
            quincena = Quincena.query.get(liquido.quincena_id) if liquido else None
            
            resultado.append({
                'id': p.id,
                'empleado_id': p.empleado_id,
                'liquido_quincena_id': p.liquido_quincena_id,
                'empleado_nombre': f"{empleado.nombres} {empleado.apellidos}" if empleado else 'N/A',
                'nro_documento': empleado.nro_documento if empleado else 'N/A',
                'fecha_pago': p.fecha_pago.strftime('%Y-%m-%d'),
                'valor_pagado': float(p.valor_pagado),
                'forma_pago': p.forma_pago,
                'efectivo': float(p.efectivo),
                'transferencia': float(p.transferencia),
                'numero_comprobante': p.numero_comprobante,
                'quincena': f"{quincena.mes}/{quincena.numero_quincena}/{quincena.anio}" if quincena else 'N/A',
                'observaciones': p.observaciones
            })
        
        try:
            db.session.commit()
        except Exception:
            # Si el commit falla, hacer rollback pero aún retornar los datos calculados
            logger.exception('Error guardando actualizaciones de liquidaciones pendientes')
            db.session.rollback()

        return jsonify(resultado), 200
    
    except Exception as e:
        logger.error(f"Error listando pagos: {str(e)}")
        return jsonify({'error': 'Error al listar pagos'}), 500


@nomina_bp.route('/liquidaciones/pendientes', methods=['GET'])
@login_required
def liquidaciones_pendientes():
    """Obtener liquidaciones pendientes de pago (incluyendo las completamente pagadas)"""
    try:
        mes = request.args.get('mes')
        anio = request.args.get('anio')
        numero_quincena = request.args.get('numero_quincena')
        
        # Base query: unir con Quincena
        query = LiquidoQuincena.query.join(
            Quincena, LiquidoQuincena.quincena_id == Quincena.id
        )
        
        if mes and anio:
            mes = int(mes)
            anio = int(anio)
            
            # Obtener quincena específica si se proporciona numero_quincena
            if numero_quincena:
                numero_quincena = int(numero_quincena)
                quincena = Quincena.query.filter_by(mes=mes, anio=anio, numero_quincena=numero_quincena).first()
                if quincena:
                    query = query.filter(LiquidoQuincena.quincena_id == quincena.id)
                else:
                    return jsonify([]), 200
            else:
                # Si no se especifica numero_quincena, traer todas las quincenas del mes
                quincenas = Quincena.query.filter_by(mes=mes, anio=anio).all()
                quincena_ids = [q.id for q in quincenas]
                
                if quincena_ids:
                    query = query.filter(LiquidoQuincena.quincena_id.in_(quincena_ids))
                else:
                    return jsonify([]), 200
        else:
            # Si no se pidió una quincena específica, traer únicamente quincenas no finalizadas
            query = query.filter(Quincena.pagos_finalizados == False)
        
        liquidaciones = query.all()
        
        logger.info(f"📋 Liquidaciones pendientes encontradas: {len(liquidaciones)}")
        
        resultado = []
        for liq in liquidaciones:
            empleado = Empleado.query.get(liq.empleado_id)
            quincena = Quincena.query.get(liq.quincena_id)
            
            # Calcular el total pagado REAL para este liquido
            from sqlalchemy import func
            total_pagado_real = db.session.query(func.sum(Pago.valor_pagado)).filter_by(
                liquido_quincena_id=liq.id
            ).scalar() or Decimal('0')
            
            logger.info(f"  💼 {empleado.nombres if empleado else 'N/A'}: Total={liq.total_a_pagar}, SaldoAnt={liq.saldo_anterior}, SaldoPend={liq.saldo_pendiente}, TotalPagado={total_pagado_real}")

            # Recalcular préstamos (y totales) a partir de novedades activas por si hubo cambios
            def quincena_index(fecha):
                return (fecha.year * 24) + (fecha.month * 2) + (1 if fecha.day <= 15 else 2)

            prestamos_calc = Decimal('0')
            try:
                novedades_emp = Novedad.query.filter_by(empleado_id=liq.empleado_id, activa=True).all()
                for nov in novedades_emp:
                    if not nov or not nov.tipo:
                        continue
                    if nov.tipo.nombre != 'Préstamo':
                        continue

                    numero_cuotas = nov.numero_cuotas or 1
                    cuota_valor = Decimal(str(nov.valor)) / Decimal(str(numero_cuotas)) if numero_cuotas else Decimal(str(nov.valor))

                    inicio_fecha = nov.quincena_inicio_descuento or nov.fecha_novedad
                    if not inicio_fecha:
                        continue

                    # Calcular cuota número para la quincena actual
                    try:
                        cuota_numero = quincena_index(quincena.fecha_inicio) - quincena_index(inicio_fecha) + 1
                    except Exception:
                        cuota_numero = None

                    if cuota_numero and cuota_numero > 0 and cuota_numero <= numero_cuotas:
                        prestamos_calc += cuota_valor
            except Exception:
                logger.exception(f"Error calculando prestamos para liquido {liq.id}")

            # Si el valor calculado difiere del almacenado, actualizar la fila y recalcular totales
            if prestamos_calc != (liq.prestamos or Decimal('0')):
                try:
                    # Recalcular totales tomando los valores actuales del registro
                    pension = liq.pension or Decimal('0')
                    salud = liq.salud or Decimal('0')
                    caja_comp = liq.caja_compensacion or Decimal('0')
                    anticipos = liq.anticipos or Decimal('0')
                    otras = liq.otras_deducciones or Decimal('0')
                    total_ingresos = liq.total_ingresos or Decimal('0')

                    nuevos_desc = pension + salud + caja_comp + anticipos + prestamos_calc + otras
                    nuevo_total_a_pagar = (total_ingresos - nuevos_desc) + (liq.saldo_anterior or Decimal('0'))

                    liq.prestamos = prestamos_calc
                    liq.total_deducciones = nuevos_desc
                    liq.total_a_pagar = nuevo_total_a_pagar
                    # Recalcular saldo pendiente considerando pagos ya realizados
                    liq.saldo_pendiente = max(Decimal('0'), nuevo_total_a_pagar - Decimal(total_pagado_real))
                    liq.pagada = (liq.saldo_pendiente == Decimal('0'))
                    db.session.add(liq)
                    db.session.flush()
                except Exception:
                    logger.exception(f"Error actualizando liquido {liq.id} con prestamos calculados")
            
            resultado.append({
                'liquido_id': liq.id,
                'empleado_id': liq.empleado_id,
                'empleado_nombre': f"{empleado.nombres} {empleado.apellidos}" if empleado else 'N/A',
                'nro_documento': empleado.nro_documento if empleado else 'N/A',
                'cargo': empleado.cargo if empleado else '',
                'banco': empleado.banco if empleado else '',
                'numero_cuenta': empleado.numero_cuenta if empleado else '',
                'quincena': f"{quincena.mes}/{quincena.numero_quincena}/{quincena.anio}" if quincena else 'N/A',
                'quincena_id': liq.quincena_id,
                'mes': quincena.mes if quincena else None,
                'numero_quincena': quincena.numero_quincena if quincena else None,
                'anio': quincena.anio if quincena else None,
                'sueldo_quincena': float(liq.sueldo_quincena),
                    'saldo_anterior': float(liq.saldo_anterior),
                    'pension': float(liq.pension) if hasattr(liq, 'pension') else 0.0,
                    'salud': float(liq.salud) if hasattr(liq, 'salud') else 0.0,
                    'caja_compensacion': float(liq.caja_compensacion) if hasattr(liq, 'caja_compensacion') else 0.0,
                    'anticipos': float(liq.anticipos) if hasattr(liq, 'anticipos') else 0.0,
                    'prestamos': float(liq.prestamos) if hasattr(liq, 'prestamos') else 0.0,
                    'deducciones_otras': float(liq.otras_deducciones) if hasattr(liq, 'otras_deducciones') else 0.0,
                    'total_ingresos': float(liq.total_ingresos),
                    'total_deducciones': float(liq.total_deducciones),
                    'total_a_pagar': float(liq.total_a_pagar),
                    'saldo_pendiente': float(liq.saldo_pendiente),
                    'pagada': liq.pagada
            })
        
        return jsonify(resultado), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo liquidaciones pendientes: {str(e)}")
        return jsonify({'error': 'Error al obtener liquidaciones pendientes'}), 500


@nomina_bp.route('/pagos/masivo', methods=['POST'])
@login_required
def registrar_pago_masivo():
    """Registrar pagos masivos a múltiples empleados"""
    data = request.get_json()
    
    try:
        liquidaciones = data.get('liquidaciones', [])
        fecha_pago = datetime.fromisoformat(data.get('fecha_pago'))
        forma_pago_global = data.get('forma_pago', 'TRANSFERENCIA')
        
        if not liquidaciones:
            return jsonify({'error': 'No se especificaron liquidaciones para pagar'}), 400
        
        # VALIDACIÓN: Verificar que la quincena no esté ya pagada
        primer_liquido_id = liquidaciones[0].get('liquido_id')
        primer_liquido = LiquidoQuincena.query.get(primer_liquido_id)
        if primer_liquido:
            quincena = Quincena.query.get(primer_liquido.quincena_id)
            if quincena and quincena.pagada:
                return jsonify({'error': 'Esta quincena ya fue pagada. No se permiten dobles pagos.'}), 400
        
        pagos_creados = []
        quincena_id_a_marcar = None
        
        for item in liquidaciones:
            liquido_id = item.get('liquido_id')
            valor_a_pagar = Decimal(str(item.get('valor_a_pagar', 0)))
            
            if valor_a_pagar <= 0:
                continue
            
            liquido = LiquidoQuincena.query.get(liquido_id)
            if not liquido or liquido.pagada:
                continue
            
            # Determinar forma de pago específica o usar la global
            forma_pago = item.get('forma_pago', forma_pago_global)
            
            pago = Pago(
                empleado_id=liquido.empleado_id,
                liquido_quincena_id=liquido.id,
                fecha_pago=fecha_pago,
                valor_pagado=valor_a_pagar,
                pago_saldo_anterior=Decimal('0'),
                pago_quincena_actual=valor_a_pagar,
                forma_pago=forma_pago,
                efectivo=valor_a_pagar if forma_pago == 'EFECTIVO' else Decimal('0'),
                transferencia=valor_a_pagar if forma_pago == 'TRANSFERENCIA' else Decimal('0'),
                numero_comprobante=item.get('numero_comprobante'),
                observaciones=item.get('observaciones'),
                usuario_registra_id=current_user.id
            )
            
            db.session.add(pago)
            db.session.flush()  # Asegurar que el pago se registre ANTES de recalcular
            
            # Actualizar líquido con cálculo correcto de saldo basado en TODOS los pagos (incluyendo este)
            from sqlalchemy import func
            total_pagado = db.session.query(func.sum(Pago.valor_pagado)).filter_by(
                liquido_quincena_id=liquido.id
            ).scalar() or Decimal('0')
            
            logger.info(f"💵 {liquido.empleado_id}: Total pagado = {total_pagado}, Total a pagar = {liquido.total_a_pagar}")
            
            liquido.saldo_pendiente = max(Decimal('0'), liquido.total_a_pagar - total_pagado)
            liquido.pagada = (liquido.saldo_pendiente == Decimal('0'))
            
            logger.info(f"💰 Saldo pendiente = {liquido.saldo_pendiente}, Pagada = {liquido.pagada}")
            
            # Guardar quincena_id para marcarla como pagada después
            if not quincena_id_a_marcar:
                quincena_id_a_marcar = liquido.quincena_id
            
            pagos_creados.append(pago.empleado_id)
        
        # Verificar si todas las liquidaciones de esta quincena están pagadas
        if quincena_id_a_marcar:
            todas_pagadas = LiquidoQuincena.query.filter_by(
                quincena_id=quincena_id_a_marcar,
                pagada=False
            ).count() == 0
            
            if todas_pagadas:
                quincena = Quincena.query.get(quincena_id_a_marcar)
                if quincena:
                    quincena.pagada = True
                    logger.info(f"Quincena {quincena.mes}/{quincena.numero_quincena}/{quincena.anio} marcada como PAGADA")
        
        db.session.commit()
        
        logger.info(f"Pago masivo registrado: {len(pagos_creados)} empleados")
        return jsonify({
            'mensaje': f'Pagos registrados exitosamente',
            'cantidad': len(pagos_creados),
            'empleados': pagos_creados
        }), 201
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error en pago masivo: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Error al registrar pagos: {str(e)}'}), 500


# ==================== FINALIZAR PAGOS DE QUINCENA ====================

@nomina_bp.route('/quincenas/finalizar-pagos', methods=['POST'])
@login_required
def finalizar_pagos_quincena():
    """Finalizar pagos de una quincena y preparar saldos para la siguiente"""
    data = request.get_json()
    
    try:
        mes = int(data.get('mes'))
        numero_quincena = int(data.get('numero_quincena'))
        anio = int(data.get('anio'))
        
        # Obtener la quincena actual
        quincena = Quincena.query.filter_by(
            mes=mes, numero_quincena=numero_quincena, anio=anio
        ).first()
        
        if not quincena:
            return jsonify({'error': 'Quincena no encontrada'}), 404
        
        if quincena.pagos_finalizados:
            return jsonify({'error': 'Los pagos de esta quincena ya fueron finalizados'}), 400
        
        # Verificar que existan pagos registrados
        pagos_count = Pago.query.filter(
            Pago.liquido_quincena_id.in_(
                db.session.query(LiquidoQuincena.id).filter_by(quincena_id=quincena.id)
            )
        ).count()
        
        # Permitir finalizar la quincena aunque no existan pagos registrados
        # para algunos empleados. Los saldos pendientes se transferirán a la
        # quincena siguiente y quedarán como `saldo_anterior`.
        
        # Calcular siguiente quincena
        sig_mes, sig_quincena, sig_anio = _calcular_siguiente_quincena(
            mes, numero_quincena, anio
        )
        
        # Obtener o crear la siguiente quincena
        siguiente_quincena = Quincena.query.filter_by(
            mes=sig_mes, numero_quincena=sig_quincena, anio=sig_anio
        ).first()
        
        # Si no existe la siguiente quincena, crearla
        if not siguiente_quincena:
            logger.info(f"Creando siguiente quincena: {sig_mes}/{sig_quincena}/{sig_anio}")
            # Calcular fechas de la quincena siguiente
            if sig_quincena == 1:
                fecha_inicio_sig = datetime(sig_anio, sig_mes, 1)
                fecha_fin_sig = datetime(sig_anio, sig_mes, 15)
            else:
                fecha_inicio_sig = datetime(sig_anio, sig_mes, 16)
                if sig_mes == 12:
                    fecha_fin_sig = datetime(sig_anio + 1, 1, 1) - timedelta(days=1)
                else:
                    fecha_fin_sig = datetime(sig_anio, sig_mes + 1, 1) - timedelta(days=1)

            siguiente_quincena = Quincena(
                fecha_inicio=fecha_inicio_sig,
                fecha_fin=fecha_fin_sig,
                mes=sig_mes,
                numero_quincena=sig_quincena,
                anio=sig_anio,
                pagos_finalizados=False
            )
            db.session.add(siguiente_quincena)
            db.session.flush()  # Para obtener el ID
        
        logger.info(f"Siguiente quincena ID: {siguiente_quincena.id}")
        
        saldos_guardados = 0
        
        # Procesar liquidaciones de la quincena actual
        liquidaciones = LiquidoQuincena.query.filter_by(quincena_id=quincena.id).all()
        
        for liq in liquidaciones:
            logger.info(f"Procesando saldo para empleado {liq.empleado_id}: saldo_pendiente={liq.saldo_pendiente}")
            
            # Crear o actualizar liquidación en la siguiente quincena
            siguiente_liq = LiquidoQuincena.query.filter_by(
                empleado_id=liq.empleado_id,
                quincena_id=siguiente_quincena.id
            ).first()
            
            if siguiente_liq:
                # SUMAR el saldo pendiente de la quincena anterior al nuevo saldo_anterior
                logger.info(f"  Actualizar existente: {siguiente_liq.saldo_anterior} + {liq.saldo_pendiente}")
                siguiente_liq.saldo_anterior = siguiente_liq.saldo_anterior + liq.saldo_pendiente
                saldos_guardados += 1
            else:
                # Si no existe liquidación en la siguiente quincena, crearla con el saldo anterior
                if siguiente_quincena:
                    logger.info(f"  Crear nueva: Saldo Anterior = {liq.saldo_pendiente}")
                    nueva_liq = LiquidoQuincena(
                        empleado_id=liq.empleado_id,
                        quincena_id=siguiente_quincena.id,
                        sueldo_quincena=liq.sueldo_quincena,
                        saldo_anterior=liq.saldo_pendiente,  # Transferir el saldo pendiente
                        ingresos_totales=Decimal('0'),
                        pension=Decimal('0'),
                        salud=Decimal('0'),
                        caja_compensacion=Decimal('0'),
                        anticipos=Decimal('0'),
                        prestamos=Decimal('0'),
                        otras_deducciones=Decimal('0'),
                        total_ingresos=Decimal('0'),
                        total_deducciones=Decimal('0'),
                        total_a_pagar=liq.saldo_pendiente,  # Total es igual al saldo anterior
                        pagada=False,
                        saldo_pendiente=liq.saldo_pendiente
                    )
                    db.session.add(nueva_liq)
                    saldos_guardados += 1
        
        # Marcar como finalizado
        quincena.pagos_finalizados = True
        quincena.fecha_finalizacion_pagos = datetime.utcnow()
        quincena.usuario_finaliza_id = current_user.id
        
        db.session.commit()
        
        logger.info(f"Pagos finalizados para quincena {mes}/{numero_quincena}/{anio}")
        return jsonify({
            'mensaje': 'Pagos finalizados exitosamente',
            'saldos_guardados': saldos_guardados,
            'siguiente_quincena': f"{sig_mes}/{sig_quincena}/{sig_anio}"
        }), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error finalizando pagos: {str(e)}")
        return jsonify({'error': f'Error al finalizar pagos: {str(e)}'}), 500

# ==================== LIQUIDACION DE QUINCENA ====================

@nomina_bp.route('/quincenas/liquidar', methods=['POST'])
@login_required
def liquidar_quincena():
    """Liquidar una quincena - calcula todos los valores a pagar"""
    data = request.get_json()
    
    try:
        # DETECCIÓN AUTOMÁTICA: Si no se envían parámetros, buscar quincena en proceso
        mes = data.get('mes')
        numero_quincena = data.get('numero_quincena')
        anio = data.get('anio')
        
        if mes is None or numero_quincena is None:
            # Intentar obtener la quincena en proceso automáticamente
            quincena_actual = _obtener_quincena_en_proceso()
            
            if quincena_actual:
                # Usar la quincena en proceso
                mes = quincena_actual.mes
                numero_quincena = quincena_actual.numero_quincena
                anio = quincena_actual.anio
                logger.info(f"✅ Auto-detectada quincena en proceso: {mes}/{numero_quincena}/{anio}")
            else:
                # Si no hay quincena en proceso, usar la siguiente a la ultima finalizada
                quincena_siguiente = _obtener_siguiente_quincena_pendiente()
                if quincena_siguiente:
                    mes = quincena_siguiente.mes
                    numero_quincena = quincena_siguiente.numero_quincena
                    anio = quincena_siguiente.anio
                    logger.info(f"✅ Auto-detectada siguiente quincena: {mes}/{numero_quincena}/{anio}")
                else:
                    # No hay quincena en proceso ni finalizadas
                    return jsonify({
                        'error': 'No se especificó quincena y no hay ninguna en proceso ni finalizada. Proporcione mes y numero_quincena.',
                        'sugerencia': 'Indique: {"mes": 2, "numero_quincena": 1, "anio": 2026}'
                    }), 400
        
        # Convertir a int después de tener los valores
        mes = int(mes)
        numero_quincena = int(numero_quincena)
        anio = int(anio or datetime.now().year)
        
        # Validar mes y quincena
        if mes < 1 or mes > 12 or numero_quincena < 1 or numero_quincena > 2:
            return jsonify({'error': 'Mes debe ser 1-12 y quincena 1-2'}), 400
        
        # VALIDACIÓN: Verificar que la quincena anterior esté finalizada
        if numero_quincena == 1:
            quincena_anterior = Quincena.query.filter_by(
                mes=mes - 1 if mes > 1 else 12,
                numero_quincena=2,
                anio=anio if mes > 1 else anio - 1
            ).first()
        else:
            quincena_anterior = Quincena.query.filter_by(
                mes=mes,
                numero_quincena=1,
                anio=anio
            ).first()
        
        # Si la quincena anterior tiene pagos sin finalizar, no bloqueará
        # la liquidación: en su lugar transferimos los saldos pendientes a la
        # quincena actual para que queden como `saldo_anterior`.
        transfer_from_quincena_id = None
        if quincena_anterior and not quincena_anterior.pagos_finalizados:
            anterior_mes = quincena_anterior.mes
            anterior_quincena = quincena_anterior.numero_quincena
            logger.warning(f"Quincena anterior {anterior_mes}/{anterior_quincena}/{quincena_anterior.anio} tiene pagos no finalizados. Se transferirán saldos pendientes a la quincena solicitada.")
            transfer_from_quincena_id = quincena_anterior.id
        
        # VALIDACIÓN DE ORDEN CRONOLÓGICO: Verificar que no haya quincenas anteriores sin liquidar
        # Solo después del primer pago
        primer_pago = Quincena.query.filter_by(pagada=True).first()
        if primer_pago:
            # Ya se hizo un primer pago, ahora verificar orden
            fecha_solicitada = datetime(anio, mes, 1 if numero_quincena == 1 else 16)
            
            # Buscar quincenas anteriores que no estén procesadas
            quincenas_anteriores = Quincena.query.filter(
                db.or_(
                    Quincena.anio < anio,
                    db.and_(
                        Quincena.anio == anio,
                        db.or_(
                            Quincena.mes < mes,
                            db.and_(
                                Quincena.mes == mes,
                                Quincena.numero_quincena < numero_quincena
                            )
                        )
                    )
                ),
                Quincena.procesada == False
            ).first()
            
            if quincenas_anteriores:
                return jsonify({
                    'error': f'Debe liquidar las quincenas en orden cronológico. Quincena {quincenas_anteriores.mes}/{quincenas_anteriores.numero_quincena}/{quincenas_anteriores.anio} está pendiente.'
                }), 400
        
        # Calcular fechas de la quincena
        if numero_quincena == 1:
            fecha_inicio = datetime(anio, mes, 1)
            fecha_fin = datetime(anio, mes, 15)
        else:
            fecha_inicio = datetime(anio, mes, 16)
            if mes == 12:
                fecha_fin = datetime(anio + 1, 1, 1) - timedelta(days=1)
            else:
                fecha_fin = datetime(anio, mes + 1, 1) - timedelta(days=1)
        
        # Obtener o crear quincena
        quincena = Quincena.query.filter_by(
            mes=mes, anio=anio, numero_quincena=numero_quincena
        ).first()
        
        if not quincena:
            quincena = Quincena(
                fecha_inicio=fecha_inicio,
                fecha_fin=fecha_fin,
                numero_quincena=numero_quincena,
                mes=mes,
                anio=anio,
                procesada=True,
                fecha_proceso=datetime.utcnow(),
                usuario_procesa_id=current_user.id
            )
            db.session.add(quincena)
            db.session.flush()  # Para obtener el ID
        
        # ===== CAMBIO IMPORTANTE: NO eliminar liquidaciones ====
        # En lugar de eliminar todas las liquidaciones previas, verificaremos cuáles ya tienen pagos
        # Para preservar los pagos realizados y solo re-liquidar lo necesario
        liquidaciones_existentes = LiquidoQuincena.query.filter_by(quincena_id=quincena.id).all()
        empleados_pagados = set()
        
        for liq_existente in liquidaciones_existentes:
            # Verificar si hay pagos registrados para este empleado en esta quincena
            pagos_registrados = Pago.query.filter_by(liquido_quincena_id=liq_existente.id).count()
            if pagos_registrados > 0:
                empleados_pagados.add(liq_existente.empleado_id)
                logger.info(f"Empleado {liq_existente.empleado_id} ya tiene {pagos_registrados} pago(s) registrado(s) - PRESERVANDO")
        
        # Si hay liquidaciones ya procesadas, NO volver a procesar
        if len(liquidaciones_existentes) > 0 and len(empleados_pagados) > 0:
            logger.info(f"Quincena tiene {len(liquidaciones_existentes)} liquidaciones previas, {len(empleados_pagados)} con pagos registrados")
            # Retornar las liquidaciones existentes sin modificar
            return jsonify({
                'mensaje': f'Quincena ya liquidada: {len(liquidaciones_existentes)} empleados a pagar, {len(empleados_pagados)} con pagos registrados',
                'quincena_id': quincena.id,
                'mes': mes,
                'numero_quincena': numero_quincena,
                'anio': anio,
                'total_empleados': len(liquidaciones_existentes),
                'empleados_pagados': len(empleados_pagados),
                'liquidaciones_existe': True
            }), 200
        
        # Solo eliminar liquidaciones si NO hay pagos registrados
        if len(liquidaciones_existentes) > 0 and len(empleados_pagados) == 0:
            logger.info(f"Re-liquidando: eliminando {len(liquidaciones_existentes)} liquidaciones sin pagos (preservando saldos anteriores)")
            # Eliminar solo las liquidaciones que no contienen `saldo_anterior` para
            # evitar perder deudas que vienen de quincenas previas.
            liqs_a_borrar = LiquidoQuincena.query.filter_by(quincena_id=quincena.id).filter(LiquidoQuincena.saldo_anterior == 0).all()
            for la in liqs_a_borrar:
                NovedadAplicada.query.filter_by(liquido_quincena_id=la.id).delete()
                db.session.delete(la)
            db.session.flush()

        # Si venimos de una quincena anterior con saldos pendientes, transferirlos
        if transfer_from_quincena_id:
            pendientes = LiquidoQuincena.query.filter_by(quincena_id=transfer_from_quincena_id).all()
            transferados = 0
            for prev_liq in pendientes:
                try:
                    if not prev_liq.saldo_pendiente or prev_liq.saldo_pendiente == 0:
                        continue
                    # Buscar liquidación en la quincena actual para el mismo empleado
                    dest_liq = LiquidoQuincena.query.filter_by(
                        empleado_id=prev_liq.empleado_id,
                        quincena_id=quincena.id
                    ).first()

                    if dest_liq:
                        dest_liq.saldo_anterior = (dest_liq.saldo_anterior or Decimal('0')) + prev_liq.saldo_pendiente
                    else:
                        nueva_liq = LiquidoQuincena(
                            empleado_id=prev_liq.empleado_id,
                            quincena_id=quincena.id,
                            sueldo_quincena=prev_liq.sueldo_quincena or Decimal('0'),
                            saldo_anterior=prev_liq.saldo_pendiente,
                            ingresos_totales=Decimal('0'),
                            pension=Decimal('0'),
                            salud=Decimal('0'),
                            caja_compensacion=Decimal('0'),
                            anticipos=Decimal('0'),
                            prestamos=Decimal('0'),
                            otras_deducciones=Decimal('0'),
                            total_ingresos=Decimal('0'),
                            total_deducciones=Decimal('0'),
                            total_a_pagar=prev_liq.saldo_pendiente,
                            pagada=False,
                            saldo_pendiente=prev_liq.saldo_pendiente
                        )
                        db.session.add(nueva_liq)
                    transferados += 1
                except Exception:
                    logger.exception(f"Error transfiriendo saldo del liquido {prev_liq.id}")
            if transferados:
                logger.info(f"Se transfirieron {transferados} saldos pendientes desde quincena {transfer_from_quincena_id} a la quincena {quincena.id}")
            db.session.flush()

        
        # Obtener conceptos automáticos del anio actual
        concepto_pension = ConceptoAutomatico.query.filter_by(
            tipo='PENSION', activo=True, anio=anio
        ).first()
        concepto_salud = ConceptoAutomatico.query.filter_by(
            tipo='SALUD', activo=True, anio=anio
        ).first()
        concepto_caja = ConceptoAutomatico.query.filter_by(
            tipo='CAJA_COMPENSACION', activo=True, anio=anio
        ).first()

        def quincena_index(fecha):
            return (fecha.year * 24) + (fecha.month * 2) + (1 if fecha.day <= 15 else 2)
        
        # Obtener todos los empleados activos
        empleados = Empleado.query.filter_by(activo=True).all()
        
        liquidaciones = []
        
        for empleado in empleados:
            # Excluir empleados completamente fuera del rango de la quincena
            if empleado.fecha_inicio and empleado.fecha_inicio > fecha_fin:
                continue
            if empleado.fecha_retiro and empleado.fecha_retiro < fecha_inicio:
                continue

            # Verificar si el empleado se paga en esta quincena
            debe_pagar = False
            
            if empleado.forma_pago == 'QUINCENAL':
                # Los quincenales se pagan siempre
                debe_pagar = True
            elif empleado.forma_pago == 'MENSUAL':
                # Los mensuales según su día de pago
                if numero_quincena == 1 and empleado.dia_pago in [5, None]:
                    # Primera quincena: si se paga el 5
                    debe_pagar = True
                elif numero_quincena == 2 and empleado.dia_pago == 20:
                    # Segunda quincena: si se paga el 20
                    debe_pagar = True
            
            if not debe_pagar:
                # No aplicar sueldo si no es la quincena de pago
                continue

            # Calcular días realmente trabajados dentro de la quincena
            periodo_inicio = fecha_inicio.date()
            periodo_fin = fecha_fin.date()

            ingreso = empleado.fecha_inicio.date() if empleado.fecha_inicio else periodo_inicio
            retiro = empleado.fecha_retiro.date() if empleado.fecha_retiro else periodo_fin

            fecha_trabajo_inicio = max(periodo_inicio, ingreso)
            fecha_trabajo_fin = min(periodo_fin, retiro)

            # Si no hay intersección de días trabajados con la quincena, no se liquida
            if fecha_trabajo_fin < fecha_trabajo_inicio:
                continue

            dias_periodo = (periodo_fin - periodo_inicio).days + 1
            dias_trabajados = (fecha_trabajo_fin - fecha_trabajo_inicio).days + 1

            factor_proporcional = Decimal(dias_trabajados) / Decimal(dias_periodo)

            # Calcular sueldo de quincena según forma de pago, prorrateado por días trabajados
            if empleado.forma_pago == 'QUINCENAL':
                # Quincenales: El sueldo se divide entre 2 para la quincena
                base_sueldo_quincena = Decimal(str(empleado.sueldo_base)) / 2
            else:  # MENSUAL
                # Mensuales: Se paga el sueldo completo en su quincena de pago
                base_sueldo_quincena = Decimal(str(empleado.sueldo_base))

            sueldo_quincena = base_sueldo_quincena * factor_proporcional
            
            # Obtener novedades activas del empleado (se filtran por regla en cada tipo)
            novedades = Novedad.query.filter(
                Novedad.empleado_id == empleado.id,
                Novedad.activa == True
            ).all()
            
            # Calcular ingresos y deducciones por novedades
            ingresos_extra = Decimal('0')
            deducciones_novedades = Decimal('0')
            antiguos_anticipos = Decimal('0')
            antiguos_prestamos = Decimal('0')
            novedades_aplicadas = []
            
            for novedad in novedades:
                tipo = novedad.tipo
                aplicar_novedad = False
                cuota_numero_aplicada = None

                if tipo.nombre == 'Préstamo':
                    fecha_inicio_descuento = novedad.quincena_inicio_descuento or novedad.fecha_novedad
                    
                    if fecha_inicio_descuento:
                        # Para empleados MENSUAL, solo comparar mes
                        if empleado.forma_pago == 'MENSUAL':
                            # Solo importa si la fecha de inicio descuento es en el mes actual o anterior
                            if (fecha_inicio_descuento.year < fecha_inicio.year or 
                                (fecha_inicio_descuento.year == fecha_inicio.year and fecha_inicio_descuento.month <= fecha_inicio.month)):
                                aplicar_novedad = True
                        else:  # QUINCENAL
                            # Para quincenales, comparar exactamente fecha de inicio
                            if fecha_inicio >= fecha_inicio_descuento:
                                aplicar_novedad = True
                
                elif tipo.nombre == 'Anticipo' and novedad.fecha_descuento:
                    if fecha_inicio <= novedad.fecha_descuento <= fecha_fin:
                        aplicar_novedad = True
                else:
                    if fecha_inicio <= novedad.fecha_novedad <= fecha_fin:
                        aplicar_novedad = True

                if not aplicar_novedad:
                    continue

                if tipo.tipo_movimiento == 'DEBITO':  # Suma
                    valor_aplicado = Decimal(str(novedad.valor))
                    ingresos_extra += valor_aplicado
                    novedades_aplicadas.append({
                        'novedad_id': novedad.id,
                        'valor_aplicado': valor_aplicado,
                        'cuota_numero': None
                    })
                else:  # CREDITO - Resta
                    if tipo.nombre == 'Anticipo':
                        valor_aplicado = Decimal(str(novedad.valor))
                        antiguos_anticipos += valor_aplicado
                        novedades_aplicadas.append({
                            'novedad_id': novedad.id,
                            'valor_aplicado': valor_aplicado,
                            'cuota_numero': None
                        })
                    elif tipo.nombre == 'Préstamo':
                        numero_cuotas = novedad.numero_cuotas or 1
                        cuota_valor = Decimal(str(novedad.valor)) / Decimal(str(numero_cuotas))

                        if novedad.quincena_inicio_descuento:
                            inicio_fecha = novedad.quincena_inicio_descuento
                            
                            # Calcular cuota a aplicar según tipo de empleado
                            if empleado.forma_pago == 'MENSUAL':
                                # Para MENSUAL: contar cuántos meses han pasado
                                meses_transcurridos = (fecha_inicio.year - inicio_fecha.year) * 12 + (fecha_inicio.month - inicio_fecha.month)
                                cuota_numero = meses_transcurridos + 1
                            else:  # QUINCENAL
                                # Para QUINCENAL: contar cuántas quincenas han pasado
                                cuota_numero = quincena_index(fecha_inicio) - quincena_index(inicio_fecha) + 1
                            
                            # Aplicar cuota si sigue dentro del número de cuotas totales
                            if cuota_numero <= numero_cuotas and cuota_numero > 0:
                                cuota_numero_aplicada = cuota_numero
                                antiguos_prestamos += cuota_valor
                                novedades_aplicadas.append({
                                    'novedad_id': novedad.id,
                                    'valor_aplicado': cuota_valor,
                                    'cuota_numero': cuota_numero_aplicada
                                })
                        else:
                            cuota_numero_aplicada = 1
                            antiguos_prestamos += cuota_valor
                            novedades_aplicadas.append({
                                'novedad_id': novedad.id,
                                'valor_aplicado': cuota_valor,
                                'cuota_numero': cuota_numero_aplicada
                            })
                    else:
                        valor_aplicado = Decimal(str(novedad.valor))
                        deducciones_novedades += valor_aplicado
                        novedades_aplicadas.append({
                            'novedad_id': novedad.id,
                            'valor_aplicado': valor_aplicado,
                            'cuota_numero': None
                        })
            
            # Calcular pensión, salud y caja de compensación (descuentos)
            pension = Decimal('0')
            salud = Decimal('0')
            caja_compensacion = Decimal('0')
            
            if empleado.planilla_afiliado:
                # IMPORTANTE: Pensión y Salud solo se aplican ONCE por mes para evitar duplicar
                # - Empleados QUINCENALES: se aplican en QUINCENA 1
                # - Empleados MENSUALES: se aplican en la quincena en la que se les paga
                #   (dia_pago 5/None -> quincena 1, dia_pago 20 -> quincena 2)
                if empleado.forma_pago == 'MENSUAL':
                    aplica_pension_salud = (
                        (numero_quincena == 1 and empleado.dia_pago in [5, None]) or
                        (numero_quincena == 2 and empleado.dia_pago == 20)
                    )
                else:
                    aplica_pension_salud = (numero_quincena == 1)
                
                # Usar parámetros configurados
                if aplica_pension_salud:
                    parametro_pension = ParametroDescuento.query.filter_by(nombre='PENSION', activo=True).first()
                    parametro_salud = ParametroDescuento.query.filter_by(nombre='SALUD', activo=True).first()
                    
                    if parametro_pension and parametro_pension.porcentaje > 0:
                        pension = sueldo_quincena * (Decimal(str(parametro_pension.porcentaje)) / Decimal('100'))
                    if parametro_salud and parametro_salud.porcentaje > 0:
                        salud = sueldo_quincena * (Decimal(str(parametro_salud.porcentaje)) / Decimal('100'))
                
                # Caja de compensación se aplica siempre (en ambas quincenas) si está configurada
                parametro_caja = ParametroDescuento.query.filter_by(nombre='CAJA_COMPENSACION', activo=True).first()
                if parametro_caja and parametro_caja.porcentaje > 0:
                    caja_compensacion = sueldo_quincena * (Decimal(str(parametro_caja.porcentaje)) / Decimal('100'))
            
            # Calcular totales
            total_ingresos = sueldo_quincena + ingresos_extra
            total_deducciones = pension + salud + caja_compensacion + deducciones_novedades + antiguos_anticipos + antiguos_prestamos
            total_a_pagar = total_ingresos - total_deducciones
            
            # Calcular saldo anterior: obtener de la quincena anterior
            saldo_anterior_calculado = Decimal('0')
            if numero_quincena == 1:
                # Primera quincena: buscar en segunda quincena del mes anterior
                quincena_anterior = Quincena.query.filter_by(
                    mes=mes - 1 if mes > 1 else 12,
                    numero_quincena=2,
                    anio=anio if mes > 1 else anio - 1
                ).first()
            else:
                # Segunda quincena: buscar en primera quincena del mismo mes
                quincena_anterior = Quincena.query.filter_by(
                    mes=mes,
                    numero_quincena=1,
                    anio=anio
                ).first()
            
            if quincena_anterior:
                liquido_anterior = LiquidoQuincena.query.filter_by(
                    empleado_id=empleado.id,
                    quincena_id=quincena_anterior.id
                ).first()
                if liquido_anterior:
                    saldo_anterior_calculado = liquido_anterior.saldo_anterior
                    logger.info(f"💼 {empleado.nombres}: Saldo anterior = {saldo_anterior_calculado}")
            
            # Obtener si ya existe una liquidación con saldo anterior (transferido desde finalizar)
            liquido_existente = LiquidoQuincena.query.filter_by(
                empleado_id=empleado.id,
                quincena_id=quincena.id,
                pagada=False
            ).first()
            
            if liquido_existente and liquido_existente.saldo_anterior > 0:
                # Usar el saldo anterior transferido
                saldo_anterior_calculado = liquido_existente.saldo_anterior
                logger.info(f"💼 {empleado.nombres}: Usando saldo anterior transferido = {saldo_anterior_calculado}")
            
            # Crear o actualizar registro en liquidos_quincena
            # Si ya existe una fila para este empleado/quincena (no pagada), actualizarla
            if liquido_existente:
                from sqlalchemy import func
                # Base total (neto de quincena + saldo anterior transferido)
                base_total = total_a_pagar + saldo_anterior_calculado

                # Sumar pagos ya realizados sobre este líquido
                total_pagado_real = db.session.query(func.coalesce(func.sum(Pago.valor_pagado), 0)).filter_by(
                    liquido_quincena_id=liquido_existente.id
                ).scalar() or Decimal('0')

                liquido_existente.sueldo_quincena = sueldo_quincena
                liquido_existente.saldo_anterior = saldo_anterior_calculado
                liquido_existente.ingresos_totales = total_ingresos
                liquido_existente.pension = pension
                liquido_existente.salud = salud
                liquido_existente.caja_compensacion = caja_compensacion
                liquido_existente.anticipos = antiguos_anticipos
                liquido_existente.prestamos = antiguos_prestamos
                liquido_existente.otras_deducciones = deducciones_novedades
                liquido_existente.total_ingresos = total_ingresos
                liquido_existente.total_deducciones = total_deducciones
                liquido_existente.total_a_pagar = base_total
                # Recalcular saldo pendiente teniendo en cuenta los abonos existentes
                liquido_existente.saldo_pendiente = (base_total - Decimal(total_pagado_real))
                liquido_existente.pagada = True if liquido_existente.saldo_pendiente <= 0 else False

                db.session.add(liquido_existente)
                # Asegurar que la variable `liquido` exista y apunte
                # a la fila actual para usarla más abajo al registrar
                # las `NovedadAplicada`.
                liquido = liquido_existente
            else:
                liquido = LiquidoQuincena(
                    empleado_id=empleado.id,
                    quincena_id=quincena.id,
                    sueldo_quincena=sueldo_quincena,
                    saldo_anterior=saldo_anterior_calculado,
                    ingresos_totales=total_ingresos,
                    pension=pension,
                    salud=salud,
                    caja_compensacion=caja_compensacion,  # Ahora usa el valor calculado del parámetro
                    anticipos=antiguos_anticipos,
                    prestamos=antiguos_prestamos,
                    otras_deducciones=deducciones_novedades,
                    total_ingresos=total_ingresos,
                    total_deducciones=total_deducciones,
                    total_a_pagar=total_a_pagar + saldo_anterior_calculado,
                    pagada=False,
                    saldo_pendiente=total_a_pagar + saldo_anterior_calculado
                )

                db.session.add(liquido)
            db.session.flush()  # Obtener liquido.id para trazabilidad
            
            # Registrar novedades aplicadas a esta quincena
            for nov_apl in novedades_aplicadas:
                # Validación de seguridad: asegurar que la novedad pertenece
                # al empleado de esta liquidación antes de crear la aplicación.
                nov_obj = Novedad.query.get(nov_apl['novedad_id'])
                if not nov_obj:
                    logger.warning(f"Novedad {nov_apl['novedad_id']} no encontrada al aplicar a liquido {liq.id}")
                    continue
                if nov_obj.empleado_id != empleado.id:
                    logger.warning(f"Intento de aplicar novedad {nov_obj.id} (empleado {nov_obj.empleado_id}) a liquido de empleado {empleado.id} - ignorando")
                    continue

                aplicacion = NovedadAplicada(
                    novedad_id=nov_apl['novedad_id'],
                    liquido_quincena_id=liquido.id,
                    quincena_id=quincena.id,
                    valor_aplicado=nov_apl['valor_aplicado'],
                    cuota_numero=nov_apl['cuota_numero']
                )
                db.session.add(aplicacion)
            
            # Obtener detalles de novedades aplicadas para mostrar
            novedades_detalle = []
            for nov_apl in novedades_aplicadas:
                novedad = Novedad.query.get(nov_apl['novedad_id'])
                if novedad:
                    detalle = {
                        'tipo': novedad.tipo.nombre,
                        'valor': float(nov_apl['valor_aplicado']),
                        'movimiento': novedad.tipo.tipo_movimiento,
                        'descripcion': novedad.descripcion or ''
                    }
                    if nov_apl['cuota_numero']:
                        detalle['cuota'] = f"Cuota {nov_apl['cuota_numero']}/{novedad.numero_cuotas}"
                    novedades_detalle.append(detalle)
            
            # Preparar datos para mostrar
            liquidaciones.append({
                'empleado_id': empleado.id,
                'nro_documento': empleado.nro_documento,
                'nombre': f"{empleado.nombres} {empleado.apellidos}",
                'cargo': empleado.cargo,
                'sueldo_base': float(empleado.sueldo_base),
                'sueldo_quincena': float(sueldo_quincena),
                'saldo_anterior': float(saldo_anterior_calculado),
                'ingresos_extra': float(ingresos_extra),
                'pension': float(pension),
                'salud': float(salud),
                'caja_compensacion': float(caja_compensacion),  # Ahora usa el valor calculado
                'deducciones_otras': float(deducciones_novedades),
                'anticipos': float(antiguos_anticipos),
                'prestamos': float(antiguos_prestamos),
                'total_ingresos': float(total_ingresos),
                'total_deducciones': float(total_deducciones),
                'total_a_pagar': float(total_a_pagar),
                'novedades_aplicadas': novedades_detalle,
                'liquido_id': None  # Se asignará en el siguiente flush
            })
        
        db.session.commit()
        
        # Reasignar IDs de líquidos en los datos
        for i, item in enumerate(liquidaciones):
            liquido = LiquidoQuincena.query.filter_by(
                empleado_id=item['empleado_id'],
                quincena_id=quincena.id
            ).first()
            if liquido:
                item['liquido_id'] = liquido.id
        
        logger.info(f"Quincena liquidada: {mes}/{anio} - {numero_quincena}")
        
        return jsonify({
            'quincena_id': quincena.id,
            'mes': mes,
            'anio': anio,
            'numero_quincena': numero_quincena,
            'fecha_inicio': fecha_inicio.isoformat(),
            'fecha_fin': fecha_fin.isoformat(),
            'total_empleados': len(liquidaciones),
            'total_a_pagar_todos': sum(item['total_a_pagar'] for item in liquidaciones),
            'liquidaciones': liquidaciones
        }), 201
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error liquidando quincena: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Error al liquidar quincena: {str(e)}'}), 500


@nomina_bp.route('/quincenas/verificar-estado', methods=['POST'])
@login_required
def verificar_estado_quincena():
    """Verificar si una quincena ya fue liquidada o tiene pagos registrados, e informar sobre quincenas pendientes"""
    data = request.get_json()
    
    try:
        mes = int(data.get('mes'))
        numero_quincena = int(data.get('numero_quincena'))
        anio = int(data.get('anio', datetime.now().year))
        
        quincena = Quincena.query.filter_by(
            mes=mes, numero_quincena=numero_quincena, anio=anio
        ).first()
        
        quincenas_pendientes = []
        
        if not quincena:
            # Si no existe, verificar si hay quincenas pendientes antes de esta
            quincena_anterior = _obtener_quincena_anterior(mes, numero_quincena, anio)
            
            if quincena_anterior and not quincena_anterior.pagos_finalizados:
                # La quincena anterior existe y NO está finalizada
                total_liquidaciones = LiquidoQuincena.query.filter_by(quincena_id=quincena_anterior.id).count()
                quincenas_pendientes.append({
                    'mes': quincena_anterior.mes,
                    'numero_quincena': quincena_anterior.numero_quincena,
                    'anio': quincena_anterior.anio,
                    'empleados_pendientes': total_liquidaciones
                })
            
            return jsonify({
                'existe': False,
                'mensaje': 'Quincena nueva - proceder con liquidación',
                'quincenas_pendientes': quincenas_pendientes
            }), 200
        
        # Contar liquidaciones y pagos registrados
        total_liquidaciones = LiquidoQuincena.query.filter_by(quincena_id=quincena.id).count()
        total_pagos = (Pago.query
            .join(LiquidoQuincena, Pago.liquido_quincena_id == LiquidoQuincena.id)
            .filter(LiquidoQuincena.quincena_id == quincena.id)
            .count())
        
        # Verificar si hay quincenas pendientes antes de esta
        quincena_anterior = _obtener_quincena_anterior(mes, numero_quincena, anio)
        
        if quincena_anterior and not quincena_anterior.pagos_finalizados:
            # La quincena anterior existe y NO está finalizada
            total_liquidaciones = LiquidoQuincena.query.filter_by(quincena_id=quincena_anterior.id).count()
            quincenas_pendientes.append({
                'mes': quincena_anterior.mes,
                'numero_quincena': quincena_anterior.numero_quincena,
                'anio': quincena_anterior.anio,
                'empleados_pendientes': total_liquidaciones
            })
        
        resultado = {
            'existe': True,
            'tiene_liquidaciones': total_liquidaciones > 0,
            'tiene_pagos': total_pagos > 0,
            'pagos_finalizados': quincena.pagos_finalizados,
            'total_liquidaciones': total_liquidaciones,
            'total_pagos': total_pagos,
            'procesada': quincena.procesada,
            'mensaje': '',
            'quincenas_pendientes': quincenas_pendientes
        }
        
        if quincena.pagos_finalizados:
            resultado['mensaje'] = '✅ Quincena finalizada - No se puede re-liquidar'
            resultado['puede_reliquidar'] = False
        elif total_pagos > 0:
            resultado['mensaje'] = f'⚠️ Quincena tiene {total_pagos} pago(s) registrado(s) - Finalice los pagos primero'
            resultado['puede_reliquidar'] = False
        elif total_liquidaciones > 0:
            resultado['mensaje'] = f'⚠️ Quincena ya liquidada con {total_liquidaciones} empleado(s) - Re-liquidar eliminará liquidaciones previas'
            resultado['puede_reliquidar'] = True
        else:
            resultado['mensaje'] = 'Quincena está vacía - puede proceder'
            resultado['puede_reliquidar'] = True
        
        return jsonify(resultado), 200
    
    except Exception as e:
        logger.error(f"Error verificando estado de quincena: {str(e)}")
        return jsonify({'error': f'Error al verificar quincena: {str(e)}'}), 500


def _calcular_siguiente_quincena(mes, numero_quincena, anio):
    """Calcular mes/quincena/anio siguientes"""
    if numero_quincena == 1:
        return mes, 2, anio
    sig_mes = (mes % 12) + 1
    sig_anio = anio if mes < 12 else anio + 1
    return sig_mes, 1, sig_anio


def _obtener_quincena_anterior(mes, numero_quincena, anio):
    """Obtener la quincena anterior a la especificada"""
    if numero_quincena == 1:
        # Primera quincena: anterior es la segunda del mes anterior
        mes_anterior = mes - 1
        anio_anterior = anio
        if mes_anterior < 1:
            mes_anterior = 12
            anio_anterior = anio - 1
        return Quincena.query.filter_by(
            mes=mes_anterior, numero_quincena=2, anio=anio_anterior
        ).first()
    else:
        # Segunda quincena: anterior es la primera del mismo mes
        return Quincena.query.filter_by(
            mes=mes, numero_quincena=1, anio=anio
        ).first()


def _obtener_quincena_en_proceso():
    """
    Obtener la quincena que está actualmente en proceso de pago.
    Una quincena está en proceso si:
    - Tiene liquidaciones registradas (procesada == True)
    - NO está finalizada (pagos_finalizados == False)
    - Es la más reciente con estas características
    """
    quincena = Quincena.query.filter(
        Quincena.procesada == True,
        Quincena.pagos_finalizados == False
    ).order_by(
        Quincena.anio.desc(), 
        Quincena.mes.desc(), 
        Quincena.numero_quincena.desc()
    ).first()
    return quincena


@nomina_bp.route('/historial', methods=['GET'])
@login_required
def historial_movimientos():
    """Consultar historial de movimientos por rango de quincenas y empleado.

    Parámetros esperados (GET):
      desde_mes, desde_numero_quincena, desde_anio,
      hasta_mes, hasta_numero_quincena, hasta_anio,
      empleado_id (opcional)
    """
    try:
        # Parsear parámetros
        def parse_int(name):
            val = request.args.get(name)
            return int(val) if val is not None else None

        d_mes = parse_int('desde_mes')
        d_num = parse_int('desde_numero_quincena')
        d_anio = parse_int('desde_anio')
        h_mes = parse_int('hasta_mes')
        h_num = parse_int('hasta_numero_quincena')
        h_anio = parse_int('hasta_anio')
        empleado_id = request.args.get('empleado_id')

        if None in (d_mes, d_num, d_anio, h_mes, h_num, h_anio):
            return jsonify({'error': 'Faltan parámetros de rango (desde_... / hasta_...)'}), 400

        # Construir fechas de inicio y fin basadas en quincena
        if d_num == 1:
            desde_fecha = datetime(d_anio, d_mes, 1)
        else:
            desde_fecha = datetime(d_anio, d_mes, 16)

        if h_num == 1:
            hasta_fecha = datetime(h_anio, h_mes, 15)
        else:
            # último día del mes
            if h_mes == 12:
                hasta_fecha = datetime(h_anio + 1, 1, 1) - timedelta(days=1)
            else:
                hasta_fecha = datetime(h_anio, h_mes + 1, 1) - timedelta(days=1)

        # Obtener quincenas en el rango
        quincenas = Quincena.query.filter(
            Quincena.fecha_inicio >= desde_fecha,
            Quincena.fecha_inicio <= hasta_fecha
        ).order_by(Quincena.anio, Quincena.mes, Quincena.numero_quincena).all()

        resultado = []
        for q in quincenas:
            # Obtener liquidaciones de la quincena (por empleado o todos)
            if empleado_id:
                liqs = LiquidoQuincena.query.filter_by(quincena_id=q.id, empleado_id=int(empleado_id)).all()
            else:
                liqs = LiquidoQuincena.query.filter_by(quincena_id=q.id).all()

            items = []
            for liq in liqs:
                empleado = Empleado.query.get(liq.empleado_id)

                # novedades aplicadas
                novedades_apl = []
                for na in liq.novedades_aplicadas:
                    nov = na.novedad
                    # Evitar mostrar novedades que no correspondan al empleado del líquido
                    if nov and nov.empleado_id != liq.empleado_id:
                        logger.warning(f"Novedad aplicada {na.id} pertenece a empleado {nov.empleado_id} pero está en liquido {liq.id} (empleado {liq.empleado_id}) - omitiendo en historial")
                        continue
                    novedades_apl.append({
                        'novedad_id': na.novedad_id,
                        'tipo': nov.tipo.nombre if nov and nov.tipo else '',
                        'valor_aplicado': float(na.valor_aplicado),
                        'cuota_numero': na.cuota_numero
                    })

                # pagos
                pagos = []
                pagos_q = Pago.query.filter_by(liquido_quincena_id=liq.id).order_by(Pago.fecha_pago).all()
                for p in pagos_q:
                    pagos.append({
                        'id': p.id,
                        'fecha_pago': p.fecha_pago.strftime('%Y-%m-%d'),
                        'valor_pagado': float(p.valor_pagado),
                        'forma_pago': p.forma_pago,
                        'observaciones': p.observaciones
                    })

                items.append({
                    'liquido_id': liq.id,
                    'empleado_id': liq.empleado_id,
                    'empleado_nombre': f"{empleado.nombres} {empleado.apellidos}" if empleado else 'N/A',
                    'sueldo_quincena': float(liq.sueldo_quincena),
                    'saldo_anterior': float(liq.saldo_anterior),
                    'pension': float(liq.pension),
                    'salud': float(liq.salud),
                    'caja_compensacion': float(liq.caja_compensacion),
                    'anticipos': float(liq.anticipos),
                    'prestamos': float(liq.prestamos),
                    'otras_deducciones': float(liq.otras_deducciones),
                    'total_ingresos': float(liq.total_ingresos),
                    'total_deducciones': float(liq.total_deducciones),
                    'total_a_pagar': float(liq.total_a_pagar),
                    'saldo_pendiente': float(liq.saldo_pendiente),
                    'pagada': liq.pagada,
                    'novedades_aplicadas': novedades_apl,
                    'pagos': pagos
                })

            resultado.append({
                'quincena': f"{q.mes}/{q.numero_quincena}/{q.anio}",
                'quincena_id': q.id,
                'liquidaciones': items
            })

        return jsonify(resultado), 200

    except Exception as e:
        logger.exception('Error en historial_movimientos')
        return jsonify({'error': str(e)}), 500
    
    return quincena


def _obtener_siguiente_quincena_pendiente():
    """Obtener la quincena que sigue a la ultima finalizada."""
    ultima_finalizada = Quincena.query.filter(
        Quincena.pagos_finalizados == True
    ).order_by(
        Quincena.anio.desc(),
        Quincena.mes.desc(),
        Quincena.numero_quincena.desc()
    ).first()

    if not ultima_finalizada:
        return None

    sig_mes, sig_quincena, sig_anio = _calcular_siguiente_quincena(
        ultima_finalizada.mes,
        ultima_finalizada.numero_quincena,
        ultima_finalizada.anio
    )

    quincena_siguiente = Quincena.query.filter_by(
        mes=sig_mes, numero_quincena=sig_quincena, anio=sig_anio
    ).first()

    if quincena_siguiente:
        return quincena_siguiente
    # Construir objeto Quincena con fechas calculadas
    if sig_quincena == 1:
        fecha_inicio = datetime(sig_anio, sig_mes, 1)
        fecha_fin = datetime(sig_anio, sig_mes, 15)
    else:
        fecha_inicio = datetime(sig_anio, sig_mes, 16)
        if sig_mes == 12:
            fecha_fin = datetime(sig_anio + 1, 1, 1) - timedelta(days=1)
        else:
            fecha_fin = datetime(sig_anio, sig_mes + 1, 1) - timedelta(days=1)

    return Quincena(
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        mes=sig_mes,
        numero_quincena=sig_quincena,
        anio=sig_anio,
        pagos_finalizados=False
    )
