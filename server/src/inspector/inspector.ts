// Phase 5 — inspector. Composes the full per-URI compile pipeline:
//   tokenize → preprocess → parse → hoist → analyze
//
// One InspectRecord per file URI, indexed in a Map. Records carry both raw
// inputs (content, tokens, ast) and analyzer state (analyzerScope, side-table
// in AnalyzerScope). Analyzer is run via a delayed-task queue
// (AnalysisResolver) so editor keystrokes don't trigger O(N²) re-analysis.
//
// §A4 workspace-level cycle detection: walk includePathTokens before parse;
// resolve each path against the file's directory + workspaceRoot; if a
// resolved URI re-enters its own include chain, emit Error at the include
// site naming the full chain. maxIncludeDepth (default 64) is honoured here
// (the preprocessor already enforces it intra-file via includeChain; the
// inspector layer is the workspace-level wrap).
//
// §A8 budget: per-record bytes tracked; LRU eviction kicks in when the
// closed-record count exceeds settings.indexCache.maxClosedFiles (default
// 300). On eviction we ZERO the analyzerScope (cheap to rebuild from ast)
// but RETAIN content+rawTokens+ast to keep simple lookups fast.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lsp from 'vscode-languageserver/node';

import { TokenObject } from '../compiler_tokenizer/tokenObject';
import { tokenize } from '../compiler_tokenizer/tokenizer';
import {
    preprocessAfterTokenized,
    PreprocessedOutput,
    Diagnostic,
} from '../compiler_parser/parserPreprocess';
import { parseAfterPreprocessed } from '../compiler_parser/parser';
import { NodeScript, NodeKind } from '../compiler_parser/nodes';
import { hoistAfterParsed } from '../compiler_analyzer/hoist';
import { analyzeAfterHoisted } from '../compiler_analyzer/analyzer';
import {
    AnalyzerScope,
    createGlobalScope,
} from '../compiler_analyzer/analyzerScope';
import { analyzerDiagnostic } from '../compiler_analyzer/analyzerDiagnostic';
import {
    SymbolGlobalScope,
    setActiveGlobalScope,
} from '../compiler_analyzer/symbolScope';
import { TextPosition } from '../compiler_tokenizer/textLocation';

import { AnalysisResolver, DiagnosticsCallback } from './analysisResolver';
import { locationToRange, analyzerDiagToLsp } from './diagnosticUtils';
import {
    PredefinedRecord,
    loadBundledPredefined,
    loadForceIncludePredefined,
    scanWorkspacePredefined,
    walkUpPredefined,
} from './predefinedLoader';

// ---- Settings ----------------------------------------------------------

export interface InspectorSettings {
    /** §A8 LRU cap on closed records. */
    maxClosedFiles: number;
    /** §A4 #include depth ceiling. */
    maxIncludeDepth: number;
    /** Directory names skipped during workspace scan. */
    indexExclude: string[];
    /** Whether all .em files in the workspace see each other w/o explicit #include. */
    implicitMutualInclusion: boolean;
    /** §A10 forceInclude predefined paths (string[]; precedence: workspace > forceInclude > bundled). */
    forceIncludePredefined: string[];
    /** Number of parent directories to scan (non-recursively) for *.em.predefined during walk-up discovery. 0 = disabled. */
    walkUpDepth: number;
}

export const defaultInspectorSettings: InspectorSettings = {
    maxClosedFiles: 300,
    maxIncludeDepth: 64,
    indexExclude: ['node_modules', '.git', 'output', 'dist', 'build'],
    implicitMutualInclusion: false,
    forceIncludePredefined: [],
    walkUpDepth: 4,
};

// ---- Per-URI record ----------------------------------------------------

export interface ImportGraph {
    /** Resolved URIs this file `#include`s or `import`s. */
    imports: string[];
    /** Resolved URIs that include this file. Maintained by the inspector. */
    importedBy: string[];
}

export interface InspectRecord {
    uri: string;
    content: string;
    rawTokens: TokenObject[];
    preprocessedOutput: PreprocessedOutput;
    ast: NodeScript;
    diagnosticsInParser: lsp.Diagnostic[];
    diagnosticsInAnalyzer: lsp.Diagnostic[];
    isAnalyzerPending: boolean;
    analyzerScope: AnalyzerScope;
    contentHash: string;
    lastAccessed: number;
    isOpen: boolean;
    importGraph: ImportGraph;
    memoryEstimate: number;
}

function emptyScriptAst(): NodeScript {
    const zero: TextPosition = { line: 0, character: 0 };
    return {
        kind: NodeKind.Script,
        range: { start: zero, end: zero },
        children: [],
    };
}

function emptyAnalyzerScope(uri: string): AnalyzerScope {
    return new AnalyzerScope(uri, new SymbolGlobalScope(uri));
}

function createEmptyRecord(uri: string, content: string): InspectRecord {
    return {
        uri,
        content,
        rawTokens: [],
        preprocessedOutput: {
            preprocessedTokens: [],
            includePathTokens: [],
            macroDefs: new Map(),
            expansionTrace: new Map(),
            pragmaOnceFiles: new Set(),
            diagnostics: [],
        },
        ast: emptyScriptAst(),
        diagnosticsInParser: [],
        diagnosticsInAnalyzer: [],
        isAnalyzerPending: false,
        analyzerScope: emptyAnalyzerScope(uri),
        contentHash: '',
        lastAccessed: Date.now(),
        isOpen: false,
        importGraph: { imports: [], importedBy: [] },
        memoryEstimate: 0,
    };
}

// ---- Helpers -----------------------------------------------------------

/** Cheap FNV-1a 32-bit hash; good enough for content-change detection. */
function fnv1a(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/** Strip surrounding quotes from a TokenString.text. */
function stripIncludeQuotes(raw: string): string {
    if ((raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith('<') && raw.endsWith('>'))) {
        return raw.slice(1, -1);
    }
    return raw;
}

/**
 * Resolve an `#include "path"` against the includer URI. Returns a normalized
 * `file://` URI. Both relative and workspace-rooted paths are supported.
 *
 * - If `relPath` is already a `file://` URI → returned as-is (normalized).
 * - If `relPath` is absolute → resolved against the OS root.
 * - Otherwise → joined onto dirname(includerUri); falls back to workspaceRoot
 *   when the includer is unknown.
 */
export function resolveIncludeUri(
    includerUri: string,
    relPath: string,
    workspaceRoot?: string,
): string {
    if (relPath.startsWith('file://')) {
        return normalizeUri(relPath);
    }

    // String-based resolution against the includer URI's "directory". This
    // avoids fileURLToPath on synthetic test URIs (e.g. file:///fake/a.em)
    // which fail Node's Windows-absolute-path check.
    const base = normalizeUri(includerUri);
    const lastSlash = base.lastIndexOf('/');
    const baseDir = lastSlash >= 0 ? base.slice(0, lastSlash + 1) : base;

    // Normalize relPath separators.
    const rel = relPath.replace(/\\/g, '/');

    let combined: string;
    if (rel.startsWith('/')) {
        // Treat as workspace-rooted.
        combined = (workspaceRoot ?? baseDir) + rel.replace(/^\/+/, '');
    } else {
        combined = baseDir + rel;
    }

    // Collapse `./` and `../` segments.
    return normalizeUri(collapseUriPath(combined));
}

function collapseUriPath(uri: string): string {
    // Split off the scheme so we don't mangle the leading 'file://'.
    const schemeMatch = uri.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*:\/\/)(.*)$/);
    const scheme = schemeMatch ? schemeMatch[1] : '';
    const rest = schemeMatch ? schemeMatch[2] : uri;
    const parts = rest.split('/');
    const out: string[] = [];
    for (const seg of parts) {
        if (seg === '.' || seg === '') {
            // Preserve a leading empty segment for absolute paths.
            if (out.length === 0 && seg === '') out.push('');
            continue;
        }
        if (seg === '..') {
            if (out.length > 1) out.pop();
            continue;
        }
        out.push(seg);
    }
    return scheme + out.join('/');
}

function normalizeUri(uri: string): string {
    // Forward slashes everywhere; collapse trailing slash on dirs (not used).
    return uri.replace(/\\/g, '/');
}

// ---- Diagnostic conversion ---------------------------------------------

function parserDiagToLsp(d: Diagnostic): lsp.Diagnostic {
    return {
        severity: d.severity === 'error'
            ? lsp.DiagnosticSeverity.Error
            : lsp.DiagnosticSeverity.Warning,
        range: locationToRange(d.location),
        message: d.message,
        source: 'Enma - Parser',
    };
}

// ---- Inspector ---------------------------------------------------------

interface InspectOption {
    isOpen?: boolean;
}

export class Inspector {
    private readonly _records: Map<string, InspectRecord> = new Map();
    private _settings: InspectorSettings = { ...defaultInspectorSettings };
    private _workspaceRoot: string | undefined;
    private _diagnosticsCallback: DiagnosticsCallback = () => undefined;

    /** §A10 predefined records indexed by origin + URI. */
    private _predefinedRecords: PredefinedRecord[] = [];
    private _bundledLoaded = false;

    private readonly _resolver: AnalysisResolver;

    constructor(settings?: Partial<InspectorSettings>) {
        if (settings) this._settings = { ...this._settings, ...settings };
        this._resolver = new AnalysisResolver(
            this._records,
            (params) => this._diagnosticsCallback(params),
        );
        this._resolver.setPredefinedRecordsGetter(() => this._predefinedRecords);
        this._resolver.setSettingsGetter(() => this._settings);
        this._loadBundledPredefined();
    }

    // ---- Public API ---------------------------------------------------

    public registerDiagnosticsCallback(cb: DiagnosticsCallback): void {
        this._diagnosticsCallback = cb;
    }

    public setWorkspaceRoot(uri: string): void {
        this._workspaceRoot = uri.endsWith('/') ? uri : uri + '/';
        this._resolver.setWorkspaceRoot(this._workspaceRoot);
        // Scan workspace for .em.predefined files.
        this._loadWorkspacePredefined();
        // Scan workspace for .em files when implicit mutual inclusion is enabled.
        if (this._settings.implicitMutualInclusion) {
            this._loadWorkspaceEmFiles();
        }
    }


    // ---- Predefined loading (§A10) ----------------------------------------

    /** Return current predefined records (bundled + forceInclude + workspace). */
    public getPredefinedRecords(): readonly PredefinedRecord[] {
        return this._predefinedRecords;
    }

    /** Reload all predefined records (call after settings change). */
    public reloadPredefined(): void {
        this._predefinedRecords = [];
        this._bundledLoaded = false;
        this._loadBundledPredefined();
        this._loadForceIncludePredefined();
        if (this._workspaceRoot) this._loadWorkspacePredefined();
    }

    private _loadBundledPredefined(): void {
        if (this._bundledLoaded) return;
        this._bundledLoaded = true;
        const recs = loadBundledPredefined(this._workspaceLogger);
        if (recs.length > 0) {
            this._predefinedRecords = this._predefinedRecords.filter(r => r.origin !== 'bundled');
            this._predefinedRecords.push(...recs);
        }
    }

    private _loadForceIncludePredefined(): void {
        const paths = this._settings.forceIncludePredefined;
        if (!paths || paths.length === 0) return;
        const loaded = loadForceIncludePredefined(paths);
        this._predefinedRecords = [
            ...this._predefinedRecords.filter(r => r.origin !== 'forceInclude'),
            ...loaded,
        ];
    }

    private _loadWorkspacePredefined(): void {
        if (!this._workspaceRoot) return;
        // Strip trailing file:// or convert to fs path
        let fsRoot = this._workspaceRoot;
        if (fsRoot.startsWith('file://')) {
            fsRoot = fsRoot.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1');
        }
        // Percent-decode (URIs from VSCode often look like `file:///d%3A/...`).
        try { fsRoot = decodeURIComponent(fsRoot); } catch { /* keep as-is on bad encoding */ }

        // Observability: show raw URI → decoded fs path so users can diagnose path issues.
        this._workspaceLogger?.(
            `[inspector] workspace root: ${this._workspaceRoot} -> ${fsRoot}`,
        );

        // Downward scan from workspace root (existing behavior).
        const loaded = scanWorkspacePredefined(fsRoot);
        this._workspaceLogger?.(
            `[inspector] loaded ${loaded.length} predefined file(s) from ${fsRoot}`,
        );

        // Walk-up scan: collect canonical paths already loaded to deduplicate.
        const walkUpDepth = this._settings.walkUpDepth ?? 4;
        const knownPaths = new Set<string>(
            loaded.map(r => {
                // r.uri is a file:// URI; convert back to fs path for canonical comparison.
                let p = r.uri.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');
                p = p.replace(/\//g, path.sep);
                try { p = decodeURIComponent(p); } catch { /* keep */ }
                return path.resolve(p);
            }),
        );
        const walkUpLoaded = walkUpPredefined(
            fsRoot,
            walkUpDepth,
            knownPaths,
            this._workspaceLogger,
        );
        if (walkUpLoaded.length > 0) {
            this._workspaceLogger?.(
                `[inspector] walk-up loaded ${walkUpLoaded.length} additional predefined file(s)`,
            );
        }

        this._predefinedRecords = [
            ...this._predefinedRecords.filter(r => r.origin !== 'workspace'),
            ...loaded,
            ...walkUpLoaded,
        ];
    }

    /**
     * Scan the workspace for `.em` files and seed an InspectRecord for each.
     * Used when `implicitMutualInclusion` is enabled so files that are not
     * currently open in the editor are still part of the cross-file scope set.
     *
     * URIs are derived by appending the relative path onto `_workspaceRoot`
     * (which already carries VSCode's URI form), so when the user later opens
     * the same file in the editor the existing record is updated in place
     * rather than a duplicate being created.
     */
    private _loadWorkspaceEmFiles(): void {
        if (!this._workspaceRoot) return;

        // Round-trip the workspace URI to a real fs path. Hand-rolled stripping
        // mishandles the percent-encoded `:` in `file:///d%3A/...` URIs that
        // VSCode produces on Windows.
        let fsRoot: string;
        try {
            fsRoot = fileURLToPath(this._workspaceRoot);
        } catch {
            let s = this._workspaceRoot.replace(/^file:\/\//, '');
            try { s = decodeURIComponent(s); } catch { /* keep */ }
            s = s.replace(/^\/([A-Za-z]:)/, '$1');
            fsRoot = s;
        }
        fsRoot = fsRoot.replace(/[\\/]+$/, '');

        this._workspaceLogger?.(
            `[inspector] scanning ${fsRoot} for .em files (implicitMutualInclusion=on)`,
        );

        const exclude = new Set(this._settings.indexExclude);
        const rootUri = this._workspaceRoot;
        let count = 0;

        const walk = (dir: string): void => {
            let entries: string[];
            try { entries = fs.readdirSync(dir); } catch (err) {
                this._workspaceLogger?.(
                    `[inspector] readdir failed for ${dir}: ${(err as Error).message}`,
                );
                return;
            }
            for (const entry of entries) {
                if (exclude.has(entry)) continue;
                const full = path.join(dir, entry);
                let stat: fs.Stats;
                try { stat = fs.statSync(full); } catch { continue; }
                if (stat.isDirectory()) {
                    walk(full);
                    continue;
                }
                if (!entry.endsWith('.em') || entry.endsWith('.em.predefined')) continue;
                const rel = path.relative(fsRoot, full).replace(/\\/g, '/');
                const fileUri = normalizeUri(rootUri + rel);
                if (this._records.has(fileUri)) continue;
                let content: string;
                try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
                this.inspectFile(fileUri, content, { isOpen: false });
                count++;
            }
        };
        walk(fsRoot);
        this._workspaceLogger?.(
            `[inspector] indexed ${count} workspace .em file(s) for implicitMutualInclusion`,
        );

        // Two-pass: drain pass-1 analysis synchronously so every record has a
        // populated analyzerScope, then re-queue everything so cross-file
        // references resolve against the now-complete scope set.
        if (count > 0) {
            this._resolver.flush();
            this.reinspectAllFiles();
        }
    }

    /** Optional log sink wired by server.ts to surface predefined-loading
     *  progress in the editor's "Output → Enma Language Server" channel. */
    public setLogger(logger: (msg: string) => void): void {
        this._workspaceLogger = logger;
    }
    private _workspaceLogger?: (msg: string) => void;

    public updateSettings(partial: Partial<InspectorSettings>): void {
        const hadForce = JSON.stringify(this._settings.forceIncludePredefined);
        const wasImplicitMutual = this._settings.implicitMutualInclusion;
        this._settings = { ...this._settings, ...partial };
        // If forceIncludePredefined changed, reload.
        if (partial.forceIncludePredefined !== undefined &&
            JSON.stringify(partial.forceIncludePredefined) !== hadForce) {
            this._loadForceIncludePredefined();
        }
        // If implicitMutualInclusion just turned on, scan workspace .em files
        // so types declared anywhere in the workspace become visible.
        if (partial.implicitMutualInclusion === true && !wasImplicitMutual) {
            this._loadWorkspaceEmFiles();
            this.reinspectAllFiles();
        } else if (partial.implicitMutualInclusion === false && wasImplicitMutual) {
            // Turning the flag off changes scope visibility; re-analyze.
            this.reinspectAllFiles();
        }
    }

    public getSettings(): Readonly<InspectorSettings> {
        return this._settings;
    }

    public setOpen(uri: string, isOpen: boolean): void {
        const r = this._records.get(uri);
        if (r === undefined) return;
        r.isOpen = isOpen;
        r.lastAccessed = Date.now();
        if (!isOpen) {
            // Closing may push us over the LRU cap.
            this.evictClosedRecordsBeyondCap();
        }
    }

    public getRecord(uri: string): InspectRecord | undefined {
        const r = this._records.get(uri);
        if (r !== undefined) r.lastAccessed = Date.now();
        return r;
    }

    public getAllRecords(): readonly InspectRecord[] {
        return Array.from(this._records.values());
    }

    public flush(uri?: string): void {
        this._resolver.flush(uri);
    }

    public reinspectAllFiles(): void {
        const snap = Array.from(this._records.entries());
        for (const [uri, r] of snap) {
            this.inspectFile(uri, r.content, { isOpen: r.isOpen });
        }
    }

    public reset(): void {
        this._records.clear();
        this._resolver.reset();
        this._predefinedRecords = [];
        this._bundledLoaded = false;
    }

    // ---- Pipeline -----------------------------------------------------

    public inspectFile(uri: string, content: string, option?: InspectOption): void {
        const normalizedUri = normalizeUri(uri);
        let record = this._records.get(normalizedUri);
        const isNew = record === undefined;
        if (record === undefined) {
            record = createEmptyRecord(normalizedUri, content);
            this._records.set(normalizedUri, record);
        }

        record.content = content;
        record.contentHash = fnv1a(content);
        record.lastAccessed = Date.now();
        if (option?.isOpen !== undefined) record.isOpen = option.isOpen;

        // -------- Tokenize / Preprocess / Parse ----------
        const rawTokens = tokenize(normalizedUri, content);
        record.rawTokens = rawTokens;

        const preprocessedOutput = preprocessAfterTokenized(rawTokens, {
            fileUri: normalizedUri,
            maxIncludeDepth: this._settings.maxIncludeDepth,
        });
        record.preprocessedOutput = preprocessedOutput;

        const parseResult = parseAfterPreprocessed(preprocessedOutput, {
            fileUri: normalizedUri,
        });
        record.ast = parseResult.ast;

        // -------- §A4 workspace-level cycle detection ----------
        const cycleDiagnostics = this.detectIncludeCycles(record);

        // Combine parser-layer diagnostics (preprocessor + parser) plus
        // workspace-level cycle diagnostics into a single LSP list.
        const parserDiags: lsp.Diagnostic[] = [
            ...preprocessedOutput.diagnostics.map(parserDiagToLsp),
            ...parseResult.diagnostics.map(parserDiagToLsp),
            ...cycleDiagnostics,
        ];
        record.diagnosticsInParser = parserDiags;

        // -------- Update import graph ----------
        this.updateImportGraph(record);

        // -------- Memory estimate (§A8) ----------
        record.memoryEstimate = this.estimateRecordBytes(record);

        // -------- Schedule analyzer ----------
        record.isAnalyzerPending = true;
        this._diagnosticsCallback({
            uri: normalizedUri,
            diagnostics: [...parserDiags, ...record.diagnosticsInAnalyzer],
        });

        this._resolver.request(record, true);

        // -------- §A8 LRU eviction ----------
        if (isNew) this.evictClosedRecordsBeyondCap();
    }

    // ---- §A4 workspace cycle detection --------------------------------

    private detectIncludeCycles(record: InspectRecord): lsp.Diagnostic[] {
        const diags: lsp.Diagnostic[] = [];
        const includeTokens = record.preprocessedOutput.includePathTokens;
        if (includeTokens.length === 0) return diags;

        for (const token of includeTokens) {
            const relPath = stripIncludeQuotes(token.text);
            const resolved = resolveIncludeUri(record.uri, relPath, this._workspaceRoot);

            // Walk the chain: starting from `resolved`, follow imports until
            // we either hit `record.uri` (cycle) or run out / exceed depth.
            const chain = this.findCycleChain(record.uri, resolved);
            if (chain !== undefined) {
                diags.push({
                    severity: lsp.DiagnosticSeverity.Error,
                    range: locationToRange(token.location),
                    message: `#include cycle: ${chain.join(' → ')}`,
                    source: 'Enma - Inspector',
                });
            } else {
                // Depth-limit check (workspace level): how deep can we go from
                // `resolved` before hitting maxIncludeDepth?
                const depth = this.measureIncludeDepth(resolved, new Set([record.uri]));
                if (depth >= this._settings.maxIncludeDepth) {
                    diags.push({
                        severity: lsp.DiagnosticSeverity.Error,
                        range: locationToRange(token.location),
                        message: `#include depth limit (${this._settings.maxIncludeDepth}) exceeded at: ${record.uri} → ${resolved}`,
                        source: 'Enma - Inspector',
                    });
                }
            }
        }
        return diags;
    }

    /**
     * Returns the cycle path (rooted at `originUri` going through `targetUri`)
     * if including `targetUri` would re-enter `originUri`. Otherwise undefined.
     */
    private findCycleChain(originUri: string, targetUri: string): string[] | undefined {
        // BFS from targetUri; if we reach originUri we have a cycle.
        const visited = new Set<string>();
        const parent = new Map<string, string>();
        const queue: string[] = [targetUri];
        visited.add(targetUri);

        while (queue.length > 0) {
            const cur = queue.shift()!;
            if (cur === originUri) {
                // Reconstruct chain originUri → ... → targetUri → originUri
                const chain: string[] = [];
                let node: string | undefined = cur;
                while (node !== undefined) {
                    chain.unshift(node);
                    node = parent.get(node);
                }
                return [originUri, ...chain];
            }
            const rec = this._records.get(cur);
            if (rec === undefined) continue;
            for (const next of rec.importGraph.imports) {
                if (!visited.has(next)) {
                    visited.add(next);
                    parent.set(next, cur);
                    queue.push(next);
                }
            }
        }
        return undefined;
    }

    private measureIncludeDepth(uri: string, seen: Set<string>): number {
        if (seen.has(uri)) return 0;
        const rec = this._records.get(uri);
        if (rec === undefined) return 1;
        seen.add(uri);
        let max = 0;
        for (const next of rec.importGraph.imports) {
            const d = this.measureIncludeDepth(next, seen);
            if (d > max) max = d;
        }
        seen.delete(uri);
        return 1 + max;
    }

    // ---- Import-graph maintenance -------------------------------------

    private updateImportGraph(record: InspectRecord): void {
        const newImports: string[] = [];
        for (const token of record.preprocessedOutput.includePathTokens) {
            const relPath = stripIncludeQuotes(token.text);
            const resolved = resolveIncludeUri(record.uri, relPath, this._workspaceRoot);
            if (newImports.indexOf(resolved) < 0) newImports.push(resolved);
        }

        // Remove this record from `importedBy` of files we no longer import.
        for (const oldImp of record.importGraph.imports) {
            if (newImports.indexOf(oldImp) < 0) {
                const r = this._records.get(oldImp);
                if (r !== undefined) {
                    r.importGraph.importedBy = r.importGraph.importedBy
                        .filter(u => u !== record.uri);
                }
            }
        }
        // Add this record to `importedBy` of new imports.
        for (const newImp of newImports) {
            const r = this._records.get(newImp);
            if (r !== undefined) {
                if (r.importGraph.importedBy.indexOf(record.uri) < 0) {
                    r.importGraph.importedBy.push(record.uri);
                }
            }
        }
        record.importGraph.imports = newImports;
    }

    // ---- §A8 Memory accounting + LRU ----------------------------------

    private estimateRecordBytes(r: InspectRecord): number {
        // Rough heuristic that does NOT include analyzerScope (which is the
        // expensive bit but hard to size cheaply). Per spec: content*4 +
        // tokens*200 + ast-size-estimate.
        const contentBytes = r.content.length * 4;
        const tokenBytes = r.rawTokens.length * 200;
        const astBytes = this.estimateAstBytes(r.ast);
        return contentBytes + tokenBytes + astBytes;
    }

    private estimateAstBytes(ast: NodeScript): number {
        // Cheap proxy: each top-level child ≈ 600 bytes (heuristic; covers
        // Node objects + child arrays for typical Enma decls).
        const children = (ast as unknown as { children?: unknown[] }).children;
        const count = Array.isArray(children) ? children.length : 0;
        return Math.max(256, count * 600);
    }

    public getMemoryStats(): {
        totalBytes: number;
        recordCount: number;
        perRecord: Array<{ uri: string; bytes: number; loc: number }>;
    } {
        let total = 0;
        const perRecord: Array<{ uri: string; bytes: number; loc: number }> = [];
        for (const r of this._records.values()) {
            total += r.memoryEstimate;
            const loc = r.content.split(/\r?\n/).length;
            perRecord.push({ uri: r.uri, bytes: r.memoryEstimate, loc });
        }
        return { totalBytes: total, recordCount: this._records.size, perRecord };
    }

    /**
     * §A8 LRU. Counts only CLOSED records against the cap; open records are
     * never evicted. The PRD says we should "retain content+ast" — we do so
     * for the surviving records (no analyzer-scope clearing on those). The
     * oldest closed records over the cap are removed from the index entirely
     * so the LSP's working set stays bounded; reopening one of them simply
     * re-runs the pipeline against the new content.
     */
    public evictClosedRecordsBeyondCap(): void {
        const cap = this._settings.maxClosedFiles;
        const closed: InspectRecord[] = [];
        for (const r of this._records.values()) {
            if (!r.isOpen) closed.push(r);
        }
        if (closed.length <= cap) return;

        closed.sort((a, b) => a.lastAccessed - b.lastAccessed);
        const overflow = closed.length - cap;
        for (let i = 0; i < overflow; i++) {
            const victim = closed[i];
            // Drop our entry in others' importedBy lists.
            for (const imp of victim.importGraph.imports) {
                const r = this._records.get(imp);
                if (r !== undefined) {
                    r.importGraph.importedBy = r.importGraph.importedBy
                        .filter(u => u !== victim.uri);
                }
            }
            // Remove from the index and from any pending analyzer queue
            // entry; reopening triggers a fresh inspection.
            this._resolver.forget(victim.uri);
            this._records.delete(victim.uri);
        }
    }
}
