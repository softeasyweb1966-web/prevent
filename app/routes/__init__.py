from flask import Blueprint

# Blueprint de autenticación
auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

# Blueprint de dashboard
dashboard_bp = Blueprint('dashboard', __name__, url_prefix='/api/dashboard')

# Blueprint de nómina

# Blueprint de usuarios
usuarios_bp = Blueprint('usuarios', __name__, url_prefix='/api/usuarios')

# Blueprint de parámetros
parametros_bp = Blueprint('parametros', __name__, url_prefix='/api/parametros')

# Blueprint de servicios

# Blueprint de bancos / préstamos de empresa
comercial_bp = Blueprint('comercial', __name__, url_prefix='/api/comercial')
contable_bp = Blueprint('contable', __name__, url_prefix='/api/contable')
chat_bp = Blueprint('chat', __name__, url_prefix='/api/chat')

# Importar las rutas
from app.routes import auth, dashboard, usuarios, parametros, comercial, contable, chat, cargue_atenciones

