"""agrega paciente por detalle de atencion

Revision ID: 20260427_015
Revises: 20260427_014
Create Date: 2026-04-27 13:40:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260427_015'
down_revision = '20260427_014'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {column['name'] for column in inspector.get_columns('clientes_atenciones_detalle')}

    with op.batch_alter_table('clientes_atenciones_detalle', recreate='always') as batch_op:
        if 'paciente_documento' not in existing_columns:
            batch_op.add_column(sa.Column('paciente_documento', sa.String(length=50), nullable=False, server_default=''))
        if 'paciente_nombre' not in existing_columns:
            batch_op.add_column(sa.Column('paciente_nombre', sa.String(length=200), nullable=False, server_default=''))

    inspector = sa.inspect(bind)
    existing_indexes = {index['name'] for index in inspector.get_indexes('clientes_atenciones_detalle')}
    if op.f('ix_clientes_atenciones_detalle_paciente_documento') not in existing_indexes:
        op.create_index(op.f('ix_clientes_atenciones_detalle_paciente_documento'), 'clientes_atenciones_detalle', ['paciente_documento'], unique=False)
    if op.f('ix_clientes_atenciones_detalle_paciente_nombre') not in existing_indexes:
        op.create_index(op.f('ix_clientes_atenciones_detalle_paciente_nombre'), 'clientes_atenciones_detalle', ['paciente_nombre'], unique=False)


def downgrade():
    inspector = sa.inspect(op.get_bind())
    existing_indexes = {index['name'] for index in inspector.get_indexes('clientes_atenciones_detalle')}
    if op.f('ix_clientes_atenciones_detalle_paciente_nombre') in existing_indexes:
        op.drop_index(op.f('ix_clientes_atenciones_detalle_paciente_nombre'), table_name='clientes_atenciones_detalle')
    if op.f('ix_clientes_atenciones_detalle_paciente_documento') in existing_indexes:
        op.drop_index(op.f('ix_clientes_atenciones_detalle_paciente_documento'), table_name='clientes_atenciones_detalle')

    existing_columns = {column['name'] for column in inspector.get_columns('clientes_atenciones_detalle')}
    if 'paciente_documento' in existing_columns or 'paciente_nombre' in existing_columns:
        with op.batch_alter_table('clientes_atenciones_detalle', recreate='always') as batch_op:
            if 'paciente_nombre' in existing_columns:
                batch_op.drop_column('paciente_nombre')
            if 'paciente_documento' in existing_columns:
                batch_op.drop_column('paciente_documento')
