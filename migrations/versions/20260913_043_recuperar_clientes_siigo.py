"""Trasladar clientes SIIGO anteriores al maestro compartido sin borrar origen."""
from collections import defaultdict
from datetime import datetime
import re
import unicodedata

from alembic import op
import sqlalchemy as sa

revision = '20260913_043'
down_revision = '20260913_042'
branch_labels = None
depends_on = None


def clave(value):
    value = unicodedata.normalize('NFKD', str(value or '').split('-', 1)[0].upper())
    return re.sub('[^A-Z0-9]', '', value)


def upgrade():
    bind = op.get_bind()
    if not sa.inspect(bind).has_table('siigo_clientes'):
        return
    metadata = sa.MetaData()
    origen = sa.Table('siigo_clientes', metadata, autoload_with=bind)
    maestro = sa.Table('clientes_comerciales', metadata, autoload_with=bind)
    existentes = {clave(c['nit']): dict(c) for c in bind.execute(sa.select(maestro)).mappings() if clave(c['nit'])}
    grupos = defaultdict(list)
    for row in bind.execute(sa.select(origen).order_by(origen.c.id)).mappings():
        if not clave(row['identificacion']) or not str(row['nombre'] or '').strip():
            raise ValueError('Cliente SIIGO sin identificación o nombre: revise la tabla de origen antes de migrar.')
        grupos[clave(row['identificacion'])].append(dict(row))
    for nit, filas in grupos.items():
        fuente = filas[0]
        actual = existentes.get(nit)
        nombres = list(dict.fromkeys(f['nombre'] for f in filas))
        datos = dict(importado_siigo=True)
        campos = {'tipo_identificacion': 'tipo_identificacion', 'digito_verificacion': 'digito_verificacion',
                  'direccion': 'direccion', 'ciudad': 'ciudad', 'telefono_empresa': 'telefono', 'carga_id': 'carga_id'}
        for destino, campo in campos.items():
            if not actual or not actual.get(destino):
                datos[destino] = fuente[campo]
        datos['nombres_alternativos'] = list(dict.fromkeys((actual.get('nombres_alternativos') or [] if actual else []) + nombres))
        if actual:
            bind.execute(maestro.update().where(maestro.c.id == actual['id']).values(**datos))
        else:
            activo = any(str(f['estado'] or '').upper() != 'INACTIVO' for f in filas)
            datos.update(nit=nit, razon_social=fuente['nombre'][:200], sucursal=fuente['sucursal'] or '0',
                         estado_cliente='ACTIVO' if activo else 'INACTIVO', activo=activo,
                         condicion_comercial='EFECTIVO', medio_autorizacion='WHATSAPP', requiere_factura=False,
                         documentos_legales_completos=False, pagare_firmado=False, confirmado_administrativo=False,
                         created_at=fuente['created_at'] or datetime.utcnow(), updated_at=datetime.utcnow(),
                         revision_importacion='Recuperado de SIIGO anterior. Revisar vendedor y configuración comercial.')
            bind.execute(maestro.insert().values(**datos))


def downgrade():
    # Las fichas pueden tener atenciones, tarifas y nuevas relaciones: conservarlas.
    pass
