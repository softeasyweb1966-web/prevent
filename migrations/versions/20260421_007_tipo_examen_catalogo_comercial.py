"""agrega clasificacion de tipo de examen al catalogo comercial

Revision ID: 20260421_007
Revises: 20260421_006
Create Date: 2026-04-21 20:05:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260421_007'
down_revision = '20260421_006'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('comercial_catalogo_items', sa.Column('tipo_examen', sa.String(length=20), nullable=True))
    op.create_index(op.f('ix_comercial_catalogo_items_tipo_examen'), 'comercial_catalogo_items', ['tipo_examen'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_comercial_catalogo_items_tipo_examen'), table_name='comercial_catalogo_items')
    op.drop_column('comercial_catalogo_items', 'tipo_examen')
