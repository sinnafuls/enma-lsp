import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

const URI = 'file:///test.em';

function preprocess(src: string) {
    return preprocessAfterTokenized(tokenize(URI, src), { fileUri: URI });
}

describe('Preprocessor — Unknown directives', () => {
    it('unknown directive emits Warning diagnostic and does not crash', () => {
        const out = preprocess('#foo bar');
        const warnings = out.diagnostics.filter(d => d.severity === 'warning');
        assert.ok(warnings.length > 0);
        assert.ok(warnings.some(w => w.message.includes('#foo') || w.message.includes("'foo'")));
    });

    it('unknown directive: no error diagnostics (only warning)', () => {
        const out = preprocess('#xyzzy stuff');
        const errors = out.diagnostics.filter(d => d.severity === 'error');
        assert.strictEqual(errors.length, 0);
    });

    it('unknown directive: subsequent tokens still processed normally', () => {
        const out = preprocess('#foo\nint x = 1;');
        const texts = out.preprocessedTokens
            .filter(t => t.kind !== TokenKind.EOF)
            .map(t => t.text);
        assert.ok(texts.includes('x'));
        assert.ok(texts.includes('1'));
    });
});
