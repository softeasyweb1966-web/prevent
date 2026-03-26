import csv
import json
import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor


def json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return str(value)


def safe_db_label(database_url):
    parts = urlsplit(database_url)
    return {
        "scheme": parts.scheme,
        "host": parts.hostname,
        "port": parts.port,
        "database": (parts.path or "").lstrip("/"),
        "username": parts.username,
    }


def fetch_all(cursor, query, params=None):
    cursor.execute(query, params or ())
    return cursor.fetchall()


def main():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL no esta definida.")

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    root = Path("backups") / f"pg_logical_backup_{timestamp}"
    root.mkdir(parents=True, exist_ok=True)

    manifest = {
        "created_at_utc": datetime.utcnow().isoformat() + "Z",
        "database": safe_db_label(database_url),
        "schemas": [],
    }

    with psycopg2.connect(database_url) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            tables = fetch_all(
                cur,
                """
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_type = 'BASE TABLE'
                  AND table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY table_schema, table_name
                """,
            )

            schema_map = {}

            for table in tables:
                table_schema = table["table_schema"]
                table_name = table["table_name"]
                schema_dir = root / table_schema
                schema_dir.mkdir(parents=True, exist_ok=True)

                columns = fetch_all(
                    cur,
                    """
                    SELECT
                        column_name,
                        data_type,
                        udt_name,
                        is_nullable,
                        column_default,
                        ordinal_position
                    FROM information_schema.columns
                    WHERE table_schema = %s AND table_name = %s
                    ORDER BY ordinal_position
                    """,
                    (table_schema, table_name),
                )

                pk_columns = fetch_all(
                    cur,
                    """
                    SELECT kcu.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.table_schema = kcu.table_schema
                    WHERE tc.constraint_type = 'PRIMARY KEY'
                      AND tc.table_schema = %s
                      AND tc.table_name = %s
                    ORDER BY kcu.ordinal_position
                    """,
                    (table_schema, table_name),
                )

                indexes = fetch_all(
                    cur,
                    """
                    SELECT indexname, indexdef
                    FROM pg_indexes
                    WHERE schemaname = %s AND tablename = %s
                    ORDER BY indexname
                    """,
                    (table_schema, table_name),
                )

                count_query = sql.SQL("SELECT COUNT(*) AS total FROM {}.{}").format(
                    sql.Identifier(table_schema),
                    sql.Identifier(table_name),
                )
                cur.execute(count_query)
                total_rows = cur.fetchone()["total"]

                data_query = sql.SQL("SELECT * FROM {}.{}").format(
                    sql.Identifier(table_schema),
                    sql.Identifier(table_name),
                )
                cur.execute(data_query)
                rows = cur.fetchall()

                csv_path = schema_dir / f"{table_name}.csv"
                json_path = schema_dir / f"{table_name}.json"

                column_names = [column["column_name"] for column in columns]
                with csv_path.open("w", newline="", encoding="utf-8-sig") as csv_file:
                    writer = csv.DictWriter(csv_file, fieldnames=column_names, extrasaction="ignore")
                    writer.writeheader()
                    for row in rows:
                        writer.writerow(
                            {
                                key: json_default(value) if value is not None else None
                                for key, value in row.items()
                            }
                        )

                with json_path.open("w", encoding="utf-8") as json_file:
                    json.dump(rows, json_file, ensure_ascii=False, indent=2, default=json_default)

                schema_map.setdefault(table_schema, []).append(
                    {
                        "table_name": table_name,
                        "row_count": total_rows,
                        "columns": columns,
                        "primary_key": [item["column_name"] for item in pk_columns],
                        "indexes": indexes,
                        "files": {
                            "csv": str(csv_path.relative_to(root)),
                            "json": str(json_path.relative_to(root)),
                        },
                    }
                )

            for schema_name, schema_tables in schema_map.items():
                manifest["schemas"].append(
                    {
                        "schema": schema_name,
                        "tables": schema_tables,
                    }
                )

    manifest_path = root / "manifest.json"
    with manifest_path.open("w", encoding="utf-8") as manifest_file:
        json.dump(manifest, manifest_file, ensure_ascii=False, indent=2, default=json_default)

    print(str(root.resolve()))
    print(json.dumps(manifest, ensure_ascii=False, indent=2, default=json_default))


if __name__ == "__main__":
    main()
