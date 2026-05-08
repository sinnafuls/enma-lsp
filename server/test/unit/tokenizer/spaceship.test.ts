import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

// Enma v1.1: spaceship operator <=>
describe('Tokenizer — spaceship operator (Enma v1.1)', () => {
    it('<=> emits a single Operator token', () => {
        const toks = tokenize('test.em', '<=>');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof.length, 1, '<=> must lex as a single token');
        assert.strictEqual(nonEof[0].kind, TokenKind.Operator);
        assert.strictEqual(nonEof[0].text, '<=>');
    });

    it('<=> in expression context: a <=> b', () => {
        const toks = tokenize('test.em', 'a <=> b');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof.length, 3);
        assert.strictEqual(nonEof[0].kind, TokenKind.Identifier);
        assert.strictEqual(nonEof[0].text, 'a');
        assert.strictEqual(nonEof[1].kind, TokenKind.Operator);
        assert.strictEqual(nonEof[1].text, '<=>');
        assert.strictEqual(nonEof[2].kind, TokenKind.Identifier);
        assert.strictEqual(nonEof[2].text, 'b');
    });

    it('<=> does NOT split as <= then >', () => {
        // Longest-match: must prefer <=> over <=
        const toks = tokenize('test.em', 'a<=>b');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof.length, 3);
        assert.strictEqual(nonEof[1].text, '<=>');
    });

    it('<=> in operator overload signature', () => {
        // T operator<=>(const T& other);
        const toks = tokenize('test.em', 'operator<=>');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof.length, 2);
        assert.strictEqual(nonEof[0].kind, TokenKind.Reserved);
        assert.strictEqual(nonEof[0].text, 'operator');
        assert.strictEqual(nonEof[1].kind, TokenKind.Operator);
        assert.strictEqual(nonEof[1].text, '<=>');
    });

    it('<= still lexes correctly when not followed by >', () => {
        const toks = tokenize('test.em', 'a <= b');
        const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof[1].text, '<=');
    });
});
