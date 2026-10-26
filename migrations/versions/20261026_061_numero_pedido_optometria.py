"""Agrega consecutivo unico a pedidos de optometria."""
from alembic import op
import sqlalchemy as sa

revision = '20261026_061'
down_revision = '20261026_060'
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE SEQUENCE IF NOT EXISTS optometria_pedido_nro_seq START WITH 1")
    op.add_column('optometria_pedidos', sa.Column('nro_pedido', sa.Integer(), nullable=True))
    op.execute("UPDATE optometria_pedidos SET nro_pedido = nextval('optometria_pedido_nro_seq') WHERE nro_pedido IS NULL")
    op.execute("SELECT setval('optometria_pedido_nro_seq', COALESCE((SELECT MAX(nro_pedido) FROM optometria_pedidos), 0) + 1, false)")
    op.alter_column('optometria_pedidos', 'nro_pedido', nullable=False)
    op.create_unique_constraint('uq_optometria_pedidos_nro_pedido', 'optometria_pedidos', ['nro_pedido'])
    op.create_index('ix_optometria_pedidos_nro_pedido', 'optometria_pedidos', ['nro_pedido'])

def downgrade():
    op.drop_index('ix_optometria_pedidos_nro_pedido', table_name='optometria_pedidos')
    op.drop_constraint('uq_optometria_pedidos_nro_pedido', 'optometria_pedidos', type_='unique')
    op.drop_column('optometria_pedidos', 'nro_pedido')
    op.execute('DROP SEQUENCE IF EXISTS optometria_pedido_nro_seq')
