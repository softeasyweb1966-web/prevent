import logging
import secrets
from datetime import datetime

from flask import jsonify, request
from flask_login import current_user, login_required
from werkzeug.security import generate_password_hash

from app.models import AuditLog, Permiso, Role, Usuario, db
from app.routes import usuarios_bp
from app.security import (
    MENU_OPTION_DEFINITIONS,
    ROLE_PERMISSION_DEFINITIONS,
    get_allowed_menu_modules_for_role,
    get_permission_names_for_role,
    get_permission_names_for_user,
    sort_menu_permission_records,
    sort_role_permission_records,
)

logger = logging.getLogger(__name__)


def is_admin():
    """Verificar si usuario actual es administrador o superusuario EASY."""
    if getattr(current_user, 'is_easy', False):
        return True
    return current_user.role and current_user.role.nombre == 'Administrador'


def is_easy_user(usuario=None):
    """Verificar si un usuario es el superusuario EASY."""
    target = usuario if usuario is not None else current_user
    return bool(getattr(target, 'is_easy', False))


def _forbidden_admin_only():
    return jsonify({'error': 'No tienes permiso para administrar usuarios y roles'}), 403


def _normalize_optional_text(value):
    value = (value or '').strip()
    return value or None


def _generate_temporary_password(length=10):
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    size = max(8, int(length or 10))
    return ''.join(secrets.choice(alphabet) for _ in range(size))


def _create_audit_log(tabla, registro_id, accion, datos_anteriores=None, datos_nuevos=None):
    db.session.add(AuditLog(
        usuario_id=getattr(current_user, 'id', None),
        tabla=tabla,
        registro_id=registro_id,
        accion=accion,
        datos_anteriores=datos_anteriores,
        datos_nuevos=datos_nuevos,
        ip_address=request.remote_addr,
    ))


def _serialize_menu_option(definition, permiso=None):
    return {
        'permiso_id': permiso.id if permiso else None,
        'permiso_nombre': definition['permiso'],
        'module': definition['module'],
        'category': definition.get('category', 'menu'),
        'group': definition.get('group') or definition.get('nombre'),
        'entity': definition.get('entity'),
        'action': definition.get('action'),
        'section': definition.get('section'),
        'permission_names': definition.get('permission_names'),
        'nombre': definition['nombre'],
        'descripcion': definition['descripcion'],
        'orden': definition['orden'],
    }


def _serialize_role(role):
    permisos_ordenados = sort_role_permission_records(role.permisos)
    menu_modules = get_allowed_menu_modules_for_role(role)
    menu_permission_names = {definition['permiso'] for definition in MENU_OPTION_DEFINITIONS}
    return {
        'id': role.id,
        'nombre': role.nombre,
        'descripcion': role.descripcion,
        'cantidad_usuarios': role.usuarios.count(),
        'menu_modules': menu_modules,
        'menu_permission_ids': [permiso.id for permiso in permisos_ordenados],
        'permission_ids': [permiso.id for permiso in permisos_ordenados],
        'permission_names': [permiso.nombre for permiso in permisos_ordenados],
        'menu_permissions': [
            _serialize_menu_option(definition, permiso)
            for permiso in permisos_ordenados
            for definition in ROLE_PERMISSION_DEFINITIONS
            if definition['permiso'] == permiso.nombre and permiso.nombre in menu_permission_names
        ],
        'permissions': [
            _serialize_menu_option(definition, permiso)
            for permiso in permisos_ordenados
            for definition in ROLE_PERMISSION_DEFINITIONS
            if definition['permiso'] == permiso.nombre
        ],
        'created_at': role.created_at.strftime('%Y-%m-%d %H:%M:%S') if role.created_at else None,
        'updated_at': role.updated_at.strftime('%Y-%m-%d %H:%M:%S') if role.updated_at else None,
    }


def _serialize_user(usuario):
    extra_perm_ids = [p.id for p in getattr(usuario, 'permisos_extra', [])]
    extra_perm_names = [p.nombre for p in getattr(usuario, 'permisos_extra', []) if p.nombre]
    return {
        'id': usuario.id,
        'usuario': usuario.usuario,
        'nombre_completo': usuario.nombre_completo,
        'email': usuario.email,
        'role': usuario.role.nombre if usuario.role else None,
        'role_id': usuario.role_id,
        'is_easy': bool(getattr(usuario, 'is_easy', False)),
        'permisos_extra_ids': extra_perm_ids,
        'permisos_extra_nombres': extra_perm_names,
        'menu_modules': get_allowed_menu_modules_for_role(usuario.role),
        'permission_names': sorted(get_permission_names_for_user(usuario)),
        'activo': usuario.activo,
        'ultimo_acceso': usuario.ultimo_acceso.strftime('%Y-%m-%d %H:%M:%S') if usuario.ultimo_acceso else None,
        'created_at': usuario.created_at.strftime('%Y-%m-%d %H:%M:%S') if usuario.created_at else None,
        'updated_at': usuario.updated_at.strftime('%Y-%m-%d %H:%M:%S') if usuario.updated_at else None,
    }


def _get_role_by_id(role_id):
    try:
        role_id = int(role_id)
    except (TypeError, ValueError):
        raise ValueError('Debe seleccionar un rol válido')

    role = Role.query.get(role_id)
    if role is None:
        raise ValueError('Debe seleccionar un rol válido')
    return role


def _resolve_menu_permissions(permission_ids):
    valid_ids = []
    for raw_id in permission_ids or []:
        try:
            valid_ids.append(int(raw_id))
        except (TypeError, ValueError):
            continue

    if not valid_ids:
        raise ValueError('Debe seleccionar al menos una opción de menú para el rol')

    permisos = Permiso.query.filter(Permiso.id.in_(valid_ids)).all()
    if len(permisos) != len(set(valid_ids)):
        raise ValueError('Una o más opciones de menú seleccionadas no son válidas')

    valid_permission_names = {definition['permiso'] for definition in MENU_OPTION_DEFINITIONS}
    if any(permiso.nombre not in valid_permission_names for permiso in permisos):
        raise ValueError('Solo se permiten permisos asociados al menú lateral')

    return sort_menu_permission_records(permisos)


def _resolve_role_permissions(permission_ids):
    valid_ids = []
    valid_names = []
    for raw_id in permission_ids or []:
        try:
            valid_ids.append(int(raw_id))
        except (TypeError, ValueError):
            permission_name = str(raw_id or '').strip()
            if permission_name:
                valid_names.append(permission_name)

    if not valid_ids and not valid_names:
        raise ValueError('Debe seleccionar al menos un permiso para el rol')

    permisos = []
    if valid_ids:
        permisos.extend(Permiso.query.filter(Permiso.id.in_(valid_ids)).all())
    if valid_names:
        permisos.extend(Permiso.query.filter(Permiso.nombre.in_(valid_names)).all())

    if len({permiso.id for permiso in permisos}) != len(set(valid_ids)) + len(set(valid_names)):
        raise ValueError('Uno o mas permisos seleccionados no son validos')

    valid_permission_names = {definition['permiso'] for definition in ROLE_PERMISSION_DEFINITIONS}
    if any(permiso.nombre not in valid_permission_names for permiso in permisos):
        raise ValueError('Solo se permiten permisos definidos por el sistema')

    permission_names = {permiso.nombre for permiso in permisos}
    if 'menu_comercial' in permission_names:
        commercial_section_permissions = {
            definition['permiso']
            for definition in ROLE_PERMISSION_DEFINITIONS
            if definition.get('category') == 'comercial_section'
        }
        commercial_read_permissions = {
            'comercial_vendedores_read',
            'comercial_clientes_read',
            'comercial_examenes_read',
            'comercial_paquetes_read',
            'comercial_tarifas_read',
            'comercial_atenciones_read',
            'comercial_documentos_read',
            'comercial_pagos_read',
        }
        if not permission_names.intersection(commercial_read_permissions | commercial_section_permissions):
            raise ValueError('Si habilita el modulo comercial, seleccione al menos una subopcion')

    return sort_role_permission_records(permisos)


@usuarios_bp.route('/', methods=['GET'])
@login_required
def get_usuarios():
    """Obtener lista de usuarios."""
    if not is_admin():
        return _forbidden_admin_only()

    try:
        usuarios = Usuario.query.order_by(Usuario.activo.desc(), Usuario.usuario.asc()).all()
        # El usuario EASY no es visible para nadie excepto para sí mismo
        if not is_easy_user():
            usuarios = [u for u in usuarios if not is_easy_user(u)]
        return jsonify([_serialize_user(usuario) for usuario in usuarios]), 200
    except Exception as exc:
        logger.error("Error obteniendo usuarios: %s", exc)
        return jsonify({'error': 'Error al obtener usuarios'}), 500


@usuarios_bp.route('/', methods=['POST'])
@login_required
def crear_usuario():
    """Crear usuario del sistema."""
    if not is_admin():
        return _forbidden_admin_only()

    data = request.get_json() or {}

    try:
        usuario_login = (data.get('usuario') or '').strip()
        nombre_completo = (data.get('nombre_completo') or '').strip()
        email = (data.get('email') or '').strip().lower()
        password = data.get('password') or ''
        role_id = data.get('role_id')

        if not usuario_login:
            raise ValueError('El usuario es obligatorio')
        if not nombre_completo:
            raise ValueError('El nombre completo es obligatorio')
        if not email:
            raise ValueError('El email es obligatorio')
        if not password or len(password) < 6:
            raise ValueError('La contraseña debe tener al menos 6 caracteres')

        role = _get_role_by_id(role_id)

        if Usuario.query.filter_by(usuario=usuario_login).first():
            return jsonify({'error': 'Ya existe un usuario con ese login'}), 409

        if Usuario.query.filter_by(email=email).first():
            return jsonify({'error': 'Ya existe un usuario con ese email'}), 409

        usuario = Usuario(
            usuario=usuario_login,
            nombre_completo=nombre_completo,
            email=email,
            password_hash=generate_password_hash(password),
            role_id=role.id,
            activo=bool(data.get('activo', True)),
        )
        db.session.add(usuario)
        db.session.commit()
        logger.info("Usuario creado: %s", usuario.usuario)
        return jsonify({'mensaje': 'Usuario creado', 'id': usuario.id}), 201
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando usuario: %s", exc)
        return jsonify({'error': 'Error al crear usuario'}), 500


@usuarios_bp.route('/<int:usuario_id>', methods=['GET'])
@login_required
def get_usuario(usuario_id):
    """Obtener detalle de un usuario."""
    if not is_admin():
        return _forbidden_admin_only()

    try:
        usuario = Usuario.query.get_or_404(usuario_id)
        return jsonify(_serialize_user(usuario)), 200
    except Exception as exc:
        logger.error("Error obteniendo usuario: %s", exc)
        return jsonify({'error': 'Error al obtener usuario'}), 500


@usuarios_bp.route('/<int:usuario_id>', methods=['PUT'])
@login_required
def actualizar_usuario(usuario_id):
    """Actualizar usuario."""
    if not is_admin():
        return _forbidden_admin_only()

    data = request.get_json() or {}

    try:
        usuario = Usuario.query.get_or_404(usuario_id)

        # Solo el propio usuario EASY puede modificarse a sí mismo
        if is_easy_user(usuario) and not is_easy_user():
            return jsonify({'error': 'El usuario EASY solo puede ser modificado por sí mismo'}), 403
        usuario_login = (data.get('usuario') or usuario.usuario or '').strip()
        nombre_completo = (data.get('nombre_completo') or usuario.nombre_completo or '').strip()
        email = (data.get('email') or usuario.email or '').strip().lower()
        role = _get_role_by_id(data.get('role_id') or usuario.role_id)

        if not usuario_login:
            raise ValueError('El usuario es obligatorio')
        if not nombre_completo:
            raise ValueError('El nombre completo es obligatorio')
        if not email:
            raise ValueError('El email es obligatorio')

        existente_usuario = Usuario.query.filter(
            Usuario.usuario == usuario_login,
            Usuario.id != usuario_id,
        ).first()
        if existente_usuario:
            return jsonify({'error': 'Ya existe otro usuario con ese login'}), 409

        existente_email = Usuario.query.filter(
            Usuario.email == email,
            Usuario.id != usuario_id,
        ).first()
        if existente_email:
            return jsonify({'error': 'Ya existe otro usuario con ese email'}), 409

        usuario.usuario = usuario_login
        usuario.nombre_completo = nombre_completo
        usuario.email = email
        usuario.role_id = role.id
        usuario.activo = bool(data.get('activo', usuario.activo))

        nueva_password = data.get('password') or ''
        if nueva_password:
            if len(nueva_password) < 6:
                raise ValueError('La nueva contraseña debe tener al menos 6 caracteres')
            usuario.password_hash = generate_password_hash(nueva_password)

        if current_user.id == usuario.id and usuario.activo is False:
            raise ValueError('No puedes desactivar tu propio usuario')

        db.session.commit()
        logger.info("Usuario actualizado: %s", usuario.usuario)
        return jsonify({'mensaje': 'Usuario actualizado'}), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando usuario: %s", exc)
        return jsonify({'error': 'Error al actualizar usuario'}), 500


@usuarios_bp.route('/<int:usuario_id>', methods=['DELETE'])
@login_required
def eliminar_usuario(usuario_id):
    """Desactivar usuario del sistema."""
    if not is_admin():
        return _forbidden_admin_only()

    try:
        usuario = Usuario.query.get_or_404(usuario_id)
        if usuario.id == current_user.id:
            return jsonify({'error': 'No puedes desactivar tu propio usuario'}), 400
        if usuario.usuario == 'admin':
            return jsonify({'error': 'El usuario administrador principal no puede desactivarse'}), 400
        if is_easy_user(usuario):
            return jsonify({'error': 'El usuario EASY no puede ser eliminado ni desactivado'}), 403

        usuario.activo = False
        db.session.commit()
        logger.info("Usuario desactivado: %s", usuario.usuario)
        return jsonify({'mensaje': 'Usuario desactivado'}), 200
    except Exception as exc:
        db.session.rollback()
        logger.error("Error desactivando usuario: %s", exc)
        return jsonify({'error': 'Error al desactivar usuario'}), 500


@usuarios_bp.route('/<int:usuario_id>/cambiar-password', methods=['POST'])
@login_required
def cambiar_password(usuario_id):
    """Cambiar contraseña de usuario."""
    data = request.get_json() or {}

    try:
        usuario = Usuario.query.get_or_404(usuario_id)
        if current_user.id != usuario_id and not is_admin():
            return jsonify({'error': 'No tienes permiso'}), 403

        nueva_password = data.get('nueva_password') or ''
        if len(nueva_password) < 6:
            return jsonify({'error': 'La nueva contraseña debe tener al menos 6 caracteres'}), 400

        usuario.password_hash = generate_password_hash(nueva_password)
        db.session.commit()
        logger.info("Contraseña cambiada para usuario: %s", usuario.usuario)
        return jsonify({'mensaje': 'Contraseña actualizada'}), 200
    except Exception as exc:
        db.session.rollback()
        logger.error("Error cambiando password: %s", exc)
        return jsonify({'error': 'Error al cambiar contraseña'}), 500


@usuarios_bp.route('/<int:usuario_id>/reset-password', methods=['POST'])
@login_required
def reset_password_temporal(usuario_id):
    """Generar una nueva contrasena temporal para un usuario."""
    if not is_admin():
        return _forbidden_admin_only()

    try:
        usuario = Usuario.query.get_or_404(usuario_id)
        nueva_password = _generate_temporary_password()
        usuario.password_hash = generate_password_hash(nueva_password)

        _create_audit_log(
            tabla='usuarios',
            registro_id=usuario.id,
            accion='RESET_PASSWORD',
            datos_nuevos={
                'usuario': usuario.usuario,
                'motivo': 'Contrasena temporal generada por administrador',
            },
        )

        db.session.commit()
        logger.info("Contrasena temporal generada para usuario: %s", usuario.usuario)
        return jsonify({
            'mensaje': 'Contrasena temporal generada',
            'usuario': usuario.usuario,
            'password_temporal': nueva_password,
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.error("Error restableciendo password para usuario %s: %s", usuario_id, exc)
        return jsonify({'error': 'Error al restablecer la contrasena'}), 500


@usuarios_bp.route('/<int:usuario_id>/permisos-extra', methods=['GET'])
@login_required
def get_permisos_extra(usuario_id):
    """Obtener permisos adicionales asignados directamente a un usuario."""
    if not is_admin():
        return _forbidden_admin_only()
    try:
        usuario = Usuario.query.get_or_404(usuario_id)
        if is_easy_user(usuario) and not is_easy_user():
            return jsonify({'error': 'Sin acceso al usuario EASY'}), 403
        return jsonify({
            'usuario_id': usuario.id,
            'usuario': usuario.usuario,
            'permisos_extra': [
                {'id': p.id, 'nombre': p.nombre, 'descripcion': p.descripcion}
                for p in getattr(usuario, 'permisos_extra', [])
            ],
        }), 200
    except Exception as exc:
        logger.error("Error obteniendo permisos extra de usuario %s: %s", usuario_id, exc)
        return jsonify({'error': 'Error al obtener permisos extra'}), 500


@usuarios_bp.route('/<int:usuario_id>/permisos-extra', methods=['PUT'])
@login_required
def actualizar_permisos_extra(usuario_id):
    """Reemplazar los permisos adicionales de un usuario."""
    if not is_admin():
        return _forbidden_admin_only()

    data = request.get_json() or {}

    try:
        usuario = Usuario.query.get_or_404(usuario_id)
        if is_easy_user(usuario) and not is_easy_user():
            return jsonify({'error': 'Sin acceso al usuario EASY'}), 403

        permiso_ids = []
        for raw_id in (data.get('permiso_ids') or []):
            try:
                permiso_ids.append(int(raw_id))
            except (TypeError, ValueError):
                continue

        if permiso_ids:
            permisos = Permiso.query.filter(Permiso.id.in_(permiso_ids)).all()
            if len(permisos) != len(set(permiso_ids)):
                return jsonify({'error': 'Uno o más permisos seleccionados no son válidos'}), 400
            valid_names = {d['permiso'] for d in ROLE_PERMISSION_DEFINITIONS}
            invalid = [p.nombre for p in permisos if p.nombre not in valid_names]
            if invalid:
                return jsonify({'error': f'Permisos no reconocidos: {", ".join(invalid)}'}), 400
            usuario.permisos_extra = permisos
        else:
            usuario.permisos_extra = []

        db.session.commit()
        logger.info("Permisos extra actualizados para usuario: %s", usuario.usuario)
        return jsonify({'mensaje': 'Permisos extra actualizados'}), 200
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando permisos extra de usuario %s: %s", usuario_id, exc)
        return jsonify({'error': 'Error al actualizar permisos extra'}), 500


@usuarios_bp.route('/roles', methods=['GET'])
@login_required
def get_roles():
    """Obtener lista de roles."""
    if not is_admin():
        return _forbidden_admin_only()

    try:
        roles = Role.query.order_by(Role.nombre.asc()).all()
        return jsonify([_serialize_role(role) for role in roles]), 200
    except Exception as exc:
        logger.error("Error obteniendo roles: %s", exc)
        return jsonify({'error': 'Error al obtener roles'}), 500


@usuarios_bp.route('/roles', methods=['POST'])
@login_required
def crear_rol():
    """Crear rol con accesos al menú lateral."""
    if not is_admin():
        return _forbidden_admin_only()

    data = request.get_json() or {}

    try:
        nombre = (data.get('nombre') or '').strip()
        descripcion = _normalize_optional_text(data.get('descripcion'))
        permisos = _resolve_role_permissions(data.get('menu_permission_ids'))

        if not nombre:
            raise ValueError('El nombre del rol es obligatorio')

        if Role.query.filter_by(nombre=nombre).first():
            return jsonify({'error': 'Ya existe un rol con ese nombre'}), 409

        role = Role(nombre=nombre, descripcion=descripcion)
        role.permisos = permisos
        db.session.add(role)
        db.session.commit()
        logger.info("Rol creado: %s", role.nombre)
        return jsonify({'mensaje': 'Rol creado', 'id': role.id}), 201
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        logger.error("Error creando rol: %s", exc)
        return jsonify({'error': 'Error al crear rol'}), 500


@usuarios_bp.route('/roles/<int:role_id>', methods=['PUT'])
@login_required
def actualizar_rol(role_id):
    """Actualizar rol y sus accesos al menú."""
    if not is_admin():
        return _forbidden_admin_only()

    data = request.get_json() or {}

    try:
        role = Role.query.get_or_404(role_id)
        nombre = (data.get('nombre') or role.nombre or '').strip()
        descripcion = _normalize_optional_text(data.get('descripcion'))
        permisos = _resolve_role_permissions(data.get('menu_permission_ids'))

        if not nombre:
            raise ValueError('El nombre del rol es obligatorio')

        existente = Role.query.filter(
            Role.nombre == nombre,
            Role.id != role_id,
        ).first()
        if existente:
            return jsonify({'error': 'Ya existe otro rol con ese nombre'}), 409

        if role.nombre == 'Administrador' and nombre != 'Administrador':
            raise ValueError('El rol Administrador no puede cambiar su nombre')

        role.nombre = nombre
        role.descripcion = descripcion
        role.permisos = permisos
        db.session.commit()
        logger.info("Rol actualizado: %s", role.nombre)
        return jsonify({'mensaje': 'Rol actualizado'}), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        logger.error("Error actualizando rol: %s", exc)
        return jsonify({'error': 'Error al actualizar rol'}), 500


@usuarios_bp.route('/roles/<int:role_id>', methods=['DELETE'])
@login_required
def eliminar_rol(role_id):
    """Eliminar rol sin usuarios asociados."""
    if not is_admin():
        return _forbidden_admin_only()

    try:
        role = Role.query.get_or_404(role_id)
        if role.nombre == 'Administrador':
            return jsonify({'error': 'El rol Administrador no se puede eliminar'}), 400
        if role.usuarios.count() > 0:
            return jsonify({'error': 'No se puede eliminar un rol que todavía tiene usuarios asignados'}), 400

        db.session.delete(role)
        db.session.commit()
        logger.info("Rol eliminado: %s", role.nombre)
        return jsonify({'mensaje': 'Rol eliminado'}), 200
    except Exception as exc:
        db.session.rollback()
        logger.error("Error eliminando rol: %s", exc)
        return jsonify({'error': 'Error al eliminar rol'}), 500


@usuarios_bp.route('/menu-options', methods=['GET'])
@login_required
def get_menu_options():
    """Obtener opciones del menú lateral disponibles para relacionar con roles."""
    if not is_admin():
        return _forbidden_admin_only()

    try:
        permisos = {
            permiso.nombre: permiso
            for permiso in Permiso.query.all()
            if permiso.nombre
        }
        data = [
            _serialize_menu_option(definition, permisos.get(definition['permiso']))
            for definition in ROLE_PERMISSION_DEFINITIONS
        ]
        return jsonify(data), 200
    except Exception as exc:
        logger.error("Error obteniendo opciones de menú: %s", exc)
        return jsonify({'error': 'Error al obtener opciones del menú'}), 500


@usuarios_bp.route('/audit-log', methods=['GET'])
@login_required
def get_audit_log():
    """Obtener log de auditoría."""
    if not is_admin():
        return jsonify({'error': 'No tienes permiso'}), 403

    try:
        logs = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(100).all()
        datos = [{
            'id': log.id,
            'usuario': log.usuario.usuario if getattr(log, 'usuario', None) else 'Sistema',
            'tabla': log.tabla,
            'accion': log.accion,
            'created_at': log.created_at.strftime('%Y-%m-%d %H:%M:%S') if log.created_at else None,
            'ip_address': log.ip_address,
        } for log in logs]
        return jsonify(datos), 200
    except Exception as exc:
        logger.error("Error obteniendo audit log: %s", exc)
        return jsonify({'error': 'Error al obtener auditoría'}), 500
