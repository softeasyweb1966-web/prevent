"""Mejoras de ordenes de caja y adjuntos de transferencia

Revision ID: 20260530_028
Revises: 20260520_027
Create Date: 2026-05-30 16:20:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260530_028'
down_revision = '20260520_027'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('ordenes_servicio_caja', sa.Column('formas_autorizacion', sa.JSON(), nullable=True))
    op.add_column('ordenes_servicio_caja', sa.Column('autorizacion_observaciones', sa.Text(), nullable=True))
    op.add_column('ordenes_servicio_caja', sa.Column('grupo_requerimientos', sa.JSON(), nullable=True))
    op.add_column('ordenes_servicio_caja', sa.Column('numero_turno', sa.String(length=50), nullable=True))

    op.create_table(
        'ordenes_servicio_caja_adjuntos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('orden_id', sa.Integer(), nullable=False),
        sa.Column('nombre_original', sa.String(length=255), nullable=False),
        sa.Column('ruta_relativa', sa.String(length=500), nullable=False),
        sa.Column('mime_type', sa.String(length=120), nullable=True),
        sa.Column('tamano_bytes', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['orden_id'], ['ordenes_servicio_caja.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_ordenes_servicio_caja_adjuntos_orden_id',
        'ordenes_servicio_caja_adjuntos',
        ['orden_id'],
    )


def downgrade():
    op.drop_index('ix_ordenes_servicio_caja_adjuntos_orden_id', table_name='ordenes_servicio_caja_adjuntos')
    op.drop_table('ordenes_servicio_caja_adjuntos')

    op.drop_column('ordenes_servicio_caja', 'numero_turno')
    op.drop_column('ordenes_servicio_caja', 'grupo_requerimientos')
    op.drop_column('ordenes_servicio_caja', 'autorizacion_observaciones')
    op.drop_column('ordenes_servicio_caja', 'formas_autorizacion')
