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


class ComercialRecaudo(db.Model):
    """Comprobante de pago (recaudo) que un vendedor carga por un cliente.

    Un recaudo puede existir SIN atenciones relacionadas (se relacionan luego)
    y puede cubrir VARIAS atenciones (agrupado dinamico) via la tabla puente
    ComercialRecaudoAtencion. La comision del vendedor se calcula sobre el
    valor del comprobante (no sobre la suma de las atenciones, por retenciones)
    usando el porcentaje de recaudo del vendedor."""
    __tablename__ = 'comercial_recaudos'

    id = db.Column(db.Integer, primary_key=True)
    cliente_id = db.Column(db.Integer, db.ForeignKey('clientes_comerciales.id'), nullable=False, index=True)
    vendedor_id = db.Column(db.Integer, db.ForeignKey('vendedores.id'), nullable=False, index=True)

    fecha_pago = db.Column(db.DateTime, nullable=False, index=True)
    valor_comprobante = db.Column(Numeric(15, 2), default=0, nullable=False)
    medio_pago = db.Column(db.String(20), nullable=False, default='TRANSFERENCIA', index=True)
    canal_transferencia = db.Column(db.String(20), index=True)

    # Comision preliquidada al cargar el comprobante.
    porcentaje_aplicado = db.Column(Numeric(5, 2), default=0, nullable=False)
    comision_calculada = db.Column(Numeric(15, 2), default=0, nullable=False)

    # Soporte de pago adjunto.
    nombre_comprobante = db.Column(db.String(255))
    ruta_comprobante = db.Column(db.String(500))
    mime_type = db.Column(db.String(120))
    tamano_bytes = db.Column(db.Integer)

    estado = db.Column(db.String(20), nullable=False, default='REGISTRADO', index=True)
    observaciones = db.Column(db.Text)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    cliente = db.relationship('ClienteComercial', backref=db.backref('recaudos', lazy='dynamic'))
    vendedor = db.relationship('Vendedor', backref=db.backref('recaudos', lazy='dynamic'))
    atenciones = db.relationship(
        'ComercialRecaudoAtencion',
        backref='recaudo',
        lazy='dynamic',
        cascade='all, delete-orphan'
    )

    def __repr__(self):
        return f'<ComercialRecaudo cliente={self.cliente_id} valor={self.valor_comprobante}>'


class ComercialRecaudoAtencion(db.Model):
    """Puente entre un recaudo (comprobante) y las atenciones que cubre."""
    __tablename__ = 'comercial_recaudo_atenciones'

    id = db.Column(db.Integer, primary_key=True)
    recaudo_id = db.Column(db.Integer, db.ForeignKey('comercial_recaudos.id'), nullable=False, index=True)
    atencion_id = db.Column(db.Integer, db.ForeignKey('clientes_atenciones.id'), nullable=False, index=True)
    valor_aplicado = db.Column(Numeric(15, 2), default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    atencion = db.relationship('ClienteAtencion', backref=db.backref('recaudo_asociaciones', lazy='dynamic'))

    __table_args__ = (
        db.UniqueConstraint('recaudo_id', 'atencion_id', name='uq_recaudo_atencion'),
    )

    def __repr__(self):
        return f'<ComercialRecaudoAtencion recaudo={self.recaudo_id} atencion={self.atencion_id}>'


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
