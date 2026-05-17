"""Agrega nombre_corto a comercial_catalogo_items

Revision ID: 20260517_022
Revises: 20260517_021
Create Date: 2026-05-17 23:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260517_022'
down_revision = '20260517_021'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'comercial_catalogo_items',
        sa.Column('nombre_corto', sa.String(50), nullable=True),
    )


def downgrade():
    op.drop_column('comercial_catalogo_items', 'nombre_corto')
