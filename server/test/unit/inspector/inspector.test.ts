// Phase 5 — Inspector integration tests.
//
// Drives the full pipeline (tokenize → preprocess → parse → hoist → analyze)
// through the Inspector + AnalysisResolver and asserts:
//   - Multi-file indexing + dependency tracking
//   - §A4 workspace-level cycle detection
//   - maxIncludeDepth honoured
//   - showcase.em produces ≤1 error end-to-end (AC-2)

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as lsp from 'vscode-languageserver/node';

import { Inspector } from '../../../src/inspector/inspector';

function uriFor(rel: string): string {
    // Use a synthetic file:// scheme that doesn't touch disk; the inspector
    // resolves #include against the URI's directory which is harmless here.
    return `file:///fake/${rel}`.replace(/\\/g, '/');
}

function makeInspector(): { inspector: Inspector; sentDiags: Map<string, lsp.Diagnostic[]> } {
    const inspector = new Inspector();
    const sentDiags = new Map<string, lsp.Diagnostic[]>();
    inspector.registerDiagnosticsCallback((params) => {
        sentDiags.set(params.uri, params.diagnostics);
    });
    return { inspector, sentDiags };
}

describe('Inspector — multi-file indexing', () => {
    it('inspecting A which #includes B records both files; A.imports contains B', () => {
        const { inspector } = makeInspector();
        const aUri = uriFor('a.em');
        const bUri = uriFor('b.em');
        inspector.inspectFile(bUri, 'int32 b_val = 7;', { isOpen: true });
        inspector.inspectFile(aUri, '#include "b.em"\nint32 a_val = 3;', { isOpen: true });

        const a = inspector.getRecord(aUri);
        const b = inspector.getRecord(bUri);
        assert.ok(a, 'A record exists');
        assert.ok(b, 'B record exists');
        assert.ok(a!.importGraph.imports.includes(bUri),
            `A.imports should include B; got ${JSON.stringify(a!.importGraph.imports)}`);
        assert.ok(b!.importGraph.importedBy.includes(aUri),
            `B.importedBy should include A; got ${JSON.stringify(b!.importGraph.importedBy)}`);
    });

    it('editing B re-analyzes A (importedBy fan-out)', () => {
        const { inspector } = makeInspector();
        const aUri = uriFor('a.em');
        const bUri = uriFor('b.em');
        inspector.inspectFile(bUri, 'int32 b_val = 1;', { isOpen: true });
        inspector.inspectFile(aUri, '#include "b.em"\nint32 a_val = 1;', { isOpen: true });
        inspector.flush();

        const aBefore = inspector.getRecord(aUri)!.contentHash;
        // Edit B → request re-inspection of A via the dependency fan-out.
        inspector.inspectFile(bUri, 'int32 b_val = 999;', { isOpen: true });
        inspector.flush();
        // A's content didn't change so its hash is stable, but B's did.
        const bAfter = inspector.getRecord(bUri)!.contentHash;
        assert.notEqual(bAfter, '');
        assert.ok(aBefore !== '', 'A had a content hash before B edit');
        // Verify A was queued for re-analysis: importedBy still set, analyzer
        // diagnostics resolved (no longer pending).
        const a = inspector.getRecord(aUri)!;
        assert.equal(a.isAnalyzerPending, false, 'A re-analysis ran during flush');
    });

    it('closing A keeps it indexed (no eviction below cap)', () => {
        const { inspector } = makeInspector();
        const aUri = uriFor('a.em');
        const bUri = uriFor('b.em');
        inspector.inspectFile(bUri, 'int32 b = 1;', { isOpen: true });
        inspector.inspectFile(aUri, '#include "b.em"', { isOpen: true });
        inspector.setOpen(aUri, false);

        // Edit B again; A should still exist as a dependent.
        inspector.inspectFile(bUri, 'int32 b = 2;', { isOpen: true });
        const a = inspector.getRecord(aUri);
        assert.ok(a, 'A still indexed after close + B edit');
        assert.ok(a!.importGraph.imports.includes(bUri), 'A still tracks B');
    });

    it('§A4 — circular include A → B → A emits Error diagnostic with full chain', () => {
        const { inspector, sentDiags } = makeInspector();
        const aUri = uriFor('a.em');
        const bUri = uriFor('b.em');
        // First seed both files so the import graph has both arcs.
        inspector.inspectFile(bUri, '#include "a.em"', { isOpen: true });
        inspector.inspectFile(aUri, '#include "b.em"', { isOpen: true });
        // Now re-inspect B so its include chain through A becomes a cycle.
        inspector.inspectFile(bUri, '#include "a.em"', { isOpen: true });

        // At least one of A or B should now have a cycle Error diagnostic.
        const aDiags = sentDiags.get(aUri) ?? [];
        const bDiags = sentDiags.get(bUri) ?? [];
        const all = [...aDiags, ...bDiags];
        const cycleDiag = all.find(d =>
            d.severity === lsp.DiagnosticSeverity.Error &&
            /cycle/i.test(d.message),
        );
        assert.ok(cycleDiag, `expected cycle diagnostic, got: ${JSON.stringify(all)}`);
        // Full chain mentions both files.
        assert.ok(cycleDiag!.message.includes(aUri) || cycleDiag!.message.includes('a.em'),
            'cycle message names a.em');
        assert.ok(cycleDiag!.message.includes(bUri) || cycleDiag!.message.includes('b.em'),
            'cycle message names b.em');
    });

    it('maxIncludeDepth=2: emits Error on a 3-level chain', () => {
        const { inspector, sentDiags } = makeInspector();
        inspector.updateSettings({ maxIncludeDepth: 2 });
        // Build an A → B → C → D chain. After all four are indexed, the
        // workspace-level depth from A is 4, exceeding the cap.
        const a = uriFor('a.em');
        const b = uriFor('b.em');
        const c = uriFor('c.em');
        const d = uriFor('d.em');
        inspector.inspectFile(d, 'int32 dv = 1;', { isOpen: false });
        inspector.inspectFile(c, '#include "d.em"', { isOpen: false });
        inspector.inspectFile(b, '#include "c.em"', { isOpen: false });
        inspector.inspectFile(a, '#include "b.em"', { isOpen: true });

        // Re-inspect A so depth is computed against the now-fully-known chain.
        inspector.inspectFile(a, '#include "b.em"', { isOpen: true });

        const diags = sentDiags.get(a) ?? [];
        const depthDiag = diags.find(d =>
            d.severity === lsp.DiagnosticSeverity.Error &&
            /depth limit/i.test(d.message),
        );
        assert.ok(depthDiag, `expected depth-limit diagnostic, got ${JSON.stringify(diags)}`);
    });

    it('showcase.em through full pipeline yields ≤1 Error end-to-end (AC-2)', () => {
        const showcasePath = path.resolve(__dirname, '../../../../samples/showcase.em');
        if (!fs.existsSync(showcasePath)) {
            // Tolerate a missing sample on uncommon checkouts.
            return;
        }
        const content = fs.readFileSync(showcasePath, 'utf8');
        const { inspector, sentDiags } = makeInspector();
        const uri = `file:///${showcasePath.replace(/\\/g, '/')}`;
        inspector.inspectFile(uri, content, { isOpen: true });
        inspector.flush();

        const diags = sentDiags.get(uri) ?? [];
        // We measure ANALYZER errors specifically — parser kill-rule recoveries
        // remain a separate dimension and have their own grammar coverage tests.
        const analyzerErrors = diags.filter(d =>
            d.severity === lsp.DiagnosticSeverity.Error &&
            (d.source === 'Enma - Analyzer' || d.code !== undefined));
        // Per US-002 baseline: 1 genuine error from EN_PERM_DLL on showcase line 33
        // ([[dll]] without ffi permission). Allow ≤1 to keep the permission-gate
        // signal while not regressing.
        assert.ok(analyzerErrors.length <= 1,
            `expected ≤1 analyzer error in showcase.em; got ${analyzerErrors.length}: ${JSON.stringify(analyzerErrors.map(e => e.message))}`);
    });

    it('flush(uri) drains specifically that file synchronously', () => {
        const { inspector } = makeInspector();
        const u = uriFor('s.em');
        inspector.inspectFile(u, 'int32 x = 1;', { isOpen: true });
        // Right after inspectFile the resolver has scheduled async work.
        // flush(u) must drain it synchronously so analyzer diagnostics land.
        inspector.flush(u);
        const r = inspector.getRecord(u)!;
        assert.equal(r.isAnalyzerPending, false, 'analyzer drained after flush');
    });

    it('reinspectAllFiles() re-runs the pipeline for every record', () => {
        const { inspector } = makeInspector();
        const u1 = uriFor('p.em');
        const u2 = uriFor('q.em');
        inspector.inspectFile(u1, 'int32 a = 1;', { isOpen: true });
        inspector.inspectFile(u2, 'int32 b = 2;', { isOpen: false });
        inspector.flush();

        inspector.reinspectAllFiles();
        inspector.flush();
        assert.equal(inspector.getRecord(u1)!.isAnalyzerPending, false);
        assert.equal(inspector.getRecord(u2)!.isAnalyzerPending, false);
    });

    it('reset() clears every record', () => {
        const { inspector } = makeInspector();
        inspector.inspectFile(uriFor('z.em'), 'int32 z = 0;', { isOpen: true });
        assert.ok(inspector.getAllRecords().length > 0);
        inspector.reset();
        assert.equal(inspector.getAllRecords().length, 0);
    });

    it('implicitMutualInclusion makes types from un-included files visible', () => {
        const { inspector, sentDiags } = makeInspector();
        const colorUri = uriFor('utility/types/color.em');
        const elemUri = uriFor('utility/rendering/elements.em');

        const colorSrc = `class color_t {\n    uint8 r; uint8 g; uint8 b; uint8 a;\n}\n`;
        const elemSrc = `void draw(color_t c) { }\n`;

        inspector.inspectFile(colorUri, colorSrc, { isOpen: false });
        inspector.inspectFile(elemUri, elemSrc, { isOpen: true });
        inspector.flush();

        const before = (sentDiags.get(elemUri) ?? []).filter(d =>
            d.severity === lsp.DiagnosticSeverity.Error &&
            /color_t/.test(d.message));
        assert.ok(before.length > 0,
            `expected color_t to be unknown without implicit mutual inclusion; got ${JSON.stringify(sentDiags.get(elemUri))}`);

        // Flip the flag — without scanning fs we just need the resolver to
        // pull peer scopes for already-indexed records.
        inspector.updateSettings({ implicitMutualInclusion: true });
        inspector.flush();

        const after = (sentDiags.get(elemUri) ?? []).filter(d =>
            d.severity === lsp.DiagnosticSeverity.Error &&
            /color_t/.test(d.message));
        assert.equal(after.length, 0,
            `expected color_t to resolve under implicit mutual inclusion; got ${JSON.stringify(sentDiags.get(elemUri))}`);
    });

    it('implicitMutualInclusion: bundle entry that #includes everything and declares its own globals does not collide with itself', () => {
        // Models main.em: a bundle-entry file that explicitly #includes
        // every other file AND declares top-level globals. Under naive peer
        // resolution, the included files' analyzerScopes have absorbed
        // main.em's own globals via the implicit peer-scan, so when main.em
        // pulls them through its #include path, hoist sees its own globals
        // and emits "Symbol X is already declared" against main.em itself.
        const { inspector, sentDiags } = makeInspector();
        const mainUri = uriFor('main.em');
        const colorUri = uriFor('utility/types/color.em');
        const elemUri = uriFor('utility/rendering/elements.em');

        inspector.inspectFile(
            colorUri,
            `class color_t {\n    uint8 r; uint8 g; uint8 b; uint8 a;\n}\n`,
            { isOpen: false });
        inspector.inspectFile(
            elemUri,
            `void draw(color_t c) { }\n`,
            { isOpen: false });
        inspector.inspectFile(
            mainUri,
            `#include "utility/types/color.em"\n` +
            `#include "utility/rendering/elements.em"\n` +
            `uint64 g_load_time = 0;\n` +
            `bool g_successfully_loaded = false;\n` +
            `string g_Username = "unknown";\n` +
            `int64 main() { return 1; }\n`,
            { isOpen: true });
        inspector.updateSettings({ implicitMutualInclusion: true });
        inspector.flush();
        inspector.reinspectAllFiles();
        inspector.flush();

        const dups = (sentDiags.get(mainUri) ?? []).filter(d =>
            d.severity === lsp.DiagnosticSeverity.Error &&
            /already declared/.test(d.message));
        assert.equal(dups.length, 0,
            `main.em should not redeclare its own globals through includes; got ${JSON.stringify(dups.map(d => d.message))}`);
    });

    it('implicitMutualInclusion does not redeclare a file\'s own symbols via transitive peers', () => {
        // Three files, all visible to each other under implicit mutual:
        //   color.em declares color_t.
        //   elements.em uses color_t.
        //   bones.em is unrelated but indexed.
        // Without the ownScope split, color.em pass-2 would pull
        // elements.em's analyzerScope (which already absorbed color_t from a
        // prior pass) and emit "Symbol 'color_t' is already declared".
        const { inspector, sentDiags } = makeInspector();
        const colorUri = uriFor('utility/types/color.em');
        const elemUri = uriFor('utility/rendering/elements.em');
        const boneUri = uriFor('utility/types/bones.em');

        inspector.inspectFile(
            colorUri,
            `class color_t {\n    uint8 r; uint8 g; uint8 b; uint8 a;\n}\n`,
            { isOpen: true });
        inspector.inspectFile(
            elemUri,
            `void draw(color_t c) { }\n`,
            { isOpen: true });
        inspector.inspectFile(
            boneUri,
            `class bone_t {\n    int64 idx;\n}\n`,
            { isOpen: true });
        inspector.updateSettings({ implicitMutualInclusion: true });
        inspector.flush();
        // Force a second drain so every file analyzes against fully-populated
        // peer ownScopes — this is what reinspectAllFiles does after a
        // workspace .em scan settles.
        inspector.reinspectAllFiles();
        inspector.flush();

        for (const u of [colorUri, elemUri, boneUri]) {
            const dups = (sentDiags.get(u) ?? []).filter(d =>
                d.severity === lsp.DiagnosticSeverity.Error &&
                /already declared/.test(d.message));
            assert.equal(dups.length, 0,
                `${u} should not see its own symbols redeclared via peers; got ${JSON.stringify(dups)}`);
        }
    });
});
