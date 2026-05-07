import * as assert from 'node:assert/strict';
import { analyzerDiagnostic } from '../../../src/compiler_analyzer/analyzerDiagnostic';
import { analyzeFString } from '../../../src/compiler_analyzer/fStringExpr';
import { ResolvedType } from '../../../src/compiler_analyzer/resolvedType';
import { builtinInt32 } from '../../../src/compiler_analyzer/builtinType';
import {
    NodeExprFString,
    NodeKind,
    NodeFStringPart,
} from '../../../src/compiler_parser/nodes';
import { TokenKind, TokenFStringText, TokenIdentifier } from '../../../src/compiler_tokenizer/tokenObject';

const LOC = { uri: 'file:///t.em', start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
const RANGE = { start: LOC.start, end: LOC.end };
function ident(text: string): TokenIdentifier {
    return { kind: TokenKind.Identifier, text, location: LOC };
}
const text: TokenFStringText = { kind: TokenKind.FStringText, text: 'hi ', location: LOC };

function fs(parts: NodeFStringPart[]): NodeExprFString {
    return { kind: NodeKind.ExprFString, range: RANGE, parts };
}

describe('fStringExpr', () => {
    beforeEach(() => analyzerDiagnostic.beginSession());

    it('analyzes each expr part via the provided dispatcher', () => {
        let calls = 0;
        analyzeFString(
            fs([
                { kind: 'text', token: text },
                { kind: 'expr', expr: { kind: NodeKind.ExprIdentifier, range: RANGE, token: ident('x') }, openRange: RANGE, closeRange: RANGE },
                { kind: 'text', token: text },
            ]),
            () => { calls++; return new ResolvedType(builtinInt32); },
        );
        analyzerDiagnostic.endSession();
        assert.equal(calls, 1);
    });

    it('warns when interpolated expr has no resolved type', () => {
        analyzeFString(
            fs([
                { kind: 'expr', expr: { kind: NodeKind.ExprIdentifier, range: RANGE, token: ident('undef') }, openRange: RANGE, closeRange: RANGE },
            ]),
            () => undefined,
        );
        const diags = analyzerDiagnostic.endSession();
        assert.ok(diags.some(d => d.code === 'EN_FSTRING_UNKNOWN_TYPE'));
    });

    it('is silent when all interpolations resolve', () => {
        analyzeFString(
            fs([
                { kind: 'expr', expr: { kind: NodeKind.ExprIdentifier, range: RANGE, token: ident('x') }, openRange: RANGE, closeRange: RANGE },
                { kind: 'expr', expr: { kind: NodeKind.ExprIdentifier, range: RANGE, token: ident('y') }, openRange: RANGE, closeRange: RANGE },
            ]),
            () => new ResolvedType(builtinInt32),
        );
        const diags = analyzerDiagnostic.endSession();
        assert.equal(diags.length, 0);
    });

    it('skips text-only f-strings', () => {
        analyzeFString(
            fs([{ kind: 'text', token: text }]),
            () => undefined,
        );
        const diags = analyzerDiagnostic.endSession();
        assert.equal(diags.length, 0);
    });
});
