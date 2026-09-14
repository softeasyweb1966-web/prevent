"""Usar contactos corregidos en la web en las empresas agrupadas."""
from alembic import op
import sqlalchemy as sa

revision = '20260913_045'
down_revision = '20260913_044'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('clientes_comerciales', sa.Column('contactos_agrupacion_manual', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column('clientes_comerciales', 'contactos_agrupacion_manual')
