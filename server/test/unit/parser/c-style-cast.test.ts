// Bug C: C-style cast `(T)expr` where T is a primitive type keyword.
// The parser commits to a cast only when the parenthesised content is a
// known primitive type and is followed by an expression-startable token.
// Otherwise the parens fall through to ordinary grouping.
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

describe('C-style cast `(T)expr` (Bug C)', () => {
    it('parses `(float64)x` as a cast', () => {
        expectClean(`void f() { float64 x = 1.0; (float64)x; }`);
    });

    it('parses `(int32)y + 1`', () => {
        expectClean(`void f() { int32 y = 0; int32 z = (int32)y + 1; }`);
    });

    it('parses cast in equality + && chain (the real Perception pattern)', () => {
        expectClean(
            `void f(float64 ww, float64 wh) { ` +
            `bool b = (float64)ww == 1.0 && (float64)wh == 2.0; }`,
        );
    });

    it('does NOT mis-parse `(x + y) * z` as a cast', () => {
        // `x` is not a primitive type keyword, so the parser falls back to
        // ordinary parenthesised expression.
        expectClean(`void f() { int32 x = 0; int32 y = 0; int32 z = 1; (x + y) * z; }`);
    });

    // Document the deliberate limitation: user-defined types in a C-style
    // cast are not recognised — only primitive type keywords commit to a
    // cast. `(SomeUserType)x` would be ambiguous with a parenthesised
    // identifier expression and is left for the explicit `cast<T>(x)` form.
});
