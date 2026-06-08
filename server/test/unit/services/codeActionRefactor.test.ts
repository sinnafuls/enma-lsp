// Tests for the new refactor/source code actions added to codeAction.ts.

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import * as lsp from 'vscode-languageserver';
import { provideCodeAction } from '../../../src/services/codeAction';
import { Inspector } from '../../../src/inspector/inspector';

function recordFor(src: string) {
    const inspector = new Inspector();
    const uri = 'file:///fake/test.em';
    inspector.inspectFile(uri, src, { isOpen: true });
    inspector.flush();
    return { r: inspector.getRecord(uri)!, uri };
}

describe('codeAction: source.organizeImports', () => {
    it('returns organizeImports action when imports are out of order', () => {
        const src = [
            'import "vec";',
            'import "atomic";',
            'import "color";',
            'int32 main() { return 0; }',
        ].join('\n');
        const { r, uri } = recordFor(src);
        const actions = provideCodeAction(
            r.analyzerScope.globalScope,
            { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } },
            { diagnostics: [], uri, content: src },
        );
        const orgAction = actions.find((a) => a.kind === lsp.CodeActionKind.SourceOrganizeImports);
        assert.ok(orgAction, 'organize-imports action emitted');
        assert.equal(orgAction!.title, 'Organize imports');
    });

    it('returns no organizeImports when imports already sorted', () => {
        const src = [
            'import "atomic";',
            'import "color";',
            'import "vec";',
            'int32 main() { return 0; }',
        ].join('\n');
        const { r, uri } = recordFor(src);
        const actions = provideCodeAction(
            r.analyzerScope.globalScope,
            { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } },
            { diagnostics: [], uri, content: src },
        );
        const orgAction = actions.find((a) => a.kind === lsp.CodeActionKind.SourceOrganizeImports);
        assert.equal(orgAction, undefined, 'no organize action when already sorted');
    });

    it('removes duplicate imports', () => {
        const src = [
            'import "vec";',
            'import "vec";',
            'int32 main() { return 0; }',
        ].join('\n');
        const { r, uri } = recordFor(src);
        const actions = provideCodeAction(
            r.analyzerScope.globalScope,
            { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
            { diagnostics: [], uri, content: src },
        );
        const orgAction = actions.find((a) => a.kind === lsp.CodeActionKind.SourceOrganizeImports);
        assert.ok(orgAction, 'deduplicate action emitted');
    });
});

describe('codeAction: callHierarchy service', () => {
    it('provideCodeAction returns existing quick-fix + fixAll when diag present', () => {
        const src = 'int32 main() { flojat64 x = 1; return 0; }';
        const { r, uri } = recordFor(src);
        const fakeDiag: lsp.Diagnostic = {
            range: { start: { line: 0, character: 15 }, end: { line: 0, character: 23 } },
            message: "Unknown type 'flojat64'",
            severity: 1,
            source: 'Enma - Parser',
            code: 'EN_UNKNOWN_TYPE',
        };
        const actions = provideCodeAction(
            r.analyzerScope.globalScope,
            { start: { line: 0, character: 15 }, end: { line: 0, character: 23 } },
            { diagnostics: [fakeDiag], uri },
        );
        // Should have at least one QuickFix (Did you mean float64?)
        const qf = actions.find((a) => a.kind === lsp.CodeActionKind.QuickFix);
        assert.ok(qf, 'quick fix emitted');
        const fixAll = actions.find((a) => a.kind === lsp.CodeActionKind.SourceFixAll);
        assert.ok(fixAll, 'fixAll emitted when quick-fixes present');
    });
});
