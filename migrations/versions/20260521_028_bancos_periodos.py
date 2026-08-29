"""Crea tabla bancos_periodos - Control de periodos mensuales de Bancos

Revision ID: 20260521_028
Revises: 20260520_027
Create Date: 2026-05-21 00:00:00
"""

from alembic import op
import sqlalchemy as sa

revision      = '20260521_028'
down_revision = '20260520_027'
branch_labels = None
depends_on    = None


def upgrade():
    op.create_table(
        'bancos_periodos',
        sa.Column('id',                 sa.Integer(),  nullable=False),
        sa.Column('mes',                sa.Integer(),  nullable=False),
        sa.Column('anio',               sa.Integer(),  nullable=False),
        sa.Column('en_proceso',         sa.Boolean(),  nullable=True, server_default='false'),
        sa.Column('finalizado',         sa.Boolean(),  nullable=True, server_default='false'),
        sa.Column('fecha_inicio',       sa.DateTime(), nullable=True),
        sa.Column('fecha_finalizacion', sa.DateTime(), nullable=True),
        sa.Column('created_at',         sa.DateTime(), nullable=True),
        sa.Column('updated_at',         sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('mes', 'anio', name='uq_bancos_periodo_mes_anio'),
    )
    op.create_index('ix_bancos_periodos_mes_anio',    'bancos_periodos', ['mes', 'anio'])
    op.create_index('ix_bancos_periodos_en_proceso',  'bancos_periodos', ['en_proceso'])
    op.create_index('ix_bancos_periodos_finalizado',  'bancos_periodos', ['finalizado'])


def downgrade():
    op.drop_table('bancos_periodos')
