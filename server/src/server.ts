import * as lsp from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'node:fs';
import { Inspector, InspectRecord, InspectorSettings, resolveIncludeUri } from './inspector/inspector';

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
import { provideFoldingRanges } from './services/foldingRange';
import { provideWorkspaceSymbol } from './services/workspaceSymbol';
import { provideDocumentHighlight } from './services/documentHighlight';
import { provideTypeDefinition, provideImplementation } from './services/navigation';
import { provideSelectionRanges } from './services/selectionRange';
import { prepareTypeHierarchy, provideSupertypes, provideSubtypes } from './services/typeHierarchy';
import { provideDocumentLinks } from './services/documentLink';
import { findTokenAtPosition } from './services/utils';
import { TokenKind } from './compiler_tokenizer/tokenObject';
import {
    hasFullLsp,
    setResolvedProjects,
    resolveProjects,
    ProjectConfig,
} from './core/projectScope';
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
            declarationProvider: true,
            typeDefinitionProvider: true,
            implementationProvider: true,
            documentHighlightProvider: true,
            selectionRangeProvider: true,
            typeHierarchyProvider: true,
            documentLinkProvider: { resolveProvider: false },
            referencesProvider: true,
            renameProvider: { prepareProvider: true },
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
            foldingRangeProvider: true,
            workspaceSymbolProvider: true,
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
    interface EnmaCfg {
        implicitMutualInclusion?: boolean;
        diagnostics?: { predefinedCollisionSeverity?: 'warning' | 'information' | 'off' };
        projects?: ProjectConfig[];
    }
    let cfg: EnmaCfg | undefined;
    try {
        cfg = await connection.workspace.getConfiguration('enma');
    } catch {
        return;
    }
    if (cfg === undefined || cfg === null) return;

    const current = inspector.getSettings();
    const partial: Partial<InspectorSettings> = {};

    const flag = cfg.implicitMutualInclusion === true;
    if (flag !== current.implicitMutualInclusion) {
        partial.implicitMutualInclusion = flag;
    }

    const sev = cfg.diagnostics?.predefinedCollisionSeverity;
    if (sev === 'warning' || sev === 'information' || sev === 'off') {
        if (sev !== current.predefinedCollisionSeverity) {
            partial.predefinedCollisionSeverity = sev;
        }
    }

    if (Object.keys(partial).length > 0) {
        inspector.updateSettings(partial);
    }

    const projects = Array.isArray(cfg.projects) ? cfg.projects : [];
    setResolvedProjects(resolveProjects(projects, workspaceRoot));
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
    if (!hasFullLsp(textDocument.uri)) return null;
    const r = getRecord(textDocument.uri);
    if (r === undefined) return null;
    return provideHover(r.analyzerScope.globalScope, r.rawTokens, position) ?? null;
});

connection.onCompletion(({ textDocument, position }) => {
    if (!hasFullLsp(textDocument.uri)) return [];
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    const items = provideCompletionOfToken(r.rawTokens, position)
        ?? provideCompletion(r.analyzerScope.globalScope, r.rawTokens, position);
    // Stamp the source URI so onCompletionResolve resolves against the right
    // file's scope rather than guessing the most-recently-active record.
    for (const item of items) {
        item.data = { ...(typeof item.data === 'object' && item.data !== null ? item.data : {}), uri: textDocument.uri };
    }
    return items;
});

connection.onCompletionResolve((item) => {
    const uri = typeof item.data === 'object' && item.data !== null
        ? (item.data as { uri?: string }).uri
        : undefined;
    const r = uri !== undefined ? inspector.getRecord(uri) : undefined;
    const fallback = inspector.getAllRecords();
    const scope = r?.analyzerScope.globalScope
        ?? (fallback.length > 0 ? fallback[fallback.length - 1].analyzerScope.globalScope : undefined);
    if (scope === undefined) return item;
    return provideCompletionResolve(scope, item);
});

connection.onSignatureHelp(({ textDocument, position }) => {
    if (!hasFullLsp(textDocument.uri)) return null;
    const r = getRecord(textDocument.uri);
    if (r === undefined) return null;
    return provideSignatureHelp(r.analyzerScope.globalScope, r.rawTokens, position) ?? null;
});

connection.onDefinition(({ textDocument, position }) => {
    if (!hasFullLsp(textDocument.uri)) return null;
    const r = getRecord(textDocument.uri);
    if (r === undefined) return null;
    const defs = provideDefinition(r.analyzerScope.globalScope, r.rawTokens, position);
    if (defs.length > 0) return defs;
    return provideDefinitionFallback(r.rawTokens, textDocument.uri, position, workspaceRoot);
});

connection.onDeclaration(({ textDocument, position }) => {
    if (!hasFullLsp(textDocument.uri)) return null;
    const r = getRecord(textDocument.uri);
    if (r === undefined) return null;
    const defs = provideDefinition(r.analyzerScope.globalScope, r.rawTokens, position);
    if (defs.length > 0) return defs;
    return provideDefinitionFallback(r.rawTokens, textDocument.uri, position, workspaceRoot);
});

connection.onTypeDefinition(({ textDocument, position }) => {
    if (!hasFullLsp(textDocument.uri)) return null;
    const r = getRecord(textDocument.uri);
    if (r === undefined) return null;
    return provideTypeDefinition(r.analyzerScope.globalScope, r.rawTokens, position);
});

connection.onImplementation(({ textDocument, position }) => {
    if (!hasFullLsp(textDocument.uri)) return null;
    const r = getRecord(textDocument.uri);
    if (r === undefined) return null;
    return provideImplementation(r.analyzerScope.globalScope, r.rawTokens, position);
});

connection.onDocumentHighlight(({ textDocument, position }) => {
    if (!hasFullLsp(textDocument.uri)) return [];
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    return provideDocumentHighlight(r.rawTokens, position);
});

connection.onSelectionRanges(({ textDocument, positions }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    return provideSelectionRanges(r.rawTokens, positions);
});

function allGlobalScopes() {
    return inspector.getAllRecords().map((r) => r.analyzerScope.globalScope);
}

connection.languages.typeHierarchy.onPrepare(({ textDocument, position }) => {
    if (!hasFullLsp(textDocument.uri)) return null;
    const r = getRecord(textDocument.uri);
    if (r === undefined) return null;
    const items = prepareTypeHierarchy(r.analyzerScope.globalScope, r.rawTokens, position);
    return items.length > 0 ? items : null;
});

connection.languages.typeHierarchy.onSupertypes(({ item }) => {
    return provideSupertypes(allGlobalScopes(), item);
});

connection.languages.typeHierarchy.onSubtypes(({ item }) => {
    return provideSubtypes(allGlobalScopes(), item);
});

connection.onPrepareRename(({ textDocument, position }) => {
    if (!hasFullLsp(textDocument.uri)) return null;
    const r = getRecord(textDocument.uri);
    if (r === undefined) return null;
    const at = findTokenAtPosition(r.rawTokens, position);
    if (at === undefined || at.token.kind !== TokenKind.Identifier) return null;
    const loc = at.token.location;
    return {
        range: {
            start: { line: loc.start.line, character: loc.start.character },
            end: { line: loc.end.line, character: loc.end.character },
        },
        placeholder: at.token.text,
    };
});

connection.onReferences(({ textDocument, position }) => {
    if (!hasFullLsp(textDocument.uri)) return [];
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    return provideReferences(r.analyzerScope.globalScope, r.rawTokens, allReferenceTokens(), position);
});

connection.onRenameRequest(({ textDocument, position, newName }) => {
    if (!hasFullLsp(textDocument.uri)) return null;
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
    if (!hasFullLsp(textDocument.uri)) return [];
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
    // Semantic tokens stay on under syntaxOnly so colour highlighting works,
    // but they degrade gracefully — the analyzer-aware tags simply don't fire.
    const r = getRecord(textDocument.uri);
    if (r === undefined) return { data: [] };
    return provideSemanticTokens(r.analyzerScope.globalScope, r.rawTokens);
});

connection.languages.inlayHint.on(({ textDocument, range }) => {
    if (!hasFullLsp(textDocument.uri)) return [];
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

connection.onFoldingRanges(({ textDocument }) => {
    const r = inspector.getRecord(textDocument.uri);
    if (r === undefined) return [];
    return provideFoldingRanges(r.rawTokens);
});

connection.onDocumentLinks(({ textDocument }) => {
    const r = getRecord(textDocument.uri);
    if (r === undefined) return [];
    return provideDocumentLinks(
        r.preprocessedOutput.includePathTokens,
        (rel) => resolveIncludeUri(textDocument.uri, rel, workspaceRoot),
    );
});

connection.onWorkspaceSymbol(({ query }) => {
    const scopes = inspector.getAllRecords().map(r => r.analyzerScope.globalScope);
    return provideWorkspaceSymbol(query, scopes);
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
