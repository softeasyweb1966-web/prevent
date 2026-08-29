"""crea clientes comerciales y adjuntos

Revision ID: 20260421_004
Revises: 20260415_003
Create Date: 2026-04-21 17:20:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260421_004'
down_revision = '20260415_003'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'clientes_comerciales',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('vendedor_id', sa.Integer(), nullable=False),
        sa.Column('razon_social', sa.String(length=200), nullable=False),
        sa.Column('nombre_comercial', sa.String(length=200), nullable=True),
        sa.Column('nit', sa.String(length=50), nullable=True),
        sa.Column('ciudad', sa.String(length=120), nullable=True),
        sa.Column('direccion', sa.String(length=255), nullable=True),
        sa.Column('telefono_empresa', sa.String(length=50), nullable=True),
        sa.Column('email_empresa', sa.String(length=120), nullable=True),
        sa.Column('contacto_principal', sa.String(length=150), nullable=True),
        sa.Column('celular_contacto_principal', sa.String(length=50), nullable=True),
        sa.Column('email_contacto_principal', sa.String(length=120), nullable=True),
        sa.Column('contacto_facturacion', sa.String(length=150), nullable=True),
        sa.Column('celular_facturacion', sa.String(length=50), nullable=True),
        sa.Column('email_facturacion', sa.String(length=120), nullable=True),
        sa.Column('condicion_comercial', sa.String(length=20), nullable=False, server_default='EFECTIVO'),
        sa.Column('requiere_factura', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('fechas_facturacion', sa.String(length=120), nullable=True),
        sa.Column('fecha_solicitud_factura', sa.DateTime(), nullable=True),
        sa.Column('examenes_convenidos', sa.Text(), nullable=True),
        sa.Column('servicios_convenidos', sa.Text(), nullable=True),
        sa.Column('tarifas_convenidas', sa.Text(), nullable=True),
        sa.Column('documentos_legales_completos', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('documentos_legales_detalle', sa.Text(), nullable=True),
        sa.Column('pagare_firmado', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('pagare_detalle', sa.Text(), nullable=True),
        sa.Column('observaciones', sa.Text(), nullable=True),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['vendedor_id'], ['vendedores.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('nit')
    )
    op.create_index(op.f('ix_clientes_comerciales_vendedor_id'), 'clientes_comerciales', ['vendedor_id'], unique=False)
    op.create_index(op.f('ix_clientes_comerciales_razon_social'), 'clientes_comerciales', ['razon_social'], unique=False)
    op.create_index(op.f('ix_clientes_comerciales_nit'), 'clientes_comerciales', ['nit'], unique=True)

    op.create_table(
        'clientes_comerciales_adjuntos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('cliente_id', sa.Integer(), nullable=False),
        sa.Column('tipo_documento', sa.String(length=30), nullable=False),
        sa.Column('nombre_original', sa.String(length=255), nullable=False),
        sa.Column('nombre_guardado', sa.String(length=255), nullable=False),
        sa.Column('ruta_relativa', sa.String(length=500), nullable=False),
        sa.Column('mime_type', sa.String(length=120), nullable=True),
        sa.Column('tamano_bytes', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['cliente_id'], ['clientes_comerciales.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_clientes_comerciales_adjuntos_cliente_id'), 'clientes_comerciales_adjuntos', ['cliente_id'], unique=False)
    op.create_index(op.f('ix_clientes_comerciales_adjuntos_tipo_documento'), 'clientes_comerciales_adjuntos', ['tipo_documento'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_clientes_comerciales_adjuntos_tipo_documento'), table_name='clientes_comerciales_adjuntos')
    op.drop_index(op.f('ix_clientes_comerciales_adjuntos_cliente_id'), table_name='clientes_comerciales_adjuntos')
    op.drop_table('clientes_comerciales_adjuntos')

    op.drop_index(op.f('ix_clientes_comerciales_nit'), table_name='clientes_comerciales')
    op.drop_index(op.f('ix_clientes_comerciales_razon_social'), table_name='clientes_comerciales')
    op.drop_index(op.f('ix_clientes_comerciales_vendedor_id'), table_name='clientes_comerciales')
    op.drop_table('clientes_comerciales')
