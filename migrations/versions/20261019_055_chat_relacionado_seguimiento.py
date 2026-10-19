"""Relaciona el chat interno con un seguimiento de cartera."""
from alembic import op
import sqlalchemy as sa

revision = '20261019_055'
down_revision = '20261019_054'
branch_labels = None
depends_on = None

def upgrade():
    tabla = 'chat_cartera_hilos'
    op.add_column(tabla, sa.Column('seguimiento_id', sa.Integer(), nullable=True))
    op.create_index('ix_chat_cartera_hilos_seguimiento_id', tabla, ['seguimiento_id'])
    op.create_foreign_key('fk_chat_cartera_hilo_seguimiento', tabla, 'siigo_seguimientos_cartera', ['seguimiento_id'], ['id'])

def downgrade():
    tabla = 'chat_cartera_hilos'
    op.drop_constraint('fk_chat_cartera_hilo_seguimiento', tabla, type_='foreignkey')
    op.drop_index('ix_chat_cartera_hilos_seguimiento_id', table_name=tabla)
    op.drop_column(tabla, 'seguimiento_id')
