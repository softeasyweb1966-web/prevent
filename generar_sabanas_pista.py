"""Carga PISTA.xlsx y genera las sabanas de prefacturas.

Uso:
    .venv\Scripts\python.exe generar_sabanas_pista.py
"""

from __future__ import annotations

import os
import io
import re
import zipfile
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


BASE_DIR = Path(__file__).resolve().parent
ARCHIVO_PISTA = BASE_DIR / "PISTA.xlsx"
CARPETA_SALIDA = BASE_DIR / "sabanas"
FECHA_DESDE = datetime(2024, 1, 1)
FECHA_HASTA = datetime.now().replace(hour=23, minute=59, second=59, microsecond=0)
DATABASE_URL_LOCAL = "postgresql+psycopg2://postgres:PreventPg2026Local1@127.0.0.1:5432/prevent_utf8"
PALABRAS_RUIDO_EMPRESA = {
    "s",
    "sa",
    "sas",
    "ltda",
    "limitada",
    "cia",
    "compania",
    "compañia",
    "empresa",
    "grupo",
    "de",
    "del",
    "la",
    "las",
    "los",
    "y",
    "en",
    "para",
    "con",
}

os.environ.setdefault("DATABASE_URL", DATABASE_URL_LOCAL)
os.environ.setdefault("FLASK_ENV", "production")

from app import create_app  # noqa: E402
from app.models import Usuario  # noqa: E402
from app.routes import cargue_atenciones as ca  # noqa: E402


def _usuario_para_proceso() -> SimpleNamespace:
    usuario = (
        Usuario.query.filter_by(is_easy=True, activo=True).first()
        or Usuario.query.filter_by(usuario="admin", activo=True).first()
        or Usuario.query.filter_by(activo=True).order_by(Usuario.id.asc()).first()
    )
    return SimpleNamespace(id=usuario.id if usuario else None)


def leer_empresas_pista() -> list[str]:
    from openpyxl import load_workbook

    wb = load_workbook(ARCHIVO_PISTA, read_only=True, data_only=True)
    ws = wb.active
    empresas = []
    vistas = set()
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row and row[0]:
            normalizada = ca._normalizar_nombre_empresa_estricto(str(row[0]).strip())
            if normalizada and normalizada not in vistas:
                empresas.append(normalizada)
                vistas.add(normalizada)
    return empresas


def _normalizar_nombre_archivo_sabana(nombre_archivo: str) -> str:
    stem = Path(nombre_archivo).stem
    stem = re.sub(r"^(cred|efec|mixto)-", "", stem, flags=re.IGNORECASE)
    stem = re.sub(r"-\d{8}-\d{8}$", "", stem)
    return ca._normalizar_nombre_empresa_estricto(stem.replace("_", " "))


def _coincide_empresa(nombre_sabana: str, empresas_pista: list[str]) -> tuple[bool, str, str]:
    for empresa in empresas_pista:
        if nombre_sabana == empresa:
            return True, empresa, "exacta"
    return False, "", "sin coincidencia exacta"


def _guardar_reporte_coincidencias(reporte: list[dict]) -> Path:
    from openpyxl import Workbook

    salida = CARPETA_SALIDA / "Reporte-coincidencias-PISTA.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.title = "coincidencias"
    ws.append(["incluida", "archivo_sabana", "empresa_sabana", "empresa_pista", "motivo"])
    for fila in reporte:
        ws.append([
            "SI" if fila["incluida"] else "NO",
            fila["archivo_sabana"],
            fila["empresa_sabana"],
            fila["empresa_pista"],
            fila["motivo"],
        ])
    ws.column_dimensions["A"].width = 12
    ws.column_dimensions["B"].width = 65
    ws.column_dimensions["C"].width = 55
    ws.column_dimensions["D"].width = 55
    ws.column_dimensions["E"].width = 45
    wb.save(salida)
    return salida


def generar_zip_sabanas(app, usuario, empresas_pista: list[str]) -> tuple[Path, Path, int, int]:
    periodo = f"{FECHA_DESDE:%d%m%Y}-{FECHA_HASTA:%d%m%Y}"
    salida = CARPETA_SALIDA / f"Prefacturas-{periodo}.zip"
    query = f"/api/comercial/prefacturas/generar?fecha_desde={FECHA_DESDE:%Y-%m-%d}&fecha_hasta={FECHA_HASTA:%Y-%m-%d}"

    with app.test_request_context(query):
        with patch.object(ca, "_require_commercial_permission"), \
             patch.object(ca, "_is_admin_user", return_value=True), \
             patch.object(ca, "_resolver_vendedor_usuario_actual", return_value=None), \
             patch.object(ca, "current_user", usuario), \
             patch.object(ca, "exigir_cliente"):
            respuesta = ca.generar_prefacturas.__wrapped__()

    if getattr(respuesta, "status_code", 200) != 200:
        detalle = respuesta.get_json(silent=True) if hasattr(respuesta, "get_json") else None
        raise RuntimeError(f"No se pudieron generar las sabanas: {detalle or respuesta}")

    respuesta.direct_passthrough = False
    CARPETA_SALIDA.mkdir(exist_ok=True)
    total_generadas = 0
    total_filtradas = 0
    with zipfile.ZipFile(io.BytesIO(respuesta.get_data()), "r") as zin:
        with zipfile.ZipFile(salida, "w", zipfile.ZIP_DEFLATED) as zout:
            reporte = []
            for item in zin.infolist():
                if item.filename == "resumen_periodo.xlsx":
                    continue
                total_generadas += 1
                empresa_sabana = _normalizar_nombre_archivo_sabana(item.filename)
                incluida, empresa_pista, motivo = _coincide_empresa(empresa_sabana, empresas_pista)
                reporte.append({
                    "incluida": incluida,
                    "archivo_sabana": item.filename,
                    "empresa_sabana": empresa_sabana,
                    "empresa_pista": empresa_pista,
                    "motivo": motivo,
                })
                if incluida:
                    zout.writestr(item, zin.read(item.filename))
                    total_filtradas += 1
    reporte_salida = _guardar_reporte_coincidencias(reporte)
    return salida, reporte_salida, total_generadas, total_filtradas


def main() -> int:
    if not ARCHIVO_PISTA.exists():
        raise FileNotFoundError(f"No existe {ARCHIVO_PISTA}")

    app = create_app(os.environ["FLASK_ENV"])
    with app.app_context():
        usuario = _usuario_para_proceso()
        empresas_pista = leer_empresas_pista()
        salida, reporte_salida, total_generadas, total_filtradas = generar_zip_sabanas(app, usuario, empresas_pista)

    print("Proceso terminado.")
    print(f"Periodo: {FECHA_DESDE:%Y-%m-%d} a {FECHA_HASTA:%Y-%m-%d}")
    print(f"Empresas en PISTA.xlsx: {len(empresas_pista)}")
    print(f"Sabanas generadas por el proceso actual antes de filtrar: {total_generadas}")
    print(f"Sabanas coincidentes con PISTA.xlsx: {total_filtradas}")
    print(f"Archivo generado: {salida}")
    print(f"Reporte de coincidencias: {reporte_salida}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
