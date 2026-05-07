// Enma syntax showcase — exercises most grammar paths so you can
// eyeball the highlighter quickly. Open this file with the extension
// active to verify everything renders.

/*
 * Block comments work too. Including /* nested-looking */ markers
 * (TM grammar treats this flat — first */ closes).
 */

#include "core.em"
#define MAX_HP 100
#ifdef DEBUG
#define LOG(m) println(m)
#endif

import "math_utils.em";
using namespace math;

// ---- annotations ----
[[reflect]] [[serialize]]
struct Header {
    uint8 kind;
    uint32 size;
}

[[packed]]
struct Wire { uint8 a; uint32 b; }

[[align(16)]]
struct Vec { float32 x; float32 y; float32 z; float32 w; }

[[dll("user32.dll")]]
extern int32 MessageBoxA(int64 hWnd, string text, string caption, uint32 type);

// ---- enum ----
enum Color { Red, Green, Blue }

// ---- delegate ----
delegate int32 BinOp(int32 a, int32 b);

// ---- interface ----
interface Drawable {
    void draw();
}

// ---- class with multi-inheritance + ctor/dtor + override ----
class Entity : Drawable {
    int32 hp;
    string name;
    Entity* next;            // pointer field

    Entity(string n, int32 h) {
        this.name = n;
        this.hp = h;
        this.next = null;
    }

    ~Entity() {
        // cleanup
    }

    [[inline]]
    override void draw() {
        println(f"drawing {this.name} hp={this.hp}");
    }
}

// ---- template fn ----
template<typename T>
T max(T a, T b) {
    return a > b ? a : b;
}

// ---- namespace ----
namespace geom {
    int32 square(int32 x) { return x * x; }

    struct Point {
        int32 x;
        int32 y;
    }
}

// ---- numeric literals ----
const int64 HEX_VAL    = 0xDEADBEEF;
const float32 PI       = 3.14159f;
const float64 SCI      = 1.5e-3;
const int64 DIST_KM    = 42_km;       // user-defined literal
const float32 DIST_M   = 1.5f_meter;

// ---- function with various features ----
int32 process(array<int32> nums, map<string, int64> tags) {
    // for-each
    int32 sum = 0;
    for (int32 v : nums) {
        sum = sum + v;
    }

    // counted for
    for (int32 i = 0; i < 10; i = i + 1) {
        if (i % 2 == 0) {
            continue;
        }
    }

    // while + defer
    int64 h = open_resource();
    defer { close_resource(h); }

    while (sum > 0) {
        sum = sum - 1;
    }

    // switch / match
    int32 r = match (sum) {
        0 => 100,
        1 => 200,
        _ => 0
    };

    // try / catch / throw
    try {
        if (sum < 0) {
            throw -1;
        }
    } catch (int32 e) {
        println(f"caught {e}");
    }

    return r;
}

// ---- pointer rules: -> for ptr, . for value ----
void pointer_demo() {
    Entity* p = new Entity("hero", 100);
    p->hp = p->hp - 10;     // -> on pointer (correct)
    p->draw();              // method call via pointer
    Entity e = *p;
    e.hp = 50;              // . on value (correct)
    delete p;
}

// ---- lambdas (both forms) ----
void lambda_demo() {
    int32 base = 100;

    // bracket form with explicit return
    BinOp add = [](int32 a, int32 b) -> int32 { return a + b; };

    // arrow form, expression body
    int64 doub = (int32 x) => x * 2;

    // closure capture
    int64 adder = [base](int32 x) -> int32 { return base + x; };

    int32 r = add(3, 4);
}

// ---- function reference ----
int64 fn_ptr = @max;

// ---- intrinsics ----
int64 read_tsc() {
    int64 t = __asm_rdtsc();
    __asm_pause();
    return t;
}

// ---- variadic ----
int64 sum_all(...) {
    int64 s = 0;
    int64 i = 0;
    while (i < __va_count) {
        s = s + __va_arg(i);
        i = i + 1;
    }
    return s;
}

// ---- designated initializers ----
geom::Point origin = { .x = 0, .y = 0 };

// ---- main ----
int32 main() {
    array<int32> nums = { 1, 2, 3, 4, 5 };
    map<string, int64> tags = map_create();
    tags.set("first", 1);

    int32 rc = process(nums, tags);
    println(f"result: {rc}");

    // string interpolation with full expression
    string s = f"sum + 1 = {nums[0] + nums[1] * 2}";
    println(s);

    return 0;
}
