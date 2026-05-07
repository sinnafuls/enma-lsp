import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

describe('Tokenizer — literals', () => {

    // --- Integer literals ---
    it('decimal integer', () => {
        const toks = tokenize('test.em', '42');
        const t = toks[0];
        assert.strictEqual(t.kind, TokenKind.Number);
        assert.strictEqual((t as any).numericKind, 'int');
        assert.strictEqual(t.text, '42');
    });

    it('zero integer', () => {
        const toks = tokenize('test.em', '0');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual((toks[0] as any).numericKind, 'int');
    });

    it('large decimal integer', () => {
        const toks = tokenize('test.em', '2147483647');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual((toks[0] as any).numericKind, 'int');
    });

    // --- Hex literals ---
    it('hex literal lowercase', () => {
        const toks = tokenize('test.em', '0xff');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual((toks[0] as any).numericKind, 'hex');
        assert.strictEqual(toks[0].text, '0xff');
    });

    it('hex literal uppercase 0X', () => {
        const toks = tokenize('test.em', '0XFF');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual((toks[0] as any).numericKind, 'hex');
    });

    it('hex literal 0xDEADBEEF', () => {
        const toks = tokenize('test.em', '0xDEADBEEF');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual((toks[0] as any).numericKind, 'hex');
        assert.strictEqual(toks[0].text, '0xDEADBEEF');
    });

    it('hex NOT split as 0 + xDEAD', () => {
        const toks = tokenize('test.em', '0xDEAD');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof.length, 1);
        assert.strictEqual(nonEof[0].text, '0xDEAD');
    });

    // --- Float literals ---
    it('float with decimal point', () => {
        const toks = tokenize('test.em', '3.14');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual((toks[0] as any).numericKind, 'float');
    });

    it('float with f suffix', () => {
        const toks = tokenize('test.em', '3.14f');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual((toks[0] as any).numericKind, 'float');
        assert.strictEqual(toks[0].text, '3.14f');
    });

    it('float with exponent', () => {
        const toks = tokenize('test.em', '1.5e-3');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual((toks[0] as any).numericKind, 'float');
        assert.strictEqual(toks[0].text, '1.5e-3');
    });

    it('float with positive exponent', () => {
        const toks = tokenize('test.em', '2e+10');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual((toks[0] as any).numericKind, 'float');
    });

    it('float uppercase E exponent', () => {
        const toks = tokenize('test.em', '1.5E3');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual((toks[0] as any).numericKind, 'float');
    });

    it('PI constant float', () => {
        const toks = tokenize('test.em', '3.14159f');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual(toks[0].text, '3.14159f');
    });

    // --- UDL (user-defined literal) splitting ---
    it('UDL 42_km splits into number + identifier', () => {
        const toks = tokenize('test.em', '42_km');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof.length, 2, 'Should split into 2 tokens');
        assert.strictEqual(nonEof[0].kind, TokenKind.Number);
        assert.strictEqual(nonEof[0].text, '42');
        assert.strictEqual(nonEof[1].kind, TokenKind.Identifier);
        assert.strictEqual(nonEof[1].text, '_km');
    });

    it('UDL 1.5f_meter splits into number + identifier', () => {
        const toks = tokenize('test.em', '1.5f_meter');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof.length, 2);
        assert.strictEqual(nonEof[0].kind, TokenKind.Number);
        assert.strictEqual(nonEof[0].text, '1.5f');
        assert.strictEqual(nonEof[1].kind, TokenKind.Identifier);
        assert.strictEqual(nonEof[1].text, '_meter');
    });

    it('UDL 100_percent splits', () => {
        const toks = tokenize('test.em', '100_percent');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof.length, 2);
        assert.strictEqual(nonEof[0].text, '100');
        assert.strictEqual(nonEof[1].text, '_percent');
    });

    // --- Char literals ---
    it('simple char literal', () => {
        const toks = tokenize('test.em', "'a'");
        assert.strictEqual(toks[0].kind, TokenKind.Char);
    });

    it('char escape \\n', () => {
        const toks = tokenize('test.em', "'\\n'");
        assert.strictEqual(toks[0].kind, TokenKind.Char);
        assert.ok(toks[0].text.includes('\\n'));
    });

    it('char escape \\t', () => {
        const toks = tokenize('test.em', "'\\t'");
        assert.strictEqual(toks[0].kind, TokenKind.Char);
    });

    it('char escape \\xNN', () => {
        const toks = tokenize('test.em', "'\\x41'");
        assert.strictEqual(toks[0].kind, TokenKind.Char);
        assert.ok(toks[0].text.includes('\\x41'));
    });

    it('char escape \\uNNNN', () => {
        const toks = tokenize('test.em', "'\\u0041'");
        assert.strictEqual(toks[0].kind, TokenKind.Char);
        assert.ok(toks[0].text.includes('\\u0041'));
    });

    it('multi-byte UTF-8 char', () => {
        const toks = tokenize('test.em', "'Ä'");
        assert.strictEqual(toks[0].kind, TokenKind.Char);
    });

    it('null char \\0', () => {
        const toks = tokenize('test.em', "'\\0'");
        assert.strictEqual(toks[0].kind, TokenKind.Char);
    });

    // --- String literals ---
    it('empty double-quoted string', () => {
        const toks = tokenize('test.em', '""');
        assert.strictEqual(toks[0].kind, TokenKind.String);
        assert.strictEqual((toks[0] as any).stringKind, 'double');
    });

    it('double-quoted string with content', () => {
        const toks = tokenize('test.em', '"hello world"');
        assert.strictEqual(toks[0].kind, TokenKind.String);
        assert.strictEqual((toks[0] as any).stringKind, 'double');
    });

    it('string with escape sequences', () => {
        const toks = tokenize('test.em', '"hello\\nworld"');
        assert.strictEqual(toks[0].kind, TokenKind.String);
    });

    it('heredoc string', () => {
        const toks = tokenize('test.em', '"""multi\nline\ntext"""');
        assert.strictEqual(toks[0].kind, TokenKind.String);
        assert.strictEqual((toks[0] as any).stringKind, 'heredoc');
    });

    it('heredoc with embedded double quotes', () => {
        const toks = tokenize('test.em', '"""say "hello" please"""');
        assert.strictEqual(toks[0].kind, TokenKind.String);
        assert.strictEqual((toks[0] as any).stringKind, 'heredoc');
    });

    // --- Bool literals ---
    it('true is Reserved', () => {
        const toks = tokenize('test.em', 'true');
        assert.strictEqual(toks[0].kind, TokenKind.Reserved);
    });

    it('false is Reserved', () => {
        const toks = tokenize('test.em', 'false');
        assert.strictEqual(toks[0].kind, TokenKind.Reserved);
    });

    // --- null ---
    it('null is Reserved', () => {
        const toks = tokenize('test.em', 'null');
        assert.strictEqual(toks[0].kind, TokenKind.Reserved);
    });

    // --- Location tracking ---
    it('number location is correct', () => {
        const toks = tokenize('test.em', '  42');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual(toks[0].location.start.character, 2);
        assert.strictEqual(toks[0].location.start.line, 0);
    });

    it('number on second line', () => {
        const toks = tokenize('test.em', '\n42');
        assert.strictEqual(toks[0].kind, TokenKind.Number);
        assert.strictEqual(toks[0].location.start.line, 1);
    });

    it('scientific notation no f suffix', () => {
        const toks = tokenize('test.em', '1.5e-3');
        assert.strictEqual((toks[0] as any).numericKind, 'float');
        assert.strictEqual(toks[0].text, '1.5e-3');
    });

    it('integer followed by dot is NOT float (dot is operator)', () => {
        const toks = tokenize('test.em', '42.method');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        // 42, ., method
        assert.strictEqual(nonEof[0].kind, TokenKind.Number);
        assert.strictEqual((nonEof[0] as any).numericKind, 'int');
        assert.strictEqual(nonEof[1].kind, TokenKind.Operator);
        assert.strictEqual(nonEof[1].text, '.');
    });
});
