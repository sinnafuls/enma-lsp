process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { tokenize } from '../../../src/compiler_tokenizer/tokenizer';
import { preprocessAfterTokenized } from '../../../src/compiler_parser/parserPreprocess';
import { parseAfterPreprocessed } from '../../../src/compiler_parser/parser';
import { analyzerDiagnostic } from '../../../src/compiler_analyzer/analyzerDiagnostic';
import { runEscapeAndConstCheck, CODE_CONST_WRITE, CODE_STACK_ESCAPE } from '../../../src/compiler_analyzer/escapeAndConstCheck';

const URI = 'file:///esc.em';

function diagnose(src: string) {
    const tokens = tokenize(URI, src);
    const pre = preprocessAfterTokenized(tokens, { fileUri: URI });
    const parsed = parseAfterPreprocessed(pre, { fileUri: URI });
    analyzerDiagnostic.beginSession();
    runEscapeAndConstCheck(URI, parsed.ast);
    return analyzerDiagnostic.endSession();
}

describe('escapeAndConstCheck', () => {
    it('warns on assignment to a const local (EN_CONST_WRITE)', () => {
        const diags = diagnose(`
            void f() {
                const int32 x = 1;
                x = 2;
            }
        `);
        const hit = diags.find(d => d.code === CODE_CONST_WRITE);
        assert.ok(hit, 'expected EN_CONST_WRITE');
        assert.equal(hit.severity, 'warning');
    });

    it('warns on return &local (EN_STACK_ESCAPE)', () => {
        const diags = diagnose(`
            int32 f() {
                int32 x = 1;
                return &x;
            }
        `);
        const hit = diags.find(d => d.code === CODE_STACK_ESCAPE);
        assert.ok(hit, 'expected EN_STACK_ESCAPE on return &x');
    });

    it('warns when &local is stored into a global (EN_STACK_ESCAPE)', () => {
        const diags = diagnose(`
            int32* g_ptr;
            void f() {
                int32 x = 1;
                g_ptr = &x;
            }
        `);
        const hit = diags.find(d => d.code === CODE_STACK_ESCAPE);
        assert.ok(hit, 'expected EN_STACK_ESCAPE on global = &local');
    });

    it('does NOT warn when &local is stored into another local of the same function', () => {
        const diags = diagnose(`
            void f() {
                int32 x = 1;
                int32* p = &x;
            }
        `);
        const hit = diags.find(d => d.code === CODE_STACK_ESCAPE);
        assert.equal(hit, undefined, 'should not warn on intra-frame &local');
    });

    it('does NOT warn when a non-const local is reassigned', () => {
        const diags = diagnose(`
            void f() {
                int32 x = 1;
                x = 2;
            }
        `);
        const hit = diags.find(d => d.code === CODE_CONST_WRITE);
        assert.equal(hit, undefined, 'non-const reassignment must not warn');
    });

    it('warns once per assignment, not once per appearance', () => {
        const diags = diagnose(`
            void f() {
                const int32 x = 1;
                x = 2;
                x = 3;
            }
        `);
        const hits = diags.filter(d => d.code === CODE_CONST_WRITE);
        assert.equal(hits.length, 2, 'one warning per assignment statement');
    });

    it('walks into nested blocks and reports escape from inner scope', () => {
        const diags = diagnose(`
            int32* g;
            void f() {
                if (true) {
                    int32 x = 1;
                    g = &x;
                }
            }
        `);
        const hit = diags.find(d => d.code === CODE_STACK_ESCAPE);
        assert.ok(hit, 'must detect escape from inner block');
    });
});
