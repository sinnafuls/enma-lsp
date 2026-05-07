import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';
import { NodeKind } from '../../../src/compiler_parser/nodes';

describe('Parser — templates', () => {
    it('parses template function', () => {
        const r = parseSource(`
            template<typename T>
            T id(T x) { return x; }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const tpl = r.ast.children[0] as any;
        assert.strictEqual(tpl.kind, NodeKind.Template);
        assert.strictEqual(tpl.params.length, 1);
        assert.strictEqual(tpl.body.kind, NodeKind.Function);
    });

    it('parses template with multiple type params', () => {
        const r = parseSource(`
            template<typename K, typename V>
            V at(map<K, V> m, K key) { return m[key]; }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('parses generic type usage', () => {
        const r = parseSource(`
            int32 f(array<int32> nums, map<string, int64> tags) { return 0; }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const fn = r.ast.children[0] as any;
        assert.strictEqual(fn.params[0].type.path[0].text, 'array');
        assert.strictEqual(fn.params[0].type.generics.length, 1);
    });
});
