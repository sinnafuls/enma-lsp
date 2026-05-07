// Real-corpus regression: validates that the full Perception script set
// (D:/Projects/fortnut/enma example/*.em) parses + analyses cleanly when
// the workspace `perception.em.predefined` is loaded as a workspace-origin
// predefined per §A10.
//
// Uses honest thresholds discovered from the probe at the time this test
// was added — tightening these is welcome; loosening should require an
// explicit reason in the diff.
//
// Skipped when the corpus is absent (CI / non-Windows dev machines).

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { probeCorpus } from './_real-corpus-probe';

const CORPUS_DIR = 'D:/Projects/fortnut/enma example';
const PRED_PATH  = 'D:/Projects/fortnut/perception.em.predefined';

const corpusPresent = fs.existsSync(CORPUS_DIR) && fs.existsSync(PRED_PATH);

(corpusPresent ? describe : describe.skip)('Real-corpus probe — Perception scripts', () => {
    it('all 22 scripts parse cleanly with workspace predefined loaded', function () {
        this.timeout(30000);
        const r = probeCorpus(CORPUS_DIR, PRED_PATH);

        // Hard parser-error budget: zero. If this fails, a parser regression
        // landed (or the corpus uses syntax we don't yet support — investigate).
        assert.strictEqual(
            r.totalParserErrors, 0,
            `expected 0 parser errors across corpus, got ${r.totalParserErrors}\n` +
            r.files.filter(f => f.parserErrors > 0)
                .map(f => `  ${f.file}: ${f.parserErrors}`).join('\n')
        );

        // Hard analyzer-error budget: zero (post predefined fix).
        assert.strictEqual(
            r.totalAnalyzerErrors, 0,
            `expected 0 analyzer errors across corpus, got ${r.totalAnalyzerErrors}\n` +
            r.files.filter(f => f.analyzerErrors > 0)
                .map(f => `  ${f.file}: ${f.analyzerErrors} (first: ${f.firstMessages[0] ?? ''})`)
                .join('\n')
        );

        // Soft warning budget. Currently 2 EN_UNKNOWN_GENERIC for `array<int32>`
        // (stdlib `array` is non-generic). Tighten this when stdlib gains
        // typed arrays.
        const WARN_BUDGET = 5;
        assert.ok(
            r.totalAnalyzerWarnings <= WARN_BUDGET,
            `analyzer warnings ${r.totalAnalyzerWarnings} exceeds budget ${WARN_BUDGET}`
        );
    });

    it('every corpus file is enumerated', () => {
        const files = fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith('.em'));
        assert.ok(files.length >= 20, `expected >= 20 .em files in corpus, got ${files.length}`);
        // Sanity that path resolution works.
        for (const f of files) {
            assert.ok(fs.statSync(path.join(CORPUS_DIR, f)).isFile());
        }
    });
});
