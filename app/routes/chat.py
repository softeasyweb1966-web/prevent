from datetime import datetime

from flask import jsonify, request
from flask_login import current_user, login_required

from app.models import ChatConversacion, ChatMensaje, ChatParticipante, Usuario, db
from app.routes import chat_bp


def _utcnow():
    return datetime.utcnow()


def _build_direct_key(user_a_id, user_b_id):
    first, second = sorted([int(user_a_id), int(user_b_id)])
    return f'{first}:{second}'


def _sanitize_content(raw_value):
    contenido = (raw_value or '').strip()
    if not contenido:
        return ''
    return contenido[:4000]


def _sanitize_title(raw_value):
    titulo = (raw_value or '').strip()
    if not titulo:
        return None
    return titulo[:200]


def _serialize_user(usuario):
    return {
        'id': usuario.id,
        'usuario': usuario.usuario,
        'nombre_completo': usuario.nombre_completo,
        'email': usuario.email,
        'role': usuario.role.nombre if usuario.role else None,
    }


def _serialize_message(mensaje):
    return {
        'id': mensaje.id,
        'conversacion_id': mensaje.conversacion_id,
        'remitente_id': mensaje.remitente_id,
        'remitente_usuario': mensaje.remitente.usuario if mensaje.remitente else None,
        'remitente_nombre': mensaje.remitente.nombre_completo if mensaje.remitente else None,
        'contenido': mensaje.contenido,
        'created_at': mensaje.created_at.isoformat() if mensaje.created_at else None,
        'updated_at': mensaje.updated_at.isoformat() if mensaje.updated_at else None,
        'es_mio': mensaje.remitente_id == current_user.id,
    }


def _get_participante_actual(conversacion_id):
    return ChatParticipante.query.filter_by(
        conversacion_id=conversacion_id,
        usuario_id=current_user.id,
        activo=True,
    ).first()


def _build_group_display_name(otros, titulo=None):
    if titulo:
        return titulo
    if not otros:
        return 'Conversacion interna'

    nombres = [usuario.nombre_completo or usuario.usuario for usuario in otros]
    if len(nombres) <= 3:
        return 'Grupo: ' + ', '.join(nombres)
    return f"Grupo: {', '.join(nombres[:3])} y {len(nombres) - 3} mas"


def _build_group_subtitle(otros):
    if not otros:
        return ''

    usuarios = [usuario.usuario for usuario in otros]
    if len(usuarios) <= 4:
        return ', '.join(usuarios)
    return f"{', '.join(usuarios[:4])} y {len(usuarios) - 4} mas"


def _ensure_direct_conversation(destinatario_id):
    direct_key = _build_direct_key(current_user.id, destinatario_id)
    conversacion = ChatConversacion.query.filter_by(tipo='DIRECTO', direct_key=direct_key).first()
    creada = False

    if conversacion is None:
        ahora = _utcnow()
        conversacion = ChatConversacion(
            tipo='DIRECTO',
            direct_key=direct_key,
            creada_por_id=current_user.id,
            created_at=ahora,
            updated_at=ahora,
        )
        db.session.add(conversacion)
        db.session.flush()

        db.session.add(ChatParticipante(
            conversacion_id=conversacion.id,
            usuario_id=current_user.id,
            ultimo_leido_at=ahora,
            activo=True,
        ))
        db.session.add(ChatParticipante(
            conversacion_id=conversacion.id,
            usuario_id=destinatario_id,
            activo=True,
        ))
        creada = True

    participante_actual = ChatParticipante.query.filter_by(
        conversacion_id=conversacion.id,
        usuario_id=current_user.id,
    ).first()
    participante_destinatario = ChatParticipante.query.filter_by(
        conversacion_id=conversacion.id,
        usuario_id=destinatario_id,
    ).first()

    if participante_actual is None:
        participante_actual = ChatParticipante(
            conversacion_id=conversacion.id,
            usuario_id=current_user.id,
            ultimo_leido_at=_utcnow(),
            activo=True,
        )
        db.session.add(participante_actual)
    else:
        participante_actual.activo = True

    if participante_destinatario is None:
        participante_destinatario = ChatParticipante(
            conversacion_id=conversacion.id,
            usuario_id=destinatario_id,
            activo=True,
        )
        db.session.add(participante_destinatario)
    else:
        participante_destinatario.activo = True

    db.session.commit()
    return conversacion, participante_actual, creada


def _create_group_conversation(recipient_ids, titulo=None):
    ahora = _utcnow()
    recipient_ids = sorted({int(user_id) for user_id in recipient_ids if int(user_id) != current_user.id})
    conversacion = ChatConversacion(
        tipo='GRUPO',
        titulo=titulo,
        creada_por_id=current_user.id,
        created_at=ahora,
        updated_at=ahora,
    )
    db.session.add(conversacion)
    db.session.flush()

    db.session.add(ChatParticipante(
        conversacion_id=conversacion.id,
        usuario_id=current_user.id,
        ultimo_leido_at=ahora,
        activo=True,
    ))

    for recipient_id in recipient_ids:
        db.session.add(ChatParticipante(
            conversacion_id=conversacion.id,
            usuario_id=recipient_id,
            activo=True,
        ))

    db.session.commit()
    participante_actual = ChatParticipante.query.filter_by(
        conversacion_id=conversacion.id,
        usuario_id=current_user.id,
        activo=True,
    ).first()
    return conversacion, participante_actual


def _serialize_conversation(conversacion, participante_actual):
    participantes = [p for p in conversacion.participantes if p.activo and p.usuario]
    otros = [p.usuario for p in participantes if p.usuario_id != current_user.id]
    ultimo_mensaje = (
        ChatMensaje.query
        .filter_by(conversacion_id=conversacion.id)
        .order_by(ChatMensaje.created_at.desc(), ChatMensaje.id.desc())
        .first()
    )

    unread_query = ChatMensaje.query.filter(
        ChatMensaje.conversacion_id == conversacion.id,
        ChatMensaje.remitente_id != current_user.id,
    )
    if participante_actual and participante_actual.ultimo_leido_at:
        unread_query = unread_query.filter(ChatMensaje.created_at > participante_actual.ultimo_leido_at)
    unread_count = unread_query.count()

    if conversacion.tipo == 'DIRECTO':
        if otros:
            display_name = ' / '.join(
                usuario.nombre_completo or usuario.usuario
                for usuario in otros
            )
            subtitle = ' / '.join(usuario.usuario for usuario in otros)
        else:
            display_name = 'Conversacion interna'
            subtitle = ''
    else:
        display_name = _build_group_display_name(otros, conversacion.titulo)
        subtitle = _build_group_subtitle(otros)

    return {
        'id': conversacion.id,
        'tipo': conversacion.tipo,
        'titulo': conversacion.titulo,
        'display_name': display_name,
        'subtitle': subtitle,
        'direct_key': conversacion.direct_key,
        'created_at': conversacion.created_at.isoformat() if conversacion.created_at else None,
        'updated_at': conversacion.updated_at.isoformat() if conversacion.updated_at else None,
        'ultimo_leido_at': participante_actual.ultimo_leido_at.isoformat() if participante_actual and participante_actual.ultimo_leido_at else None,
        'ultimo_mensaje': _serialize_message(ultimo_mensaje) if ultimo_mensaje else None,
        'unread_count': unread_count,
        'participantes': [_serialize_user(p.usuario) for p in participantes],
    }


@chat_bp.route('/usuarios', methods=['GET'])
@login_required
def listar_usuarios_chat():
    usuarios = (
        Usuario.query
        .filter(Usuario.activo.is_(True), Usuario.id != current_user.id)
        .order_by(Usuario.nombre_completo.asc(), Usuario.usuario.asc())
        .all()
    )
    return jsonify([_serialize_user(usuario) for usuario in usuarios]), 200


@chat_bp.route('/conversaciones', methods=['GET'])
@login_required
def listar_conversaciones():
    participaciones = (
        ChatParticipante.query
        .filter_by(usuario_id=current_user.id, activo=True)
        .join(ChatConversacion, ChatConversacion.id == ChatParticipante.conversacion_id)
        .order_by(ChatConversacion.updated_at.desc(), ChatConversacion.id.desc())
        .all()
    )

    conversaciones = [
        _serialize_conversation(participacion.conversacion, participacion)
        for participacion in participaciones
    ]
    return jsonify(conversaciones), 200


@chat_bp.route('/conversaciones', methods=['POST'])
@login_required
def crear_conversacion():
    data = request.get_json() or {}
    send_to_all = bool(data.get('send_to_all'))
    usuarios_ids = data.get('usuarios_ids') or []
    titulo = _sanitize_title(data.get('titulo'))

    if send_to_all:
        usuarios = (
            Usuario.query
            .filter(Usuario.activo.is_(True), Usuario.id != current_user.id)
            .order_by(Usuario.id.asc())
            .all()
        )
        recipient_ids = [usuario.id for usuario in usuarios]
    else:
        recipient_ids = []
        for usuario_id in usuarios_ids:
            try:
                recipient_ids.append(int(usuario_id))
            except (TypeError, ValueError):
                continue
        recipient_ids = sorted(set(recipient_ids))

    recipient_ids = [usuario_id for usuario_id in recipient_ids if usuario_id != current_user.id]
    if not recipient_ids:
        return jsonify({'error': 'Debes seleccionar al menos un destinatario.'}), 400

    usuarios_validos = (
        Usuario.query
        .filter(Usuario.activo.is_(True), Usuario.id.in_(recipient_ids))
        .order_by(Usuario.id.asc())
        .all()
    )
    valid_ids = [usuario.id for usuario in usuarios_validos]
    if len(valid_ids) != len(recipient_ids):
        return jsonify({'error': 'Uno o varios destinatarios no estan disponibles.'}), 400

    if len(valid_ids) == 1 and not send_to_all:
        conversacion, participante_actual, creada = _ensure_direct_conversation(valid_ids[0])
        return jsonify({
            'creada': creada,
            'conversacion': _serialize_conversation(conversacion, participante_actual),
        }), 200

    if send_to_all and len(valid_ids) > 1 and not titulo:
        titulo = 'Mensaje a todos'

    conversacion, participante_actual = _create_group_conversation(valid_ids, titulo=titulo)
    return jsonify({
        'creada': True,
        'conversacion': _serialize_conversation(conversacion, participante_actual),
    }), 201


@chat_bp.route('/conversaciones/direct', methods=['POST'])
@login_required
def crear_o_abrir_conversacion_directa():
    data = request.get_json() or {}
    destinatario_id = data.get('usuario_id')

    try:
        destinatario_id = int(destinatario_id)
    except (TypeError, ValueError):
        return jsonify({'error': 'Debe seleccionar un usuario valido.'}), 400

    if destinatario_id == current_user.id:
        return jsonify({'error': 'No puedes abrir un chat contigo mismo.'}), 400

    destinatario = Usuario.query.filter_by(id=destinatario_id, activo=True).first()
    if not destinatario:
        return jsonify({'error': 'El usuario seleccionado no esta disponible.'}), 404

    conversacion, participante_actual, creada = _ensure_direct_conversation(destinatario_id)

    return jsonify({
        'creada': creada,
        'conversacion': _serialize_conversation(conversacion, participante_actual),
    }), 200


@chat_bp.route('/conversaciones/<int:conversacion_id>/mensajes', methods=['GET'])
@login_required
def listar_mensajes(conversacion_id):
    participante_actual = _get_participante_actual(conversacion_id)
    if participante_actual is None:
        return jsonify({'error': 'No tienes acceso a esta conversacion.'}), 403

    mensajes = (
        ChatMensaje.query
        .filter_by(conversacion_id=conversacion_id)
        .order_by(ChatMensaje.created_at.asc(), ChatMensaje.id.asc())
        .all()
    )
    conversacion = participante_actual.conversacion

    return jsonify({
        'conversacion': _serialize_conversation(conversacion, participante_actual),
        'mensajes': [_serialize_message(mensaje) for mensaje in mensajes],
    }), 200


@chat_bp.route('/conversaciones/<int:conversacion_id>/mensajes', methods=['POST'])
@login_required
def enviar_mensaje(conversacion_id):
    participante_actual = _get_participante_actual(conversacion_id)
    if participante_actual is None:
        return jsonify({'error': 'No tienes acceso a esta conversacion.'}), 403

    data = request.get_json() or {}
    contenido = _sanitize_content(data.get('contenido'))
    if not contenido:
        return jsonify({'error': 'El mensaje no puede estar vacio.'}), 400

    ahora = _utcnow()
    mensaje = ChatMensaje(
        conversacion_id=conversacion_id,
        remitente_id=current_user.id,
        contenido=contenido,
        created_at=ahora,
        updated_at=ahora,
    )
    participante_actual.ultimo_leido_at = ahora
    participante_actual.updated_at = ahora
    participante_actual.conversacion.updated_at = ahora

    db.session.add(mensaje)
    db.session.commit()

    return jsonify({
        'mensaje': 'Mensaje enviado.',
        'chat_mensaje': _serialize_message(mensaje),
    }), 201


@chat_bp.route('/conversaciones/<int:conversacion_id>/leer', methods=['POST'])
@login_required
def marcar_conversacion_leida(conversacion_id):
    participante_actual = _get_participante_actual(conversacion_id)
    if participante_actual is None:
        return jsonify({'error': 'No tienes acceso a esta conversacion.'}), 403

    ultimo_mensaje = (
        ChatMensaje.query
        .filter_by(conversacion_id=conversacion_id)
        .order_by(ChatMensaje.created_at.desc(), ChatMensaje.id.desc())
        .first()
    )
    ahora = ultimo_mensaje.created_at if ultimo_mensaje and ultimo_mensaje.created_at else _utcnow()

    participante_actual.ultimo_leido_at = ahora
    participante_actual.updated_at = _utcnow()
    db.session.commit()

    return jsonify({
        'mensaje': 'Conversacion actualizada.',
        'ultimo_leido_at': participante_actual.ultimo_leido_at.isoformat() if participante_actual.ultimo_leido_at else None,
    }), 200
