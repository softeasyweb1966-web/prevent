"""Extiende prefacturas para anticipos manuales y cruce con atenciones

Revision ID: 20260519_026
Revises: 20260518_025
Create Date: 2026-05-19 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260519_026'
down_revision = '20260518_025'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'prefacturas_comerciales',
        sa.Column('origen', sa.String(length=30), nullable=False, server_default='ATENCIONES'),
    )
    op.add_column('prefacturas_comerciales', sa.Column('fecha_programada', sa.DateTime(), nullable=True))
    op.add_column(
        'prefacturas_comerciales',
        sa.Column('bloqueada_por_pago', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column('prefacturas_comerciales', sa.Column('fecha_bloqueo_pago', sa.DateTime(), nullable=True))
    op.drop_constraint(
        'uq_prefactura_empresa_periodo_forma',
        'prefacturas_comerciales',
        type_='unique',
    )
    op.create_unique_constraint(
        'uq_prefactura_empresa_periodo_forma_origen',
        'prefacturas_comerciales',
        ['nombre_empresa', 'fecha_desde', 'fecha_hasta', 'forma_pago', 'origen'],
    )

    op.create_index('ix_prefacturas_comerciales_origen', 'prefacturas_comerciales', ['origen'])
    op.create_index('ix_prefacturas_comerciales_fecha_programada', 'prefacturas_comerciales', ['fecha_programada'])
    op.create_index('ix_prefacturas_comerciales_bloqueada_por_pago', 'prefacturas_comerciales', ['bloqueada_por_pago'])

    op.create_table(
        'prefacturas_comerciales_detalle',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('prefactura_id', sa.Integer(), nullable=False),
        sa.Column('paciente_documento', sa.String(length=50), nullable=False),
        sa.Column('paciente_nombre', sa.String(length=200), nullable=False),
        sa.Column('catalogo_item_id', sa.Integer(), nullable=False),
        sa.Column('tipo_item', sa.String(length=20), nullable=False),
        sa.Column('nombre_item', sa.String(length=200), nullable=False),
        sa.Column('valor_item', sa.Numeric(15, 2), nullable=False, server_default='0'),
        sa.Column('fecha_programada', sa.DateTime(), nullable=False),
        sa.Column('estado_cruce', sa.String(length=20), nullable=False, server_default='PENDIENTE'),
        sa.Column('atencion_dia_id', sa.Integer(), nullable=True),
        sa.Column('cruzado_at', sa.DateTime(), nullable=True),
        sa.Column('observaciones', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['atencion_dia_id'], ['atenciones_dia_detalle.id']),
        sa.ForeignKeyConstraint(['catalogo_item_id'], ['comercial_catalogo_items.id']),
        sa.ForeignKeyConstraint(['prefactura_id'], ['prefacturas_comerciales.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_prefacturas_comerciales_detalle_prefactura_id', 'prefacturas_comerciales_detalle', ['prefactura_id'])
    op.create_index('ix_prefacturas_comerciales_detalle_paciente_documento', 'prefacturas_comerciales_detalle', ['paciente_documento'])
    op.create_index('ix_prefacturas_comerciales_detalle_paciente_nombre', 'prefacturas_comerciales_detalle', ['paciente_nombre'])
    op.create_index('ix_prefacturas_comerciales_detalle_catalogo_item_id', 'prefacturas_comerciales_detalle', ['catalogo_item_id'])
    op.create_index('ix_prefacturas_comerciales_detalle_tipo_item', 'prefacturas_comerciales_detalle', ['tipo_item'])
    op.create_index('ix_prefacturas_comerciales_detalle_fecha_programada', 'prefacturas_comerciales_detalle', ['fecha_programada'])
    op.create_index('ix_prefacturas_comerciales_detalle_estado_cruce', 'prefacturas_comerciales_detalle', ['estado_cruce'])
    op.create_index('ix_prefacturas_comerciales_detalle_atencion_dia_id', 'prefacturas_comerciales_detalle', ['atencion_dia_id'])

    op.add_column('cartera_prefacturas', sa.Column('canal_transferencia', sa.String(length=20), nullable=True))
    op.add_column('cartera_prefacturas', sa.Column('nombre_comprobante', sa.String(length=255), nullable=True))
    op.add_column('cartera_prefacturas', sa.Column('ruta_comprobante', sa.String(length=500), nullable=True))
    op.add_column('cartera_prefacturas', sa.Column('mime_type', sa.String(length=120), nullable=True))
    op.add_column('cartera_prefacturas', sa.Column('tamano_bytes', sa.Integer(), nullable=True))

    op.create_index('ix_cartera_prefacturas_canal_transferencia', 'cartera_prefacturas', ['canal_transferencia'])


def downgrade():
    op.drop_index('ix_cartera_prefacturas_canal_transferencia', table_name='cartera_prefacturas')

    op.drop_column('cartera_prefacturas', 'tamano_bytes')
    op.drop_column('cartera_prefacturas', 'mime_type')
    op.drop_column('cartera_prefacturas', 'ruta_comprobante')
    op.drop_column('cartera_prefacturas', 'nombre_comprobante')
    op.drop_column('cartera_prefacturas', 'canal_transferencia')

    op.drop_index('ix_prefacturas_comerciales_detalle_atencion_dia_id', table_name='prefacturas_comerciales_detalle')
    op.drop_index('ix_prefacturas_comerciales_detalle_estado_cruce', table_name='prefacturas_comerciales_detalle')
    op.drop_index('ix_prefacturas_comerciales_detalle_fecha_programada', table_name='prefacturas_comerciales_detalle')
    op.drop_index('ix_prefacturas_comerciales_detalle_tipo_item', table_name='prefacturas_comerciales_detalle')
    op.drop_index('ix_prefacturas_comerciales_detalle_catalogo_item_id', table_name='prefacturas_comerciales_detalle')
    op.drop_index('ix_prefacturas_comerciales_detalle_paciente_nombre', table_name='prefacturas_comerciales_detalle')
    op.drop_index('ix_prefacturas_comerciales_detalle_paciente_documento', table_name='prefacturas_comerciales_detalle')
    op.drop_index('ix_prefacturas_comerciales_detalle_prefactura_id', table_name='prefacturas_comerciales_detalle')
    op.drop_table('prefacturas_comerciales_detalle')

    op.drop_index('ix_prefacturas_comerciales_bloqueada_por_pago', table_name='prefacturas_comerciales')
    op.drop_index('ix_prefacturas_comerciales_fecha_programada', table_name='prefacturas_comerciales')
    op.drop_index('ix_prefacturas_comerciales_origen', table_name='prefacturas_comerciales')

    op.drop_constraint(
        'uq_prefactura_empresa_periodo_forma_origen',
        'prefacturas_comerciales',
        type_='unique',
    )
    op.create_unique_constraint(
        'uq_prefactura_empresa_periodo_forma',
        'prefacturas_comerciales',
        ['nombre_empresa', 'fecha_desde', 'fecha_hasta', 'forma_pago'],
    )
    op.drop_column('prefacturas_comerciales', 'fecha_bloqueo_pago')
    op.drop_column('prefacturas_comerciales', 'bloqueada_por_pago')
    op.drop_column('prefacturas_comerciales', 'fecha_programada')
    op.drop_column('prefacturas_comerciales', 'origen')
