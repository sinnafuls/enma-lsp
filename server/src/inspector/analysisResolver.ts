// Phase 5 — analysis resolver. Owns the delayed-task queue + per-band
// dispatch for the analyzer pass.
//
// Responsibilities:
//   1. `request(record)` — push the record into the priority band that
//      matches its current open/closed/dependent status, debounce a flush.
//   2. After `delayMs` (default 100ms), drain up to `maxAnalyzeBatchPerTick`
//      records from the highest-priority band, run hoist + analyze for each,
//      emit diagnostics through the callback.
//   3. `flush(uri?)` — synchronous drain. With a URI, force-drain that one
//      file (used by hover/completion). Without, drain the entire queue.
//   4. `reanalyzeDependents` propagates a re-request to every transitive
//      `importedBy` at one band lower.
//
// The analyzer pass uses `setActiveGlobalScope` + `analyzeAfterHoisted` from
// the existing pipeline. Each record gets a fresh `SymbolGlobalScope` keyed
// to its URI (transitively-included scopes are pulled in via createGlobalScope).

import * as lsp from 'vscode-languageserver/node';

import { analyzerDiagnostic } from '../compiler_analyzer/analyzerDiagnostic';
import {
    AnalyzerScope,
    createGlobalScope,
} from '../compiler_analyzer/analyzerScope';
import { hoistAfterParsed } from '../compiler_analyzer/hoist';
import { analyzeAfterHoisted } from '../compiler_analyzer/analyzer';
import { SymbolGlobalScope, setActiveGlobalScope } from '../compiler_analyzer/symbolScope';

import { AnalysisQueue, Priority } from './analysisQueue';
import { locationToRange, analyzerDiagToLsp } from './diagnosticUtils';
import type { InspectRecord, InspectorSettings } from './inspector';
import {
    PredefinedRecord,
    mergePredefinedIntoScope,
} from './predefinedLoader';

// ---- Public types ------------------------------------------------------

export type DiagnosticsCallback = (
    params: lsp.PublishDiagnosticsParams,
) => void;

export interface ResolverOptions {
    delayMs?: number;
    maxAnalyzeBatchPerTick?: number;
}

// ---- Resolver ----------------------------------------------------------

interface QueueEntry {
    record: InspectRecord;
    reanalyzeDependents: boolean;
}

export class AnalysisResolver {
    private readonly _queue: AnalysisQueue<QueueEntry> = new AnalysisQueue();
    private readonly _byUri: Map<string, QueueEntry> = new Map();
    private _timer: ReturnType<typeof setTimeout> | undefined;
    private _workspaceRoot: string | undefined;
    private _scanProgressCb: ((s: number, t: number) => void) | undefined;

    private readonly _delayMs: number;
    private readonly _maxBatch: number;

    /** Getter for current predefined records; injected by Inspector. */
    private _getPredefinedRecords: () => readonly PredefinedRecord[] = () => [];

    /** Getter for current inspector settings; injected by Inspector. */
    private _getSettings: () => InspectorSettings | undefined = () => undefined;

    public constructor(
        private readonly _records: Map<string, InspectRecord>,
        private readonly _diagnosticsCallback: DiagnosticsCallback,
        opts: ResolverOptions = {},
    ) {
        this._delayMs = opts.delayMs ?? 100;
        this._maxBatch = opts.maxAnalyzeBatchPerTick ?? 8;
    }

    public setPredefinedRecordsGetter(getter: () => readonly PredefinedRecord[]): void {
        this._getPredefinedRecords = getter;
    }

    public setSettingsGetter(getter: () => InspectorSettings): void {
        this._getSettings = getter;
    }

    public setWorkspaceRoot(uri: string): void {
        this._workspaceRoot = uri;
    }

    public setScanProgressCallback(cb: (s: number, t: number) => void): void {
        this._scanProgressCb = cb;
    }

    /** Drop a record from the queue without running it (used on eviction). */
    public forget(uri: string): void {
        const entry = this._byUri.get(uri);
        if (entry === undefined) return;
        this._queue.remove(entry);
        this._byUri.delete(uri);
    }

    public reset(): void {
        this._queue.clear();
        this._byUri.clear();
        if (this._timer !== undefined) {
            clearTimeout(this._timer);
            this._timer = undefined;
        }
    }

    public request(record: InspectRecord, reanalyzeDependents = false): void {
        const priority = this.classifyPriority(record);

        // Dedupe via URI: if already queued, refresh its reanalyze flag.
        const prior = this._byUri.get(record.uri);
        if (prior !== undefined) {
            prior.reanalyzeDependents =
                prior.reanalyzeDependents || reanalyzeDependents;
            return;
        }

        const entry: QueueEntry = { record, reanalyzeDependents };
        this._byUri.set(record.uri, entry);
        this._queue.push(entry, priority);

        this.scheduleDrain();
    }

    public flush(uri?: string): void {
        // Cancel pending timer; we'll drain synchronously.
        if (this._timer !== undefined) {
            clearTimeout(this._timer);
            this._timer = undefined;
        }

        if (uri !== undefined) {
            const entry = this._byUri.get(uri);
            if (entry !== undefined) {
                this._queue.remove(entry);
                this._byUri.delete(uri);
                this.runAnalyzeFor(entry);
            } else {
                // Even when not queued, force-analyze the record so
                // hover/completion sees fresh diagnostics.
                const record = this._records.get(uri);
                if (record !== undefined && record.isAnalyzerPending) {
                    this.runAnalyzeFor({ record, reanalyzeDependents: false });
                }
            }
            return;
        }

        // Drain everything.
        while (this._queue.size() > 0) {
            const next = this._queue.pop();
            if (next === undefined) break;
            this._byUri.delete(next.record.uri);
            this.runAnalyzeFor(next);
        }
    }

    // ---- Internals ----------------------------------------------------

    private classifyPriority(record: InspectRecord): Priority {
        if (record.isOpen) return 'high';
        // Is this record imported by an open file (transitive)?
        if (this.isDependentOfOpenFile(record.uri)) return 'medium';
        return 'low';
    }

    private isDependentOfOpenFile(uri: string): boolean {
        const seen = new Set<string>();
        const stack: string[] = [uri];
        while (stack.length > 0) {
            const cur = stack.pop()!;
            if (seen.has(cur)) continue;
            seen.add(cur);
            const r = this._records.get(cur);
            if (r === undefined) continue;
            for (const ib of r.importGraph.importedBy) {
                const dep = this._records.get(ib);
                if (dep === undefined) continue;
                if (dep.isOpen) return true;
                stack.push(ib);
            }
        }
        return false;
    }

    private scheduleDrain(): void {
        if (this._timer !== undefined) return;
        this._timer = setTimeout(() => {
            this._timer = undefined;
            this.drainOnce();
        }, this._delayMs);
    }

    private drainOnce(): void {
        let analyzed = 0;
        while (analyzed < this._maxBatch) {
            const next = this._queue.pop();
            if (next === undefined) break;
            this._byUri.delete(next.record.uri);
            this.runAnalyzeFor(next);
            analyzed++;
        }
        // More work? Reschedule.
        if (this._queue.size() > 0) {
            this.scheduleDrain();
        }
    }

    private runAnalyzeFor(entry: QueueEntry): void {
        const record = entry.record;
        const settings = this._getSettings();
        const predefinedRecords = this._getPredefinedRecords();

        // -------- Step 1: own-only scope --------
        // Hoist with NO peer scopes so `record.ownScope` contains only the
        // symbols this file itself declares. Implicit mutual inclusion uses
        // peer ownScopes to avoid the transitive-symbol cycle that arises
        // when every file is everyone else's peer.
        analyzerDiagnostic.beginSession();
        const ownGlobalScope = new SymbolGlobalScope(record.uri);
        setActiveGlobalScope(ownGlobalScope);
        if (predefinedRecords.length > 0) {
            // Step 1 (own-only) drops its diagnostics; severity doesn't matter
            // but pass the user's choice anyway to keep the call sites symmetric.
            mergePredefinedIntoScope(
                ownGlobalScope,
                predefinedRecords,
                settings?.predefinedCollisionSeverity ?? 'information',
            );
        }
        try {
            hoistAfterParsed(record.ast, ownGlobalScope);
            record.ownScope = new AnalyzerScope(record.uri, ownGlobalScope);
        } catch {
            // Hoist failures surface in step 2 with full context.
        }
        analyzerDiagnostic.endSession();

        // -------- Step 2: full scope (peers + own) --------
        // Under implicit mutual inclusion every peer (explicit-include or not)
        // uses its `ownScope`. Transitive visibility is already provided by
        // the implicit peer-scan, and pulling `analyzerScope` instead would
        // re-import this file's own symbols via a peer that previously
        // absorbed them — yielding "Symbol X is already declared" cascades
        // when a bundle-entry file (#includes everything) declares globals.
        const useOwnScopeForPeers = settings?.implicitMutualInclusion === true;
        const peerScope = (other: InspectRecord): AnalyzerScope =>
            useOwnScopeForPeers
                ? (other.ownScope ?? other.analyzerScope)
                : other.analyzerScope;

        const includeScopes: AnalyzerScope[] = [];
        const seen = new Set<string>();
        for (const importUri of record.importGraph.imports) {
            if (seen.has(importUri)) continue;
            seen.add(importUri);
            const imported = this._records.get(importUri);
            if (imported === undefined) continue;
            includeScopes.push(peerScope(imported));
        }

        if (useOwnScopeForPeers) {
            for (const [uri, other] of this._records) {
                if (uri === record.uri) continue;
                if (seen.has(uri)) continue;
                seen.add(uri);
                includeScopes.push(peerScope(other));
            }
        }

        analyzerDiagnostic.beginSession();
        const globalScope = createGlobalScope(record.uri, includeScopes);
        setActiveGlobalScope(globalScope);

        const collisionDiags = predefinedRecords.length > 0
            ? mergePredefinedIntoScope(
                globalScope,
                predefinedRecords,
                settings?.predefinedCollisionSeverity ?? 'information',
            )
            : [];

        try {
            const hoistResult = hoistAfterParsed(record.ast, globalScope);
            const analyzerScope = analyzeAfterHoisted(record.uri, hoistResult);
            record.analyzerScope = analyzerScope;
        } catch (err) {
            analyzerDiagnostic.error(
                {
                    uri: record.uri,
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                },
                `Analyzer crash: ${(err as Error).message ?? String(err)}`,
                'EN_ANALYZER_CRASH',
            );
        }

        const analyzerDiags = analyzerDiagnostic.endSession();
        record.diagnosticsInAnalyzer = [
            ...analyzerDiags.map(analyzerDiagToLsp),
            ...collisionDiags,
        ];
        record.isAnalyzerPending = false;

        this._diagnosticsCallback({
            uri: record.uri,
            diagnostics: [
                ...record.diagnosticsInParser,
                ...record.diagnosticsInAnalyzer,
            ],
        });

        // -------- Reanalyze dependents (band: medium) ----------
        if (entry.reanalyzeDependents) {
            const deps = new Set<string>();
            const stack = [...record.importGraph.importedBy];
            while (stack.length > 0) {
                const cur = stack.pop()!;
                if (deps.has(cur) || cur === record.uri) continue;
                deps.add(cur);
                const r = this._records.get(cur);
                if (r === undefined) continue;
                stack.push(...r.importGraph.importedBy);
            }
            // Under implicit mutual inclusion every other open record is also a dependent.
            if (settings?.implicitMutualInclusion) {
                for (const [uri, r] of this._records) {
                    if (uri === record.uri) continue;
                    if (!r.isOpen) continue;
                    deps.add(uri);
                }
            }
            for (const dep of deps) {
                const r = this._records.get(dep);
                if (r === undefined) continue;
                // Don't recurse infinitely — re-request without further fanout.
                this.request(r, false);
            }
        }
    }

    // Allow tests to query queue size without exposing internals.
    public queueSize(): number {
        return this._queue.size();
    }
}
