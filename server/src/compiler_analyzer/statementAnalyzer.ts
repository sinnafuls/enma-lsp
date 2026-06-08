// Statement analyzer — second-pass body walk.
//
// Walks function/method/constructor/destructor bodies: it creates a scope for
// every block, records a ScopeRegion (so goto-definition / hover / find-refs
// resolve locals and parameters), registers local declarations, and runs the
// expression analyzer over every expression. It emits the doc-grounded
// variable-initializer and return-type conversion diagnostics.

import { NodeKind } from '../compiler_parser/nodes';
import type {
    NodeStmt,
    NodeStmtBlock,
} from '../compiler_parser/nodes';
import type { TextRange, TextLocation } from '../compiler_tokenizer/textLocation';
import { ResolvedType } from './resolvedType';
import {
    SymbolScope,
    getActiveGlobalScope,
    createAnonymousIdentifier,
} from './symbolScope';
import { SymbolVariable } from './symbolObject';
import { analyzeType } from './analyzer';
import { analyzeExpr, isExemptLiteral } from './expressionAnalyzer';
import { analyzeForeach } from './foreachStatement';
import { analyzerDiagnostic } from './analyzerDiagnostic';
import { implicitConversionError } from './typeConversion';

interface AnalyzeCtx {
    /** Enclosing function's declared return type (undefined => skip checks). */
    readonly returnType: ResolvedType | undefined;
}

function pushRegion(scope: SymbolScope, range: TextRange): void {
    getActiveGlobalScope().pushScopeRegion({
        boundingLocation: { uri: getActiveGlobalScope().filepath, start: range.start, end: range.end },
        targetScope: scope,
    });
}

function locationOf(range: TextRange): TextLocation {
    return { uri: getActiveGlobalScope().filepath, start: range.start, end: range.end };
}

/** Entry point: analyse a function body in `scope` (which already holds the
 *  parameters). The top block shares `scope` so params and body-top locals
 *  live together, exactly as the engine scopes them. */
export function analyzeBody(scope: SymbolScope, body: NodeStmtBlock, returnType: ResolvedType | undefined): void {
    pushRegion(scope, body.range);
    const ctx: AnalyzeCtx = { returnType };
    for (const stmt of body.stmts) analyzeStmt(scope, stmt, ctx);
}

function analyzeBlock(scope: SymbolScope, block: NodeStmtBlock, ctx: AnalyzeCtx): void {
    const child = scope.insertScope(createAnonymousIdentifier(), 'block');
    pushRegion(child, block.range);
    for (const stmt of block.stmts) analyzeStmt(child, stmt, ctx);
}

function analyzeStmt(scope: SymbolScope, stmt: NodeStmt, ctx: AnalyzeCtx): void {
    switch (stmt.kind) {
        case NodeKind.StmtBlock:
            analyzeBlock(scope, stmt, ctx);
            return;

        case NodeKind.StmtVar: {
            const declType = analyzeType(scope, stmt.type, true);
            const initType = stmt.initializer ? analyzeExpr(scope, stmt.initializer) : undefined;
            const auto = stmt.type.path.length === 1 && stmt.type.path[0].text === 'auto';
            scope.insertSymbolAndCheck(SymbolVariable.create({
                identifierToken: stmt.name,
                scopePath: scope.scopePath,
                type: auto ? initType : declType,
                isInstanceMember: false,
                accessRestriction: undefined,
                isConst: stmt.modifiers.some(m => m.text === 'const'),
                linkedNode: stmt,
            }));
            if (!auto && stmt.initializer && !isExemptLiteral(stmt.initializer)) {
                const err = implicitConversionError(initType, declType);
                if (err) analyzerDiagnostic.error(locationOf(stmt.initializer.range), `${err.message}; ${err.hint}`, err.code);
            }
            return;
        }

        case NodeKind.StmtExpr:
            analyzeExpr(scope, stmt.expr);
            return;

        case NodeKind.StmtReturn: {
            if (stmt.value === null) return;
            const valueType = analyzeExpr(scope, stmt.value);
            if (ctx.returnType && !ctx.returnType.isVoid() && !isExemptLiteral(stmt.value)) {
                const err = implicitConversionError(valueType, ctx.returnType);
                if (err) analyzerDiagnostic.error(locationOf(stmt.value.range), `${err.message}; ${err.hint}`, err.code);
            }
            return;
        }

        case NodeKind.StmtIf: {
            const ifScope = scope.insertScope(createAnonymousIdentifier(), 'if');
            pushRegion(ifScope, stmt.range);
            if (stmt.init) analyzeStmt(ifScope, stmt.init, ctx);
            analyzeExpr(ifScope, stmt.condition);
            analyzeStmt(ifScope, stmt.thenBranch, ctx);
            if (stmt.elseBranch) analyzeStmt(ifScope, stmt.elseBranch, ctx);
            return;
        }

        case NodeKind.StmtFor: {
            const forScope = scope.insertScope(createAnonymousIdentifier(), 'for');
            pushRegion(forScope, stmt.range);
            if (stmt.init) analyzeStmt(forScope, stmt.init, ctx);
            if (stmt.condition) analyzeExpr(forScope, stmt.condition);
            if (stmt.update) analyzeExpr(forScope, stmt.update);
            analyzeStmt(forScope, stmt.body, ctx);
            return;
        }

        case NodeKind.StmtForeach: {
            const feScope = scope.insertScope(createAnonymousIdentifier(), 'foreach');
            pushRegion(feScope, stmt.range);
            analyzeForeach(feScope, stmt);
            analyzeExpr(feScope, stmt.iterable);
            analyzeStmt(feScope, stmt.body, ctx);
            return;
        }

        case NodeKind.StmtWhile: {
            const wScope = scope.insertScope(createAnonymousIdentifier(), 'while');
            pushRegion(wScope, stmt.range);
            analyzeExpr(wScope, stmt.condition);
            analyzeStmt(wScope, stmt.body, ctx);
            return;
        }

        case NodeKind.StmtDoWhile: {
            const dScope = scope.insertScope(createAnonymousIdentifier(), 'do-while');
            pushRegion(dScope, stmt.range);
            analyzeStmt(dScope, stmt.body, ctx);
            analyzeExpr(dScope, stmt.condition);
            return;
        }

        case NodeKind.StmtSwitch: {
            const swScope = scope.insertScope(createAnonymousIdentifier(), 'block');
            pushRegion(swScope, stmt.range);
            analyzeExpr(swScope, stmt.subject);
            for (const c of stmt.cases) {
                if (c.value) analyzeExpr(swScope, c.value);
                for (const s of c.stmts) analyzeStmt(swScope, s, ctx);
            }
            return;
        }

        case NodeKind.StmtTry: {
            analyzeBlock(scope, stmt.tryBlock, ctx);
            for (const c of stmt.catches) {
                const catchScope = scope.insertScope(createAnonymousIdentifier(), 'catch');
                pushRegion(catchScope, c.body.range);
                if (c.excName) {
                    catchScope.insertSymbolAndCheck(SymbolVariable.create({
                        identifierToken: c.excName,
                        scopePath: catchScope.scopePath,
                        type: analyzeType(catchScope, c.excType, true) ?? undefined,
                        isInstanceMember: false,
                        accessRestriction: undefined,
                    }));
                }
                for (const s of c.body.stmts) analyzeStmt(catchScope, s, ctx);
            }
            if (stmt.finallyBlock) analyzeBlock(scope, stmt.finallyBlock, ctx);
            return;
        }

        case NodeKind.StmtDefer: {
            const deferScope = scope.insertScope(createAnonymousIdentifier(), 'defer');
            pushRegion(deferScope, stmt.body.range);
            for (const s of stmt.body.stmts) analyzeStmt(deferScope, s, ctx);
            return;
        }

        case NodeKind.StmtThrow:
            if (stmt.value) analyzeExpr(scope, stmt.value);
            return;

        case NodeKind.StmtYield:
            if (stmt.value) analyzeExpr(scope, stmt.value);
            return;

        // Labels, goto, break, continue, empty: nothing to analyse.

        default:
            return;
    }
}
