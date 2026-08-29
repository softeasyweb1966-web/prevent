"""agrega is_easy a usuarios y tabla usuario_permiso para permisos extra por usuario

Revision ID: 20260516_019
Revises: 20260508_018
Create Date: 2026-05-16 14:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260516_019'
down_revision = '20260508_018'
branch_labels = None
depends_on = None


def upgrade():
    # Campo is_easy en la tabla de usuarios
    with op.batch_alter_table('usuarios', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('is_easy', sa.Boolean(), nullable=False, server_default=sa.text('false'))
        )

    # Tabla de permisos extra por usuario (many-to-many)
    op.create_table(
        'usuario_permiso',
        sa.Column('usuario_id', sa.Integer(), nullable=False),
        sa.Column('permiso_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['permiso_id'], ['permisos.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['usuario_id'], ['usuarios.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('usuario_id', 'permiso_id'),
    )
    op.create_index('ix_usuario_permiso_usuario_id', 'usuario_permiso', ['usuario_id'])
    op.create_index('ix_usuario_permiso_permiso_id', 'usuario_permiso', ['permiso_id'])


def downgrade():
    op.drop_index('ix_usuario_permiso_permiso_id', table_name='usuario_permiso')
    op.drop_index('ix_usuario_permiso_usuario_id', table_name='usuario_permiso')
    op.drop_table('usuario_permiso')

    with op.batch_alter_table('usuarios', schema=None) as batch_op:
        batch_op.drop_column('is_easy')
