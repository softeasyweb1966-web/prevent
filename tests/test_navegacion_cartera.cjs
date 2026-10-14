// Ejecutar con: node --test tests/test_navegacion_cartera.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

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
