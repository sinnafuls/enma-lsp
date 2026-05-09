import * as lsp from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'node:fs';
import { Inspector, InspectRecord } from './inspector/inspector';

import { provideHover } from './services/hover';
import { provideCompletion } from './services/completion';
import { provideCompletionOfToken } from './services/completionExtension';
import { provideCompletionResolve } from './services/completionResolve';
import { provideDefinition } from './services/definition';
import { provideDefinitionFallback } from './services/definitionExtension';
import { provideReferences, ReferenceTokens } from './services/reference';
import { provideDocumentSymbol } from './services/documentSymbol';
import { provideSemanticTokens, semanticTokensLegend } from './services/semanticTokens';
import { provideSignatureHelp } from './services/signatureHelp';
import { provideInlayHint } from './services/inlayHint';
import { provideCodeAction } from './services/codeAction';
import { documentOnTypeFormattingProvider } from './services/documentOnTypeFormatting';
import { formatFile } from './formatter/formatter';
import { FormatterSettings, defaultFormatterSettings } from './formatter/formatterState';
import { printSymbolScope } from './compiler_analyzer/symbolUtils';

const connection = lsp.createConnection(lsp.ProposedFeatures.all);

const documents: lsp.TextDocuments<TextDocument> = new lsp.TextDocuments(TextDocument);

const inspector = new Inspector();
let workspaceRoot: string | undefined;
const formatterSettings: FormatterSettings = { ...defaultFormatterSettings };

inspector.registerDiagnosticsCallback((params) => {
    connection.sendDiagnostics(params);
});

inspector.setLogger((msg) => {
    connection.console.log(msg);
});

connection.onInitialize((params: lsp.InitializeParams): lsp.InitializeResult => {
    const folders = params.workspaceFolders;
    if (folders && folders.length > 0) {
        inspector.setWorkspaceRoot(folders[0].uri);
        workspaceRoot = folders[0].uri;
    } else if (params.rootUri) {
        inspector.setWorkspaceRoot(params.rootUri);
        workspaceRoot = params.rootUri;
    }

    const result: lsp.InitializeResult = {
        capabilities: {
            textDocumentSync: lsp.TextDocumentSyncKind.Incremental,
            hoverProvider: true,
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ['.', ':'],
            },
            signatureHelpProvider: {
                triggerCharacters: ['(', ','],
                retriggerCharacters: ['='],
            },
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: true,
            documentSymbolProvider: true,
            codeActionProvider: {
                codeActionKinds: [lsp.CodeActionKind.QuickFix],
                resolveProvider: true,
            },
            semanticTokensProvider: {
                legend: semanticTokensLegend,
                range: false,
                full: true,
            },
            inlayHintProvider: true,
            documentFormattingProvider: true,
            documentRangeFormattingProvider: true,
            documentOnTypeFormattingProvider: {
                firstTriggerCharacter: ';',
                moreTriggerCharacter: ['}', '\n'],
            },
        },
    };
    return result;
});

connection.onInitialized(() => {
    connection.console.log('Enma Language Server initialized.');
    // Pull initial settings from the editor and apply them.
    void applyEnmaConfiguration();
    // Multi-root: re-load workspace predefined when a new root is added.
    connection.workspace.onDidChangeWorkspaceFolders((event) => {
        if (event.added.length === 0) return;
        const newRoot = event.added[0].uri;
        inspector.setWorkspaceRoot(newRoot);
        workspaceRoot = newRoot;
        // Re-inspect open files so they pick up newly-loaded predefined symbols.
        inspector.reinspectAllFiles();
    });
});

documents.onDidOpen((event) => {
    inspector.inspectFile(event.document.uri, event.document.getText(), { isOpen: true });
});

documents.onDidChangeContent((event) => {
    inspector.inspectFile(event.document.uri, event.document.getText(), { isOpen: true });
});

documents.onDidClose((event) => {
    inspector.setOpen(event.document.uri, false);
});

connection.onDidChangeConfiguration(() => {
    void applyEnmaConfiguration();
});

async function applyEnmaConfiguration(): Promise<void> {
    let cfg: { implicitMutualInclusion?: boolean } | undefined;
    try {
        cfg = await connection.workspace.getConfiguration('enma');
    } catch (err) {
        connection.console.log(`[server] getConfiguration('enma') failed: ${(err as Error).message}`);
        return;
    }
    if (cfg === undefined || cfg === null) {
        connection.console.log(`[server] getConfiguration('enma') returned ${cfg}`);
        return;
    }
    const flag = cfg.implicitMutualInclusion === true;
    connection.console.log(`[server] enma.implicitMutualInclusion = ${flag}`);
    if (flag !== inspector.getSettings().implicitMutualInclusion) {
        inspector.updateSettings({ implicitMutualInclusion: flag });
    }
}

// ---- Helpers -----------------------------------------------------------

function getRecord(uri: string): InspectRecord | undefined {
    inspector.flush(uri);
    return inspector.getRecord(uri);
}

function allReferenceTokens(): ReferenceTokens[] {
    const out: ReferenceTokens[] = [];
    for (const r of inspector.getAllRecords()) {
        out.push({ uri: r.uri, rawTokens: r.rawTokens });
    }
    return out;
}

// ---- Capability handlers ----------------------------------------------

connection.onHover(({ textDocument, position }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return null;
    return provideHover(r.analyzerScope.globalScope, r.rawTokens, position) ?? null;
});

connection.onCompletion(({ textDocument, position }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    const tokenComp = provideCompletionOfToken(r.rawTokens, position);
    if (tokenComp !== undefined) return tokenComp;
    return provideCompletion(r.analyzerScope.globalScope, r.rawTokens, position);
});

connection.onCompletionResolve((item) => {
    // Without per-resolve URI, take the most-recently-active record.
    const all = inspector.getAllRecords();
    if (all.length === 0) return item;
    const r = all[all.length - 1];
    return provideCompletionResolve(r.analyzerScope.globalScope, item);
});

connection.onSignatureHelp(({ textDocument, position }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return null;
    return provideSignatureHelp(r.analyzerScope.globalScope, r.rawTokens, position) ?? null;
});

connection.onDefinition(({ textDocument, position }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return null;
    const defs = provideDefinition(r.analyzerScope.globalScope, r.rawTokens, position);
    if (defs.length > 0) return defs;
    return provideDefinitionFallback(r.rawTokens, textDocument.uri, position, workspaceRoot);
});

connection.onReferences(({ textDocument, position }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    return provideReferences(r.analyzerScope.globalScope, r.rawTokens, allReferenceTokens(), position);
});

connection.onRenameRequest(({ textDocument, position, newName }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return null;
    const refs = provideReferences(r.analyzerScope.globalScope, r.rawTokens, allReferenceTokens(), position);
    if (refs.length === 0) return null;
    const changes: { [uri: string]: lsp.TextEdit[] } = {};
    for (const loc of refs) {
        if (!changes[loc.uri]) changes[loc.uri] = [];
        changes[loc.uri].push({ range: loc.range, newText: newName });
    }
    return { changes };
});

connection.onDocumentSymbol(({ textDocument }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    return provideDocumentSymbol(r.ast);
});

connection.onCodeAction(({ textDocument, range, context }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    return provideCodeAction(
        r.analyzerScope.globalScope,
        { start: range.start, end: range.end },
        { diagnostics: context.diagnostics, uri: textDocument.uri },
    );
});

connection.onCodeActionResolve((action) => action);

connection.languages.semanticTokens.on(({ textDocument }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return { data: [] };
    return provideSemanticTokens(r.analyzerScope.globalScope, r.rawTokens);
});

connection.languages.inlayHint.on(({ textDocument, range }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    return provideInlayHint(
        r.analyzerScope.globalScope,
        r.analyzerScope,
        r.ast,
        { start: range.start, end: range.end },
    );
});

connection.onDocumentFormatting(({ textDocument }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    if (formatterSettings.enabled === false) return [];
    return formatFile(r.content, r.rawTokens, r.ast, formatterSettings);
});

connection.onDocumentRangeFormatting(({ textDocument, range }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    if (formatterSettings.enabled === false) return [];
    return formatFile(r.content, r.rawTokens, r.ast, formatterSettings, range);
});
connection.onDocumentOnTypeFormatting(({ textDocument, position, ch }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    return documentOnTypeFormattingProvider(r.rawTokens, r.content, position, ch);
});

// ---- Custom requests --------------------------------------------------

connection.onRequest('enma/printGlobalScope', (params: { uri: string }) => {
    const r = inspector.getRecord(params.uri);
    if (r === undefined) return { ok: false };
    const dump = printSymbolScope(r.analyzerScope.globalScope);
    const outPath = params.uri.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1') + '.out';
    try {
        fs.writeFileSync(outPath, dump);
        return { ok: true, path: outPath };
    } catch {
        return { ok: false };
    }
});

documents.listen(connection);
connection.listen();
