"""Agrega items a los pedidos de optometria."""
from alembic import op
import sqlalchemy as sa

revision = '20261102_064'
down_revision = '20261030_063'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        'optometria_pedido_items',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('pedido_id', sa.Integer(), sa.ForeignKey('optometria_pedidos.id', ondelete='CASCADE'), nullable=False),
        sa.Column('descripcion', sa.Text(), nullable=False),
        sa.Column('cantidad', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('valor_unitario', sa.Numeric(15, 2), nullable=False, server_default='0'),
        sa.Column('total', sa.Numeric(15, 2), nullable=False, server_default='0'),
        sa.Column('observaciones', sa.Text()),
    )
    op.create_index('ix_optometria_pedido_items_pedido_id', 'optometria_pedido_items', ['pedido_id'])

def downgrade():
    op.drop_index('ix_optometria_pedido_items_pedido_id', table_name='optometria_pedido_items')
    op.drop_table('optometria_pedido_items')
