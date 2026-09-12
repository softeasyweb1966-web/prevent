"""Historial de cambios del vendedor responsable del cliente."""
from alembic import op
import sqlalchemy as sa

revision = '20260912_041'
down_revision = '20260911_040'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('clientes_vendedor_historial',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('cliente_id', sa.Integer(), sa.ForeignKey('clientes_comerciales.id'), nullable=False),
        sa.Column('vendedor_anterior_id', sa.Integer(), sa.ForeignKey('vendedores.id')),
        sa.Column('vendedor_nuevo_id', sa.Integer(), sa.ForeignKey('vendedores.id')),
        sa.Column('usuario_id', sa.Integer(), sa.ForeignKey('usuarios.id')),
        sa.Column('fecha', sa.DateTime(), nullable=False),
        sa.Column('origen', sa.String(50), nullable=False),
    )
    op.create_index('ix_clientes_vendedor_historial_cliente_id', 'clientes_vendedor_historial', ['cliente_id'])


def downgrade():
    op.drop_table('clientes_vendedor_historial')
