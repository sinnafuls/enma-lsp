import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

const URI = 'file:///test.em';

function preprocess(src: string) {
    return preprocessAfterTokenized(tokenize(URI, src), { fileUri: URI });
}

describe('Preprocessor — Source map preservation', () => {
    it('non-expanded tokens retain their original URI', () => {
        const out = preprocess('int x = 1;');
        for (const tok of out.preprocessedTokens) {
            if (tok.kind === TokenKind.EOF) continue;
            assert.strictEqual(tok.location.uri, URI);
        }
    });

    it('non-expanded tokens retain correct line numbers', () => {
        const out = preprocess('int x = 1;\nint y = 2;');
        const yTok = out.preprocessedTokens.find(t => t.text === 'y');
        assert.ok(yTok, 'y token should exist');
        assert.strictEqual(yTok!.location.start.line, 1); // 0-based line 1
    });

    it('expanded object-like macro token has call-site location', () => {
        const out = preprocess('#define VAL 99\nint x = VAL;');
        // The '99' token from macro expansion should have the call-site location
        const ninetyNine = out.preprocessedTokens.find(t => t.text === '99');
        assert.ok(ninetyNine, 'expanded token should be in output');
        // Its location should be on line 1 (the expansion call site)
        assert.strictEqual(ninetyNine!.location.start.line, 1);
    });

    it('expanded tokens have expansionTrace entries', () => {
        const out = preprocess('#define VAL 99\nint x = VAL;');
        assert.ok(out.expansionTrace.size > 0);
    });

    it('expansionTrace siteToken has call-site location', () => {
        const out = preprocess('#define VAL 99\nint x = VAL;');
        for (const [, exp] of out.expansionTrace) {
            // siteToken is on line 1 (call site)
            assert.strictEqual(exp.siteToken.location.start.line, 1);
        }
    });

    it('expansionTrace defToken references macro definition', () => {
        const out = preprocess('#define VAL 99\nint x = VAL;');
        for (const [, exp] of out.expansionTrace) {
            assert.strictEqual(exp.defToken.text, 'VAL');
        }
    });

    it('expansionTrace callerScope is the file URI', () => {
        const out = preprocess('#define VAL 99\nint x = VAL;');
        for (const [, exp] of out.expansionTrace) {
            assert.strictEqual(exp.callerScope, URI);
        }
    });

    it('multiple macro expansions each have correct trace entries', () => {
        const out = preprocess('#define A 1\n#define B 2\nint x = A + B;');
        assert.ok(out.expansionTrace.size >= 2);
        const defNames = new Set([...out.expansionTrace.values()].map(e => e.defToken.text));
        assert.ok(defNames.has('A'));
        assert.ok(defNames.has('B'));
    });
});
