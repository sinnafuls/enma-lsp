import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';

describe('Parser — annotations [[...]]', () => {
    it('parses single annotation without args', () => {
        const r = parseSource(`[[reflect]] struct S { int32 x; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const s = r.ast.children[0] as any;
        assert.strictEqual(s.annotations.length, 1);
        assert.strictEqual(s.annotations[0].name.text, 'reflect');
    });

    it('parses annotation with int arg', () => {
        const r = parseSource(`[[align(16)]] struct S { int32 x; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const s = r.ast.children[0] as any;
        assert.strictEqual(s.annotations[0].args.length, 1);
    });

    it('parses annotation with string arg', () => {
        const r = parseSource(`[[dll("user32.dll")]] extern int32 MessageBoxA(int64 h);`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });

    it('parses stacked annotations', () => {
        const r = parseSource(`
            [[reflect]] [[serialize]]
            struct S { int32 x; }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const s = r.ast.children[0] as any;
        assert.strictEqual(s.annotations.length, 2);
    });

    it('parses inline annotation on method', () => {
        const r = parseSource(`
            class A {
                [[inline]]
                void m() { return; }
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });
});
