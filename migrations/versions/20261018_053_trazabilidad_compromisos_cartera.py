"""Agrega trazabilidad y resultado de pagos a cartera."""
from alembic import op
import sqlalchemy as sa

revision = '20261018_053'
down_revision = '20261015_052'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('siigo_seguimientos_cartera', sa.Column('seguimiento_anterior_id', sa.Integer(), nullable=True))
    op.create_index('ix_siigo_seguimientos_cartera_seguimiento_anterior_id', 'siigo_seguimientos_cartera', ['seguimiento_anterior_id'])
    op.create_foreign_key('fk_seguimiento_cartera_anterior', 'siigo_seguimientos_cartera', 'siigo_seguimientos_cartera', ['seguimiento_anterior_id'], ['id'])
    op.add_column('siigo_seguimientos_cartera', sa.Column('valor_pagado', sa.Numeric(18, 2), nullable=True))

def downgrade():
    op.drop_constraint('fk_seguimiento_cartera_anterior', 'siigo_seguimientos_cartera', type_='foreignkey')
    op.drop_index('ix_siigo_seguimientos_cartera_seguimiento_anterior_id', table_name='siigo_seguimientos_cartera')
    op.drop_column('siigo_seguimientos_cartera', 'seguimiento_anterior_id')
    op.drop_column('siigo_seguimientos_cartera', 'valor_pagado')
