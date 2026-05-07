// Bug D: multi-binding foreach `for (T1 a, T2 b : iterable)`.
// Per the angel-lsp BNF, foreach permits a list of `Type Identifier`
// bindings separated by commas, then a single `:` and the iterable.
// This is map-iteration: `k` gets keys, `v` gets values.
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

function expectError(src: string): void {
    const r = parseSource(src);
    const errs = parserErrors(r.diagnostics);
    assert.ok(errs.length > 0, `expected parser errors, got none`);
}

describe('multi-binding foreach (Bug D)', () => {
    it('still parses single-binding foreach: `for (int32 v : nums)`', () => {
        expectClean(`void f(array<int32> nums) { for (int32 v : nums) {} }`);
    });

    it('parses kv map iteration: `for (string k, int64 v : m)`', () => {
        expectClean(`void f(map<string, int64> m) { for (string k, int64 v : m) {} }`);
    });

    it('parses index/value form: `for (int32 i, int32 v : indexed)`', () => {
        expectClean(`void f(array<int32> indexed) { for (int32 i, int32 v : indexed) {} }`);
    });

    it('rejects trailing comma: `for (T a, : x)`', () => {
        expectError(`void f(array<int32> x) { for (int32 a, : x) {} }`);
    });
});
