"""Generacion por empresa sobre una base SQLite temporal en memoria."""
from datetime import datetime
from io import BytesIO
import unittest
from unittest.mock import patch, Mock
from zipfile import ZipFile

from flask import Flask

from app.models import db, ClienteComercial, CargueAtencionDia, AtencionDiaDetalle, PrefacturaComercial
from app.routes import cargue_atenciones as routes


class PrefacturasEmpresaTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite://')
        db.init_app(self.app)
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        self.app.add_url_rule('/generar', view_func=routes.generar_prefacturas.__wrapped__)
        self.http = self.app.test_client()
        self.patches = [
            patch.object(routes, '_require_commercial_permission'),
            patch.object(routes, '_is_admin_user', return_value=True),
            patch.object(routes, '_resolver_vendedor_usuario_actual', return_value=None),
            patch.object(routes, 'exigir_cliente'),
            patch.object(routes, 'current_user', Mock(id=1)),
        ]
        for p in self.patches:
            p.start()
        carga = CargueAtencionDia(nombre_archivo='test.xlsx')
        db.session.add(carga)
        db.session.flush()
        for i in (1, 2):
            cliente = ClienteComercial(id=i, nit=str(i), razon_social=f'Empresa {i}')
            db.session.add(cliente)
            db.session.add(AtencionDiaDetalle(
                cargue_id=carga.id, cliente_id=i, nro_orden=str(i),
                nro_identificacion=str(i), nombre_paciente=f'Paciente {i}',
                fecha_creacion_orden=datetime(2026, 9, 1), servicio='Consulta',
                precio=100 * i, forma_pago='CREDITO', estado_orden='ACTIVA',
                archivo_origen='test.xlsx'))
        db.session.commit()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.ctx.pop()
        for p in reversed(self.patches):
            p.stop()

    def generar(self, extra=''):
        return self.http.get('/generar?fecha_desde=2026-09-01&fecha_hasta=2026-09-15' + extra)

    def test_empresa_seleccionada_filtra_zip_y_registros(self):
        response = self.generar('&cliente_id=1')
        self.assertEqual(response.status_code, 200)
        with ZipFile(BytesIO(response.data)) as archivo:
            nombres = ' '.join(archivo.namelist())
            self.assertIn('Empresa_1', nombres.replace(' ', '_'))
            self.assertNotIn('Empresa_2', nombres.replace(' ', '_'))
        self.assertEqual([p.cliente_id for p in PrefacturaComercial.query.all()], [1])

    def test_todas_las_empresas(self):
        response = self.generar()
        self.assertEqual(response.status_code, 200)
        self.assertEqual({p.cliente_id for p in PrefacturaComercial.query.all()}, {1, 2})

    def test_empresa_invalida_no_genera_todas(self):
        for value in ('abc', '0', '-1'):
            self.assertEqual(self.generar('&cliente_id=' + value).status_code, 400)
        self.assertEqual(self.generar('&cliente_id=999').status_code, 404)
        self.assertEqual(PrefacturaComercial.query.count(), 0)

    def test_empresa_sin_permiso(self):
        with patch.object(routes, 'exigir_cliente', side_effect=PermissionError('Sin acceso')):
            self.assertEqual(self.generar('&cliente_id=2').status_code, 403)
        self.assertEqual(PrefacturaComercial.query.count(), 0)


if __name__ == '__main__':
    unittest.main()
