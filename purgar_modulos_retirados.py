"""Purga controlada de los modulos retirados (nomina, servicios, bancos,
impuestos, chat, sabor artesanal) y sus permisos de menu.

Este script se ejecuta de forma MANUAL y explicita (no en el deploy). Borra
tablas de forma IRREVERSIBLE, por lo que exige respaldo previo y una doble
confirmacion.

Uso:
    python purgar_modulos_retirados.py --database-url "postgresql://..." --confirm SI

Recomendado: haber corrido antes backup_postgres_logical.py sobre la misma URL.
"""

import argparse
import os
import sys

import psycopg2


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


def normalize_url(url):
    return url.strip().replace('postgresql+psycopg2://', 'postgresql://', 1)


def main():
    parser = argparse.ArgumentParser(description='Purga manual de modulos retirados de PREVENT.')
    parser.add_argument('--database-url', default=os.environ.get('DATABASE_URL', ''))
    parser.add_argument('--confirm', default='', help='Debe ser "SI" para ejecutar el borrado.')
    args = parser.parse_args()

    if not args.database_url:
        print('ERROR: falta --database-url (o DATABASE_URL).')
        sys.exit(1)
    if args.confirm != 'SI':
        print('ABORTADO: para ejecutar el borrado real debes pasar --confirm SI')
        sys.exit(1)

    url = normalize_url(args.database_url)
    conn = psycopg2.connect(url)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        # Que tablas existen realmente
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
        existing = {row[0] for row in cur.fetchall()}

        purge_sql = ', '.join("'%s'" % n for n in RETIRED_PERMISSION_NAMES)
        for rel in ('role_permiso', 'usuario_permiso'):
            if rel in existing:
                cur.execute(
                    "DELETE FROM %s WHERE permiso_id IN "
                    "(SELECT id FROM permisos WHERE nombre IN (%s))" % (rel, purge_sql)
                )
                print('permisos-link %s: %s filas' % (rel, cur.rowcount))
        if 'permisos' in existing:
            cur.execute("DELETE FROM permisos WHERE nombre IN (%s)" % purge_sql)
            print('permisos: %s filas' % cur.rowcount)

        for table in RETIRED_TABLES:
            if table in existing:
                cur.execute('DROP TABLE IF EXISTS "%s" CASCADE' % table)
                print('DROP %s' % table)
            else:
                print('skip %s (no existe)' % table)

        conn.commit()
        print('\nPURGA COMPLETADA OK.')
    except Exception as exc:
        conn.rollback()
        print('ERROR, se revirtio todo:', exc)
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    main()
