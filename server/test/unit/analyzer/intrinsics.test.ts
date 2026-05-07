import * as assert from 'node:assert/strict';
import { analyzerDiagnostic } from '../../../src/compiler_analyzer/analyzerDiagnostic';
import { analyzeIntrinsic, isKnownIntrinsic } from '../../../src/compiler_analyzer/intrinsics';
import { NodeExprIntrinsic, NodeKind } from '../../../src/compiler_parser/nodes';
import { TokenIdentifier, TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

const LOC = { uri: 'file:///t.em', start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
const RANGE = { start: LOC.start, end: LOC.end };

function makeIntrinsic(text: string, hasParens: boolean, args: NodeExprIntrinsic['args'] = []): NodeExprIntrinsic {
    const tok: TokenIdentifier = { kind: TokenKind.Identifier, text, location: LOC };
    return { kind: NodeKind.ExprIntrinsic, range: RANGE, name: tok, args, hasParens };
}

describe('intrinsics', () => {
    beforeEach(() => analyzerDiagnostic.beginSession());

    it('types __va_count (no parens) as int64', () => {
        const t = analyzeIntrinsic(makeIntrinsic('__va_count', false));
        analyzerDiagnostic.endSession();
        assert.ok(t);
        assert.equal(t!.identifierText, 'int64');
    });

    it('types __va_arg(i) as int64', () => {
        const intArg = { kind: NodeKind.ExprLiteralInt as const, range: RANGE, token: { kind: TokenKind.Number as const, text: '0', location: LOC, numericKind: 'int' as const } };
        const t = analyzeIntrinsic(makeIntrinsic('__va_arg', true, [intArg]));
        analyzerDiagnostic.endSession();
        assert.ok(t);
        assert.equal(t!.identifierText, 'int64');
    });

    it('types __asm_pause() as void', () => {
        const t = analyzeIntrinsic(makeIntrinsic('__asm_pause', true));
        analyzerDiagnostic.endSession();
        assert.ok(t);
        assert.equal(t!.identifierText, 'void');
    });

    it('flags arity mismatch', () => {
        analyzeIntrinsic(makeIntrinsic('__asm_pause', true, [
            { kind: NodeKind.ExprLiteralInt as const, range: RANGE, token: { kind: TokenKind.Number as const, text: '1', location: LOC, numericKind: 'int' as const } },
        ]));
        const diags = analyzerDiagnostic.endSession();
        assert.ok(diags.some(d => d.code === 'EN_INTR_ARITY'));
    });

    it('flags missing parens for parens-required intrinsic', () => {
        analyzeIntrinsic(makeIntrinsic('__asm_rdtsc', false));
        const diags = analyzerDiagnostic.endSession();
        assert.ok(diags.some(d => d.code === 'EN_INTR_PARENS_MISSING'));
    });

    it('flags unexpected parens for __va_count', () => {
        analyzeIntrinsic(makeIntrinsic('__va_count', true));
        const diags = analyzerDiagnostic.endSession();
        assert.ok(diags.some(d => d.code === 'EN_INTR_PARENS_UNEXPECTED'));
    });

    it('isKnownIntrinsic returns false for unknown names', () => {
        assert.ok(!isKnownIntrinsic('__not_a_real_intrinsic'));
        assert.ok(isKnownIntrinsic('__asm_mfence'));
    });
});
