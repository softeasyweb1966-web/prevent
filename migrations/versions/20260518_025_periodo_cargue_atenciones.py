"""agrega periodo mensual a cargues de atenciones

Revision ID: 20260518_025
Revises: 20260518_024
Create Date: 2026-05-18 23:55:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260518_025'
down_revision = '20260518_024'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('cargue_atenciones_dia', sa.Column('periodo_desde', sa.DateTime(), nullable=True))
    op.add_column('cargue_atenciones_dia', sa.Column('periodo_hasta', sa.DateTime(), nullable=True))
    op.create_index('ix_cargue_atenciones_dia_periodo_desde', 'cargue_atenciones_dia', ['periodo_desde'])
    op.create_index('ix_cargue_atenciones_dia_periodo_hasta', 'cargue_atenciones_dia', ['periodo_hasta'])


def downgrade():
    op.drop_index('ix_cargue_atenciones_dia_periodo_hasta', table_name='cargue_atenciones_dia')
    op.drop_index('ix_cargue_atenciones_dia_periodo_desde', table_name='cargue_atenciones_dia')
    op.drop_column('cargue_atenciones_dia', 'periodo_hasta')
    op.drop_column('cargue_atenciones_dia', 'periodo_desde')
