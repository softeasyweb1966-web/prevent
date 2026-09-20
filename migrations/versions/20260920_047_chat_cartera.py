"""Chat interno de cartera entre administradores y vendedores."""
from alembic import op
import sqlalchemy as sa

revision = '20260920_047'
down_revision = '20260920_046'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'chat_cartera_hilos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tipo', sa.String(length=40), nullable=False),
        sa.Column('estado', sa.String(length=30), nullable=False, server_default='ABIERTO'),
        sa.Column('asunto', sa.String(length=200), nullable=False),
        sa.Column('cliente_id', sa.Integer(), nullable=True),
        sa.Column('identificacion', sa.String(length=50), nullable=True),
        sa.Column('cliente_nombre', sa.String(length=255), nullable=True),
        sa.Column('vendedor_id', sa.Integer(), nullable=False),
        sa.Column('creado_por_id', sa.Integer(), nullable=False),
        sa.Column('autorizado_por_id', sa.Integer(), nullable=True),
        sa.Column('autorizado_at', sa.DateTime(), nullable=True),
        sa.Column('cerrado_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['autorizado_por_id'], ['usuarios.id']),
        sa.ForeignKeyConstraint(['cliente_id'], ['clientes_comerciales.id']),
        sa.ForeignKeyConstraint(['creado_por_id'], ['usuarios.id']),
        sa.ForeignKeyConstraint(['vendedor_id'], ['vendedores.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_chat_cartera_hilos_tipo'), 'chat_cartera_hilos', ['tipo'], unique=False)
    op.create_index(op.f('ix_chat_cartera_hilos_estado'), 'chat_cartera_hilos', ['estado'], unique=False)
    op.create_index(op.f('ix_chat_cartera_hilos_cliente_id'), 'chat_cartera_hilos', ['cliente_id'], unique=False)
    op.create_index(op.f('ix_chat_cartera_hilos_identificacion'), 'chat_cartera_hilos', ['identificacion'], unique=False)
    op.create_index(op.f('ix_chat_cartera_hilos_vendedor_id'), 'chat_cartera_hilos', ['vendedor_id'], unique=False)
    op.create_index(op.f('ix_chat_cartera_hilos_creado_por_id'), 'chat_cartera_hilos', ['creado_por_id'], unique=False)

    op.create_table(
        'chat_cartera_mensajes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('hilo_id', sa.Integer(), nullable=False),
        sa.Column('remitente_id', sa.Integer(), nullable=False),
        sa.Column('remitente_nombre', sa.String(length=200), nullable=False),
        sa.Column('mensaje', sa.Text(), nullable=False),
        sa.Column('decision', sa.String(length=30), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['hilo_id'], ['chat_cartera_hilos.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['remitente_id'], ['usuarios.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_chat_cartera_mensajes_hilo_id'), 'chat_cartera_mensajes', ['hilo_id'], unique=False)
    op.create_index(op.f('ix_chat_cartera_mensajes_remitente_id'), 'chat_cartera_mensajes', ['remitente_id'], unique=False)
    op.create_index(op.f('ix_chat_cartera_mensajes_decision'), 'chat_cartera_mensajes', ['decision'], unique=False)
    op.create_index(op.f('ix_chat_cartera_mensajes_created_at'), 'chat_cartera_mensajes', ['created_at'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_chat_cartera_mensajes_created_at'), table_name='chat_cartera_mensajes')
    op.drop_index(op.f('ix_chat_cartera_mensajes_decision'), table_name='chat_cartera_mensajes')
    op.drop_index(op.f('ix_chat_cartera_mensajes_remitente_id'), table_name='chat_cartera_mensajes')
    op.drop_index(op.f('ix_chat_cartera_mensajes_hilo_id'), table_name='chat_cartera_mensajes')
    op.drop_table('chat_cartera_mensajes')
    op.drop_index(op.f('ix_chat_cartera_hilos_creado_por_id'), table_name='chat_cartera_hilos')
    op.drop_index(op.f('ix_chat_cartera_hilos_vendedor_id'), table_name='chat_cartera_hilos')
    op.drop_index(op.f('ix_chat_cartera_hilos_identificacion'), table_name='chat_cartera_hilos')
    op.drop_index(op.f('ix_chat_cartera_hilos_cliente_id'), table_name='chat_cartera_hilos')
    op.drop_index(op.f('ix_chat_cartera_hilos_estado'), table_name='chat_cartera_hilos')
    op.drop_index(op.f('ix_chat_cartera_hilos_tipo'), table_name='chat_cartera_hilos')
    op.drop_table('chat_cartera_hilos')
