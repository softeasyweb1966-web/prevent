"""Historial de seguimiento de cartera por cliente SIIGO.

Revision ID: 20260911_039
Revises: 20260903_038
"""
from alembic import op
import sqlalchemy as sa

revision = '20260911_039'
down_revision = '20260903_038'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'siigo_seguimientos_cartera',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('identificacion', sa.String(50), nullable=False),
        sa.Column('cliente_nombre', sa.String(255), nullable=False),
        sa.Column('fecha_gestion', sa.Date(), nullable=False),
        sa.Column('medio', sa.String(20), nullable=False),
        sa.Column('contacto', sa.String(200)),
        sa.Column('observaciones', sa.Text(), nullable=False),
        sa.Column('fecha_compromiso', sa.Date()),
        sa.Column('valor_compromiso', sa.Numeric(18, 2)),
        sa.Column('proximo_seguimiento', sa.Date()),
        sa.Column('usuario_id', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=False),
        sa.Column('usuario_nombre', sa.String(200), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_siigo_seguimientos_cartera_identificacion',
                    'siigo_seguimientos_cartera', ['identificacion'])


def downgrade():
    op.drop_index('ix_siigo_seguimientos_cartera_identificacion', table_name='siigo_seguimientos_cartera')
    op.drop_table('siigo_seguimientos_cartera')
