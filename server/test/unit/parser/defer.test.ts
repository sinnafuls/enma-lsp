import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';
import { NodeKind } from '../../../src/compiler_parser/nodes';

describe('Parser — defer (Enma-specific)', () => {
    it('parses defer block', () => {
        const r = parseSource(`
            void f() {
                int32 h = 0;
                defer { close(h); }
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const fn = r.ast.children[0] as any;
        const def = fn.body.stmts[1];
        assert.strictEqual(def.kind, NodeKind.StmtDefer);
        assert.strictEqual(def.body.kind, NodeKind.StmtBlock);
    });

    it('defer body can have multiple statements', () => {
        const r = parseSource(`
            void f() {
                defer {
                    a();
                    b();
                    c();
                }
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });
});
