import argparse
import json
import os
import sqlite3
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import MetaData, Table, inspect, text
from sqlalchemy.sql import sqltypes


DEFAULT_SQLITE_PATH = os.path.join("instance", "prevent.db")
REPORT_PATH = "sqlite_restante_a_postgres_report.txt"
SKIP_TABLES = {"sqlite_sequence", "alembic_version"}
TABLE_ORDER = [
    "areas",
    "cargos",
    "roles",
    "permisos",
    "role_permiso",
    "usuarios",
    "empleados",
    "empleado_asignaciones_laborales",
    "empleado_movimientos_laborales",
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
    "vendedores",
    "clientes_comerciales",
    "clientes_comerciales_adjuntos",
    "comercial_catalogo_items",
    "comercial_paquetes_detalle",
    "clientes_comerciales_tarifas",
    "clientes_atenciones",
    "clientes_atenciones_detalle",
    "clientes_seguimiento_documentos",
    "clientes_seguimiento_pagos",
]
TABLE_COLUMN_FALLBACKS = {
    "empleados": {
        "estado_laboral": lambda row: "ACTIVO",
    },
}


def normalize_database_url(url):
    if url and url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Migra hacia PostgreSQL las tablas que hoy solo estan en SQLite "
            "o que siguen vacias en el destino."
        )
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
        "--tables",
        default="",
        help="Lista opcional de tablas separadas por coma para migrar solo esas.",
    )
    return parser.parse_args()


def selected_tables(raw_value):
    if not raw_value.strip():
        return None
    return {item.strip() for item in raw_value.split(",") if item.strip()}


def get_source_tables(sqlite_conn):
    cursor = sqlite_conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [row[0] for row in cursor.fetchall()]
    return [
        table
        for table in tables
        if table not in SKIP_TABLES and not table.startswith("sqlite_")
    ]


def order_tables(table_names):
    ordered = [table for table in TABLE_ORDER if table in table_names]
    remainder = sorted(table for table in table_names if table not in ordered)
    return ordered + remainder


def get_sqlite_row_count(sqlite_conn, table):
    cursor = sqlite_conn.cursor()
    cursor.execute(f'SELECT COUNT(*) FROM "{table}"')
    return cursor.fetchone()[0]


def get_pg_row_count(session, table):
    return session.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar_one()


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
        if isinstance(value, (datetime, date)):
            return value
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                return None
            normalized = normalized.replace("T", " ").replace("Z", "")
            try:
                parsed = datetime.fromisoformat(normalized)
                if isinstance(column_type, sqltypes.Date) and not isinstance(column_type, sqltypes.DateTime):
                    return parsed.date()
                return parsed
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

    if isinstance(column_type, (sqltypes.Numeric, sqltypes.DECIMAL)):
        if isinstance(value, Decimal):
            return value
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                return None
            try:
                return Decimal(normalized)
            except Exception:
                return value

    return value


def apply_fallback_columns(table_name, row_payload, target_column_map):
    fallback_map = TABLE_COLUMN_FALLBACKS.get(table_name, {})
    for column_name, resolver in fallback_map.items():
        if column_name not in target_column_map:
            continue
        current_value = row_payload.get(column_name)
        if current_value is not None:
            continue
        row_payload[column_name] = resolver(row_payload) if callable(resolver) else resolver
    return row_payload


def reset_sequences(session, inspector, tables):
    for table in tables:
        pk = inspector.get_pk_constraint(table).get("constrained_columns") or []
        if len(pk) != 1 or pk[0] != "id":
            continue

        session.execute(
            text(
                f"""
                SELECT setval(
                    pg_get_serial_sequence('{table}', 'id'),
                    COALESCE(MAX(id), 1),
                    MAX(id) IS NOT NULL
                )
                FROM "{table}"
                """
            )
        )

    session.commit()


def migrate_table(sqlite_conn, session, engine, inspector, table):
    source_cursor = sqlite_conn.cursor()
    source_cursor.execute(f'SELECT * FROM "{table}"')
    rows = source_cursor.fetchall()

    if not rows:
        detail = f" - {table}: sin registros en SQLite"
        print(detail)
        return 0, detail

    source_columns = [desc[0] for desc in source_cursor.description]
    target_columns_info = inspector.get_columns(table)
    target_columns = {column["name"] for column in target_columns_info}
    common_columns = [column for column in source_columns if column in target_columns]

    reflected_table = Table(table, MetaData(), autoload_with=engine)
    target_column_map = {column.name: column for column in reflected_table.columns}
    fallback_columns = [
        column for column in TABLE_COLUMN_FALLBACKS.get(table, {})
        if column in target_column_map and column not in common_columns
    ]

    detail = (
        f" - {table}: sqlite={len(rows)} filas, "
        f"columnas_origen={source_columns}, "
        f"columnas_comunes={common_columns}"
    )
    print(detail)

    if not common_columns:
        skipped = detail + " -> sin columnas compatibles, omitida"
        print(f" - {table}: sin columnas compatibles, omitida")
        return 0, skipped

    payload = []
    for row in rows:
        row_dict = dict(zip(source_columns, row))
        row_payload = {
            column: coerce_value(row_dict[column], target_column_map[column].type)
            for column in common_columns
        }
        row_payload = apply_fallback_columns(table, row_payload, target_column_map)
        payload.append(row_payload)

    session.execute(reflected_table.insert(), payload)
    session.commit()

    migrated_detail = f" - {table}: {len(payload)} registros migrados"
    print(migrated_detail)
    return len(payload), detail + f" -> migrados={len(payload)}"


def main():
    args = parse_args()
    target_url = normalize_database_url(args.target_url)
    include_tables = selected_tables(args.tables)

    if not os.path.exists(args.source):
        raise FileNotFoundError(f"No existe la base SQLite origen: {args.source}")

    if not target_url:
        raise ValueError("Debes enviar --target-url o definir DATABASE_URL.")

    os.environ["DATABASE_URL"] = target_url

    sqlite_conn = sqlite3.connect(args.source)
    try:
        source_tables = get_source_tables(sqlite_conn)
        if include_tables is not None:
            source_tables = [table for table in source_tables if table in include_tables]

        source_counts = {table: get_sqlite_row_count(sqlite_conn, table) for table in source_tables}
        source_tables = [table for table in source_tables if source_counts.get(table, 0) > 0]
        source_tables = order_tables(source_tables)

        print("SQLite origen:", args.source)
        print("Tablas con registros en SQLite:", ", ".join(source_tables) or "(ninguna)")

        from app import create_app
        from app.models import db

        app = create_app("production")
        app.config["SQLALCHEMY_ECHO"] = False

        with app.app_context():
            db.engine.echo = False
            inspector = inspect(db.engine)
            target_tables = set(inspector.get_table_names())

            eligible_tables = []
            skipped_tables = []
            for table in source_tables:
                if table not in target_tables:
                    skipped_tables.append((table, "no existe en PostgreSQL"))
                    continue

                target_count = get_pg_row_count(db.session, table)
                if target_count > 0:
                    skipped_tables.append((table, f"ya tiene {target_count} registros en PostgreSQL"))
                    continue

                eligible_tables.append(table)

            print("Tablas elegibles para migrar:", ", ".join(eligible_tables) or "(ninguna)")
            if skipped_tables:
                for table, reason in skipped_tables:
                    print(f" - {table}: omitida ({reason})")

            report_lines = [
                f"SQLite origen: {args.source}",
                f"Base destino: {db.engine.url.render_as_string(hide_password=True)}",
                "Tablas elegibles: " + (", ".join(eligible_tables) or "(ninguna)"),
                "",
                "Detalle por tabla:",
            ]

            total_rows = 0
            migrated_tables = []
            for table in eligible_tables:
                migrated_rows, detail = migrate_table(
                    sqlite_conn,
                    db.session,
                    db.engine,
                    inspector,
                    table,
                )
                total_rows += migrated_rows
                migrated_tables.append(table)
                report_lines.append(detail)

            if migrated_tables:
                reset_sequences(db.session, inspector, migrated_tables)

            if skipped_tables:
                report_lines.append("")
                report_lines.append("Tablas omitidas:")
                for table, reason in skipped_tables:
                    report_lines.append(f" - {table}: {reason}")

            with open(REPORT_PATH, "w", encoding="utf-8") as report_file:
                report_file.write("\n".join(report_lines) + "\n")

            print(f"\nMigracion complementaria completada. Total de registros migrados: {total_rows}")
            print(f"Reporte guardado en: {REPORT_PATH}")
    finally:
        sqlite_conn.close()


if __name__ == "__main__":
    main()
