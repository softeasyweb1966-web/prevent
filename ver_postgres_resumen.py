import argparse
import json
import os
from datetime import datetime

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url


COMMERCIAL_TABLES = [
    "vendedores",
    "clientes_comerciales",
    "clientes_comerciales_adjuntos",
    "clientes_comerciales_tarifas",
    "comercial_catalogo_items",
    "comercial_paquetes_detalle",
    "clientes_atenciones",
    "clientes_atenciones_detalle",
    "clientes_seguimiento_documentos",
    "clientes_seguimiento_pagos",
]


def normalize_database_url(url):
    if url and url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


def parse_args():
    parser = argparse.ArgumentParser(
        description="Muestra un inventario de tablas y registros de la base PostgreSQL de PREVENT."
    )
    parser.add_argument(
        "--target-url",
        default=os.environ.get("DATABASE_URL", ""),
        help="URL destino de PostgreSQL. Si no se envia, usa DATABASE_URL.",
    )
    parser.add_argument(
        "--report-path",
        default="postgres_resumen.json",
        help="Archivo JSON donde guardar el resumen. Default: postgres_resumen.json",
    )
    return parser.parse_args()


def table_count(conn, table_name):
    return conn.execute(text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar_one()


def fetch_sample_rows(conn, table_name, limit=5):
    rows = conn.execute(text(f'SELECT * FROM "{table_name}" ORDER BY 1 LIMIT {limit}')).mappings().all()
    return [dict(row) for row in rows]


def main():
    args = parse_args()
    target_url = normalize_database_url(args.target_url)

    if not target_url:
        raise ValueError("Debes enviar --target-url o definir DATABASE_URL.")

    parsed_url = make_url(target_url)
    if not parsed_url.drivername.startswith("postgresql"):
        raise RuntimeError("La URL enviada no corresponde a PostgreSQL.")

    engine = create_engine(target_url, future=True)
    inspector = inspect(engine)
    tables = sorted(inspector.get_table_names())

    summary = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "database": parsed_url.render_as_string(hide_password=True),
        "dialect": engine.dialect.name,
        "tables": {},
        "commercial": {},
    }

    with engine.connect() as conn:
        for table in tables:
            count = table_count(conn, table)
            summary["tables"][table] = {
                "row_count": count,
            }

        for table in COMMERCIAL_TABLES:
            if table not in tables:
                summary["commercial"][table] = {
                    "exists": False,
                    "row_count": None,
                    "sample_rows": [],
                }
                continue

            count = summary["tables"][table]["row_count"]
            summary["commercial"][table] = {
                "exists": True,
                "row_count": count,
                "sample_rows": fetch_sample_rows(conn, table, limit=5) if count > 0 else [],
            }

    print(f"Base: {summary['database']}")
    print(f"Dialecto: {summary['dialect']}")
    print("")
    print("Conteo general por tabla:")
    for table, info in summary["tables"].items():
        print(f" - {table}: {info['row_count']}")

    print("")
    print("Resumen modulo comercial:")
    for table, info in summary["commercial"].items():
        if not info["exists"]:
            print(f" - {table}: no existe")
            continue
        print(f" - {table}: {info['row_count']}")

    with open(args.report_path, "w", encoding="utf-8") as report_file:
        json.dump(summary, report_file, ensure_ascii=False, indent=2, default=str)

    print("")
    print(f"Reporte guardado en: {args.report_path}")


if __name__ == "__main__":
    main()
