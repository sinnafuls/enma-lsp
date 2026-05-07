// Probe script: run the full hoist+analyze pipeline on samples/showcase.em
// and print every diagnostic with its severity, code, and message.
// Re-usable by CI or manual inspection.
//
// Usage:
//   npx ts-node test/unit/analyzer/_showcase-probe.ts
//   (or import probeShowcase() from test helpers)

process.env.ENMA_LSP_TEST = '1'; // skip stdlib — deterministic counts

import * as fs from 'node:fs';
import * as path from 'node:path';

import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { parseAfterPreprocessed } from '../../../src/compiler_parser/parser';
import { hoistAfterParsed } from '../../../src/compiler_analyzer/hoist';
import { analyzeAfterHoisted } from '../../../src/compiler_analyzer/analyzer';
import { createGlobalScope } from '../../../src/compiler_analyzer/analyzerScope';
import { registerEnmaTypes } from '../../../src/compiler_analyzer/enmaTypes';
import { analyzerDiagnostic, AnalyzerDiagnostic } from '../../../src/compiler_analyzer/analyzerDiagnostic';
import { setActiveGlobalScope } from '../../../src/compiler_analyzer/symbolScope';

const SHOWCASE = path.resolve(__dirname, '..', '..', '..', '..', 'samples', 'showcase.em');
const URI = 'file:///showcase.em';

export interface ProbeResult {
    parserErrorCount: number;
    analyzerDiagnostics: AnalyzerDiagnostic[];
    errorCount: number;
    warningCount: number;
    byCode: Map<string, number>;
}

export function probeShowcase(): ProbeResult {
    const src = fs.readFileSync(SHOWCASE, 'utf8');

    const tokens = tokenize(URI, src);
    const pre = preprocessAfterTokenized(tokens, { fileUri: URI });
    const parsed = parseAfterPreprocessed(pre, { fileUri: URI });

    const global = createGlobalScope(URI, []);
    setActiveGlobalScope(global);
    registerEnmaTypes(global, { skipStdlib: true });

    analyzerDiagnostic.beginSession();
    const hoistResult = hoistAfterParsed(parsed.ast, global);
    analyzeAfterHoisted(URI, hoistResult);
    const diags = analyzerDiagnostic.endSession();

    const errors = diags.filter(d => d.severity === 'error');
    const warnings = diags.filter(d => d.severity === 'warning');

    const byCode = new Map<string, number>();
    for (const d of diags) {
        const key = d.code ?? '(no-code)';
        byCode.set(key, (byCode.get(key) ?? 0) + 1);
    }

    return {
        parserErrorCount: parsed.diagnostics.filter(d => d.severity === 'error').length,
        analyzerDiagnostics: diags,
        errorCount: errors.length,
        warningCount: warnings.length,
        byCode,
    };
}

// Run when invoked directly
if (require.main === module) {
    const r = probeShowcase();
    console.log(`\n=== showcase.em probe ===`);
    console.log(`Parser errors  : ${r.parserErrorCount}`);
    console.log(`Analyzer errors: ${r.errorCount}`);
    console.log(`Analyzer warnings: ${r.warningCount}`);
    console.log(`\n--- by code ---`);
    for (const [code, count] of [...r.byCode.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count.toString().padStart(3)}  ${code}`);
    }
    console.log(`\n--- all diagnostics ---`);
    for (const d of r.analyzerDiagnostics) {
        const loc = `${d.location.start.line + 1}:${d.location.start.character + 1}`;
        console.log(`  [${d.severity.toUpperCase().padEnd(7)}] ${d.code ?? '?'} @ ${loc}  ${d.message}`);
    }
}
