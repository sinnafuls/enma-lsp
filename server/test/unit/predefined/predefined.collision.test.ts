// AC-21 collision diagnostic tests.
//
// When a workspace .em.predefined redeclares a bundled symbol, the
// higher-precedence (workspace) declaration wins and a Warning is emitted at
// the workspace declaration site naming the bundled origin.

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { loadPredefinedFile, mergePredefinedIntoScope, PredefinedRecord } from '../../../src/inspector/predefinedLoader';
import { SymbolGlobalScope } from '../../../src/compiler_analyzer/symbolScope';
import { registerEnmaTypes } from '../../../src/compiler_analyzer/enmaTypes';

function makeGlobal(): SymbolGlobalScope {
    const g = new SymbolGlobalScope('file:///test.em');
    registerEnmaTypes(g, { skipStdlib: true });
    return g;
}

function makePredefinedRecord(content: string, origin: 'bundled' | 'forceInclude' | 'workspace'): PredefinedRecord {
    const tmpFile = path.join(os.tmpdir(), `enma-test-${Date.now()}-${Math.random().toString(36).slice(2)}.em.predefined`);
    fs.writeFileSync(tmpFile, content, 'utf8');
    try {
        const rec = loadPredefinedFile(tmpFile, origin);
        if (!rec) throw new Error(`Failed to load predefined file: ${tmpFile}`);
        return rec;
    } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}

describe('Predefined collision diagnostics (AC-21)', () => {
    it('workspace redeclaring a bundled symbol emits Warning at workspace site', () => {
        // Simulate: bundled declares coroutine_t; workspace also declares coroutine_t.
        const bundledRec = makePredefinedRecord(
            `class coroutine_t {\n    int64 next();\n}\n`,
            'bundled',
        );
        const workspaceRec = makePredefinedRecord(
            `class coroutine_t {\n    int64 next();\n    int64 extra();\n}\n`,
            'workspace',
        );

        const target = makeGlobal();
        const diags = mergePredefinedIntoScope(target, [bundledRec, workspaceRec]);

        const collisionDiags = diags.filter(d => d.code === 'EN_PRED_COLLISION');
        assert.ok(collisionDiags.length > 0,
            `expected at least one EN_PRED_COLLISION warning, got: ${JSON.stringify(diags)}`);
        assert.ok(
            collisionDiags.some(d => (d.message as string).includes('bundled')),
            `collision warning should name the bundled origin; got: ${JSON.stringify(collisionDiags.map(d => d.message))}`,
        );
    });

    it('forceInclude redeclaring a bundled symbol emits Warning naming bundled origin', () => {
        const bundledRec = makePredefinedRecord(
            `class variant {\n    int64 type();\n}\n`,
            'bundled',
        );
        const forceRec = makePredefinedRecord(
            `class variant {\n    int64 type();\n    bool is_custom();\n}\n`,
            'forceInclude',
        );

        const target = makeGlobal();
        const diags = mergePredefinedIntoScope(target, [bundledRec, forceRec]);

        const collisionDiags = diags.filter(d => d.code === 'EN_PRED_COLLISION');
        assert.ok(collisionDiags.length > 0, 'expected collision warning for forceInclude vs bundled');
        assert.ok(
            collisionDiags.some(d => (d.message as string).includes('bundled')),
            'warning should name bundled origin',
        );
    });

    it('no collision when symbol is declared only in one origin', () => {
        const bundledRec = makePredefinedRecord(
            `class unique_bundled_type {\n    int64 do_thing();\n}\n`,
            'bundled',
        );
        const workspaceRec = makePredefinedRecord(
            `class different_workspace_type {\n    bool check();\n}\n`,
            'workspace',
        );

        const target = makeGlobal();
        const diags = mergePredefinedIntoScope(target, [bundledRec, workspaceRec]);

        const collisionDiags = diags.filter(d => d.code === 'EN_PRED_COLLISION');
        assert.equal(collisionDiags.length, 0,
            `expected no collision warnings, got: ${JSON.stringify(collisionDiags)}`);
    });
});
