// Test harness for analyzer unit tests.
//
// Builds an inspect-style pipeline directly: tokenize → preprocess → parse →
// hoist → analyze. Returns the hoist-result + diagnostics so individual
// subsystem tests can drive their own fixtures without spinning up the
// inspector / queue layer (Phase 5 owns those).
//
// §A7: callers should ensure ENMA_LSP_TEST=1 is set before importing
// `enmaTypes`. The runner sets it for the whole test process via
// `.mocharc` env in Phase 5; for now the helper sets it directly.

process.env.ENMA_LSP_TEST = '1';

import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { parseAfterPreprocessed } from '../../../src/compiler_parser/parser';
import { analyzeAfterHoisted } from '../../../src/compiler_analyzer/analyzer';
import { hoistAfterParsed } from '../../../src/compiler_analyzer/hoist';
import { createGlobalScope, AnalyzerScope } from '../../../src/compiler_analyzer/analyzerScope';
import { registerEnmaTypes } from '../../../src/compiler_analyzer/enmaTypes';
import { analyzerDiagnostic, AnalyzerDiagnostic } from '../../../src/compiler_analyzer/analyzerDiagnostic';
import { setActiveGlobalScope } from '../../../src/compiler_analyzer/symbolScope';
import { Diagnostic } from '../../../src/compiler_parser/parserPreprocess';

export const TEST_URI = 'file:///test.em';

export interface AnalyzeResult {
    parserDiagnostics: Diagnostic[];
    analyzerDiagnostics: AnalyzerDiagnostic[];
    analyzerScope: AnalyzerScope;
}

export function analyzeSource(src: string, uri = TEST_URI): AnalyzeResult {
    const tokens = tokenize(uri, src);
    const pre = preprocessAfterTokenized(tokens, { fileUri: uri });
    const parsed = parseAfterPreprocessed(pre, { fileUri: uri });

    const global = createGlobalScope(uri, []);
    setActiveGlobalScope(global);
    registerEnmaTypes(global, { skipStdlib: true });

    analyzerDiagnostic.beginSession();
    const hoistResult = hoistAfterParsed(parsed.ast, global);
    const analyzerScope = analyzeAfterHoisted(uri, hoistResult);
    const diags = analyzerDiagnostic.endSession();

    return {
        parserDiagnostics: parsed.diagnostics,
        analyzerDiagnostics: diags,
        analyzerScope,
    };
}

export function errorsOnly(d: AnalyzerDiagnostic[]): AnalyzerDiagnostic[] {
    return d.filter(x => x.severity === 'error');
}
