"""Estado de gestion en seguimientos de cartera."""
from alembic import op
import sqlalchemy as sa

revision = '20260920_046'
down_revision = '20260913_045'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('siigo_seguimientos_cartera', sa.Column('estado_gestion', sa.String(length=30), nullable=False, server_default='EN_PROCESO'))


def downgrade():
    op.drop_column('siigo_seguimientos_cartera', 'estado_gestion')
