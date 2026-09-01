"""agrega cargo a vendedores"""
from alembic import op
import sqlalchemy as sa
revision = '20260901_033'
down_revision = '20260831_032'
branch_labels = None
depends_on = None
def upgrade():
    op.add_column('vendedores', sa.Column('cargo', sa.String(length=150), nullable=True))
    op.create_index('ix_vendedores_cargo', 'vendedores', ['cargo'], unique=False)
def downgrade():
    op.drop_index('ix_vendedores_cargo', table_name='vendedores')
    op.drop_column('vendedores', 'cargo')
