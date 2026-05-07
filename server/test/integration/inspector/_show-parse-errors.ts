// Quick: dump parse errors with line numbers for given files.
process.env.ENMA_LSP_TEST = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { parseAfterPreprocessed } from '../../../src/compiler_parser/parser';

const files = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['enma_test.em', 'enma_mi_test.em', 'test_all_apis.em', 'test_collections_api.em', 'test_list_api.em'];

const base = 'D:/Projects/fortnut/enma example';
for (const f of files) {
    const full = path.join(base, f);
    const src = fs.readFileSync(full, 'utf8');
    const lines = src.split(/\r?\n/);
    const uri = 'file:///' + full.replace(/\\/g, '/');
    const tokens = tokenize(uri, src);
    const pre = preprocessAfterTokenized(tokens, { fileUri: uri });
    const parsed = parseAfterPreprocessed(pre, { fileUri: uri });
    const errs = parsed.diagnostics.filter(d => d.severity === 'error');
    console.log(`\n=== ${f}  (${errs.length} parse errors) ===`);
    for (const e of errs) {
        const ln = e.location.start.line;
        const col = e.location.start.character;
        console.log(`  L${ln + 1}:${col + 1}  ${e.message}`);
        console.log(`         | ${(lines[ln] ?? '').slice(0, 100)}`);
    }
}
