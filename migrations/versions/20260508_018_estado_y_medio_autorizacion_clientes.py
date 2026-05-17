"""agrega estado y medio de autorizacion a clientes comerciales

Revision ID: 20260508_018
Revises: 20260508_017
Create Date: 2026-05-08 17:05:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260508_018'
down_revision = '20260508_017'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('clientes_comerciales', schema=None) as batch_op:
        batch_op.add_column(sa.Column('medio_autorizacion', sa.String(length=30), nullable=True))
        batch_op.add_column(sa.Column('estado_cliente', sa.String(length=30), nullable=True))

    op.execute("""
        UPDATE clientes_comerciales
        SET medio_autorizacion = COALESCE(medio_autorizacion, 'WHATSAPP'),
            estado_cliente = COALESCE(
                estado_cliente,
                CASE
                    WHEN activo IS FALSE THEN 'INACTIVO'
                    ELSE 'ACTIVO'
                END
            )
    """)

    with op.batch_alter_table('clientes_comerciales', schema=None) as batch_op:
        batch_op.alter_column('medio_autorizacion', existing_type=sa.String(length=30), nullable=False)
        batch_op.alter_column('estado_cliente', existing_type=sa.String(length=30), nullable=False)


def downgrade():
    with op.batch_alter_table('clientes_comerciales', schema=None) as batch_op:
        batch_op.drop_column('estado_cliente')
        batch_op.drop_column('medio_autorizacion')
