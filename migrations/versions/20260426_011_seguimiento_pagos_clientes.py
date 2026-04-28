"""crea pagos de seguimiento comercial por cliente

Revision ID: 20260426_011
Revises: 20260426_010
Create Date: 2026-04-26 23:45:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260426_011'
down_revision = '20260426_010'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_name = 'clientes_seguimiento_pagos'

    if table_name not in inspector.get_table_names():
        op.create_table(
            table_name,
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('documento_id', sa.Integer(), nullable=False),
            sa.Column('cliente_id', sa.Integer(), nullable=False),
            sa.Column('vendedor_id', sa.Integer(), nullable=False),
            sa.Column('fecha_pago', sa.DateTime(), nullable=False),
            sa.Column('valor_pago', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
            sa.Column('tipo_pago', sa.String(length=20), nullable=False, server_default='ABONO'),
            sa.Column('medio_pago', sa.String(length=20), nullable=False, server_default='EFECTIVO'),
            sa.Column('canal_transferencia', sa.String(length=20), nullable=True),
            sa.Column('nombre_comprobante', sa.String(length=255), nullable=True),
            sa.Column('ruta_comprobante', sa.String(length=500), nullable=True),
            sa.Column('mime_type', sa.String(length=120), nullable=True),
            sa.Column('tamano_bytes', sa.Integer(), nullable=True),
            sa.Column('observaciones', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['cliente_id'], ['clientes_comerciales.id']),
            sa.ForeignKeyConstraint(['documento_id'], ['clientes_seguimiento_documentos.id']),
            sa.ForeignKeyConstraint(['vendedor_id'], ['vendedores.id']),
            sa.PrimaryKeyConstraint('id')
        )
        inspector = sa.inspect(bind)

    existing_indexes = {index['name'] for index in inspector.get_indexes(table_name)}
    index_specs = [
        (op.f('ix_clientes_seguimiento_pagos_documento_id'), ['documento_id']),
        (op.f('ix_clientes_seguimiento_pagos_cliente_id'), ['cliente_id']),
        (op.f('ix_clientes_seguimiento_pagos_vendedor_id'), ['vendedor_id']),
        (op.f('ix_clientes_seguimiento_pagos_fecha_pago'), ['fecha_pago']),
        (op.f('ix_clientes_seguimiento_pagos_tipo_pago'), ['tipo_pago']),
        (op.f('ix_clientes_seguimiento_pagos_medio_pago'), ['medio_pago']),
    ]
    for index_name, columns in index_specs:
        if index_name not in existing_indexes:
            op.create_index(index_name, table_name, columns, unique=False)


def downgrade():
    op.drop_index(op.f('ix_clientes_seguimiento_pagos_medio_pago'), table_name='clientes_seguimiento_pagos')
    op.drop_index(op.f('ix_clientes_seguimiento_pagos_tipo_pago'), table_name='clientes_seguimiento_pagos')
    op.drop_index(op.f('ix_clientes_seguimiento_pagos_fecha_pago'), table_name='clientes_seguimiento_pagos')
    op.drop_index(op.f('ix_clientes_seguimiento_pagos_vendedor_id'), table_name='clientes_seguimiento_pagos')
    op.drop_index(op.f('ix_clientes_seguimiento_pagos_cliente_id'), table_name='clientes_seguimiento_pagos')
    op.drop_index(op.f('ix_clientes_seguimiento_pagos_documento_id'), table_name='clientes_seguimiento_pagos')
    op.drop_table('clientes_seguimiento_pagos')
