"""estructura laboral y trazabilidad de empleados

Revision ID: 20260324_001
Revises:
Create Date: 2026-03-24 23:55:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260324_001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('empleados', schema=None) as batch_op:
        batch_op.add_column(sa.Column('estado_laboral', sa.String(length=30), nullable=True, server_default='ACTIVO'))
        batch_op.create_index(batch_op.f('ix_empleados_estado_laboral'), ['estado_laboral'], unique=False)

    op.create_table(
        'areas',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nombre', sa.String(length=150), nullable=False),
        sa.Column('descripcion', sa.Text(), nullable=True),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('nombre')
    )
    op.create_index(op.f('ix_areas_nombre'), 'areas', ['nombre'], unique=True)

    op.create_table(
        'cargos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nombre', sa.String(length=150), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=True),
        sa.Column('descripcion', sa.Text(), nullable=True),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['area_id'], ['areas.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_cargos_nombre'), 'cargos', ['nombre'], unique=False)

    op.create_table(
        'empleado_asignaciones_laborales',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('empleado_id', sa.Integer(), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=True),
        sa.Column('cargo_id', sa.Integer(), nullable=True),
        sa.Column('fecha_inicio', sa.DateTime(), nullable=False),
        sa.Column('fecha_fin', sa.DateTime(), nullable=True),
        sa.Column('motivo', sa.String(length=255), nullable=True),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['area_id'], ['areas.id']),
        sa.ForeignKeyConstraint(['cargo_id'], ['cargos.id']),
        sa.ForeignKeyConstraint(['empleado_id'], ['empleados.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_empleado_asignaciones_laborales_empleado_id'), 'empleado_asignaciones_laborales', ['empleado_id'], unique=False)

    op.create_table(
        'empleado_movimientos_laborales',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('empleado_id', sa.Integer(), nullable=False),
        sa.Column('tipo_movimiento', sa.String(length=40), nullable=False),
        sa.Column('fecha_movimiento', sa.DateTime(), nullable=False),
        sa.Column('motivo', sa.String(length=255), nullable=False),
        sa.Column('observacion', sa.Text(), nullable=True),
        sa.Column('estado_anterior', sa.String(length=30), nullable=True),
        sa.Column('estado_nuevo', sa.String(length=30), nullable=True),
        sa.Column('area_id', sa.Integer(), nullable=True),
        sa.Column('cargo_id', sa.Integer(), nullable=True),
        sa.Column('usuario_responsable', sa.String(length=120), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['area_id'], ['areas.id']),
        sa.ForeignKeyConstraint(['cargo_id'], ['cargos.id']),
        sa.ForeignKeyConstraint(['empleado_id'], ['empleados.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_empleado_movimientos_laborales_empleado_id'), 'empleado_movimientos_laborales', ['empleado_id'], unique=False)
    op.create_index(op.f('ix_empleado_movimientos_laborales_tipo_movimiento'), 'empleado_movimientos_laborales', ['tipo_movimiento'], unique=False)

    op.execute("""
        UPDATE empleados
        SET estado_laboral = CASE
            WHEN activo THEN 'ACTIVO'
            ELSE 'RETIRADO'
        END
        WHERE estado_laboral IS NULL OR estado_laboral = '';
    """)

    op.execute("""
        INSERT INTO cargos (nombre, area_id, descripcion, activo, created_at, updated_at)
        SELECT DISTINCT
            TRIM(cargo),
            CAST(NULL AS INTEGER),
            'Cargo migrado desde empleados',
            TRUE,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        FROM empleados
        WHERE cargo IS NOT NULL AND TRIM(cargo) <> '';
    """)

    op.execute("""
        INSERT INTO empleado_asignaciones_laborales
            (empleado_id, area_id, cargo_id, fecha_inicio, fecha_fin, motivo, activo, created_at, updated_at)
        SELECT
            e.id,
            CAST(NULL AS INTEGER),
            c.id,
            e.fecha_inicio,
            e.fecha_retiro,
            'MIGRACION_INICIAL',
            CASE WHEN e.estado_laboral = 'ACTIVO' THEN TRUE ELSE FALSE END,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        FROM empleados e
        LEFT JOIN cargos c ON c.nombre = e.cargo
        WHERE e.fecha_inicio IS NOT NULL;
    """)

    op.execute("""
        INSERT INTO empleado_movimientos_laborales
            (empleado_id, tipo_movimiento, fecha_movimiento, motivo, observacion, estado_anterior, estado_nuevo, area_id, cargo_id, usuario_responsable, created_at)
        SELECT
            e.id,
            'INGRESO',
            e.fecha_inicio,
            'MIGRACION_INGRESO',
            'Movimiento generado automaticamente durante migracion',
            CAST(NULL AS VARCHAR(30)),
            'ACTIVO',
            CAST(NULL AS INTEGER),
            c.id,
            'sistema',
            CURRENT_TIMESTAMP
        FROM empleados e
        LEFT JOIN cargos c ON c.nombre = e.cargo
        WHERE e.fecha_inicio IS NOT NULL;
    """)

    op.execute("""
        INSERT INTO empleado_movimientos_laborales
            (empleado_id, tipo_movimiento, fecha_movimiento, motivo, observacion, estado_anterior, estado_nuevo, area_id, cargo_id, usuario_responsable, created_at)
        SELECT
            e.id,
            'RETIRO',
            e.fecha_retiro,
            'MIGRACION_RETIRO',
            'Retiro historico reconstruido durante migracion',
            'ACTIVO',
            'RETIRADO',
            CAST(NULL AS INTEGER),
            c.id,
            'sistema',
            CURRENT_TIMESTAMP
        FROM empleados e
        LEFT JOIN cargos c ON c.nombre = e.cargo
        WHERE e.fecha_retiro IS NOT NULL;
    """)

    with op.batch_alter_table('empleados', schema=None) as batch_op:
        batch_op.alter_column('estado_laboral', existing_type=sa.String(length=30), nullable=False, server_default='ACTIVO')


def downgrade():
    op.drop_index(op.f('ix_empleado_movimientos_laborales_tipo_movimiento'), table_name='empleado_movimientos_laborales')
    op.drop_index(op.f('ix_empleado_movimientos_laborales_empleado_id'), table_name='empleado_movimientos_laborales')
    op.drop_table('empleado_movimientos_laborales')

    op.drop_index(op.f('ix_empleado_asignaciones_laborales_empleado_id'), table_name='empleado_asignaciones_laborales')
    op.drop_table('empleado_asignaciones_laborales')

    op.drop_index(op.f('ix_cargos_nombre'), table_name='cargos')
    op.drop_table('cargos')

    op.drop_index(op.f('ix_areas_nombre'), table_name='areas')
    op.drop_table('areas')

    with op.batch_alter_table('empleados', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_empleados_estado_laboral'))
        batch_op.drop_column('estado_laboral')

