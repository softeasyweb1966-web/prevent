"""crea documentos base de seguimiento comercial por cliente

Revision ID: 20260426_010
Revises: 20260426_009
Create Date: 2026-04-26 23:10:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260426_010'
down_revision = '20260426_009'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'clientes_seguimiento_documentos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('cliente_id', sa.Integer(), nullable=False),
        sa.Column('vendedor_id', sa.Integer(), nullable=False),
        sa.Column('tipo_documento', sa.String(length=30), nullable=False),
        sa.Column('numero_documento', sa.String(length=80), nullable=True),
        sa.Column('fecha_documento', sa.DateTime(), nullable=False),
        sa.Column('fecha_vencimiento', sa.DateTime(), nullable=True),
        sa.Column('valor_documento', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
        sa.Column('saldo_actual', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
        sa.Column('genera_cartera', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('estado_documento', sa.String(length=20), nullable=False, server_default='PENDIENTE'),
        sa.Column('observaciones', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['cliente_id'], ['clientes_comerciales.id']),
        sa.ForeignKeyConstraint(['vendedor_id'], ['vendedores.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_clientes_seguimiento_documentos_cliente_id'), 'clientes_seguimiento_documentos', ['cliente_id'], unique=False)
    op.create_index(op.f('ix_clientes_seguimiento_documentos_vendedor_id'), 'clientes_seguimiento_documentos', ['vendedor_id'], unique=False)
    op.create_index(op.f('ix_clientes_seguimiento_documentos_tipo_documento'), 'clientes_seguimiento_documentos', ['tipo_documento'], unique=False)
    op.create_index(op.f('ix_clientes_seguimiento_documentos_numero_documento'), 'clientes_seguimiento_documentos', ['numero_documento'], unique=False)
    op.create_index(op.f('ix_clientes_seguimiento_documentos_fecha_documento'), 'clientes_seguimiento_documentos', ['fecha_documento'], unique=False)
    op.create_index(op.f('ix_clientes_seguimiento_documentos_fecha_vencimiento'), 'clientes_seguimiento_documentos', ['fecha_vencimiento'], unique=False)
    op.create_index(op.f('ix_clientes_seguimiento_documentos_estado_documento'), 'clientes_seguimiento_documentos', ['estado_documento'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_clientes_seguimiento_documentos_estado_documento'), table_name='clientes_seguimiento_documentos')
    op.drop_index(op.f('ix_clientes_seguimiento_documentos_fecha_vencimiento'), table_name='clientes_seguimiento_documentos')
    op.drop_index(op.f('ix_clientes_seguimiento_documentos_fecha_documento'), table_name='clientes_seguimiento_documentos')
    op.drop_index(op.f('ix_clientes_seguimiento_documentos_numero_documento'), table_name='clientes_seguimiento_documentos')
    op.drop_index(op.f('ix_clientes_seguimiento_documentos_tipo_documento'), table_name='clientes_seguimiento_documentos')
    op.drop_index(op.f('ix_clientes_seguimiento_documentos_vendedor_id'), table_name='clientes_seguimiento_documentos')
    op.drop_index(op.f('ix_clientes_seguimiento_documentos_cliente_id'), table_name='clientes_seguimiento_documentos')
    op.drop_table('clientes_seguimiento_documentos')
