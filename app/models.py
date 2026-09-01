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

    # Superusuario del sistema — único, indestructible, gestionado por SOFTEASY-WEB
    is_easy = db.Column(db.Boolean, default=False, nullable=False)

    activo = db.Column(db.Boolean, default=True)
    ultimo_acceso = db.Column(db.DateTime)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Permisos adicionales asignados directamente al usuario (por encima del rol)
    permisos_extra = db.relationship(
        'Permiso',
        secondary='usuario_permiso',
        backref=db.backref('usuarios_directos', lazy='dynamic'),
        lazy='select',
    )

    def __repr__(self):
        return f'<Usuario {self.usuario}>'


usuario_permiso = db.Table(
    'usuario_permiso',
    db.Column('usuario_id', db.Integer, db.ForeignKey('usuarios.id'), primary_key=True),
    db.Column('permiso_id', db.Integer, db.ForeignKey('permisos.id'), primary_key=True),
)


# ==================== MODELOS DE CHAT INTERNO ====================

class ChatConversacion(db.Model):
    """Conversacion interna entre usuarios del sistema."""
    __tablename__ = 'chat_conversaciones'

    id = db.Column(db.Integer, primary_key=True)
    tipo = db.Column(db.String(20), nullable=False, default='DIRECTO', index=True)
    titulo = db.Column(db.String(200))
    direct_key = db.Column(db.String(50), unique=True, index=True)
    creada_por_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False, index=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, index=True)

    creador = db.relationship('Usuario', foreign_keys=[creada_por_id])
    participantes = db.relationship(
        'ChatParticipante',
        backref='conversacion',
        lazy='select',
        cascade='all, delete-orphan',
        order_by='ChatParticipante.id.asc()'
    )
    mensajes = db.relationship(
        'ChatMensaje',
        backref='conversacion',
        lazy='select',
        cascade='all, delete-orphan',
        order_by='ChatMensaje.created_at.asc()'
    )

    def __repr__(self):
        return f'<ChatConversacion {self.id} {self.tipo}>'


class ChatParticipante(db.Model):
    """Participantes que tienen acceso a una conversacion."""
    __tablename__ = 'chat_participantes'

    id = db.Column(db.Integer, primary_key=True)
    conversacion_id = db.Column(db.Integer, db.ForeignKey('chat_conversaciones.id'), nullable=False, index=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False, index=True)
    ultimo_leido_at = db.Column(db.DateTime)
    activo = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    usuario = db.relationship('Usuario', foreign_keys=[usuario_id])

    __table_args__ = (
        db.UniqueConstraint('conversacion_id', 'usuario_id', name='uq_chat_participante_conversacion_usuario'),
    )

    def __repr__(self):
        return f'<ChatParticipante conv={self.conversacion_id} user={self.usuario_id}>'


class ChatMensaje(db.Model):
    """Mensaje enviado dentro de una conversacion interna."""
    __tablename__ = 'chat_mensajes'

    id = db.Column(db.Integer, primary_key=True)
    conversacion_id = db.Column(db.Integer, db.ForeignKey('chat_conversaciones.id'), nullable=False, index=True)
    remitente_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False, index=True)
    contenido = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    remitente = db.relationship('Usuario', foreign_keys=[remitente_id])

    def __repr__(self):
        return f'<ChatMensaje {self.id} conv={self.conversacion_id}>'


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
    
    estado_laboral = db.Column(db.String(30), nullable=False, default='ACTIVO', index=True)
    activo = db.Column(db.Boolean, default=True)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    novedades = db.relationship('Novedad', backref='empleado', lazy='dynamic')
    liquidos_quincena = db.relationship('LiquidoQuincena', backref='empleado', lazy='dynamic')
    pagos = db.relationship('Pago', backref='empleado', lazy='dynamic')
    asignaciones_laborales = db.relationship(
        'EmpleadoAsignacionLaboral',
        backref='empleado',
        lazy='dynamic',
        cascade='all, delete-orphan'
    )
    movimientos_laborales = db.relationship(
        'EmpleadoMovimientoLaboral',
        backref='empleado',
        lazy='dynamic',
        cascade='all, delete-orphan'
    )
    
    def __repr__(self):
        return f'<Empleado {self.nro_documento} - {self.nombres}>'


class Area(db.Model):
    """Tabla maestra de areas organizacionales"""
    __tablename__ = 'areas'

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(150), unique=True, nullable=False, index=True)
    descripcion = db.Column(db.Text)
    activo = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    cargos = db.relationship('Cargo', backref='area', lazy='dynamic')
    asignaciones_laborales = db.relationship('EmpleadoAsignacionLaboral', backref='area', lazy='dynamic')
    movimientos_laborales = db.relationship('EmpleadoMovimientoLaboral', backref='area_movimiento', lazy='dynamic')

    def __repr__(self):
        return f'<Area {self.nombre}>'


class Cargo(db.Model):
    """Tabla maestra de cargos"""
    __tablename__ = 'cargos'

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(150), nullable=False, index=True)
    area_id = db.Column(db.Integer, db.ForeignKey('areas.id'))
    descripcion = db.Column(db.Text)
    activo = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    asignaciones_laborales = db.relationship('EmpleadoAsignacionLaboral', backref='cargo_ref', lazy='dynamic')
    movimientos_laborales = db.relationship('EmpleadoMovimientoLaboral', backref='cargo_movimiento', lazy='dynamic')

    def __repr__(self):
        return f'<Cargo {self.nombre}>'


class EmpleadoAsignacionLaboral(db.Model):
    """Historial de asignaciones empleado-area-cargo"""
    __tablename__ = 'empleado_asignaciones_laborales'

    id = db.Column(db.Integer, primary_key=True)
    empleado_id = db.Column(db.Integer, db.ForeignKey('empleados.id'), nullable=False, index=True)
    area_id = db.Column(db.Integer, db.ForeignKey('areas.id'))
    cargo_id = db.Column(db.Integer, db.ForeignKey('cargos.id'))
    fecha_inicio = db.Column(db.DateTime, nullable=False)
    fecha_fin = db.Column(db.DateTime)
    motivo = db.Column(db.String(255))
    activo = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f'<EmpleadoAsignacionLaboral {self.empleado_id} - {self.cargo_id}>'


class EmpleadoMovimientoLaboral(db.Model):
    """Trazabilidad de movimientos laborales del empleado"""
    __tablename__ = 'empleado_movimientos_laborales'

    id = db.Column(db.Integer, primary_key=True)
    empleado_id = db.Column(db.Integer, db.ForeignKey('empleados.id'), nullable=False, index=True)
    tipo_movimiento = db.Column(db.String(40), nullable=False, index=True)
    fecha_movimiento = db.Column(db.DateTime, nullable=False)
    motivo = db.Column(db.String(255), nullable=False)
    observacion = db.Column(db.Text)
    estado_anterior = db.Column(db.String(30))
    estado_nuevo = db.Column(db.String(30))
    area_id = db.Column(db.Integer, db.ForeignKey('areas.id'))
    cargo_id = db.Column(db.Integer, db.ForeignKey('cargos.id'))
    usuario_responsable = db.Column(db.String(120))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f'<EmpleadoMovimientoLaboral {self.empleado_id} - {self.tipo_movimiento}>'


class Vendedor(db.Model):
    """Tabla maestra de vendedores para el módulo de comisiones"""
    __tablename__ = 'vendedores'

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(200), nullable=False, index=True)
    cargo = db.Column(db.String(150), index=True)
    documento = db.Column(db.String(30), unique=True, index=True)
    telefono = db.Column(db.String(50))
    email = db.Column(db.String(120))
    # Usuario del sistema con el que se loguea el vendedor. Cuando ese usuario
    # entra a la aplicacion, el modulo comercial resuelve automaticamente su
    # vendedor y solo le muestra sus propios clientes.
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), unique=True, index=True)
    porcentaje_comision_venta = db.Column(Numeric(5, 2), default=0)
    porcentaje_comision_recaudo = db.Column(Numeric(5, 2), default=0)
    monto_base_comision = db.Column(Numeric(15, 2), default=0)
    descripcion = db.Column(db.Text)
    activo = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    clientes_comerciales = db.relationship(
        'ClienteComercial',
        backref='vendedor',
        lazy='dynamic'
    )
    usuario = db.relationship(
        'Usuario',
        backref=db.backref('vendedor', uselist=False),
        foreign_keys=[usuario_id],
    )

    def __repr__(self):
        return f'<Vendedor {self.nombre}>'


class ClienteComercial(db.Model):
    """Ficha maestra del cliente comercial relacionado por vendedor"""
    __tablename__ = 'clientes_comerciales'

    id = db.Column(db.Integer, primary_key=True)
    vendedor_id = db.Column(db.Integer, db.ForeignKey('vendedores.id'), nullable=False, index=True)
    razon_social = db.Column(db.String(200), nullable=False, index=True)
    nombre_comercial = db.Column(db.String(200))
    nit = db.Column(db.String(50), unique=True, index=True)
    ciudad = db.Column(db.String(120))
    direccion = db.Column(db.String(255))
    telefono_empresa = db.Column(db.String(50))
    email_empresa = db.Column(db.String(120))
    contacto_principal = db.Column(db.String(150))
    cargo_contacto_principal = db.Column(db.String(150))
    celular_contacto_principal = db.Column(db.String(50))
    email_contacto_principal = db.Column(db.String(120))
    contacto_facturacion = db.Column(db.String(150))
    cargo_contacto_facturacion = db.Column(db.String(150))
    celular_facturacion = db.Column(db.String(50))
    email_facturacion = db.Column(db.String(120))
    medio_autorizacion = db.Column(db.String(30))
    puntos_atencion_recepcion = db.Column(db.Text)
    estado_cliente = db.Column(db.String(30), nullable=False, default='ACTIVO')
    condicion_comercial = db.Column(db.String(20), nullable=False, default='EFECTIVO')
    requiere_factura = db.Column(db.Boolean, default=False, nullable=False)
    fechas_facturacion = db.Column(db.String(120))
    fecha_solicitud_factura = db.Column(db.DateTime)
    examenes_convenidos = db.Column(db.Text)
    servicios_convenidos = db.Column(db.Text)
    tarifas_convenidas = db.Column(db.Text)
    documentos_legales_completos = db.Column(db.Boolean, default=False, nullable=False)
    documentos_legales_detalle = db.Column(db.Text)
    confirmado_administrativo = db.Column(db.Boolean, default=False, nullable=False)
    confirmado_administrativo_at = db.Column(db.DateTime)
    confirmado_administrativo_por_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), index=True)
    pagare_firmado = db.Column(db.Boolean, default=False, nullable=False)
    pagare_detalle = db.Column(db.Text)
    observaciones = db.Column(db.Text)
    activo = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    adjuntos = db.relationship(
        'ClienteComercialAdjunto',
        backref='cliente',
        lazy='dynamic',
        cascade='all, delete-orphan'
    )
    tarifas = db.relationship(
        'ClienteComercialTarifa',
        backref='cliente',
        lazy='dynamic',
        cascade='all, delete-orphan'
    )
    seguimiento_documentos = db.relationship(
        'ClienteSeguimientoDocumento',
        backref='cliente',
        lazy='dynamic',
        cascade='all, delete-orphan'
    )
    atenciones = db.relationship(
        'ClienteAtencion',
        backref='cliente',
        lazy='dynamic',
        cascade='all, delete-orphan'
    )

    def __repr__(self):
        return f'<ClienteComercial {self.razon_social}>'


class ClienteSeguimientoDocumento(db.Model):
    """Documentos comerciales base para seguimiento, cartera y recaudo"""
    __tablename__ = 'clientes_seguimiento_documentos'

    id = db.Column(db.Integer, primary_key=True)
    cliente_id = db.Column(db.Integer, db.ForeignKey('clientes_comerciales.id'), nullable=False, index=True)
    vendedor_id = db.Column(db.Integer, db.ForeignKey('vendedores.id'), nullable=False, index=True)
    atencion_id = db.Column(db.Integer, db.ForeignKey('clientes_atenciones.id'), index=True, unique=True)
    tipo_documento = db.Column(db.String(30), nullable=False, index=True)
    numero_documento = db.Column(db.String(80), index=True)
    fecha_documento = db.Column(db.DateTime, nullable=False, index=True)
    fecha_vencimiento = db.Column(db.DateTime, index=True)
    valor_documento = db.Column(Numeric(15, 2), default=0, nullable=False)
    saldo_actual = db.Column(Numeric(15, 2), default=0, nullable=False)
    genera_cartera = db.Column(db.Boolean, default=False, nullable=False)
    estado_documento = db.Column(db.String(20), default='PENDIENTE', nullable=False, index=True)
    observaciones = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    pagos = db.relationship(
        'ClienteSeguimientoPago',
        backref='documento',
        lazy='dynamic',
        cascade='all, delete-orphan'
    )

    vendedor = db.relationship('Vendedor', backref=db.backref('seguimiento_documentos', lazy='dynamic'))

    def __repr__(self):
        return f'<ClienteSeguimientoDocumento {self.tipo_documento} {self.numero_documento or self.id}>'


class ClienteSeguimientoPago(db.Model):
    """Pagos y abonos registrados sobre documentos comerciales del cliente"""
    __tablename__ = 'clientes_seguimiento_pagos'

    id = db.Column(db.Integer, primary_key=True)
    documento_id = db.Column(db.Integer, db.ForeignKey('clientes_seguimiento_documentos.id'), nullable=False, index=True)
    cliente_id = db.Column(db.Integer, db.ForeignKey('clientes_comerciales.id'), nullable=False, index=True)
    vendedor_id = db.Column(db.Integer, db.ForeignKey('vendedores.id'), nullable=False, index=True)
    fecha_pago = db.Column(db.DateTime, nullable=False, index=True)
    valor_pago = db.Column(Numeric(15, 2), default=0, nullable=False)
    tipo_pago = db.Column(db.String(20), nullable=False, default='ABONO', index=True)
    medio_pago = db.Column(db.String(20), nullable=False, default='EFECTIVO', index=True)
    canal_transferencia = db.Column(db.String(20), index=True)
    numero_recibo_caja = db.Column(db.String(50), index=True)
    fecha_recibo = db.Column(db.DateTime, index=True)
    paciente_documento = db.Column(db.String(50), index=True)
    paciente_nombre = db.Column(db.String(200), index=True)
    fecha_atencion = db.Column(db.DateTime, index=True)
    examenes_realizados = db.Column(db.Text)
    nombre_comprobante = db.Column(db.String(255))
    ruta_comprobante = db.Column(db.String(500))
    mime_type = db.Column(db.String(120))
    tamano_bytes = db.Column(db.Integer)
    observaciones = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    cliente = db.relationship('ClienteComercial', backref=db.backref('seguimiento_pagos', lazy='dynamic'))
    vendedor = db.relationship('Vendedor', backref=db.backref('seguimiento_pagos', lazy='dynamic'))

    def __repr__(self):
        return f'<ClienteSeguimientoPago {self.documento_id} {self.valor_pago}>'


class ComisionLiquidacion(db.Model):
    """Liquidacion de comisiones de un vendedor para un periodo (mes/anio).

    La comision se calcula unicamente sobre los recibos de pago (recaudo) del
    periodo. Los pagos con soporte se aprueban automaticamente; los pagos sin
    soporte quedan pendientes de validacion por un usuario autorizado."""
    __tablename__ = 'comisiones_liquidaciones'

    id = db.Column(db.Integer, primary_key=True)
    vendedor_id = db.Column(db.Integer, db.ForeignKey('vendedores.id'), nullable=False, index=True)
    mes = db.Column(db.Integer, nullable=False, index=True)
    anio = db.Column(db.Integer, nullable=False, index=True)
    estado = db.Column(db.String(20), nullable=False, default='BORRADOR', index=True)
    porcentaje_recaudo = db.Column(Numeric(5, 2), default=0, nullable=False)

    # Totales calculados al generar/recalcular la liquidacion.
    total_recaudo_con_soporte = db.Column(Numeric(15, 2), default=0, nullable=False)
    total_recaudo_sin_soporte = db.Column(Numeric(15, 2), default=0, nullable=False)
    total_comision_aprobada = db.Column(Numeric(15, 2), default=0, nullable=False)
    total_comision_pendiente = db.Column(Numeric(15, 2), default=0, nullable=False)
    total_comision_rechazada = db.Column(Numeric(15, 2), default=0, nullable=False)

    usuario_genera_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), index=True)
    usuario_cierra_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), index=True)
    fecha_cierre = db.Column(db.DateTime)
    observaciones = db.Column(db.Text)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    vendedor = db.relationship('Vendedor', backref=db.backref('comisiones_liquidaciones', lazy='dynamic'))
    detalles = db.relationship(
        'ComisionLiquidacionDetalle',
        backref='liquidacion',
        lazy='select',
        cascade='all, delete-orphan'
    )

    __table_args__ = (
        db.UniqueConstraint('vendedor_id', 'mes', 'anio', name='uq_comision_vendedor_periodo'),
    )

    def __repr__(self):
        return f'<ComisionLiquidacion vendedor={self.vendedor_id} {self.mes}/{self.anio}>'


class ComisionLiquidacionDetalle(db.Model):
    """Detalle de la liquidacion: una linea por recibo de pago (recaudo)."""
    __tablename__ = 'comisiones_liquidaciones_detalle'

    id = db.Column(db.Integer, primary_key=True)
    liquidacion_id = db.Column(db.Integer, db.ForeignKey('comisiones_liquidaciones.id'), nullable=False, index=True)
    pago_id = db.Column(db.Integer, db.ForeignKey('clientes_seguimiento_pagos.id'), nullable=False, index=True)
    cliente_id = db.Column(db.Integer, db.ForeignKey('clientes_comerciales.id'), index=True)

    valor_recaudo = db.Column(Numeric(15, 2), default=0, nullable=False)
    porcentaje_aplicado = db.Column(Numeric(5, 2), default=0, nullable=False)
    comision = db.Column(Numeric(15, 2), default=0, nullable=False)
    tiene_soporte = db.Column(db.Boolean, default=False, nullable=False, index=True)
    estado_validacion = db.Column(db.String(25), nullable=False, default='APROBADA', index=True)

    validado_por_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), index=True)
    validado_at = db.Column(db.DateTime)
    observacion = db.Column(db.Text)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    pago = db.relationship('ClienteSeguimientoPago', backref=db.backref('comision_detalles', lazy='dynamic'))
    cliente = db.relationship('ClienteComercial')

    __table_args__ = (
        db.UniqueConstraint('liquidacion_id', 'pago_id', name='uq_comision_detalle_pago'),
    )

    def __repr__(self):
        return f'<ComisionLiquidacionDetalle liq={self.liquidacion_id} pago={self.pago_id}>'


class ClienteComercialAdjunto(db.Model):
    """Soportes cargados para la ficha comercial del cliente"""
    __tablename__ = 'clientes_comerciales_adjuntos'

    id = db.Column(db.Integer, primary_key=True)
    cliente_id = db.Column(db.Integer, db.ForeignKey('clientes_comerciales.id'), nullable=False, index=True)
    tipo_documento = db.Column(db.String(30), nullable=False, index=True)
    nombre_original = db.Column(db.String(255), nullable=False)
    nombre_guardado = db.Column(db.String(255), nullable=False)
    ruta_relativa = db.Column(db.String(500), nullable=False)
    mime_type = db.Column(db.String(120))
    tamano_bytes = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f'<ClienteComercialAdjunto {self.tipo_documento} - {self.nombre_original}>'


class ClienteAtencion(db.Model):
    """Atenciones prestadas al cliente comercial como base del control de cobro"""
    __tablename__ = 'clientes_atenciones'

    id = db.Column(db.Integer, primary_key=True)
    nro_atencion = db.Column(db.String(50), unique=True, index=True)
    cliente_id = db.Column(db.Integer, db.ForeignKey('clientes_comerciales.id'), nullable=False, index=True)
    vendedor_id = db.Column(db.Integer, db.ForeignKey('vendedores.id'), nullable=False, index=True)
    fecha_atencion = db.Column(db.DateTime, nullable=False, index=True)
    paciente_documento = db.Column(db.String(50), nullable=False, index=True)
    paciente_nombre = db.Column(db.String(200), nullable=False, index=True)
    valor_total = db.Column(Numeric(15, 2), default=0, nullable=False)
    saldo_pendiente = db.Column(Numeric(15, 2), default=0, nullable=False)
    estado_cobro = db.Column(db.String(20), default='PENDIENTE', nullable=False, index=True)
    observaciones = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    detalles = db.relationship(
        'ClienteAtencionDetalle',
        backref='atencion',
        lazy='select',
        cascade='all, delete-orphan'
    )
    documento_cobro = db.relationship(
        'ClienteSeguimientoDocumento',
        backref=db.backref('atencion', uselist=False),
        uselist=False
    )

    vendedor = db.relationship('Vendedor', backref=db.backref('atenciones_cliente', lazy='dynamic'))

    def __repr__(self):
        return f'<ClienteAtencion {self.nro_atencion or self.id}>'


class ClienteAtencionDetalle(db.Model):
    """Detalle de exámenes o paquetes convenidos aplicados a una atención"""
    __tablename__ = 'clientes_atenciones_detalle'

    id = db.Column(db.Integer, primary_key=True)
    atencion_id = db.Column(db.Integer, db.ForeignKey('clientes_atenciones.id'), nullable=False, index=True)
    paciente_documento = db.Column(db.String(50), nullable=False, index=True)
    paciente_nombre = db.Column(db.String(200), nullable=False, index=True)
    catalogo_item_id = db.Column(db.Integer, db.ForeignKey('comercial_catalogo_items.id'), nullable=False, index=True)
    tipo_item = db.Column(db.String(20), nullable=False, index=True)
    nombre_item = db.Column(db.String(200), nullable=False)
    valor_item = db.Column(Numeric(15, 2), default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    item_catalogo = db.relationship('ComercialCatalogoItem', backref=db.backref('atenciones_detalle', lazy='dynamic'))

    def __repr__(self):
        return f'<ClienteAtencionDetalle atencion={self.atencion_id} item={self.catalogo_item_id}>'


class ComercialCatalogoItem(db.Model):
    """Catalogo general de examenes, paquetes y otros items comerciales"""
    __tablename__ = 'comercial_catalogo_items'

    id = db.Column(db.Integer, primary_key=True)
    tipo_item = db.Column(db.String(20), nullable=False, index=True)
    tipo_examen = db.Column(db.String(20), index=True)
    subtipo_laboratorio = db.Column(db.String(30), index=True)
    clasificacion_completa = db.Column(db.Boolean, default=True, nullable=False)
    nombre = db.Column(db.String(200), nullable=False, index=True)
    nombre_corto = db.Column(db.String(50), nullable=True)
    codigo = db.Column(db.String(50), unique=True, index=True)
    descripcion = db.Column(db.Text)
    tarifa_base = db.Column(Numeric(15, 2), default=0)
    activo = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    tarifas_cliente = db.relationship(
        'ClienteComercialTarifa',
        backref='item_catalogo',
        lazy='dynamic',
        cascade='all, delete-orphan'
    )
    paquete_componentes = db.relationship(
        'ComercialPaqueteDetalle',
        foreign_keys='ComercialPaqueteDetalle.paquete_id',
        back_populates='paquete',
        lazy='select',
        cascade='all, delete-orphan'
    )
    examen_en_paquetes = db.relationship(
        'ComercialPaqueteDetalle',
        foreign_keys='ComercialPaqueteDetalle.examen_id',
        back_populates='examen',
        lazy='dynamic'
    )

    def __repr__(self):
        return f'<ComercialCatalogoItem {self.tipo_item} - {self.nombre}>'


class ComercialPaqueteDetalle(db.Model):
    """Relaciona un paquete comercial con los examenes que lo componen"""
    __tablename__ = 'comercial_paquetes_detalle'

    id = db.Column(db.Integer, primary_key=True)
    paquete_id = db.Column(db.Integer, db.ForeignKey('comercial_catalogo_items.id'), nullable=False, index=True)
    examen_id = db.Column(db.Integer, db.ForeignKey('comercial_catalogo_items.id'), nullable=False, index=True)
    cantidad = db.Column(db.Integer, nullable=False, default=1)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    paquete = db.relationship(
        'ComercialCatalogoItem',
        foreign_keys=[paquete_id],
        back_populates='paquete_componentes'
    )
    examen = db.relationship(
        'ComercialCatalogoItem',
        foreign_keys=[examen_id],
        back_populates='examen_en_paquetes'
    )

    __table_args__ = (
        db.UniqueConstraint('paquete_id', 'examen_id', name='uq_paquete_examen_comercial'),
    )

    def __repr__(self):
        return f'<ComercialPaqueteDetalle paquete={self.paquete_id} examen={self.examen_id}>'


class ClienteComercialTarifa(db.Model):
    """Tarifa negociada por cliente para un item comercial"""
    __tablename__ = 'clientes_comerciales_tarifas'

    id = db.Column(db.Integer, primary_key=True)
    cliente_id = db.Column(db.Integer, db.ForeignKey('clientes_comerciales.id'), nullable=False, index=True)
    catalogo_item_id = db.Column(db.Integer, db.ForeignKey('comercial_catalogo_items.id'), nullable=False, index=True)
    tarifa_negociada = db.Column(Numeric(15, 2), nullable=False, default=0)
    vigencia_desde = db.Column(db.DateTime)
    vigencia_hasta = db.Column(db.DateTime)
    observacion = db.Column(db.Text)
    activo = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('cliente_id', 'catalogo_item_id', name='uq_cliente_catalogo_tarifa'),
    )

    def __repr__(self):
        return f'<ClienteComercialTarifa cliente={self.cliente_id} item={self.catalogo_item_id}>'


class SiigoCarga(db.Model):
    """Audita cada archivo SIIGO importado para asegurar trazabilidad e idempotencia."""
    __tablename__ = 'siigo_cargas'

    id = db.Column(db.Integer, primary_key=True)
    tipo_archivo = db.Column(db.String(20), nullable=False, index=True)
    nombre_archivo = db.Column(db.String(255), nullable=False)
    hash_archivo = db.Column(db.String(64), nullable=False, unique=True)
    registros_leidos = db.Column(db.Integer, nullable=False, default=0)
    registros_importados = db.Column(db.Integer, nullable=False, default=0)
    registros_omitidos = db.Column(db.Integer, nullable=False, default=0)
    total_debito = db.Column(Numeric(18, 2), nullable=False, default=0)
    total_credito = db.Column(Numeric(18, 2), nullable=False, default=0)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class SiigoCliente(db.Model):
    """Terceros importados desde SIIGO, independientes de la ficha comercial manual."""
    __tablename__ = 'siigo_clientes'

    id = db.Column(db.Integer, primary_key=True)
    identificacion = db.Column(db.String(50), nullable=False, index=True)
    sucursal = db.Column(db.String(30), nullable=False, default='0')
    tipo_identificacion = db.Column(db.String(30))
    digito_verificacion = db.Column(db.String(10))
    nombre = db.Column(db.String(255), nullable=False, index=True)
    direccion = db.Column(db.String(255))
    ciudad = db.Column(db.String(120))
    telefono = db.Column(db.String(80))
    estado = db.Column(db.String(30))
    carga_id = db.Column(db.Integer, db.ForeignKey('siigo_cargas.id'), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('identificacion', 'sucursal', name='uq_siigo_cliente_identificacion_sucursal'),
    )


class SiigoCuentaContable(db.Model):
    """Catálogo de consulta de cuentas contables proveniente de SIIGO."""
    __tablename__ = 'siigo_cuentas_contables'

    id = db.Column(db.Integer, primary_key=True)
    codigo = db.Column(db.String(30), nullable=False, unique=True, index=True)
    nombre = db.Column(db.String(255), nullable=False)
    categoria = db.Column(db.String(120))
    clase = db.Column(db.String(80))
    relacion_con = db.Column(db.String(120))
    maneja_vencimientos = db.Column(db.String(80))
    activo = db.Column(db.Boolean, nullable=False, default=True)
    carga_id = db.Column(db.Integer, db.ForeignKey('siigo_cargas.id'), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SiigoCuentaReporte(db.Model):
    """Clasifica cuentas para que los informes no dependan de reglas fijas en código."""
    __tablename__ = 'siigo_cuentas_reporte'

    id = db.Column(db.Integer, primary_key=True)
    codigo_contable = db.Column(db.String(30), nullable=False, unique=True, index=True)
    clasificacion = db.Column(db.String(30), nullable=False, index=True)
    activo = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SiigoComprobante(db.Model):
    """Encabezado de los comprobantes relevantes para ventas y cartera."""
    __tablename__ = 'siigo_comprobantes'

    id = db.Column(db.Integer, primary_key=True)
    tipo_documento = db.Column(db.String(10), nullable=False, index=True)
    codigo_comprobante = db.Column(db.String(30), nullable=False)
    numero_comprobante = db.Column(db.String(50), nullable=False)
    fecha_elaboracion = db.Column(db.Date, nullable=False, index=True)
    total_debito = db.Column(Numeric(18, 2), nullable=False, default=0)
    total_credito = db.Column(Numeric(18, 2), nullable=False, default=0)
    carga_id = db.Column(db.Integer, db.ForeignKey('siigo_cargas.id'), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    movimientos = db.relationship('SiigoMovimiento', backref='comprobante', lazy='select', cascade='all, delete-orphan')

    __table_args__ = (
        db.UniqueConstraint('tipo_documento', 'codigo_comprobante', 'numero_comprobante', name='uq_siigo_comprobante_origen'),
    )


class SiigoMovimiento(db.Model):
    """Línea contable de un comprobante; conserva el contexto original de SIIGO."""
    __tablename__ = 'siigo_movimientos'

    id = db.Column(db.Integer, primary_key=True)
    comprobante_id = db.Column(db.Integer, db.ForeignKey('siigo_comprobantes.id'), nullable=False, index=True)
    secuencia = db.Column(db.Integer, nullable=False)
    codigo_contable = db.Column(db.String(30), nullable=False, index=True)
    cuenta_contable = db.Column(db.String(255), nullable=False)
    identificacion = db.Column(db.String(50), index=True)
    sucursal = db.Column(db.String(30))
    nombre_tercero = db.Column(db.String(255), index=True)
    descripcion = db.Column(db.String(255))
    detalle = db.Column(db.Text)
    centro_costo = db.Column(db.String(80))
    debito = db.Column(Numeric(18, 2), nullable=False, default=0)
    credito = db.Column(Numeric(18, 2), nullable=False, default=0)

    __table_args__ = (
        db.UniqueConstraint('comprobante_id', 'secuencia', name='uq_siigo_movimiento_secuencia'),
    )


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


class BancoPeriodo(db.Model):
    """Control de periodos mensuales del módulo de bancos/préstamos.

    Igual patrón que ServicioPeriodo: un registro por mes/año,
    en_proceso=True indica el mes activo, finalizado=True los cerrados.
    """
    __tablename__ = 'bancos_periodos'

    id               = db.Column(db.Integer, primary_key=True)
    mes              = db.Column(db.Integer, nullable=False)
    anio             = db.Column(db.Integer, nullable=False)
    en_proceso       = db.Column(db.Boolean, default=False)
    finalizado       = db.Column(db.Boolean, default=False)
    fecha_inicio     = db.Column(db.DateTime)
    fecha_finalizacion = db.Column(db.DateTime)
    created_at       = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at       = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('mes', 'anio', name='uq_bancos_periodo_mes_anio'),
    )

    def __repr__(self):
        return f'<BancoPeriodo {self.mes}/{self.anio} en_proceso={self.en_proceso}>'


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



# ==================== MODELO CARGUE DIARIO DE ATENCIONES ====================

class CargueAtencionDia(db.Model):
    """Registro de cada cargue de archivo Excel de atenciones del día."""
    __tablename__ = 'cargue_atenciones_dia'

    id = db.Column(db.Integer, primary_key=True)
    nombre_archivo = db.Column(db.String(255), nullable=False)
    periodo_desde = db.Column(db.DateTime, index=True)
    periodo_hasta = db.Column(db.DateTime, index=True)
    total_filas = db.Column(db.Integer, default=0)
    filas_importadas = db.Column(db.Integer, default=0)
    filas_duplicadas = db.Column(db.Integer, default=0)
    filas_error = db.Column(db.Integer, default=0)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    usuario = db.relationship('Usuario', foreign_keys=[usuario_id])
    detalles = db.relationship(
        'AtencionDiaDetalle',
        backref='cargue',
        lazy='dynamic',
        cascade='all, delete-orphan',
    )

    def __repr__(self):
        return f'<CargueAtencionDia {self.nombre_archivo}>'


class AtencionDiaDetalle(db.Model):
    """Línea de detalle de una orden de servicio cargada desde Excel."""
    __tablename__ = 'atenciones_dia_detalle'

    id = db.Column(db.Integer, primary_key=True)
    cargue_id = db.Column(db.Integer, db.ForeignKey('cargue_atenciones_dia.id'), nullable=False, index=True)
    cliente_id = db.Column(db.Integer, db.ForeignKey('clientes_comerciales.id'), index=True)
    vendedor_id = db.Column(db.Integer, db.ForeignKey('vendedores.id'), index=True)

    # Campos del Excel
    nro_orden = db.Column(db.String(50), index=True)
    nro_factura = db.Column(db.String(100))
    fecha_factura = db.Column(db.DateTime)
    precio = db.Column(Numeric(15, 2))
    forma_pago = db.Column(db.String(30))
    servicio = db.Column(db.String(300))
    nro_identificacion = db.Column(db.String(60))
    nombre_paciente = db.Column(db.String(300))
    acuerdo_comercial = db.Column(db.String(300), index=True)
    empresa_mision = db.Column(db.String(300))
    sede = db.Column(db.String(100))
    nombre_vendedor = db.Column(db.String(200), index=True)
    fecha_creacion_orden = db.Column(db.DateTime)
    usuario_creacion = db.Column(db.String(100))
    estado_orden = db.Column(db.String(50), index=True)
    estado_gestion = db.Column(db.String(20), nullable=False, default='CARGADA', index=True)
    fecha_anulacion = db.Column(db.DateTime)
    archivo_origen = db.Column(db.String(300))

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    cliente = db.relationship('ClienteComercial', backref=db.backref('atenciones_dia', lazy='dynamic'))
    vendedor = db.relationship('Vendedor', backref=db.backref('atenciones_dia', lazy='dynamic'))

    # Índice compuesto para detectar duplicados exactos
    __table_args__ = (
        db.Index('ix_atencion_dia_orden_servicio', 'nro_orden', 'servicio', 'nro_identificacion'),
    )

    def __repr__(self):
        return f'<AtencionDiaDetalle orden={self.nro_orden} paciente={self.nombre_paciente}>'


# ==================== MODELOS DE PREFACTURAS Y CARTERA COMERCIAL ====================

class PrefacturaComercial(db.Model):
    """Registro de prefacturas generadas por empresa y periodo.

    Se crea/actualiza al generar el ZIP de prefacturas.
    Estado BORRADOR: modificable (se puede regenerar la empresa).
    Estado CERRADA: inmodificable, tiene factura asociada.
    """
    __tablename__ = 'prefacturas_comerciales'

    id = db.Column(db.Integer, primary_key=True)

    # Empresa (puede o no estar en clientes_comerciales)
    cliente_id      = db.Column(db.Integer, db.ForeignKey('clientes_comerciales.id'), index=True)
    nombre_empresa  = db.Column(db.String(300), nullable=False, index=True)

    # Periodo
    fecha_desde     = db.Column(db.DateTime, nullable=False, index=True)
    fecha_hasta     = db.Column(db.DateTime, nullable=False, index=True)

    # Forma de pago del grupo: CREDITO, EFECTIVO, MIXTO
    forma_pago      = db.Column(db.String(20), nullable=False, index=True)
    origen          = db.Column(db.String(30), nullable=False, default='ATENCIONES', index=True)
    fecha_programada = db.Column(db.DateTime, index=True)

    # Totales calculados al generar
    cant_pacientes  = db.Column(db.Integer, default=0, nullable=False)
    valor_total     = db.Column(Numeric(15, 2), default=0, nullable=False)

    # Estado: BORRADOR -> CERRADA
    estado          = db.Column(db.String(20), default='BORRADOR', nullable=False, index=True)

    # Datos de factura (se completan al cerrar el periodo)
    fecha_factura   = db.Column(db.DateTime)
    nro_factura     = db.Column(db.String(80), index=True)
    valor_factura   = db.Column(Numeric(15, 2))

    # Auditoría
    usuario_genera_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'))
    usuario_cierra_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'))
    fecha_cierre      = db.Column(db.DateTime)
    bloqueada_por_pago = db.Column(db.Boolean, default=False, nullable=False, index=True)
    fecha_bloqueo_pago = db.Column(db.DateTime)
    observaciones     = db.Column(db.Text)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relaciones
    cliente         = db.relationship('ClienteComercial',
                                      backref=db.backref('prefacturas', lazy='dynamic'))
    usuario_genera  = db.relationship('Usuario', foreign_keys=[usuario_genera_id])
    usuario_cierra  = db.relationship('Usuario', foreign_keys=[usuario_cierra_id])
    pagos_cartera   = db.relationship(
        'CarteraPrefactura',
        backref='prefactura',
        lazy='dynamic',
        cascade='all, delete-orphan',
    )
    detalles        = db.relationship(
        'PrefacturaComercialDetalle',
        backref='prefactura',
        lazy='dynamic',
        cascade='all, delete-orphan',
    )

    __table_args__ = (
        # Una empresa puede tener una sola prefactura por periodo + forma_pago
        db.UniqueConstraint(
            'nombre_empresa', 'fecha_desde', 'fecha_hasta', 'forma_pago', 'origen',
            name='uq_prefactura_empresa_periodo_forma_origen',
        ),
    )

    def __repr__(self):
        return (f'<PrefacturaComercial {self.nombre_empresa} '
                f'{self.fecha_desde:%d/%m/%Y}-{self.fecha_hasta:%d/%m/%Y} '
                f'{self.forma_pago} [{self.estado}]>')


class PrefacturaComercialDetalle(db.Model):
    """Detalle manual por paciente/item para anticipos en efectivo."""
    __tablename__ = 'prefacturas_comerciales_detalle'

    id = db.Column(db.Integer, primary_key=True)
    prefactura_id = db.Column(
        db.Integer,
        db.ForeignKey('prefacturas_comerciales.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    paciente_documento = db.Column(db.String(50), nullable=False, index=True)
    paciente_nombre = db.Column(db.String(200), nullable=False, index=True)
    catalogo_item_id = db.Column(db.Integer, db.ForeignKey('comercial_catalogo_items.id'), nullable=False, index=True)
    tipo_item = db.Column(db.String(20), nullable=False, index=True)
    nombre_item = db.Column(db.String(200), nullable=False)
    valor_item = db.Column(Numeric(15, 2), default=0, nullable=False)
    fecha_programada = db.Column(db.DateTime, nullable=False, index=True)
    estado_cruce = db.Column(db.String(20), nullable=False, default='PENDIENTE', index=True)
    atencion_dia_id = db.Column(db.Integer, db.ForeignKey('atenciones_dia_detalle.id'), index=True)
    cruzado_at = db.Column(db.DateTime)
    observaciones = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    item_catalogo = db.relationship(
        'ComercialCatalogoItem',
        backref=db.backref('prefacturas_detalle', lazy='dynamic'),
    )
    atencion_dia = db.relationship(
        'AtencionDiaDetalle',
        backref=db.backref('prefacturas_manual_detalle', lazy='dynamic'),
    )

    def __repr__(self):
        return (
            f'<PrefacturaComercialDetalle pref={self.prefactura_id} '
            f'paciente={self.paciente_documento} item={self.catalogo_item_id}>'
        )


class CarteraPrefactura(db.Model):
    """Pagos y anticipos registrados contra una prefactura comercial.

    Para crédito: se registra cuando llega el pago de la factura.
    Para efectivo/anticipos: se registra manualmente para cruzar contra la prefactura.
    """
    __tablename__ = 'cartera_prefacturas'

    id              = db.Column(db.Integer, primary_key=True)
    prefactura_id   = db.Column(db.Integer, db.ForeignKey('prefacturas_comerciales.id'),
                                nullable=False, index=True)

    # Tipo de movimiento: PAGO_FACTURA, ANTICIPO, ABONO, NOTA_CREDITO
    tipo_movimiento = db.Column(db.String(30), nullable=False, index=True)

    fecha_pago      = db.Column(db.DateTime, nullable=False, index=True)
    valor_pago      = db.Column(Numeric(15, 2), nullable=False)

    # Medio de pago: EFECTIVO, TRANSFERENCIA, CHEQUE
    medio_pago      = db.Column(db.String(30))
    canal_transferencia = db.Column(db.String(20), index=True)
    nro_comprobante = db.Column(db.String(80))
    nombre_comprobante = db.Column(db.String(255))
    ruta_comprobante = db.Column(db.String(500))
    mime_type = db.Column(db.String(120))
    tamano_bytes = db.Column(db.Integer)

    # Estado del pago: PENDIENTE, APLICADO, ANULADO
    estado          = db.Column(db.String(20), default='APLICADO', nullable=False, index=True)

    observaciones   = db.Column(db.Text)
    usuario_id      = db.Column(db.Integer, db.ForeignKey('usuarios.id'))

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    usuario = db.relationship('Usuario', foreign_keys=[usuario_id])

    def __repr__(self):
        return (f'<CarteraPrefactura pref={self.prefactura_id} '
                f'{self.tipo_movimiento} {self.valor_pago}>')


# ==================== REGISTRO DIARIO DE CAJA (ÓRDENES DE SERVICIO) ====================

class OrdenServicioCaja(db.Model):
    """Registro inmutable de órdenes de servicio verificadas en caja.

    Una vez en estado APROBADO o TERMINADO no puede modificarse.
    Sirve como control de auditoría contra el sistema de salud.
    Estados: INGRESADO → APROBADO → TERMINADO | ANULADO
    """
    __tablename__ = 'ordenes_servicio_caja'

    id                  = db.Column(db.Integer, primary_key=True)

    # Identificación de la orden
    nro_orden           = db.Column(db.String(50), nullable=False, index=True)
    fecha_orden         = db.Column(db.DateTime, nullable=False, index=True)

    # Datos del paciente
    tipo_documento      = db.Column(db.String(10), nullable=False)   # CC, CE, PT
    nro_documento       = db.Column(db.String(30), nullable=False, index=True)
    nombre_paciente     = db.Column(db.String(200), nullable=False)
    cargo_paciente      = db.Column(db.String(150))
    empresa             = db.Column(db.String(200), index=True)
    empresa_mision      = db.Column(db.String(200), index=True)

    # Servicios prestados (checkboxes almacenados como JSON)
    tipo_examen         = db.Column(db.String(50))    # Ingreso, Periódico, Egreso, etc.
    tipo_examen_otro    = db.Column(db.String(100))
    enfasis             = db.Column(db.JSON)           # lista de énfasis seleccionados
    enfasis_otro        = db.Column(db.String(100))
    paraclinicos        = db.Column(db.JSON)           # lista de paraclínicos
    paraclinicos_otro   = db.Column(db.String(100))
    laboratorio         = db.Column(db.JSON)           # lista de laboratorios
    laboratorio_otro    = db.Column(db.String(100))
    otros_servicios     = db.Column(db.JSON)           # lista de otros servicios
    otros_servicios_otro = db.Column(db.String(100))

    # Pago
    total_costo         = db.Column(Numeric(15, 2), default=0, nullable=False)
    tipo_cliente        = db.Column(db.String(20))     # EMPRESA, PERSONA_NATURAL
    forma_pago          = db.Column(db.String(20), nullable=False, index=True)
    # Para pago MIXTO: discriminación por forma
    mixto_efectivo      = db.Column(Numeric(15, 2))
    mixto_transferencia = db.Column(Numeric(15, 2))
    mixto_credito       = db.Column(Numeric(15, 2))

    # Autorizacion y control operativo
    formas_autorizacion = db.Column(db.JSON)
    autorizacion_observaciones = db.Column(db.Text)
    grupo_requerimientos = db.Column(db.JSON)
    numero_turno        = db.Column(db.String(50))

    # Estado del registro
    estado              = db.Column(db.String(20), nullable=False, default='INGRESADO', index=True)
    motivo_anulacion    = db.Column(db.Text)

    # Observaciones
    observaciones       = db.Column(db.Text)

    # Auditoría
    usuario_id          = db.Column(db.Integer, db.ForeignKey('usuarios.id'), index=True)
    usuario_aprueba_id  = db.Column(db.Integer, db.ForeignKey('usuarios.id'))
    fecha_aprobacion    = db.Column(db.DateTime)
    usuario_termina_id  = db.Column(db.Integer, db.ForeignKey('usuarios.id'))
    fecha_terminacion   = db.Column(db.DateTime)
    usuario_anula_id    = db.Column(db.Integer, db.ForeignKey('usuarios.id'))
    fecha_anulacion     = db.Column(db.DateTime)

    # Relación con cliente comercial (opcional, si se puede relacionar)
    cliente_id          = db.Column(db.Integer, db.ForeignKey('clientes_comerciales.id'), index=True)

    created_at          = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at          = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relaciones
    usuario         = db.relationship('Usuario', foreign_keys=[usuario_id])
    usuario_aprueba = db.relationship('Usuario', foreign_keys=[usuario_aprueba_id])
    usuario_termina = db.relationship('Usuario', foreign_keys=[usuario_termina_id])
    usuario_anula   = db.relationship('Usuario', foreign_keys=[usuario_anula_id])
    cliente         = db.relationship('ClienteComercial',
                                      backref=db.backref('ordenes_caja', lazy='dynamic'))
    adjuntos        = db.relationship(
        'OrdenServicioCajaAdjunto',
        backref='orden',
        lazy='dynamic',
        cascade='all, delete-orphan',
    )

    __table_args__ = (
        db.Index('ix_orden_caja_nro_fecha', 'nro_orden', 'fecha_orden'),
    )

    def __repr__(self):
        return f'<OrdenServicioCaja {self.nro_orden} {self.nombre_paciente} [{self.estado}]>'


class OrdenServicioCajaAdjunto(db.Model):
    __tablename__ = 'ordenes_servicio_caja_adjuntos'

    id = db.Column(db.Integer, primary_key=True)
    orden_id = db.Column(db.Integer, db.ForeignKey('ordenes_servicio_caja.id'), nullable=False, index=True)
    nombre_original = db.Column(db.String(255), nullable=False)
    ruta_relativa = db.Column(db.String(500), nullable=False)
    mime_type = db.Column(db.String(120))
    tamano_bytes = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f'<OrdenServicioCajaAdjunto orden={self.orden_id} archivo={self.nombre_original}>'


class SaborArtesanalTablaItem(db.Model):
    __tablename__ = 'sabor_artesanal_tabla_items'

    id = db.Column(db.Integer, primary_key=True)
    categoria = db.Column(db.String(40), nullable=False, index=True)
    nombre = db.Column(db.String(150), nullable=False)
    descripcion = db.Column(db.Text)
    parent_id = db.Column(
        db.Integer,
        db.ForeignKey('sabor_artesanal_tabla_items.id', ondelete='CASCADE'),
        index=True,
    )
    activo = db.Column(db.Boolean, nullable=False, default=True, index=True)
    precio_venta = db.Column(Numeric(15, 2))
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    parent = db.relationship(
        'SaborArtesanalTablaItem',
        remote_side=[id],
        backref=db.backref(
            'children',
            lazy='selectin',
            cascade='all, delete-orphan',
            single_parent=True,
            order_by='SaborArtesanalTablaItem.nombre',
        ),
    )
    usuario = db.relationship('Usuario', foreign_keys=[usuario_id])

    __table_args__ = (
        db.Index('ix_sabor_artesanal_categoria_parent', 'categoria', 'parent_id'),
    )

    def __repr__(self):
        return (
            f'<SaborArtesanalTablaItem categoria={self.categoria} '
            f'nombre={self.nombre} parent={self.parent_id}>'
        )


class SaborArtesanalMenuCategoria(db.Model):
    __tablename__ = 'sabor_artesanal_menu_categorias'

    id = db.Column(db.Integer, primary_key=True)
    codigo = db.Column(db.String(50), unique=True, nullable=False, index=True)
    nombre = db.Column(db.String(120), unique=True, nullable=False, index=True)
    descripcion = db.Column(db.Text)
    orden = db.Column(db.Integer, nullable=False, default=0)
    activo = db.Column(db.Boolean, nullable=False, default=True, index=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    usuario = db.relationship('Usuario', foreign_keys=[usuario_id])
    menus = db.relationship(
        'SaborArtesanalMenu',
        backref='categoria_menu',
        lazy='dynamic',
        cascade='all, delete-orphan',
    )
    programaciones = db.relationship(
        'SaborArtesanalMenuDia',
        backref='categoria_menu_programada',
        lazy='dynamic',
    )

    def __repr__(self):
        return f'<SaborArtesanalMenuCategoria {self.codigo} {self.nombre}>'


class SaborArtesanalMenu(db.Model):
    __tablename__ = 'sabor_artesanal_menus'

    id = db.Column(db.Integer, primary_key=True)
    categoria_id = db.Column(
        db.Integer,
        db.ForeignKey('sabor_artesanal_menu_categorias.id'),
        nullable=False,
        index=True,
    )
    nombre = db.Column(db.String(160), nullable=False, index=True)
    descripcion = db.Column(db.Text)
    instrucciones = db.Column(db.Text)
    precio_venta = db.Column(Numeric(15, 2))
    activo = db.Column(db.Boolean, nullable=False, default=True, index=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    usuario = db.relationship('Usuario', foreign_keys=[usuario_id])
    componentes = db.relationship(
        'SaborArtesanalMenuComponente',
        backref='menu',
        lazy='select',
        cascade='all, delete-orphan',
        order_by='SaborArtesanalMenuComponente.orden.asc(), SaborArtesanalMenuComponente.id.asc()',
    )
    programaciones = db.relationship(
        'SaborArtesanalMenuDia',
        backref='menu',
        lazy='select',
        cascade='all, delete-orphan',
        order_by='SaborArtesanalMenuDia.fecha_servicio.asc(), SaborArtesanalMenuDia.id.asc()',
    )

    __table_args__ = (
        db.Index('ix_sabor_artesanal_menu_categoria_nombre', 'categoria_id', 'nombre'),
    )

    def __repr__(self):
        return f'<SaborArtesanalMenu {self.nombre} categoria={self.categoria_id}>'


class SaborArtesanalMenuComponente(db.Model):
    __tablename__ = 'sabor_artesanal_menu_componentes'

    id = db.Column(db.Integer, primary_key=True)
    menu_id = db.Column(
        db.Integer,
        db.ForeignKey('sabor_artesanal_menus.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    tabla_categoria = db.Column(db.String(40), nullable=False, index=True)
    tabla_item_id = db.Column(
        db.Integer,
        db.ForeignKey('sabor_artesanal_tabla_items.id'),
        nullable=False,
        index=True,
    )
    parent_item_id = db.Column(
        db.Integer,
        db.ForeignKey('sabor_artesanal_tabla_items.id'),
        index=True,
    )
    principal_nombre = db.Column(db.String(150))
    item_nombre = db.Column(db.String(150), nullable=False)
    descripcion = db.Column(db.Text)
    bloque_codigo = db.Column(db.String(40), index=True)
    bloque_label = db.Column(db.String(120))
    selector_tipo = db.Column(db.String(20), default='single')
    grupo_codigo = db.Column(db.String(40), index=True)
    grupo_label = db.Column(db.String(120))
    seleccion_default = db.Column(db.Boolean, default=False)
    cantidad = db.Column(Numeric(10, 2), nullable=False, default=1)
    unidad = db.Column(db.String(40), nullable=False, default='porcion')
    presentacion = db.Column(db.String(160))
    acompanamiento = db.Column(db.String(160))
    orden = db.Column(db.Integer, nullable=False, default=0)
    observaciones = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    item = db.relationship('SaborArtesanalTablaItem', foreign_keys=[tabla_item_id])
    parent = db.relationship('SaborArtesanalTablaItem', foreign_keys=[parent_item_id])

    __table_args__ = (
        db.UniqueConstraint('menu_id', 'tabla_item_id', name='uq_sabor_menu_componente_menu_item'),
        db.Index('ix_sabor_menu_componente_categoria_menu', 'menu_id', 'tabla_categoria'),
    )

    def __repr__(self):
        return (
            f'<SaborArtesanalMenuComponente menu={self.menu_id} '
            f'categoria={self.tabla_categoria} item={self.tabla_item_id}>'
        )


class SaborArtesanalMenuDia(db.Model):
    __tablename__ = 'sabor_artesanal_menu_dias'

    id = db.Column(db.Integer, primary_key=True)
    menu_id = db.Column(
        db.Integer,
        db.ForeignKey('sabor_artesanal_menus.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    categoria_id = db.Column(
        db.Integer,
        db.ForeignKey('sabor_artesanal_menu_categorias.id'),
        nullable=False,
        index=True,
    )
    fecha_servicio = db.Column(db.Date, nullable=False, index=True)
    observaciones = db.Column(db.Text)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    usuario = db.relationship('Usuario', foreign_keys=[usuario_id])

    __table_args__ = (
        db.UniqueConstraint('fecha_servicio', 'categoria_id', name='uq_sabor_menu_dia_fecha_categoria'),
    )

    def __repr__(self):
        return (
            f'<SaborArtesanalMenuDia fecha={self.fecha_servicio} '
            f'menu={self.menu_id} categoria={self.categoria_id}>'
        )


class SaborArtesanalPedido(db.Model):
    __tablename__ = 'sabor_artesanal_pedidos'

    id = db.Column(db.Integer, primary_key=True)
    codigo = db.Column(db.String(40), unique=True, nullable=False, index=True)
    fecha_servicio = db.Column(db.Date, nullable=False, index=True)
    mesa = db.Column(db.String(80), nullable=False, index=True)
    cliente = db.Column(db.String(160))
    modo_entrega = db.Column(db.String(20), nullable=False, default='SERVIDO', index=True)
    estado = db.Column(db.String(20), nullable=False, default='ABIERTO', index=True)
    detalle_json = db.Column(db.Text, nullable=False)
    items_count = db.Column(db.Integer, nullable=False, default=0)
    comensales_count = db.Column(db.Integer, nullable=False, default=1)
    total = db.Column(Numeric(15, 2), nullable=False, default=0)
    finalizado_at = db.Column(db.DateTime)
    cobrado_at = db.Column(db.DateTime)
    forma_pago = db.Column(db.String(30))
    valor_pagado = db.Column(Numeric(15, 2))
    pago_referencia = db.Column(db.String(120))
    pago_observaciones = db.Column(db.Text)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    usuario = db.relationship('Usuario', foreign_keys=[usuario_id])

    __table_args__ = (
        db.Index('ix_sabor_pedido_fecha_estado', 'fecha_servicio', 'estado'),
    )

    def __repr__(self):
        return f'<SaborArtesanalPedido {self.codigo} mesa={self.mesa} estado={self.estado}>'
