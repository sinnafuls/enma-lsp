import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

describe('Tokenizer — annotations', () => {

    it('[[name]] emits AnnotationOpen, Identifier, AnnotationClose', () => {
        const toks = tokenize('test.em', '[[reflect]]');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof[0].kind, TokenKind.AnnotationOpen);
        assert.strictEqual(nonEof[0].text, '[[');
        assert.strictEqual(nonEof[1].kind, TokenKind.Identifier);
        assert.strictEqual(nonEof[1].text, 'reflect');
        assert.strictEqual(nonEof[2].kind, TokenKind.AnnotationClose);
        assert.strictEqual(nonEof[2].text, ']]');
    });

    it('[[packed]] annotation', () => {
        const toks = tokenize('test.em', '[[packed]]');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof[0].kind, TokenKind.AnnotationOpen);
        assert.strictEqual(nonEof[2].kind, TokenKind.AnnotationClose);
    });

    it('[[inline]] annotation (keyword inside)', () => {
        const toks = tokenize('test.em', '[[inline]]');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof[0].kind, TokenKind.AnnotationOpen);
        // 'inline' is a reserved word
        assert.strictEqual(nonEof[1].kind, TokenKind.Reserved);
        assert.strictEqual(nonEof[1].text, 'inline');
        assert.strictEqual(nonEof[2].kind, TokenKind.AnnotationClose);
    });

    it('[[name("arg")]] with string arg', () => {
        const toks = tokenize('test.em', '[[dll("user32.dll")]]');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof[0].kind, TokenKind.AnnotationOpen);
        assert.strictEqual(nonEof[nonEof.length - 1].kind, TokenKind.AnnotationClose);
        assert.ok(nonEof.some(t => t.kind === TokenKind.String));
    });

    it('[[align(16)]] with numeric arg', () => {
        const toks = tokenize('test.em', '[[align(16)]]');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof[0].kind, TokenKind.AnnotationOpen);
        assert.ok(nonEof.some(t => t.kind === TokenKind.Number && t.text === '16'));
        assert.strictEqual(nonEof[nonEof.length - 1].kind, TokenKind.AnnotationClose);
    });

    it('[[reflect]] [[serialize]] two stacked annotations', () => {
        const toks = tokenize('test.em', '[[reflect]] [[serialize]]');
        const opens = toks.filter(t => t.kind === TokenKind.AnnotationOpen);
        const closes = toks.filter(t => t.kind === TokenKind.AnnotationClose);
        assert.strictEqual(opens.length, 2);
        assert.strictEqual(closes.length, 2);
    });

    it('annotation on its own line followed by struct', () => {
        const src = '[[reflect]]\nstruct Foo {}';
        const toks = tokenize('test.em', src);
        assert.strictEqual(toks[0].kind, TokenKind.AnnotationOpen);
        const reserved = toks.find(t => t.kind === TokenKind.Reserved && t.text === 'struct');
        assert.ok(reserved !== undefined);
    });

    it('annotation open token location', () => {
        const toks = tokenize('test.em', '[[reflect]]');
        assert.strictEqual(toks[0].location.start.character, 0);
        assert.strictEqual(toks[0].location.start.line, 0);
    });

    it('[[serialize]] annotation identifier', () => {
        const toks = tokenize('test.em', '[[serialize]]');
        const ident = toks.find(t => t.kind === TokenKind.Identifier);
        assert.ok(ident !== undefined);
        assert.strictEqual(ident!.text, 'serialize');
    });

    it('[] single bracket is NOT AnnotationOpen', () => {
        const toks = tokenize('test.em', '[](int32 a) -> int32 { return a; }');
        const opens = toks.filter(t => t.kind === TokenKind.AnnotationOpen);
        assert.strictEqual(opens.length, 0, 'Single [ should not be AnnotationOpen');
    });

    it('[[dll("user32.dll")]] full token sequence', () => {
        const src = '[[dll("user32.dll")]]';
        const toks = tokenize('test.em', src);
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof[0].kind, TokenKind.AnnotationOpen);
        assert.strictEqual(nonEof[1].kind, TokenKind.Identifier); // dll
        assert.strictEqual(nonEof[2].kind, TokenKind.Punctuation); // (
        assert.strictEqual(nonEof[3].kind, TokenKind.String);       // "user32.dll"
        assert.strictEqual(nonEof[4].kind, TokenKind.Punctuation); // )
        assert.strictEqual(nonEof[5].kind, TokenKind.AnnotationClose);
    });

    it('multiple stacked [[reflect]] [[serialize]] preserves order', () => {
        const src = '[[reflect]] [[serialize]]';
        const toks = tokenize('test.em', src);
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof[0].kind, TokenKind.AnnotationOpen);
        assert.strictEqual(nonEof[1].text, 'reflect');
        assert.strictEqual(nonEof[2].kind, TokenKind.AnnotationClose);
        assert.strictEqual(nonEof[3].kind, TokenKind.AnnotationOpen);
        assert.strictEqual(nonEof[4].text, 'serialize');
        assert.strictEqual(nonEof[5].kind, TokenKind.AnnotationClose);
    });

    it('annotation before extern', () => {
        const src = '[[dll("user32.dll")]]\nextern int32 Fn();';
        const toks = tokenize('test.em', src);
        assert.strictEqual(toks[0].kind, TokenKind.AnnotationOpen);
        const ext = toks.find(t => t.text === 'extern');
        assert.ok(ext !== undefined);
        assert.strictEqual(ext!.kind, TokenKind.Reserved);
    });
});
