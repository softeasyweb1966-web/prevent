"""agrega recibo de caja y detalle paciente a pagos comerciales

Revision ID: 20260427_012
Revises: 20260426_011
Create Date: 2026-04-27 09:10:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260427_012'
down_revision = '20260426_011'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_name = 'clientes_seguimiento_pagos'

    existing_columns = {column['name'] for column in inspector.get_columns(table_name)}
    column_specs = [
        ('numero_recibo_caja', sa.Column('numero_recibo_caja', sa.String(length=50), nullable=True)),
        ('fecha_recibo', sa.Column('fecha_recibo', sa.DateTime(), nullable=True)),
        ('paciente_documento', sa.Column('paciente_documento', sa.String(length=50), nullable=True)),
        ('paciente_nombre', sa.Column('paciente_nombre', sa.String(length=200), nullable=True)),
        ('fecha_atencion', sa.Column('fecha_atencion', sa.DateTime(), nullable=True)),
        ('examenes_realizados', sa.Column('examenes_realizados', sa.Text(), nullable=True)),
    ]
    for column_name, column in column_specs:
        if column_name not in existing_columns:
            op.add_column(table_name, column)

    inspector = sa.inspect(bind)
    existing_indexes = {index['name'] for index in inspector.get_indexes(table_name)}
    index_specs = [
        (op.f('ix_clientes_seguimiento_pagos_numero_recibo_caja'), ['numero_recibo_caja']),
        (op.f('ix_clientes_seguimiento_pagos_fecha_recibo'), ['fecha_recibo']),
        (op.f('ix_clientes_seguimiento_pagos_paciente_documento'), ['paciente_documento']),
        (op.f('ix_clientes_seguimiento_pagos_paciente_nombre'), ['paciente_nombre']),
        (op.f('ix_clientes_seguimiento_pagos_fecha_atencion'), ['fecha_atencion']),
    ]
    for index_name, columns in index_specs:
        if index_name not in existing_indexes:
            op.create_index(index_name, table_name, columns, unique=False)


def downgrade():
    table_name = 'clientes_seguimiento_pagos'
    op.drop_index(op.f('ix_clientes_seguimiento_pagos_fecha_atencion'), table_name=table_name)
    op.drop_index(op.f('ix_clientes_seguimiento_pagos_paciente_nombre'), table_name=table_name)
    op.drop_index(op.f('ix_clientes_seguimiento_pagos_paciente_documento'), table_name=table_name)
    op.drop_index(op.f('ix_clientes_seguimiento_pagos_fecha_recibo'), table_name=table_name)
    op.drop_index(op.f('ix_clientes_seguimiento_pagos_numero_recibo_caja'), table_name=table_name)
    op.drop_column(table_name, 'examenes_realizados')
    op.drop_column(table_name, 'fecha_atencion')
    op.drop_column(table_name, 'paciente_nombre')
    op.drop_column(table_name, 'paciente_documento')
    op.drop_column(table_name, 'fecha_recibo')
    op.drop_column(table_name, 'numero_recibo_caja')
