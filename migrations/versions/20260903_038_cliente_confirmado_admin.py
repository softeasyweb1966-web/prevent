"""Agrega columnas de confirmacion administrativa a clientes_comerciales.

Estas columnas existen en el modelo ClienteComercial pero faltaban en la BD de
produccion (quedaron fuera durante el reordenamiento/purga de migraciones), lo
que causaba UndefinedColumn al crear un cliente. Migracion aditiva e idempotente:
solo agrega las columnas que falten.

Revision ID: 20260903_038
Revises: 20260902_037
Create Date: 2026-09-03 00:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260903_038'
down_revision = '20260902_037'
branch_labels = None
depends_on = None


TABLA = 'clientes_comerciales'


def _columnas_existentes(bind):
    return {c['name'] for c in sa.inspect(bind).get_columns(TABLA)}


def upgrade():
    bind = op.get_bind()
    cols = _columnas_existentes(bind)

    if 'confirmado_administrativo' not in cols:
        op.add_column(
            TABLA,
            sa.Column('confirmado_administrativo', sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        # Quita el server_default para que el default quede a nivel de aplicacion.
        op.alter_column(TABLA, 'confirmado_administrativo', server_default=None)

    if 'confirmado_administrativo_at' not in cols:
        op.add_column(
            TABLA,
            sa.Column('confirmado_administrativo_at', sa.DateTime(), nullable=True),
        )

    if 'confirmado_administrativo_por_id' not in cols:
        op.add_column(
            TABLA,
            sa.Column('confirmado_administrativo_por_id', sa.Integer(), nullable=True),
        )
        op.create_index(
            'ix_clientes_comerciales_confirmado_administrativo_por_id',
            TABLA,
            ['confirmado_administrativo_por_id'],
        )
        op.create_foreign_key(
            'fk_clientes_comerciales_confirmado_admin_usuario',
            TABLA,
            'usuarios',
            ['confirmado_administrativo_por_id'],
            ['id'],
        )


def downgrade():
    bind = op.get_bind()
    cols = _columnas_existentes(bind)

    if 'confirmado_administrativo_por_id' in cols:
        try:
            op.drop_constraint('fk_clientes_comerciales_confirmado_admin_usuario', TABLA, type_='foreignkey')
        except Exception:
            pass
        try:
            op.drop_index('ix_clientes_comerciales_confirmado_administrativo_por_id', table_name=TABLA)
        except Exception:
            pass
        op.drop_column(TABLA, 'confirmado_administrativo_por_id')

    if 'confirmado_administrativo_at' in cols:
        op.drop_column(TABLA, 'confirmado_administrativo_at')

    if 'confirmado_administrativo' in cols:
        op.drop_column(TABLA, 'confirmado_administrativo')
