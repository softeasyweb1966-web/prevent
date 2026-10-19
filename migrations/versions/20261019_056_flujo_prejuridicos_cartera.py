"""Agrega flujo administrativo de prejuridicos de cartera."""
from alembic import op
import sqlalchemy as sa

revision = '20261019_056'
down_revision = '20261019_055'
branch_labels = None
depends_on = None

def upgrade():
    tabla = 'siigo_seguimientos_cartera'
    columnas = [
        ('prejuridico_estado', sa.String(35)), ('prejuridico_motivo', sa.Text()),
        ('prejuridico_aprobado_por', sa.String(200)), ('prejuridico_aprobado_at', sa.DateTime()),
        ('prejuridico_enviado_por', sa.String(200)), ('prejuridico_enviado_at', sa.DateTime()),
        ('prejuridico_destinatario', sa.String(200)), ('prejuridico_referencia', sa.String(100)),
    ]
    for nombre, tipo in columnas:
        op.add_column(tabla, sa.Column(nombre, tipo, nullable=True))
    op.create_index('ix_siigo_seguimientos_cartera_prejuridico_estado', tabla, ['prejuridico_estado'])

def downgrade():
    tabla = 'siigo_seguimientos_cartera'
    op.drop_index('ix_siigo_seguimientos_cartera_prejuridico_estado', table_name=tabla)
    for nombre in ('prejuridico_referencia', 'prejuridico_destinatario', 'prejuridico_enviado_at', 'prejuridico_enviado_por', 'prejuridico_aprobado_at', 'prejuridico_aprobado_por', 'prejuridico_motivo', 'prejuridico_estado'):
        op.drop_column(tabla, nombre)
