"""Pruebas de cartera AC en una base PostgreSQL exclusiva para pruebas.

TEST_DATABASE_URL debe apuntar a una base cuyo nombre empiece por prevent_test_ac_.
Ejecutar: python -m unittest discover -s tests -v
"""

from datetime import date
from decimal import Decimal
from io import BytesIO
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from flask import Flask
from openpyxl import Workbook
from sqlalchemy.engine import make_url

from app.models import db, SiigoCarga, SiigoComprobante, SiigoMovimiento
from app.routes import contable


class CarteraACTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = os.environ.get('TEST_DATABASE_URL')
        if not url:
            raise unittest.SkipTest('Requiere TEST_DATABASE_URL de PostgreSQL')
        parsed = make_url(url)
        if not parsed.drivername.startswith('postgresql') or not parsed.database.startswith('prevent_test_ac_'):
            raise RuntimeError('Use una base PostgreSQL exclusiva prevent_test_ac_*')
        cls.app = Flask(__name__)
        cls.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=url)
        db.init_app(cls.app)
        with cls.app.app_context():
            db.create_all()

    def setUp(self):
        self.context = self.app.app_context()
        self.context.push()
        self.addCleanup(self.context.pop)
        self.addCleanup(db.session.remove)
        for model in (SiigoMovimiento, SiigoComprobante, SiigoCarga):
            db.session.query(model).delete()
        db.session.commit()
        self.permission = patch.object(contable, '_requiere_ventas')
        self.permission.start()
        self.addCleanup(self.permission.stop)

    def documento(self, tipo, numero, fecha, lineas):
        carga = SiigoCarga.query.first()
        if carga is None:
            carga = SiigoCarga(tipo_archivo='COMPROBANTES', nombre_archivo='fixture.xlsx', hash_archivo='fixture')
            db.session.add(carga)
            db.session.flush()
        doc = SiigoComprobante(tipo_documento=tipo, codigo_comprobante='2' if tipo == 'FV' else '1',
                               numero_comprobante=str(numero), fecha_elaboracion=date.fromisoformat(fecha), carga_id=carga.id)
        for index, fields in enumerate(lineas, 1):
            values = dict(codigo_contable='13050501', cuenta_contable='Clientes', identificacion='9001',
                          nombre_tercero='Cliente prueba', debito=Decimal('0'), credito=Decimal('0'),
                          detalle='FV-2-1 Cuota: 1 Fecha: 31/01/2026', descripcion='Clientes nacionales')
            values.update(fields)
            doc.movimientos.append(SiigoMovimiento(secuencia=index, **values))
        db.session.add(doc)
        db.session.commit()

    def factura_y_recibo(self):
        self.documento('FV', 1, '2026-01-01', [{'debito': Decimal('1000')}])
        self.documento('RC', 1, '2026-02-01', [{'credito': Decimal('900'), 'descripcion': 'Abono FV-2-1'}])

    def cartera(self, corte='2026-02-28'):
        with self.app.test_request_context(query_string={'fecha_corte': corte}):
            return contable.cartera_dinamica.__wrapped__().get_json()

    def test_retenciones_ac_cancelan_saldo_sin_inflar_recaudado(self):
        self.factura_y_recibo()
        self.documento('AC', 1, '2026-02-10', [
            {'credito': Decimal('70')}, {'credito': Decimal('30')},
            {'codigo_contable': '13551501', 'debito': Decimal('100')},
        ])
        data = self.cartera()
        for result in (data['periodos'][0], data['cartera_clientes'][0], data['cartera_clientes'][0]['facturas'][0]):
            self.assertEqual(result['facturado'], 1000)
            self.assertEqual(result['recaudado'], 900)
            self.assertEqual(result['ajustes_ac'], 100)
            self.assertEqual(result['saldo'], 0)
        self.assertEqual(data['cartera_clientes'][0]['vencido_1_30'], 0)
        self.assertEqual(data['pagos_clientes'][0]['promedio_dias'], 40)

    def test_ac_respeta_corte_y_reversos_reabren_saldo(self):
        self.factura_y_recibo()
        self.documento('AC', 1, '2026-02-10', [{'credito': Decimal('100')}])
        self.documento('AC', 2, '2026-02-20', [{'debito': Decimal('30')}])
        for corte, ajuste, saldo in [('2026-02-09', 0, 100), ('2026-02-10', 100, 0), ('2026-02-28', 70, 30)]:
            with self.subTest(corte=corte):
                data = self.cartera(corte)
                cliente = data['cartera_clientes'][0]
                self.assertEqual(cliente['ajustes_ac'], ajuste)
                self.assertEqual(cliente['saldo'], saldo)
                self.assertEqual(cliente['vencido_1_30'], saldo)

    def test_ac_sin_referencia_o_de_otro_tercero_no_cancela_factura(self):
        self.factura_y_recibo()
        self.documento('AC', 1, '2026-02-10', [
            {'credito': Decimal('10'), 'detalle': 'Sin referencia'},
            {'credito': Decimal('20'), 'detalle': 'FV-2-999 Cuota: 1'},
            {'credito': Decimal('30'), 'identificacion': 'OTRO'},
        ])
        data = self.cartera()
        self.assertEqual(data['cartera_clientes'][0]['saldo'], 100)
        self.assertEqual(data['ajustes_ac_sin_factura'], 3)
        self.assertEqual(data['valor_ac_sin_factura'], 60)

    def test_ac_puede_usar_descripcion_y_prioriza_detalle(self):
        self.factura_y_recibo()
        self.documento('AC', 1, '2026-02-10', [
            {'credito': Decimal('30'), 'detalle': '', 'descripcion': 'Ajuste FV-2-1'},
            {'credito': Decimal('20'), 'descripcion': 'Texto FV-2-999'},
        ])
        self.assertEqual(self.cartera()['cartera_clientes'][0]['saldo'], 50)

    def test_ac_por_si_solo_no_es_pago_en_efectivo(self):
        self.documento('FV', 1, '2026-01-01', [{'debito': Decimal('1000')}])
        self.documento('AC', 1, '2026-02-10', [{'credito': Decimal('1000')}])
        data = self.cartera()
        self.assertEqual(data['cartera_clientes'][0]['saldo'], 0)
        self.assertEqual(data['cartera_clientes'][0]['recaudado'], 0)
        self.assertEqual(data['pagos_clientes'], [])

    def test_comparativo_coincide_con_cartera_y_corte(self):
        self.factura_y_recibo()
        self.documento('AC', 1, '2026-02-10', [{'credito': Decimal('100')}])
        for corte, saldo in [('2026-02-09', 100), ('2026-02-28', 0)]:
            with self.app.test_request_context(query_string={
                'periodo_a_desde': '2025-01-01', 'periodo_a_hasta': '2025-12-31',
                'periodo_b_desde': '2026-01-01', 'periodo_b_hasta': '2026-01-31',
                'fecha_corte_cartera': corte,
            }):
                data = contable.comparativo_clientes.__wrapped__().get_json()
            self.assertEqual(data['totales_nuevos']['cartera'], saldo)
            self.assertEqual(data['totales_nuevos']['facturacion'], 1000)

    def excel(self, ac_cuadrado=True):
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(['Comprobantes detallados'])
        sheet.append(['Secuencia', 'Fecha elaboracion', 'Codigo contable', 'Cuenta contable',
                      'Identificacion', 'Nombre tercero', 'Descripcion', 'Detalle', 'Debito', 'Credito'])
        for ref, debit, credit, other, description in [
            ('FV-2-1', 1000, 0, '41350501', 'Venta'),
            ('RC-1-1', 0, 900, '11100501', 'Abono FV-2-1'),
            ('AC-1-1', 0, 100, '13551501', 'Retenciones'),
        ]:
            sheet.append([f'Comprobante: {ref}'])
            sheet.append([1, '01/02/2026', '13050501', 'Clientes', '9001', 'Cliente prueba',
                          description, 'FV-2-1 Cuota: 1 Fecha: 31/01/2026', debit, credit])
            counter = credit if ac_cuadrado or not ref.startswith('AC') else 50
            sheet.append([2, '01/02/2026', other, 'Contrapartida', '9001', 'Cliente prueba',
                          description, None, counter, debit])
        content = BytesIO()
        workbook.save(content)
        return content.getvalue()

    def cargar(self, content):
        with self.app.test_request_context(method='POST', data={'archivo': (BytesIO(content), 'comprobantes.xlsx')}):
            with patch.object(contable, 'current_user', SimpleNamespace(id=None)):
                response = contable.cargar_comprobantes.__wrapped__()
        if isinstance(response, tuple):
            return response[0].get_json(), response[1]
        return response.get_json(), 200

    def test_reimportar_archivo_antiguo_completa_ac_sin_duplicados(self):
        content = self.excel()
        with patch.object(contable, 'TIPOS_COMPROBANTE_PERMITIDOS', {'FV', 'RC', 'NC', 'ND'}):
            data, status = self.cargar(content)
        self.assertEqual((status, data['comprobantes']), (200, 2))
        data, status = self.cargar(content)
        self.assertEqual((status, data['comprobantes']), (200, 1))
        self.assertEqual(SiigoCarga.query.count(), 1)
        carga = SiigoCarga.query.one()
        self.assertEqual((carga.registros_leidos, carga.registros_importados, carga.registros_omitidos), (3, 3, 0))
        self.assertEqual(carga.total_debito, Decimal('2000'))
        self.assertEqual(carga.total_credito, Decimal('2000'))
        data, status = self.cargar(content)
        self.assertEqual(status, 400)
        self.assertIn('no contiene comprobantes nuevos', data['error'])
        self.assertEqual(SiigoComprobante.query.count(), 3)
        self.assertEqual(SiigoMovimiento.query.count(), 6)
        self.assertEqual(self.cartera()['cartera_clientes'][0]['saldo'], 0)

    def test_ac_descuadrado_revierte_toda_la_importacion(self):
        data, status = self.cargar(self.excel(ac_cuadrado=False))
        self.assertEqual(status, 400)
        self.assertIn('AC-1-1 no cuadra', data['error'])
        self.assertEqual(SiigoCarga.query.count(), 0)
        self.assertEqual(SiigoComprobante.query.count(), 0)
        self.assertEqual(SiigoMovimiento.query.count(), 0)


if __name__ == '__main__':
    unittest.main()
