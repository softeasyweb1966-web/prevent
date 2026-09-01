"""crea tablas de liquidacion de comisiones por vendedor

Revision ID: 20260901_035
Revises: 20260901_034
Create Date: 2026-09-01 11:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260901_035'
down_revision = '20260901_034'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    cabecera = 'comisiones_liquidaciones'
    if cabecera not in inspector.get_table_names():
        op.create_table(
            cabecera,
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('vendedor_id', sa.Integer(), nullable=False),
            sa.Column('mes', sa.Integer(), nullable=False),
            sa.Column('anio', sa.Integer(), nullable=False),
            sa.Column('estado', sa.String(length=20), nullable=False, server_default='BORRADOR'),
            sa.Column('porcentaje_recaudo', sa.Numeric(precision=5, scale=2), nullable=False, server_default='0'),
            sa.Column('total_recaudo_con_soporte', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
            sa.Column('total_recaudo_sin_soporte', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
            sa.Column('total_comision_aprobada', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
            sa.Column('total_comision_pendiente', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
            sa.Column('total_comision_rechazada', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
            sa.Column('usuario_genera_id', sa.Integer(), nullable=True),
            sa.Column('usuario_cierra_id', sa.Integer(), nullable=True),
            sa.Column('fecha_cierre', sa.DateTime(), nullable=True),
            sa.Column('observaciones', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['vendedor_id'], ['vendedores.id']),
            sa.ForeignKeyConstraint(['usuario_genera_id'], ['usuarios.id']),
            sa.ForeignKeyConstraint(['usuario_cierra_id'], ['usuarios.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('vendedor_id', 'mes', 'anio', name='uq_comision_vendedor_periodo'),
        )

    inspector = sa.inspect(bind)
    existing_indexes = {index['name'] for index in inspector.get_indexes(cabecera)}
    for index_name, columns in [
        (op.f('ix_comisiones_liquidaciones_vendedor_id'), ['vendedor_id']),
        (op.f('ix_comisiones_liquidaciones_mes'), ['mes']),
        (op.f('ix_comisiones_liquidaciones_anio'), ['anio']),
        (op.f('ix_comisiones_liquidaciones_estado'), ['estado']),
        (op.f('ix_comisiones_liquidaciones_usuario_genera_id'), ['usuario_genera_id']),
        (op.f('ix_comisiones_liquidaciones_usuario_cierra_id'), ['usuario_cierra_id']),
    ]:
        if index_name not in existing_indexes:
            op.create_index(index_name, cabecera, columns, unique=False)

    detalle = 'comisiones_liquidaciones_detalle'
    if detalle not in inspector.get_table_names():
        op.create_table(
            detalle,
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('liquidacion_id', sa.Integer(), nullable=False),
            sa.Column('pago_id', sa.Integer(), nullable=False),
            sa.Column('cliente_id', sa.Integer(), nullable=True),
            sa.Column('valor_recaudo', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
            sa.Column('porcentaje_aplicado', sa.Numeric(precision=5, scale=2), nullable=False, server_default='0'),
            sa.Column('comision', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
            sa.Column('tiene_soporte', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('estado_validacion', sa.String(length=25), nullable=False, server_default='APROBADA'),
            sa.Column('validado_por_id', sa.Integer(), nullable=True),
            sa.Column('validado_at', sa.DateTime(), nullable=True),
            sa.Column('observacion', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['liquidacion_id'], ['comisiones_liquidaciones.id']),
            sa.ForeignKeyConstraint(['pago_id'], ['clientes_seguimiento_pagos.id']),
            sa.ForeignKeyConstraint(['cliente_id'], ['clientes_comerciales.id']),
            sa.ForeignKeyConstraint(['validado_por_id'], ['usuarios.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('liquidacion_id', 'pago_id', name='uq_comision_detalle_pago'),
        )

    inspector = sa.inspect(bind)
    existing_indexes = {index['name'] for index in inspector.get_indexes(detalle)}
    for index_name, columns in [
        (op.f('ix_comisiones_liquidaciones_detalle_liquidacion_id'), ['liquidacion_id']),
        (op.f('ix_comisiones_liquidaciones_detalle_pago_id'), ['pago_id']),
        (op.f('ix_comisiones_liquidaciones_detalle_cliente_id'), ['cliente_id']),
        (op.f('ix_comisiones_liquidaciones_detalle_tiene_soporte'), ['tiene_soporte']),
        (op.f('ix_comisiones_liquidaciones_detalle_estado_validacion'), ['estado_validacion']),
        (op.f('ix_comisiones_liquidaciones_detalle_validado_por_id'), ['validado_por_id']),
    ]:
        if index_name not in existing_indexes:
            op.create_index(index_name, detalle, columns, unique=False)


def downgrade():
    op.drop_table('comisiones_liquidaciones_detalle')
    op.drop_table('comisiones_liquidaciones')
