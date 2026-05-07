// Bug-2 regression: predefined files in the workspace must auto-load when the
// inspector receives `setWorkspaceRoot(uri)`. Without that wire, real Enma
// projects with `*.em.predefined` next to source files show "Unknown type"
// for everything declared in the predefined.

process.env.ENMA_LSP_TEST = '1';

import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Inspector } from '../../../src/inspector/inspector';

function makeFixtureDir(): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'enma-pred-'));
    return base;
}

function rmrf(p: string): void {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
}

describe('workspace predefined auto-load (Bug 2)', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = makeFixtureDir();
    });

    afterEach(() => {
        rmrf(tmpDir);
    });

    it('after setWorkspaceRoot(dir/) where dir/some.em.predefined declares host_t, host_t resolves', () => {
        const predPath = path.join(tmpDir, 'some.em.predefined');
        fs.writeFileSync(predPath, `class host_t { int32 id; };\n`, 'utf8');

        const inspector = new Inspector();
        const rootUri = 'file:///' + tmpDir.replace(/\\/g, '/');
        inspector.setWorkspaceRoot(rootUri);

        const records = inspector.getPredefinedRecords();
        const workspaceRecs = records.filter(r => r.origin === 'workspace');
        assert.equal(workspaceRecs.length, 1, 'expected exactly one workspace predefined record');
        assert.ok(
            workspaceRecs[0].globalScope.symbolTable.has('host_t'),
            'expected host_t to be present in the loaded predefined scope',
        );

        // And host_t becomes resolvable in a subsequent inspectFile call.
        const fileUri = 'file:///' + path.join(tmpDir, 'main.em').replace(/\\/g, '/');
        inspector.inspectFile(fileUri, `host_t g_proc;\n`, { isOpen: true });
        inspector.flush(fileUri);

        const rec = inspector.getRecord(fileUri);
        assert.ok(rec, 'inspect record should exist');
        const unknownTypeErrs = rec!.diagnosticsInAnalyzer
            .filter(d => /Unknown type/i.test(d.message));
        assert.equal(
            unknownTypeErrs.length, 0,
            `host_t should resolve, but got: ${unknownTypeErrs.map(d => d.message).join(' | ')}`,
        );
    });

    it('without setWorkspaceRoot, predefined is not loaded (current fallback behavior preserved)', () => {
        const predPath = path.join(tmpDir, 'some.em.predefined');
        fs.writeFileSync(predPath, `class host_t { int32 id; };\n`, 'utf8');

        const inspector = new Inspector();
        // Intentionally NOT calling setWorkspaceRoot.

        const records = inspector.getPredefinedRecords();
        const workspaceRecs = records.filter(r => r.origin === 'workspace');
        assert.equal(workspaceRecs.length, 0, 'no workspace predefined should be loaded');
    });
});
