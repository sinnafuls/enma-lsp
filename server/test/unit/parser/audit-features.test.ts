// Comprehensive audit of every syntax feature documented in
// https://enma-1.gitbook.io/enma/llms-language. Each `it` is a stand-alone
// minimal repro for one feature so failures are self-explanatory.
import * as assert from 'assert';
import { parseSource, parserErrors } from './_helpers';

function expectClean(src: string, label: string) {
    const r = parseSource(src);
    const errs = parserErrors(r.diagnostics);
    if (errs.length > 0) {
        const msgs = errs.map(e => `${e.location.start.line}:${e.location.start.character} ${e.message}`).join('\n  ');
        assert.fail(`[${label}] expected clean parse but got ${errs.length} error(s):\n  ${msgs}\nSOURCE:\n${src}`);
    }
}

describe('Parser — full Enma reference audit', () => {
    // Section 6 — Functions
    it('trailing return type on free function', () => {
        expectClean(`auto add(int64 a, int64 b) -> int64 { return a + b; }`, 'trailing-ret');
    });
    it('trailing return type on method', () => {
        expectClean(`class C { auto add(int64 a) -> int64 { return a; } }`, 'trailing-ret-method');
    });

    // Section 5 — Control flow: C++17 if-init
    it('if-init: T x = expr; cond', () => {
        expectClean(`int32 main() { if (int32 x = 1; x > 0) { return x; } return 0; }`, 'if-init');
    });
    it('if-init with else', () => {
        expectClean(`int32 main() { if (int32 x = 1; x > 0) { return x; } else { return 0; } }`, 'if-init-else');
    });

    // Section 8 — Direct uniform init
    it('uniform init in var-decl: T t = T{1, 2}', () => {
        expectClean(`struct Pt { int32 x; int32 y; } int32 main() { Pt t = Pt{1, 2}; return 0; }`, 'uniform-var');
    });
    it('uniform init in argument: f(T{1, 2})', () => {
        expectClean(`struct Pt { int32 x; int32 y; } void f(Pt p) {} int32 main() { f(Pt{1, 2}); return 0; }`, 'uniform-arg');
    });
    it('uniform init in return: return T{1, 2}', () => {
        expectClean(`struct Pt { int32 x; int32 y; } Pt mk() { return Pt{1, 2}; }`, 'uniform-ret');
    });
    it('type-prefixed designated init: Point{.x=1, .y=2}', () => {
        expectClean(`struct Pt { int32 x; int32 y; } int32 main() { Pt t = Pt{.x=1, .y=2}; return 0; }`, 'uniform-designated');
    });

    // Section 9 — Classes: `final` after class name
    it("'class Foo final : Bar' — final after class name", () => {
        expectClean(`class Bar { int32 a; } class Foo final : Bar { int32 b; }`, 'class-final');
    });
    it("'class Foo final {}' — final without bases", () => {
        expectClean(`class Foo final { int32 a; }`, 'class-final-nobases');
    });
    it("'struct Foo final {}'", () => {
        expectClean(`struct Foo final { int32 a; }`, 'struct-final');
    });

    // Access labels
    it('private: / public: labels in class body', () => {
        expectClean(`class C { public: int32 a; private: int32 b; }`, 'access-labels');
    });

    // explicit on ctor
    it('explicit ctor', () => {
        expectClean(`struct Box { int32 v; explicit Box(int32 x) { v = x; } }`, 'explicit-ctor');
    });

    // Section 8 — Operator overloads
    it('operator-> overload', () => {
        expectClean(`struct Item { int32 v; } struct H { Item* operator->() { return null; } }`, 'op-arrow');
    });
    it('operator T() type conversion', () => {
        expectClean(`struct Wrap { int64 v; operator int64() { return v; } }`, 'op-conv-prim');
    });
    it('operator T() cross-struct conversion', () => {
        expectClean(`struct B { int32 b; } struct A { int32 a; operator B() { return B(); } }`, 'op-conv-struct');
    });
    it('operator() call overload', () => {
        expectClean(`struct F { int32 operator()(int32 x) { return x * 2; } }`, 'op-call');
    });
    it('operator[]= write subscript', () => {
        expectClean(`struct V { void operator[]=(int64 i, int32 v) {} }`, 'op-idxset');
    });
    it('operator++(int) postfix', () => {
        expectClean(`struct C { int32 v; C operator++(int) { return this; } }`, 'op-postinc');
    });
    it('copy ctor T(const T& other)', () => {
        expectClean(`struct C { int32 v; C(const C& other) { v = other.v; } }`, 'copy-ctor');
    });
    it('move ctor T(T&& other)', () => {
        expectClean(`struct C { int32 v; C(C&& other) { v = other.v; } }`, 'move-ctor');
    });
    it('copy assignment operator=', () => {
        expectClean(`struct C { int32 v; void operator=(C o) { v = o.v; } }`, 'op-assign');
    });

    // Section 7 — Pointers / new
    it('new T[N](ctor_args) — heap array with shared ctor args', () => {
        expectClean(`struct P { int32 x; int32 y; P(int32 a, int32 b) { x = a; y = b; } } int32 main() { P* p = new P[4](3, 5); delete[] p; return 0; }`, 'new-array-ctor');
    });

    // Lambdas
    it('bracket lambda with explicit return type', () => {
        expectClean(`int32 main() { auto fn = [](int32 x) -> int32 { return x * 2; }; return 0; }`, 'lambda-bracket');
    });
    it('arrow lambda expression body', () => {
        expectClean(`int32 main() { auto fn = (int32 x) => x * 2; return 0; }`, 'lambda-arrow-expr');
    });
    it('arrow lambda block body', () => {
        expectClean(`int32 main() { auto fn = (int32 a, int32 b) => { int32 s = a + b; return s; }; return 0; }`, 'lambda-arrow-block');
    });
    it('zero-param arrow lambda', () => {
        expectClean(`int32 main() { auto fn = () => 42; return 0; }`, 'lambda-arrow-zero');
    });
    it('lambda with explicit captures', () => {
        expectClean(`int32 main() { int32 base = 1; auto fn = [base](int32 x) -> int32 { return base + x; }; return 0; }`, 'lambda-cap-val');
    });
    it('lambda with reference captures', () => {
        expectClean(`int32 main() { int32 base = 1; auto fn = [&base](int32 x) -> int32 { return base + x; }; return 0; }`, 'lambda-cap-ref');
    });

    // Section 11 — Mixins
    it('mixin int32 Rect::area()', () => {
        expectClean(`struct Rect { int32 x; int32 y; } mixin int32 Rect::area() { return x * y; }`, 'mixin');
    });

    // Section 23 — Designated init
    it('designated init mid-only: {.b = 42}', () => {
        expectClean(`struct T { int32 a; int32 b; int32 c; } int32 main() { T t = {.b = 42}; return 0; }`, 'designated-mid');
    });

    // Section 22 — decltype
    it('decltype in var-decl', () => {
        expectClean(`int32 main() { int64 x = 42; decltype(x) y = x + 1; return 0; }`, 'decltype-var');
    });
    it('decltype in expression', () => {
        expectClean(`int32 main() { int32 a = 10; decltype(a + a) sum = 100; return 0; }`, 'decltype-expr');
    });

    // Section 4 — operators
    it('three-way comparison <=>', () => {
        expectClean(`struct C { int64 v; int64 operator<=>(C o) { return v - o.v; } }`, 'spaceship-op');
    });
    it('move(x) builtin', () => {
        expectClean(`struct P { int32 v; } int32 main() { P* a = new P(); P* b = move(a); return 0; }`, 'move-fn');
    });

    // Section 26 — Annotations
    it('annotation [[align(16)]]', () => {
        expectClean(`[[align(16)]] struct V { float32 x; float32 y; }`, 'ann-align');
    });
    it('annotation [[offset(0x10)]] on field', () => {
        expectClean(`struct G { [[offset(0x10)]] int64 hp; [[offset(0x40)]] int64 pos; }`, 'ann-offset');
    });
    it('annotation [[dll("lib")]] extern', () => {
        expectClean(`[[dll("libc.so.6")]] extern int64 getpid();`, 'ann-dll');
    });
    it('multiple annotations stacked', () => {
        expectClean(`[[packed]] [[align(16)]] struct V { float32 x; float32 y; }`, 'ann-stacked');
    });

    // Section 8 — Bitfields
    it('bitfield struct', () => {
        expectClean(`struct F { uint32 ready : 1; uint32 mode : 3; uint32 reserved : 28; }`, 'bitfields');
    });

    // Section 18 — Coroutines
    it('coroutine fn + coroutine_t handle', () => {
        expectClean(`coroutine int32 counter(int32 s) { int32 i = s; while (true) { yield i; i = i + 1; } } int32 main() { coroutine_t c = counter(0); return 0; }`, 'coroutine');
    });

    // Section 19 — Exceptions
    it('typed catch with struct', () => {
        expectClean(`struct E { int32 c; E(int32 x) { c = x; } } int32 main() { try { throw E(1); } catch (E e) { return e.c; } return 0; }`, 'catch-struct');
    });
    it('throw new T(args)', () => {
        expectClean(`struct E { int32 c; E(int32 x) { c = x; } } int32 main() { throw new E(1); return 0; }`, 'throw-new');
    });

    // Section 14 — typedef + using alias
    it("'using ID = int32;'", () => {
        expectClean(`using ID = int32; ID p = 42;`, 'using-alias');
    });
    it("'typedef int32 CID;'", () => {
        expectClean(`typedef int32 CID; CID c = 7;`, 'typedef-alias');
    });

    // Section 17 — Namespaces
    it('namespace with class + cross-namespace reference', () => {
        expectClean(`namespace base { class A { int64 v; A(int64 x) { v = x; } } } namespace derived { class B : base::A { B(int64 x) : base::A(x + 50) {} } }`, 'namespace-cross-ref');
    });

    // Section 15 — Templates
    it('template struct', () => {
        expectClean(`template<typename T> struct Box { T v; Box(T x) { v = x; } T get() { return v; } }`, 'template-struct');
    });
    it('template fn', () => {
        expectClean(`template<typename T> T max(T a, T b) { return a > b ? a : b; }`, 'template-fn');
    });

    // Section 6 — out parameters
    it('out parameter', () => {
        expectClean(`bool try_parse(string s, out int32 v) { v = 42; return true; }`, 'out-param');
    });

    // Section 31 — static_assert
    it('static_assert at module scope', () => {
        expectClean(`static_assert(sizeof(int32) == 4);`, 'static-assert-module');
    });
    it('static_assert with message', () => {
        expectClean(`static_assert(sizeof(int32) == 4, "int32 must be 4 bytes");`, 'static-assert-msg');
    });

    // Section 4 — sizeof / offsetof
    it('sizeof(T)', () => {
        expectClean(`int32 main() { int64 s = sizeof(int32); return 0; }`, 'sizeof');
    });
    it('offsetof(Struct, field)', () => {
        expectClean(`struct P { int32 x; int32 y; } int32 main() { int64 o = offsetof(P, y); return 0; }`, 'offsetof');
    });

    // Section 32 — string interpolation
    it('f-string', () => {
        expectClean(`int32 main() { int32 x = 5; string s = f"value is {x}"; return 0; }`, 'fstring');
    });

    // Section 24 — UDLs
    it("UDL '42_km'", () => {
        expectClean(`int64 _km(int64 v) { return v * 1000; } int32 main() { int64 d = 42_km; return 0; }`, 'udl-int');
    });
    it("UDL '180.0_deg'", () => {
        expectClean(`float64 _deg(float64 v) { return v * 0.0174; } int32 main() { float64 r = 180.0_deg; return 0; }`, 'udl-float');
    });

    // Underscore separators + binary literal
    it("underscore digit separators", () => {
        expectClean(`int32 main() { int64 a = 1_000_000; int64 b = 0xFF_FF; int64 c = 0b1010_1100; float64 d = 1_234.567_8; return 0; }`, 'digit-sep');
    });
    it("binary literal 0b1010", () => {
        expectClean(`int32 main() { int64 v = 0b1010; return 0; }`, 'binary-lit');
    });

    // Section 12 — Properties
    it("property with getter only", () => {
        expectClean(`struct R { int32 w; int32 h; property int32 area { get { return w * h; } } }`, 'property-get');
    });
    it("property with getter + setter (uses 'value')", () => {
        expectClean(`struct R { int32 w; int32 h; property int32 side { get { return w; } set { w = value; h = value; } } }`, 'property-set');
    });

    // C-style cast and static_cast
    it("C-style cast (T)x", () => {
        expectClean(`int32 main() { int64 a = 5; int32 b = (int32)a; return b; }`, 'c-cast');
    });
    it("static_cast<T>(x)", () => {
        expectClean(`int32 main() { int64 a = 5; int32 b = static_cast<int32>(a); return b; }`, 'static-cast');
    });
    it("reinterpret_cast<T>(x)", () => {
        expectClean(`int32 main() { int64 a = 5; int64 b = reinterpret_cast<int64>(a); return 0; }`, 'reinterpret-cast');
    });
    it("const_cast<T>(x)", () => {
        expectClean(`int32 main() { const int64 a = 5; int64 b = const_cast<int64>(a); return 0; }`, 'const-cast');
    });

    // Section 10 — Interfaces
    it("interface implementation via 'override'", () => {
        expectClean(`interface Shape { int32 area(); } struct Rect : Shape { int32 w; int32 h; int32 area() override { return w * h; } }`, 'interface-impl');
    });

    // Section 25 — Inline assembly intrinsics
    it("__asm_rdtsc / __asm_pause", () => {
        expectClean(`int32 main() { int64 t = __asm_rdtsc(); __asm_pause(); __asm_mfence(); __asm_nop(); return 0; }`, 'asm-intrinsics');
    });

    // Section 6 — variadic
    it("variadic '...' with __va_count / __va_arg", () => {
        expectClean(`int64 sum(...) { int64 s = 0; int64 i = 0; while (i < __va_count) { s = s + __va_arg(i); i = i + 1; } return s; }`, 'variadic');
    });

    // Section 5 — match
    it("match expression", () => {
        expectClean(`int32 main() { int32 x = 1; int32 r = match (x) { 1 => 10, 2 => 20, _ => 0 }; return r; }`, 'match');
    });

    // Section 5 — defer
    it("defer block", () => {
        expectClean(`int32 main() { int64 h = 0; defer { h = 0; } return 0; }`, 'defer');
    });
    it("defer expression (Go-style)", () => {
        expectClean(`void close_h(int64 h) {} int32 main() { int64 h = 0; defer close_h(h); return 0; }`, 'defer-expr');
    });

    // Section 5 — goto
    it("goto + label", () => {
        expectClean(`int32 main() { goto done; done: return 0; }`, 'goto');
    });

    // Section 28 — import / module
    it("import declaration", () => {
        expectClean(`import "math_utils.em";`, 'import-bare');
    });
    it("import as alias", () => {
        expectClean(`import "engine/renderer.em" as rend;`, 'import-as');
    });

    // Section 16 — Delegate
    it("delegate declaration", () => {
        expectClean(`delegate int32 Transform(int32 x);`, 'delegate');
    });

    // Section 13 — Enum with underlying type
    it("'enum X : int32 { ... }' with underlying type", () => {
        expectClean(`enum K : int32 { A = 1, B = 2 }`, 'enum-underlying');
    });

    // ----- Coverage for follow-up gaps (architect review) -----

    it("'enum class Name { ... }' scoped enum", () => {
        expectClean(`enum class Color { Red = 0, Green = 1, Blue = 2 }`, 'enum-class');
    });
    it("'enum struct Name { ... }' scoped enum", () => {
        expectClean(`enum struct Mode { On, Off }`, 'enum-struct');
    });

    it("decltype in parameter type position", () => {
        expectClean(`void f(decltype(0) v) { }`, 'decltype-param');
    });
    it("decltype in return type position", () => {
        expectClean(`int64 src() { return 1; } decltype(src()) g() { return 0; }`, 'decltype-return');
    });

    it("'friend class Foo;' inside struct body", () => {
        expectClean(`class Foo { int32 x; } struct S { friend class Foo; }`, 'friend-class');
    });
    it("'friend void f();' inside class body", () => {
        expectClean(`void helper() {} class C { int32 v; friend void helper(); }`, 'friend-fn');
    });

    it("static_assert inside function body", () => {
        expectClean(`int32 main() { static_assert(sizeof(int32) == 4); return 0; }`, 'static-assert-body');
    });

    it("operator--(int) postfix", () => {
        expectClean(`struct C { int32 v; C operator--(int) { return this; } }`, 'op-postdec');
    });

    it("ctor init list with bare-name base call", () => {
        expectClean(`class A { int64 v; A(int64 x) { v = x; } } class B : A { B(int64 x) : A(x + 1) {} }`, 'ctor-init-bare');
    });
});
