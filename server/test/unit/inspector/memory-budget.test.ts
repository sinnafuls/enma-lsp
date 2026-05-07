// Phase 5 — §A8 memory-budget guardrails.
//
// Spec ceiling: per record < 5 MB / kLoC. Total: capped at maxClosedFiles
// records via LRU. Eviction zeroes the analyzer scope but keeps content/ast.

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { Inspector } from '../../../src/inspector/inspector';

function corpusFiles(): string[] {
    const corpusDir = path.resolve(__dirname, '../../../../.omc/corpus');
    if (!fs.existsSync(corpusDir)) return [];
    return fs.readdirSync(corpusDir)
        .filter(n => n.endsWith('.em'))
        .map(n => path.join(corpusDir, n));
}

function pathToUri(p: string): string {
    return `file:///${p.replace(/\\/g, '/')}`;
}

describe('Inspector — §A8 memory budget', () => {
    it('per-record bytes stays below 5 MB / kLoC for corpus files', () => {
        const files = corpusFiles().slice(0, 50);
        if (files.length === 0) {
            // Corpus not available — skip cleanly rather than fail.
            return;
        }
        const inspector = new Inspector();
        for (const f of files) {
            const content = fs.readFileSync(f, 'utf8');
            inspector.inspectFile(pathToUri(f), content, { isOpen: false });
        }

        const stats = inspector.getMemoryStats();
        for (const r of stats.perRecord) {
            const klocBudgetBytes = Math.max(1, r.loc) * 1024 * 5; // 5 MB / kLoC
            assert.ok(r.bytes < klocBudgetBytes,
                `${r.uri}: ${r.bytes} bytes for ${r.loc} LoC exceeds budget ${klocBudgetBytes}`);
        }
    });

    it('total memory after 50 corpus files indexed stays under 50 MB', () => {
        const files = corpusFiles().slice(0, 50);
        if (files.length === 0) return;
        const inspector = new Inspector();
        for (const f of files) {
            inspector.inspectFile(pathToUri(f), fs.readFileSync(f, 'utf8'), { isOpen: false });
        }
        const stats = inspector.getMemoryStats();
        assert.ok(stats.totalBytes < 50 * 1024 * 1024,
            `total bytes = ${stats.totalBytes} exceeds 50 MB sanity cap`);
        assert.equal(stats.recordCount, files.length);
    });

    it('eviction: 350 closed files drops record count to maxClosedFiles=300', () => {
        const inspector = new Inspector({ maxClosedFiles: 300 });
        // Hand-crafted small fixtures so the test runs in a few hundred ms.
        for (let i = 0; i < 350; i++) {
            const uri = `file:///fake/synthetic/file_${i}.em`;
            inspector.inspectFile(uri, `int32 v_${i} = ${i};`, { isOpen: false });
        }
        const stats = inspector.getMemoryStats();
        // After eviction the closed-record count must be exactly 300; no record is open here.
        const openCount = inspector.getAllRecords().filter(r => r.isOpen).length;
        const closedCount = inspector.getAllRecords().filter(r => !r.isOpen).length;
        assert.equal(openCount, 0);
        assert.equal(closedCount, 300,
            `expected 300 closed records after eviction; got ${closedCount} (total=${stats.recordCount})`);

        // Surviving records still have their content + AST + raw tokens.
        for (const r of inspector.getAllRecords()) {
            assert.ok(r.content.length > 0, `${r.uri} content retained`);
            assert.ok(r.rawTokens.length > 0, `${r.uri} tokens retained`);
        }
    });
});
