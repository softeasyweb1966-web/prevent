import argparse
import json
import os
import sqlite3
from datetime import datetime

from sqlalchemy import MetaData, Table, inspect, text
from sqlalchemy.sql import sqltypes


DEFAULT_SQLITE_PATH = os.path.join("instance", "prevent.db")
SKIP_TABLES = {"sqlite_sequence", "alembic_version"}
REPORT_PATH = "migration_report.txt"
TARGET_SCHEMA = "public"

TABLE_ORDER = [
    "roles",
    "permisos",
    "role_permiso",
    "usuarios",
    "empleados",
    "tipos_novedad",
    "conceptos_automaticos",
    "quincenas",
    "empresa",
    "parametros_descuentos",
    "servicios",
    "servicios_periodos",
    "prestamos_empresa",
    "novedades",
    "liquidos_quincena",
    "servicios_novedades",
    "prestamos_novedades",
    "audit_logs",
    "pagos",
    "servicios_pagos",
    "prestamos_pagos",
    "novedades_aplicadas",
]


def normalize_database_url(url):
    if url and url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


def parse_args():
    parser = argparse.ArgumentParser(
        description="Migra datos desde SQLite hacia PostgreSQL para PREVENT."
    )
    parser.add_argument(
        "--source",
        default=DEFAULT_SQLITE_PATH,
        help=f"Ruta del archivo SQLite origen. Default: {DEFAULT_SQLITE_PATH}",
    )
    parser.add_argument(
        "--target-url",
        default=os.environ.get("DATABASE_URL"),
        help="URL destino de PostgreSQL. Si no se envia, usa DATABASE_URL.",
    )
    parser.add_argument(
        "--clean-target",
        action="store_true",
        help="Vacia las tablas destino antes de migrar. Usar solo si el destino ya tiene datos.",
    )
    return parser.parse_args()


def get_source_tables(sqlite_conn):
    cursor = sqlite_conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [row[0] for row in cursor.fetchall()]
    return [
        table
        for table in tables
        if table not in SKIP_TABLES and not table.startswith("sqlite_")
    ]


def get_sqlite_row_count(sqlite_conn, table):
    cursor = sqlite_conn.cursor()
    cursor.execute(f'SELECT COUNT(*) FROM "{table}"')
    return cursor.fetchone()[0]


def order_tables(available_tables):
    ordered = [table for table in TABLE_ORDER if table in available_tables]
    remainder = sorted(table for table in available_tables if table not in ordered)
    return ordered + remainder


def get_row_count(session, table):
    return session.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar_one()


def truncate_tables(session, tables):
    if not tables:
        return

    joined = ", ".join(f'"{table}"' for table in tables)
    session.execute(text(f"TRUNCATE TABLE {joined} RESTART IDENTITY CASCADE"))
    session.commit()


def reset_sequences(session, inspector, tables, schema=TARGET_SCHEMA):
    for table in tables:
        pk = inspector.get_pk_constraint(table, schema=schema).get("constrained_columns") or []
        if len(pk) != 1 or pk[0] != "id":
            continue

        qualified_table_for_sequence = f'{schema}."{table}"'
        session.execute(
            text(
                f"""
                SELECT setval(
                    pg_get_serial_sequence('{qualified_table_for_sequence}', 'id'),
                    COALESCE(MAX(id), 1),
                    MAX(id) IS NOT NULL
                )
                FROM "{table}"
                """
            )
        )

    session.commit()


def coerce_value(value, column_type):
    if value is None:
        return None

    if isinstance(column_type, sqltypes.Boolean):
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "t", "yes", "y", "si", "s"}:
                return True
            if normalized in {"0", "false", "f", "no", "n"}:
                return False

    if isinstance(column_type, (sqltypes.DateTime, sqltypes.Date)):
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                return None
            normalized = normalized.replace("T", " ")
            try:
                return datetime.fromisoformat(normalized)
            except ValueError:
                return value

    if isinstance(column_type, sqltypes.JSON):
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                return None
            try:
                return json.loads(normalized)
            except json.JSONDecodeError:
                return value

    return value


def migrate_table(sqlite_conn, session, engine, inspector, table, schema=TARGET_SCHEMA):
    source_cursor = sqlite_conn.cursor()
    source_cursor.execute(f'SELECT * FROM "{table}"')
    rows = source_cursor.fetchall()

    if not rows:
        detail = f" - {table}: sin registros"
        print(detail)
        return 0, detail

    source_columns = [desc[0] for desc in source_cursor.description]

    target_columns_info = inspector.get_columns(table, schema=schema)
    target_columns = {column["name"] for column in target_columns_info}
    common_columns = [column for column in source_columns if column in target_columns]

    detail = (
        f" - {table}: origen={len(rows)} filas, "
        f"columnas_origen={source_columns}, "
        f"columnas_destino={sorted(target_columns)}, "
        f"columnas_comunes={common_columns}"
    )
    print(detail)

    if not common_columns:
        detail = detail + " -> sin columnas compatibles, omitida"
        print(f" - {table}: sin columnas compatibles, omitida")
        return 0, detail

    reflected_table = Table(
        table,
        MetaData(),
        schema=schema,
        autoload_with=engine,
    )
    target_column_map = {column.name: column for column in reflected_table.columns}

    payload = []
    for row in rows:
        row_dict = dict(zip(source_columns, row))
        payload.append(
            {
                column: coerce_value(row_dict[column], target_column_map[column].type)
                for column in common_columns
            }
        )

    session.execute(reflected_table.insert(), payload)
    session.commit()

    migrated_detail = f" - {table}: {len(payload)} registros migrados"
    print(migrated_detail)
    return len(payload), detail + f" -> migrados={len(payload)}"


def main():
    args = parse_args()
    target_url = normalize_database_url(args.target_url)

    if not os.path.exists(args.source):
        raise FileNotFoundError(f"No existe la base SQLite origen: {args.source}")

    if not target_url:
        raise ValueError("Debes enviar --target-url o definir DATABASE_URL.")

    os.environ["DATABASE_URL"] = target_url

    sqlite_conn = sqlite3.connect(args.source)
    try:
        source_tables = get_source_tables(sqlite_conn)
        ordered_tables = order_tables(source_tables)
        source_counts = {
            table: get_sqlite_row_count(sqlite_conn, table) for table in ordered_tables
        }
        tables_with_rows = [table for table, count in source_counts.items() if count > 0]

        print("SQLite origen:", args.source)
        print("Tablas detectadas:", ", ".join(ordered_tables) or "(ninguna)")
        print("Tablas con registros en SQLite:", ", ".join(tables_with_rows) or "(ninguna)")

        from app import create_app
        from app.models import db

        app = create_app("production")
        app.config["SQLALCHEMY_ECHO"] = False

        with app.app_context():
            db.engine.echo = False
            db.create_all()

            engine_name = db.engine.dialect.name
            engine_url = db.engine.url.render_as_string(hide_password=True)
            print("Base destino:", engine_url)

            if engine_name == "sqlite":
                raise RuntimeError(
                    "La base destino activa sigue siendo SQLite. "
                    "Define una URL valida de PostgreSQL en --target-url o DATABASE_URL "
                    "antes de ejecutar la migracion."
                )

            if engine_name != "postgresql":
                raise RuntimeError(
                    f"La base destino activa es '{engine_name}', no PostgreSQL. "
                    "Revisa la URL enviada en --target-url o DATABASE_URL."
                )

            inspector = inspect(db.engine)
            target_tables = set(inspector.get_table_names(schema=TARGET_SCHEMA))
            tables_to_migrate = [table for table in ordered_tables if table in target_tables]

            print("Tablas destino en PostgreSQL:", ", ".join(sorted(target_tables)) or "(ninguna)")
            print("Tablas a migrar:", ", ".join(tables_to_migrate) or "(ninguna)")

            missing_in_target = [table for table in ordered_tables if table not in target_tables]
            if missing_in_target:
                print("Tablas no presentes en PostgreSQL:", ", ".join(missing_in_target))

            if not tables_to_migrate:
                raise RuntimeError(
                    "No hay tablas compatibles para migrar en PostgreSQL. "
                    "Revisa si el esquema destino se creo correctamente."
                )

            if args.clean_target:
                print("Limpiando tablas destino...")
                truncate_tables(db.session, list(reversed(tables_to_migrate)))
            else:
                occupied_tables = [
                    table for table in tables_to_migrate if get_row_count(db.session, table) > 0
                ]
                if occupied_tables:
                    raise RuntimeError(
                        "La base destino ya tiene datos en: "
                        + ", ".join(occupied_tables)
                        + ". Ejecuta otra vez con --clean-target si quieres reemplazarlos."
                    )

            total_rows = 0
            report_lines = [
                f"SQLite origen: {args.source}",
                f"Base destino: {engine_url}",
                "Tablas con registros en SQLite: " + (", ".join(tables_with_rows) or "(ninguna)"),
                "Tablas a migrar: " + (", ".join(tables_to_migrate) or "(ninguna)"),
                "",
                "Detalle por tabla:",
            ]

            for table in tables_to_migrate:
                migrated_rows, detail = migrate_table(
                    sqlite_conn,
                    db.session,
                    db.engine,
                    inspector,
                    table,
                    schema=TARGET_SCHEMA,
                )
                total_rows += migrated_rows
                report_lines.append(detail)

            reset_sequences(db.session, inspector, tables_to_migrate, schema=TARGET_SCHEMA)

            with open(REPORT_PATH, "w", encoding="utf-8") as report_file:
                report_file.write("\n".join(report_lines) + "\n")

            if total_rows == 0 and tables_with_rows:
                raise RuntimeError(
                    "La migracion termino en 0 registros, pero SQLite si tiene datos en: "
                    + ", ".join(tables_with_rows)
                    + f". Revisa el detalle impreso por tabla o el archivo {REPORT_PATH}."
                )

            print(f"\nMigracion completada. Total de registros migrados: {total_rows}")
            print(f"Reporte guardado en: {REPORT_PATH}")
    finally:
        sqlite_conn.close()


if __name__ == "__main__":
    main()