// Smoke test — Phase 4 week-1 foundation.
// Drives the analyzer pipeline end-to-end on small fixtures. Asserts the
// foundation files (analyzerDiagnostic, builtinType, resolvedType,
// symbolObject, symbolScope, hoist, analyzer skeleton, enmaTypes) compose.

import * as assert from 'node:assert/strict';
import { analyzeSource, errorsOnly } from './_helpers';
import {
    builtinInt32,
    builtinString,
    tryGetBuiltinType,
    isNumberType,
    isFloatType,
    isIntegerType,
} from '../../../src/compiler_analyzer/builtinType';
import {
    ResolvedType,
    AutoPendingType,
} from '../../../src/compiler_analyzer/resolvedType';
import { SymbolType, SymbolFunction } from '../../../src/compiler_analyzer/symbolObject';
import { autoPendingPlaceholder, isAutoPending } from '../../../src/compiler_analyzer/autoResolution';

describe('Analyzer foundation — week 1', () => {
    describe('builtinType', () => {
        it('looks up primitives by name', () => {
            assert.equal(tryGetBuiltinType('int32'), builtinInt32);
            assert.equal(tryGetBuiltinType('string'), builtinString);
            assert.equal(tryGetBuiltinType('not_a_real_type'), undefined);
        });

        it('classifies numbers correctly', () => {
            assert.ok(isNumberType(builtinInt32));
            assert.ok(isIntegerType(builtinInt32));
            assert.ok(!isFloatType(builtinInt32));
            assert.ok(isFloatType(tryGetBuiltinType('float64')!));
            assert.ok(!isNumberType(builtinString));
        });

        it('removed `auto` from primitives (§A4-N4)', () => {
            assert.equal(tryGetBuiltinType('auto'), undefined);
        });
    });

    describe('resolvedType — AutoPendingType', () => {
        it('exposes a unique sentinel symbol', () => {
            assert.equal(typeof AutoPendingType, 'symbol');
        });

        it('autoPending placeholder reports isAutoPending=true', () => {
            const p = autoPendingPlaceholder();
            assert.ok(p.isAutoPending);
            assert.ok(isAutoPending(p));
        });

        it('decoration round-trips', () => {
            const t = new ResolvedType(builtinInt32);
            const dec = t.cloneWithDecoration({ pointerLevel: 2, isConst: true });
            assert.equal(dec.pointerLevel, 2);
            assert.equal(dec.isConst, true);
            assert.equal(dec.typeOrFunc, builtinInt32);
        });
    });

    describe('hoist — top-level symbol registration', () => {
        it('registers a free function', () => {
            const r = analyzeSource(`
                int32 main() {
                    return 0;
                }
            `);
            assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
            const main = r.analyzerScope.globalScope.lookupScope('main');
            assert.ok(main, 'function-holder scope for "main" exists');
        });

        it('registers a class with members', () => {
            const r = analyzeSource(`
                class Vec3 {
                    float32 x;
                    float32 y;
                    float32 z;
                }
            `);
            const vec = r.analyzerScope.globalScope.lookupSymbol('Vec3');
            assert.ok(vec, 'Vec3 symbol exists');
            assert.ok(vec instanceof SymbolType, 'Vec3 is a SymbolType');
            const vecScope = r.analyzerScope.globalScope.lookupScope('Vec3');
            assert.ok(vecScope, 'Vec3 scope exists');
            assert.ok(vecScope!.lookupSymbol('x'), 'field x registered');
            assert.ok(vecScope!.lookupSymbol('y'), 'field y registered');
            assert.ok(vecScope!.lookupSymbol('z'), 'field z registered');
        });

        it('registers a namespace and nested types', () => {
            const r = analyzeSource(`
                namespace geom {
                    class Point {
                        int32 x;
                        int32 y;
                    }
                }
            `);
            const ns = r.analyzerScope.globalScope.lookupScope('geom');
            assert.ok(ns, 'geom scope exists');
            assert.ok(ns!.lookupSymbol('Point'), 'Point registered inside geom');
        });

        it('detects duplicate top-level symbols', () => {
            const r = analyzeSource(`
                class Foo {}
                class Foo {}
            `);
            const errs = errorsOnly(r.analyzerDiagnostics);
            assert.ok(errs.length >= 1, 'duplicate class triggers diagnostic');
            assert.match(errs[0].message, /already declared/);
        });

        it('flags `auto` without an initializer', () => {
            const r = analyzeSource(`
                auto x;
            `);
            const errs = errorsOnly(r.analyzerDiagnostics);
            assert.ok(
                errs.some(e => e.code === 'EN_AUTO_NO_INIT'),
                'auto-without-init diagnostic fired',
            );
        });

        it('captures multi-inheritance bases (§A3)', () => {
            const r = analyzeSource(`
                interface IDrawable {}
                interface ISerializable {}
                class Widget : IDrawable, ISerializable {}
            `);
            const widget = r.analyzerScope.globalScope.lookupSymbol('Widget');
            assert.ok(widget instanceof SymbolType);
            assert.equal((widget as SymbolType).baseList.length, 2);
        });

        it('registers enum values inside an enum scope', () => {
            const r = analyzeSource(`
                enum Color {
                    Red,
                    Green,
                    Blue
                }
            `);
            const color = r.analyzerScope.globalScope.lookupScope('Color');
            assert.ok(color, 'Color scope exists');
            assert.ok(color!.lookupSymbol('Red'), 'Red enum value');
            assert.ok(color!.lookupSymbol('Green'), 'Green enum value');
            assert.ok(color!.lookupSymbol('Blue'), 'Blue enum value');
        });
    });

    describe('analyzeType — qualified names', () => {
        it('resolves nested namespace types', () => {
            const r = analyzeSource(`
                namespace geom {
                    class Point {}
                }
                geom::Point p;
            `);
            assert.equal(errorsOnly(r.analyzerDiagnostics).length, 0);
        });

        it('errors on unknown type', () => {
            const r = analyzeSource(`
                Banana p;
            `);
            const errs = errorsOnly(r.analyzerDiagnostics);
            assert.ok(errs.some(e => /Unknown type 'Banana'/.test(e.message)));
        });
    });

    describe('SymbolFunction overloading', () => {
        it('groups two same-named functions into one holder', () => {
            const r = analyzeSource(`
                void f(int32 x) {}
                void f(string s) {}
            `);
            // Should not double-register or error.
            const errs = errorsOnly(r.analyzerDiagnostics);
            assert.equal(errs.length, 0);
            const holder = r.analyzerScope.globalScope.lookupSymbol('f');
            assert.ok(holder, 'f exists');
            // Holder has two overloads
            const list = (holder as { toList(): readonly SymbolFunction[] }).toList();
            assert.equal(list.length, 2);
        });
    });
});
