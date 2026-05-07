import * as assert from 'assert';
import { tokenize, tokenizeWithDiagnostics } from '../../../src/compiler_tokenizer/tokenizer';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

describe('Tokenizer — edge cases', () => {

    it('empty file produces only EOF', () => {
        const toks = tokenize('test.em', '');
        assert.strictEqual(toks.length, 1);
        assert.strictEqual(toks[0].kind, TokenKind.EOF);
    });

    it('single newline produces only EOF', () => {
        const toks = tokenize('test.em', '\n');
        assert.strictEqual(toks.length, 1);
        assert.strictEqual(toks[0].kind, TokenKind.EOF);
    });

    it('whitespace only produces only EOF', () => {
        const toks = tokenize('test.em', '   \t  \n  \r\n  ');
        assert.strictEqual(toks.length, 1);
        assert.strictEqual(toks[0].kind, TokenKind.EOF);
    });

    it('EOF token has correct kind', () => {
        const toks = tokenize('test.em', 'x');
        assert.strictEqual(toks[toks.length - 1].kind, TokenKind.EOF);
    });

    it('EOF token has empty text', () => {
        const toks = tokenize('test.em', 'x');
        assert.strictEqual(toks[toks.length - 1].text, '');
    });

    it('file ending mid-string emits diagnostic', () => {
        const result = tokenizeWithDiagnostics('test.em', '"unterminated');
        assert.ok(result.diagnostics.length > 0, 'Should emit diagnostic for unterminated string');
    });

    it('file ending mid-string still emits String token', () => {
        const result = tokenizeWithDiagnostics('test.em', '"unterminated');
        const strTok = result.tokens.find(t => t.kind === TokenKind.String);
        assert.ok(strTok !== undefined, 'Should still emit a String token');
    });

    it('file ending mid-block-comment emits Comment token', () => {
        const toks = tokenize('test.em', '/* unterminated');
        const comment = toks.find(t => t.kind === TokenKind.Comment);
        assert.ok(comment !== undefined);
    });

    it('file ending mid-block-comment does not crash', () => {
        assert.doesNotThrow(() => tokenize('test.em', '/* no close'));
    });

    it('UTF-8 BOM is stripped', () => {
        const bom = '﻿';
        const toks = tokenize('test.em', bom + 'int32 x');
        // Should not produce a spurious token for the BOM
        assert.strictEqual(toks[0].kind, TokenKind.Reserved);
        assert.strictEqual(toks[0].text, 'int32');
    });

    it('CRLF line endings track line numbers correctly', () => {
        const toks = tokenize('test.em', 'a\r\nb');
        const b = toks.find(t => t.text === 'b')!;
        assert.strictEqual(b.location.start.line, 1);
    });

    it('token location uri is preserved', () => {
        const toks = tokenize('file:///test/foo.em', 'int32');
        assert.strictEqual(toks[0].location.uri, 'file:///test/foo.em');
    });

    it('identifier immediately after number is separate token', () => {
        // 42abc — 42 is a number, abc is an identifier
        const toks = tokenize('test.em', '42abc');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof[0].kind, TokenKind.Number);
        assert.strictEqual(nonEof[0].text, '42');
        assert.strictEqual(nonEof[1].kind, TokenKind.Identifier);
        assert.strictEqual(nonEof[1].text, 'abc');
    });

    it('nested braces in normal code do not confuse f-string tracking', () => {
        const toks = tokenize('test.em', '{ int32 x = 0; }');
        const fTokens = toks.filter(t =>
            t.kind === TokenKind.FStringStart ||
            t.kind === TokenKind.FStringEnd ||
            t.kind === TokenKind.FStringExprOpen ||
            t.kind === TokenKind.FStringExprClose
        );
        assert.strictEqual(fTokens.length, 0, 'No f-string tokens in plain code');
    });

    it('multiple consecutive line comments', () => {
        const src = '// a\n// b\n// c\n';
        const toks = tokenize('test.em', src);
        const comments = toks.filter(t => t.kind === TokenKind.Comment);
        assert.strictEqual(comments.length, 3);
    });

    it('empty heredoc', () => {
        const toks = tokenize('test.em', '""""""');
        const str = toks.find(t => t.kind === TokenKind.String);
        assert.ok(str !== undefined);
        assert.strictEqual((str as any).stringKind, 'heredoc');
    });
});
