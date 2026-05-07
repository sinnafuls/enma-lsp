// §A9 CI parser-validation tests for the generated predefined file.
//
// AC-23: the generated enma-stdlib.em.predefined must parse with 0 diagnostics.
//
// These tests read the pre-generated file from disk. If it doesn't exist,
// the test is skipped gracefully (CI must run `npm run regenerate-stdlib` first,
// which happens via `npm run validate-predefined`).

process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { parseAfterPreprocessed } from '../../../src/compiler_parser/parser';

const PREDEFINED_PATH = path.resolve(
    __dirname, '..', '..', '..', 'src', 'predefined', 'enma-stdlib.em.predefined'
);

function loadGeneratedPredefined(): string | undefined {
    try {
        return fs.readFileSync(PREDEFINED_PATH, 'utf8');
    } catch {
        return undefined;
    }
}

describe('Regenerated stdlib predefined (AC-23)', () => {
    it('generated enma-stdlib.em.predefined parses with 0 diagnostics', () => {
        const src = loadGeneratedPredefined();
        if (src === undefined) {
            // File doesn't exist yet — skip gracefully.
            console.warn('SKIP: enma-stdlib.em.predefined not found; run npm run regenerate-stdlib');
            return;
        }

        const uri = 'file:///enma-stdlib.em.predefined';
        const tokens = tokenize(uri, src);
        const pre = preprocessAfterTokenized(tokens, { fileUri: uri });
        const parsed = parseAfterPreprocessed(pre, { fileUri: uri });
        const allDiags = [...pre.diagnostics, ...parsed.diagnostics];

        assert.equal(
            allDiags.length,
            0,
            `Expected 0 parser diagnostics on generated predefined, got ${allDiags.length}:\n` +
            allDiags.slice(0, 10).map(d => `  ${d.severity} L${d.location.start.line + 1}: ${d.message}`).join('\n'),
        );
    });

    it('generated file declares expected stdlib entries (smoke check)', () => {
        const src = loadGeneratedPredefined();
        if (src === undefined) {
            console.warn('SKIP: enma-stdlib.em.predefined not found; run npm run regenerate-stdlib');
            return;
        }

        // Smoke-check that key names appear in the output.
        const expected = ['coroutine_t', 'variant', 'array', 'println', 'map', 'mutex'];
        for (const name of expected) {
            assert.ok(
                src.includes(name),
                `Generated predefined should contain '${name}'`,
            );
        }

        // Check it uses `class` keyword (not `type`)
        assert.ok(
            src.includes('class coroutine_t'),
            'Should use `class` keyword for type declarations',
        );
        assert.ok(
            !src.includes('\ntype coroutine_t'),
            'Should NOT use `type` keyword',
        );
    });
});
