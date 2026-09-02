"""remove retired modules and their data

Revision ID: 20260902_036
Revises: 20260901_035
Create Date: 2026-09-02 12:00:00
"""

import os

from alembic import op
import sqlalchemy as sa


revision = '20260902_036'
down_revision = '20260901_035'
branch_labels = None
depends_on = None


RETIRED_TABLES = [
    'chat_mensajes', 'chat_participantes', 'chat_conversaciones',
    'novedades_aplicadas', 'pagos', 'liquidos_quincena', 'novedades',
    'quincenas', 'tipos_novedad', 'conceptos_automaticos',
    'empleado_movimientos_laborales', 'empleado_asignaciones_laborales',
    'cargos', 'areas', 'empleados', 'parametros_descuentos',
    'servicios_novedades', 'servicios_pagos', 'servicios_periodos', 'servicios',
    'prestamos_novedades', 'prestamos_pagos', 'prestamos_empresa',
    'bancos_periodos',
    'sabor_artesanal_pedidos', 'sabor_artesanal_menu_dias',
    'sabor_artesanal_menu_componentes', 'sabor_artesanal_menus',
    'sabor_artesanal_menu_categorias', 'sabor_artesanal_tabla_items',
]

RETIRED_PERMISSION_NAMES = (
    'menu_nomina', 'menu_servicios', 'menu_bancos', 'menu_impuestos',
    'menu_recepcion', 'menu_chat', 'menu_sabor_artesanal',
)
RETIRED_PERMISSION_SQL = ', '.join(f"'{name}'" for name in RETIRED_PERMISSION_NAMES)


def upgrade():
    # Esta migracion elimina datos de forma IRREVERSIBLE. Por seguridad NO se
    # ejecuta durante el deploy automatico: solo corre si se confirma de forma
    # explicita con la variable de entorno PREVENT_CONFIRM_RETIREMENT_PURGE=yes.
    # Si no se confirma, la migracion se marca como aplicada pero NO borra nada,
    # para que el despliegue no falle. El purgado se ejecuta luego de forma
    # manual y controlada (con respaldo previo).
    if os.environ.get('PREVENT_CONFIRM_RETIREMENT_PURGE') != 'yes':
        print(
            '[migracion 036] Purga de modulos retirados OMITIDA: '
            'define PREVENT_CONFIRM_RETIREMENT_PURGE=yes para ejecutarla. '
            'La migracion queda marcada como aplicada sin borrar datos.'
        )
        return

    bind = op.get_bind()
    existing_tables = set(sa.inspect(bind).get_table_names())

    # Remove permission links before deleting the retired permission records.
    for relation_table in ('role_permiso', 'usuario_permiso'):
        if relation_table in existing_tables:
            op.execute(
                f'DELETE FROM {relation_table} WHERE permiso_id IN '
                f'(SELECT id FROM permisos WHERE nombre IN ({RETIRED_PERMISSION_SQL}))'
            )
    if 'permisos' in existing_tables:
        op.execute(f'DELETE FROM permisos WHERE nombre IN ({RETIRED_PERMISSION_SQL})')

    for table_name in RETIRED_TABLES:
        if table_name in existing_tables:
            op.drop_table(table_name)


def downgrade():
    raise RuntimeError(
        'Esta migracion elimina datos de forma irreversible. Restaura el respaldo previo para volver atras.'
    )
