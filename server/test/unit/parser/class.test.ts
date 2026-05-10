import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';
import { NodeKind } from '../../../src/compiler_parser/nodes';

describe('Parser — class / struct / interface (§A3 multi-inheritance)', () => {
    it('parses a class with no bases', () => {
        const r = parseSource(`class A { int32 x; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const cls = r.ast.children[0] as any;
        assert.strictEqual(cls.kind, NodeKind.Class);
        assert.strictEqual(cls.name.text, 'A');
        assert.strictEqual(cls.bases.length, 0);
    });

    it('parses single-base class', () => {
        const r = parseSource(`class B : A { }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const cls = r.ast.children[0] as any;
        assert.strictEqual(cls.bases.length, 1);
        assert.strictEqual(cls.bases[0].path[0].text, 'A');
    });

    it('parses multi-inheritance with base order preserved (§A3)', () => {
        const r = parseSource(`class C : Base1, Base2, Base3 { }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const cls = r.ast.children[0] as any;
        assert.strictEqual(cls.bases.length, 3);
        assert.strictEqual(cls.bases[0].path[0].text, 'Base1');
        assert.strictEqual(cls.bases[1].path[0].text, 'Base2');
        assert.strictEqual(cls.bases[2].path[0].text, 'Base3');
    });

    it('parses constructor and destructor', () => {
        const r = parseSource(`
            class Entity {
                int32 hp;
                Entity(int32 h) { this.hp = h; }
                ~Entity() { }
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const cls = r.ast.children[0] as any;
        const ctors = cls.members.filter((m: any) => m.kind === NodeKind.Constructor);
        const dtors = cls.members.filter((m: any) => m.kind === NodeKind.Destructor);
        assert.strictEqual(ctors.length, 1);
        assert.strictEqual(dtors.length, 1);
    });

    it('parses override method', () => {
        const r = parseSource(`
            class A : B {
                override void draw() { return; }
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const cls = r.ast.children[0] as any;
        const m = cls.members.find((mm: any) => mm.kind === NodeKind.Method);
        assert.ok(m);
        assert.ok(m.modifiers.some((mod: any) => mod.text === 'override'));
    });

    it('parses trailing modifiers on methods (override / final / const)', () => {
        const r = parseSource(`
            class CountingSink : CaptureSink {
                int64 bytes;
                void accept(string row) override { bytes += row.length(); }
                int32 size() const final { return bytes; }
                bool ready() override;
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const cls = r.ast.children[0] as any;
        const methods = cls.members.filter((mm: any) => mm.kind === NodeKind.Method);
        assert.strictEqual(methods.length, 3);
        assert.ok(methods[0].modifiers.some((m: any) => m.text === 'override'));
        assert.ok(methods[1].modifiers.some((m: any) => m.text === 'const'));
        assert.ok(methods[1].modifiers.some((m: any) => m.text === 'final'));
        assert.ok(methods[2].modifiers.some((m: any) => m.text === 'override'));
    });

    it('parses virtual / final / friend modifiers on methods', () => {
        const r = parseSource(`
            class V {
                virtual void accept(string row) { rows++; }
                final int32 f() { return 1; }
                friend void g();
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const cls = r.ast.children[0] as any;
        const methods = cls.members.filter((mm: any) => mm.kind === NodeKind.Method);
        assert.strictEqual(methods.length, 3);
        assert.ok(methods[0].modifiers.some((m: any) => m.text === 'virtual'));
        assert.ok(methods[1].modifiers.some((m: any) => m.text === 'final'));
        assert.ok(methods[2].modifiers.some((m: any) => m.text === 'friend'));
    });

    it('parses interface with method declarations', () => {
        const r = parseSource(`
            interface Drawable {
                void draw();
                int32 zorder();
            }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const iface = r.ast.children[0] as any;
        assert.strictEqual(iface.kind, NodeKind.Interface);
        assert.strictEqual(iface.members.length, 2);
        for (const m of iface.members) {
            assert.strictEqual(m.kind, NodeKind.Method);
            assert.strictEqual(m.body, null);
        }
    });

    it('parses scoped enum (`enum class` / `enum struct`)', () => {
        const a = parseSource(`enum class CaptureKind { None = 0, Aim = 1, Ballistic = 2 }`);
        assert.strictEqual(parserErrors(a.diagnostics).length, 0);
        const ea = a.ast.children[0] as any;
        assert.strictEqual(ea.kind, NodeKind.Enum);
        assert.strictEqual(ea.name.text, 'CaptureKind');
        assert.strictEqual(ea.values.length, 3);

        const b = parseSource(`enum struct Foo { A, B }`);
        assert.strictEqual(parserErrors(b.diagnostics).length, 0);
        assert.strictEqual((b.ast.children[0] as any).name.text, 'Foo');

        const plain = parseSource(`enum Plain { X = 1 }`);
        assert.strictEqual(parserErrors(plain.diagnostics).length, 0);
    });

    it('parses struct with annotations', () => {
        const r = parseSource(`
            [[packed]]
            struct Wire { uint8 a; uint32 b; }
        `);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const s = r.ast.children[0] as any;
        assert.strictEqual(s.kind, NodeKind.Struct);
        assert.strictEqual(s.annotations.length, 1);
        assert.strictEqual(s.annotations[0].name.text, 'packed');
    });
});
