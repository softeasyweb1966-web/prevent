"""vincula vendedores con usuarios del sistema

Revision ID: 20260901_034
Revises: 20260901_033
Create Date: 2026-09-01 10:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260901_034'
down_revision = '20260901_033'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('vendedores', sa.Column('usuario_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_vendedores_usuario_id'), 'vendedores', ['usuario_id'], unique=True)
    op.create_foreign_key(
        'fk_vendedores_usuario_id_usuarios',
        'vendedores',
        'usuarios',
        ['usuario_id'],
        ['id'],
    )


def downgrade():
    op.drop_constraint('fk_vendedores_usuario_id_usuarios', 'vendedores', type_='foreignkey')
    op.drop_index(op.f('ix_vendedores_usuario_id'), table_name='vendedores')
    op.drop_column('vendedores', 'usuario_id')
