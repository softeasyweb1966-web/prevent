"""crea catalogo y tarifas comerciales

Revision ID: 20260421_005
Revises: 20260421_004
Create Date: 2026-04-21 18:10:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260421_005'
down_revision = '20260421_004'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'comercial_catalogo_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tipo_item', sa.String(length=20), nullable=False),
        sa.Column('nombre', sa.String(length=200), nullable=False),
        sa.Column('codigo', sa.String(length=50), nullable=True),
        sa.Column('descripcion', sa.Text(), nullable=True),
        sa.Column('tarifa_base', sa.Numeric(15, 2), nullable=True),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('codigo')
    )
    op.create_index(op.f('ix_comercial_catalogo_items_tipo_item'), 'comercial_catalogo_items', ['tipo_item'], unique=False)
    op.create_index(op.f('ix_comercial_catalogo_items_nombre'), 'comercial_catalogo_items', ['nombre'], unique=False)
    op.create_index(op.f('ix_comercial_catalogo_items_codigo'), 'comercial_catalogo_items', ['codigo'], unique=True)

    op.create_table(
        'clientes_comerciales_tarifas',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('cliente_id', sa.Integer(), nullable=False),
        sa.Column('catalogo_item_id', sa.Integer(), nullable=False),
        sa.Column('tarifa_negociada', sa.Numeric(15, 2), nullable=False),
        sa.Column('vigencia_desde', sa.DateTime(), nullable=True),
        sa.Column('vigencia_hasta', sa.DateTime(), nullable=True),
        sa.Column('observacion', sa.Text(), nullable=True),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['catalogo_item_id'], ['comercial_catalogo_items.id']),
        sa.ForeignKeyConstraint(['cliente_id'], ['clientes_comerciales.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('cliente_id', 'catalogo_item_id', name='uq_cliente_catalogo_tarifa')
    )
    op.create_index(op.f('ix_clientes_comerciales_tarifas_cliente_id'), 'clientes_comerciales_tarifas', ['cliente_id'], unique=False)
    op.create_index(op.f('ix_clientes_comerciales_tarifas_catalogo_item_id'), 'clientes_comerciales_tarifas', ['catalogo_item_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_clientes_comerciales_tarifas_catalogo_item_id'), table_name='clientes_comerciales_tarifas')
    op.drop_index(op.f('ix_clientes_comerciales_tarifas_cliente_id'), table_name='clientes_comerciales_tarifas')
    op.drop_table('clientes_comerciales_tarifas')

    op.drop_index(op.f('ix_comercial_catalogo_items_codigo'), table_name='comercial_catalogo_items')
    op.drop_index(op.f('ix_comercial_catalogo_items_nombre'), table_name='comercial_catalogo_items')
    op.drop_index(op.f('ix_comercial_catalogo_items_tipo_item'), table_name='comercial_catalogo_items')
    op.drop_table('comercial_catalogo_items')
