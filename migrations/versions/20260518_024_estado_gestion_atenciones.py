"""agrega estado_gestion a atenciones_dia_detalle

Revision ID: 20260518_024
Revises: 20260518_023
Create Date: 2026-05-18 23:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260518_024'
down_revision = '20260518_023'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'atenciones_dia_detalle',
        sa.Column('estado_gestion', sa.String(length=20), nullable=True, server_default='CARGADA'),
    )
    op.execute("UPDATE atenciones_dia_detalle SET estado_gestion = 'CARGADA' WHERE estado_gestion IS NULL")
    op.alter_column('atenciones_dia_detalle', 'estado_gestion', nullable=False, server_default='CARGADA')
    op.create_index('ix_atenciones_dia_detalle_estado_gestion', 'atenciones_dia_detalle', ['estado_gestion'])


def downgrade():
    op.drop_index('ix_atenciones_dia_detalle_estado_gestion', table_name='atenciones_dia_detalle')
    op.drop_column('atenciones_dia_detalle', 'estado_gestion')
