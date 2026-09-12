"""Identidad y alcance comercial compartidos por los módulos."""
from flask_login import current_user
from sqlalchemy import false

from app.models import ClienteComercial, Vendedor


def es_administrador():
    return bool(getattr(current_user, 'is_easy', False)) or getattr(
        getattr(current_user, 'role', None), 'nombre', None) == 'Administrador'


def vendedor_actual():
    if es_administrador():
        return None
    return Vendedor.query.filter_by(usuario_id=current_user.id, activo=True).first()


def clientes_visibles(query=None):
    query = ClienteComercial.query if query is None else query
    if es_administrador():
        return query
    vendedor = vendedor_actual()
    return query.filter(ClienteComercial.vendedor_id == vendedor.id) if vendedor else query.filter(false())


def filtrar_vendedor(query, columna):
    if es_administrador():
        return query
    vendedor = vendedor_actual()
    return query.filter(columna == vendedor.id) if vendedor else query.filter(false())


def filtrar_cliente(query, columna):
    if es_administrador():
        return query
    return query.filter(columna.in_(clientes_visibles().with_entities(ClienteComercial.id)))


def exigir_cliente(cliente_id):
    if es_administrador():
        return
    try:
        cliente_id = int(cliente_id)
    except (ValueError, TypeError):
        raise PermissionError('Selecciona un cliente de tu cartera.')
    if clientes_visibles().filter_by(id=cliente_id).first() is None:
        raise PermissionError('No tienes acceso a este cliente.')
