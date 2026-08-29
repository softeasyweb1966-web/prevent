"""Agrega tablas prefacturas_comerciales y cartera_prefacturas

Revision ID: 20260518_023
Revises: 20260517_022
Create Date: 2026-05-18 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260518_023'
down_revision = '20260517_022'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'prefacturas_comerciales',
        sa.Column('id',               sa.Integer(),     nullable=False),
        sa.Column('cliente_id',       sa.Integer(),     nullable=True),
        sa.Column('nombre_empresa',   sa.String(300),   nullable=False),
        sa.Column('fecha_desde',      sa.DateTime(),    nullable=False),
        sa.Column('fecha_hasta',      sa.DateTime(),    nullable=False),
        sa.Column('forma_pago',       sa.String(20),    nullable=False),
        sa.Column('cant_pacientes',   sa.Integer(),     nullable=False, server_default='0'),
        sa.Column('valor_total',      sa.Numeric(15, 2), nullable=False, server_default='0'),
        sa.Column('estado',           sa.String(20),    nullable=False, server_default='BORRADOR'),
        sa.Column('fecha_factura',    sa.DateTime(),    nullable=True),
        sa.Column('nro_factura',      sa.String(80),    nullable=True),
        sa.Column('valor_factura',    sa.Numeric(15, 2), nullable=True),
        sa.Column('usuario_genera_id', sa.Integer(),    nullable=True),
        sa.Column('usuario_cierra_id', sa.Integer(),    nullable=True),
        sa.Column('fecha_cierre',     sa.DateTime(),    nullable=True),
        sa.Column('observaciones',    sa.Text(),        nullable=True),
        sa.Column('created_at',       sa.DateTime(),    nullable=True),
        sa.Column('updated_at',       sa.DateTime(),    nullable=True),
        sa.ForeignKeyConstraint(['cliente_id'],       ['clientes_comerciales.id']),
        sa.ForeignKeyConstraint(['usuario_genera_id'], ['usuarios.id']),
        sa.ForeignKeyConstraint(['usuario_cierra_id'], ['usuarios.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'nombre_empresa', 'fecha_desde', 'fecha_hasta', 'forma_pago',
            name='uq_prefactura_empresa_periodo_forma',
        ),
    )
    op.create_index('ix_prefacturas_comerciales_nombre_empresa', 'prefacturas_comerciales', ['nombre_empresa'])
    op.create_index('ix_prefacturas_comerciales_fecha_desde',    'prefacturas_comerciales', ['fecha_desde'])
    op.create_index('ix_prefacturas_comerciales_fecha_hasta',    'prefacturas_comerciales', ['fecha_hasta'])
    op.create_index('ix_prefacturas_comerciales_forma_pago',     'prefacturas_comerciales', ['forma_pago'])
    op.create_index('ix_prefacturas_comerciales_estado',         'prefacturas_comerciales', ['estado'])
    op.create_index('ix_prefacturas_comerciales_nro_factura',    'prefacturas_comerciales', ['nro_factura'])
    op.create_index('ix_prefacturas_comerciales_cliente_id',     'prefacturas_comerciales', ['cliente_id'])

    op.create_table(
        'cartera_prefacturas',
        sa.Column('id',              sa.Integer(),      nullable=False),
        sa.Column('prefactura_id',   sa.Integer(),      nullable=False),
        sa.Column('tipo_movimiento', sa.String(30),     nullable=False),
        sa.Column('fecha_pago',      sa.DateTime(),     nullable=False),
        sa.Column('valor_pago',      sa.Numeric(15, 2), nullable=False),
        sa.Column('medio_pago',      sa.String(30),     nullable=True),
        sa.Column('nro_comprobante', sa.String(80),     nullable=True),
        sa.Column('estado',          sa.String(20),     nullable=False, server_default='APLICADO'),
        sa.Column('observaciones',   sa.Text(),         nullable=True),
        sa.Column('usuario_id',      sa.Integer(),      nullable=True),
        sa.Column('created_at',      sa.DateTime(),     nullable=True),
        sa.Column('updated_at',      sa.DateTime(),     nullable=True),
        sa.ForeignKeyConstraint(['prefactura_id'], ['prefacturas_comerciales.id']),
        sa.ForeignKeyConstraint(['usuario_id'],    ['usuarios.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_cartera_prefacturas_prefactura_id',   'cartera_prefacturas', ['prefactura_id'])
    op.create_index('ix_cartera_prefacturas_tipo_movimiento', 'cartera_prefacturas', ['tipo_movimiento'])
    op.create_index('ix_cartera_prefacturas_fecha_pago',      'cartera_prefacturas', ['fecha_pago'])
    op.create_index('ix_cartera_prefacturas_estado',          'cartera_prefacturas', ['estado'])


def downgrade():
    op.drop_table('cartera_prefacturas')
    op.drop_table('prefacturas_comerciales')
