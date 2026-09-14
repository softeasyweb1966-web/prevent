"""Adjuntos de pago de los seguimientos de cartera."""
from alembic import op
import sqlalchemy as sa

revision = '20260913_044'
down_revision = '20260913_043'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('siigo_comprobantes_pago',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('seguimiento_id', sa.Integer(), sa.ForeignKey('siigo_seguimientos_cartera.id', ondelete='CASCADE'), nullable=False),
        sa.Column('nombre', sa.String(255), nullable=False),
        sa.Column('mime_type', sa.String(80), nullable=False),
        sa.Column('tamano_bytes', sa.Integer(), nullable=False),
        sa.Column('contenido', sa.LargeBinary(), nullable=False),
        sa.Column('usuario_id', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=False),
        sa.Column('usuario_nombre', sa.String(200), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False))
    op.create_index('ix_siigo_comprobantes_pago_seguimiento_id', 'siigo_comprobantes_pago', ['seguimiento_id'])


def downgrade():
    op.drop_table('siigo_comprobantes_pago')
