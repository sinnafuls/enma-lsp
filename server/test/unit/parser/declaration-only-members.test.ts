import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';
import { NodeKind } from '../../../src/compiler_parser/nodes';

// Predefined files (`.em.predefined`) declare API surface only — they have no
// method bodies. Constructors and destructors must therefore accept the
// declaration-only form `Name(...);` / `~Name();` (no block).

describe('Parser — declaration-only constructors/destructors (.em.predefined form)', () => {
    it('parses constructor with `;` instead of body', () => {
        const r = parseSource(`class color {
            int64 r;
            color();
            color(int64 a, int64 b);
        }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const cls = r.ast.children[0] as any;
        assert.strictEqual(cls.kind, NodeKind.Class);
        const ctors = cls.members.filter((m: any) => m.kind === NodeKind.Constructor);
        assert.strictEqual(ctors.length, 2);
        assert.strictEqual(ctors[0].body, null);
        assert.strictEqual(ctors[1].body, null);
        assert.strictEqual(ctors[1].params.length, 2);
    });

    it('parses destructor with `;` instead of body', () => {
        const r = parseSource(`class file_t {
            ~file_t();
        }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const cls = r.ast.children[0] as any;
        const dtor = cls.members.find((m: any) => m.kind === NodeKind.Destructor);
        assert.ok(dtor);
        assert.strictEqual(dtor.body, null);
    });

    it('still parses constructor with a real body block', () => {
        const r = parseSource(`class A {
            int64 x;
            A() { x = 0; }
        }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const cls = r.ast.children[0] as any;
        const ctor = cls.members.find((m: any) => m.kind === NodeKind.Constructor);
        assert.ok(ctor);
        assert.notStrictEqual(ctor.body, null);
    });
});
