"""Maestro unico de clientes + contactos multiempresa + trazabilidad de importacion.

Solo cambios ESTRUCTURALES (tablas, columnas, indices unicos anti-duplicados y
triggers). La carga de datos reales se hace luego con el importador del Excel
(POST /contable/cargar-clientes), que agrupa por identificacion y evita duplicados.

Por eso esta migracion corre en segundos y no depende del volumen de datos, lo
que evita el timeout del pre-deploy que hacia fallar el despliegue.

Revision ID: 20260911_040
Revises: 20260911_039
"""
from alembic import op
import sqlalchemy as sa


revision = '20260911_040'
down_revision = '20260911_039'
branch_labels = None
depends_on = None


def _columnas(bind, tabla):
    return {c['name'] for c in sa.inspect(bind).get_columns(tabla)}


def _tablas(bind):
    return set(sa.inspect(bind).get_table_names())


def upgrade():
    bind = op.get_bind()

    # 1) El maestro puede quedar sin vendedor (se asigna al importar) y admite
    #    telefonos largos provenientes del Excel de SIIGO.
    op.alter_column('clientes_comerciales', 'vendedor_id', nullable=True)
    op.alter_column('clientes_comerciales', 'telefono_empresa', type_=sa.String(80))

    # 2) Campos adicionales del maestro (idempotente por si ya existen).
    cols = _columnas(bind, 'clientes_comerciales')
    nuevas = [
        sa.Column('tipo_identificacion', sa.String(30)),
        sa.Column('digito_verificacion', sa.String(10)),
        sa.Column('sucursal', sa.String(30), nullable=False, server_default='0'),
        sa.Column('regimen_iva', sa.String(80)),
        sa.Column('importado_siigo', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('carga_id', sa.Integer(), sa.ForeignKey('siigo_cargas.id')),
        sa.Column('vendedor_nombre_origen', sa.String(200)),
        sa.Column('responsable', sa.String(200)),
        sa.Column('telefono_responsable', sa.String(80)),
        sa.Column('nombres_alternativos', sa.JSON()),
        sa.Column('revision_importacion', sa.Text()),
    ]
    for columna in nuevas:
        if columna.name not in cols:
            op.add_column('clientes_comerciales', columna)
    if 'ix_clientes_comerciales_carga_id' not in {i['name'] for i in sa.inspect(bind).get_indexes('clientes_comerciales')}:
        op.create_index('ix_clientes_comerciales_carga_id', 'clientes_comerciales', ['carga_id'])

    tablas = _tablas(bind)

    # 3) Tabla de contactos (un contacto puede manejar varias empresas).
    if 'contactos_clientes' not in tablas:
        op.create_table(
            'contactos_clientes',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('vendedor_id', sa.Integer(), sa.ForeignKey('vendedores.id')),
            sa.Column('nombre', sa.String(150), nullable=False),
            sa.Column('telefono', sa.String(80)),
            sa.Column('email', sa.String(120)),
            sa.Column('cargo', sa.String(150)),
            sa.Column('clave', sa.String(400), nullable=False, unique=True),
            sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
        )
        op.create_index('ix_contactos_clientes_vendedor_id', 'contactos_clientes', ['vendedor_id'])

    # 4) Puente cliente <-> contacto (multiempresa).
    if 'clientes_contactos' not in tablas:
        op.create_table(
            'clientes_contactos',
            sa.Column('cliente_id', sa.Integer(), sa.ForeignKey('clientes_comerciales.id'), primary_key=True),
            sa.Column('contacto_id', sa.Integer(), sa.ForeignKey('contactos_clientes.id'), primary_key=True),
        )

    # 5) Filas de origen para auditar la importacion sin perder datos.
    if 'clientes_importacion_filas' not in tablas:
        op.create_table(
            'clientes_importacion_filas',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('carga_id', sa.Integer(), sa.ForeignKey('siigo_cargas.id'), nullable=False),
            sa.Column('numero_fila', sa.Integer(), nullable=False),
            sa.Column('cliente_id', sa.Integer(), sa.ForeignKey('clientes_comerciales.id'), nullable=False),
            sa.Column('datos', sa.JSON(), nullable=False),
            sa.UniqueConstraint('carga_id', 'numero_fila', name='uq_cliente_fila_origen'),
        )
        op.create_index('ix_clientes_importacion_filas_cliente_id', 'clientes_importacion_filas', ['cliente_id'])

    # 6) Indices unicos anti-duplicados: un cliente por identificacion normalizada
    #    y un paquete por nombre normalizado (protege aunque el codigo falle).
    op.execute("DROP INDEX IF EXISTS uq_cliente_identificacion_normalizada")
    op.execute(
        "CREATE UNIQUE INDEX uq_cliente_identificacion_normalizada "
        "ON clientes_comerciales ((upper(regexp_replace(split_part(nit, '-', 1), '[^a-zA-Z0-9]', '', 'g')))) "
        "WHERE nit IS NOT NULL AND nit <> ''"
    )
    op.execute("DROP INDEX IF EXISTS uq_paquete_nombre_normalizado")
    op.execute(
        "CREATE UNIQUE INDEX uq_paquete_nombre_normalizado "
        "ON comercial_catalogo_items ((regexp_replace(upper(translate(nombre, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN')), '[^A-Z0-9]', '', 'g'))) "
        "WHERE tipo_item = 'PAQUETE'"
    )

    # 7) Triggers: contacto y sus empresas deben compartir el mismo vendedor.
    op.execute("DROP TRIGGER IF EXISTS contacto_cliente_vendedor ON clientes_contactos")
    op.execute("DROP TRIGGER IF EXISTS cliente_cambio_vendedor ON clientes_comerciales")
    op.execute("DROP TRIGGER IF EXISTS contacto_cambio_vendedor ON contactos_clientes")
    op.execute("DROP FUNCTION IF EXISTS validar_contacto_vendedor()")
    op.execute("""
    CREATE FUNCTION validar_contacto_vendedor() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_TABLE_NAME = 'clientes_contactos' THEN
        PERFORM 1 FROM clientes_comerciales WHERE id=NEW.cliente_id FOR UPDATE;
        PERFORM 1 FROM contactos_clientes WHERE id=NEW.contacto_id FOR UPDATE;
        IF EXISTS (SELECT 1 FROM clientes_comerciales c, contactos_clientes p
                   WHERE c.id=NEW.cliente_id AND p.id=NEW.contacto_id
                   AND c.vendedor_id IS DISTINCT FROM p.vendedor_id) THEN
          RAISE EXCEPTION 'El contacto y sus empresas deben tener el mismo vendedor';
        END IF;
        IF (SELECT vendedor_id FROM contactos_clientes WHERE id=NEW.contacto_id) IS NULL
           AND EXISTS (SELECT 1 FROM clientes_contactos WHERE contacto_id=NEW.contacto_id AND cliente_id<>NEW.cliente_id) THEN
          RAISE EXCEPTION 'Asigne vendedor antes de compartir el contacto';
        END IF;
      ELSIF TG_TABLE_NAME = 'clientes_comerciales' THEN
        IF EXISTS (SELECT 1 FROM clientes_contactos r JOIN contactos_clientes p ON p.id=r.contacto_id
                   WHERE r.cliente_id=NEW.id AND p.vendedor_id IS DISTINCT FROM NEW.vendedor_id) THEN
          RAISE EXCEPTION 'Desvincule los contactos antes de cambiar el vendedor del cliente';
        END IF;
      ELSE
        IF EXISTS (SELECT 1 FROM clientes_contactos r JOIN clientes_comerciales c ON c.id=r.cliente_id
                   WHERE r.contacto_id=NEW.id AND c.vendedor_id IS DISTINCT FROM NEW.vendedor_id) THEN
          RAISE EXCEPTION 'El contacto y sus empresas deben tener el mismo vendedor';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER contacto_cliente_vendedor BEFORE INSERT OR UPDATE ON clientes_contactos
      FOR EACH ROW EXECUTE FUNCTION validar_contacto_vendedor();
    CREATE TRIGGER cliente_cambio_vendedor BEFORE UPDATE OF vendedor_id ON clientes_comerciales
      FOR EACH ROW EXECUTE FUNCTION validar_contacto_vendedor();
    CREATE TRIGGER contacto_cambio_vendedor BEFORE UPDATE OF vendedor_id ON contactos_clientes
      FOR EACH ROW EXECUTE FUNCTION validar_contacto_vendedor();
    """)


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS contacto_cliente_vendedor ON clientes_contactos")
    op.execute("DROP TRIGGER IF EXISTS cliente_cambio_vendedor ON clientes_comerciales")
    op.execute("DROP TRIGGER IF EXISTS contacto_cambio_vendedor ON contactos_clientes")
    op.execute("DROP FUNCTION IF EXISTS validar_contacto_vendedor()")
    op.execute("DROP INDEX IF EXISTS uq_paquete_nombre_normalizado")
    op.execute("DROP INDEX IF EXISTS uq_cliente_identificacion_normalizada")
    for tabla in ('clientes_importacion_filas', 'clientes_contactos', 'contactos_clientes'):
        op.execute(f'DROP TABLE IF EXISTS {tabla} CASCADE')
    for columna in ('revision_importacion', 'nombres_alternativos', 'telefono_responsable', 'responsable',
                    'vendedor_nombre_origen', 'carga_id', 'importado_siigo', 'regimen_iva',
                    'sucursal', 'digito_verificacion', 'tipo_identificacion'):
        op.execute(f'ALTER TABLE clientes_comerciales DROP COLUMN IF EXISTS {columna}')
