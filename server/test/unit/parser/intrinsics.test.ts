import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';
import { NodeKind } from '../../../src/compiler_parser/nodes';

describe('Parser — intrinsics + variadic', () => {
    it('parses __va_count without parens', () => {
        const r = parseSource(`int64 f(...) { int64 n = __va_count; return n; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('parses __va_arg with index argument', () => {
        const r = parseSource(`int64 f(...) { int64 v = __va_arg(0); return v; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('parses __asm_rdtsc / __asm_pause', () => {
        const r = parseSource(`int64 g() { int64 t = __asm_rdtsc(); __asm_pause(); return t; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('captures intrinsic node kind', () => {
        const r = parseSource(`int64 f() { int64 n = __va_count; return n; }`);
        const fn = r.ast.children[0] as any;
        const initExpr = fn.body.stmts[0].initializer;
        assert.strictEqual(initExpr.kind, NodeKind.ExprIntrinsic);
        assert.strictEqual(initExpr.name.text, '__va_count');
        assert.strictEqual(initExpr.hasParens, false);
    });
});
