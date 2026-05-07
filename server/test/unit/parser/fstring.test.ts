import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';
import { NodeKind, NodeFStringPart } from '../../../src/compiler_parser/nodes';

describe('Parser — f-strings (§A2 boundary tokens)', () => {
    it('parses simple f-string with one interpolation', () => {
        const r = parseSource(`void f() { string s = f"hello {name}"; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const fn = r.ast.children[0] as any;
        const initExpr = fn.body.stmts[0].initializer;
        assert.strictEqual(initExpr.kind, NodeKind.ExprFString);
        const exprParts = initExpr.parts.filter((p: NodeFStringPart) => p.kind === 'expr');
        assert.strictEqual(exprParts.length, 1);
    });

    it('parses f-string with multiple interpolations', () => {
        const r = parseSource(`void f() { string s = f"a={a}, b={b}, c={c}"; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const fn = r.ast.children[0] as any;
        const initExpr = fn.body.stmts[0].initializer;
        const exprParts = initExpr.parts.filter((p: NodeFStringPart) => p.kind === 'expr');
        assert.strictEqual(exprParts.length, 3);
    });

    it('parses f-string with binary expression interpolation', () => {
        const r = parseSource(`void f() { string s = f"sum={a + b * 2}"; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('parses f-string with member access interpolation', () => {
        const r = parseSource(`void f() { string s = f"name={obj.name}"; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('parses f-string with index expression interpolation', () => {
        const r = parseSource(`void f() { string s = f"x={arr[0]}"; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('parses nested f-string (depth 2) per parser-decision Q3', () => {
        const r = parseSource(`void f() { string s = f"a={f"b={x}"}"; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });
});
