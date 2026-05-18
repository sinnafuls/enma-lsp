process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture } from './_helpers';
import { provideWorkspaceSymbol } from '../../../src/services/workspaceSymbol';

const URI = 'file:///ws.em';

function symbols(src: string, query: string) {
    const f = buildFixture(URI, src);
    return provideWorkspaceSymbol(query, [f.analyzerScope.globalScope]);
}

describe('workspaceSymbol service', () => {
    it('exact match scores highest and is returned first', () => {
        const r = symbols('class Player {}\nclass PlayerStats {}\n', 'Player');
        assert.ok(r.length >= 2, 'expected both classes in results');
        assert.equal(r[0].name, 'Player');
    });

    it('prefix match outranks substring match', () => {
        const r = symbols('class FooBar {}\nclass XFoo {}\n', 'Foo');
        assert.equal(r[0].name, 'FooBar');
    });

    it('substring match still surfaces a result', () => {
        const r = symbols('class Engine {}\n', 'gin');
        assert.equal(r.length, 1);
        assert.equal(r[0].name, 'Engine');
    });

    it('empty query returns every top-level user symbol', () => {
        const r = symbols('class A {}\nclass B {}\nvoid f() {}\n', '');
        const names = r.map(s => s.name);
        assert.ok(names.includes('A'), 'A missing');
        assert.ok(names.includes('B'), 'B missing');
        assert.ok(names.includes('f'), 'f missing');
    });

    it('namespace members carry the namespace as container', () => {
        const r = symbols('namespace gfx { void draw() {} }\n', 'draw');
        const draw = r.find(s => s.name === 'draw');
        assert.ok(draw, 'expected draw symbol');
        assert.equal(draw.containerName, 'gfx');
    });

    it('class methods carry the class as container', () => {
        const r = symbols('class Cam { void zoom() {} }\n', 'zoom');
        const zoom = r.find(s => s.name === 'zoom');
        assert.ok(zoom, 'expected zoom symbol');
        assert.equal(zoom.containerName, 'Cam');
    });
});
