"""Agrega rechazo y contabilizacion al flujo de anexos de cartera."""
from alembic import op
import sqlalchemy as sa

revision = '20261019_054'
down_revision = '20261018_053'
branch_labels = None
depends_on = None

def upgrade():
    tabla = 'siigo_comprobantes_pago'
    op.add_column(tabla, sa.Column('motivo_rechazo', sa.Text(), nullable=True))
    op.add_column(tabla, sa.Column('contabilizado_por_id', sa.Integer(), nullable=True))
    op.add_column(tabla, sa.Column('contabilizado_por_nombre', sa.String(length=200), nullable=True))
    op.add_column(tabla, sa.Column('contabilizado_at', sa.DateTime(), nullable=True))
    op.add_column(tabla, sa.Column('numero_recibo_caja', sa.String(length=100), nullable=True))
    op.create_index('ix_siigo_comprobantes_pago_contabilizado_por_id', tabla, ['contabilizado_por_id'])
    op.create_foreign_key('fk_comprobante_pago_contabilizado_por', tabla, 'usuarios', ['contabilizado_por_id'], ['id'])

def downgrade():
    tabla = 'siigo_comprobantes_pago'
    op.drop_constraint('fk_comprobante_pago_contabilizado_por', tabla, type_='foreignkey')
    op.drop_index('ix_siigo_comprobantes_pago_contabilizado_por_id', table_name=tabla)
    for columna in ('numero_recibo_caja', 'contabilizado_at', 'contabilizado_por_nombre', 'contabilizado_por_id', 'motivo_rechazo'):
        op.drop_column(tabla, columna)
