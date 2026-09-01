"""Configuración de cuentas para el reporte mensual de ventas SIIGO.

Revision ID: 20260831_032
Revises: 20260831_030
Create Date: 2026-08-31 14:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260831_032'
down_revision = '20260831_030'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'siigo_cuentas_reporte',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('codigo_contable', sa.String(length=30), nullable=False),
        sa.Column('clasificacion', sa.String(length=30), nullable=False),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('codigo_contable'),
    )
    op.create_index('ix_siigo_cuentas_reporte_codigo_contable', 'siigo_cuentas_reporte', ['codigo_contable'])
    op.create_index('ix_siigo_cuentas_reporte_clasificacion', 'siigo_cuentas_reporte', ['clasificacion'])
    tabla = sa.table(
        'siigo_cuentas_reporte',
        sa.column('codigo_contable', sa.String),
        sa.column('clasificacion', sa.String),
        sa.column('activo', sa.Boolean),
    )
    op.bulk_insert(tabla, [
        {'codigo_contable': '41659501', 'clasificacion': 'INGRESO', 'activo': True},
        {'codigo_contable': '41350101', 'clasificacion': 'INGRESO', 'activo': True},
        {'codigo_contable': '41750501', 'clasificacion': 'NOTA_CREDITO', 'activo': True},
        {'codigo_contable': '41750502', 'clasificacion': 'NOTA_CREDITO', 'activo': True},
        {'codigo_contable': '24080501', 'clasificacion': 'IVA_GENERADO', 'activo': True},
        {'codigo_contable': '24080601', 'clasificacion': 'IVA_GENERADO', 'activo': True},
    ])


def downgrade():
    op.drop_table('siigo_cuentas_reporte')
