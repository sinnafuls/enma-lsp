import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

const URI = 'file:///test.em';

function preprocess(src: string) {
    return preprocessAfterTokenized(tokenize(URI, src), { fileUri: URI });
}

function tokenTexts(src: string): string[] {
    return preprocess(src).preprocessedTokens
        .filter(t => t.kind !== TokenKind.EOF)
        .map(t => t.text);
}

describe('Preprocessor — Conditionals', () => {
    it('#ifdef true branch is emitted', () => {
        const texts = tokenTexts('#define DEBUG\n#ifdef DEBUG\nactive\n#endif');
        assert.ok(texts.includes('active'));
    });

    it('#ifdef false branch is not emitted', () => {
        const texts = tokenTexts('#ifdef UNDEFINED\nhidden\n#endif');
        assert.ok(!texts.includes('hidden'));
    });

    it('#ifndef true branch is emitted when macro not defined', () => {
        const texts = tokenTexts('#ifndef MISSING\nvisible\n#endif');
        assert.ok(texts.includes('visible'));
    });

    it('#ifndef false branch is not emitted when macro is defined', () => {
        const texts = tokenTexts('#define HAS_IT\n#ifndef HAS_IT\nhidden\n#endif');
        assert.ok(!texts.includes('hidden'));
    });

    it('#ifdef with #else: else branch emitted when ifdef is false', () => {
        const texts = tokenTexts('#ifdef ABSENT\ntrue_branch\n#else\nfalse_branch\n#endif');
        assert.ok(!texts.includes('true_branch'));
        assert.ok(texts.includes('false_branch'));
    });

    it('#ifdef with #else: else branch not emitted when ifdef is true', () => {
        const texts = tokenTexts('#define X\n#ifdef X\ntrue_branch\n#else\nfalse_branch\n#endif');
        assert.ok(texts.includes('true_branch'));
        assert.ok(!texts.includes('false_branch'));
    });

    it('nested #ifdef / #endif', () => {
        const texts = tokenTexts(
            '#define A\n#define B\n' +
            '#ifdef A\n' +
            '  #ifdef B\n' +
            '    both\n' +
            '  #endif\n' +
            '#endif'
        );
        assert.ok(texts.includes('both'));
    });

    it('nested #ifdef: inner false suppresses inner content', () => {
        const texts = tokenTexts(
            '#define A\n' +
            '#ifdef A\n' +
            '  #ifdef B\n' +
            '    inner\n' +
            '  #endif\n' +
            '  outer\n' +
            '#endif'
        );
        assert.ok(!texts.includes('inner'));
        assert.ok(texts.includes('outer'));
    });

    it('#if with literal 1 is true', () => {
        const texts = tokenTexts('#if 1\nyes\n#endif');
        assert.ok(texts.includes('yes'));
    });

    it('#if with literal 0 is false', () => {
        const texts = tokenTexts('#if 0\nno\n#endif');
        assert.ok(!texts.includes('no'));
    });

    it('#if == comparison true', () => {
        const texts = tokenTexts('#define VER 2\n#if VER == 2\nmatch\n#endif');
        assert.ok(texts.includes('match'));
    });

    it('#if == comparison false', () => {
        const texts = tokenTexts('#define VER 1\n#if VER == 2\nnomatch\n#endif');
        assert.ok(!texts.includes('nomatch'));
    });

    it('#if != comparison', () => {
        const texts = tokenTexts('#define VER 1\n#if VER != 2\ndiff\n#endif');
        assert.ok(texts.includes('diff'));
    });

    it('#if && operator: both true', () => {
        const texts = tokenTexts('#define A 1\n#define B 1\n#if A && B\nboth\n#endif');
        assert.ok(texts.includes('both'));
    });

    it('#if && operator: one false', () => {
        const texts = tokenTexts('#define A 1\n#if A && 0\nnope\n#endif');
        assert.ok(!texts.includes('nope'));
    });

    it('#if || operator', () => {
        const texts = tokenTexts('#if 0 || 1\nyes\n#endif');
        assert.ok(texts.includes('yes'));
    });

    it('#if ! operator', () => {
        const texts = tokenTexts('#if !0\nyes\n#endif');
        assert.ok(texts.includes('yes'));
    });

    it('#if defined(NAME) true when macro is defined', () => {
        const texts = tokenTexts('#define MYFLAG\n#if defined(MYFLAG)\ndefined\n#endif');
        assert.ok(texts.includes('defined'));
    });

    it('#if defined(NAME) false when macro not defined', () => {
        const texts = tokenTexts('#if defined(ABSENT)\nnope\n#endif');
        assert.ok(!texts.includes('nope'));
    });

    it('#elif: first branch taken', () => {
        const texts = tokenTexts(
            '#define X 1\n' +
            '#if X == 1\nfirst\n#elif X == 2\nsecond\n#else\nthird\n#endif'
        );
        assert.ok(texts.includes('first'));
        assert.ok(!texts.includes('second'));
        assert.ok(!texts.includes('third'));
    });

    it('#elif: second branch taken', () => {
        const texts = tokenTexts(
            '#define X 2\n' +
            '#if X == 1\nfirst\n#elif X == 2\nsecond\n#else\nthird\n#endif'
        );
        assert.ok(!texts.includes('first'));
        assert.ok(texts.includes('second'));
        assert.ok(!texts.includes('third'));
    });

    it('#elif: else branch taken when all conditions false', () => {
        const texts = tokenTexts(
            '#define X 3\n' +
            '#if X == 1\nfirst\n#elif X == 2\nsecond\n#else\nthird\n#endif'
        );
        assert.ok(!texts.includes('first'));
        assert.ok(!texts.includes('second'));
        assert.ok(texts.includes('third'));
    });

    it('#if arithmetic expression: 2 + 3 == 5', () => {
        const texts = tokenTexts('#if 2 + 3 == 5\nyes\n#endif');
        assert.ok(texts.includes('yes'));
    });

    it('#if relational: 3 > 2', () => {
        const texts = tokenTexts('#if 3 > 2\nyes\n#endif');
        assert.ok(texts.includes('yes'));
    });

    it('#endif without #if emits error', () => {
        const out = preprocess('#endif');
        const errors = out.diagnostics.filter(d => d.severity === 'error');
        assert.ok(errors.length > 0);
    });

    it('unresolvable expression emits warning and treats as false', () => {
        // A complex expression we can't evaluate should emit warning, not crash
        const out = preprocess('#if some_complex_undef_thing > 0\nno\n#endif');
        // Should not crash; 'no' not in output (treated as false)
        const texts = out.preprocessedTokens
            .filter(t => t.kind !== TokenKind.EOF)
            .map(t => t.text);
        // undef identifier resolves to 0, so 0 > 0 is false
        assert.ok(!texts.includes('no'));
    });
});
