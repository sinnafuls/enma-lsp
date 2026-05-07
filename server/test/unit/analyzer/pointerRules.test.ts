import * as assert from 'node:assert/strict';
import { analyzerDiagnostic } from '../../../src/compiler_analyzer/analyzerDiagnostic';
import { setAnalyzerSeverity } from '../../../src/compiler_analyzer/analyzerDiagnostic';
import {
    checkMemberDotAccess,
    checkMemberArrowAccess,
} from '../../../src/compiler_analyzer/pointerRules';
import { ResolvedType } from '../../../src/compiler_analyzer/resolvedType';
import { builtinInt32 } from '../../../src/compiler_analyzer/builtinType';
import { NodeKind, NodeExprMemberDot, NodeExprMemberArrow } from '../../../src/compiler_parser/nodes';
import { TokenIdentifier, TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

const LOC = { uri: 'file:///t.em', start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
const RANGE = { start: LOC.start, end: LOC.end };
const memberTok: TokenIdentifier = { kind: TokenKind.Identifier, text: 'x', location: LOC };

const dotNode: NodeExprMemberDot = {
    kind: NodeKind.ExprMemberDot,
    range: RANGE,
    object: { kind: NodeKind.ExprIdentifier, range: RANGE, token: memberTok },
    member: memberTok,
};
const arrowNode: NodeExprMemberArrow = {
    kind: NodeKind.ExprMemberArrow,
    range: RANGE,
    object: { kind: NodeKind.ExprIdentifier, range: RANGE, token: memberTok },
    member: memberTok,
};

describe('pointerRules (AC-7)', () => {
    beforeEach(() => {
        setAnalyzerSeverity('error');
        analyzerDiagnostic.beginSession();
    });

    it("emits errorForce for '.' on a pointer receiver", () => {
        const ptrType = new ResolvedType(builtinInt32, /*pointerLevel*/ 1);
        const ok = checkMemberDotAccess(dotNode, ptrType);
        const diags = analyzerDiagnostic.endSession();
        assert.equal(ok, false);
        assert.equal(diags.length, 1);
        assert.equal(diags[0].severity, 'error');
        assert.equal(diags[0].code, 'EN_PTR_DOT_ON_POINTER');
    });

    it("emits errorForce for '->' on a value receiver", () => {
        const valType = new ResolvedType(builtinInt32, 0);
        const ok = checkMemberArrowAccess(arrowNode, valType);
        const diags = analyzerDiagnostic.endSession();
        assert.equal(ok, false);
        assert.equal(diags.length, 1);
        assert.equal(diags[0].severity, 'error');
        assert.equal(diags[0].code, 'EN_PTR_ARROW_ON_VALUE');
    });

    it('emits 0 diagnostics on correct usage', () => {
        const valType = new ResolvedType(builtinInt32, 0);
        const ptrType = new ResolvedType(builtinInt32, 1);
        const ok1 = checkMemberDotAccess(dotNode, valType);
        const ok2 = checkMemberArrowAccess(arrowNode, ptrType);
        const diags = analyzerDiagnostic.endSession();
        assert.equal(ok1, true);
        assert.equal(ok2, true);
        assert.equal(diags.length, 0);
    });

    it('STAYS Error under R21 rollback severity=warning', () => {
        setAnalyzerSeverity('warning');
        const ptrType = new ResolvedType(builtinInt32, 1);
        checkMemberDotAccess(dotNode, ptrType);
        const diags = analyzerDiagnostic.endSession();
        assert.equal(diags[0].severity, 'error');
        setAnalyzerSeverity('error');
    });
});
