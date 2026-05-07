import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';
import { NodeKind } from '../../../src/compiler_parser/nodes';

describe('Parser — lambdas (bracket and arrow)', () => {
    it('parses bracket-form lambda with explicit return type', () => {
        const r = parseSource(`
            void f() {
                int32 v = [](int32 a, int32 b) -> int32 { return a + b; }(1, 2);
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('parses arrow-form lambda with expression body', () => {
        const r = parseSource(`
            void f() {
                int32 v = (int32 x) => x * 2;
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const fn = r.ast.children[0] as any;
        const stmt = fn.body.stmts[0];
        assert.strictEqual(stmt.initializer.kind, NodeKind.ExprLambdaArrow);
    });

    it('parses lambda with by-value capture', () => {
        const r = parseSource(`
            void f() {
                int32 base = 10;
                int32 add = [base](int32 x) -> int32 { return base + x; }(5);
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('parses lambda with by-reference capture', () => {
        const r = parseSource(`
            void f() {
                int32 v = 0;
                [&v]() -> void { v = v + 1; }();
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('parses lambda with default by-value capture', () => {
        const r = parseSource(`
            void f() {
                int32 v = 0;
                [=]() -> int32 { return v; }();
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });
});
