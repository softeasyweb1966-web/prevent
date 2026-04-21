"""amplia vendedores para modulo comercial

Revision ID: 20260415_003
Revises: 20260326_002
Create Date: 2026-04-15 20:15:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260415_003'
down_revision = '20260326_002'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('vendedores', sa.Column('porcentaje_comision_venta', sa.Numeric(5, 2), nullable=True))
    op.add_column('vendedores', sa.Column('porcentaje_comision_recaudo', sa.Numeric(5, 2), nullable=True))
    op.add_column('vendedores', sa.Column('monto_base_comision', sa.Numeric(15, 2), nullable=True))


def downgrade():
    op.drop_column('vendedores', 'monto_base_comision')
    op.drop_column('vendedores', 'porcentaje_comision_recaudo')
    op.drop_column('vendedores', 'porcentaje_comision_venta')
