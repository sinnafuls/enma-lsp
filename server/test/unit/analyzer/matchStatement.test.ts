import * as assert from 'node:assert/strict';
import { analyzerDiagnostic } from '../../../src/compiler_analyzer/analyzerDiagnostic';
import { analyzeSource } from './_helpers';
import { analyzeMatch } from '../../../src/compiler_analyzer/matchStatement';
import { ResolvedType } from '../../../src/compiler_analyzer/resolvedType';
import { SymbolType } from '../../../src/compiler_analyzer/symbolObject';
import {
    NodeExprMatch,
    NodeKind,
    NodeMatchArm,
} from '../../../src/compiler_parser/nodes';
import { TokenKind, TokenIdentifier } from '../../../src/compiler_tokenizer/tokenObject';

const LOC = { uri: 'file:///t.em', start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
const RANGE = { start: LOC.start, end: LOC.end };

function ident(text: string): TokenIdentifier {
    return { kind: TokenKind.Identifier, text, location: LOC };
}

function makeArm(name: string, isWildcard = false): NodeMatchArm {
    return {
        kind: NodeKind.MatchArm,
        range: RANGE,
        pattern: { kind: NodeKind.ExprIdentifier as const, range: RANGE, token: ident(name) },
        body: { kind: NodeKind.ExprLiteralInt as const, range: RANGE, token: { kind: TokenKind.Number as const, text: '0', location: LOC, numericKind: 'int' as const } },
        isWildcard,
    };
}

function makeMatch(arms: NodeMatchArm[]): NodeExprMatch {
    return {
        kind: NodeKind.ExprMatch,
        range: RANGE,
        subject: { kind: NodeKind.ExprIdentifier as const, range: RANGE, token: ident('subj') },
        arms,
    };
}

describe('matchStatement', () => {
    it('warns on incomplete enum match', () => {
        // Build via analyzeSource so the enum is registered.
        const r = analyzeSource(`
            enum Color { Red, Green, Blue }
        `);
        const colorSym = r.analyzerScope.globalScope.lookupSymbol('Color') as SymbolType;
        analyzerDiagnostic.beginSession();
        analyzeMatch(
            makeMatch([makeArm('Red'), makeArm('Green')]),
            new ResolvedType(colorSym),
        );
        const diags = analyzerDiagnostic.endSession();
        assert.ok(diags.some(d => d.code === 'EN_MATCH_NON_EXHAUSTIVE'));
    });

    it('is silent when all enum values covered', () => {
        const r = analyzeSource(`
            enum Color { Red, Green, Blue }
        `);
        const colorSym = r.analyzerScope.globalScope.lookupSymbol('Color') as SymbolType;
        analyzerDiagnostic.beginSession();
        analyzeMatch(
            makeMatch([makeArm('Red'), makeArm('Green'), makeArm('Blue')]),
            new ResolvedType(colorSym),
        );
        const diags = analyzerDiagnostic.endSession();
        assert.ok(!diags.some(d => d.code === 'EN_MATCH_NON_EXHAUSTIVE'));
    });

    it('is silent when wildcard arm present', () => {
        const r = analyzeSource(`
            enum Color { Red, Green, Blue }
        `);
        const colorSym = r.analyzerScope.globalScope.lookupSymbol('Color') as SymbolType;
        analyzerDiagnostic.beginSession();
        analyzeMatch(
            makeMatch([makeArm('Red'), makeArm('_', true)]),
            new ResolvedType(colorSym),
        );
        const diags = analyzerDiagnostic.endSession();
        assert.ok(!diags.some(d => d.code === 'EN_MATCH_NON_EXHAUSTIVE'));
    });

    it('is silent when subject type is not an enum', () => {
        analyzerDiagnostic.beginSession();
        analyzeMatch(makeMatch([makeArm('foo')]), undefined);
        const diags = analyzerDiagnostic.endSession();
        assert.equal(diags.length, 0);
    });
});
