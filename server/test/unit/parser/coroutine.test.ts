import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';
import { NodeKind } from '../../../src/compiler_parser/nodes';

describe('Parser — coroutine + yield', () => {
    it('parses coroutine declaration', () => {
        const r = parseSource(`
            coroutine int32 g() {
                int32 i = 0;
                while (i < 10) {
                    yield i;
                    i = i + 1;
                }
                return 0;
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const co = r.ast.children[0] as any;
        assert.strictEqual(co.kind, NodeKind.Coroutine);
    });

    it('parses bare yield ;', () => {
        const r = parseSource(`coroutine void g() { yield; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });
});
