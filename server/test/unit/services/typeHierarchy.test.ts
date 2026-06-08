// Service tests — type hierarchy (prepare / supertypes / subtypes).

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';

import { Inspector } from '../../../src/inspector/inspector';
import {
    prepareTypeHierarchy,
    provideSupertypes,
    provideSubtypes,
} from '../../../src/services/typeHierarchy';

function recordFor(source: string) {
    const inspector = new Inspector();
    const uri = 'file:///fake/test.em';
    inspector.inspectFile(uri, source, { isOpen: true });
    inspector.flush();
    const r = inspector.getRecord(uri);
    assert.ok(r);
    return r!;
}

function posOf(source: string, needle: string, n = 1) {
    const lines = source.split('\n');
    let count = 0;
    for (let line = 0; line < lines.length; line++) {
        let from = 0;
        for (;;) {
            const idx = lines[line].indexOf(needle, from);
            if (idx < 0) break;
            count++;
            if (count === n) return { line, character: idx };
            from = idx + needle.length;
        }
    }
    throw new Error(`occurrence ${n} of "${needle}" not found`);
}

describe('service: typeHierarchy', () => {
    const src = [
        'interface Shape { }',
        'class Base : Shape { }',
        'class Derived : Base { }',
    ].join('\n');

    it('prepare resolves the type under the caret', () => {
        const r = recordFor(src);
        const items = prepareTypeHierarchy(r.analyzerScope.globalScope, r.rawTokens, posOf(src, 'Base', 1));
        assert.equal(items.length, 1);
        assert.equal(items[0].name, 'Base');
    });

    it('supertypes returns the declared base types', () => {
        const r = recordFor(src);
        const scopes = [r.analyzerScope.globalScope];
        const [base] = prepareTypeHierarchy(r.analyzerScope.globalScope, r.rawTokens, posOf(src, 'Base', 1));
        const supers = provideSupertypes(scopes, base);
        assert.deepEqual(supers.map((s) => s.name), ['Shape']);
    });

    it('subtypes returns derived types', () => {
        const r = recordFor(src);
        const scopes = [r.analyzerScope.globalScope];
        const [base] = prepareTypeHierarchy(r.analyzerScope.globalScope, r.rawTokens, posOf(src, 'Base', 1));
        const subs = provideSubtypes(scopes, base);
        assert.deepEqual(subs.map((s) => s.name), ['Derived']);
    });

    it('prepare returns nothing for a non-type identifier', () => {
        const r = recordFor(src);
        const items = prepareTypeHierarchy(r.analyzerScope.globalScope, r.rawTokens, { line: 0, character: 0 });
        assert.equal(items.length, 0);
    });
});
