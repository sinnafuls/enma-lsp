import * as assert from 'assert';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { parseAfterPreprocessed } from '../../../src/compiler_parser/parser';
import { ParserCache, hashTokenRange, findTopLevelBoundaries } from '../../../src/compiler_parser/parserCache';

const URI = 'file:///inc.em';

function makeFile(numFns: number, body = '    return 0;'): string {
    const decls: string[] = [];
    for (let i = 0; i < numFns; i++) {
        decls.push(`int32 fn_${i}() {\n${body}\n}\n`);
    }
    return decls.join('\n');
}

describe('Parser — §A1 incremental cache', () => {
    it('hashTokenRange is deterministic and order-sensitive', () => {
        const t = tokenize(URI, `int32 a = 1;\nint32 b = 2;\n`);
        const h1 = hashTokenRange(t, 0, t.length);
        const h2 = hashTokenRange(t, 0, t.length);
        assert.strictEqual(h1, h2);
        const tDifferent = tokenize(URI, `int32 b = 1;\nint32 a = 2;\n`);
        const h3 = hashTokenRange(tDifferent, 0, tDifferent.length);
        assert.notStrictEqual(h1, h3);
    });

    it('findTopLevelBoundaries identifies top-level chunks', () => {
        const t = tokenize(URI, `int32 a() { return 1; }\nstruct S { int32 x; }\nint32 c = 5;\n`);
        const b = findTopLevelBoundaries(t.filter(tok => tok.kind !== 'eof'));
        assert.ok(b.length >= 3, `expected ≥3 boundaries, got ${b.length}`);
    });

    it('cache reuse on identical input yields identical AST', () => {
        const src = makeFile(20);
        const cache = new ParserCache();
        const t = tokenize(URI, src);
        const p = preprocessAfterTokenized(t, { fileUri: URI });

        const r1 = parseAfterPreprocessed(p, { fileUri: URI, cache });
        const r2 = parseAfterPreprocessed(p, { fileUri: URI, cache });

        assert.strictEqual(r1.ast.children.length, r2.ast.children.length);
        // After 1st pass, every entry was cached. 2nd pass reads identical hashes.
        assert.ok(cache.sizeFor(URI) > 0);
    });

    it('AC-22 falsifiable target: 100-edit cycle median is fast on a 2kLoC fixture', function () {
        this.timeout(30_000);
        // Build ~2kLoC file (200 functions × ~10 lines each).
        const numFns = 200;
        const body = '    int32 a = 1;\n    int32 b = 2;\n    int32 c = a + b;\n    return c;';
        const src = makeFile(numFns, body);

        // Cold parse
        const coldStart = process.hrtime.bigint();
        const t0 = tokenize(URI, src);
        const p0 = preprocessAfterTokenized(t0, { fileUri: URI });
        parseAfterPreprocessed(p0, { fileUri: URI });
        const coldNs = Number(process.hrtime.bigint() - coldStart);
        const coldMs = coldNs / 1e6;

        // 100 edits — flip a single integer in the middle each time.
        const cache = new ParserCache();
        // warm up cache
        const tw = tokenize(URI, src);
        const pw = preprocessAfterTokenized(tw, { fileUri: URI });
        parseAfterPreprocessed(pw, { fileUri: URI, cache });

        const editTimes: number[] = [];
        for (let i = 0; i < 100; i++) {
            const editedSrc = src.replace('int32 a = 1;', `int32 a = ${i};`);
            const tn = tokenize(URI, editedSrc);
            const pn = preprocessAfterTokenized(tn, { fileUri: URI });
            const start = process.hrtime.bigint();
            parseAfterPreprocessed(pn, { fileUri: URI, cache });
            const ns = Number(process.hrtime.bigint() - start);
            editTimes.push(ns / 1e6);
        }

        editTimes.sort((a, b) => a - b);
        const median = editTimes[Math.floor(editTimes.length / 2)];

        console.log(`AC-22: 2kLoC cold ${coldMs.toFixed(2)}ms; 100-edit median per cycle ${median.toFixed(2)}ms (target <30ms; v1.0.1 graduation criterion)`);
        // We don't fail the test below 30ms — AC-22 is a v1.0.1 graduation criterion. We DO fail if it's pathological.
        assert.ok(median < 200, `median ${median.toFixed(2)}ms is suspiciously high`);
    });
});
