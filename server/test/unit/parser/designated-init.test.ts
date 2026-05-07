import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';
import { NodeKind } from '../../../src/compiler_parser/nodes';

describe('Parser — designated initializers', () => {
    it('parses designated init in var initializer', () => {
        const r = parseSource(`Point p = { .x = 1, .y = 2 };`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const v = r.ast.children[0] as any;
        assert.strictEqual(v.initializer.kind, NodeKind.ExprDesignatedInit);
        assert.strictEqual(v.initializer.fields.length, 2);
    });

    it('parses array init', () => {
        const r = parseSource(`array<int32> nums = { 1, 2, 3, 4 };`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const v = r.ast.children[0] as any;
        assert.strictEqual(v.initializer.kind, NodeKind.ExprArrayInit);
        assert.strictEqual(v.initializer.elements.length, 4);
    });

    it('handles trailing comma in designated init', () => {
        const r = parseSource(`Point p = { .x = 1, .y = 2, };`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });
});
