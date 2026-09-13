"""Registrar cumplimiento de compromisos de cartera."""
from alembic import op
import sqlalchemy as sa

revision = '20260913_042'
down_revision = '20260912_041'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('siigo_seguimientos_cartera', sa.Column('compromiso_cumplido_at', sa.DateTime()))
    op.add_column('siigo_seguimientos_cartera', sa.Column('compromiso_cumplido_por', sa.String(200)))


def downgrade():
    op.drop_column('siigo_seguimientos_cartera', 'compromiso_cumplido_por')
    op.drop_column('siigo_seguimientos_cartera', 'compromiso_cumplido_at')
