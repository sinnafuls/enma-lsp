import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';
import { KEYWORDS, INTRINSICS } from '../../../src/compiler_tokenizer/reservedWord';

describe('Tokenizer — keywords', () => {
    function expectReserved(source: string): void {
        const tokens = tokenize('test.em', source);
        const nonEof = tokens.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof.length, 1, `Expected 1 token for '${source}', got ${nonEof.length}`);
        assert.strictEqual(nonEof[0].kind, TokenKind.Reserved, `Expected Reserved for '${source}'`);
        assert.strictEqual(nonEof[0].text, source.trim());
    }

    // All 47+ keywords
    const allKeywords = [...KEYWORDS];
    for (const kw of allKeywords) {
        it(`keyword '${kw}' emits TokenReserved`, () => expectReserved(kw));
    }

    // All intrinsics
    const allIntrinsics = [...INTRINSICS];
    for (const intr of allIntrinsics) {
        it(`intrinsic '${intr}' emits TokenReserved`, () => expectReserved(intr));
    }

    it('plain identifier does not emit Reserved', () => {
        const tokens = tokenize('test.em', 'myVar');
        const nonEof = tokens.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof[0].kind, TokenKind.Identifier);
    });

    it('keyword prefix is not treated as keyword', () => {
        const tokens = tokenize('test.em', 'returns');
        const nonEof = tokens.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof[0].kind, TokenKind.Identifier);
        assert.strictEqual(nonEof[0].text, 'returns');
    });

    it('null keyword emits Reserved', () => expectReserved('null'));
    it('nullptr keyword emits Reserved', () => expectReserved('nullptr'));
    it('this keyword emits Reserved', () => expectReserved('this'));
    it('true keyword emits Reserved', () => expectReserved('true'));
    it('false keyword emits Reserved', () => expectReserved('false'));

    it('multiple keywords in sequence', () => {
        const tokens = tokenize('test.em', 'int32 x');
        const nonEof = tokens.filter(t => t.kind !== TokenKind.EOF);
        assert.strictEqual(nonEof[0].kind, TokenKind.Reserved);
        assert.strictEqual(nonEof[0].text, 'int32');
        assert.strictEqual(nonEof[1].kind, TokenKind.Identifier);
        assert.strictEqual(nonEof[1].text, 'x');
    });

    it('string type emits Reserved', () => expectReserved('string'));
    it('auto emits Reserved', () => expectReserved('auto'));
    it('nullable emits Reserved', () => expectReserved('nullable'));
    it('static_cast emits Reserved', () => expectReserved('static_cast'));
    it('reinterpret_cast emits Reserved', () => expectReserved('reinterpret_cast'));
    it('const_cast emits Reserved', () => expectReserved('const_cast'));
    it('static_assert emits Reserved', () => expectReserved('static_assert'));
    it('constexpr emits Reserved', () => expectReserved('constexpr'));
    it('coroutine emits Reserved', () => expectReserved('coroutine'));
    it('delegate emits Reserved', () => expectReserved('delegate'));
    it('mixin emits Reserved', () => expectReserved('mixin'));
    it('defer emits Reserved', () => expectReserved('defer'));
    it('yield emits Reserved', () => expectReserved('yield'));
    it('match emits Reserved', () => expectReserved('match'));
    it('override emits Reserved', () => expectReserved('override'));
    it('property emits Reserved', () => expectReserved('property'));
    it('volatile emits Reserved', () => expectReserved('volatile'));
    it('offsetof emits Reserved', () => expectReserved('offsetof'));
    it('decltype emits Reserved', () => expectReserved('decltype'));
    it('get emits Reserved', () => expectReserved('get'));
    it('set emits Reserved', () => expectReserved('set'));
    it('out emits Reserved', () => expectReserved('out'));
    it('inline emits Reserved', () => expectReserved('inline'));

    it('class member access does not confuse keywords', () => {
        const tokens = tokenize('test.em', 'obj.class');
        const nonEof = tokens.filter(t => t.kind !== TokenKind.EOF);
        // obj, ., class
        assert.strictEqual(nonEof[0].kind, TokenKind.Identifier);
        assert.strictEqual(nonEof[1].kind, TokenKind.Operator);
        assert.strictEqual(nonEof[2].kind, TokenKind.Reserved);
    });
});
