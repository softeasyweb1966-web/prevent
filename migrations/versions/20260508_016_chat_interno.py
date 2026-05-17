"""agrega modulo de chat interno

Revision ID: 20260508_016
Revises: 20260427_015
Create Date: 2026-05-08 11:20:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260508_016'
down_revision = '20260427_015'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'chat_conversaciones',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tipo', sa.String(length=20), nullable=False),
        sa.Column('titulo', sa.String(length=200), nullable=True),
        sa.Column('direct_key', sa.String(length=50), nullable=True),
        sa.Column('creada_por_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['creada_por_id'], ['usuarios.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('direct_key'),
    )
    op.create_index(op.f('ix_chat_conversaciones_tipo'), 'chat_conversaciones', ['tipo'], unique=False)
    op.create_index(op.f('ix_chat_conversaciones_direct_key'), 'chat_conversaciones', ['direct_key'], unique=False)
    op.create_index(op.f('ix_chat_conversaciones_creada_por_id'), 'chat_conversaciones', ['creada_por_id'], unique=False)
    op.create_index(op.f('ix_chat_conversaciones_updated_at'), 'chat_conversaciones', ['updated_at'], unique=False)

    op.create_table(
        'chat_participantes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('conversacion_id', sa.Integer(), nullable=False),
        sa.Column('usuario_id', sa.Integer(), nullable=False),
        sa.Column('ultimo_leido_at', sa.DateTime(), nullable=True),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['conversacion_id'], ['chat_conversaciones.id']),
        sa.ForeignKeyConstraint(['usuario_id'], ['usuarios.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('conversacion_id', 'usuario_id', name='uq_chat_participante_conversacion_usuario'),
    )
    op.create_index(op.f('ix_chat_participantes_conversacion_id'), 'chat_participantes', ['conversacion_id'], unique=False)
    op.create_index(op.f('ix_chat_participantes_usuario_id'), 'chat_participantes', ['usuario_id'], unique=False)

    op.create_table(
        'chat_mensajes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('conversacion_id', sa.Integer(), nullable=False),
        sa.Column('remitente_id', sa.Integer(), nullable=False),
        sa.Column('contenido', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['conversacion_id'], ['chat_conversaciones.id']),
        sa.ForeignKeyConstraint(['remitente_id'], ['usuarios.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_chat_mensajes_conversacion_id'), 'chat_mensajes', ['conversacion_id'], unique=False)
    op.create_index(op.f('ix_chat_mensajes_remitente_id'), 'chat_mensajes', ['remitente_id'], unique=False)
    op.create_index(op.f('ix_chat_mensajes_created_at'), 'chat_mensajes', ['created_at'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_chat_mensajes_created_at'), table_name='chat_mensajes')
    op.drop_index(op.f('ix_chat_mensajes_remitente_id'), table_name='chat_mensajes')
    op.drop_index(op.f('ix_chat_mensajes_conversacion_id'), table_name='chat_mensajes')
    op.drop_table('chat_mensajes')

    op.drop_index(op.f('ix_chat_participantes_usuario_id'), table_name='chat_participantes')
    op.drop_index(op.f('ix_chat_participantes_conversacion_id'), table_name='chat_participantes')
    op.drop_table('chat_participantes')

    op.drop_index(op.f('ix_chat_conversaciones_updated_at'), table_name='chat_conversaciones')
    op.drop_index(op.f('ix_chat_conversaciones_creada_por_id'), table_name='chat_conversaciones')
    op.drop_index(op.f('ix_chat_conversaciones_direct_key'), table_name='chat_conversaciones')
    op.drop_index(op.f('ix_chat_conversaciones_tipo'), table_name='chat_conversaciones')
    op.drop_table('chat_conversaciones')
