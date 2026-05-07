// Phase 5 — §A8 LRU eviction behaviour.

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';

import { Inspector } from '../../../src/inspector/inspector';

function uriFor(label: string, i: number): string {
    return `file:///fake/${label}_${i}.em`;
}

describe('Inspector — §A8 LRU', () => {
    it('open records are never evicted; only closed-file overflow is trimmed', () => {
        const inspector = new Inspector({ maxClosedFiles: 300 });
        // 100 open + 300 closed = 400 total; nothing is over the closed cap yet.
        for (let i = 0; i < 100; i++) {
            inspector.inspectFile(uriFor('open', i), `int32 v = ${i};`, { isOpen: true });
        }
        for (let i = 0; i < 300; i++) {
            inspector.inspectFile(uriFor('closed', i), `int32 v = ${i};`, { isOpen: false });
        }
        let total = inspector.getAllRecords().length;
        assert.equal(total, 400, 'all 400 retained at exactly the cap');

        // Add 50 more closed files → eviction trims 50 oldest closed.
        for (let i = 0; i < 50; i++) {
            inspector.inspectFile(uriFor('closed', 300 + i), `int32 v = ${i};`, { isOpen: false });
        }
        total = inspector.getAllRecords().length;
        const openCount = inspector.getAllRecords().filter(r => r.isOpen).length;
        const closedCount = inspector.getAllRecords().filter(r => !r.isOpen).length;
        assert.equal(openCount, 100, 'open files preserved');
        assert.equal(closedCount, 300, 'closed cap holds at 300 after overflow');
        assert.equal(total, 400);

        // The OLDEST closed records (indices 0..49) should be evicted entirely.
        for (let i = 0; i < 50; i++) {
            const r = inspector.getRecord(uriFor('closed', i));
            assert.equal(r, undefined, `closed_${i} evicted from index`);
        }
        // The newer closed records should still be present.
        for (let i = 50; i < 100; i++) {
            const r = inspector.getRecord(uriFor('closed', i));
            assert.ok(r, `closed_${i} retained`);
            assert.ok(r!.content.length > 0);
        }
    });

    it('reopening an evicted file triggers fresh re-analysis', () => {
        const inspector = new Inspector({ maxClosedFiles: 5 });
        // 10 closed → 5 evicted.
        for (let i = 0; i < 10; i++) {
            inspector.inspectFile(uriFor('e', i), `int32 v = ${i};`, { isOpen: false });
        }
        const closedCount = inspector.getAllRecords().filter(r => !r.isOpen).length;
        assert.equal(closedCount, 5);

        // Reopen the oldest (which should be evicted but still have content).
        const reopened = uriFor('e', 0);
        inspector.inspectFile(reopened, `int32 v = 0;`, { isOpen: true });
        inspector.flush(reopened);
        const r = inspector.getRecord(reopened)!;
        assert.equal(r.isAnalyzerPending, false, 'analyzer ran after reopen');
        assert.equal(r.isOpen, true);
    });

    it('aggressive maxClosedFiles=10 caps closed-record set at 10', () => {
        const inspector = new Inspector({ maxClosedFiles: 10 });
        for (let i = 0; i < 100; i++) {
            inspector.inspectFile(uriFor('a', i), `int32 v = ${i};`, { isOpen: false });
        }
        const closedCount = inspector.getAllRecords().filter(r => !r.isOpen).length;
        assert.equal(closedCount, 10, 'aggressive cap honoured');
    });
});
