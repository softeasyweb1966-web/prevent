from __future__ import annotations

import argparse
import csv
import os
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable
from zipfile import ZipFile
from xml.etree import ElementTree as ET

from app import create_app
from app.models import (
    ClienteAtencionDetalle,
    ClienteComercialTarifa,
    ComercialCatalogoItem,
    ComercialPaqueteDetalle,
    db,
)


@dataclass(frozen=True)
class ExamenRow:
    precio: Decimal
    nombre: str


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Importa un catalogo real de examenes desde un archivo de dos columnas "
            "y reemplaza el catalogo actual."
        )
    )
    parser.add_argument(
        "archivo",
        nargs="?",
        default="examenes.xlsx",
        help="Ruta del archivo fuente. Soporta .xlsx, .csv y .txt",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", ""),
        help="URL de PostgreSQL. Si no se envia, usa DATABASE_URL.",
    )
    return parser.parse_args()


def _normalize_text(value: object) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def _parse_decimal(value: object) -> Decimal:
    raw = _normalize_text(value)
    if not raw:
        return Decimal("0")

    normalized = raw.replace("$", "").replace(" ", "")
    if "," in normalized and "." in normalized:
        normalized = normalized.replace(".", "").replace(",", ".")
    elif "," in normalized:
        normalized = normalized.replace(",", ".")

    try:
        return Decimal(normalized)
    except InvalidOperation as exc:
        raise ValueError(f"No se pudo interpretar el precio '{raw}'.") from exc


def _xlsx_target_from_workbook(zip_file: ZipFile) -> str:
    ns_main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    ns_rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    workbook = ET.fromstring(zip_file.read("xl/workbook.xml"))
    sheets = workbook.find(f"{{{ns_main}}}sheets")
    if sheets is None or not list(sheets):
        raise ValueError("El archivo XLSX no contiene hojas.")

    first_sheet = list(sheets)[0]
    rel_id = first_sheet.attrib.get(f"{{{ns_rel}}}id")
    if not rel_id:
        raise ValueError("No se encontro la relacion de la hoja principal.")

    rels = ET.fromstring(zip_file.read("xl/_rels/workbook.xml.rels"))
    for rel in rels:
        if rel.attrib.get("Id") == rel_id:
            target = rel.attrib.get("Target", "")
            if not target:
                break
            return target.lstrip("/")

    raise ValueError("No se pudo resolver la hoja principal del XLSX.")


def _xlsx_shared_strings(zip_file: ZipFile) -> list[str]:
    path = "xl/sharedStrings.xml"
    if path not in zip_file.namelist():
        return []

    ns_main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    root = ET.fromstring(zip_file.read(path))
    values: list[str] = []
    for item in root:
        text = "".join(node.text or "" for node in item.iter(f"{{{ns_main}}}t"))
        values.append(text)
    return values


def _read_xlsx_rows(path: Path) -> list[list[str]]:
    ns_main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    with ZipFile(path) as zip_file:
        target = _xlsx_target_from_workbook(zip_file)
        shared_strings = _xlsx_shared_strings(zip_file)
        sheet = ET.fromstring(zip_file.read(f"xl/{target}"))
        sheet_data = sheet.find(f"{{{ns_main}}}sheetData")
        if sheet_data is None:
            return []

        rows: list[list[str]] = []
        for row in sheet_data:
            values: list[str] = []
            for cell in row:
                cell_type = cell.attrib.get("t")
                value_node = cell.find(f"{{{ns_main}}}v")
                value = "" if value_node is None or value_node.text is None else value_node.text
                if cell_type == "s" and value:
                    value = shared_strings[int(value)]
                values.append(_normalize_text(value))
            rows.append(values)
        return rows


def _read_text_rows(path: Path) -> list[list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(4096)
        handle.seek(0)
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
        reader = csv.reader(handle, dialect)
        return [[_normalize_text(col) for col in row] for row in reader]


def _read_rows(path: Path) -> list[list[str]]:
    suffix = path.suffix.lower()
    if suffix == ".xlsx":
        return _read_xlsx_rows(path)
    if suffix in {".csv", ".txt"}:
        return _read_text_rows(path)
    raise ValueError(f"Formato no soportado: {path.suffix}")


def _build_exam_rows(raw_rows: Iterable[list[str]]) -> list[ExamenRow]:
    rows = list(raw_rows)
    if not rows:
        raise ValueError("El archivo esta vacio.")
    if len(rows[0]) < 2:
        raise ValueError("El archivo debe tener al menos dos columnas.")

    data_rows = rows[1:]
    examenes: list[ExamenRow] = []
    for index, row in enumerate(data_rows, start=2):
        if not row or all(not _normalize_text(col) for col in row):
            continue
        if len(row) < 2:
            raise ValueError(f"La fila {index} no tiene dos columnas.")

        precio = _parse_decimal(row[0])
        nombre = _normalize_text(row[1])
        if not nombre:
            continue
        examenes.append(ExamenRow(precio=precio, nombre=nombre[:200]))

    if not examenes:
        raise ValueError("No se encontraron examenes validos para importar.")

    unique_names = {item.nombre.casefold() for item in examenes}
    if len(unique_names) != len(examenes):
        raise ValueError("Hay nombres de examen duplicados en el archivo fuente.")

    return examenes


def _slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", ascii_value).strip("_").upper()
    return cleaned or "EXAMEN"


def _build_unique_code(nombre: str, used_codes: set[str]) -> str:
    base = _slugify(nombre)[:40] or "EXAMEN"
    candidate = base
    suffix = 2
    while candidate in used_codes:
        tail = f"_{suffix}"
        candidate = f"{base[: max(1, 50 - len(tail))]}{tail}"
        suffix += 1
    used_codes.add(candidate)
    return candidate


def _import_catalog(examenes: list[ExamenRow]) -> dict[str, int]:
    deleted_atenciones_detalle = ClienteAtencionDetalle.query.delete(synchronize_session=False)
    deleted_tarifas = ClienteComercialTarifa.query.delete(synchronize_session=False)
    deleted_paquetes_detalle = ComercialPaqueteDetalle.query.delete(synchronize_session=False)
    deleted_catalogo = ComercialCatalogoItem.query.delete(synchronize_session=False)

    used_codes: set[str] = set()
    nuevos_items: list[ComercialCatalogoItem] = []
    for examen in examenes:
        nuevos_items.append(
            ComercialCatalogoItem(
                tipo_item="EXAMEN",
                tipo_examen=None,
                subtipo_laboratorio=None,
                clasificacion_completa=False,
                nombre=examen.nombre,
                codigo=_build_unique_code(examen.nombre, used_codes),
                descripcion=None,
                tarifa_base=examen.precio,
                activo=True,
            )
        )

    db.session.add_all(nuevos_items)
    db.session.commit()

    return {
        "eliminados_atenciones_detalle": deleted_atenciones_detalle,
        "eliminados_tarifas": deleted_tarifas,
        "eliminados_paquetes_detalle": deleted_paquetes_detalle,
        "eliminados_catalogo": deleted_catalogo,
        "insertados_examenes": len(nuevos_items),
    }


def main() -> int:
    args = _parse_args()
    archivo = Path(args.archivo)
    if not archivo.exists():
        raise SystemExit(f"No existe el archivo fuente: {archivo}")

    if not args.database_url:
        raise SystemExit("Debes enviar --database-url o definir DATABASE_URL.")

    os.environ["DATABASE_URL"] = args.database_url
    examenes = _build_exam_rows(_read_rows(archivo))

    app = create_app()
    with app.app_context():
        try:
            resumen = _import_catalog(examenes)
        except Exception:
            db.session.rollback()
            raise

    print("Importacion completada.")
    print(f"Archivo: {archivo}")
    print(f"Examenes insertados: {resumen['insertados_examenes']}")
    print(f"Catalogo eliminado: {resumen['eliminados_catalogo']}")
    print(f"Tarifas eliminadas: {resumen['eliminados_tarifas']}")
    print(f"Paquetes detalle eliminados: {resumen['eliminados_paquetes_detalle']}")
    print(f"Atenciones detalle eliminadas: {resumen['eliminados_atenciones_detalle']}")
    print("Clasificacion cargada: PENDIENTE DE CLASIFICAR")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
