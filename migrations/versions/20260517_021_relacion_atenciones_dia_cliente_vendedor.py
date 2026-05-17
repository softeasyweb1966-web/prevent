"""relaciona atenciones dia con cliente comercial y vendedor

Revision ID: 20260517_021
Revises: 20260517_020
Create Date: 2026-05-17 23:10:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260517_021'
down_revision = '20260517_020'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('atenciones_dia_detalle', sa.Column('cliente_id', sa.Integer(), nullable=True))
    op.add_column('atenciones_dia_detalle', sa.Column('vendedor_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_atenciones_dia_detalle_cliente_id'), 'atenciones_dia_detalle', ['cliente_id'], unique=False)
    op.create_index(op.f('ix_atenciones_dia_detalle_vendedor_id'), 'atenciones_dia_detalle', ['vendedor_id'], unique=False)
    op.create_foreign_key(
        'fk_atenciones_dia_detalle_cliente_id_clientes_comerciales',
        'atenciones_dia_detalle',
        'clientes_comerciales',
        ['cliente_id'],
        ['id'],
    )
    op.create_foreign_key(
        'fk_atenciones_dia_detalle_vendedor_id_vendedores',
        'atenciones_dia_detalle',
        'vendedores',
        ['vendedor_id'],
        ['id'],
    )


def downgrade():
    op.drop_constraint('fk_atenciones_dia_detalle_vendedor_id_vendedores', 'atenciones_dia_detalle', type_='foreignkey')
    op.drop_constraint('fk_atenciones_dia_detalle_cliente_id_clientes_comerciales', 'atenciones_dia_detalle', type_='foreignkey')
    op.drop_index(op.f('ix_atenciones_dia_detalle_vendedor_id'), table_name='atenciones_dia_detalle')
    op.drop_index(op.f('ix_atenciones_dia_detalle_cliente_id'), table_name='atenciones_dia_detalle')
    op.drop_column('atenciones_dia_detalle', 'vendedor_id')
    op.drop_column('atenciones_dia_detalle', 'cliente_id')
