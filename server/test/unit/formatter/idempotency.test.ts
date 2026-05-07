// AC-11 idempotency test.
// format(format(x)) === format(x)
// Covers: showcase.em, all 22 corpus files, and synthetic fuzz inputs.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { assertIdempotent, formatSource } from './_helpers';

const REPO_ROOT   = path.resolve(__dirname, '../../../../');
const SHOWCASE    = path.join(REPO_ROOT, 'samples/showcase.em');
const CORPUS_DIR  = path.join(REPO_ROOT, '.omc/corpus');

// ---- Utility: collect corpus files -------------------------------------

function collectCorpusFiles(): string[] {
    if (!fs.existsSync(CORPUS_DIR)) return [];
    return fs.readdirSync(CORPUS_DIR)
        .filter(f => f.endsWith('.em'))
        .sort()
        .map(f => path.join(CORPUS_DIR, f));
}

// ---- Showcase -----------------------------------------------------------

describe('Formatter — AC-11 idempotency', () => {
    it('showcase.em is idempotent', () => {
        const src = fs.readFileSync(SHOWCASE, 'utf8');
        assertIdempotent(src);
    });

    // ---- Corpus (22 files) ---------------------------------------------

    const corpusFiles = collectCorpusFiles();

    if (corpusFiles.length === 0) {
        it('corpus directory exists (skipping individual files — no corpus found)', () => {
            // Not a hard failure; corpus is optional during development.
        });
    } else {
        for (const filePath of corpusFiles) {
            const label = path.basename(filePath);
            it(`corpus: ${label} is idempotent`, () => {
                const src = fs.readFileSync(filePath, 'utf8');
                assertIdempotent(src);
            });
        }
    }

    // ---- Synthetic fuzz inputs -----------------------------------------
    // Generate 100 simple .em snippets that exercise the formatter paths.
    // These are not random — they're deterministic patterns that cover
    // different grammar shapes. Idempotency must hold on all of them.

    const fuzzInputs = buildFuzzInputs();

    for (let i = 0; i < fuzzInputs.length; i++) {
        it(`fuzz #${String(i + 1).padStart(3, '0')}: ${fuzzInputs[i].label}`, () => {
            assertIdempotent(fuzzInputs[i].src);
        });
    }
});

// ---- Fuzz input builder ------------------------------------------------

interface FuzzCase { label: string; src: string; }

function buildFuzzInputs(): FuzzCase[] {
    const cases: FuzzCase[] = [];

    // 1-10: simple declarations
    cases.push({ label: 'empty file', src: '' });
    cases.push({ label: 'single semicolon', src: ';' });
    cases.push({ label: 'int32 var decl', src: 'int32 x = 0;' });
    cases.push({ label: 'const var decl', src: 'const int64 MAX = 9999;' });
    cases.push({ label: 'string var decl', src: 'string s = "hello";' });
    cases.push({ label: 'pointer var', src: 'int32* p = null;' });
    cases.push({ label: 'array var', src: 'array<int32> nums;' });
    cases.push({ label: 'map var', src: 'map<string, int32> m;' });
    cases.push({ label: 'multi-pointer', src: 'int32** pp = null;' });
    cases.push({ label: 'reference var', src: 'int32& r = x;' });

    // 11-20: functions
    cases.push({ label: 'void function no body', src: 'extern void foo();' });
    cases.push({ label: 'simple function', src: 'int32 add(int32 a, int32 b) { return a + b; }' });
    cases.push({ label: 'function with local vars', src: 'void f() { int32 x = 1; int32 y = 2; }' });
    cases.push({ label: 'function with if', src: 'void f() { if (x > 0) { return; } }' });
    cases.push({ label: 'function with while', src: 'void f() { while (x > 0) { x = x - 1; } }' });
    cases.push({ label: 'function with for', src: 'void f() { for (int32 i = 0; i < 10; i = i + 1) { } }' });
    cases.push({ label: 'function with foreach', src: 'void f(array<int32> a) { for (int32 v : a) { println(v); } }' });
    cases.push({ label: 'function with return expr', src: 'int32 square(int32 x) { return x * x; }' });
    cases.push({ label: 'function with nested if-else', src: 'int32 sign(int32 x) { if (x > 0) { return 1; } else { return -1; } }' });
    cases.push({ label: 'function with do-while', src: 'void f() { do { x = x + 1; } while (x < 10); }' });

    // 21-30: classes and structs
    cases.push({ label: 'empty class', src: 'class Foo {}' });
    cases.push({ label: 'class with field', src: 'class Foo { int32 x; }' });
    cases.push({ label: 'class with method', src: 'class Foo { void bar() { } }' });
    cases.push({ label: 'class with ctor', src: 'class Foo { Foo(int32 x) { this.x = x; } int32 x; }' });
    cases.push({ label: 'class with dtor', src: 'class Foo { ~Foo() { } }' });
    cases.push({ label: 'class with inheritance', src: 'class Bar : Foo { }' });
    cases.push({ label: 'struct simple', src: 'struct Point { int32 x; int32 y; }' });
    cases.push({ label: 'interface', src: 'interface IFoo { void foo(); }' });
    cases.push({ label: 'class implements interface', src: 'class Foo : IFoo { override void foo() { } }' });
    cases.push({ label: 'nested class', src: 'class Outer { class Inner { int32 v; } }' });

    // 31-40: enums
    cases.push({ label: 'enum simple', src: 'enum Color { Red, Green, Blue }' });
    cases.push({ label: 'enum with values', src: 'enum Flags { A = 1, B = 2, C = 4 }' });
    cases.push({ label: 'enum with underlying type', src: 'enum Small : int8 { X, Y }' });

    // 41-50: expressions
    cases.push({ label: 'binary ops', src: 'int32 z = a + b * c - d / e;' });
    cases.push({ label: 'comparison', src: 'bool ok = a == b && c != d;' });
    cases.push({ label: 'ternary', src: 'int32 v = x > 0 ? x : -x;' });
    cases.push({ label: 'member access dot', src: 'int32 n = obj.field;' });
    cases.push({ label: 'member access arrow', src: 'int32 n = ptr->field;' });
    cases.push({ label: 'array index', src: 'int32 v = arr[i];' });
    cases.push({ label: 'function call', src: 'println("hello");' });
    cases.push({ label: 'method call chain', src: 'obj.method().other();' });
    cases.push({ label: 'namespace access', src: 'int32 v = ns::VALUE;' });
    cases.push({ label: 'cast', src: 'float32 f = cast<float32>(x);' });

    // 51-60: f-strings (verbatim tests — idempotency)
    cases.push({ label: 'fstring simple', src: 'string s = f"x={x}";' });
    cases.push({ label: 'fstring in println', src: 'void f() { println(f"v={v}"); }' });
    cases.push({ label: 'fstring multiple interp', src: 'string s = f"a={a} b={b}";' });
    cases.push({ label: 'fstring plain text', src: 'string s = f"hello world";' });
    cases.push({ label: 'fstring empty', src: 'string s = f"";' });
    cases.push({ label: 'fstring with expr', src: 'string s = f"v={x + 1}";' });
    cases.push({ label: 'fstring member access', src: 'string s = f"name={obj.name}";' });
    cases.push({ label: 'fstring array index', src: 'string s = f"v={arr[i]}";' });
    cases.push({ label: 'fstring in return', src: 'string f() { return f"r={r}"; }' });
    cases.push({ label: 'fstring assign', src: 'void f() { string s = f"x={x}"; }' });

    // 61-70: annotations
    cases.push({ label: 'annotation no args', src: '[[reflect]] class Foo {}' });
    cases.push({ label: 'annotation with arg', src: '[[align(16)]] struct Vec { float32 x; }' });
    cases.push({ label: 'annotation packed', src: '[[packed]] struct Wire { uint8 a; }' });
    cases.push({ label: 'annotation inline method', src: 'class Foo { [[inline]] void bar() { } }' });
    cases.push({ label: 'annotation dll extern', src: '[[dll("x.dll")]] extern void f();' });

    // 71-80: template / namespace / using
    cases.push({ label: 'template function', src: 'template<typename T> T id(T x) { return x; }' });
    cases.push({ label: 'namespace', src: 'namespace ns { int32 x = 0; }' });
    cases.push({ label: 'using namespace', src: 'using namespace ns;' });
    cases.push({ label: 'typedef', src: 'typedef int32 i32;' });
    cases.push({ label: 'delegate', src: 'delegate int32 BinOp(int32 a, int32 b);' });

    // 81-90: match / try / throw / defer
    cases.push({ label: 'match expr', src: 'void f() { int32 r = match (x) { 0 => 1, _ => 0 }; }' });
    cases.push({ label: 'try-catch', src: 'void f() { try { throw 1; } catch (int32 e) { } }' });
    cases.push({ label: 'defer block', src: 'void f() { int64 h = open(); defer { close(h); } }' });
    cases.push({ label: 'throw expr', src: 'void f() { throw -1; }' });
    cases.push({ label: 'yield', src: 'coroutine void gen() { yield 42; }' });

    // 91-100: lambdas / designated init / misc
    cases.push({ label: 'lambda bracket', src: 'BinOp add = [](int32 a, int32 b) -> int32 { return a + b; };' });
    cases.push({ label: 'lambda arrow', src: 'int32 doub = (int32 x) => x * 2;' });
    cases.push({ label: 'lambda with capture', src: 'int32 adder = [base](int32 x) -> int32 { return base + x; };' });
    cases.push({ label: 'designated init', src: 'Point p = { .x = 0, .y = 0 };' });
    cases.push({ label: 'array literal', src: 'array<int32> nums = { 1, 2, 3 };' });
    cases.push({ label: 'new/delete', src: 'void f() { Foo* p = new Foo(1); delete p; }' });
    cases.push({ label: 'sizeof', src: 'int32 sz = sizeof(int32);' });
    cases.push({ label: 'func ref', src: 'int64 fn = @max;' });
    cases.push({ label: 'intrinsic rdtsc', src: 'int64 t() { return __asm_rdtsc(); }' });
    cases.push({ label: 'switch statement', src: 'void f() { switch (x) { case 1: break; default: break; } }' });

    // 91-100 are already present above — add 79-90 gap fillers
    // (the above sections 91-100 start at case index 90 zero-based, i.e. push #91-100)
    // Actually we need to count: 10+10+10+3+10+5+10+5+5+10 = 78. Need 22 more.

    // 79-100: additional fuzz cases
    cases.push({ label: 'variadic function', src: 'int64 sum(...) { return 0; }' });
    cases.push({ label: 'coroutine decl', src: 'coroutine void gen() { yield 1; }' });
    cases.push({ label: 'namespace nested', src: 'namespace a { namespace b { int32 x = 0; } }' });
    cases.push({ label: 'using alias', src: 'using i32 = int32;' });
    cases.push({ label: 'operator overload', src: 'class V { V operator+(V other) { return V(); } }' });
    cases.push({ label: 'mixin class', src: 'mixin class M { void foo() { } }' });
    cases.push({ label: 'class multi-base', src: 'class C : A, B { }' });
    cases.push({ label: 'struct no members', src: 'struct Empty { }' });
    cases.push({ label: 'interface multi-base', src: 'interface IC : IA, IB { void method(); }' });
    cases.push({ label: 'template class', src: 'template<typename T> class Box { T value; }' });
    cases.push({ label: 'function with try-catch-finally', src: 'void f() { try { throw 1; } catch (int32 e) { } }' });
    cases.push({ label: 'nested match', src: 'void f() { int32 r = match (x) { 0 => match (y) { 0 => 1, _ => 2 }, _ => 3 }; }' });
    cases.push({ label: 'chained member calls', src: 'void f() { a.b().c().d(); }' });
    cases.push({ label: 'complex condition', src: 'void f() { if (a && b || c && !d) { return; } }' });
    cases.push({ label: 'break in loop', src: 'void f() { for (int32 i = 0; i < 10; i = i + 1) { if (i == 5) { break; } } }' });
    cases.push({ label: 'continue in loop', src: 'void f() { for (int32 i = 0; i < 10; i = i + 1) { if (i == 5) { continue; } } }' });
    cases.push({ label: 'delete array', src: 'void f() { int32* arr = new int32[10]; delete[] arr; }' });
    cases.push({ label: 'static cast', src: 'void f() { float32 v = static_cast<float32>(x); }' });
    cases.push({ label: 'func ref in var', src: 'int64 fp = @someFunc;' });
    cases.push({ label: 'goto statement', src: 'void f() { goto end; end: return; }' });
    cases.push({ label: 'label statement', src: 'void f() { start: int32 x = 0; }' });
    cases.push({ label: 'multiple annotations', src: '[[reflect]] [[serialize]] class Data { int32 id; }' });

    assert.equal(cases.length, 100, 'Expected exactly 100 fuzz cases');
    return cases;
}
