"""Permite descripciones largas en movimientos SIIGO."""
from alembic import op
import sqlalchemy as sa

revision = '20261006_051'
down_revision = '20261001_050'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        'siigo_movimientos',
        'descripcion',
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade():
    op.alter_column(
        'siigo_movimientos',
        'descripcion',
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=True,
    )
