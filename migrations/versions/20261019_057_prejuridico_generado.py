"""Registra la generación del documento prejurídico."""
from alembic import op
import sqlalchemy as sa

revision = '20261019_057'
down_revision = '20261019_056'
branch_labels = None
depends_on = None

def upgrade():
    tabla = 'siigo_seguimientos_cartera'
    op.add_column(tabla, sa.Column('prejuridico_generado_por', sa.String(length=200), nullable=True))
    op.add_column(tabla, sa.Column('prejuridico_generado_at', sa.DateTime(), nullable=True))
    op.add_column(tabla, sa.Column('prejuridico_documento_version', sa.Integer(), nullable=False, server_default='0'))
    op.alter_column(tabla, 'prejuridico_documento_version', server_default=None)

def downgrade():
    tabla = 'siigo_seguimientos_cartera'
    op.drop_column(tabla, 'prejuridico_documento_version')
    op.drop_column(tabla, 'prejuridico_generado_at')
    op.drop_column(tabla, 'prejuridico_generado_por')
