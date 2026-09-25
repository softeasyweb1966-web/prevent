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
        self.app.config.update(TESTING=True, SECRET_KEY='test-correcciones', SQLALCHEMY_DATABASE_URI='sqlite://')
        db.init_app(self.app)
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        self.app.add_url_rule('/generar', view_func=routes.generar_prefacturas.__wrapped__)
        self.app.add_url_rule('/generar-pistas', view_func=routes.generar_prefacturas_pistas.__wrapped__, methods=['POST'])
        self.app.add_url_rule('/empresas', view_func=routes.listar_empresas_generacion_prefacturas.__wrapped__)
        self.http = self.app.test_client()
        self.patches = [
            patch.object(routes, '_require_commercial_permission'),
            patch.object(routes, '_is_admin_user', return_value=True),
            patch.object(routes, '_resolver_vendedor_usuario_actual', return_value=None),
            patch.object(routes, 'exigir_cliente'),
            patch.object(routes, 'current_user', Mock(id=1)),
            patch.object(routes, 'filtrar_cliente', side_effect=lambda query, columna: query),
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

    def _pista_excel(self, empresas):
        import openpyxl

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(['Empresa'])
        for empresa in empresas:
            ws.append([empresa])
        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)
        return buf

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

    def test_empresas_solo_con_movimientos_en_periodo(self):
        db.session.add(ClienteComercial(id=3, nit='3', razon_social='Sin movimientos'))
        AtencionDiaDetalle.query.filter_by(cliente_id=2).first().fecha_creacion_orden = datetime(2026, 8, 31)
        db.session.commit()
        response = self.http.get('/empresas?fecha_desde=2026-09-01&fecha_hasta=2026-09-15')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([c['id'] for c in response.json], [1])
        response = self.http.get('/empresas?fecha_desde=2026-08-01&fecha_hasta=2026-08-31')
        self.assertEqual([c['id'] for c in response.json], [2])
        self.assertEqual(self.http.get('/empresas?fecha_desde=2025-01-01&fecha_hasta=2025-01-31').json, [])

    def test_empresas_rango_invalido(self):
        for params in ('', '?fecha_desde=2026-09-15&fecha_hasta=2026-09-01',
                       '?fecha_desde=incorrecta&fecha_hasta=2026-09-01'):
            self.assertEqual(self.http.get('/empresas' + params).status_code, 400)

    def test_empresas_respetan_scope(self):
        with patch.object(routes, '_is_admin_user', return_value=False), \
             patch.object(routes, '_resolver_vendedor_usuario_actual', return_value=Mock(id=1)), \
             patch.object(routes, '_condicion_scope_atenciones', return_value=AtencionDiaDetalle.cliente_id == 1):
            response = self.http.get('/empresas?fecha_desde=2026-09-01&fecha_hasta=2026-09-15')
            self.assertEqual([c['id'] for c in response.json], [1])

    def test_pistas_descarga_particulares_credito_sin_empresas_coincidentes(self):
        db.session.add(AtencionDiaDetalle(
            cargue_id=1, cliente_id=None, nro_orden='P1',
            nro_identificacion='999', nombre_paciente='Paciente Particular',
            fecha_creacion_orden=datetime(2026, 9, 2), servicio='Consulta',
            precio=150, forma_pago='CREDITO', estado_orden='ACTIVA',
            acuerdo_comercial='PARTICULAR', archivo_origen='test.xlsx'))
        db.session.commit()

        response = self.http.post(
            '/generar-pistas',
            data={
                'fecha_desde': '2026-09-01',
                'fecha_hasta': '2026-09-15',
                'archivo': (self._pista_excel(['Empresa sin movimiento']), 'PISTA.xlsx'),
            },
            content_type='multipart/form-data',
        )

        self.assertEqual(response.status_code, 200)
        with ZipFile(BytesIO(response.data)) as archivo:
            nombres = archivo.namelist()
            self.assertIn('sabana_particulares_credito.xlsx', nombres)
            self.assertIn('resumen_sabanas_pistas.txt', nombres)
            resumen = archivo.read('resumen_sabanas_pistas.txt').decode('utf-8')
            self.assertIn('Archivo PISTA procesado: PISTA.xlsx', resumen)
            self.assertIn('Sabanas incluidas: 0', resumen)
            self.assertIn('Ordenes particulares a credito: 1', resumen)

    def test_pistas_solo_genera_clientes_del_archivo_cargado(self):
        response = self.http.post(
            '/generar-pistas',
            data={
                'fecha_desde': '2026-09-01',
                'fecha_hasta': '2026-09-15',
                'archivo': (self._pista_excel(['Empresa 1']), 'PISTA.xlsx'),
            },
            content_type='multipart/form-data',
        )

        self.assertEqual(response.status_code, 200)
        with ZipFile(BytesIO(response.data)) as archivo:
            nombres = ' '.join(archivo.namelist()).replace(' ', '_')
            self.assertIn('Empresa_1', nombres)
            self.assertNotIn('Empresa_2', nombres)
            resumen = archivo.read('resumen_sabanas_pistas.txt').decode('utf-8')
            self.assertIn('Clientes PISTA encontrados: 1', resumen)
            self.assertIn('Sabanas incluidas: 1', resumen)


if __name__ == '__main__':
    unittest.main()
