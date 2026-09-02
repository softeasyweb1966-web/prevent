"""Crea tablas de recaudos comerciales (comprobantes de pago) y su puente con atenciones.

Un recaudo (comprobante) puede cubrir varias atenciones (agrupado dinamico) y
la comision se calcula sobre el valor del comprobante x % recaudo del vendedor.

Revision ID: 20260902_037
Revises: 20260902_036
Create Date: 2026-09-02 23:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260902_037'
down_revision = '20260902_036'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())

    if 'comercial_recaudos' not in existing:
        op.create_table(
            'comercial_recaudos',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('cliente_id', sa.Integer(), sa.ForeignKey('clientes_comerciales.id'), nullable=False, index=True),
            sa.Column('vendedor_id', sa.Integer(), sa.ForeignKey('vendedores.id'), nullable=False, index=True),
            sa.Column('fecha_pago', sa.DateTime(), nullable=False, index=True),
            sa.Column('valor_comprobante', sa.Numeric(15, 2), nullable=False, server_default='0'),
            sa.Column('medio_pago', sa.String(length=20), nullable=False, server_default='TRANSFERENCIA', index=True),
            sa.Column('canal_transferencia', sa.String(length=20), index=True),
            sa.Column('porcentaje_aplicado', sa.Numeric(5, 2), nullable=False, server_default='0'),
            sa.Column('comision_calculada', sa.Numeric(15, 2), nullable=False, server_default='0'),
            sa.Column('nombre_comprobante', sa.String(length=255)),
            sa.Column('ruta_comprobante', sa.String(length=500)),
            sa.Column('mime_type', sa.String(length=120)),
            sa.Column('tamano_bytes', sa.Integer()),
            sa.Column('estado', sa.String(length=20), nullable=False, server_default='REGISTRADO', index=True),
            sa.Column('observaciones', sa.Text()),
            sa.Column('usuario_id', sa.Integer(), sa.ForeignKey('usuarios.id'), index=True),
            sa.Column('created_at', sa.DateTime()),
            sa.Column('updated_at', sa.DateTime()),
        )

    if 'comercial_recaudo_atenciones' not in existing:
        op.create_table(
            'comercial_recaudo_atenciones',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('recaudo_id', sa.Integer(), sa.ForeignKey('comercial_recaudos.id'), nullable=False, index=True),
            sa.Column('atencion_id', sa.Integer(), sa.ForeignKey('clientes_atenciones.id'), nullable=False, index=True),
            sa.Column('valor_aplicado', sa.Numeric(15, 2), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime()),
            sa.UniqueConstraint('recaudo_id', 'atencion_id', name='uq_recaudo_atencion'),
        )


def downgrade():
    op.drop_table('comercial_recaudo_atenciones')
    op.drop_table('comercial_recaudos')
