// Probe script: run the full pipeline over the real Perception Enma corpus at
// D:/Projects/fortnut/enma example/*.em and print a per-file summary plus
// categorized totals.
//
// Usage:
//   npx ts-node server/test/integration/inspector/_real-corpus-probe.ts
//   PRED=D:/Projects/fortnut/perception.em.predefined npx ts-node ...

process.env.ENMA_LSP_TEST = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';

import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { parseAfterPreprocessed } from '../../../src/compiler_parser/parser';
import { hoistAfterParsed } from '../../../src/compiler_analyzer/hoist';
import { analyzeAfterHoisted } from '../../../src/compiler_analyzer/analyzer';
import { createGlobalScope } from '../../../src/compiler_analyzer/analyzerScope';
import { registerEnmaTypes } from '../../../src/compiler_analyzer/enmaTypes';
import { analyzerDiagnostic } from '../../../src/compiler_analyzer/analyzerDiagnostic';
import { setActiveGlobalScope } from '../../../src/compiler_analyzer/symbolScope';
import { loadPredefinedFile, mergePredefinedIntoScope } from '../../../src/inspector/predefinedLoader';

const CORPUS_DIR = process.env.CORPUS ?? 'D:/Projects/fortnut/enma example';
const PRED_PATH  = process.env.PRED ?? 'D:/Projects/fortnut/perception.em.predefined';

interface FileResult {
    file: string;
    parserErrors: number;
    analyzerErrors: number;
    analyzerWarnings: number;
    firstMessages: string[];
    byCode: Map<string, number>;
}

function probeFile(filePath: string, predRecord: ReturnType<typeof loadPredefinedFile>): FileResult {
    const src = fs.readFileSync(filePath, 'utf8');
    const uri = `file:///${filePath.replace(/\\/g, '/')}`;

    const tokens = tokenize(uri, src);
    const pre = preprocessAfterTokenized(tokens, { fileUri: uri });
    const parsed = parseAfterPreprocessed(pre, { fileUri: uri });

    const global = createGlobalScope(uri, []);
    setActiveGlobalScope(global);
    registerEnmaTypes(global, { skipStdlib: true });

    if (predRecord !== undefined) {
        mergePredefinedIntoScope(global, [predRecord]);
    }

    analyzerDiagnostic.beginSession();
    let analyzerDiags: ReturnType<typeof analyzerDiagnostic.endSession> = [];
    try {
        const hoistResult = hoistAfterParsed(parsed.ast, global);
        analyzeAfterHoisted(uri, hoistResult);
    } catch (e) {
        // capture but keep going
    }
    analyzerDiags = analyzerDiagnostic.endSession();

    const parseErrs   = parsed.diagnostics.filter(d => d.severity === 'error');
    const aErrs       = analyzerDiags.filter(d => d.severity === 'error');
    const aWarns      = analyzerDiags.filter(d => d.severity === 'warning');
    const byCode      = new Map<string, number>();
    for (const d of [...aErrs, ...aWarns]) {
        const k = d.code ?? '(no-code)';
        byCode.set(k, (byCode.get(k) ?? 0) + 1);
    }

    const firstMsgs = [
        ...parseErrs.slice(0, 3).map(d => `[parse] ${d.message}`),
        ...aErrs.slice(0, 3).map(d => `[ana ${d.code ?? '?'}] ${d.message}`),
    ].slice(0, 3);

    return {
        file: path.basename(filePath),
        parserErrors: parseErrs.length,
        analyzerErrors: aErrs.length,
        analyzerWarnings: aWarns.length,
        firstMessages: firstMsgs,
        byCode,
    };
}

export interface CorpusReport {
    files: FileResult[];
    totalParserErrors: number;
    totalAnalyzerErrors: number;
    totalAnalyzerWarnings: number;
    aggregatedByCode: Map<string, number>;
}

export function probeCorpus(corpusDir = CORPUS_DIR, predPath = PRED_PATH): CorpusReport {
    const files = fs
        .readdirSync(corpusDir)
        .filter(f => f.endsWith('.em'))
        .sort()
        .map(f => path.join(corpusDir, f));

    const predRecord = fs.existsSync(predPath)
        ? loadPredefinedFile(predPath, 'workspace')
        : undefined;

    const results: FileResult[] = [];
    let tp = 0, te = 0, tw = 0;
    const agg = new Map<string, number>();
    for (const f of files) {
        const r = probeFile(f, predRecord);
        results.push(r);
        tp += r.parserErrors;
        te += r.analyzerErrors;
        tw += r.analyzerWarnings;
        for (const [k, v] of r.byCode) agg.set(k, (agg.get(k) ?? 0) + v);
    }

    return {
        files: results,
        totalParserErrors: tp,
        totalAnalyzerErrors: te,
        totalAnalyzerWarnings: tw,
        aggregatedByCode: agg,
    };
}

if (require.main === module) {
    const r = probeCorpus();
    console.log(`\n=== Real corpus probe (${r.files.length} files) ===\n`);
    console.log(`${'file'.padEnd(34)} ${'parse'.padStart(6)} ${'ana-err'.padStart(8)} ${'ana-wrn'.padStart(8)}  first-msg`);
    console.log('-'.repeat(120));
    for (const f of r.files) {
        const first = f.firstMessages[0] ?? '';
        console.log(
            `${f.file.padEnd(34)} ${String(f.parserErrors).padStart(6)} ` +
            `${String(f.analyzerErrors).padStart(8)} ${String(f.analyzerWarnings).padStart(8)}  ${first.slice(0, 90)}`
        );
    }
    console.log('-'.repeat(120));
    console.log(`${'TOTAL'.padEnd(34)} ${String(r.totalParserErrors).padStart(6)} ${String(r.totalAnalyzerErrors).padStart(8)} ${String(r.totalAnalyzerWarnings).padStart(8)}`);

    console.log(`\n--- aggregated by code (top 30) ---`);
    const sorted = [...r.aggregatedByCode.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    for (const [k, v] of sorted) {
        console.log(`  ${String(v).padStart(5)}  ${k}`);
    }

    console.log(`\n--- per-file detail (first 3 messages each) ---`);
    for (const f of r.files) {
        if (f.parserErrors === 0 && f.analyzerErrors === 0) continue;
        console.log(`\n[${f.file}]  parse=${f.parserErrors}  ana-err=${f.analyzerErrors}`);
        for (const m of f.firstMessages) console.log(`    ${m.slice(0, 120)}`);
    }
}
