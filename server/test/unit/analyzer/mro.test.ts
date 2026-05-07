import * as assert from 'node:assert/strict';
import { analyzeSource, errorsOnly } from './_helpers';
import { SymbolType } from '../../../src/compiler_analyzer/symbolObject';
import { computeMro } from '../../../src/compiler_analyzer/mro';

describe('mro — C3 linearization', () => {
    it('linearizes a simple chain (A <- B <- C)', () => {
        const r = analyzeSource(`
            class A {}
            class B : A {}
            class C : B {}
        `);
        const C = r.analyzerScope.globalScope.lookupSymbol('C') as SymbolType;
        const mro = computeMro(C);
        const names = mro.map(t => t.identifierText);
        assert.deepEqual(names, ['C', 'B', 'A']);
    });

    it('linearizes a multi-base class (C : A, B)', () => {
        const r = analyzeSource(`
            class A {}
            class B {}
            class C : A, B {}
        `);
        const C = r.analyzerScope.globalScope.lookupSymbol('C') as SymbolType;
        const mro = computeMro(C);
        const names = mro.map(t => t.identifierText);
        assert.deepEqual(names, ['C', 'A', 'B']);
    });

    it('linearizes a diamond hierarchy (D : B, C; B : A; C : A)', () => {
        const r = analyzeSource(`
            class A {}
            class B : A {}
            class C : A {}
            class D : B, C {}
        `);
        const D = r.analyzerScope.globalScope.lookupSymbol('D') as SymbolType;
        const mro = computeMro(D);
        const names = mro.map(t => t.identifierText);
        // Classic Python-style diamond: D, B, C, A
        assert.deepEqual(names, ['D', 'B', 'C', 'A']);
    });

    it('caches MRO on the SymbolType', () => {
        const r = analyzeSource(`
            class A {}
            class B : A {}
        `);
        const B = r.analyzerScope.globalScope.lookupSymbol('B') as SymbolType;
        const first = computeMro(B);
        const second = computeMro(B);
        assert.equal(first, second);
        assert.ok(B.mroCache !== undefined);
    });

    it('rejects an inconsistent multi-inheritance hierarchy', () => {
        // X : A, B  and  Y : B, A  and  Z : X, Y → no consistent linearization.
        const r = analyzeSource(`
            class A {}
            class B {}
            class X : A, B {}
            class Y : B, A {}
            class Z : X, Y {}
        `);
        // computeMro fires lazily during hoist via the queue — diagnostic must be present.
        const errs = errorsOnly(r.analyzerDiagnostics);
        assert.ok(
            errs.some(e => e.code === 'EN_MRO_INCONSISTENT'),
            `expected EN_MRO_INCONSISTENT, got ${errs.map(e => e.code).join(',')}`,
        );
    });
});
