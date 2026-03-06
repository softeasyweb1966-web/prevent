from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime
from sqlalchemy import Numeric, Float

db = SQLAlchemy()

# ==================== MODELOS DE USUARIOS Y ROLES ====================

class Role(db.Model):
    """Tabla de roles de usuario"""
    __tablename__ = 'roles'
    
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(100), unique=True, nullable=False)
    descripcion = db.Column(db.Text)
    permisos = db.relationship('Permiso', secondary='role_permiso', backref='roles')
    usuarios = db.relationship('Usuario', backref='role', lazy='dynamic')
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<Role {self.nombre}>'


class Permiso(db.Model):
    """Tabla de permisos"""
    __tablename__ = 'permisos'
    
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(100), unique=True, nullable=False)
    descripcion = db.Column(db.Text)
    
    def __repr__(self):
        return f'<Permiso {self.nombre}>'


role_permiso = db.Table(
    'role_permiso',
    db.Column('role_id', db.Integer, db.ForeignKey('roles.id'), primary_key=True),
    db.Column('permiso_id', db.Integer, db.ForeignKey('permisos.id'), primary_key=True)
)


class Usuario(UserMixin, db.Model):
    """Tabla de usuarios del sistema"""
    __tablename__ = 'usuarios'
    
    id = db.Column(db.Integer, primary_key=True)
    nombre_completo = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    usuario = db.Column(db.String(100), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role_id = db.Column(db.Integer, db.ForeignKey('roles.id'), nullable=False)
    
    activo = db.Column(db.Boolean, default=True)
    ultimo_acceso = db.Column(db.DateTime)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<Usuario {self.usuario}>'


# ==================== MODELOS DE NÓMINA ====================

class Empleado(db.Model):
    """Catálogo de empleados"""
    __tablename__ = 'empleados'
    
    id = db.Column(db.Integer, primary_key=True)
    nro_documento = db.Column(db.String(20), unique=True, nullable=False, index=True)
    nombres = db.Column(db.String(200), nullable=False)
    apellidos = db.Column(db.String(200), nullable=False)
    cargo = db.Column(db.String(150), nullable=False)
    
    # Datos de pago
    forma_pago = db.Column(db.String(20), nullable=False)  # QUINCENAL, MENSUAL
    dia_pago = db.Column(db.Integer)  # 5 o 20 para MENSUAL
    sueldo_base = db.Column(Numeric(15, 2), nullable=False)
    
    # Afiliaciones
    planilla_afiliado = db.Column(db.Boolean, default=False)  # Si está en salud y pensión
    
    # Datos bancarios
    banco = db.Column(db.String(100))
    numero_cuenta = db.Column(db.String(30))
    
    # Fechas
    fecha_inicio = db.Column(db.DateTime, nullable=False)
    fecha_retiro = db.Column(db.DateTime)
    
    activo = db.Column(db.Boolean, default=True)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    novedades = db.relationship('Novedad', backref='empleado', lazy='dynamic')
    liquidos_quincena = db.relationship('LiquidoQuincena', backref='empleado', lazy='dynamic')
    pagos = db.relationship('Pago', backref='empleado', lazy='dynamic')
    
    def __repr__(self):
        return f'<Empleado {self.nro_documento} - {self.nombres}>'


class TipoNovedad(db.Model):
    """Tabla maestra de tipos de novedad"""
    __tablename__ = 'tipos_novedad'
    
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(100), unique=True, nullable=False)
    tipo_movimiento = db.Column(db.String(10), nullable=False)  # DEBITO (suma) o CREDITO (descuenta)
    categoria = db.Column(db.String(50), nullable=False)  # ANTICIPO, PRESTAMO, INGRESO_EXTRA, INCAPACIDAD, LICENCIA, AUTOMATICO
    # Tipo funcional de la novedad dentro del modelo de períodos
    # PERIODO: afecta solo el período actual (quincena/mes)
    # RECURRENTE: se aplica automáticamente en cada período mientras esté vigente
    # ESTRUCTURAL: cambia condiciones de base (salario, plan, etc.)
    tipo_funcional = db.Column(db.String(20), nullable=False, default='PERIODO')
    requiere_autorizacion = db.Column(db.Boolean, default=False)
    
    descripcion = db.Column(db.Text)
    activo = db.Column(db.Boolean, default=True)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    novedades = db.relationship('Novedad', backref='tipo', lazy='dynamic')
    
    def __repr__(self):
        return f'<TipoNovedad {self.nombre}>'


class Novedad(db.Model):
    """Registro de novedades por empleado"""
    __tablename__ = 'novedades'
    
    id = db.Column(db.Integer, primary_key=True)
    empleado_id = db.Column(db.Integer, db.ForeignKey('empleados.id'), nullable=False)
    tipo_novedad_id = db.Column(db.Integer, db.ForeignKey('tipos_novedad.id'), nullable=False)
    
    # Datos de la novedad
    valor = db.Column(Numeric(15, 2), nullable=False)
    descripcion = db.Column(db.Text)
    fecha_novedad = db.Column(db.DateTime, nullable=False)
    
    # Para préstamos
    numero_cuotas = db.Column(db.Integer)  # Si es préstamo
    quincena_inicio_descuento = db.Column(db.DateTime)  # Quincena inicial
    
    # Para anticipo
    fecha_descuento = db.Column(db.DateTime)  # Cuándo se descuenta
    
    # Para ingresos extra
    autorizado_por = db.Column(db.String(200))
    
    aprobada = db.Column(db.Boolean, default=False)
    activa = db.Column(db.Boolean, default=True)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    aplicaciones = db.relationship('NovedadAplicada', backref='novedad', lazy='dynamic')
    
    def __repr__(self):
        return f'<Novedad {self.empleado_id} - {self.tipo.nombre}>'


class NovedadAplicada(db.Model):
    """Novedades aplicadas a una quincena (trazabilidad)"""
    __tablename__ = 'novedades_aplicadas'
    
    id = db.Column(db.Integer, primary_key=True)
    novedad_id = db.Column(db.Integer, db.ForeignKey('novedades.id'), nullable=False)
    liquido_quincena_id = db.Column(db.Integer, db.ForeignKey('liquidos_quincena.id'), nullable=False)
    quincena_id = db.Column(db.Integer, db.ForeignKey('quincenas.id'), nullable=False)
    
    valor_aplicado = db.Column(Numeric(15, 2), nullable=False)
    cuota_numero = db.Column(db.Integer)  # Solo para préstamos
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def __repr__(self):
        return f'<NovedadAplicada {self.novedad_id} - Q{self.quincena_id}>'


class ConceptoAutomatico(db.Model):
    """Conceptos automáticos: Pensión, Salud, Caja de Compensación"""
    __tablename__ = 'conceptos_automaticos'
    
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(100), unique=True, nullable=False)
    tipo = db.Column(db.String(50), nullable=False)  # PENSION, SALUD, CAJA_COMPENSACION
    
    # Porcentajes por año
    anio = db.Column(db.Integer, nullable=False)
    porcentaje = db.Column(Float, nullable=False)  # Ej: 4.0 para 4%
    
    activo = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<ConceptoAutomatico {self.nombre} - {self.anio}>'


class Quincena(db.Model):
    """Control de quincenas procesadas"""
    __tablename__ = 'quincenas'
    
    id = db.Column(db.Integer, primary_key=True)
    fecha_inicio = db.Column(db.DateTime, nullable=False)
    fecha_fin = db.Column(db.DateTime, nullable=False)
    numero_quincena = db.Column(db.Integer, nullable=False)  # 1 o 2 del mes
    mes = db.Column(db.Integer, nullable=False)
    anio = db.Column(db.Integer, nullable=False)
    
    procesada = db.Column(db.Boolean, default=False)
    pagada = db.Column(db.Boolean, default=False)
    pagos_finalizados = db.Column(db.Boolean, default=False)  # Indica si los pagos fueron finalizados
    
    fecha_proceso = db.Column(db.DateTime)
    usuario_procesa_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'))
    
    fecha_finalizacion_pagos = db.Column(db.DateTime)  # Cuándo se finalizaron los pagos
    usuario_finaliza_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'))
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    liquidos = db.relationship('LiquidoQuincena', backref='quincena', lazy='dynamic', cascade='all, delete-orphan')
    
    def __repr__(self):
        return f'<Quincena {self.mes}/{self.anio} - Q{self.numero_quincena}>'


class LiquidoQuincena(db.Model):
    """Detalle de liquidación por empleado y quincena"""
    __tablename__ = 'liquidos_quincena'
    
    id = db.Column(db.Integer, primary_key=True)
    empleado_id = db.Column(db.Integer, db.ForeignKey('empleados.id'), nullable=False)
    quincena_id = db.Column(db.Integer, db.ForeignKey('quincenas.id'), nullable=False)
    
    # Cálculos
    sueldo_quincena = db.Column(Numeric(15, 2), nullable=False)
    saldo_anterior = db.Column(Numeric(15, 2), default=0)
    
    # Ingresos
    ingresos_totales = db.Column(Numeric(15, 2), default=0)  # Ingresos extra
    pension = db.Column(Numeric(15, 2), default=0)
    salud = db.Column(Numeric(15, 2), default=0)
    caja_compensacion = db.Column(Numeric(15, 2), default=0)
    
    # Deducciones
    anticipos = db.Column(Numeric(15, 2), default=0)
    prestamos = db.Column(Numeric(15, 2), default=0)
    otras_deducciones = db.Column(Numeric(15, 2), default=0)
    
    # Totales
    total_ingresos = db.Column(Numeric(15, 2), default=0)
    total_deducciones = db.Column(Numeric(15, 2), default=0)
    total_a_pagar = db.Column(Numeric(15, 2), default=0)
    
    pagada = db.Column(db.Boolean, default=False)
    saldo_pendiente = db.Column(Numeric(15, 2), default=0)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    pagos = db.relationship('Pago', backref='liquido', lazy='dynamic')
    novedades_aplicadas = db.relationship('NovedadAplicada', backref='liquido', lazy='dynamic', cascade='all, delete-orphan')
    
    def __repr__(self):
        return f'<LiquidoQuincena {self.empleado_id} - Q{self.quincena_id}>'


class Pago(db.Model):
    """Registro de pagos realizados"""
    __tablename__ = 'pagos'
    
    id = db.Column(db.Integer, primary_key=True)
    empleado_id = db.Column(db.Integer, db.ForeignKey('empleados.id'), nullable=False)
    liquido_quincena_id = db.Column(db.Integer, db.ForeignKey('liquidos_quincena.id'), nullable=False)
    
    # Datos del pago
    fecha_pago = db.Column(db.DateTime, nullable=False)
    valor_pagado = db.Column(Numeric(15, 2), nullable=False)
    
    # Discriminación del pago
    pago_saldo_anterior = db.Column(Numeric(15, 2), default=0)
    pago_quincena_actual = db.Column(Numeric(15, 2), default=0)
    
    # Forma de pago
    forma_pago = db.Column(db.String(20), nullable=False)  # EFECTIVO, TRANSFERENCIA
    efectivo = db.Column(Numeric(15, 2), default=0)
    transferencia = db.Column(Numeric(15, 2), default=0)
    
    # Control
    numero_comprobante = db.Column(db.String(50))
    observaciones = db.Column(db.Text)
    
    usuario_registra_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'))
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<Pago {self.empleado_id} - {self.fecha_pago}>'


# ==================== MODELOS COMPLEMENTARIOS ====================

class Empresa(db.Model):
    """Información de la empresa"""
    __tablename__ = 'empresa'
    
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(200), nullable=False)
    nit = db.Column(db.String(20), unique=True, nullable=False)
    razon_social = db.Column(db.String(200))
    
    direccion = db.Column(db.String(300))
    ciudad = db.Column(db.String(100))
    telefono = db.Column(db.String(20))
    email = db.Column(db.String(120))
    
    logo = db.Column(db.String(300))
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<Empresa {self.nombre}>'


class ParametroDescuento(db.Model):
    """Parámetros de descuentos (Salud, Pensión, Caja de Compensación)"""
    __tablename__ = 'parametros_descuentos'
    
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(100), unique=True, nullable=False)  # SALUD, PENSION, CAJA_COMPENSACION
    porcentaje = db.Column(Numeric(5, 2), nullable=False)  # Porcentaje de descuento
    descripcion = db.Column(db.Text)
    activo = db.Column(db.Boolean, default=True)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<ParametroDescuento {self.nombre} - {self.porcentaje}%>'


class AuditLog(db.Model):
    """Log de auditoría de cambios"""
    __tablename__ = 'audit_logs'
    
    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'))
    tabla = db.Column(db.String(100), nullable=False)
    registro_id = db.Column(db.Integer, nullable=False)
    accion = db.Column(db.String(50), nullable=False)  # CREATE, UPDATE, DELETE
    
    datos_anteriores = db.Column(db.JSON)
    datos_nuevos = db.Column(db.JSON)
    
    ip_address = db.Column(db.String(50))
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def __repr__(self):
        return f'<AuditLog {self.tabla} - {self.accion}>'


# ==================== MODELOS DE SERVICIOS ====================


class Servicio(db.Model):
    """Catálogo / encabezados de servicios"""
    __tablename__ = 'servicios'

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(250), nullable=False, unique=True)
    referencia_pago = db.Column(db.String(120))
    dia_pago = db.Column(db.Integer)  # día del mes en que debe pagarse
    valor_aproximado = db.Column(Numeric(15, 2), default=0)

    # Modalidad de pago: cada cuántos meses se paga (1 = mensual, 2 = bimestral, etc.)
    modalidad_pago_meses = db.Column(db.Integer, default=1)
    # Primer mes del año en que se paga (1 = enero, ..., 12 = diciembre)
    mes_inicio_pago = db.Column(db.Integer)

    activo = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relaciones
    novedades = db.relationship('ServicioNovedad', backref='servicio', lazy='dynamic', cascade='all, delete-orphan')
    pagos = db.relationship('ServicioPago', backref='servicio', lazy='dynamic', cascade='all, delete-orphan')

    def __repr__(self):
        return f'<Servicio {self.nombre}>'


class ServicioNovedad(db.Model):
    """Novedades / recibos asociados a un servicio"""
    __tablename__ = 'servicios_novedades'

    id = db.Column(db.Integer, primary_key=True)
    servicio_id = db.Column(db.Integer, db.ForeignKey('servicios.id'), nullable=False)
    valor_real = db.Column(Numeric(15, 2), nullable=False)
    fecha_recibo = db.Column(db.DateTime, nullable=False)
    fecha_limite_primer_pago = db.Column(db.DateTime)
    fecha_corte = db.Column(db.DateTime)

    referencia = db.Column(db.String(200))
    descripcion = db.Column(db.Text)

    activo = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f'<ServicioNovedad {self.servicio_id} - {self.id}>'


class ServicioPago(db.Model):
    """Registro de pagos realizados para servicios"""
    __tablename__ = 'servicios_pagos'

    id = db.Column(db.Integer, primary_key=True)
    servicio_id = db.Column(db.Integer, db.ForeignKey('servicios.id'), nullable=False)
    fecha_pago = db.Column(db.DateTime, nullable=False)
    forma_pago = db.Column(db.String(50))
    valor_pagado = db.Column(Numeric(15, 2), nullable=False)
    observaciones = db.Column(db.Text)

    usuario_registra_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'))

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f'<ServicioPago {self.servicio_id} - {self.id}>'


class ServicioPeriodo(db.Model):
    """Control de periodos mensuales del módulo de servicios.

    Permite saber qué mes/año está en proceso y cuáles ya fueron finalizados,
    similar al control de quincenas en nómina.
    """

    __tablename__ = 'servicios_periodos'

    id = db.Column(db.Integer, primary_key=True)
    mes = db.Column(db.Integer, nullable=False)
    anio = db.Column(db.Integer, nullable=False)

    en_proceso = db.Column(db.Boolean, default=False)
    finalizado = db.Column(db.Boolean, default=False)

    fecha_inicio = db.Column(db.DateTime)
    fecha_finalizacion = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f'<ServicioPeriodo {self.mes}/{self.anio} - en_proceso={self.en_proceso}>'


# ==================== MODELOS DE PRÉSTAMOS (BANCOS) ====================


class PrestamoEmpresa(db.Model):
    """Catálogo / encabezados de préstamos de la empresa (bancos o personas)."""
    __tablename__ = 'prestamos_empresa'

    id = db.Column(db.Integer, primary_key=True)

    # Identificación del préstamo
    nombre = db.Column(db.String(250), nullable=False)  # Entidad o persona
    tipo_prestatario = db.Column(db.String(20))  # ENTIDAD, PERSONA (opcional)

    # Fechas y condiciones generales
    fecha_inicio = db.Column(db.DateTime, nullable=False)
    fecha_final = db.Column(db.DateTime)
    cantidad_cuotas = db.Column(db.Integer)

    valor_prestamo = db.Column(Numeric(15, 2), nullable=False)
    porcentaje_interes = db.Column(Numeric(5, 2))  # Porcentaje digitado para el préstamo
    valor_cuota = db.Column(Numeric(15, 2))  # Cuota calculada, se puede recalcular y ajustar

    dia_pago = db.Column(db.Integer)  # Día de pago acordado

    # Modalidad de pago: INTERESES, CADENA, BANCARIO, PERSONAL
    modalidad_pago = db.Column(db.String(30), nullable=False)

    # Datos específicos para modalidad CADENA
    frecuencia_cadena = db.Column(db.String(20))  # QUINCENAL, MENSUAL
    fecha_recibe_cadena = db.Column(db.DateTime)

    activo = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relaciones
    novedades = db.relationship('PrestamoNovedad', backref='prestamo', lazy='dynamic', cascade='all, delete-orphan')
    pagos = db.relationship('PrestamoPago', backref='prestamo', lazy='dynamic', cascade='all, delete-orphan')

    def __repr__(self):
        return f'<PrestamoEmpresa {self.nombre} - {self.id}>'


class PrestamoNovedad(db.Model):
    """Novedades asociadas a un préstamo de la empresa.

    Corresponde a: Préstamo - Valor a pagar - Fecha límite pago.
    """
    __tablename__ = 'prestamos_novedades'

    id = db.Column(db.Integer, primary_key=True)
    prestamo_id = db.Column(db.Integer, db.ForeignKey('prestamos_empresa.id'), nullable=False)

    valor_a_pagar = db.Column(Numeric(15, 2), nullable=False)
    fecha_limite_pago = db.Column(db.DateTime, nullable=False)

    descripcion = db.Column(db.Text)
    cumplida = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f'<PrestamoNovedad {self.prestamo_id} - {self.id}>'


class PrestamoPago(db.Model):
    """Pagos realizados sobre un préstamo de la empresa.

    Corresponde a: Préstamo - Fecha de Pago - Forma de Pago - Valor pagado - Observaciones.
    """
    __tablename__ = 'prestamos_pagos'

    id = db.Column(db.Integer, primary_key=True)
    prestamo_id = db.Column(db.Integer, db.ForeignKey('prestamos_empresa.id'), nullable=False)

    fecha_pago = db.Column(db.DateTime, nullable=False)
    forma_pago = db.Column(db.String(50))
    valor_pagado = db.Column(Numeric(15, 2), nullable=False)
    observaciones = db.Column(db.Text)

    usuario_registra_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'))

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f'<PrestamoPago {self.prestamo_id} - {self.id}>'

