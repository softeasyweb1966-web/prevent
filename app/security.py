from __future__ import annotations

from typing import Iterable


MENU_OPTION_DEFINITIONS = [
    {
        'module': 'nomina',
        'permiso': 'menu_nomina',
        'nombre': 'Nómina',
        'descripcion': 'Acceso al módulo de nómina',
        'orden': 10,
    },
    {
        'module': 'servicios',
        'permiso': 'menu_servicios',
        'nombre': 'Servicios',
        'descripcion': 'Acceso al módulo de servicios',
        'orden': 20,
    },
    {
        'module': 'bancos',
        'permiso': 'menu_bancos',
        'nombre': 'Bancos',
        'descripcion': 'Acceso al módulo de préstamos y bancos',
        'orden': 30,
    },
    {
        'module': 'comercial',
        'permiso': 'menu_comercial',
        'nombre': 'Vendedores',
        'descripcion': 'Acceso al módulo comercial',
        'orden': 40,
    },
    {
        'module': 'recepcion',
        'permiso': 'menu_recepcion',
        'nombre': 'Consulta Clientes',
        'descripcion': 'Acceso al módulo RP Consulta Clientes',
        'orden': 50,
    },
    {
        'module': 'chat',
        'permiso': 'menu_chat',
        'nombre': 'Chat Interno',
        'descripcion': 'Acceso al módulo de chat interno',
        'orden': 60,
    },
    {
        'module': 'impuestos',
        'permiso': 'menu_impuestos',
        'nombre': 'Impuestos',
        'descripcion': 'Acceso al módulo de impuestos',
        'orden': 70,
    },
    {
        'module': 'compras',
        'permiso': 'menu_compras',
        'nombre': 'Compras',
        'descripcion': 'Acceso al módulo de compras',
        'orden': 80,
    },
    {
        'module': 'ventas',
        'permiso': 'menu_ventas',
        'nombre': 'Ventas',
        'descripcion': 'Acceso al módulo de ventas',
        'orden': 90,
    },
    {
        'module': 'informes',
        'permiso': 'menu_informes',
        'nombre': 'Informes',
        'descripcion': 'Acceso al módulo de informes',
        'orden': 100,
    },
    {
        'module': 'usuarios',
        'permiso': 'menu_usuarios',
        'nombre': 'Usuarios',
        'descripcion': 'Acceso al módulo de usuarios y roles',
        'orden': 110,
    },
    {
        'module': 'tablas',
        'permiso': 'menu_tablas',
        'nombre': 'Tablas',
        'descripcion': 'Acceso al módulo de tablas de configuración',
        'orden': 120,
    },
    {
        'module': 'sabor_artesanal',
        'permiso': 'menu_sabor_artesanal',
        'nombre': 'Sabor Artesanal',
        'descripcion': 'Acceso al mÃ³dulo de Sabor Artesanal',
        'orden': 125,
    },
]


MENU_OPTION_DEFINITIONS = sorted([
    definition for definition in MENU_OPTION_DEFINITIONS
    if definition['module'] not in {
        'nomina',
        'servicios',
        'bancos',
        'impuestos',
        'sabor_artesanal',
        'recepcion',
        'chat',
    }
] + [
    {
        'module': 'gestion_informacion',
        'permiso': 'menu_gestion_informacion',
        'nombre': 'Atenciones',
        'descripcion': 'Acceso al modulo de atenciones',
        'orden': 50,
    },
], key=lambda definition: definition['orden'])


def _build_commercial_crud_definitions(entity: str, nombre: str, orden_base: int):
    acciones = [
        ('read', 'Consultar', f'Puede consultar {nombre.lower()}'),
        ('create', 'Crear', f'Puede crear {nombre.lower()}'),
        ('update', 'Editar', f'Puede editar {nombre.lower()}'),
        ('delete', 'Eliminar', f'Puede eliminar {nombre.lower()}'),
    ]
    definitions = []
    for index, (action, action_name, description) in enumerate(acciones, start=1):
        definitions.append({
            'category': 'comercial',
            'module': 'comercial',
            'group': nombre,
            'entity': entity,
            'action': action,
            'permiso': f'comercial_{entity}_{action}',
            'nombre': f'{nombre}: {action_name}',
            'descripcion': description,
            'orden': orden_base + index,
        })
    return definitions


COMMERCIAL_PERMISSION_DEFINITIONS = (
    _build_commercial_crud_definitions('vendedores', 'Vendedores', 1000)
    + _build_commercial_crud_definitions('clientes', 'Clientes Comerciales', 1100)
    + _build_commercial_crud_definitions('examenes', 'Examenes', 1200)
    + _build_commercial_crud_definitions('paquetes', 'Paquetes', 1300)
    + _build_commercial_crud_definitions('tarifas', 'Tarifas Comerciales', 1400)
    + _build_commercial_crud_definitions('atenciones', 'Atenciones Comerciales', 1500)
    + _build_commercial_crud_definitions('documentos', 'Documentos de Seguimiento', 1600)
    + _build_commercial_crud_definitions('pagos', 'Pagos de Seguimiento', 1700)
    + _build_commercial_crud_definitions('comisiones', 'Comisiones', 1800)
    + [
        {
            'category': 'comercial',
            'module': 'comercial',
            'group': 'Comisiones',
            'entity': 'comisiones',
            'action': 'validate',
            'permiso': 'comercial_comisiones_validate',
            'nombre': 'Comisiones: Validar sin soporte',
            'descripcion': 'Puede aprobar o rechazar comisiones de pagos que no tienen soporte adjunto',
            'orden': 1805,
        },
    ]
)


ROLE_PERMISSION_DEFINITIONS = MENU_OPTION_DEFINITIONS + COMMERCIAL_PERMISSION_DEFINITIONS


def get_menu_definition_by_permission(permission_name: str):
    for definition in MENU_OPTION_DEFINITIONS:
        if definition['permiso'] == permission_name:
            return definition
    return None


def get_role_permission_definition(permission_name: str):
    for definition in ROLE_PERMISSION_DEFINITIONS:
        if definition['permiso'] == permission_name:
            return definition
    return None


def get_menu_definition_by_module(module_name: str):
    for definition in MENU_OPTION_DEFINITIONS:
        if definition['module'] == module_name:
            return definition
    return None


def get_allowed_menu_modules_for_role(role) -> list[str]:
    if role is None:
        return []

    permission_names = get_permission_names_for_role(role)
    modules = []
    for definition in MENU_OPTION_DEFINITIONS:
        if definition['permiso'] in permission_names:
            modules.append(definition['module'])
    return modules


def get_permission_names_for_role(role) -> set[str]:
    if role is None:
        return set()
    return {
        permiso.nombre
        for permiso in getattr(role, 'permisos', [])
        if getattr(permiso, 'nombre', None)
    }


def get_permission_names_for_user(usuario) -> set[str]:
    """Combina permisos del rol + permisos extra asignados directamente al usuario.
    Si el usuario es EASY devuelve {'*'} (acceso total).
    Es tolerante a fallos si la tabla usuario_permiso aún no existe (migración pendiente)."""
    if usuario is None:
        return set()
    if getattr(usuario, 'is_easy', False):
        return {'*'}
    role_perms = get_permission_names_for_role(getattr(usuario, 'role', None))
    try:
        extra_perms = {
            permiso.nombre
            for permiso in getattr(usuario, 'permisos_extra', [])
            if getattr(permiso, 'nombre', None)
        }
    except Exception:
        # La tabla usuario_permiso puede no existir si la migración está pendiente
        extra_perms = set()
    return role_perms | extra_perms


def sort_role_permission_records(records: Iterable) -> list:
    order_map = {definition['permiso']: definition['orden'] for definition in ROLE_PERMISSION_DEFINITIONS}
    return sorted(
        list(records),
        key=lambda record: order_map.get(getattr(record, 'nombre', ''), 9999),
    )


def sort_menu_permission_records(records: Iterable) -> list:
    return sort_role_permission_records(records)
