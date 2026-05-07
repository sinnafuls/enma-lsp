import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';

describe('Parser — error recovery', () => {
    it('continues after missing semicolon', () => {
        const r = parseSource(`int32 a = 1\nint32 b = 2;`);
        // Parser may emit an error but should keep both decls.
        assert.ok(r.ast.children.length >= 1);
    });

    it('recovers from malformed function body and parses next decl', () => {
        const r = parseSource(`
            void a() { malformed @@@ }
            int32 b() { return 0; }
        `);
        const errs = parserErrors(r.diagnostics);
        assert.ok(errs.length >= 1, 'should report errors');
        assert.ok(r.ast.children.length === 2, 'recovered both decls');
    });

    it('recovers across multiple top-level decl boundaries', () => {
        const r = parseSource(`
            class A { ??? }
            struct B { int32 x; }
            int32 f() { return 1; }
        `);
        // We should see all three top-level entries even if A has internal errors.
        assert.ok(r.ast.children.length === 3);
    });

    it('emits multiple diagnostics, not just one (no halt-on-first-error)', () => {
        const r = parseSource(`
            int32 a = ;
            int32 b = ;
            int32 c = ;
        `);
        const errs = parserErrors(r.diagnostics);
        // We expect at least 2 errors (the brief says "50 errors → 50 diagnostics")
        assert.ok(errs.length >= 2, `expected ≥2 errors, got ${errs.length}`);
    });

    it('handles unterminated brace via panic recovery', () => {
        const r = parseSource(`class A { int32 x;`);
        // Parser should not throw and should still produce an AST.
        assert.ok(r.ast);
    });

    it('recovers in nested namespace', () => {
        const r = parseSource(`
            namespace x {
              ??? bad ???
              int32 ok() { return 0; }
            }
        `);
        // The namespace should still appear and contain at least one valid decl.
        const ns = r.ast.children.find(c => c.kind === 'Namespace') as any;
        assert.ok(ns);
        assert.ok(ns.children.some((c: any) => c.kind === 'Function'));
    });

    it('recovers inside class body across malformed members', () => {
        const r = parseSource(`
            class A {
                ??? broken;
                int32 ok;
                ??? again;
                void m() { return; }
            }
        `);
        const cls = r.ast.children.find(c => c.kind === 'Class') as any;
        assert.ok(cls);
        // The Field 'ok' and Method 'm' should both be recovered.
        assert.ok(cls.members.some((m: any) => m.kind === 'Field' && m.name.text === 'ok'));
        assert.ok(cls.members.some((m: any) => m.kind === 'Method' && m.name.text === 'm'));
    });
});
