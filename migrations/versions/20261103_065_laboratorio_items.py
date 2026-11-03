"""Agrega laboratorio asignado a items de optometria."""
from alembic import op
import sqlalchemy as sa

revision = '20261103_065'
down_revision = '20261102_064'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('optometria_pedido_items', sa.Column('laboratorio', sa.String(200), nullable=True))

def downgrade():
    op.drop_column('optometria_pedido_items', 'laboratorio')
