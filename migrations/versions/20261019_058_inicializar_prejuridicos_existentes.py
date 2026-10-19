"""Inicializa el estado del flujo para prejuridicos existentes."""
from alembic import op
import sqlalchemy as sa

revision = '20261019_058'
down_revision = '20261019_057'
branch_labels = None
depends_on = None

def upgrade():
    op.execute(sa.text("""
        UPDATE siigo_seguimientos_cartera
        SET prejuridico_estado = 'PENDIENTE_APROBACION'
        WHERE estado_gestion = 'PREJURIDICO'
          AND prejuridico_estado IS NULL
    """))

def downgrade():
    # No se borran estados existentes durante el downgrade.
    pass
