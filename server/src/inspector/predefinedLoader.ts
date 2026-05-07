// Predefined-file loader — Phase 6 (US-004).
//
// Handles loading of bundled + workspace `.em.predefined` files and applies
// §A10 precedence:
//   workspace > forceInclude > bundled
//
// On a symbol collision:
//   AC-21:  emit Warning at the HIGHER-precedence declaration site naming the
//           lower-precedence origin.
//   AC-21b: if the higher-precedence declaration carries `[[shadow]]`, suppress
//           the Warning.
//
// §A7: when `process.env.ENMA_LSP_TEST === '1'`, `loadBundledPredefined()`
// returns immediately without loading anything.
//
// Each predefined file is run through the full tokenize → preprocess → parse
// pipeline. The resulting AST is used only for hoist-level symbol extraction
// (no full analyzer run needed for predefined files — they are declaration-only).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as lsp from 'vscode-languageserver/node';

import { tokenize } from '../compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../compiler_parser/parserPreprocess';
import { parseAfterPreprocessed } from '../compiler_parser/parser';
import {
    SymbolGlobalScope,
    SymbolScope,
} from '../compiler_analyzer/symbolScope';
import {
    SymbolObject,
    SymbolObjectHolder,
    SymbolType,
    SymbolFunction,
    SymbolFunctionHolder,
} from '../compiler_analyzer/symbolObject';
import { registerEnmaTypes } from '../compiler_analyzer/enmaTypes';
import { analyzerDiagnostic } from '../compiler_analyzer/analyzerDiagnostic';
import { hoistAfterParsed } from '../compiler_analyzer/hoist';
import { createGlobalScope } from '../compiler_analyzer/analyzerScope';
import { setActiveGlobalScope } from '../compiler_analyzer/symbolScope';
import { TextLocation } from '../compiler_tokenizer/textLocation';
import { TokenIdentifier, TokenKind } from '../compiler_tokenizer/tokenObject';

// ---- Origin precedence -------------------------------------------------------

export type PredefinedOrigin = 'bundled' | 'forceInclude' | 'workspace';

const ORIGIN_RANK: Record<PredefinedOrigin, number> = {
    bundled: 0,
    forceInclude: 1,
    workspace: 2,
};

// ---- Loaded predefined record -------------------------------------------------

export interface PredefinedRecord {
    uri: string;
    origin: PredefinedOrigin;
    globalScope: SymbolGlobalScope;
    /** Parser-layer diagnostics (errors/warnings from tokenize+preprocess+parse). */
    diagnostics: lsp.Diagnostic[];
}

// ---- Diagnostics format helpers ----------------------------------------------

function makeRange(loc: TextLocation): lsp.Range {
    return {
        start: { line: loc.start.line, character: loc.start.character },
        end: { line: loc.end.line, character: loc.end.character },
    };
}

// ---- Load a single predefined file -------------------------------------------

/**
 * Parse a predefined file and extract its symbol scope.
 * Returns a PredefinedRecord or undefined if the file cannot be read.
 */
export function loadPredefinedFile(
    filePath: string,
    origin: PredefinedOrigin,
): PredefinedRecord | undefined {
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch {
        return undefined;
    }

    const uri = `file:///${filePath.replace(/\\/g, '/')}`;
    const diags: lsp.Diagnostic[] = [];

    // Tokenize + preprocess + parse
    const rawTokens = tokenize(uri, content);
    const preprocessed = preprocessAfterTokenized(rawTokens, { fileUri: uri });
    const parseResult = parseAfterPreprocessed(preprocessed, { fileUri: uri });

    for (const d of preprocessed.diagnostics) {
        diags.push({
            severity: d.severity === 'error'
                ? lsp.DiagnosticSeverity.Error
                : lsp.DiagnosticSeverity.Warning,
            range: makeRange(d.location),
            message: d.message,
            source: 'Enma - Predefined',
        });
    }
    for (const d of parseResult.diagnostics) {
        diags.push({
            severity: d.severity === 'error'
                ? lsp.DiagnosticSeverity.Error
                : lsp.DiagnosticSeverity.Warning,
            range: makeRange(d.location),
            message: d.message,
            source: 'Enma - Predefined',
        });
    }

    // Hoist into a fresh scope to extract declared symbols.
    analyzerDiagnostic.beginSession();
    const globalScope = createGlobalScope(uri, []);
    setActiveGlobalScope(globalScope);

    // Register primitives only (no stdlib JSON — predefined files are the stdlib).
    registerEnmaTypes(globalScope, { skipStdlib: true });

    try {
        hoistAfterParsed(parseResult.ast, globalScope);
    } catch {
        // Defensive: parse errors may cause hoist to throw; we still return
        // what we have.
    }
    analyzerDiagnostic.endSession();

    return { uri, origin, globalScope, diagnostics: diags };
}

// ---- Bundled predefined loading (§A7) ----------------------------------------

/**
 * Load every `*.em.predefined` shipped in the bundled `predefined/` directory.
 * §A7: no-op when ENMA_LSP_TEST=1 (returns []).
 *
 * The directory is resolved relative to the server entry point so it works in
 * three layouts:
 *   1. __dirname/predefined/             — bundled .vsix layout (server/dist/predefined/)
 *   2. __dirname/../predefined/          — tsc-out layout (server/out/predefined/)
 *   3. __dirname/../../src/predefined/   — dev source fallback
 *   4. cwd/server/src/predefined/        — last-ditch dev/repo fallback
 *
 * @param log  Optional log sink (wired to the VSCode Output channel by inspector.ts).
 */
export function loadBundledPredefined(log?: (msg: string) => void): PredefinedRecord[] {
    if (process.env.ENMA_LSP_TEST === '1') return [];

    const dirCandidates = [
        path.resolve(__dirname, 'predefined'),
        path.resolve(__dirname, '..', 'predefined'),
        path.resolve(__dirname, '..', '..', 'src', 'predefined'),
        path.resolve(process.cwd(), 'server', 'src', 'predefined'),
    ];

    for (const dir of dirCandidates) {
        if (!fs.existsSync(dir)) continue;
        let entries: string[];
        try { entries = fs.readdirSync(dir); } catch { continue; }

        const records: PredefinedRecord[] = [];
        for (const entry of entries) {
            if (!entry.endsWith('.em.predefined')) continue;
            const full = path.join(dir, entry);
            const rec = loadPredefinedFile(full, 'bundled');
            if (rec !== undefined) {
                records.push(rec);
                log?.(`[inspector] loaded bundled predefined: ${full}`);
            }
        }
        if (records.length > 0) return records;
    }

    log?.('[inspector] WARNING: no bundled predefined found; searched: ' + dirCandidates.join(', '));
    return [];
}

// ---- §A10 Precedence merge with AC-21 collision warnings --------------------

/** Check whether a hoisted scope's top-level type declaration has `[[shadow]]`. */
function hasShadowAnnotation(holder: SymbolObjectHolder): boolean {
    const sym = holder instanceof SymbolFunctionHolder
        ? holder.toList()[0]
        : holder;
    if (!sym) return false;

    // SymbolType.linkedNode carries the AST NodeClass/Struct/Interface/etc.
    if (sym instanceof SymbolType && sym.linkedNode) {
        const node = sym.linkedNode as unknown as { annotations?: ReadonlyArray<{ name?: { text?: string } }> };
        if (Array.isArray(node.annotations)) {
            return node.annotations.some(a => a.name?.text === 'shadow');
        }
    }
    // SymbolFunction.linkedNode carries NodeFunction/NodeMethod/etc.
    if (sym instanceof SymbolFunction && sym.linkedNode) {
        const node = sym.linkedNode as unknown as { annotations?: ReadonlyArray<{ name?: { text?: string } }> };
        if (Array.isArray(node.annotations)) {
            return node.annotations.some(a => a.name?.text === 'shadow');
        }
    }
    return false;
}

/**
 * Merge a set of predefined records into a target global scope, applying
 * §A10 precedence and emitting AC-21/AC-21b collision diagnostics.
 *
 * Records must be sorted by ascending ORIGIN_RANK (bundled first, workspace last).
 * Higher-rank records win on name collision. If the winner has `[[shadow]]`,
 * the AC-21 warning is suppressed.
 *
 * @returns array of collision Warning diagnostics (for the calling file's record).
 */
export function mergePredefinedIntoScope(
    target: SymbolGlobalScope,
    records: readonly PredefinedRecord[],
): lsp.Diagnostic[] {
    const collisionDiags: lsp.Diagnostic[] = [];

    // Sort ascending by precedence rank (bundled=0, forceInclude=1, workspace=2).
    const sorted = [...records].sort(
        (a, b) => ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin],
    );

    // Track which origin currently holds each symbol name.
    const registered = new Map<string, { origin: PredefinedOrigin; loc: TextLocation }>();

    for (const rec of sorted) {
        for (const [name, incoming] of rec.globalScope.symbolTable) {
            // Skip symbols that originate from builtins or the stdlib virtual
            // URI — these are registered by `registerEnmaTypes` in every scope
            // and should not generate predefined collision warnings.
            const incomingLoc0 = getHolderLocation(incoming, rec.uri);
            if (incomingLoc0 && (
                incomingLoc0.uri === 'enma://builtin' ||
                incomingLoc0.uri === 'enma://stdlib'
            )) continue;

            // Skip template-parameter stubs that hoistTemplate inserts into
            // the parent scope (marked via isTypeParameter). Without this
            // filter, names like `T` from `template<typename T> ...` would
            // leak into user files and collide with user-defined symbols.
            if (incoming instanceof SymbolType && incoming.isTypeParameter) {
                continue;
            }

            const existing = registered.get(name);

            if (existing !== undefined) {
                // Collision: `incoming` (higher rank) wins over `existing` (lower rank).
                // Check for [[shadow]] on the incoming declaration.
                const suppress = hasShadowAnnotation(incoming);

                if (!suppress) {
                    // AC-21: emit Warning at the higher-precedence declaration site.
                    const incomingLoc = getHolderLocation(incoming, rec.uri);
                    if (incomingLoc !== undefined) {
                        collisionDiags.push({
                            severity: lsp.DiagnosticSeverity.Warning,
                            range: makeRange(incomingLoc),
                            message: `'${name}' shadows a ${existing.origin} predefined symbol (use [[shadow]] to suppress)`,
                            code: 'EN_PRED_COLLISION',
                            source: 'Enma - Predefined',
                        });
                    }
                }
            }

            // Insert or overwrite: higher-rank always wins.
            mergeHolder(target, incoming);
            registered.set(name, {
                origin: rec.origin,
                loc: getHolderLocation(incoming, rec.uri) ?? {
                    uri: rec.uri,
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                },
            });
        }

        // Also merge child scopes (class member scopes etc.) — child scopes
        // only; root-level symbols already handled above. Note: `copyFrom`
        // indiscriminately copies all root symbols too, which would re-leak
        // template-parameter stubs we filtered above. Guard against that by
        // copying ONLY non-stub root symbols + child scopes.
        for (const [key, child] of rec.globalScope.childScopeTable) {
            const existing = target.lookupScope(key);
            if (existing === undefined) {
                copyChildScope(target, rec.globalScope, key);
            }
            void child;
        }
    }

    return collisionDiags;
}

function getHolderLocation(holder: SymbolObjectHolder, _uri: string): TextLocation | undefined {
    const sym = holder instanceof SymbolFunctionHolder
        ? holder.toList()[0]
        : holder;
    if (!sym) return undefined;
    const loc = (sym as SymbolObject & { identifierToken?: { location?: TextLocation } })
        .identifierToken?.location;
    return loc;
}

/**
 * Copy a single named child scope from `src` into `target`, recursively.
 * Skips template-parameter stubs at every nesting level (they only matter
 * for in-template body resolution, not for cross-file lookup).
 */
function copyChildScope(target: SymbolScope, src: SymbolScope, key: string): void {
    const child = src.childScopeTable.get(key);
    if (child === undefined) return;
    const own = target.insertScope(key, child.linkedKind);
    copyScopeFiltered(own, child);
}

function copyScopeFiltered(dst: SymbolScope, src: SymbolScope): void {
    for (const [, holder] of src.symbolTable) {
        if (holder instanceof SymbolType && holder.isTypeParameter) continue;
        if (holder instanceof SymbolFunctionHolder) {
            for (const fn of holder.toList()) dst.insertSymbol(fn);
        } else {
            dst.insertSymbol(holder as SymbolObject);
        }
    }
    for (const [k, c] of src.childScopeTable) {
        copyChildScope(dst, src, k);
        void c;
    }
}

function mergeHolder(target: SymbolGlobalScope, incoming: SymbolObjectHolder): void {
    if (incoming instanceof SymbolFunctionHolder) {
        for (const fn of incoming.toList()) {
            target.insertSymbol(fn);
        }
    } else {
        target.insertSymbol(incoming as SymbolObject);
    }
}

// ---- Workspace scan ----------------------------------------------------------

/**
 * Scan a workspace root for `*.em.predefined` files and load each as a
 * 'workspace' origin predefined record.
 */
export function scanWorkspacePredefined(workspaceRoot: string): PredefinedRecord[] {
    const results: PredefinedRecord[] = [];
    if (!fs.existsSync(workspaceRoot)) return results;

    function walk(dir: string): void {
        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry);
            let stat: fs.Stats;
            try { stat = fs.statSync(full); } catch { continue; }
            if (stat.isDirectory()) {
                // Skip common noise directories
                if (['node_modules', '.git', 'dist', 'out', 'build', '.tmp-validate'].includes(entry)) {
                    continue;
                }
                walk(full);
            } else if (entry.endsWith('.em.predefined')) {
                const rec = loadPredefinedFile(full, 'workspace');
                if (rec !== undefined) results.push(rec);
            }
        }
    }

    walk(workspaceRoot);
    return results;
}

// ---- Walk-up discovery -------------------------------------------------------

/**
 * Walk UP from `workspaceRoot` scanning only the top-level files (not
 * recursive) of each ancestor directory for `*.em.predefined` files.
 *
 * - Walks at most `maxDepth` parent levels (0 = disabled).
 * - Stops when it reaches the filesystem root or the user home directory.
 * - Already-seen canonical paths (from `knownPaths`) are skipped to deduplicate
 *   against the workspace-downward scan.
 *
 * @param workspaceRoot  Absolute filesystem path of the workspace root.
 * @param maxDepth       Maximum number of parent levels to walk (default 4).
 * @param knownPaths     Set of already-loaded canonical paths to deduplicate.
 * @param log            Optional log sink for observability.
 * @returns New PredefinedRecord[] with origin 'workspace'.
 */
export function walkUpPredefined(
    workspaceRoot: string,
    maxDepth: number,
    knownPaths: ReadonlySet<string>,
    log?: (msg: string) => void,
): PredefinedRecord[] {
    if (maxDepth <= 0) return [];

    const results: PredefinedRecord[] = [];
    const homeDir = os.homedir();

    log?.(`[inspector] walk-up scan from ${workspaceRoot} looking for *.em.predefined in ${maxDepth} parent dir(s)`);

    let current = path.resolve(workspaceRoot);
    for (let depth = 0; depth < maxDepth; depth++) {
        const parent = path.dirname(current);
        // Stop if we've hit the filesystem root (dirname returns the same path).
        if (parent === current) break;
        // Stop if we've gone above the user home directory.
        if (!parent.startsWith(homeDir) && homeDir.startsWith(parent) === false) {
            // parent is an ancestor of homeDir or unrelated — allow only if
            // parent is homeDir or below homeDir.
            // More precisely: stop if parent is strictly above homeDir.
            const rel = path.relative(parent, homeDir);
            if (!rel.startsWith('..') && rel !== '') {
                // homeDir is inside parent — still below home, OK
            } else if (rel === '') {
                // parent IS homeDir — allowed
            } else {
                // parent is above homeDir — stop
                log?.(`[inspector] walk-up stopped at ${parent} (above home dir)`);
                break;
            }
        }

        current = parent;

        // Scan only the top-level files of this directory (non-recursive).
        let entries: string[];
        try {
            entries = fs.readdirSync(current);
        } catch {
            continue;
        }

        const found: string[] = [];
        for (const entry of entries) {
            if (!entry.endsWith('.em.predefined')) continue;
            const full = path.join(current, entry);
            let stat: fs.Stats;
            try { stat = fs.statSync(full); } catch { continue; }
            if (!stat.isFile()) continue;

            const canonical = path.resolve(full);
            if (knownPaths.has(canonical)) continue;  // already loaded via downward scan

            const rec = loadPredefinedFile(full, 'workspace');
            if (rec !== undefined) {
                results.push(rec);
                found.push(full);
            }
        }

        if (found.length > 0) {
            log?.(`[inspector] walk-up found ${found.length} file(s) at ${current}: [${found.join(', ')}]`);
        }
    }

    return results;
}

// ---- Force-include predefined ------------------------------------------------

/**
 * Load all files listed in `enma.forceIncludePredefined` as 'forceInclude'
 * origin predefined records.
 */
export function loadForceIncludePredefined(paths: string[]): PredefinedRecord[] {
    const results: PredefinedRecord[] = [];
    for (const p of paths) {
        const rec = loadPredefinedFile(p, 'forceInclude');
        if (rec !== undefined) results.push(rec);
    }
    return results;
}
