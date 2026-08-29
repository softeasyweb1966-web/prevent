"""agrega puntos de atencion recepcion a clientes comerciales

Revision ID: 20260426_009
Revises: 20260426_008
Create Date: 2026-04-26 19:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260426_009'
down_revision = '20260426_008'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'clientes_comerciales',
        sa.Column('puntos_atencion_recepcion', sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column('clientes_comerciales', 'puntos_atencion_recepcion')
