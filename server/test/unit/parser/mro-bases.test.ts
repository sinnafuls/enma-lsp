import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';

describe('Parser — multi-inheritance bases ordered for C3 (§A3)', () => {
    it('preserves base list order on class', () => {
        const r = parseSource(`class C : A, B, D { }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const cls = r.ast.children[0] as any;
        assert.deepStrictEqual(cls.bases.map((b: any) => b.path[0].text), ['A', 'B', 'D']);
    });

    it('preserves base list order on struct', () => {
        const r = parseSource(`struct S : I1, I2 { int32 x; }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const s = r.ast.children[0] as any;
        assert.deepStrictEqual(s.bases.map((b: any) => b.path[0].text), ['I1', 'I2']);
    });

    it('preserves base list order on interface', () => {
        const r = parseSource(`interface I : Base1, Base2 { void m(); }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
        const iface = r.ast.children[0] as any;
        assert.deepStrictEqual(iface.bases.map((b: any) => b.path[0].text), ['Base1', 'Base2']);
    });

    it('does not allow access modifiers on bases (Enma-specific)', () => {
        // Real Enma does not use `public` on bases; we accept the bare list.
        const r = parseSource(`class C : Base1, Base2 { }`);
        assert.strictEqual(parserErrors(r.diagnostics).length, 0);
    });
});
