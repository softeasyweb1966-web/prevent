"""Crea el catálogo mensual de tasas de interés de mora."""
from alembic import op
import sqlalchemy as sa

revision = '20261019_059'
down_revision = '20261019_058'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        'tasas_interes_mora',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('anio', sa.Integer(), nullable=False),
        sa.Column('mes', sa.Integer(), nullable=False),
        sa.Column('tasa_anual', sa.Numeric(12, 10), nullable=False),
        sa.Column('tasa_diaria', sa.Numeric(16, 14), nullable=False),
        sa.Column('fuente', sa.String(length=500)),
        sa.Column('observaciones', sa.Text()),
        sa.Column('registrado_por', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('anio', 'mes', name='uq_tasa_interes_mora_periodo'),
    )

def downgrade():
    op.drop_table('tasas_interes_mora')
