"""Maestro único de clientes y contactos compartidos por vendedor.

Revision ID: 20260911_040
Revises: 20260911_039
"""
from alembic import op
import sqlalchemy as sa

revision = '20260911_040'
down_revision = '20260911_039'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('clientes_comerciales', 'vendedor_id', nullable=True)
    op.alter_column('clientes_comerciales', 'telefono_empresa', type_=sa.String(80))
    for column in [
        sa.Column('tipo_identificacion', sa.String(30)),
        sa.Column('digito_verificacion', sa.String(10)),
        sa.Column('sucursal', sa.String(30), nullable=False, server_default='0'),
        sa.Column('regimen_iva', sa.String(80)),
        sa.Column('importado_siigo', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('carga_id', sa.Integer(), sa.ForeignKey('siigo_cargas.id')),
        sa.Column('vendedor_nombre_origen', sa.String(200)),
        sa.Column('nombres_alternativos', sa.JSON()),
        sa.Column('revision_importacion', sa.Text()),
    ]:
        op.add_column('clientes_comerciales', column)
    op.create_index('ix_clientes_comerciales_carga_id', 'clientes_comerciales', ['carga_id'])
    op.create_table('contactos_clientes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('vendedor_id', sa.Integer(), sa.ForeignKey('vendedores.id')),
        sa.Column('nombre', sa.String(150), nullable=False),
        sa.Column('telefono', sa.String(80)), sa.Column('email', sa.String(120)),
        sa.Column('cargo', sa.String(150)),
        sa.Column('clave', sa.String(400), nullable=False, unique=True),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_index('ix_contactos_clientes_vendedor_id', 'contactos_clientes', ['vendedor_id'])
    op.create_table('clientes_contactos',
        sa.Column('cliente_id', sa.Integer(), sa.ForeignKey('clientes_comerciales.id'), primary_key=True),
        sa.Column('contacto_id', sa.Integer(), sa.ForeignKey('contactos_clientes.id'), primary_key=True))
    op.create_table('clientes_importacion_filas',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('carga_id', sa.Integer(), sa.ForeignKey('siigo_cargas.id'), nullable=False),
        sa.Column('numero_fila', sa.Integer(), nullable=False),
        sa.Column('cliente_id', sa.Integer(), sa.ForeignKey('clientes_comerciales.id'), nullable=False),
        sa.Column('datos', sa.JSON(), nullable=False),
        sa.UniqueConstraint('carga_id', 'numero_fila', name='uq_cliente_fila_origen'))
    op.create_index('ix_clientes_importacion_filas_cliente_id', 'clientes_importacion_filas', ['cliente_id'])

    # Conserva identificadores comerciales y todas las filas de procedencia SIIGO.
    conn = op.get_bind()
    meta = sa.MetaData()
    clientes = sa.Table('clientes_comerciales', meta, autoload_with=conn)
    origen = sa.Table('siigo_clientes', meta, autoload_with=conn)
    filas = sa.Table('clientes_importacion_filas', meta, autoload_with=conn)
    for row in conn.execute(sa.select(origen).order_by(origen.c.id)).mappings():
        cid = conn.execute(sa.select(clientes.c.id).where(clientes.c.nit == row['identificacion'])).scalar()
        values = dict(tipo_identificacion=row['tipo_identificacion'], digito_verificacion=row['digito_verificacion'],
                      importado_siigo=True, carga_id=row['carga_id'])
        if cid is None:
            values.update(nit=row['identificacion'], razon_social=row['nombre'], sucursal=row['sucursal'],
                          direccion=row['direccion'], ciudad=row['ciudad'], telefono_empresa=row['telefono'],
                          estado_cliente='ACTIVO', condicion_comercial='EFECTIVO', requiere_factura=False,
                          documentos_legales_completos=False, confirmado_administrativo=False,
                          pagare_firmado=False, activo=True)
            cid = conn.execute(clientes.insert().values(**values).returning(clientes.c.id)).scalar_one()
        else:
            conn.execute(clientes.update().where(clientes.c.id == cid).values(**values))
        raw = {k: (v.isoformat() if hasattr(v, 'isoformat') else v) for k, v in row.items()}
        conn.execute(filas.insert().values(carga_id=row['carga_id'], numero_fila=-row['id'], cliente_id=cid, datos=raw))
    op.drop_table('siigo_clientes')
    op.execute("CREATE UNIQUE INDEX uq_cliente_identificacion_normalizada ON clientes_comerciales ((upper(regexp_replace(split_part(nit, '-', 1), '[^a-zA-Z0-9]', '', 'g')))) WHERE nit IS NOT NULL AND nit <> ''")
    op.execute("CREATE UNIQUE INDEX uq_paquete_nombre_normalizado ON comercial_catalogo_items ((regexp_replace(upper(translate(nombre, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN')), '[^A-Z0-9]', '', 'g'))) WHERE tipo_item = 'PAQUETE'")

    # Las dos direcciones de edición deben respetar vendedor/contacto.
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
    raise RuntimeError('La consolidación conserva historial: restaure el respaldo para revertirla.')
