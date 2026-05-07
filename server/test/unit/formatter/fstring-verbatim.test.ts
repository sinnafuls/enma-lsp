// 30 byte-exact f-string preservation tests (AC spec §fstring-verbatim).
//
// For each variant: build a small .em program containing the f-string,
// run the formatter, and assert that the f-string bytes are preserved
// verbatim in the output.
//
// Strategy: extract the original f-string span from the source, then
// assert that output.includes(originalFString).

import * as assert from 'node:assert/strict';
import { formatSource, extractFStrings } from './_helpers';

// ---- Helper ------------------------------------------------------------

interface FStringCase {
    label: string;
    /** The complete .em program (or expression statement). */
    src: string;
    /** The exact f-string bytes that must appear verbatim in the output. */
    fstring: string;
}

function assertVerbatim(c: FStringCase): void {
    const output = formatSource(c.src);
    assert.ok(
        output.includes(c.fstring),
        `F-string not preserved verbatim.\nExpected to find: ${JSON.stringify(c.fstring)}\nIn output: ${JSON.stringify(output)}`
    );
}

// ---- 30 test cases -----------------------------------------------------

const cases: FStringCase[] = [
    // 1. depth-1 basic
    {
        label: 'depth 1: f"x={x}"',
        src:   'string s = f"x={x}";',
        fstring: 'f"x={x}"',
    },
    // 2. depth-2 nested
    {
        label: 'depth 2: f"a={f"b={x}"}"',
        src:   'string s = f"a={f"b={x}"}";',
        fstring: 'f"a={f"b={x}"}"',
    },
    // 3. depth-3 nested
    {
        label: 'depth 3: f"x={f"y={f"z={n}"}"}"',
        src:   'string s = f"x={f"y={f"z={n}"}"}";',
        fstring: 'f"x={f"y={f"z={n}"}"}"',
    },
    // 4. arithmetic in interpolation
    {
        label: 'with arithmetic: f"v={x + 1 * 2}"',
        src:   'string s = f"v={x + 1 * 2}";',
        fstring: 'f"v={x + 1 * 2}"',
    },
    // 5. member access dot
    {
        label: 'member access: f"name={obj.name}"',
        src:   'string s = f"name={obj.name}";',
        fstring: 'f"name={obj.name}"',
    },
    // 6. pointer member access
    {
        label: 'pointer access: f"name={p->name}"',
        src:   'string s = f"name={p->name}";',
        fstring: 'f"name={p->name}"',
    },
    // 7. array index
    {
        label: 'array index: f"v={arr[i]}"',
        src:   'string s = f"v={arr[i]}";',
        fstring: 'f"v={arr[i]}"',
    },
    // 8. internal spaces preserved verbatim
    {
        label: 'edge spacing: f"x={  x  }"',
        src:   'string s = f"x={  x  }";',
        fstring: 'f"x={  x  }"',
    },
    // 9. empty f-string
    {
        label: 'empty: f""',
        src:   'string s = f"";',
        fstring: 'f""',
    },
    // 10. just text
    {
        label: 'just text: f"hello"',
        src:   'string s = f"hello";',
        fstring: 'f"hello"',
    },
    // 11. multiple interpolations
    {
        label: 'multiple interp: f"x={a} y={b} z={c}"',
        src:   'string s = f"x={a} y={b} z={c}";',
        fstring: 'f"x={a} y={b} z={c}"',
    },
    // 12. mixed escape text (backslash-n literal text)
    {
        label: 'mixed escape: f"\\n={x}\\t"',
        src:   String.raw`string s = f"\n={x}\t";`,
        fstring: String.raw`f"\n={x}\t"`,
    },
    // 13. at end of expr — .length() call
    {
        label: 'at end of expr: f"x={x}".length()',
        src:   'int32 v = f"x={x}".length();',
        fstring: 'f"x={x}"',
    },
    // 14. as function argument
    {
        label: 'as function arg: println(f"x={x}")',
        src:   'void f() { println(f"x={x}"); }',
        fstring: 'f"x={x}"',
    },
    // 15. in match arm
    {
        label: 'in match arm',
        src:   'void f() { string r = match (x) { 1 => f"one={x}", _ => f"other" }; }',
        fstring: 'f"one={x}"',
    },
    // 16. in return
    {
        label: 'in return: return f"r={r}"',
        src:   'string f() { return f"r={r}"; }',
        fstring: 'f"r={r}"',
    },
    // 17. in array literal
    {
        label: 'in array literal',
        src:   'array<string> arr = { f"a", f"b={x}" };',
        fstring: 'f"a"',
    },
    // 18. in ternary
    {
        label: 'in ternary: x > 0 ? f"pos={x}" : f"neg={x}"',
        src:   'string s = x > 0 ? f"pos={x}" : f"neg={x}";',
        fstring: 'f"pos={x}"',
    },
    // 19. at start of statement line
    {
        label: 'at start of statement line',
        src:   'void f() { string s = f"x"; }',
        fstring: 'f"x"',
    },
    // 20. operator: s + f"x={x}"
    {
        label: 'operator: s + f"x={x}"',
        src:   'string t = s + f"x={x}";',
        fstring: 'f"x={x}"',
    },
    // 21. cast: cast<string>(f"x={x}")
    {
        label: 'cast: cast<string>(f"x={x}")',
        src:   'string t = cast<string>(f"x={x}");',
        fstring: 'f"x={x}"',
    },
    // 22. with UDL: f"x={42_km}"
    {
        label: 'with UDL: f"x={42_km}"',
        src:   'string s = f"x={42_km}";',
        fstring: 'f"x={42_km}"',
    },
    // 23. with lambda arrow: (f) => f"y={f}"
    {
        label: 'with lambda arrow param',
        src:   'string gen = (string f) => f"y={f}";',
        fstring: 'f"y={f}"',
    },
    // 24. inside class field initializer
    {
        label: 'inside class field',
        src:   'class Foo { string greeting = f"hello"; }',
        fstring: 'f"hello"',
    },
    // 25. with designated init
    {
        label: 'with designated init',
        src:   'Point p = { .label = f"x={x}" };',
        fstring: 'f"x={x}"',
    },
    // 26. empty interpolation argument (parser may flag but format preserves)
    {
        label: 'empty interpolation: f"x={}"',
        src:   'string s = f"x={}";',
        fstring: 'f"x={}"',
    },
    // 27. long single line with 5 interpolations
    {
        label: 'long line 200-char with 5 interpolations',
        src:   'string s = f"a={a} b={b} c={c} d={d} e={e} padding_text_to_make_it_longer_than_200_characters_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";',
        fstring: 'f"a={a} b={b} c={c} d={d} e={e} padding_text_to_make_it_longer_than_200_characters_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
    },
    // 28. double interpolation depth: f"{f"{f"{x}"}"}"
    {
        label: 'double interpolation depth',
        src:   'string s = f"{f"{f"{x}"}"}";',
        fstring: 'f"{f"{f"{x}"}"}"',
    },
    // 29. arrow access in interpolation
    {
        label: 'arrow member in fstring',
        src:   'void f(Entity* p) { println(f"hp={p->hp}"); }',
        fstring: 'f"hp={p->hp}"',
    },
    // 30. fstring in condition
    {
        label: 'fstring in if condition expression context',
        src:   'void f() { string s = f"val={v}"; if (s.length() > 0) { println(s); } }',
        fstring: 'f"val={v}"',
    },
];

// ---- Tests -------------------------------------------------------------

describe('Formatter — f-string verbatim preservation (30 cases)', () => {
    assert.equal(cases.length, 30, 'Must have exactly 30 f-string test cases');

    for (const c of cases) {
        it(c.label, () => assertVerbatim(c));
    }
});
