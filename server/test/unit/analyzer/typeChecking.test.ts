// Type-checking second-pass tests (week 2).
//
// Covers the expression/statement analyzer added in Phase B:
//   - scope-region emission (local variable navigation)
//   - variable initializer conversion errors
//   - return-type conversion errors
//   - overload resolution (ranked + arity + template wildcards)
//   - float-truncation and float-narrowing diagnostics
//   - derived-to-base pointer upcasting
//   - enum → integer implicit conversion

import * as assert from 'node:assert/strict';
import { analyzeSource, errorsOnly } from './_helpers';
import { findScopeContainingPosition } from '../../../src/compiler_analyzer/symbolScope';

// ---- Helper ---------------------------------------------------------------

/** Caret at 0-indexed (line, char). */
function caret(line: number, character: number) { return { line, character }; }

// ---- Scope regions --------------------------------------------------------

describe('Analyzer second pass — scope regions', () => {
    it('emits a scope region for a function body', () => {
        const r = analyzeSource(`
            void foo(int32 x) {
                int32 y = x;
            }
        `);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
        const regions = r.analyzerScope.globalScope.info.scopeRegion;
        assert.ok(regions.length > 0, 'at least one scope region emitted');
    });

    it('resolves a parameter inside a function body via scope region', () => {
        const r = analyzeSource(`
            void greet(int32 age) {
                int32 z = age;
            }
        `);
        // Line 2, inside the body — should resolve to the function's scope
        // which contains `age`.
        const { scope } = findScopeContainingPosition(r.analyzerScope.globalScope, 2, 24);
        const ageHolder = scope.lookupSymbolWithParent('age');
        assert.ok(ageHolder !== undefined, 'parameter `age` findable at body position');
    });

    it('resolves a local variable declared in the body', () => {
        const r = analyzeSource(`
            void bar() {
                int64 counter = 0;
                counter = 1;
            }
        `);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
        const { scope } = findScopeContainingPosition(r.analyzerScope.globalScope, 2, 20);
        const v = scope.lookupSymbolWithParent('counter');
        assert.ok(v !== undefined, 'local var `counter` findable in scope region');
    });
});

// ---- Variable initializer type checking ----------------------------------

describe('Analyzer second pass — variable initializer diagnostics', () => {
    it('accepts int64 literal into int32 variable (literal exemption)', () => {
        const r = analyzeSource(`void f() { int32 x = 5; }`);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
    });

    it('accepts float literal into float32 variable (literal exemption)', () => {
        const r = analyzeSource(`void f() { float32 x = 1.5; }`);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
    });

    it('catches float64 → float32 narrowing', () => {
        const r = analyzeSource(`
            float64 src() { return 0.0; }
            void f() { float32 x = src(); }
        `);
        const errs = errorsOnly(r.analyzerDiagnostics);
        assert.ok(errs.some(e => e.code === 'EN_CONV_NARROW'), 'EN_CONV_NARROW emitted for float64→float32');
    });

    it('catches float → int truncation', () => {
        const r = analyzeSource(`
            float32 src() { return 0.0; }
            void f() { int32 x = src(); }
        `);
        const errs = errorsOnly(r.analyzerDiagnostics);
        assert.ok(errs.some(e => e.code === 'EN_CONV_TRUNC'), 'EN_CONV_TRUNC emitted for float→int');
    });

    it('does NOT flag uint32 → int64 (engine allows cross-sign widening)', () => {
        const r = analyzeSource(`
            uint32 src() { return 0; }
            void f() { int64 x = src(); }
        `);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
    });

    it('does NOT flag auto variable (deduced from initializer)', () => {
        const r = analyzeSource(`void f() { auto x = 42; }`);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
    });
});

// ---- Return type checking ------------------------------------------------

describe('Analyzer second pass — return type diagnostics', () => {
    it('catches float return in float32 function', () => {
        const r = analyzeSource(`
            float64 get_val() { return 0.0; }
            float32 narrow() { return get_val(); }
        `);
        const errs = errorsOnly(r.analyzerDiagnostics);
        assert.ok(errs.some(e => e.code === 'EN_CONV_NARROW'), 'EN_CONV_NARROW on return');
    });

    it('accepts int return literal (literal exemption)', () => {
        const r = analyzeSource(`int32 answer() { return 42; }`);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
    });

    it('does NOT flag void return', () => {
        const r = analyzeSource(`void noop() { return; }`);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
    });
});

// ---- Overload resolution -------------------------------------------------

describe('Analyzer second pass — overload resolution', () => {
    it('picks exact overload for int32 argument', () => {
        const r = analyzeSource(`
            void f(int32 x) {}
            void f(float32 x) {}
            void test() { f(0); }
        `);
        // Exact match (literal 0 → int64, both overloads viable, int32 wins on cost)
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
    });

    it('emits EN_NO_OVERLOAD when no arity match', () => {
        const r = analyzeSource(`
            void f(int32 x) {}
            void test() { f(1, 2); }
        `);
        const errs = errorsOnly(r.analyzerDiagnostics);
        assert.ok(errs.some(e => e.code === 'EN_NO_OVERLOAD'), 'EN_NO_OVERLOAD for arity mismatch');
    });

    it('resolves member method call', () => {
        const r = analyzeSource(`
            class Counter {
                int32 count;
                int32 get() { return count; }
            }
            void test() {
                Counter c;
                int32 v = c.get();
            }
        `);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
    });

    it('resolves constructor call with matching args', () => {
        const r = analyzeSource(`
            class Pt {
                float32 x;
                float32 y;
                Pt(float32 a, float32 b) { x = a; y = b; }
            }
            void test() {
                Pt* p = new Pt(1.0, 2.0);
            }
        `);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
    });
});

// ---- Conversion lattice --------------------------------------------------

describe('Analyzer — conversion cost lattice', () => {
    it('enum argument accepted by integer-typed function', () => {
        const r = analyzeSource(`
            enum Color { Red, Green, Blue }
            void use_int(int32 v) {}
            void test() { use_int(Color::Red); }
        `);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
    });

    it('derived pointer accepted by base pointer parameter', () => {
        const r = analyzeSource(`
            class Base { int32 v; }
            class Derived : Base { int32 extra; }
            void take(Base* b) {}
            void test() {
                Derived* d = new Derived();
                take(d);
            }
        `);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
    });
});

// ---- Nested constructs ----------------------------------------------------

describe('Analyzer — nested construct scope', () => {
    it('for-loop variable visible inside loop body', () => {
        const r = analyzeSource(`
            void test() {
                for (int32 i = 0; i < 10; i++) {
                    int32 tmp = i;
                }
            }
        `);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
        const { scope } = findScopeContainingPosition(r.analyzerScope.globalScope, 3, 28);
        const iSym = scope.lookupSymbolWithParent('i');
        assert.ok(iSym !== undefined, '`i` findable in for-body scope');
    });

    it('if-init variable scoped to the if block', () => {
        const r = analyzeSource(`
            int32 get() { return 1; }
            void test() {
                if (int32 v = get(); v > 0) {
                    int32 y = v;
                }
            }
        `);
        assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
    });
});
