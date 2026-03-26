"""agrega tabla de vendedores

Revision ID: 20260326_002
Revises: 20260324_001
Create Date: 2026-03-26 21:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260326_002'
down_revision = '20260324_001'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'vendedores',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nombre', sa.String(length=200), nullable=False),
        sa.Column('documento', sa.String(length=30), nullable=True),
        sa.Column('telefono', sa.String(length=50), nullable=True),
        sa.Column('email', sa.String(length=120), nullable=True),
        sa.Column('descripcion', sa.Text(), nullable=True),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('documento')
    )
    op.create_index(op.f('ix_vendedores_nombre'), 'vendedores', ['nombre'], unique=False)
    op.create_index(op.f('ix_vendedores_documento'), 'vendedores', ['documento'], unique=True)


def downgrade():
    op.drop_index(op.f('ix_vendedores_documento'), table_name='vendedores')
    op.drop_index(op.f('ix_vendedores_nombre'), table_name='vendedores')
    op.drop_table('vendedores')
