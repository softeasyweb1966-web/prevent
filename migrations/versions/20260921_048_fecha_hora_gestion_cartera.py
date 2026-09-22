"""Fecha y hora real de las gestiones de cartera."""
from alembic import op
import sqlalchemy as sa

revision = '20260921_048'
down_revision = '20260920_047'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('siigo_seguimientos_cartera', sa.Column('fecha_hora_gestion', sa.DateTime(), nullable=True))
    op.execute("""
        UPDATE siigo_seguimientos_cartera
        SET fecha_hora_gestion = COALESCE(created_at, fecha_gestion)
        WHERE fecha_hora_gestion IS NULL
    """)


def downgrade():
    op.drop_column('siigo_seguimientos_cartera', 'fecha_hora_gestion')
