// Ejecutar con: node --test tests/test_navegacion_cartera.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function contextoResumen() {
    const context = vm.createContext({ document: {
        addEventListener() {},
        createElement: () => ({ set textContent(value) { this.innerHTML = String(value); } }),
    } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/static/js/contable.js'), 'utf8'), context);
    context.esVendedorCarteraSiigo = () => false;
    return context;
}

test('Ajustes netos concilian ventas, recaudos y cartera con notas debito y excedentes', () => {
    const context = contextoResumen();
    const data = {
        totales: { ventas: 1000, recaudado: 400, cartera: 250, sin_recaudo: 250 },
        periodos: [{ ajustes_ac: 200, notas_credito: 180, notas_debito: 50, otros_movimientos: 40 }],
    };
    const ajustes = context.desgloseAjustesCarteraSiigo(data);
    assert.equal(ajustes.neto, 350);
    assert.equal(ajustes.excedentes, 20);
    assert.equal(ajustes.ac + ajustes.credito - ajustes.debito + ajustes.otros - ajustes.excedentes, ajustes.neto);
    assert.match(context.resumenDetalleAjustesCarteraSiigo(data), /Abonos excedentes/);
    assert.match(context.renderResumenInicioCarteraSiigo(data, 2026), /data-cartera-resumen-detalle="ajustes"/);
    context.esVendedorCarteraSiigo = () => true;
    assert.doesNotMatch(context.renderResumenInicioCarteraSiigo(data, 2026), /data-cartera-resumen-detalle="ajustes"/);
});

test('Ajustes soportan ausencia de totales, valores negativos y centavos', () => {
    const context = contextoResumen();
    const data = { periodos: [{ facturado: 100, recaudado: 20, notas_debito: 30 }], cartera_clientes: [{ saldo: 110 }] };
    assert.equal(context.desgloseAjustesCarteraSiigo(data).neto, -30);
    assert.equal(context.desgloseAjustesCarteraSiigo(data).excedentes, 0);
    assert.doesNotMatch(context.resumenDetalleAjustesCarteraSiigo(data), /Abonos excedentes/);
    assert.equal(context.desgloseAjustesCarteraSiigo({ totales: {
        ventas: 472046114.68, recaudado: 233721154.52, cartera: 203190970.78,
    } }).neto, 35133989.38);
});

test('Cartera y Ventas recuperan el panel compartido al navegar repetidamente', () => {
    const element = () => ({
        style: {}, dataset: {}, hidden: false,
        classList: { replace() {}, toggle() {}, remove() {} },
        querySelectorAll: () => [],
        querySelector: () => null,
        replaceChildren(child) { child.parentElement = this; },
        insertAdjacentElement(position, child) { child.parentElement = this.parentElement; },
    });
    const ventas = element();
    const destino = element();
    const inicio = element();
    const filtros = element();
    const visor = element();
    const panel = element();
    panel.parentElement = ventas;
    panel.querySelector = selector => ({
        '[data-cartera-inicio]': inicio,
        '[data-vencidas-filtros]': filtros,
        '.siigo-vencidas-visor': visor,
    })[selector] || null;
    const panels = Object.fromEntries([
        'cargas', 'historial', 'consulta', 'comparativo', 'analisis',
        'pagos', 'cartera', 'navigation', 'reportNavigation',
    ].map(name => [name, element()]));
    panels.consulta.parentElement = ventas;
    panels.vencidas = panel;
    const document = {
        addEventListener() {},
        body: element(), querySelectorAll: () => [],
        getElementById: id => ({
            comercialCarteraPanel: destino,
            siigoFacturasVencidasPanel: panel,
        })[id] || null,
    };
    const context = vm.createContext({ document, window: { _siigoPanels: panels }, console });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/static/js/contable.js'), 'utf8'), context);
    // Los datos remotos no participan en la ubicacion ni visibilidad del panel.
    context.asegurarInicioGestionCarteraSiigo = () => {};
    context.cargarAlertasInicioCarteraSiigo = () => {};
    for (let vuelta = 0; vuelta < 3; vuelta++) {
        context.mostrarSeccionVentasSiigo('cargue');
        assert.equal(panel.style.display, 'none');
        context.abrirGestionCarteraComercial();
        assert.equal(panel.style.display, '');
        assert.equal(panel.parentElement, destino);
        assert.equal(inicio.hidden, false);
        assert.equal(filtros.hidden, true);
        context.mostrarInformeSiigo('vencidas');
        assert.equal(panel.parentElement, ventas);
        assert.equal(panel.style.display, '');
        assert.equal(inicio.hidden, true);
        assert.equal(filtros.hidden, false);
        context.mostrarInformeSiigo('comparativo');
        context.abrirGestionCarteraComercial();
        assert.equal(panel.style.display, '');
        assert.equal(panel.parentElement, destino);
    }
});
