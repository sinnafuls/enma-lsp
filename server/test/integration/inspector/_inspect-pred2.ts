process.env.ENMA_LSP_TEST = '1';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { parseAfterPreprocessed } from '../../../src/compiler_parser/parser';

const src = `class color {
    int64 r;  int64 g;  int64 b;  int64 a;
    color();
    color(int64 r, int64 g, int64 b, int64 a);
    int64 x();
    int64 g();
    int64 b();
    int64 a();
}`;

const uri = 'file:///test.em';
const tokens = tokenize(uri, src);
console.log('tokens:', tokens.length);
for (const t of tokens.slice(0, 25)) console.log(' ', t.kind, JSON.stringify(t.text), 'line', t.location.start.line);
const pre = preprocessAfterTokenized(tokens, { fileUri: uri });
console.log('pre diags:', pre.diagnostics.length);
pre.diagnostics.slice(0, 10).forEach(d => console.log('  pre:', d.severity, d.message));
const parsed = parseAfterPreprocessed(pre, { fileUri: uri });
console.log('parse diags:', parsed.diagnostics.length);
parsed.diagnostics.slice(0, 20).forEach(d => console.log('  parse:', d.severity, d.message, '@', d.location?.start));
