"""Crea pedidos de optometria con adjuntos persistentes."""
from alembic import op
import sqlalchemy as sa

revision = '20261026_060'
down_revision = '20261019_059'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('optometria_pedidos',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('cliente', sa.String(200), nullable=False), sa.Column('nombre_paciente', sa.String(200), nullable=False),
        sa.Column('cedula_paciente', sa.String(50), nullable=False), sa.Column('celular_paciente', sa.String(50)),
        sa.Column('telefono_paciente', sa.String(50)), sa.Column('nro_cuotas', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('valor_cuota', sa.Numeric(15,2), nullable=False, server_default='0'), sa.Column('total_venta', sa.Numeric(15,2), nullable=False, server_default='0'),
        sa.Column('estado_paciente', sa.String(30), nullable=False, server_default='PENDIENTE'), sa.Column('estado_gafas', sa.String(30), nullable=False, server_default='PENDIENTE'), sa.Column('estado_empresa', sa.String(30), nullable=False, server_default='PENDIENTE_COBRO'),
        sa.Column('trabajo_realizar', sa.Text()), sa.Column('autorizacion_nombre', sa.String(255)), sa.Column('autorizacion_mime', sa.String(120)), sa.Column('autorizacion_archivo', sa.LargeBinary()),
        sa.Column('formula_nombre', sa.String(255)), sa.Column('formula_mime', sa.String(120)), sa.Column('formula_archivo', sa.LargeBinary()),
        sa.Column('descripcion_marco', sa.Text()), sa.Column('marco_nombre', sa.String(255)), sa.Column('marco_mime', sa.String(120)), sa.Column('marco_archivo', sa.LargeBinary()),
        sa.Column('observaciones', sa.Text()), sa.Column('created_at', sa.DateTime(), nullable=False), sa.Column('updated_at', sa.DateTime()))
    op.create_index('ix_optometria_pedidos_cliente', 'optometria_pedidos', ['cliente'])
    op.create_index('ix_optometria_pedidos_nombre_paciente', 'optometria_pedidos', ['nombre_paciente'])
    op.create_index('ix_optometria_pedidos_cedula_paciente', 'optometria_pedidos', ['cedula_paciente'])

def downgrade():
    op.drop_table('optometria_pedidos')
