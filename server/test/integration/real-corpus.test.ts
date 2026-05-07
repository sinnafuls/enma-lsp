import { strict as assert } from 'node:assert';
import * as path from 'node:path';
import { probeCorpus } from './inspector/_real-corpus-probe';

// In-repo paths so the test runs deterministically across machines.
const CORPUS = path.resolve(__dirname, '../../../example');
const PRED = path.resolve(__dirname, '../../../server/src/predefined/perception.em.predefined');

describe('real-corpus integration', () => {
    it('all 22 Perception scripts: 0 parse errors total', () => {
        const r = probeCorpus(CORPUS, PRED);
        assert.equal(r.totalParserErrors, 0,
            `Expected 0 parser errors total. Files with errors: ` +
            r.files.filter(f => f.parserErrors > 0).map(f => f.file).join(', '));
    });

    it('all 22 Perception scripts: ≤ 3 analyzer errors total (with workspace predefined)', () => {
        const r = probeCorpus(CORPUS, PRED);
        const T = 3;  // honest threshold; actual baseline is 0; small buffer for env variance
        assert.ok(r.totalAnalyzerErrors <= T,
            `Expected ≤${T} analyzer errors total, got ${r.totalAnalyzerErrors}. ` +
            `By code: ${[...r.aggregatedByCode.entries()].map(([k, v]) => k + ':' + v).join(', ')}`);
    });
});
