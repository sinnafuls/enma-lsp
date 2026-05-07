// Test helpers for service-layer tests.
//
// Build a fully-analyzed in-memory record (single or multi-file) without
// spinning up the inspector queue. Returns rawTokens + ast + analyzerScope so
// tests can call provider functions directly.

process.env.ENMA_LSP_TEST = '1';

import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { parseAfterPreprocessed } from '../../../src/compiler_parser/parser';
import { hoistAfterParsed } from '../../../src/compiler_analyzer/hoist';
import { analyzeAfterHoisted } from '../../../src/compiler_analyzer/analyzer';
import { createGlobalScope } from '../../../src/compiler_analyzer/analyzerScope';
import { registerEnmaTypes } from '../../../src/compiler_analyzer/enmaTypes';
import { analyzerDiagnostic } from '../../../src/compiler_analyzer/analyzerDiagnostic';
import { setActiveGlobalScope } from '../../../src/compiler_analyzer/symbolScope';
import { Inspector } from '../../../src/inspector/inspector';

import type { TokenObject } from '../../../src/compiler_tokenizer/tokenObject';
import type { NodeScript } from '../../../src/compiler_parser/nodes';
import type { AnalyzerScope } from '../../../src/compiler_analyzer/analyzerScope';

export interface FixtureFile {
    uri: string;
    rawTokens: TokenObject[];
    ast: NodeScript;
    analyzerScope: AnalyzerScope;
    content: string;
}

export function buildFixture(uri: string, src: string): FixtureFile {
    const tokens = tokenize(uri, src);
    const pre = preprocessAfterTokenized(tokens, { fileUri: uri });
    const parsed = parseAfterPreprocessed(pre, { fileUri: uri });

    const global = createGlobalScope(uri, []);
    setActiveGlobalScope(global);
    registerEnmaTypes(global, { skipStdlib: true });

    analyzerDiagnostic.beginSession();
    const hoist = hoistAfterParsed(parsed.ast, global);
    const analyzerScope = analyzeAfterHoisted(uri, hoist);
    analyzerDiagnostic.endSession();

    return { uri, rawTokens: tokens, ast: parsed.ast, analyzerScope, content: src };
}

/** Multi-file fixture using the actual Inspector so cross-file references work. */
export function buildInspectorFixture(files: { [uri: string]: string }): { inspector: Inspector; records: { [uri: string]: { rawTokens: TokenObject[]; ast: NodeScript; analyzerScope: AnalyzerScope; content: string } } } {
    const inspector = new Inspector();
    inspector.registerDiagnosticsCallback(() => undefined);
    for (const uri of Object.keys(files)) {
        inspector.inspectFile(uri, files[uri], { isOpen: true });
    }
    inspector.flush();
    const records: { [uri: string]: { rawTokens: TokenObject[]; ast: NodeScript; analyzerScope: AnalyzerScope; content: string } } = {};
    for (const uri of Object.keys(files)) {
        const r = inspector.getRecord(uri);
        if (r) {
            records[uri] = {
                rawTokens: r.rawTokens,
                ast: r.ast,
                analyzerScope: r.analyzerScope,
                content: r.content,
            };
        }
    }
    return { inspector, records };
}

export function pos(line: number, character: number) { return { line, character }; }
