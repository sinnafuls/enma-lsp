// Client-side auto-import code action.
//
// Listens for `vscode.CodeActionContext` requests on `.em` documents and offers
// QuickFix actions that insert `import "<module>";` for catalogue-known
// identifiers that are referenced but not yet imported.
//
// The catalogue + scanning logic live in autoImportCatalogue.ts (no `vscode`
// import) so they can be unit-tested directly.

import {
    CodeAction,
    CodeActionKind,
    CodeActionProvider,
    ExtensionContext,
    Position,
    Range,
    TextDocument,
    WorkspaceEdit,
    languages,
} from 'vscode';

import {
    findMissingImports,
    preambleEndLine,
    MissingImport,
} from './autoImportCatalogue';

const DOC_SELECTOR = [
    { scheme: 'file', language: 'enma' },
    { scheme: 'file', language: 'enma-predefined' },
];

class EnmaAutoImportProvider implements CodeActionProvider {
    public static readonly providedKinds = [CodeActionKind.QuickFix];

    public provideCodeActions(document: TextDocument, range: Range): CodeAction[] {
        const text = document.getText();
        const missing = findMissingImports(text);
        if (missing.length === 0) return [];

        const inRange = missing.filter(m => intersectsRange(m, range));
        const candidates = inRange.length > 0 ? inRange : missing;

        // Deduplicate by module so a file using vec2 + vec3 produces one fix,
        // not two with identical edits.
        const perModule = new Map<string, MissingImport>();
        for (const m of candidates) {
            if (!perModule.has(m.module)) perModule.set(m.module, m);
        }

        const insertLine = preambleEndLine(text);
        const insertPos = new Position(insertLine, 0);

        const actions: CodeAction[] = [];
        for (const [mod, hit] of perModule) {
            const action = new CodeAction(
                `Add 'import "${mod}";' (used by ${hit.name})`,
                CodeActionKind.QuickFix,
            );
            const edit = new WorkspaceEdit();
            edit.insert(document.uri, insertPos, `import "${mod}";\n`);
            action.edit = edit;
            action.isPreferred = inRange.length > 0;
            actions.push(action);
        }
        return actions;
    }
}

function intersectsRange(m: MissingImport, range: Range): boolean {
    const start = range.start;
    const end = range.end;
    if (m.line < start.line || m.line > end.line) return false;
    if (m.line === start.line && m.character + 1 < start.character) return false;
    if (m.line === end.line && m.character > end.character) return false;
    return true;
}

export function registerAutoImport(context: ExtensionContext): void {
    context.subscriptions.push(
        languages.registerCodeActionsProvider(
            DOC_SELECTOR,
            new EnmaAutoImportProvider(),
            { providedCodeActionKinds: EnmaAutoImportProvider.providedKinds },
        ),
    );
}
