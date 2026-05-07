import * as assert from 'node:assert/strict';
import { analyzerDiagnostic } from '../../../src/compiler_analyzer/analyzerDiagnostic';
import { analyzeDefer } from '../../../src/compiler_analyzer/deferStatement';
import {
    NodeKind,
    NodeStmtBlock,
    NodeStmtDefer,
    NodeStmtVar,
    NodeStmtExpr,
} from '../../../src/compiler_parser/nodes';
import { TokenIdentifier, TokenKind } from '../../../src/compiler_tokenizer/tokenObject';

const LOC = { uri: 'file:///t.em', start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
const RANGE = { start: LOC.start, end: LOC.end };
function ident(text: string): TokenIdentifier {
    return { kind: TokenKind.Identifier, text, location: LOC };
}

function makeIdentExpr(text: string) {
    return { kind: NodeKind.ExprIdentifier as const, range: RANGE, token: ident(text) };
}

function makeStmtVar(name: string): NodeStmtVar {
    return {
        kind: NodeKind.StmtVar,
        range: RANGE,
        type: { kind: NodeKind.Type, range: RANGE, path: [ident('int32')], generics: [], pointerLevel: 0, isReference: false, isConst: false, isNullable: false },
        name: ident(name),
        initializer: null,
        modifiers: [],
    };
}

function makeStmtExpr(text: string): NodeStmtExpr {
    return {
        kind: NodeKind.StmtExpr,
        range: RANGE,
        expr: makeIdentExpr(text),
    };
}

describe('deferStatement', () => {
    it('warns when defer references a later-declared local', () => {
        // block: defer { use(later); }   var int32 later;
        const defer: NodeStmtDefer = {
            kind: NodeKind.StmtDefer,
            range: RANGE,
            body: {
                kind: NodeKind.StmtBlock,
                range: RANGE,
                stmts: [makeStmtExpr('later')],
            },
        };
        const block: NodeStmtBlock = {
            kind: NodeKind.StmtBlock,
            range: RANGE,
            stmts: [defer, makeStmtVar('later')],
        };
        analyzerDiagnostic.beginSession();
        analyzeDefer(defer, block);
        const diags = analyzerDiagnostic.endSession();
        assert.ok(diags.some(d => d.code === 'EN_DEFER_LATER_LOCAL'));
    });

    it('is silent when defer references only earlier locals', () => {
        const defer: NodeStmtDefer = {
            kind: NodeKind.StmtDefer,
            range: RANGE,
            body: {
                kind: NodeKind.StmtBlock,
                range: RANGE,
                stmts: [makeStmtExpr('earlier')],
            },
        };
        const block: NodeStmtBlock = {
            kind: NodeKind.StmtBlock,
            range: RANGE,
            stmts: [makeStmtVar('earlier'), defer],
        };
        analyzerDiagnostic.beginSession();
        analyzeDefer(defer, block);
        const diags = analyzerDiagnostic.endSession();
        assert.equal(diags.length, 0);
    });

    it('is silent when the defer body has no later-local refs', () => {
        const defer: NodeStmtDefer = {
            kind: NodeKind.StmtDefer,
            range: RANGE,
            body: { kind: NodeKind.StmtBlock, range: RANGE, stmts: [] },
        };
        const block: NodeStmtBlock = {
            kind: NodeKind.StmtBlock,
            range: RANGE,
            stmts: [defer, makeStmtVar('after')],
        };
        analyzerDiagnostic.beginSession();
        analyzeDefer(defer, block);
        const diags = analyzerDiagnostic.endSession();
        assert.equal(diags.length, 0);
    });
});
