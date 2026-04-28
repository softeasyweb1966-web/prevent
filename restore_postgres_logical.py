import argparse
import json
import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.sql import sqltypes


DEFAULT_BACKUP_ROOT = Path("backups")
DEFAULT_REPORT_PATH = Path("restore_postgres_report.txt")
SKIP_TABLES = {"alembic_version"}
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
TABLE_COLUMN_FALLBACKS = {
    "empleados": {
        "estado_laboral": lambda row: "ACTIVO",
    },
}


def normalize_database_url(url):
    if url and url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


def latest_backup_dir(root: Path) -> Path | None:
    if not root.exists():
        return None

    candidates = sorted(
        [item for item in root.iterdir() if item.is_dir() and item.name.startswith("pg_logical_backup_")],
        key=lambda item: item.name,
        reverse=True,
    )
    return candidates[0] if candidates else None


def parse_args():
    parser = argparse.ArgumentParser(
        description="Restaura un respaldo logico PostgreSQL de PREVENT hacia una base PostgreSQL destino."
    )
    parser.add_argument(
        "--backup-dir",
        default="",
        help="Directorio del respaldo logico. Si no se envia, usa el mas reciente en backups/.",
    )
    parser.add_argument(
        "--target-url",
        default=os.environ.get("DATABASE_URL", ""),
        help="URL destino de PostgreSQL. Si no se envia, usa DATABASE_URL.",
    )
    parser.add_argument(
        "--clean-target",
        action="store_true",
        help="Vaciar tablas destino antes de restaurar.",
    )
    parser.add_argument(
        "--report-path",
        default=str(DEFAULT_REPORT_PATH),
        help=f"Ruta del reporte de restauracion. Default: {DEFAULT_REPORT_PATH}",
    )
    return parser.parse_args()


def load_manifest(backup_dir: Path):
    manifest_path = backup_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"No existe manifest.json en {backup_dir}")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def backup_tables_from_manifest(manifest):
    tables = {}
    for schema in manifest.get("schemas", []):
        schema_name = schema.get("schema", "public")
        for table in schema.get("tables", []):
            table_name = table["table_name"]
            if table_name in SKIP_TABLES:
                continue
            tables[table_name] = {
                "schema": schema_name,
                "meta": table,
            }
    return tables


def order_tables(table_names):
    ordered = [table for table in TABLE_ORDER if table in table_names]
    remainder = sorted(table for table in table_names if table not in ordered)
    return ordered + remainder


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


def quote_identifier(name):
    return '"' + str(name).replace('"', '""') + '"'


def get_row_count(conn, table_name):
    return conn.execute(text(f"SELECT COUNT(*) FROM {quote_identifier(table_name)}")).scalar_one()


def truncate_tables(conn, tables):
    if not tables:
        return
    joined = ", ".join(quote_identifier(table) for table in tables)
    conn.execute(text(f"TRUNCATE TABLE {joined} RESTART IDENTITY CASCADE"))


def reset_sequences(conn, inspector, tables):
    for table in tables:
        pk = inspector.get_pk_constraint(table).get("constrained_columns") or []
        if len(pk) != 1 or pk[0] != "id":
            continue

        conn.execute(
            text(
                f"""
                SELECT setval(
                    pg_get_serial_sequence('{table}', 'id'),
                    COALESCE(MAX(id), 1),
                    MAX(id) IS NOT NULL
                )
                FROM {quote_identifier(table)}
                """
            )
        )


def load_rows_from_backup(backup_dir: Path, table_info):
    relative_json = table_info["meta"].get("files", {}).get("json")
    if not relative_json:
        return []
    json_path = backup_dir / relative_json
    if not json_path.exists():
        raise FileNotFoundError(f"No existe el archivo de datos esperado: {json_path}")
    return json.loads(json_path.read_text(encoding="utf-8"))


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


def restore_table(conn, inspector, backup_dir: Path, table_name: str, table_info):
    rows = load_rows_from_backup(backup_dir, table_info)
    if not rows:
        detail = f" - {table_name}: sin registros en backup"
        print(detail)
        return 0, detail

    target_columns_info = inspector.get_columns(table_name)
    target_column_map = {column["name"]: column for column in target_columns_info}
    source_columns = list(rows[0].keys()) if rows else []
    common_columns = [column for column in source_columns if column in target_column_map]
    fallback_columns = [
        column for column in TABLE_COLUMN_FALLBACKS.get(table_name, {})
        if column in target_column_map and column not in common_columns
    ]

    detail = (
        f" - {table_name}: backup={len(rows)} filas, "
        f"columnas_backup={source_columns}, "
        f"columnas_comunes={common_columns}"
    )
    print(detail)

    if not common_columns:
        skipped = detail + " -> sin columnas compatibles, omitida"
        print(f" - {table_name}: sin columnas compatibles, omitida")
        return 0, skipped

    insert_columns = common_columns + fallback_columns
    payload = []
    for row in rows:
        row_payload = {
            column: coerce_value(row.get(column), target_column_map[column]["type"])
            for column in common_columns
        }
        row_payload = apply_fallback_columns(table_name, row_payload, target_column_map)
        payload.append(row_payload)

    quoted_columns = ", ".join(quote_identifier(column) for column in insert_columns)
    bind_columns = ", ".join(f":{column}" for column in insert_columns)
    insert_sql = text(
        f"INSERT INTO {quote_identifier(table_name)} ({quoted_columns}) VALUES ({bind_columns})"
    )
    conn.execute(insert_sql, payload)

    migrated_detail = f" - {table_name}: {len(payload)} registros restaurados"
    print(migrated_detail)
    return len(payload), detail + f" -> restaurados={len(payload)}"


def main():
    args = parse_args()
    backup_dir = Path(args.backup_dir) if args.backup_dir else latest_backup_dir(DEFAULT_BACKUP_ROOT)
    target_url = normalize_database_url(args.target_url)
    report_path = Path(args.report_path)

    if backup_dir is None:
        raise FileNotFoundError("No se encontro ningun respaldo logico en backups/.")

    if not backup_dir.exists():
        raise FileNotFoundError(f"No existe el directorio de backup: {backup_dir}")

    if not target_url:
        raise ValueError("Debes enviar --target-url o definir DATABASE_URL.")

    manifest = load_manifest(backup_dir)
    backup_tables = backup_tables_from_manifest(manifest)
    ordered_backup_tables = order_tables(backup_tables.keys())

    engine = create_engine(target_url, future=True)
    inspector = inspect(engine)
    engine_name = engine.dialect.name
    engine_url = make_url(target_url).render_as_string(hide_password=True)

    print("Backup origen:", str(backup_dir))
    print("Base destino:", engine_url)

    if engine_name != "postgresql":
        raise RuntimeError(
            f"La base destino activa es '{engine_name}', no PostgreSQL. Revisa la URL enviada."
        )

    target_tables = set(inspector.get_table_names())
    tables_to_restore = [
        table for table in ordered_backup_tables if table in target_tables and table not in SKIP_TABLES
    ]
    missing_in_target = [
        table for table in ordered_backup_tables if table not in target_tables and table not in SKIP_TABLES
    ]

    print("Tablas detectadas en backup:", ", ".join(ordered_backup_tables) or "(ninguna)")
    print("Tablas disponibles en destino:", ", ".join(sorted(target_tables)) or "(ninguna)")
    print("Tablas a restaurar:", ", ".join(tables_to_restore) or "(ninguna)")
    if missing_in_target:
        print("Tablas del backup no presentes en destino:", ", ".join(missing_in_target))

    if not tables_to_restore:
        raise RuntimeError(
            "No hay tablas compatibles para restaurar en PostgreSQL. "
            "Ejecuta primero las migraciones del proyecto."
        )

    with engine.begin() as conn:
        if args.clean_target:
            print("Limpiando tablas destino...")
            truncate_tables(conn, list(reversed(tables_to_restore)))
        else:
            occupied_tables = [table for table in tables_to_restore if get_row_count(conn, table) > 0]
            if occupied_tables:
                raise RuntimeError(
                    "La base destino ya tiene datos en: "
                    + ", ".join(occupied_tables)
                    + ". Ejecuta otra vez con --clean-target si quieres reemplazarlos."
                )

        total_rows = 0
        report_lines = [
            f"Backup origen: {backup_dir}",
            f"Base destino: {engine_url}",
            "Tablas a restaurar: " + (", ".join(tables_to_restore) or "(ninguna)"),
            "",
            "Detalle por tabla:",
        ]
        for table in tables_to_restore:
            restored_rows, detail = restore_table(conn, inspector, backup_dir, table, backup_tables[table])
            total_rows += restored_rows
            report_lines.append(detail)

        reset_sequences(conn, inspector, tables_to_restore)
        report_path.write_text("\n".join(report_lines) + "\n", encoding="utf-8")

    print(f"\nRestauracion completada. Total de registros restaurados: {total_rows}")
    print(f"Reporte guardado en: {report_path}")


if __name__ == "__main__":
    main()
