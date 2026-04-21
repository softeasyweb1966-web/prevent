"""agrega detalle de examenes por paquete comercial

Revision ID: 20260421_006
Revises: 20260421_005
Create Date: 2026-04-21 19:20:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260421_006'
down_revision = '20260421_005'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'comercial_paquetes_detalle',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('paquete_id', sa.Integer(), nullable=False),
        sa.Column('examen_id', sa.Integer(), nullable=False),
        sa.Column('cantidad', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['examen_id'], ['comercial_catalogo_items.id']),
        sa.ForeignKeyConstraint(['paquete_id'], ['comercial_catalogo_items.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('paquete_id', 'examen_id', name='uq_paquete_examen_comercial')
    )
    op.create_index(
        op.f('ix_comercial_paquetes_detalle_paquete_id'),
        'comercial_paquetes_detalle',
        ['paquete_id'],
        unique=False
    )
    op.create_index(
        op.f('ix_comercial_paquetes_detalle_examen_id'),
        'comercial_paquetes_detalle',
        ['examen_id'],
        unique=False
    )


def downgrade():
    op.drop_index(op.f('ix_comercial_paquetes_detalle_examen_id'), table_name='comercial_paquetes_detalle')
    op.drop_index(op.f('ix_comercial_paquetes_detalle_paquete_id'), table_name='comercial_paquetes_detalle')
    op.drop_table('comercial_paquetes_detalle')
