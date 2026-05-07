process.env.ENMA_LSP_TEST = '1';
import * as fs from 'fs';
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

const targets = [
    'D:/Projects/fortnut/enma example/enma_test.em',
    'D:/Projects/fortnut/enma example/test_all_apis.em',
];

for (const f of targets) {
    const uri = `file:///${f.replace(/\\/g, '/')}`;
    const src = fs.readFileSync(f, 'utf8');
    const t = tokenize(uri, src);
    const pre = preprocessAfterTokenized(t, { fileUri: uri });
    const p = parseAfterPreprocessed(pre, { fileUri: uri });
    const g = createGlobalScope(uri, []);
    setActiveGlobalScope(g);
    registerEnmaTypes(g, { skipStdlib: true });
    const pred = loadPredefinedFile('D:/Projects/fortnut/perception.em.predefined', 'workspace');
    if (pred) mergePredefinedIntoScope(g, [pred]);
    analyzerDiagnostic.beginSession();
    try {
        const h = hoistAfterParsed(p.ast, g);
        analyzeAfterHoisted(uri, h);
    } catch (e) {}
    const ds = analyzerDiagnostic.endSession();
    console.log(`\n=== ${f.split('/').pop()} ===`);
    console.log('total diags:', ds.length);
    ds.forEach((d: any) => console.log(' ', d.severity, d.code ?? '?', d.message, '@line', d.location?.start?.line ?? d.range?.start?.line));
}
