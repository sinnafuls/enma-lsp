process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture, pos } from './_helpers';
import { provideSignatureHelp } from '../../../src/services/signatureHelp';

const URI = 'file:///sig.em';

describe('signatureHelp service', () => {
    it('after `foo(` returns 1 signature, active param 0', () => {
        const src = 'int32 foo(int32 a, int32 b) { return a; }\nint32 use() { return foo( ; }';
        const f = buildFixture(URI, src);
        const h = provideSignatureHelp(f.analyzerScope.globalScope, f.rawTokens, pos(1, 26));
        assert.ok(h, 'expected signature help');
        assert.equal(h!.signatures.length, 1);
        assert.equal(h!.activeParameter, 0);
    });

    it('after `foo(a,` activeParameter is 1', () => {
        const src = 'int32 foo(int32 a, int32 b) { return a; }\nint32 use() { return foo(1, 2); }';
        const f = buildFixture(URI, src);
        // After comma in `foo(1, 2)` — caret right after the comma+space (col 28).
        const h = provideSignatureHelp(f.analyzerScope.globalScope, f.rawTokens, pos(1, 28));
        assert.ok(h, 'expected signature help');
        assert.equal(h!.activeParameter, 1);
    });

    it('overloaded function returns multiple signatures', () => {
        const src = 'int32 foo(int32 a) { return a; }\nint32 foo(int32 a, int32 b) { return a; }\nint32 use() { return foo( ; }';
        const f = buildFixture(URI, src);
        const h = provideSignatureHelp(f.analyzerScope.globalScope, f.rawTokens, pos(2, 26));
        assert.ok(h, 'expected signature help');
        assert.ok(h!.signatures.length >= 2, `expected ≥2 sigs; got ${h!.signatures.length}`);
    });

    it('inside parenthesized expression (not call) returns undefined', () => {
        const src = 'int32 use() { int32 a = (1 + 2 ); return a; }';
        const f = buildFixture(URI, src);
        const h = provideSignatureHelp(f.analyzerScope.globalScope, f.rawTokens, pos(0, 30));
        assert.equal(h, undefined);
    });
});
