"""crea tablas cargue_atenciones_dia y atenciones_dia_detalle

Revision ID: 20260517_020
Revises: 20260516_019
Create Date: 2026-05-17 10:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260517_020'
down_revision = '20260516_019'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'cargue_atenciones_dia',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nombre_archivo', sa.String(length=255), nullable=False),
        sa.Column('total_filas', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('filas_importadas', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('filas_duplicadas', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('filas_error', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('usuario_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['usuario_id'], ['usuarios.id']),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'atenciones_dia_detalle',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('cargue_id', sa.Integer(), nullable=False),
        sa.Column('nro_orden', sa.String(length=50), nullable=True),
        sa.Column('nro_factura', sa.String(length=100), nullable=True),
        sa.Column('fecha_factura', sa.DateTime(), nullable=True),
        sa.Column('precio', sa.Numeric(15, 2), nullable=True),
        sa.Column('forma_pago', sa.String(length=30), nullable=True),
        sa.Column('servicio', sa.String(length=300), nullable=True),
        sa.Column('nro_identificacion', sa.String(length=60), nullable=True),
        sa.Column('nombre_paciente', sa.String(length=300), nullable=True),
        sa.Column('acuerdo_comercial', sa.String(length=300), nullable=True),
        sa.Column('empresa_mision', sa.String(length=300), nullable=True),
        sa.Column('sede', sa.String(length=100), nullable=True),
        sa.Column('nombre_vendedor', sa.String(length=200), nullable=True),
        sa.Column('fecha_creacion_orden', sa.DateTime(), nullable=True),
        sa.Column('usuario_creacion', sa.String(length=100), nullable=True),
        sa.Column('estado_orden', sa.String(length=50), nullable=True),
        sa.Column('fecha_anulacion', sa.DateTime(), nullable=True),
        sa.Column('archivo_origen', sa.String(length=300), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['cargue_id'], ['cargue_atenciones_dia.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_atenciones_dia_detalle_cargue_id', 'atenciones_dia_detalle', ['cargue_id'])
    op.create_index('ix_atenciones_dia_detalle_nro_orden', 'atenciones_dia_detalle', ['nro_orden'])
    op.create_index('ix_atenciones_dia_detalle_acuerdo_comercial', 'atenciones_dia_detalle', ['acuerdo_comercial'])
    op.create_index('ix_atenciones_dia_detalle_nombre_vendedor', 'atenciones_dia_detalle', ['nombre_vendedor'])
    op.create_index('ix_atenciones_dia_detalle_estado_orden', 'atenciones_dia_detalle', ['estado_orden'])
    op.create_index('ix_atencion_dia_orden_servicio', 'atenciones_dia_detalle', ['nro_orden', 'servicio', 'nro_identificacion'])


def downgrade():
    op.drop_index('ix_atencion_dia_orden_servicio', table_name='atenciones_dia_detalle')
    op.drop_index('ix_atenciones_dia_detalle_estado_orden', table_name='atenciones_dia_detalle')
    op.drop_index('ix_atenciones_dia_detalle_nombre_vendedor', table_name='atenciones_dia_detalle')
    op.drop_index('ix_atenciones_dia_detalle_acuerdo_comercial', table_name='atenciones_dia_detalle')
    op.drop_index('ix_atenciones_dia_detalle_nro_orden', table_name='atenciones_dia_detalle')
    op.drop_index('ix_atenciones_dia_detalle_cargue_id', table_name='atenciones_dia_detalle')
    op.drop_table('atenciones_dia_detalle')
    op.drop_table('cargue_atenciones_dia')
