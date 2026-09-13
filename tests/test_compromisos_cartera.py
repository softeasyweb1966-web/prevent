from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
import unittest

from app.routes.contable import _estado_compromiso, _clientes_facturas_vencidas


class CompromisosTest(unittest.TestCase):
    def test_limites_y_cumplimiento_prevalece_sobre_vencimiento(self):
        hoy = date(2026, 9, 13)
        for dias, estado in [(-1, 'vencido'), (0, 'proximo'), (3, 'proximo'), (4, 'pendiente')]:
            registro = SimpleNamespace(fecha_compromiso=hoy + timedelta(days=dias), compromiso_cumplido_at=None)
            self.assertEqual(_estado_compromiso(registro, hoy), estado)
            registro.compromiso_cumplido_at = datetime(2026, 9, 13)
            self.assertEqual(_estado_compromiso(registro, hoy), 'cumplido')
        self.assertEqual(_estado_compromiso(SimpleNamespace(fecha_compromiso=None), hoy), 'sin_compromiso')

    def test_filtro_clientes_mixtos_y_total_sin_facturas_pagadas(self):
        def factura(ref, dias, saldo):
            return dict(referencia=ref, dias_vencido=dias, saldo=Decimal(saldo))
        clientes = [
            dict(identificacion='1', cliente='Mixto', facturas=[factura('A', 10, '100'), factura('B', -5, '200'), factura('C', -1, '0')]),
            dict(identificacion='2', cliente='Vencido', facturas=[factura('D', 1, '300')]),
            dict(identificacion='3', cliente='Hoy', facturas=[factura('E', 0, '50')]),
        ]
        resultado = _clientes_facturas_vencidas(clientes, {}, 'por_vencer')
        self.assertEqual({c['identificacion'] for c in resultado}, {'1', '3'})
        mixto = next(c for c in resultado if c['identificacion'] == '1')
        self.assertEqual(mixto['cantidad_facturas'], 1)
        self.assertEqual(mixto['total_cliente'], Decimal('200'))
        self.assertEqual(mixto['total_vencido'], Decimal('0'))
        vencidos = _clientes_facturas_vencidas(clientes, {}, 'vencidos')
        self.assertEqual([c['identificacion'] for c in vencidos], ['1', '2'])
        self.assertEqual(vencidos[0]['total_cliente'], Decimal('100'))
        self.assertEqual(len(_clientes_facturas_vencidas(clientes, {})), 3)

    def test_una_factura_ordena_por_dias_antes_que_valor(self):
        clientes = [dict(identificacion=str(i), cliente=str(i), facturas=[
            dict(referencia=str(i), dias_vencido=dias, saldo=Decimal(valor))
        ]) for i, (dias, valor) in enumerate([(2, '900'), (50, '10'), (-10, '1000'), (0, '20'), (-1, '5')])]
        resultado = _clientes_facturas_vencidas(clientes, {})
        self.assertEqual([c['facturas'][0]['dias_vencido'] for c in resultado], [50, 2, 0, -1, -10])
        with self.assertRaises(ValueError):
            _clientes_facturas_vencidas(clientes, {}, 'incorrecto')
