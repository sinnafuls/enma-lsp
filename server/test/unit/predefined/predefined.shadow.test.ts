// AC-21b shadow suppression tests.
//
// When the higher-precedence declaration carries [[shadow]], the collision
// Warning is suppressed. Without [[shadow]], the warning fires.

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
    const tmpFile = path.join(os.tmpdir(), `enma-shadow-test-${Date.now()}-${Math.random().toString(36).slice(2)}.em.predefined`);
    fs.writeFileSync(tmpFile, content, 'utf8');
    try {
        const rec = loadPredefinedFile(tmpFile, origin);
        if (!rec) throw new Error(`Failed to load predefined file: ${tmpFile}`);
        return rec;
    } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}

describe('Predefined [[shadow]] suppression (AC-21b)', () => {
    it('workspace decl with [[shadow]] suppresses the AC-21 collision warning', () => {
        // Bundled declares shadow_test_type; workspace shadows it WITH [[shadow]]
        const bundledRec = makePredefinedRecord(
            `class shadow_test_type {\n    int64 value();\n}\n`,
            'bundled',
        );
        // [[shadow]] annotation on the workspace class suppresses the warning
        const workspaceRec = makePredefinedRecord(
            `[[shadow]] class shadow_test_type {\n    int64 value();\n    int64 extra();\n}\n`,
            'workspace',
        );

        const target = makeGlobal();
        const diags = mergePredefinedIntoScope(target, [bundledRec, workspaceRec]);

        const collisionDiags = diags.filter(d => d.code === 'EN_PRED_COLLISION');
        assert.equal(collisionDiags.length, 0,
            `[[shadow]] should suppress collision warning; got: ${JSON.stringify(collisionDiags)}`);
    });

    it('workspace decl WITHOUT [[shadow]] still emits AC-21 collision warning', () => {
        // Bundled declares noshadow_type; workspace redeclares it without [[shadow]]
        const bundledRec = makePredefinedRecord(
            `class noshadow_type {\n    int64 value();\n}\n`,
            'bundled',
        );
        const workspaceRec = makePredefinedRecord(
            `class noshadow_type {\n    int64 value();\n    int64 extra();\n}\n`,
            'workspace',
        );

        const target = makeGlobal();
        const diags = mergePredefinedIntoScope(target, [bundledRec, workspaceRec]);

        const collisionDiags = diags.filter(d => d.code === 'EN_PRED_COLLISION');
        assert.ok(collisionDiags.length > 0,
            `without [[shadow]], collision warning should fire; got: ${JSON.stringify(diags)}`);
    });
});
