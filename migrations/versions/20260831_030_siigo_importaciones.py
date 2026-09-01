"""Cargues SIIGO para ventas, cartera y consultas.

Revision ID: 20260831_030
Revises: 20260831_029
Create Date: 2026-08-31 12:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260831_030'
down_revision = '20260831_029'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'siigo_cargas',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tipo_archivo', sa.String(length=20), nullable=False),
        sa.Column('nombre_archivo', sa.String(length=255), nullable=False),
        sa.Column('hash_archivo', sa.String(length=64), nullable=False),
        sa.Column('registros_leidos', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('registros_importados', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('registros_omitidos', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total_debito', sa.Numeric(precision=18, scale=2), nullable=False, server_default='0'),
        sa.Column('total_credito', sa.Numeric(precision=18, scale=2), nullable=False, server_default='0'),
        sa.Column('usuario_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['usuario_id'], ['usuarios.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('hash_archivo'),
    )
    op.create_index('ix_siigo_cargas_tipo_archivo', 'siigo_cargas', ['tipo_archivo'])
    op.create_index('ix_siigo_cargas_usuario_id', 'siigo_cargas', ['usuario_id'])

    op.create_table(
        'siigo_clientes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('identificacion', sa.String(length=50), nullable=False),
        sa.Column('sucursal', sa.String(length=30), nullable=False, server_default='0'),
        sa.Column('tipo_identificacion', sa.String(length=30), nullable=True),
        sa.Column('digito_verificacion', sa.String(length=10), nullable=True),
        sa.Column('nombre', sa.String(length=255), nullable=False),
        sa.Column('direccion', sa.String(length=255), nullable=True),
        sa.Column('ciudad', sa.String(length=120), nullable=True),
        sa.Column('telefono', sa.String(length=80), nullable=True),
        sa.Column('estado', sa.String(length=30), nullable=True),
        sa.Column('carga_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['carga_id'], ['siigo_cargas.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('identificacion', 'sucursal', name='uq_siigo_cliente_identificacion_sucursal'),
    )
    op.create_index('ix_siigo_clientes_identificacion', 'siigo_clientes', ['identificacion'])
    op.create_index('ix_siigo_clientes_nombre', 'siigo_clientes', ['nombre'])
    op.create_index('ix_siigo_clientes_carga_id', 'siigo_clientes', ['carga_id'])

    op.create_table(
        'siigo_cuentas_contables',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('codigo', sa.String(length=30), nullable=False),
        sa.Column('nombre', sa.String(length=255), nullable=False),
        sa.Column('categoria', sa.String(length=120), nullable=True),
        sa.Column('clase', sa.String(length=80), nullable=True),
        sa.Column('relacion_con', sa.String(length=120), nullable=True),
        sa.Column('maneja_vencimientos', sa.String(length=80), nullable=True),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('carga_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['carga_id'], ['siigo_cargas.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('codigo'),
    )
    op.create_index('ix_siigo_cuentas_contables_codigo', 'siigo_cuentas_contables', ['codigo'])
    op.create_index('ix_siigo_cuentas_contables_carga_id', 'siigo_cuentas_contables', ['carga_id'])

    op.create_table(
        'siigo_comprobantes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tipo_documento', sa.String(length=10), nullable=False),
        sa.Column('codigo_comprobante', sa.String(length=30), nullable=False),
        sa.Column('numero_comprobante', sa.String(length=50), nullable=False),
        sa.Column('fecha_elaboracion', sa.Date(), nullable=False),
        sa.Column('total_debito', sa.Numeric(precision=18, scale=2), nullable=False, server_default='0'),
        sa.Column('total_credito', sa.Numeric(precision=18, scale=2), nullable=False, server_default='0'),
        sa.Column('carga_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['carga_id'], ['siigo_cargas.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tipo_documento', 'codigo_comprobante', 'numero_comprobante', name='uq_siigo_comprobante_origen'),
    )
    op.create_index('ix_siigo_comprobantes_tipo_documento', 'siigo_comprobantes', ['tipo_documento'])
    op.create_index('ix_siigo_comprobantes_fecha_elaboracion', 'siigo_comprobantes', ['fecha_elaboracion'])
    op.create_index('ix_siigo_comprobantes_carga_id', 'siigo_comprobantes', ['carga_id'])

    op.create_table(
        'siigo_movimientos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('comprobante_id', sa.Integer(), nullable=False),
        sa.Column('secuencia', sa.Integer(), nullable=False),
        sa.Column('codigo_contable', sa.String(length=30), nullable=False),
        sa.Column('cuenta_contable', sa.String(length=255), nullable=False),
        sa.Column('identificacion', sa.String(length=50), nullable=True),
        sa.Column('sucursal', sa.String(length=30), nullable=True),
        sa.Column('nombre_tercero', sa.String(length=255), nullable=True),
        sa.Column('descripcion', sa.String(length=255), nullable=True),
        sa.Column('detalle', sa.Text(), nullable=True),
        sa.Column('centro_costo', sa.String(length=80), nullable=True),
        sa.Column('debito', sa.Numeric(precision=18, scale=2), nullable=False, server_default='0'),
        sa.Column('credito', sa.Numeric(precision=18, scale=2), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['comprobante_id'], ['siigo_comprobantes.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('comprobante_id', 'secuencia', name='uq_siigo_movimiento_secuencia'),
    )
    op.create_index('ix_siigo_movimientos_comprobante_id', 'siigo_movimientos', ['comprobante_id'])
    op.create_index('ix_siigo_movimientos_codigo_contable', 'siigo_movimientos', ['codigo_contable'])
    op.create_index('ix_siigo_movimientos_identificacion', 'siigo_movimientos', ['identificacion'])
    op.create_index('ix_siigo_movimientos_nombre_tercero', 'siigo_movimientos', ['nombre_tercero'])


def downgrade():
    op.drop_table('siigo_movimientos')
    op.drop_table('siigo_comprobantes')
    op.drop_table('siigo_cuentas_contables')
    op.drop_table('siigo_clientes')
    op.drop_table('siigo_cargas')
