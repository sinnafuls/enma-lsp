process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import * as lsp from 'vscode-languageserver';
import { buildFixture, pos } from './_helpers';
import { providePostfixCompletions } from '../../../src/services/postfixCompletion';

const URI = 'file:///postfix.em';

describe('postfix completion service', () => {
    it('returns undefined when caret is on a plain identifier (no dot)', () => {
        const f = buildFixture(URI, 'int32 x = 0;');
        const r = providePostfixCompletions(f.rawTokens, pos(0, 5));
        assert.equal(r, undefined);
    });

    it('returns undefined when caret is at start of file', () => {
        const f = buildFixture(URI, 'int32 x = 0;');
        const r = providePostfixCompletions(f.rawTokens, pos(0, 0));
        assert.equal(r, undefined);
    });

    it('returns undefined for `::` namespace access', () => {
        const f = buildFixture(URI, 'Foo::');
        const r = providePostfixCompletions(f.rawTokens, pos(0, 5));
        assert.equal(r, undefined);
    });

    it('returns items when caret is immediately after `.` on an identifier', () => {
        // Source: `foo.` — caret right after the dot at char 4.
        const f = buildFixture(URI, 'foo.');
        const r = providePostfixCompletions(f.rawTokens, pos(0, 4));
        assert.ok(r !== undefined, 'expected completions after dot');
        assert.ok(r.length > 0, 'expected at least one postfix item');
        const labels = r.map(i => i.label);
        for (const expected of ['if', 'for', 'while', 'not', 'return', 'null', 'nnull']) {
            assert.ok(labels.includes(expected), `missing label: ${expected}`);
        }
    });

    it('all returned items use Snippet kind and format', () => {
        const f = buildFixture(URI, 'bar.');
        const r = providePostfixCompletions(f.rawTokens, pos(0, 4));
        assert.ok(r !== undefined);
        for (const item of r) {
            assert.equal(item.kind, lsp.CompletionItemKind.Snippet);
            assert.equal(item.insertTextFormat, lsp.InsertTextFormat.Snippet);
        }
    });

    it('returns items when caret is inside a partial label after the dot', () => {
        // Source: `foo.ret` — partial typing of "return"; caret at char 7.
        const f = buildFixture(URI, 'foo.ret');
        const r = providePostfixCompletions(f.rawTokens, pos(0, 7));
        assert.ok(r !== undefined, 'expected completions when partial label typed');
        const labels = r.map(i => i.label);
        assert.ok(labels.includes('return'), 'return should be in list');
    });
});
