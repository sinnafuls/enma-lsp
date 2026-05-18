process.env.ENMA_LSP_TEST = '1';

import * as assert from 'node:assert/strict';
import { buildFixture } from './_helpers';
import { provideSemanticTokens, semanticTokensLegend } from '../../../src/services/semanticTokens';

const URI = 'file:///ann.em';

const DECORATOR_INDEX = semanticTokensLegend.tokenTypes.indexOf('decorator');

interface DecodedToken {
    line: number;
    char: number;
    length: number;
    typeIndex: number;
    modIndex: number;
}

function decode(data: ReadonlyArray<number>): DecodedToken[] {
    const out: DecodedToken[] = [];
    let line = 0;
    let char = 0;
    for (let i = 0; i < data.length; i += 5) {
        const deltaLine = data[i];
        const deltaChar = data[i + 1];
        const length    = data[i + 2];
        const typeIndex = data[i + 3];
        const modIndex  = data[i + 4];
        line = line + deltaLine;
        char = deltaLine === 0 ? char + deltaChar : deltaChar;
        out.push({ line, char, length, typeIndex, modIndex });
    }
    return out;
}

describe('semanticTokens — [[…]] annotations', () => {
    it('legend exposes the decorator token type', () => {
        assert.notEqual(DECORATOR_INDEX, -1, 'decorator missing from legend');
    });

    it('[[packed]] struct emits decorator tokens for brackets + name', () => {
        const f = buildFixture(URI, '[[packed]] struct S { int32 a; int32 b; }\n');
        const r = provideSemanticTokens(f.analyzerScope.globalScope, f.rawTokens);
        const tokens = decode(r.data);
        const decorators = tokens.filter(t => t.typeIndex === DECORATOR_INDEX);
        // 1 open bracket `[[`, 1 name `packed`, 1 close bracket `]]` ⇒ 3 decorator tokens.
        assert.equal(decorators.length, 3, `expected 3 decorator tokens, got ${decorators.length}`);
    });

    it('[[dll("name")]] void f(); paints brackets + identifier as decorator', () => {
        const f = buildFixture(URI, '[[dll("user32.dll")]] void MessageBox(int32 h);\n');
        const r = provideSemanticTokens(f.analyzerScope.globalScope, f.rawTokens);
        const tokens = decode(r.data);
        const decorators = tokens.filter(t => t.typeIndex === DECORATOR_INDEX);
        assert.ok(decorators.length >= 3, `expected at least 3 decorator tokens (brackets + name), got ${decorators.length}`);
        // The string argument "user32.dll" must NOT be classified as decorator —
        // semanticTokens leaves literals to the grammar / token colour rules.
    });
});
