"""agrega clasificacion detallada para examenes comerciales

Revision ID: 20260426_008
Revises: 20260421_007
Create Date: 2026-04-26 12:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260426_008'
down_revision = '20260421_007'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'comercial_catalogo_items',
        sa.Column('subtipo_laboratorio', sa.String(length=30), nullable=True),
    )
    op.add_column(
        'comercial_catalogo_items',
        sa.Column(
            'clasificacion_completa',
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.create_index(
        op.f('ix_comercial_catalogo_items_subtipo_laboratorio'),
        'comercial_catalogo_items',
        ['subtipo_laboratorio'],
        unique=False,
    )
    op.create_index(
        op.f('ix_comercial_catalogo_items_clasificacion_completa'),
        'comercial_catalogo_items',
        ['clasificacion_completa'],
        unique=False,
    )

    op.execute(
        """
        UPDATE comercial_catalogo_items
        SET clasificacion_completa = false
        WHERE tipo_item = 'EXAMEN'
          AND (
            tipo_examen IS NULL
            OR tipo_examen = 'LABORATORIO'
          )
        """
    )


def downgrade():
    op.drop_index(
        op.f('ix_comercial_catalogo_items_clasificacion_completa'),
        table_name='comercial_catalogo_items',
    )
    op.drop_index(
        op.f('ix_comercial_catalogo_items_subtipo_laboratorio'),
        table_name='comercial_catalogo_items',
    )
    op.drop_column('comercial_catalogo_items', 'clasificacion_completa')
    op.drop_column('comercial_catalogo_items', 'subtipo_laboratorio')
