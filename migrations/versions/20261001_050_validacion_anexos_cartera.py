"""Validacion de anexos de cartera."""
from alembic import op
import sqlalchemy as sa

revision = '20261001_050'
down_revision = '20260921_049'
branch_labels = None
depends_on = None


def _agregar_validacion(tabla):
    op.add_column(tabla, sa.Column('estado_validacion', sa.String(length=25), nullable=False, server_default='PENDIENTE'))
    op.add_column(tabla, sa.Column('validado_por_id', sa.Integer(), nullable=True))
    op.add_column(tabla, sa.Column('validado_por_nombre', sa.String(length=200), nullable=True))
    op.add_column(tabla, sa.Column('validado_at', sa.DateTime(), nullable=True))
    op.create_index(op.f(f'ix_{tabla}_estado_validacion'), tabla, ['estado_validacion'], unique=False)
    op.create_index(op.f(f'ix_{tabla}_validado_por_id'), tabla, ['validado_por_id'], unique=False)
    op.create_foreign_key(f'fk_{tabla}_validado_por_id_usuarios', tabla, 'usuarios', ['validado_por_id'], ['id'])
    op.alter_column(tabla, 'estado_validacion', server_default=None)


def _quitar_validacion(tabla):
    op.drop_constraint(f'fk_{tabla}_validado_por_id_usuarios', tabla, type_='foreignkey')
    op.drop_index(op.f(f'ix_{tabla}_validado_por_id'), table_name=tabla)
    op.drop_index(op.f(f'ix_{tabla}_estado_validacion'), table_name=tabla)
    op.drop_column(tabla, 'validado_at')
    op.drop_column(tabla, 'validado_por_nombre')
    op.drop_column(tabla, 'validado_por_id')
    op.drop_column(tabla, 'estado_validacion')


def upgrade():
    _agregar_validacion('siigo_comprobantes_pago')
    _agregar_validacion('siigo_comprobantes_pago_recibidos')


def downgrade():
    _quitar_validacion('siigo_comprobantes_pago_recibidos')
    _quitar_validacion('siigo_comprobantes_pago')
