import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { TokenKind, TokenObject } from '../../../src/compiler_tokenizer/tokenObject';

function kinds(tokens: TokenObject[]): string[] {
    return tokens.filter(t => t.kind !== TokenKind.EOF).map(t => t.kind as string);
}

function texts(tokens: TokenObject[]): string[] {
    return tokens.filter(t => t.kind !== TokenKind.EOF).map(t => t.text);
}

describe('Tokenizer — f-strings (§A2)', () => {

    // --- Depth 1 ---
    it('simple f-string no interpolation', () => {
        const toks = tokenize('test.em', 'f"hello"');
        const k = kinds(toks);
        assert.deepStrictEqual(k, [
            TokenKind.FStringStart,
            TokenKind.FStringText,
            TokenKind.FStringEnd,
        ]);
        assert.strictEqual(toks[0].text, 'f"');
        assert.strictEqual(toks[1].text, 'hello');
        assert.strictEqual(toks[2].text, '"');
    });

    it('f-string with single interpolation', () => {
        const toks = tokenize('test.em', 'f"x={x}"');
        const k = kinds(toks);
        assert.deepStrictEqual(k, [
            TokenKind.FStringStart,
            TokenKind.FStringText,
            TokenKind.FStringExprOpen,
            TokenKind.Identifier,
            TokenKind.FStringExprClose,
            TokenKind.FStringEnd,
        ]);
    });

    it('f-string empty interpolation text before {', () => {
        const toks = tokenize('test.em', 'f"{x}"');
        const k = kinds(toks);
        assert.deepStrictEqual(k, [
            TokenKind.FStringStart,
            TokenKind.FStringExprOpen,
            TokenKind.Identifier,
            TokenKind.FStringExprClose,
            TokenKind.FStringEnd,
        ]);
    });

    it('f-string text after closing }', () => {
        const toks = tokenize('test.em', 'f"val={v} done"');
        const k = kinds(toks);
        assert.deepStrictEqual(k, [
            TokenKind.FStringStart,
            TokenKind.FStringText,   // "val="
            TokenKind.FStringExprOpen,
            TokenKind.Identifier,    // v
            TokenKind.FStringExprClose,
            TokenKind.FStringText,   // " done"
            TokenKind.FStringEnd,
        ]);
    });

    it('f-string arithmetic inside interpolation', () => {
        const toks = tokenize('test.em', 'f"sum={a+b}"');
        const k = kinds(toks);
        assert.ok(k.includes(TokenKind.FStringExprOpen));
        assert.ok(k.includes(TokenKind.FStringExprClose));
        // a, +, b should be inside
        const inner = toks.filter(t =>
            t.kind !== TokenKind.EOF &&
            t.kind !== TokenKind.FStringStart &&
            t.kind !== TokenKind.FStringEnd &&
            t.kind !== TokenKind.FStringText &&
            t.kind !== TokenKind.FStringExprOpen &&
            t.kind !== TokenKind.FStringExprClose
        );
        assert.ok(inner.some(t => t.text === 'a'));
        assert.ok(inner.some(t => t.text === '+'));
        assert.ok(inner.some(t => t.text === 'b'));
    });

    it('f-string member access inside interpolation', () => {
        const toks = tokenize('test.em', 'f"hp={this.hp}"');
        const k = kinds(toks);
        assert.ok(k.includes(TokenKind.FStringExprOpen));
        assert.ok(k.includes(TokenKind.FStringExprClose));
        const nonBoundary = toks.filter(t =>
            t.kind !== TokenKind.EOF &&
            !k.includes(t.kind as any) // simplify: just check texts
        );
        assert.ok(toks.some(t => t.text === 'this'));
        assert.ok(toks.some(t => t.text === '.'));
        assert.ok(toks.some(t => t.text === 'hp'));
    });

    it('f-string array indexing inside interpolation', () => {
        const toks = tokenize('test.em', 'f"v={arr[0]}"');
        assert.ok(toks.some(t => t.text === 'arr'));
        assert.ok(toks.some(t => t.text === '['));
        assert.ok(toks.some(t => t.text === '0'));
        assert.ok(toks.some(t => t.text === ']'));
    });

    it('f-string function call inside interpolation', () => {
        const toks = tokenize('test.em', 'f"r={foo(x)}"');
        assert.ok(toks.some(t => t.text === 'foo'));
        assert.ok(toks.some(t => t.text === '('));
        assert.ok(toks.some(t => t.text === ')'));
    });

    it('multiple interpolations in one f-string', () => {
        const toks = tokenize('test.em', 'f"a={a} b={b}"');
        const k = kinds(toks);
        const opens = k.filter(k => k === TokenKind.FStringExprOpen);
        const closes = k.filter(k => k === TokenKind.FStringExprClose);
        assert.strictEqual(opens.length, 2);
        assert.strictEqual(closes.length, 2);
    });

    it('f-string with escape sequence in text', () => {
        const toks = tokenize('test.em', 'f"line\\nval={x}"');
        assert.strictEqual(toks[0].kind, TokenKind.FStringStart);
        assert.strictEqual(toks[1].kind, TokenKind.FStringText);
        assert.ok(toks[1].text.includes('\\n'));
    });

    // --- Depth 2 ---
    it('nested f-string depth 2: f"a={f"b={x}"}"', () => {
        const src = 'f"a={f"b={x}"}"';
        const toks = tokenize('test.em', src);
        const k = kinds(toks);
        // outer: FStringStart, FStringText("a="), FStringExprOpen
        //   inner: FStringStart, FStringText("b="), FStringExprOpen
        //     x: Identifier
        //   FStringExprClose, FStringEnd
        // outer: FStringExprClose, FStringEnd
        const starts = k.filter(k => k === TokenKind.FStringStart);
        const ends = k.filter(k => k === TokenKind.FStringEnd);
        assert.strictEqual(starts.length, 2, 'Should have 2 FStringStart');
        assert.strictEqual(ends.length, 2, 'Should have 2 FStringEnd');
        assert.ok(toks.some(t => t.text === 'x'));
    });

    it('nested f-string depth 2 with arithmetic: f"x={f"y={z+1}"}"', () => {
        const src = 'f"x={f"y={z+1}"}"';
        const toks = tokenize('test.em', src);
        const k = kinds(toks);
        const starts = k.filter(k => k === TokenKind.FStringStart);
        const ends = k.filter(k => k === TokenKind.FStringEnd);
        assert.strictEqual(starts.length, 2);
        assert.strictEqual(ends.length, 2);
        assert.ok(toks.some(t => t.text === 'z'));
        assert.ok(toks.some(t => t.text === '1'));
        assert.ok(toks.some(t => t.text === '+'));
    });

    // --- Depth 3 ---
    it('nested f-string depth 3', () => {
        const src = 'f"a={f"b={f"c={x}"}"}"';
        const toks = tokenize('test.em', src);
        const k = kinds(toks);
        const starts = k.filter(k => k === TokenKind.FStringStart);
        const ends = k.filter(k => k === TokenKind.FStringEnd);
        assert.strictEqual(starts.length, 3, 'Should have 3 FStringStart');
        assert.strictEqual(ends.length, 3, 'Should have 3 FStringEnd');
        assert.ok(toks.some(t => t.text === 'x'));
    });

    it('f-string followed by normal code', () => {
        const toks = tokenize('test.em', 'f"val={x}" + y');
        // After f-string, + and y should be normal tokens
        assert.ok(toks.some(t => t.text === '+'));
        assert.ok(toks.some(t => t.text === 'y' && t.kind === TokenKind.Identifier));
    });

    it('f-string caught result: println(f"drawing {name} hp={hp}")', () => {
        const src = 'println(f"drawing {name} hp={hp}")';
        const toks = tokenize('test.em', src);
        const k = kinds(toks);
        assert.ok(k.includes(TokenKind.FStringStart));
        assert.ok(k.includes(TokenKind.FStringEnd));
        assert.ok(k.includes(TokenKind.FStringExprOpen));
        assert.ok(k.includes(TokenKind.FStringExprClose));
        assert.ok(toks.some(t => t.text === 'name'));
        assert.ok(toks.some(t => t.text === 'hp'));
    });

    it('f-string with complex expression: nums[0] + nums[1] * 2', () => {
        const src = 'f"sum + 1 = {nums[0] + nums[1] * 2}"';
        const toks = tokenize('test.em', src);
        assert.ok(toks.some(t => t.text === 'nums'));
        assert.ok(toks.some(t => t.text === '*'));
        assert.ok(toks.some(t => t.text === '2'));
    });

    it('f-string start token has correct text', () => {
        const toks = tokenize('test.em', 'f"hello"');
        assert.strictEqual(toks[0].kind, TokenKind.FStringStart);
        assert.strictEqual(toks[0].text, 'f"');
    });

    it('f-string end token has correct text', () => {
        const toks = tokenize('test.em', 'f"hello"');
        const end = toks.find(t => t.kind === TokenKind.FStringEnd)!;
        assert.strictEqual(end.text, '"');
    });

    it('f-string expr open has text {', () => {
        const toks = tokenize('test.em', 'f"{x}"');
        const open = toks.find(t => t.kind === TokenKind.FStringExprOpen)!;
        assert.strictEqual(open.text, '{');
    });

    it('f-string expr close has text }', () => {
        const toks = tokenize('test.em', 'f"{x}"');
        const close = toks.find(t => t.kind === TokenKind.FStringExprClose)!;
        assert.strictEqual(close.text, '}');
    });

    it('f-string with caught expression: f"caught {e}"', () => {
        const src = 'f"caught {e}"';
        const toks = tokenize('test.em', src);
        assert.ok(toks.some(t => t.text === 'e' && t.kind === TokenKind.Identifier));
    });

    it('f-string opens and closes are balanced depth 1', () => {
        const src = 'f"result: {rc}"';
        const toks = tokenize('test.em', src);
        const opens = toks.filter(t => t.kind === TokenKind.FStringExprOpen);
        const closes = toks.filter(t => t.kind === TokenKind.FStringExprClose);
        assert.strictEqual(opens.length, closes.length);
    });

    it('f-string opens and closes are balanced depth 2', () => {
        const src = 'f"a={f"b={x}"}"';
        const toks = tokenize('test.em', src);
        const opens = toks.filter(t => t.kind === TokenKind.FStringExprOpen);
        const closes = toks.filter(t => t.kind === TokenKind.FStringExprClose);
        assert.strictEqual(opens.length, closes.length);
    });

    it('f-string opens and closes are balanced depth 3', () => {
        const src = 'f"a={f"b={f"c={x}"}"}"';
        const toks = tokenize('test.em', src);
        const opens = toks.filter(t => t.kind === TokenKind.FStringExprOpen);
        const closes = toks.filter(t => t.kind === TokenKind.FStringExprClose);
        assert.strictEqual(opens.length, closes.length);
    });
});
