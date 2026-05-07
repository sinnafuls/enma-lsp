// Bug B: typed-array declarations `T[]`.
// `T[]` desugars to `array<T>`. Ensure parser accepts the suffix in
// type position (file scope, function scope, parameters, nested).
import { strict as assert } from 'node:assert';
import { parseSource, parserErrors } from './_helpers';

function expectClean(src: string): void {
    const r = parseSource(src);
    const errs = parserErrors(r.diagnostics);
    assert.equal(
        errs.length, 0,
        `expected no parser errors, got:\n` + errs.map(e => `  - ${e.message}`).join('\n'),
    );
}

describe('typed-array suffix `T[]` (Bug B)', () => {
    it('accepts file-scope typed-array variable: `float32[] g;`', () => {
        expectClean(`float32[] g_neb_cbdata;`);
    });

    it('accepts function-scope typed-array variable: `float32[] verts;`', () => {
        expectClean(`void f() { float32[] verts; }`);
    });

    it('accepts nested typed array: `int32[][] m;`', () => {
        expectClean(`int32[][] m;`);
    });

    it('accepts typed-array followed by .push() usage', () => {
        expectClean(`void f() { float32[] v; v.push(1.0f); }`);
    });

    it('still accepts existing generic form `array<float32> g;`', () => {
        expectClean(`array<float32> g;`);
    });
});
