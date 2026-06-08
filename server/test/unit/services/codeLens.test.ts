// Tests for the codeLens provider.

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { Inspector } from '../../../src/inspector/inspector';
import { provideCodeLens } from '../../../src/services/codeLens';

function astFor(src: string) {
    const inspector = new Inspector();
    const uri = 'file:///fake/test.em';
    inspector.inspectFile(uri, src, { isOpen: true });
    inspector.flush();
    return { ast: inspector.getRecord(uri)!.ast, uri };
}

describe('service: provideCodeLens', () => {
    it('emits a Bundle lens at line 0', () => {
        const { ast, uri } = astFor('int32 main() { return 0; }');
        const lenses = provideCodeLens(ast, uri);
        const bundle = lenses.find((l) => l.command?.command === 'enma.bundle');
        assert.ok(bundle, 'Bundle lens emitted');
        assert.equal(bundle!.range.start.line, 0);
    });

    it('emits Run lens for each top-level function', () => {
        const src = [
            'int32 helper() { return 1; }',
            'int32 main() { return helper(); }',
        ].join('\n');
        const { ast, uri } = astFor(src);
        const lenses = provideCodeLens(ast, uri);
        const runLenses = lenses.filter((l) => l.command?.command === 'enma.runScript');
        assert.equal(runLenses.length, 2, `expected 2 run lenses, got ${runLenses.length}`);
    });

    it('emits no Run lens for non-function top-level declarations', () => {
        const { ast, uri } = astFor('int32 g_counter = 0;');
        const lenses = provideCodeLens(ast, uri);
        const runLenses = lenses.filter((l) => l.command?.command === 'enma.runScript');
        assert.equal(runLenses.length, 0);
    });
});
