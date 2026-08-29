"""crea atenciones cliente y relacion con documentos comerciales

Revision ID: 20260427_013
Revises: 20260427_012
Create Date: 2026-04-27 11:05:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260427_013'
down_revision = '20260427_012'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'clientes_atenciones' not in inspector.get_table_names():
        op.create_table(
            'clientes_atenciones',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('nro_atencion', sa.String(length=50), nullable=True),
            sa.Column('cliente_id', sa.Integer(), nullable=False),
            sa.Column('vendedor_id', sa.Integer(), nullable=False),
            sa.Column('fecha_atencion', sa.DateTime(), nullable=False),
            sa.Column('paciente_documento', sa.String(length=50), nullable=False),
            sa.Column('paciente_nombre', sa.String(length=200), nullable=False),
            sa.Column('valor_total', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
            sa.Column('saldo_pendiente', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
            sa.Column('estado_cobro', sa.String(length=20), nullable=False, server_default='PENDIENTE'),
            sa.Column('observaciones', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['cliente_id'], ['clientes_comerciales.id']),
            sa.ForeignKeyConstraint(['vendedor_id'], ['vendedores.id']),
            sa.PrimaryKeyConstraint('id')
        )

    inspector = sa.inspect(bind)
    if 'clientes_atenciones_detalle' not in inspector.get_table_names():
        op.create_table(
            'clientes_atenciones_detalle',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('atencion_id', sa.Integer(), nullable=False),
            sa.Column('catalogo_item_id', sa.Integer(), nullable=False),
            sa.Column('tipo_item', sa.String(length=20), nullable=False),
            sa.Column('nombre_item', sa.String(length=200), nullable=False),
            sa.Column('valor_item', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['atencion_id'], ['clientes_atenciones.id']),
            sa.ForeignKeyConstraint(['catalogo_item_id'], ['comercial_catalogo_items.id']),
            sa.PrimaryKeyConstraint('id')
        )

    existing_columns = {column['name'] for column in inspector.get_columns('clientes_seguimiento_documentos')}
    if 'atencion_id' not in existing_columns:
        with op.batch_alter_table('clientes_seguimiento_documentos') as batch_op:
            batch_op.add_column(sa.Column('atencion_id', sa.Integer(), nullable=True))

    inspector = sa.inspect(bind)
    existing_foreign_keys = {
        foreign_key.get('name')
        for foreign_key in inspector.get_foreign_keys('clientes_seguimiento_documentos')
    }
    if 'fk_clientes_seguimiento_documentos_atencion_id' not in existing_foreign_keys:
        with op.batch_alter_table('clientes_seguimiento_documentos') as batch_op:
            batch_op.create_foreign_key(
                'fk_clientes_seguimiento_documentos_atencion_id',
                'clientes_atenciones',
                ['atencion_id'],
                ['id']
            )

    inspector = sa.inspect(bind)
    table_indexes = {
        'clientes_atenciones': [
            (op.f('ix_clientes_atenciones_nro_atencion'), ['nro_atencion'], True),
            (op.f('ix_clientes_atenciones_cliente_id'), ['cliente_id'], False),
            (op.f('ix_clientes_atenciones_vendedor_id'), ['vendedor_id'], False),
            (op.f('ix_clientes_atenciones_fecha_atencion'), ['fecha_atencion'], False),
            (op.f('ix_clientes_atenciones_paciente_documento'), ['paciente_documento'], False),
            (op.f('ix_clientes_atenciones_paciente_nombre'), ['paciente_nombre'], False),
            (op.f('ix_clientes_atenciones_estado_cobro'), ['estado_cobro'], False),
        ],
        'clientes_atenciones_detalle': [
            (op.f('ix_clientes_atenciones_detalle_atencion_id'), ['atencion_id'], False),
            (op.f('ix_clientes_atenciones_detalle_catalogo_item_id'), ['catalogo_item_id'], False),
            (op.f('ix_clientes_atenciones_detalle_tipo_item'), ['tipo_item'], False),
        ],
        'clientes_seguimiento_documentos': [
            (op.f('ix_clientes_seguimiento_documentos_atencion_id'), ['atencion_id'], True),
        ],
    }
    for table_name, specs in table_indexes.items():
        existing_indexes = {index['name'] for index in inspector.get_indexes(table_name)}
        for index_name, columns, unique in specs:
            if index_name not in existing_indexes:
                op.create_index(index_name, table_name, columns, unique=unique)


def downgrade():
    op.drop_index(op.f('ix_clientes_seguimiento_documentos_atencion_id'), table_name='clientes_seguimiento_documentos')
    with op.batch_alter_table('clientes_seguimiento_documentos') as batch_op:
        batch_op.drop_constraint('fk_clientes_seguimiento_documentos_atencion_id', type_='foreignkey')
        batch_op.drop_column('atencion_id')

    op.drop_index(op.f('ix_clientes_atenciones_detalle_tipo_item'), table_name='clientes_atenciones_detalle')
    op.drop_index(op.f('ix_clientes_atenciones_detalle_catalogo_item_id'), table_name='clientes_atenciones_detalle')
    op.drop_index(op.f('ix_clientes_atenciones_detalle_atencion_id'), table_name='clientes_atenciones_detalle')
    op.drop_table('clientes_atenciones_detalle')

    op.drop_index(op.f('ix_clientes_atenciones_estado_cobro'), table_name='clientes_atenciones')
    op.drop_index(op.f('ix_clientes_atenciones_paciente_nombre'), table_name='clientes_atenciones')
    op.drop_index(op.f('ix_clientes_atenciones_paciente_documento'), table_name='clientes_atenciones')
    op.drop_index(op.f('ix_clientes_atenciones_fecha_atencion'), table_name='clientes_atenciones')
    op.drop_index(op.f('ix_clientes_atenciones_vendedor_id'), table_name='clientes_atenciones')
    op.drop_index(op.f('ix_clientes_atenciones_cliente_id'), table_name='clientes_atenciones')
    op.drop_index(op.f('ix_clientes_atenciones_nro_atencion'), table_name='clientes_atenciones')
    op.drop_table('clientes_atenciones')
