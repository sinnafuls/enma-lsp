process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture, pos } from './_helpers';
import { provideCompletionOfToken } from '../../../src/services/completionExtension';

const URI = 'file:///compext.em';

describe('completion-extension service', () => {
    it('caret in line comment returns empty', () => {
        const f = buildFixture(URI, '// some comment text here\nint32 x = 0;');
        const r = provideCompletionOfToken(f.rawTokens, pos(0, 10));
        assert.deepEqual(r, []);
    });

    it('caret in plain string literal returns empty', () => {
        const f = buildFixture(URI, 'string s = "hello world";');
        const r = provideCompletionOfToken(f.rawTokens, pos(0, 14));
        assert.deepEqual(r, []);
    });

    it('caret outside any token returns undefined (default completion path)', () => {
        const f = buildFixture(URI, 'int32 x = 0;');
        const r = provideCompletionOfToken(f.rawTokens, pos(5, 0));
        assert.equal(r, undefined);
    });

    it('returns module completions when caret is inside import string', () => {
        // 'import "math";' — string token spans cols 7-12; caret at col 9 (inside "math").
        const f = buildFixture(URI, 'import "math";');
        const r = provideCompletionOfToken(f.rawTokens, pos(0, 9));
        assert.ok(r !== undefined, 'expected module completions, not undefined');
        assert.ok(r!.some(item => item.label === 'math'), 'expected math in module completions');
    });
});
