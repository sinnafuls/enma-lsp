import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { parseAfterPreprocessed, ParseResult } from '../../../src/compiler_parser/parser';
import { Diagnostic } from '../../../src/compiler_parser/parserPreprocess';

export const TEST_URI = 'file:///test.em';

export function parseSource(src: string, uri = TEST_URI): ParseResult {
    const tokens = tokenize(uri, src);
    const pre = preprocessAfterTokenized(tokens, { fileUri: uri });
    return parseAfterPreprocessed(pre, { fileUri: uri });
}

/** Filter parser-only diagnostics (excludes preprocessor diagnostics, which are shared). */
export function parserErrors(d: Diagnostic[]): Diagnostic[] {
    return d.filter(x => x.severity === 'error');
}
