"""Crea catalogo CRUD de retenciones en la fuente."""
from alembic import op
import sqlalchemy as sa

revision = '20261030_063'
down_revision = '20261028_062'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('retenciones_fuente',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('codigo', sa.String(20), nullable=False, unique=True),
        sa.Column('categoria', sa.String(100), nullable=False),
        sa.Column('concepto', sa.String(255), nullable=False),
        sa.Column('base_uvt', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('base_pesos', sa.Numeric(16, 2), nullable=False, server_default='0'),
        sa.Column('tarifa_porcentaje', sa.Numeric(8, 4)),
        sa.Column('comparador', sa.String(20), nullable=False, server_default='>='),
        sa.Column('aplicacion_automatica', sa.String(20), nullable=False, server_default='CONDICIONAL'),
        sa.Column('observaciones', sa.Text()), sa.Column('norma_referencia', sa.String(255)),
        sa.Column('vigencia_desde', sa.Date()), sa.Column('vigencia_hasta', sa.Date()),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime()), sa.Column('updated_at', sa.DateTime()))

def downgrade(): op.drop_table('retenciones_fuente')
