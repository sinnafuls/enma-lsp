import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

describe('Tokenizer — comments', () => {

    it('line comment emits TokenComment with kind=line', () => {
        const toks = tokenize('test.em', '// hello world');
        const t = toks[0];
        assert.strictEqual(t.kind, TokenKind.Comment);
        assert.strictEqual((t as any).commentKind, 'line');
        assert.ok(t.text.includes('hello world'));
    });

    it('line comment stops at newline', () => {
        const toks = tokenize('test.em', '// comment\nident');
        assert.strictEqual(toks[0].kind, TokenKind.Comment);
        assert.strictEqual(toks[1].kind, TokenKind.Identifier);
        assert.strictEqual(toks[1].text, 'ident');
    });

    it('empty line comment', () => {
        const toks = tokenize('test.em', '//');
        assert.strictEqual(toks[0].kind, TokenKind.Comment);
        assert.strictEqual((toks[0] as any).commentKind, 'line');
    });

    it('block comment emits TokenComment with kind=block', () => {
        const toks = tokenize('test.em', '/* block */');
        const t = toks[0];
        assert.strictEqual(t.kind, TokenKind.Comment);
        assert.strictEqual((t as any).commentKind, 'block');
    });

    it('block comment first */ closes (not nested)', () => {
        const toks = tokenize('test.em', '/* outer /* inner */ rest');
        // "rest" should be tokenized as an identifier after the comment closes at first */
        assert.strictEqual(toks[0].kind, TokenKind.Comment);
        assert.ok(toks[0].text.includes('outer'));
        assert.ok(toks[0].text.includes('inner'));
        // "rest" comes after
        const ident = toks.find(t => t.text === 'rest');
        assert.ok(ident !== undefined, '"rest" should be tokenized after comment close');
    });

    it('block comment spanning multiple lines', () => {
        const src = `/*\n * line1\n * line2\n */`;
        const toks = tokenize('test.em', src);
        assert.strictEqual(toks[0].kind, TokenKind.Comment);
        assert.strictEqual((toks[0] as any).commentKind, 'block');
    });

    it('doc comment emits kind=doc', () => {
        const toks = tokenize('test.em', '/** doc comment */');
        const t = toks[0];
        assert.strictEqual(t.kind, TokenKind.Comment);
        assert.strictEqual((t as any).commentKind, 'doc');
    });

    it('doc comment /** has same close rule as block', () => {
        const toks = tokenize('test.em', '/** doc */ ident');
        assert.strictEqual(toks[0].kind, TokenKind.Comment);
        assert.strictEqual((toks[0] as any).commentKind, 'doc');
        assert.strictEqual(toks[1].kind, TokenKind.Identifier);
    });

    it('// inside double-quoted string is NOT a comment', () => {
        const toks = tokenize('test.em', '"http://example.com"');
        assert.strictEqual(toks[0].kind, TokenKind.String);
        assert.strictEqual(toks.filter(t => t.kind === TokenKind.Comment).length, 0);
    });

    it('/* inside double-quoted string is NOT a comment', () => {
        const toks = tokenize('test.em', '"/* not a comment */"');
        assert.strictEqual(toks[0].kind, TokenKind.String);
        assert.strictEqual(toks.filter(t => t.kind === TokenKind.Comment).length, 0);
    });

    it('// inside char literal is NOT a comment', () => {
        const toks = tokenize('test.em', "'//'");
        // The char literal contains //
        assert.strictEqual(toks[0].kind, TokenKind.Char);
        assert.strictEqual(toks.filter(t => t.kind === TokenKind.Comment).length, 0);
    });

    it('multiple line comments', () => {
        const src = `// first\n// second\nint32 x`;
        const toks = tokenize('test.em', src);
        const comments = toks.filter(t => t.kind === TokenKind.Comment);
        assert.strictEqual(comments.length, 2);
    });

    it('block comment immediately followed by code', () => {
        const toks = tokenize('test.em', '/*comment*/int32');
        assert.strictEqual(toks[0].kind, TokenKind.Comment);
        assert.strictEqual(toks[1].kind, TokenKind.Reserved);
        assert.strictEqual(toks[1].text, 'int32');
    });

    it('line comment with // in middle of comment text', () => {
        const toks = tokenize('test.em', '// a // b');
        assert.strictEqual(toks[0].kind, TokenKind.Comment);
        assert.ok(toks[0].text.includes('a // b'));
    });

    it('comment location line tracking', () => {
        const src = 'int32\n// comment\nvoid';
        const toks = tokenize('test.em', src);
        const comment = toks.find(t => t.kind === TokenKind.Comment)!;
        assert.strictEqual(comment.location.start.line, 1);
    });

    it('block comment does not consume code after */', () => {
        const toks = tokenize('test.em', '/* c */ int32 x;');
        const reserved = toks.find(t => t.kind === TokenKind.Reserved);
        assert.ok(reserved !== undefined);
        assert.strictEqual(reserved!.text, 'int32');
    });

    it('doc comment multi-line', () => {
        const src = `/**\n * @param x\n * @returns y\n */`;
        const toks = tokenize('test.em', src);
        assert.strictEqual(toks[0].kind, TokenKind.Comment);
        assert.strictEqual((toks[0] as any).commentKind, 'doc');
    });

    it('empty block comment', () => {
        const toks = tokenize('test.em', '/**/');
        assert.strictEqual(toks[0].kind, TokenKind.Comment);
        assert.strictEqual((toks[0] as any).commentKind, 'block');
    });
});
