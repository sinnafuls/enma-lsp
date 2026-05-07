import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';
import { NodeKind } from '../../../src/compiler_parser/nodes';

describe('Parser — user-defined literals (UDL)', () => {
    it('combines TokenNumber + TokenIdentifier(_suffix) into ExprLiteralUserDefined', () => {
        const r = parseSource(`const int64 D = 42_km;`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const v = r.ast.children[0] as any;
        const init = v.initializer;
        assert.strictEqual(init.kind, NodeKind.ExprLiteralUserDefined);
        assert.strictEqual(init.suffix.text, '_km');
    });

    it('handles float UDL', () => {
        const r = parseSource(`const float32 D = 1.5f_meter;`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('plain number without _suffix is regular literal', () => {
        const r = parseSource(`int64 a = 42;`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const v = r.ast.children[0] as any;
        assert.strictEqual(v.initializer.kind, NodeKind.ExprLiteralInt);
    });
});
