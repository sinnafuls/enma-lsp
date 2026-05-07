import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

const URI = 'file:///test.em';

function preprocess(src: string) {
    return preprocessAfterTokenized(tokenize(URI, src), { fileUri: URI });
}

describe('Preprocessor — #define / #undef', () => {
    it('object-like macro is recorded in macroDefs', () => {
        const out = preprocess('#define MAX_HP 100');
        assert.ok(out.macroDefs.has('MAX_HP'));
        const def = out.macroDefs.get('MAX_HP')!;
        assert.strictEqual(def.name, 'MAX_HP');
        assert.strictEqual(def.params, undefined);
        assert.strictEqual(def.body.length, 1);
        assert.strictEqual(def.body[0].text, '100');
    });

    it('object-like macro with multi-token body', () => {
        const out = preprocess('#define EXPR 1 + 2');
        const def = out.macroDefs.get('EXPR')!;
        assert.ok(def);
        assert.strictEqual(def.body.length, 3);
    });

    it('object-like macro with no body', () => {
        const out = preprocess('#define FLAG');
        assert.ok(out.macroDefs.has('FLAG'));
        const def = out.macroDefs.get('FLAG')!;
        assert.strictEqual(def.body.length, 0);
    });

    it('function-like macro with one param', () => {
        const out = preprocess('#define SQUARE(x) x * x');
        const def = out.macroDefs.get('SQUARE')!;
        assert.ok(def);
        assert.deepStrictEqual(def.params, ['x']);
        assert.strictEqual(def.body.length, 3);
    });

    it('function-like macro with multiple params', () => {
        const out = preprocess('#define ADD(a, b) a + b');
        const def = out.macroDefs.get('ADD')!;
        assert.ok(def);
        assert.deepStrictEqual(def.params, ['a', 'b']);
    });

    it('function-like macro with zero params', () => {
        const out = preprocess('#define NOP() 0');
        const def = out.macroDefs.get('NOP')!;
        assert.ok(def);
        assert.deepStrictEqual(def.params, []);
        assert.strictEqual(def.body.length, 1);
    });

    it('#undef removes an existing macro', () => {
        const out = preprocess('#define X 1\n#undef X');
        assert.ok(!out.macroDefs.has('X'));
    });

    it('#undef on non-existent macro emits warning (not error)', () => {
        const out = preprocess('#undef NONEXISTENT');
        // No crash, possibly a warning but no error
        const errors = out.diagnostics.filter(d => d.severity === 'error');
        assert.strictEqual(errors.length, 0);
    });

    it('redefine macro replaces old definition', () => {
        const out = preprocess('#define V 1\n#define V 2');
        const def = out.macroDefs.get('V')!;
        assert.ok(def);
        assert.strictEqual(def.body[0].text, '2');
    });

    it('defToken points to the macro name identifier', () => {
        const out = preprocess('#define MY_CONST 42');
        const def = out.macroDefs.get('MY_CONST')!;
        assert.strictEqual(def.defToken.text, 'MY_CONST');
    });

    it('multiple defines accumulate in macroDefs', () => {
        const out = preprocess('#define A 1\n#define B 2\n#define C 3');
        assert.ok(out.macroDefs.has('A'));
        assert.ok(out.macroDefs.has('B'));
        assert.ok(out.macroDefs.has('C'));
    });

    it('define after undef works (redefine cycle)', () => {
        const out = preprocess('#define X 1\n#undef X\n#define X 99');
        const def = out.macroDefs.get('X')!;
        assert.strictEqual(def.body[0].text, '99');
    });

    it('predefinedMacros option injects macros before processing', () => {
        const tokens = tokenize(URI, '#ifdef VERSION\nfound\n#endif');
        const out = preprocessAfterTokenized(tokens, {
            fileUri: URI,
            predefinedMacros: { VERSION: '1' },
        });
        const texts = out.preprocessedTokens.map(t => t.text);
        assert.ok(texts.includes('found'));
    });

    it('#define with reserved word as body token', () => {
        const out = preprocess('#define RET return');
        const def = out.macroDefs.get('RET')!;
        assert.ok(def);
        assert.strictEqual(def.body.length, 1);
        assert.strictEqual(def.body[0].text, 'return');
    });

    it('empty source produces no diagnostics and empty macro map', () => {
        const out = preprocess('');
        assert.strictEqual(out.macroDefs.size, 0);
        assert.strictEqual(out.diagnostics.length, 0);
    });
});
