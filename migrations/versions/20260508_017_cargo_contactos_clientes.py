"""agrega cargos a contactos de clientes comerciales

Revision ID: 20260508_017
Revises: 20260508_016
Create Date: 2026-05-08 11:20:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260508_017'
down_revision = '20260508_016'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('clientes_comerciales', schema=None) as batch_op:
        batch_op.add_column(sa.Column('cargo_contacto_principal', sa.String(length=150), nullable=True))
        batch_op.add_column(sa.Column('cargo_contacto_facturacion', sa.String(length=150), nullable=True))


def downgrade():
    with op.batch_alter_table('clientes_comerciales', schema=None) as batch_op:
        batch_op.drop_column('cargo_contacto_facturacion')
        batch_op.drop_column('cargo_contacto_principal')
