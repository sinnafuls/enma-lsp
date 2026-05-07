import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';
import { INTRINSICS } from '../../../src/compiler_tokenizer/reservedWord';

describe('Tokenizer — intrinsics', () => {

    for (const intr of INTRINSICS) {
        it(`${intr} emits TokenReserved`, () => {
            const toks = tokenize('test.em', intr);
            const nonEof = toks.filter(t => t.kind !== TokenKind.EOF);
            assert.strictEqual(nonEof.length, 1);
            assert.strictEqual(nonEof[0].kind, TokenKind.Reserved);
            assert.strictEqual(nonEof[0].text, intr);
        });
    }

    it('__va_count in while condition', () => {
        const toks = tokenize('test.em', 'while (i < __va_count)');
        const intr = toks.find(t => t.text === '__va_count');
        assert.ok(intr !== undefined);
        assert.strictEqual(intr!.kind, TokenKind.Reserved);
    });

    it('__va_arg(i) — intrinsic + call args', () => {
        const toks = tokenize('test.em', '__va_arg(i)');
        assert.strictEqual(toks[0].kind, TokenKind.Reserved);
        assert.strictEqual(toks[0].text, '__va_arg');
        assert.ok(toks.some(t => t.text === '('));
        assert.ok(toks.some(t => t.kind === TokenKind.Identifier && t.text === 'i'));
    });

    it('__asm_rdtsc() call', () => {
        const toks = tokenize('test.em', '__asm_rdtsc()');
        assert.strictEqual(toks[0].kind, TokenKind.Reserved);
        assert.strictEqual(toks[0].text, '__asm_rdtsc');
    });

    it('__asm_pause() call', () => {
        const toks = tokenize('test.em', '__asm_pause()');
        assert.strictEqual(toks[0].kind, TokenKind.Reserved);
        assert.strictEqual(toks[0].text, '__asm_pause');
    });

    it('__asm_mfence call', () => {
        const toks = tokenize('test.em', '__asm_mfence');
        assert.strictEqual(toks[0].kind, TokenKind.Reserved);
        assert.strictEqual(toks[0].text, '__asm_mfence');
    });

    it('__asm_nop call', () => {
        const toks = tokenize('test.em', '__asm_nop');
        assert.strictEqual(toks[0].kind, TokenKind.Reserved);
        assert.strictEqual(toks[0].text, '__asm_nop');
    });

    it('intrinsic prefix does not match partial', () => {
        const toks = tokenize('test.em', '__va_count2');
        // __va_count2 is not a known intrinsic, should be Identifier
        assert.strictEqual(toks[0].kind, TokenKind.Identifier);
        assert.strictEqual(toks[0].text, '__va_count2');
    });

    it('regular __ prefix identifier is not reserved', () => {
        const toks = tokenize('test.em', '__user_custom');
        assert.strictEqual(toks[0].kind, TokenKind.Identifier);
    });
});
