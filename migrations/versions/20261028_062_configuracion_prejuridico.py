"""Agrega configuración del abogado y firma de prejurídicos."""
from alembic import op
import sqlalchemy as sa

revision = '20261028_062'
down_revision = '20261026_061'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        'configuracion_prejuridico',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('abogado_nombre', sa.String(200), nullable=False, server_default=''),
        sa.Column('abogado_identificacion', sa.String(80), nullable=False, server_default=''),
        sa.Column('abogado_tarjeta_profesional', sa.String(80), nullable=False, server_default=''),
        sa.Column('abogado_cargo', sa.String(120), nullable=False, server_default='Abogada Especialista'),
        sa.Column('firma_archivo', sa.LargeBinary()),
        sa.Column('firma_mimetype', sa.String(100)),
        sa.Column('firma_nombre', sa.String(255)),
        sa.Column('actualizado_at', sa.DateTime()),
    )

def downgrade():
    op.drop_table('configuracion_prejuridico')
