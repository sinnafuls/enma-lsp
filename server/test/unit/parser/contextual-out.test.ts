// Bug-1 regression: `out` was being treated as strictly reserved everywhere,
// which broke valid identifier usage in declaration / expression / return
// positions. We now treat `out` as a contextual reserved word (mirroring the
// existing get/set treatment) — accepting it as an identifier wherever the
// grammar is unambiguous, and only honouring it as a parameter modifier in
// the parameter-list slot.

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

describe('contextual `out` (Bug 1)', () => {
    it('accepts `string out = "";` as a variable declaration', () => {
        expectClean(`void f() { string out = ""; }`);
    });

    it('accepts `out = c + out;` as an assignment expression', () => {
        expectClean(`void f() { string out; string c; out = c + out; }`);
    });

    it('accepts `return out;` as a return expression', () => {
        expectClean(`string f() { string out; return out; }`);
    });

    it('accepts `int64 out` as a parameter name', () => {
        expectClean(`void f(int64 out) { }`);
    });

    it('accepts `out int64 x` as a parameter modifier', () => {
        expectClean(`void f(out int64 x) { }`);
    });

    it('accepts an ordinary parameter name starting with `out`', () => {
        expectClean(`void f(int32 out_value) { }`);
    });

    // Bug A: contextual reserved words also accepted as class member names.
    it('accepts `int64 get()` as a class method name', () => {
        expectClean(`class C { int64 get() { return 0; } }`);
    });

    it('accepts `int64 set(int64 v)` as a class method name', () => {
        expectClean(`class C { int64 set(int64 v) { return v; } }`);
    });

    it('accepts `int64 out()` as a class method name', () => {
        expectClean(`class C { int64 out() { return 0; } }`);
    });

    it('accepts a struct field named `get`', () => {
        expectClean(`struct S { int64 get; }`);
    });
});
