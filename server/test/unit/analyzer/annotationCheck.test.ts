import * as assert from 'node:assert/strict';
import { analyzeSource } from './_helpers';
import {
    isKnownAnnotation,
    KNOWN_ANNOTATIONS,
} from '../../../src/compiler_analyzer/annotationCheck';

describe('annotationCheck', () => {
    it('recognizes the canonical annotation set incl. shadow (AC-21b)', () => {
        for (const name of ['align', 'dll', 'reflect', 'serialize', 'export',
                            'packed', 'inline', 'noinline', 'noopt', 'noescape',
                            'shadow']) {
            assert.ok(isKnownAnnotation(name), `${name} should be known`);
        }
        assert.ok(KNOWN_ANNOTATIONS.has('shadow'));
    });

    it('emits errorForce for [[align(N)]] with non-int arg', () => {
        const r = analyzeSource(`
            [[align("not an int")]]
            class C {
                int32 x;
            }
        `);
        const errs = r.analyzerDiagnostics.filter(d =>
            d.code === 'EN_ANN_ALIGN_TYPE' || d.code === 'EN_ANN_ALIGN_ARITY');
        assert.ok(errs.length >= 1);
        assert.equal(errs[0].severity, 'error');
    });

    it('emits errorForce for [[dll(non-string)]]', () => {
        const r = analyzeSource(`
            [[dll(42)]]
            extern int32 doStuff();
        `);
        const errs = r.analyzerDiagnostics.filter(d => d.code === 'EN_ANN_DLL_TYPE');
        assert.ok(errs.length >= 1);
        assert.equal(errs[0].severity, 'error');
    });

    it('accepts [[shadow]] with 0 args', () => {
        const r = analyzeSource(`
            [[shadow]]
            class C {
                int32 x;
            }
        `);
        const annDiags = r.analyzerDiagnostics.filter(d =>
            d.code && d.code.startsWith('EN_ANN_'));
        assert.equal(annDiags.length, 0);
    });

    it('emits a plain Warning for unknown annotation', () => {
        const r = analyzeSource(`
            [[unknown_thing]]
            class C {
                int32 x;
            }
        `);
        const w = r.analyzerDiagnostics.filter(d => d.code === 'EN_ANN_UNKNOWN');
        assert.equal(w.length, 1);
        assert.equal(w[0].severity, 'warning');
    });
});
