"""asegura fk de atencion en documentos de seguimiento

Revision ID: 20260427_014
Revises: 20260427_013
Create Date: 2026-04-27 13:05:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260427_014'
down_revision = '20260427_013'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing_columns = {column['name'] for column in inspector.get_columns('clientes_seguimiento_documentos')}
    if 'atencion_id' not in existing_columns:
        return

    existing_foreign_keys = {
        foreign_key.get('name')
        for foreign_key in inspector.get_foreign_keys('clientes_seguimiento_documentos')
    }
    if 'fk_clientes_seguimiento_documentos_atencion_id' in existing_foreign_keys:
        return

    with op.batch_alter_table('clientes_seguimiento_documentos', recreate='always') as batch_op:
        batch_op.create_foreign_key(
            'fk_clientes_seguimiento_documentos_atencion_id',
            'clientes_atenciones',
            ['atencion_id'],
            ['id']
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_foreign_keys = {
        foreign_key.get('name')
        for foreign_key in inspector.get_foreign_keys('clientes_seguimiento_documentos')
    }
    if 'fk_clientes_seguimiento_documentos_atencion_id' not in existing_foreign_keys:
        return

    with op.batch_alter_table('clientes_seguimiento_documentos', recreate='always') as batch_op:
        batch_op.drop_constraint('fk_clientes_seguimiento_documentos_atencion_id', type_='foreignkey')
