import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';
import { NodeKind } from '../../../src/compiler_parser/nodes';

describe('Parser — match expression (Enma-specific)', () => {
    it('parses simple match with arms and wildcard', () => {
        const r = parseSource(`
            int32 f(int32 x) {
                int32 r = match (x) {
                    0 => 100,
                    1 => 200,
                    _ => 0
                };
                return r;
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const fn = r.ast.children[0] as any;
        const stmt = fn.body.stmts[0];
        const initExpr = stmt.initializer;
        assert.strictEqual(initExpr.kind, NodeKind.ExprMatch);
        assert.strictEqual(initExpr.arms.length, 3);
        assert.strictEqual(initExpr.arms[2].isWildcard, true);
    });

    it('match arms use => not :', () => {
        const r = parseSource(`int32 f() { int32 v = match(1) { _ => 0 }; return v; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('match is an expression (returns a value)', () => {
        const r = parseSource(`int32 g(int32 x) { return match(x) { 1 => 1, _ => 0 }; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('handles trailing comma after last arm', () => {
        const r = parseSource(`
            int32 f() {
                int32 v = match(1) {
                    0 => 1,
                    _ => 2,
                };
                return v;
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });
});
