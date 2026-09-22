"""Comprobantes de pago recibidos por cartera."""
from alembic import op
import sqlalchemy as sa

revision = '20260921_049'
down_revision = '20260921_048'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'siigo_comprobantes_pago_recibidos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('identificacion', sa.String(length=50), nullable=False),
        sa.Column('cliente_nombre', sa.String(length=255), nullable=False),
        sa.Column('paciente', sa.String(length=200), nullable=True),
        sa.Column('valor', sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column('facturas', sa.JSON(), nullable=False),
        sa.Column('nombre', sa.String(length=255), nullable=False),
        sa.Column('mime_type', sa.String(length=80), nullable=False),
        sa.Column('tamano_bytes', sa.Integer(), nullable=False),
        sa.Column('contenido', sa.LargeBinary(), nullable=False),
        sa.Column('usuario_id', sa.Integer(), nullable=False),
        sa.Column('usuario_nombre', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['usuario_id'], ['usuarios.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_siigo_comprobantes_pago_recibidos_identificacion'),
                    'siigo_comprobantes_pago_recibidos', ['identificacion'], unique=False)
    op.create_index(op.f('ix_siigo_comprobantes_pago_recibidos_created_at'),
                    'siigo_comprobantes_pago_recibidos', ['created_at'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_siigo_comprobantes_pago_recibidos_created_at'), table_name='siigo_comprobantes_pago_recibidos')
    op.drop_index(op.f('ix_siigo_comprobantes_pago_recibidos_identificacion'), table_name='siigo_comprobantes_pago_recibidos')
    op.drop_table('siigo_comprobantes_pago_recibidos')
