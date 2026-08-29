"""Crea tabla ordenes_servicio_caja - Registro diario de caja

Revision ID: 20260520_027
Revises: 20260519_026
Create Date: 2026-05-20 00:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision      = '20260520_027'
down_revision = '20260519_026'
branch_labels = None
depends_on    = None


def upgrade():
    op.create_table(
        'ordenes_servicio_caja',
        sa.Column('id',                   sa.Integer(),      nullable=False),
        sa.Column('nro_orden',            sa.String(50),     nullable=False),
        sa.Column('fecha_orden',          sa.DateTime(),     nullable=False),
        sa.Column('tipo_documento',       sa.String(10),     nullable=False),
        sa.Column('nro_documento',        sa.String(30),     nullable=False),
        sa.Column('nombre_paciente',      sa.String(200),    nullable=False),
        sa.Column('cargo_paciente',       sa.String(150),    nullable=True),
        sa.Column('empresa',              sa.String(200),    nullable=True),
        sa.Column('empresa_mision',       sa.String(200),    nullable=True),
        sa.Column('tipo_examen',          sa.String(50),     nullable=True),
        sa.Column('tipo_examen_otro',     sa.String(100),    nullable=True),
        sa.Column('enfasis',              postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('enfasis_otro',         sa.String(100),    nullable=True),
        sa.Column('paraclinicos',         postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('paraclinicos_otro',    sa.String(100),    nullable=True),
        sa.Column('laboratorio',          postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('laboratorio_otro',     sa.String(100),    nullable=True),
        sa.Column('otros_servicios',      postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('otros_servicios_otro', sa.String(100),    nullable=True),
        sa.Column('total_costo',          sa.Numeric(15, 2), nullable=False, server_default='0'),
        sa.Column('tipo_cliente',         sa.String(20),     nullable=True),
        sa.Column('forma_pago',           sa.String(20),     nullable=False),
        sa.Column('mixto_efectivo',       sa.Numeric(15, 2), nullable=True),
        sa.Column('mixto_transferencia',  sa.Numeric(15, 2), nullable=True),
        sa.Column('mixto_credito',        sa.Numeric(15, 2), nullable=True),
        sa.Column('estado',               sa.String(20),     nullable=False, server_default='INGRESADO'),
        sa.Column('motivo_anulacion',     sa.Text(),         nullable=True),
        sa.Column('observaciones',        sa.Text(),         nullable=True),
        sa.Column('usuario_id',           sa.Integer(),      nullable=True),
        sa.Column('usuario_aprueba_id',   sa.Integer(),      nullable=True),
        sa.Column('fecha_aprobacion',     sa.DateTime(),     nullable=True),
        sa.Column('usuario_termina_id',   sa.Integer(),      nullable=True),
        sa.Column('fecha_terminacion',    sa.DateTime(),     nullable=True),
        sa.Column('usuario_anula_id',     sa.Integer(),      nullable=True),
        sa.Column('fecha_anulacion',      sa.DateTime(),     nullable=True),
        sa.Column('cliente_id',           sa.Integer(),      nullable=True),
        sa.Column('created_at',           sa.DateTime(),     nullable=False),
        sa.Column('updated_at',           sa.DateTime(),     nullable=True),
        sa.ForeignKeyConstraint(['usuario_id'],          ['usuarios.id']),
        sa.ForeignKeyConstraint(['usuario_aprueba_id'],  ['usuarios.id']),
        sa.ForeignKeyConstraint(['usuario_termina_id'],  ['usuarios.id']),
        sa.ForeignKeyConstraint(['usuario_anula_id'],    ['usuarios.id']),
        sa.ForeignKeyConstraint(['cliente_id'],          ['clientes_comerciales.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ordenes_servicio_caja_nro_orden',    'ordenes_servicio_caja', ['nro_orden'])
    op.create_index('ix_ordenes_servicio_caja_fecha_orden',  'ordenes_servicio_caja', ['fecha_orden'])
    op.create_index('ix_ordenes_servicio_caja_nro_documento','ordenes_servicio_caja', ['nro_documento'])
    op.create_index('ix_ordenes_servicio_caja_empresa',      'ordenes_servicio_caja', ['empresa'])
    op.create_index('ix_ordenes_servicio_caja_empresa_mision','ordenes_servicio_caja', ['empresa_mision'])
    op.create_index('ix_ordenes_servicio_caja_estado',       'ordenes_servicio_caja', ['estado'])
    op.create_index('ix_ordenes_servicio_caja_forma_pago',   'ordenes_servicio_caja', ['forma_pago'])
    op.create_index('ix_ordenes_servicio_caja_cliente_id',   'ordenes_servicio_caja', ['cliente_id'])
    op.create_index('ix_orden_caja_nro_fecha',               'ordenes_servicio_caja', ['nro_orden', 'fecha_orden'])


def downgrade():
    op.drop_table('ordenes_servicio_caja')
