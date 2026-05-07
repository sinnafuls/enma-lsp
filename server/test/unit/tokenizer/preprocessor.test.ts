import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

describe('Tokenizer — preprocessor', () => {

    function firstPreprocessor(src: string) {
        const toks = tokenize('test.em', src);
        return toks.find(t => t.kind === TokenKind.Preprocessor);
    }

    it('#include emits TokenPreprocessor with directive=include', () => {
        const t = firstPreprocessor('#include "core.em"');
        assert.ok(t);
        assert.strictEqual(t!.kind, TokenKind.Preprocessor);
        assert.strictEqual((t as any).directive, 'include');
    });

    it('#define emits TokenPreprocessor with directive=define', () => {
        const t = firstPreprocessor('#define MAX_HP 100');
        assert.strictEqual((t as any).directive, 'define');
    });

    it('#undef emits TokenPreprocessor', () => {
        const t = firstPreprocessor('#undef SOMETHING');
        assert.strictEqual((t as any).directive, 'undef');
    });

    it('#ifdef emits TokenPreprocessor', () => {
        const t = firstPreprocessor('#ifdef DEBUG');
        assert.strictEqual((t as any).directive, 'ifdef');
    });

    it('#ifndef emits TokenPreprocessor', () => {
        const t = firstPreprocessor('#ifndef RELEASE');
        assert.strictEqual((t as any).directive, 'ifndef');
    });

    it('#if emits TokenPreprocessor', () => {
        const t = firstPreprocessor('#if VERSION > 2');
        assert.strictEqual((t as any).directive, 'if');
    });

    it('#elif emits TokenPreprocessor', () => {
        const t = firstPreprocessor('#elif VERSION == 1');
        assert.strictEqual((t as any).directive, 'elif');
    });

    it('#else emits TokenPreprocessor', () => {
        const t = firstPreprocessor('#else');
        assert.strictEqual((t as any).directive, 'else');
    });

    it('#endif emits TokenPreprocessor', () => {
        const t = firstPreprocessor('#endif');
        assert.strictEqual((t as any).directive, 'endif');
    });

    it('#pragma emits TokenPreprocessor', () => {
        const t = firstPreprocessor('#pragma once');
        assert.strictEqual((t as any).directive, 'pragma');
    });

    it('#define LOG(m) println(m) — macro args are separate tokens', () => {
        const src = '#define LOG(m) println(m)';
        const toks = tokenize('test.em', src);
        const pp = toks.find(t => t.kind === TokenKind.Preprocessor)!;
        assert.strictEqual((pp as any).directive, 'define');
        // After the preprocessor token, args should be identifiers/punctuation
        const afterPP = toks.slice(toks.indexOf(pp) + 1).filter(t => t.kind !== TokenKind.EOF);
        assert.ok(afterPP.some(t => t.text === 'LOG'));
        assert.ok(afterPP.some(t => t.text === 'm'));
        assert.ok(afterPP.some(t => t.text === 'println'));
    });

    it('#include "path.em" — string arg is separate token', () => {
        const src = '#include "path.em"';
        const toks = tokenize('test.em', src);
        const pp = toks.find(t => t.kind === TokenKind.Preprocessor)!;
        const afterPP = toks.slice(toks.indexOf(pp) + 1).filter(t => t.kind !== TokenKind.EOF);
        assert.ok(afterPP.some(t => t.kind === TokenKind.String));
    });

    it('#define MAX_HP 100 — number arg is separate token', () => {
        const src = '#define MAX_HP 100';
        const toks = tokenize('test.em', src);
        assert.ok(toks.some(t => t.kind === TokenKind.Number && t.text === '100'));
    });

    it('preprocessor text includes # and directive name', () => {
        const t = firstPreprocessor('#ifdef DEBUG');
        assert.strictEqual(t!.text, '#ifdef');
    });

    it('preprocessor after blank first line', () => {
        const src = '\n#include "x.em"';
        const t = firstPreprocessor(src);
        assert.ok(t);
        assert.strictEqual((t as any).directive, 'include');
    });

    it('preprocessor on first line col 0', () => {
        const t = firstPreprocessor('#endif');
        assert.ok(t);
        assert.strictEqual(t!.location.start.character, 0);
    });

    it('preprocessor with leading whitespace on line', () => {
        const src = '   #define X 1';
        const t = firstPreprocessor(src);
        assert.ok(t, 'should recognize # after leading whitespace');
    });

    it('# NOT at start of line is not a preprocessor (@ operator-like)', () => {
        // The # mid-expression is not a preprocessor directive
        const src = 'int32 x; #define Y 1';
        const toks = tokenize('test.em', src);
        // #define is on same line after code — not at line start
        const pp = toks.find(t => t.kind === TokenKind.Preprocessor);
        assert.strictEqual(pp, undefined, '# mid-line should NOT be preprocessor');
    });

    it('showcase: full preprocessor block', () => {
        const src = '#include "core.em"\n#define MAX_HP 100\n#ifdef DEBUG\n#define LOG(m) println(m)\n#endif';
        const toks = tokenize('test.em', src);
        const pps = toks.filter(t => t.kind === TokenKind.Preprocessor);
        assert.strictEqual(pps.length, 5);
        const directives = pps.map(t => (t as any).directive);
        assert.ok(directives.includes('include'));
        assert.ok(directives.includes('define'));
        assert.ok(directives.includes('ifdef'));
        assert.ok(directives.includes('endif'));
    });
});
