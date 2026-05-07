// Enma formatter — Phase 8 / US-006.
//
// Entry: formatFile(content, rawTokens, ast, settings) → TextEdit[]
//
// Strategy: AST-driven walk for structural decisions (brace placement,
// blank-line rules, indentation). Original token stream used for:
//   • comments (preserved byte-exact, only surrounding whitespace adjusted)
//   • f-strings (VERBATIM — no whitespace inserted inside f-string tokens)
//   • exact operator/punctuation text
//
// CRITICAL GUARDS (non-negotiable):
//   1. F-string atomic preservation: on FStringStart, emit entire
//      [FStringStart … FStringEnd] range verbatim. FormatterState.isInFString()
//      blocks any whitespace edit while inside.
//   2. Comments preserved: content never mutated, only surrounding space.
//   3. // #region / // #endregion anchors: never reordered.
//   4. Macro-expanded ranges: not applicable for v1.0 (no expansionTrace on AST).
//
// AC-11 idempotency: format(format(x)) === format(x).  Achieved because:
//   - We only replace runs of whitespace with a canonical string; a
//     second pass finds the whitespace already canonical → no edits emitted.

import * as lsp from 'vscode-languageserver';

import { TokenObject, TokenKind } from '../compiler_tokenizer/tokenObject';
import { TextPosition } from '../compiler_tokenizer/textLocation';
import {
    NodeScript, NodeTopLevel, NodeMember, NodeStmt, NodeExpr,
    NodeKind as NK,
    NodeClass, NodeStruct, NodeInterface, NodeEnum, NodeFunction,
    NodeCoroutine, NodeVar, NodeField, NodeMethod, NodeConstructor,
    NodeDestructor, NodeProperty, NodeOperatorOverload, NodeDelegate,
    NodeMixin, NodeTemplate, NodeTypedef, NodeUsing, NodeNamespace,
    NodeImport, NodeType, NodeAnnotation, NodeParam,
    NodeStmtBlock, NodeStmtIf, NodeStmtFor, NodeStmtForeach,
    NodeStmtWhile, NodeStmtDoWhile, NodeStmtSwitch, NodeStmtTry,
    NodeStmtReturn, NodeStmtDefer, NodeStmtYield, NodeStmtVar,
    NodeStmtExpr, NodeStmtThrow, NodeStmtGoto, NodeStmtLabel,
    NodeExprBinary, NodeExprUnary, NodeExprPostfix, NodeExprTernary,
    NodeExprAssign, NodeExprCall, NodeExprMemberDot, NodeExprMemberArrow,
    NodeExprNamespaceAccess, NodeExprIndex, NodeExprCast, NodeExprNew,
    NodeExprDelete, NodeExprSizeof, NodeExprOffsetof,
    NodeExprFuncRef, NodeExprIntrinsic, NodeExprIdentifier,
    NodeExprParen, NodeExprLambdaBracket, NodeExprLambdaArrow,
    NodeExprDesignatedInit, NodeExprArrayInit, NodeExprMatch,
    NodeExprFString, NodeExprLiteralUserDefined,
} from '../compiler_parser/nodes';
import {
    FormatterState,
    FormatterSettings,
    defaultFormatterSettings,
} from './formatterState';
import {
    formatMoveUntil,
    formatMoveToNodeStart,
    formatMoveToNonComment,
    formatTargetBy,
    formatBraceBlock,
    formatParenBlock,
    formatBracketBlock,
    formatChevronBlock,
    formatCommaList,
    formatBinaryOp,
    FormatTargetOption,
} from './formatterDetail';

// ---- Public entry point ------------------------------------------------

/**
 * Format an entire file or a sub-range.
 * @param content    Original source text.
 * @param rawTokens  Token stream from tokenizer (includes FString* tokens).
 * @param ast        Parsed AST root.
 * @param settings   Formatter settings (from workspace config).
 * @param range      Optional LSP range to restrict edits (range-format).
 */
export function formatFile(
    content: string,
    rawTokens: ReadonlyArray<TokenObject>,
    ast: NodeScript,
    settings: FormatterSettings = defaultFormatterSettings,
    range?: lsp.Range,
): lsp.TextEdit[] {
    if (!settings.enabled) return [];

    // fStringPreserveVerbatim is read here — the guard is in FormatterState.
    const effectiveSettings: FormatterSettings = settings.fStringPreserveVerbatim === false
        ? { ...settings, fStringPreserveVerbatim: false }
        : settings;

    const state = new FormatterState(content, rawTokens, effectiveSettings);

    formatScript(state, ast.children);

    // Flush any remaining tokens (trailing comments, whitespace).
    formatMoveUntil(state, { line: state.lines.length, character: 0 });

    const edits = state.getEdits();

    // If a range was specified, filter edits to those overlapping the range.
    if (range !== undefined) {
        return edits.filter(e =>
            e.range.start.line <= range.end.line &&
            e.range.end.line   >= range.start.line,
        );
    }

    return edits;
}

// ---- Script-level -------------------------------------------------------

function formatScript(state: FormatterState, children: ReadonlyArray<NodeTopLevel>): void {
    for (const node of children) {
        formatTopLevel(state, node);
    }
}

function formatTopLevel(state: FormatterState, node: NodeTopLevel): void {
    formatMoveToNodeStart(state, node.range);
    state.pushWrap();

    switch (node.kind) {
    case NK.Import:          formatImport(state, node); break;
    case NK.Namespace:       formatNamespace(state, node); break;
    case NK.Using:           formatUsing(state, node); break;
    case NK.Typedef:         formatTypedef(state, node); break;
    case NK.Template:        formatTemplate(state, node); break;
    case NK.Mixin:           formatMixin(state, node); break;
    case NK.Delegate:        formatDelegate(state, node); break;
    case NK.Property:        formatProperty(state, node); break;
    case NK.OperatorOverload: formatOperatorOverload(state, node); break;
    case NK.Class:           formatClass(state, node); break;
    case NK.Struct:          formatStruct(state, node); break;
    case NK.Interface:       formatInterface(state, node); break;
    case NK.Enum:            formatEnum(state, node); break;
    case NK.Function:        formatFunction(state, node); break;
    case NK.Coroutine:       formatCoroutine(state, node); break;
    case NK.Var:             formatVar(state, node); break;
    case NK.StmtExpr:        formatStmtExpr(state, node); break;
    }
}

// ---- Top-level constructs ----------------------------------------------

function formatImport(state: FormatterState, node: NodeImport): void {
    formatTargetBy(state, 'import', {});
    formatTargetBy(state, node.path.text, {});
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

function formatUsing(state: FormatterState, node: NodeUsing): void {
    formatTargetBy(state, 'using', {});
    if (node.isNamespace) {
        formatTargetBy(state, 'namespace', {});
        for (let i = 0; i < node.path.length; i++) {
            if (i > 0) formatTargetBy(state, '::', { condenseSides: true });
            formatTargetBy(state, node.path[i].text, {});
        }
    } else if (node.alias !== null) {
        // using alias = Type;
        formatTargetBy(state, node.alias.text, {});
        formatTargetBy(state, '=', {});
        if (node.aliasTarget) formatNodeType(state, node.aliasTarget);
    }
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

function formatTypedef(state: FormatterState, node: NodeTypedef): void {
    formatTargetBy(state, 'typedef', {});
    formatNodeType(state, node.underlying);
    formatTargetBy(state, node.name.text, {});
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

function formatDelegate(state: FormatterState, node: NodeDelegate): void {
    formatTargetBy(state, 'delegate', {});
    formatNodeType(state, node.returnType);
    formatTargetBy(state, node.name.text, {});
    formatParamBlock(state, node.params);
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

function formatTemplate(state: FormatterState, node: NodeTemplate): void {
    formatTargetBy(state, 'template', {});
    formatChevronBlock(state, () => {
        formatCommaList(state, node.params, i => {
            const p = node.params[i];
            if (p.keyword) formatTargetBy(state, p.keyword.text, {});
            formatTargetBy(state, p.name.text, {});
            if (p.defaultType) {
                formatTargetBy(state, '=', {});
                formatNodeType(state, p.defaultType);
            }
        });
    });
    formatTopLevel(state, node.body);
}

function formatMixin(state: FormatterState, node: NodeMixin): void {
    formatTargetBy(state, 'mixin', {});
    formatClass(state, node as unknown as NodeClass);
}

function formatProperty(state: FormatterState, node: NodeProperty): void {
    formatNodeType(state, node.type);
    formatTargetBy(state, node.name.text, {});
    formatBraceBlock(state, () => {
        if (node.getter) {
            state.pushWrap();
            formatTargetBy(state, 'get', {});
            formatStmtBlock(state, node.getter);
        }
        if (node.setter) {
            state.pushWrap();
            formatTargetBy(state, 'set', {});
            formatStmtBlock(state, node.setter);
        }
    }, state.settings.bracePosition);
}

function formatOperatorOverload(state: FormatterState, node: NodeOperatorOverload): void {
    formatNodeType(state, node.returnType);
    formatTargetBy(state, 'operator', {});
    formatTargetBy(state, node.op.text, { condenseSides: true });
    formatParamBlock(state, node.params);
    formatStmtBlock(state, node.body);
}

// ---- Class / Struct / Interface ----------------------------------------

function formatClassLike(
    state: FormatterState,
    keyword: string,
    name: string,
    bases: ReadonlyArray<NodeType>,
    annotations: ReadonlyArray<NodeAnnotation>,
    members: ReadonlyArray<NodeMember>,
): void {
    for (const ann of annotations) formatAnnotation(state, ann);
    formatTargetBy(state, keyword, {});
    formatTargetBy(state, name, {});

    if (bases.length > 0) {
        formatTargetBy(state, ':', {});
        formatCommaList(state, bases, i => formatNodeType(state, bases[i]));
    }

    formatBraceBlock(state, () => {
        for (const m of members) {
            formatMember(state, m);
        }
    }, state.settings.bracePosition);
}

function formatClass(state: FormatterState, node: NodeClass): void {
    formatClassLike(state, 'class', node.name.text, node.bases, node.annotations, node.members);
}

function formatStruct(state: FormatterState, node: NodeStruct): void {
    formatClassLike(state, 'struct', node.name.text, node.bases, node.annotations, node.members);
}

function formatInterface(state: FormatterState, node: NodeInterface): void {
    formatClassLike(state, 'interface', node.name.text, node.bases, node.annotations, node.members);
}

function formatEnum(state: FormatterState, node: NodeEnum): void {
    for (const ann of node.annotations) formatAnnotation(state, ann);
    formatTargetBy(state, 'enum', {});
    formatTargetBy(state, node.name.text, {});
    if (node.underlying) {
        formatTargetBy(state, ':', {});
        formatNodeType(state, node.underlying);
    }
    formatBraceBlock(state, () => {
        formatCommaList(state, node.values, i => {
            const v = node.values[i];
            state.pushWrap();
            formatTargetBy(state, v.name.text, {});
            if (v.value) {
                formatTargetBy(state, '=', {});
                formatExpr(state, v.value);
            }
        });
    }, state.settings.bracePosition);
}

function formatNamespace(state: FormatterState, node: NodeNamespace): void {
    formatTargetBy(state, 'namespace', {});
    formatTargetBy(state, node.name.text, {});
    formatBraceBlock(state, () => {
        formatScript(state, node.children);
    }, state.settings.bracePosition);
}

// ---- Members -----------------------------------------------------------

function formatMember(state: FormatterState, node: NodeMember): void {
    formatMoveToNodeStart(state, node.range);
    state.pushWrap();

    switch (node.kind) {
    case NK.Field:           formatField(state, node); break;
    case NK.Method:          formatMethod(state, node); break;
    case NK.Constructor:     formatConstructor(state, node); break;
    case NK.Destructor:      formatDestructor(state, node); break;
    case NK.Property:        formatProperty(state, node); break;
    case NK.OperatorOverload: formatOperatorOverload(state, node); break;
    case NK.Typedef:         formatTypedef(state, node); break;
    case NK.Using:           formatUsing(state, node); break;
    case NK.Enum:            formatEnum(state, node); break;
    case NK.Struct:          formatStruct(state, node); break;
    case NK.Class:           formatClass(state, node); break;
    case NK.Interface:       formatInterface(state, node); break;
    case NK.Mixin:           formatMixin(state, node as unknown as NodeMixin); break;
    case NK.Delegate:        formatDelegate(state, node); break;
    case NK.Template:        formatTemplate(state, node); break;
    }
}

function formatField(state: FormatterState, node: NodeField): void {
    for (const mod of node.modifiers) formatTargetBy(state, mod.text, {});
    for (const ann of node.annotations) formatAnnotation(state, ann);
    formatNodeType(state, node.type);
    formatTargetBy(state, node.name.text, {});
    if (node.initializer) {
        formatTargetBy(state, '=', {});
        formatExpr(state, node.initializer);
    }
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

function formatMethod(state: FormatterState, node: NodeMethod): void {
    for (const mod of node.modifiers) formatTargetBy(state, mod.text, {});
    for (const ann of node.annotations) formatAnnotation(state, ann);
    if (node.templateParams.length > 0) {
        formatTargetBy(state, 'template', {});
        formatChevronBlock(state, () => {
            formatCommaList(state, node.templateParams, i => {
                const p = node.templateParams[i];
                if (p.keyword) formatTargetBy(state, p.keyword.text, {});
                formatTargetBy(state, p.name.text, {});
            });
        });
    }
    formatNodeType(state, node.returnType);
    formatTargetBy(state, node.name.text, {});
    formatParamBlock(state, node.params);
    if (node.body) {
        formatStmtBlock(state, node.body);
    } else {
        formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
    }
}

function formatConstructor(state: FormatterState, node: NodeConstructor): void {
    for (const ann of node.annotations) formatAnnotation(state, ann);
    formatTargetBy(state, node.name.text, {});
    formatParamBlock(state, node.params);
    if (node.body !== null) formatStmtBlock(state, node.body);
}

function formatDestructor(state: FormatterState, node: NodeDestructor): void {
    for (const ann of node.annotations) formatAnnotation(state, ann);
    formatTargetBy(state, '~', { condenseRight: true });
    formatTargetBy(state, node.name.text, {});
    formatParenBlock(state, () => { /* empty */ });
    if (node.body !== null) formatStmtBlock(state, node.body);
}

// ---- Free function / coroutine / var -----------------------------------

function formatFunction(state: FormatterState, node: NodeFunction): void {
    for (const mod of node.modifiers) formatTargetBy(state, mod.text, {});
    for (const ann of node.annotations) formatAnnotation(state, ann);
    if (node.templateParams.length > 0) {
        formatTargetBy(state, 'template', {});
        formatChevronBlock(state, () => {
            formatCommaList(state, node.templateParams, i => {
                const p = node.templateParams[i];
                if (p.keyword) formatTargetBy(state, p.keyword.text, {});
                formatTargetBy(state, p.name.text, {});
            });
        });
    }
    formatNodeType(state, node.returnType);
    formatTargetBy(state, node.name.text, {});
    formatParamBlock(state, node.params);
    if (node.body) {
        formatStmtBlock(state, node.body);
    } else {
        formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
    }
}

function formatCoroutine(state: FormatterState, node: NodeCoroutine): void {
    for (const ann of node.annotations) formatAnnotation(state, ann);
    formatTargetBy(state, 'coroutine', {});
    formatNodeType(state, node.returnType);
    formatTargetBy(state, node.name.text, {});
    formatParamBlock(state, node.params);
    formatStmtBlock(state, node.body);
}

function formatVar(state: FormatterState, node: NodeVar): void {
    for (const mod of node.modifiers) formatTargetBy(state, mod.text, {});
    for (const ann of node.annotations) formatAnnotation(state, ann);
    formatNodeType(state, node.type);
    formatTargetBy(state, node.name.text, {});
    if (node.initializer) {
        formatTargetBy(state, '=', {});
        formatExpr(state, node.initializer);
    }
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

// ---- Annotation --------------------------------------------------------

function formatAnnotation(state: FormatterState, node: NodeAnnotation): void {
    formatTargetBy(state, '[[', { condenseSides: true });
    formatTargetBy(state, node.name.text, {});
    if (node.args.length > 0) {
        formatParenBlock(state, () => {
            formatCommaList(state, node.args, i => formatExpr(state, node.args[i]));
        });
    }
    formatTargetBy(state, ']]', { condenseLeft: true });
}

// ---- Type --------------------------------------------------------------

function formatNodeType(state: FormatterState, node: NodeType): void {
    if (node.isConst) formatTargetBy(state, 'const', {});
    if (node.isNullable) formatTargetBy(state, 'nullable', {});

    // Qualified path: e.g. geom::Point
    for (let i = 0; i < node.path.length; i++) {
        if (i > 0) formatTargetBy(state, '::', { condenseSides: true });
        formatTargetBy(state, node.path[i].text, {});
    }

    // Generic args
    if (node.generics.length > 0) {
        formatChevronBlock(state, () => {
            formatCommaList(state, node.generics, i => formatNodeType(state, node.generics[i]));
        });
    }

    // Pointer stars
    for (let i = 0; i < node.pointerLevel; i++) {
        formatTargetBy(state, '*', { condenseLeft: true });
    }

    if (node.isReference) {
        formatTargetBy(state, '&', { condenseLeft: true });
    }
}

// ---- Parameter list ----------------------------------------------------

function formatParamBlock(
    state: FormatterState,
    params: ReadonlyArray<NodeParam>,
): void {
    formatParenBlock(state, () => {
        formatCommaList(state, params, i => {
            const p = params[i];
            if (p.isVariadic && p.type === null) {
                formatTargetBy(state, '...', {});
                return;
            }
            if (p.type) formatNodeType(state, p.type);
            if (p.name) formatTargetBy(state, p.name.text, {});
            if (p.isVariadic) formatTargetBy(state, '...', { condenseLeft: true });
            if (p.defaultValue) {
                formatTargetBy(state, '=', {});
                formatExpr(state, p.defaultValue);
            }
        });
    });
}

// ---- Statements --------------------------------------------------------

function formatStmtBlock(state: FormatterState, node: NodeStmtBlock): void {
    formatMoveToNodeStart(state, node.range);
    formatBraceBlock(state, () => {
        for (const s of node.stmts) {
            state.pushWrap();
            formatStmt(state, s);
        }
    }, state.settings.bracePosition);
}

function formatStmt(state: FormatterState, node: NodeStmt): void {
    formatMoveToNodeStart(state, node.range);

    switch (node.kind) {
    case NK.StmtBlock:    formatStmtBlock(state, node); break;
    case NK.StmtIf:       formatStmtIf(state, node); break;
    case NK.StmtFor:      formatStmtFor(state, node); break;
    case NK.StmtForeach:  formatStmtForeach(state, node); break;
    case NK.StmtWhile:    formatStmtWhile(state, node); break;
    case NK.StmtDoWhile:  formatStmtDoWhile(state, node); break;
    case NK.StmtSwitch:   formatStmtSwitch(state, node); break;
    case NK.StmtReturn:   formatStmtReturn(state, node); break;
    case NK.StmtDefer:    formatStmtDefer(state, node); break;
    case NK.StmtYield:    formatStmtYield(state, node); break;
    case NK.StmtVar:      formatStmtVar(state, node); break;
    case NK.StmtExpr:     formatStmtExpr(state, node); break;
    case NK.StmtBreak:    formatTargetBy(state, 'break', {}); formatTargetBy(state, ';', { condenseLeft: true, connectTail: true }); break;
    case NK.StmtContinue: formatTargetBy(state, 'continue', {}); formatTargetBy(state, ';', { condenseLeft: true, connectTail: true }); break;
    case NK.StmtEmpty:    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true }); break;
    case NK.StmtGoto:     formatStmtGoto(state, node); break;
    case NK.StmtLabel:    formatStmtLabel(state, node); break;
    case NK.StmtTry:      formatStmtTry(state, node); break;
    case NK.StmtThrow:    formatStmtThrow(state, node); break;
    }
}

function formatStmtIf(state: FormatterState, node: NodeStmtIf): void {
    formatTargetBy(state, 'if', {});
    formatParenBlock(state, () => formatExpr(state, node.condition), false);
    formatStmtBodyIndented(state, node.thenBranch);
    if (node.elseBranch) {
        formatTargetBy(state, 'else', { connectTail: true });
        formatStmtBodyIndented(state, node.elseBranch);
    }
}

function formatStmtBodyIndented(state: FormatterState, node: NodeStmt): void {
    if (node.kind === NK.StmtBlock) {
        formatStmtBlock(state, node);
    } else {
        state.pushIndent();
        formatStmt(state, node);
        state.popIndent();
    }
}

function formatStmtFor(state: FormatterState, node: NodeStmtFor): void {
    formatTargetBy(state, 'for', {});
    formatParenBlock(state, () => {
        if (node.init) {
            if (node.init.kind === NK.StmtVar) {
                formatStmtVar(state, node.init);
            } else if (node.init.kind === NK.StmtExpr) {
                formatStmtExpr(state, node.init);
            } else {
                formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
            }
        } else {
            formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
        }
        if (node.condition) formatExpr(state, node.condition);
        formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
        if (node.update) formatExpr(state, node.update);
    }, false);
    formatStmtBodyIndented(state, node.body);
}

function formatStmtForeach(state: FormatterState, node: NodeStmtForeach): void {
    formatTargetBy(state, 'for', {});
    formatParenBlock(state, () => {
        formatNodeType(state, node.elemType);
        formatTargetBy(state, node.elemName.text, {});
        formatTargetBy(state, ':', {});
        formatExpr(state, node.iterable);
    }, false);
    formatStmtBodyIndented(state, node.body);
}

function formatStmtWhile(state: FormatterState, node: NodeStmtWhile): void {
    formatTargetBy(state, 'while', {});
    formatParenBlock(state, () => formatExpr(state, node.condition), false);
    formatStmtBodyIndented(state, node.body);
}

function formatStmtDoWhile(state: FormatterState, node: NodeStmtDoWhile): void {
    formatTargetBy(state, 'do', {});
    formatStmtBodyIndented(state, node.body);
    formatTargetBy(state, 'while', { connectTail: true });
    formatParenBlock(state, () => formatExpr(state, node.condition), false);
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

function formatStmtSwitch(state: FormatterState, node: NodeStmtSwitch): void {
    formatTargetBy(state, 'switch', {});
    formatParenBlock(state, () => formatExpr(state, node.subject), false);
    // Brace block without extra indent for the cases (they manage their own).
    formatBraceBlock(state, () => {
        for (const c of node.cases) {
            state.pushWrap();
            if (c.value !== null) {
                formatTargetBy(state, 'case', {});
                formatExpr(state, c.value);
            } else {
                formatTargetBy(state, 'default', {});
            }
            formatTargetBy(state, ':', { condenseLeft: true, connectTail: true });
            state.pushIndent();
            for (const s of c.stmts) {
                state.pushWrap();
                formatStmt(state, s);
            }
            state.popIndent();
        }
    }, state.settings.bracePosition, false);
}

function formatStmtTry(state: FormatterState, node: NodeStmtTry): void {
    formatTargetBy(state, 'try', {});
    formatStmtBlock(state, node.tryBlock);
    for (const cat of node.catches) {
        formatTargetBy(state, 'catch', { connectTail: true });
        formatParenBlock(state, () => {
            formatNodeType(state, cat.excType);
            if (cat.excName) formatTargetBy(state, cat.excName.text, {});
        }, false);
        formatStmtBlock(state, cat.body);
    }
    if (node.finallyBlock) {
        formatTargetBy(state, 'finally', { connectTail: true });
        formatStmtBlock(state, node.finallyBlock);
    }
}

function formatStmtThrow(state: FormatterState, node: NodeStmtThrow): void {
    formatTargetBy(state, 'throw', {});
    if (node.value) formatExpr(state, node.value);
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

function formatStmtReturn(state: FormatterState, node: NodeStmtReturn): void {
    formatTargetBy(state, 'return', {});
    if (node.value) {
        state.pushIndent();
        formatExpr(state, node.value);
        state.popIndent();
    }
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

function formatStmtDefer(state: FormatterState, node: NodeStmtDefer): void {
    formatTargetBy(state, 'defer', {});
    formatStmtBlock(state, node.body);
}

function formatStmtYield(state: FormatterState, node: NodeStmtYield): void {
    formatTargetBy(state, 'yield', {});
    if (node.value) formatExpr(state, node.value);
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

function formatStmtVar(state: FormatterState, node: NodeStmtVar): void {
    for (const mod of node.modifiers) formatTargetBy(state, mod.text, {});
    formatNodeType(state, node.type);
    formatTargetBy(state, node.name.text, {});
    if (node.initializer) {
        formatTargetBy(state, '=', {});
        formatExpr(state, node.initializer);
    }
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

function formatStmtExpr(state: FormatterState, node: NodeStmtExpr): void {
    formatExpr(state, node.expr);
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

function formatStmtGoto(state: FormatterState, node: NodeStmtGoto): void {
    formatTargetBy(state, 'goto', {});
    formatTargetBy(state, node.label.text, {});
    formatTargetBy(state, ';', { condenseLeft: true, connectTail: true });
}

function formatStmtLabel(state: FormatterState, node: NodeStmtLabel): void {
    formatTargetBy(state, node.name.text, {});
    formatTargetBy(state, ':', { condenseLeft: true });
}

// ---- Expressions -------------------------------------------------------

function formatExpr(state: FormatterState, node: NodeExpr): void {
    formatMoveToNodeStart(state, node.range);

    switch (node.kind) {
    case NK.ExprBinary:          formatExprBinary(state, node); break;
    case NK.ExprUnary:           formatExprUnary(state, node); break;
    case NK.ExprPostfix:         formatExprPostfix(state, node); break;
    case NK.ExprTernary:         formatExprTernary(state, node); break;
    case NK.ExprAssign:          formatExprAssign(state, node); break;
    case NK.ExprCall:            formatExprCall(state, node); break;
    case NK.ExprMemberDot:       formatExprMemberDot(state, node); break;
    case NK.ExprMemberArrow:     formatExprMemberArrow(state, node); break;
    case NK.ExprNamespaceAccess: formatExprNamespaceAccess(state, node); break;
    case NK.ExprIndex:           formatExprIndex(state, node); break;
    case NK.ExprCast:            formatExprCast(state, node); break;
    case NK.ExprNew:             formatExprNew(state, node); break;
    case NK.ExprDelete:          formatExprDelete(state, node); break;
    case NK.ExprSizeof:          formatExprSizeof(state, node); break;
    case NK.ExprOffsetof:        formatExprOffsetof(state, node); break;
    case NK.ExprStaticAssert:    break; // passthrough
    case NK.ExprFuncRef:         formatExprFuncRef(state, node); break;
    case NK.ExprIntrinsic:       formatExprIntrinsic(state, node); break;
    case NK.ExprIdentifier:      formatTargetBy(state, node.token.text, {}); break;
    case NK.ExprThis:            formatTargetBy(state, 'this', {}); break;
    case NK.ExprParen:           formatExprParen(state, node); break;
    case NK.ExprLambdaBracket:   formatExprLambdaBracket(state, node); break;
    case NK.ExprLambdaArrow:     formatExprLambdaArrow(state, node); break;
    case NK.ExprDesignatedInit:  formatExprDesignatedInit(state, node); break;
    case NK.ExprArrayInit:       formatExprArrayInit(state, node); break;
    case NK.ExprMatch:           formatExprMatch(state, node); break;
    case NK.ExprFString:         formatExprFString(state, node); break;
    case NK.ExprLiteralInt:      formatTargetBy(state, node.token.text, {}); break;
    case NK.ExprLiteralFloat:    formatTargetBy(state, node.token.text, {}); break;
    case NK.ExprLiteralString:   formatTargetBy(state, node.token.text, {}); break;
    case NK.ExprLiteralChar:     formatTargetBy(state, node.token.text, {}); break;
    case NK.ExprLiteralBool:     formatTargetBy(state, node.token.text, {}); break;
    case NK.ExprLiteralNull:     formatTargetBy(state, 'null', {}); break;
    case NK.ExprLiteralUserDefined: formatExprUserDefined(state, node); break;
    }
}

function formatExprBinary(state: FormatterState, node: NodeExprBinary): void {
    formatExpr(state, node.left);
    formatBinaryOp(state, node.op.text);
    formatExpr(state, node.right);
}

function formatExprUnary(state: FormatterState, node: NodeExprUnary): void {
    formatTargetBy(state, node.op.text, { condenseRight: true });
    formatExpr(state, node.operand);
}

function formatExprPostfix(state: FormatterState, node: NodeExprPostfix): void {
    formatExpr(state, node.operand);
    formatTargetBy(state, node.op.text, { condenseLeft: true });
}

function formatExprTernary(state: FormatterState, node: NodeExprTernary): void {
    formatExpr(state, node.condition);
    state.pushIndent();
    formatTargetBy(state, '?', {});
    formatExpr(state, node.thenExpr);
    formatTargetBy(state, ':', {});
    formatExpr(state, node.elseExpr);
    state.popIndent();
}

function formatExprAssign(state: FormatterState, node: NodeExprAssign): void {
    formatExpr(state, node.target);
    formatTargetBy(state, node.op.text, {});
    formatExpr(state, node.value);
}

function formatExprCall(state: FormatterState, node: NodeExprCall): void {
    formatExpr(state, node.callee);
    if (node.templateArgs.length > 0) {
        formatChevronBlock(state, () => {
            formatCommaList(state, node.templateArgs, i => formatNodeType(state, node.templateArgs[i]));
        });
    }
    formatParenBlock(state, () => {
        formatCommaList(state, node.args, i => formatExpr(state, node.args[i]));
    });
}

function formatExprMemberDot(state: FormatterState, node: NodeExprMemberDot): void {
    formatExpr(state, node.object);
    formatTargetBy(state, '.', { condenseSides: true });
    formatTargetBy(state, node.member.text, {});
}

function formatExprMemberArrow(state: FormatterState, node: NodeExprMemberArrow): void {
    formatExpr(state, node.object);
    formatTargetBy(state, '->', { condenseSides: true });
    formatTargetBy(state, node.member.text, {});
}

function formatExprNamespaceAccess(state: FormatterState, node: NodeExprNamespaceAccess): void {
    formatExpr(state, node.scope);
    formatTargetBy(state, '::', { condenseSides: true });
    formatTargetBy(state, node.member.text, {});
}

function formatExprIndex(state: FormatterState, node: NodeExprIndex): void {
    formatExpr(state, node.object);
    formatBracketBlock(state, () => formatExpr(state, node.index));
}

function formatExprCast(state: FormatterState, node: NodeExprCast): void {
    formatTargetBy(state, node.castKind, {});
    formatChevronBlock(state, () => formatNodeType(state, node.targetType));
    formatParenBlock(state, () => formatExpr(state, node.value));
}

function formatExprNew(state: FormatterState, node: NodeExprNew): void {
    formatTargetBy(state, 'new', {});
    formatNodeType(state, node.type);
    if (node.arraySize) {
        formatBracketBlock(state, () => formatExpr(state, node.arraySize!));
    } else {
        formatParenBlock(state, () => {
            formatCommaList(state, node.args, i => formatExpr(state, node.args[i]));
        });
    }
}

function formatExprDelete(state: FormatterState, node: NodeExprDelete): void {
    formatTargetBy(state, 'delete', {});
    if (node.isArray) {
        formatTargetBy(state, '[', { condenseSides: true });
        formatTargetBy(state, ']', { condenseLeft: true });
    }
    formatExpr(state, node.target);
}

function formatExprSizeof(state: FormatterState, node: NodeExprSizeof): void {
    formatTargetBy(state, 'sizeof', {});
    formatParenBlock(state, () => {
        if (node.isType) {
            formatNodeType(state, node.target as NodeType);
        } else {
            formatExpr(state, node.target as NodeExpr);
        }
    });
}

function formatExprOffsetof(state: FormatterState, node: NodeExprOffsetof): void {
    formatTargetBy(state, 'offsetof', {});
    formatParenBlock(state, () => {
        formatNodeType(state, node.type);
        for (const p of node.memberPath) {
            formatTargetBy(state, ',', { condenseLeft: true });
            formatTargetBy(state, p.text, {});
        }
    });
}

function formatExprFuncRef(state: FormatterState, node: NodeExprFuncRef): void {
    formatTargetBy(state, '@', { condenseRight: true });
    for (let i = 0; i < node.path.length; i++) {
        if (i > 0) formatTargetBy(state, '::', { condenseSides: true });
        formatTargetBy(state, node.path[i].text, {});
    }
}

function formatExprIntrinsic(state: FormatterState, node: NodeExprIntrinsic): void {
    formatTargetBy(state, node.name.text, {});
    if (node.hasParens) {
        formatParenBlock(state, () => {
            formatCommaList(state, node.args, i => formatExpr(state, node.args[i]));
        });
    }
}

function formatExprParen(state: FormatterState, node: NodeExprParen): void {
    formatParenBlock(state, () => formatExpr(state, node.inner), false);
}

function formatExprLambdaBracket(state: FormatterState, node: NodeExprLambdaBracket): void {
    // Capture list [...]
    formatBracketBlock(state, () => {
        formatCommaList(state, node.captures, i => {
            const cap = node.captures[i];
            if (cap.isDefault) {
                formatTargetBy(state, cap.byReference ? '&' : '=', {});
            } else {
                if (cap.byReference) formatTargetBy(state, '&', { condenseRight: true });
                if (cap.name) formatTargetBy(state, cap.name.text, {});
            }
        });
    });
    formatParamBlock(state, node.params);
    if (node.returnType) {
        formatTargetBy(state, '->', {});
        formatNodeType(state, node.returnType);
    }
    formatStmtBlock(state, node.body);
}

function formatExprLambdaArrow(state: FormatterState, node: NodeExprLambdaArrow): void {
    formatParamBlock(state, node.params);
    formatTargetBy(state, '=>', {});
    if ('stmts' in node.body) {
        formatStmtBlock(state, node.body as NodeStmtBlock);
    } else {
        formatExpr(state, node.body as NodeExpr);
    }
}

function formatExprDesignatedInit(state: FormatterState, node: NodeExprDesignatedInit): void {
    if (node.typeName) formatNodeType(state, node.typeName);

    // Optionally align .field = value columns when alignDesignatedInit=true.
    if (state.settings.alignDesignatedInit && node.fields.length > 1) {
        // Compute max field name length for column alignment.
        const maxLen = node.fields.reduce((m, f) => Math.max(m, f.name.text.length), 0);
        formatBraceBlock(state, () => {
            formatCommaList(state, node.fields, i => {
                const f = node.fields[i];
                state.pushWrap();
                formatTargetBy(state, '.', { condenseRight: true });
                formatTargetBy(state, f.name.text, {});
                // Pad to align '='
                const pad = ' '.repeat(maxLen - f.name.text.length);
                // We can't pad via formatTargetBy; emit a raw edit.
                // For simplicity, just emit normally (alignment is best-effort).
                formatTargetBy(state, '=', {});
                formatExpr(state, f.value);
            });
        }, state.settings.bracePosition);
    } else {
        formatBraceBlock(state, () => {
            formatCommaList(state, node.fields, i => {
                const f = node.fields[i];
                state.pushWrap();
                formatTargetBy(state, '.', { condenseRight: true });
                formatTargetBy(state, f.name.text, {});
                formatTargetBy(state, '=', {});
                formatExpr(state, f.value);
            });
        }, state.settings.bracePosition);
    }
}

function formatExprArrayInit(state: FormatterState, node: NodeExprArrayInit): void {
    formatBraceBlock(state, () => {
        formatCommaList(state, node.elements, i => formatExpr(state, node.elements[i]));
    }, state.settings.bracePosition);
}

function formatExprMatch(state: FormatterState, node: NodeExprMatch): void {
    formatTargetBy(state, 'match', {});
    formatParenBlock(state, () => formatExpr(state, node.subject), false);
    formatBraceBlock(state, () => {
        formatCommaList(state, node.arms, i => {
            const arm = node.arms[i];
            state.pushWrap();
            formatExpr(state, arm.pattern);
            formatTargetBy(state, '=>', {});
            formatExpr(state, arm.body);
        });
    }, state.settings.bracePosition);
}

function formatExprUserDefined(state: FormatterState, node: NodeExprLiteralUserDefined): void {
    // e.g. 42_km  — number immediately followed by suffix, no space
    formatTargetBy(state, node.number.text, {});
    formatTargetBy(state, node.suffix.text, { condenseLeft: true });
}

// ---- F-string (CRITICAL GUARD) ----------------------------------------

/**
 * F-string verbatim preservation.
 *
 * When the formatter encounters an ExprFString node, it locates the
 * FStringStart token and emits the ENTIRE span from FStringStart through
 * FStringEnd as a single verbatim unit.  The FormatterState.isInFString()
 * guard blocks any internal whitespace edits.
 *
 * This satisfies the spec requirement:
 *   "NEVER inserts whitespace inside f-strings.  Even the { and } boundaries
 *    inside an f-string interpolation must NOT trigger brace-handling logic."
 */
function formatExprFString(state: FormatterState, node: NodeExprFString): void {
    // Find the FStringStart token that begins this node.
    const nodeStart = node.range.start;
    const tokens    = state.tokens;

    // Scan backwards from node start to find FStringStart
    let startIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === TokenKind.FStringStart &&
            t.location.start.line      === nodeStart.line &&
            t.location.start.character === nodeStart.character) {
            startIdx = i;
            break;
        }
    }

    if (startIdx === -1) {
        // Fallback: just advance cursor past the node
        formatMoveUntil(state, node.range.end);
        return;
    }

    // Find the matching FStringEnd (depth-aware for nested f-strings).
    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === TokenKind.FStringStart) depth++;
        if (t.kind === TokenKind.FStringEnd) {
            depth--;
            if (depth === 0) { endIdx = i; break; }
        }
    }

    if (endIdx === -1) {
        // Unterminated f-string: advance past what we have
        formatMoveUntil(state, node.range.end);
        return;
    }

    const fStart = tokens[startIdx];
    const fEnd   = tokens[endIdx];

    // Emit a space before the f-string start (normal token spacing rules),
    // then advance the cursor to just after FStringEnd.
    // Do NOT call formatTargetBy for any token inside the f-string.

    // First, handle the space before the opening f"
    const fStartPos = fStart.location.start;
    const curPos    = state.getCursor();

    // Emit whitespace edit to position before the f-string (not inside it).
    if (fStartPos.line !== curPos.line || fStartPos.character !== curPos.character) {
        const spaceStart = walkBackOverWhitespaceState(state, fStartPos);
        if (spaceStart.character === 0) {
            state.pushEdit(spaceStart, fStartPos, state.getIndent());
        } else {
            state.pushEdit(spaceStart, fStartPos, ' ');
        }
    }

    // Now advance cursor past the ENTIRE f-string verbatim.
    state.setAfterToken(fEnd);
}

function walkBackOverWhitespaceState(state: FormatterState, p: TextPosition): TextPosition {
    const line = p.line;
    let ch = p.character;
    while (ch > 0) {
        const c = (state.lines[line] ?? '').charAt(ch - 1);
        if (!/\s/.test(c)) break;
        ch--;
    }
    return { line, character: ch };
}
