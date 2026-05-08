import { TextLocation, TextRange, TextPosition } from '../compiler_tokenizer/textLocation';
import {
    TokenObject, TokenKind,
    TokenPreprocessor, TokenIdentifier, TokenString, TokenNumber,
} from '../compiler_tokenizer/tokenObject';

// ---- Public output types ----

export interface MacroDef {
    name: string;
    params?: string[];      // undefined = object-like; defined (possibly []) = function-like
    body: TokenObject[];
    defToken: TokenObject;  // The TokenIdentifier for the macro name
}

export interface MacroExpansion {
    siteToken: TokenObject;
    defToken: TokenObject;
    expandedRange: TextRange;
    callerScope: string;
}

export interface Diagnostic {
    severity: 'error' | 'warning';
    message: string;
    location: TextLocation;
}

export interface PreprocessedOutput {
    preprocessedTokens: TokenObject[];
    includePathTokens: TokenString[];
    macroDefs: Map<string, MacroDef>;
    expansionTrace: Map<TokenObject, MacroExpansion>;
    pragmaOnceFiles: Set<string>;
    diagnostics: Diagnostic[];
}

export interface PreprocessOptions {
    maxIncludeDepth?: number;
    predefinedMacros?: Record<string, string>;
    /** Canonical paths currently being processed (for cycle detection by inspector) */
    activeIncludePaths?: Set<string>;
    /** URI of the file being preprocessed */
    fileUri?: string;
    /** Include chain for error messages: array of canonical paths from root to current */
    includeChain?: string[];
}

// ---- Internal state ----

const MAX_EXPANSION_DEPTH = 64;

// Reused empty set for the top-level tryExpand call — never mutated at that depth.
const EMPTY_EXPANDING: ReadonlySet<string> = new Set<string>();

interface ConditionalFrame {
    /** Whether the current branch is active (code should be emitted) */
    active: boolean;
    /** Whether any branch of this if/ifdef/ifndef was already taken */
    anyBranchTaken: boolean;
    /** Whether we're past all branches (after #else) */
    inElse: boolean;
}

class PreprocessorState {
    pos: number = 0;
    readonly tokens: TokenObject[];
    readonly output: TokenObject[] = [];
    readonly includePathTokens: TokenString[] = [];
    readonly macroDefs: Map<string, MacroDef> = new Map();
    readonly expansionTrace: Map<TokenObject, MacroExpansion> = new Map();
    readonly pragmaOnceFiles: Set<string> = new Set();
    readonly diagnostics: Diagnostic[] = [];
    readonly conditionalStack: ConditionalFrame[] = [];
    readonly maxIncludeDepth: number;
    readonly activeIncludePaths: Set<string>;
    readonly fileUri: string;
    readonly includeChain: string[];

    constructor(tokens: TokenObject[], opts: PreprocessOptions) {
        this.tokens = tokens;
        this.maxIncludeDepth = opts.maxIncludeDepth ?? 64;
        this.activeIncludePaths = opts.activeIncludePaths ?? new Set();
        this.fileUri = opts.fileUri ?? 'file:///unknown';
        this.includeChain = opts.includeChain ?? [];
    }

    get isEOF(): boolean { return this.pos >= this.tokens.length; }

    peek(offset = 0): TokenObject | undefined {
        return this.tokens[this.pos + offset];
    }

    advance(): TokenObject | undefined {
        return this.tokens[this.pos++];
    }

    /** Whether we are currently in an active (emitting) conditional scope */
    get isActive(): boolean {
        return this.conditionalStack.every(f => f.active);
    }

    addDiagnostic(severity: 'error' | 'warning', message: string, location: TextLocation): void {
        this.diagnostics.push({ severity, message, location });
    }
}

// ---- Entry point ----

export function preprocessAfterTokenized(
    tokens: TokenObject[],
    options: PreprocessOptions = {},
): PreprocessedOutput {
    const state = new PreprocessorState(tokens, options);

    // Inject predefined macros
    if (options.predefinedMacros) {
        for (const [name, value] of Object.entries(options.predefinedMacros)) {
            // Parse value as a single number token if possible, else string
            const bodyTok = makeSyntheticToken(name, value, state.fileUri);
            state.macroDefs.set(name, {
                name,
                body: bodyTok ? [bodyTok] : [],
                defToken: makeSyntheticIdentToken(name, state.fileUri),
            });
        }
    }

    processTokenStream(state);

    return {
        preprocessedTokens: state.output,
        includePathTokens: state.includePathTokens,
        macroDefs: state.macroDefs,
        expansionTrace: state.expansionTrace,
        pragmaOnceFiles: state.pragmaOnceFiles,
        diagnostics: state.diagnostics,
    };
}

// ---- Main processing loop ----

function processTokenStream(state: PreprocessorState): void {
    while (!state.isEOF) {
        const tok = state.peek()!;

        if (tok.kind === TokenKind.EOF) {
            state.advance();
            if (state.isActive) state.output.push(tok);
            break;
        }

        if (tok.kind === TokenKind.Preprocessor) {
            state.advance();
            handleDirective(state, tok as TokenPreprocessor);
            continue;
        }

        if (tok.kind === TokenKind.Comment) {
            state.advance();
            // Comments are never emitted into preprocessed output
            continue;
        }

        if (!state.isActive) {
            // Skip tokens in inactive conditional branches
            state.advance();
            continue;
        }

        // Normal token — possibly expand macros
        state.advance();
        const expanded = tryExpand(state, tok, EMPTY_EXPANDING as Set<string>);
        for (const t of expanded) state.output.push(t);
    }

    // Unclosed conditionals
    if (state.conditionalStack.length > 0) {
        const loc = state.tokens[state.tokens.length - 1]?.location ??
            makeDummyLocation(state.fileUri);
        state.addDiagnostic('error', `Unterminated conditional: ${state.conditionalStack.length} #if/#ifdef block(s) not closed`, loc);
    }
}

// ---- Directive dispatch ----

function handleDirective(state: PreprocessorState, tok: TokenPreprocessor): void {
    const dir = tok.directive;

    switch (dir) {
        case 'include':   return handleInclude(state, tok);
        case 'define':    return handleDefine(state, tok);
        case 'undef':     return handleUndef(state, tok);
        case 'ifdef':     return handleIfdef(state, tok, false);
        case 'ifndef':    return handleIfdef(state, tok, true);
        case 'if':        return handleIf(state, tok);
        case 'elif':      return handleElif(state, tok);
        case 'else':      return handleElse(state, tok);
        case 'endif':     return handleEndif(state, tok);
        case 'pragma':    return handlePragma(state, tok);
        default:
            if (state.isActive) {
                state.addDiagnostic('warning',
                    `Unknown preprocessor directive '#${dir}'`, tok.location);
            }
            consumeRestOfDirectiveLine(state);
    }
}

// ---- #include ----

function handleInclude(state: PreprocessorState, tok: TokenPreprocessor): void {
    const pathTok = consumeRestOfDirectiveLine(state)[0];
    if (!state.isActive) return;

    if (!pathTok || pathTok.kind !== TokenKind.String) {
        state.addDiagnostic('error', '#include requires a string literal path', tok.location);
        return;
    }

    const strTok = pathTok as TokenString;
    // Extract path without surrounding quotes
    const raw = strTok.text;
    const path = raw.startsWith('"') && raw.endsWith('"')
        ? raw.slice(1, -1)
        : raw;

    // §A4 cycle detection
    const currentChain = state.includeChain;
    if (currentChain.length >= state.maxIncludeDepth) {
        const chainStr = [...currentChain, path].join(' → ');
        state.addDiagnostic('error',
            `#include depth limit (${state.maxIncludeDepth}) exceeded at: ${chainStr}`,
            tok.location);
        return;
    }

    if (state.activeIncludePaths.has(path)) {
        const chainStr = [...currentChain, path].join(' → ');
        state.addDiagnostic('error', `#include cycle: ${chainStr}`, tok.location);
        return;
    }

    state.includePathTokens.push(strTok);
}

// ---- #define ----

function handleDefine(state: PreprocessorState, tok: TokenPreprocessor): void {
    const lineTokens = consumeRestOfDirectiveLine(state);
    if (!state.isActive) return;

    if (lineTokens.length === 0) {
        state.addDiagnostic('error', '#define requires a name', tok.location);
        return;
    }

    const nameTok = lineTokens[0];
    if (nameTok.kind !== TokenKind.Identifier && nameTok.kind !== TokenKind.Reserved) {
        state.addDiagnostic('error', '#define name must be an identifier', tok.location);
        return;
    }

    const name = nameTok.text;
    let rest = lineTokens.slice(1);

    // Function-like: check if second token is '(' and adjacent (no space — but since tokenizer
    // doesn't track spaces we check: the paren token's start == nameTok's end)
    let params: string[] | undefined;
    if (rest.length > 0 && rest[0].kind === TokenKind.Punctuation && rest[0].text === '(') {
        // Only function-like if the '(' is immediately adjacent
        const parenTok = rest[0];
        const nameEnd = nameTok.location.end;
        const parenStart = parenTok.location.start;
        if (nameEnd.line === parenStart.line && nameEnd.character === parenStart.character) {
            const result = parseParamList(rest.slice(1));
            params = result.params;
            rest = result.remaining;
        }
    }

    state.macroDefs.set(name, {
        name,
        params,
        body: rest,
        defToken: nameTok,
    });
}

interface ParamListResult {
    params: string[];
    remaining: TokenObject[];
}

function parseParamList(tokens: TokenObject[]): ParamListResult {
    const params: string[] = [];
    let i = 0;
    while (i < tokens.length) {
        const t = tokens[i];
        if (t.kind === TokenKind.Punctuation && t.text === ')') {
            i++;
            break;
        }
        if (t.kind === TokenKind.Operator && t.text === ',') {
            i++;
            continue;
        }
        if (t.kind === TokenKind.Identifier || t.kind === TokenKind.Reserved) {
            params.push(t.text);
            i++;
            continue;
        }
        // Unexpected token in param list — skip
        i++;
    }
    return { params, remaining: tokens.slice(i) };
}

// ---- #undef ----

function handleUndef(state: PreprocessorState, tok: TokenPreprocessor): void {
    const lineTokens = consumeRestOfDirectiveLine(state);
    if (!state.isActive) return;

    if (lineTokens.length === 0) {
        state.addDiagnostic('warning', '#undef requires a name', tok.location);
        return;
    }

    const name = lineTokens[0].text;
    state.macroDefs.delete(name);
}

// ---- #ifdef / #ifndef ----

function handleIfdef(state: PreprocessorState, tok: TokenPreprocessor, negate: boolean): void {
    const lineTokens = consumeRestOfDirectiveLine(state);

    if (state.conditionalStack.length > 0 && !state.isActive) {
        // Already in an inactive branch — push a dormant frame
        state.conditionalStack.push({ active: false, anyBranchTaken: false, inElse: false });
        return;
    }

    if (lineTokens.length === 0) {
        state.addDiagnostic('error', `#${negate ? 'ifndef' : 'ifdef'} requires a name`, tok.location);
        state.conditionalStack.push({ active: false, anyBranchTaken: false, inElse: false });
        return;
    }

    const name = lineTokens[0].text;
    const defined = state.macroDefs.has(name);
    const condTrue = negate ? !defined : defined;
    state.conditionalStack.push({
        active: condTrue,
        anyBranchTaken: condTrue,
        inElse: false,
    });
}

// ---- #if ----

function handleIf(state: PreprocessorState, tok: TokenPreprocessor): void {
    const lineTokens = consumeRestOfDirectiveLine(state);

    if (state.conditionalStack.length > 0 && !state.isActive) {
        state.conditionalStack.push({ active: false, anyBranchTaken: false, inElse: false });
        return;
    }

    let condTrue = false;
    try {
        condTrue = evaluateExpr(lineTokens, state.macroDefs) !== 0;
    } catch (e) {
        state.addDiagnostic('warning',
            `Cannot evaluate #if expression: ${(e as Error).message}`, tok.location);
    }
    state.conditionalStack.push({
        active: condTrue,
        anyBranchTaken: condTrue,
        inElse: false,
    });
}

// ---- #elif ----

function handleElif(state: PreprocessorState, tok: TokenPreprocessor): void {
    const lineTokens = consumeRestOfDirectiveLine(state);

    if (state.conditionalStack.length === 0) {
        state.addDiagnostic('error', '#elif without matching #if', tok.location);
        return;
    }

    const frame = state.conditionalStack[state.conditionalStack.length - 1];

    if (frame.inElse) {
        state.addDiagnostic('error', '#elif after #else', tok.location);
        return;
    }

    if (frame.anyBranchTaken) {
        frame.active = false;
        return;
    }

    let condTrue = false;
    try {
        condTrue = evaluateExpr(lineTokens, state.macroDefs) !== 0;
    } catch (e) {
        state.addDiagnostic('warning',
            `Cannot evaluate #elif expression: ${(e as Error).message}`, tok.location);
    }

    frame.active = condTrue;
    if (condTrue) frame.anyBranchTaken = true;
}

// ---- #else ----

function handleElse(state: PreprocessorState, tok: TokenPreprocessor): void {
    consumeRestOfDirectiveLine(state);

    if (state.conditionalStack.length === 0) {
        state.addDiagnostic('error', '#else without matching #if', tok.location);
        return;
    }

    const frame = state.conditionalStack[state.conditionalStack.length - 1];

    if (frame.inElse) {
        state.addDiagnostic('error', 'Multiple #else clauses', tok.location);
        return;
    }

    frame.inElse = true;
    frame.active = !frame.anyBranchTaken;
    if (frame.active) frame.anyBranchTaken = true;
}

// ---- #endif ----

function handleEndif(state: PreprocessorState, tok: TokenPreprocessor): void {
    consumeRestOfDirectiveLine(state);

    if (state.conditionalStack.length === 0) {
        state.addDiagnostic('error', '#endif without matching #if', tok.location);
        return;
    }

    state.conditionalStack.pop();
}

// ---- #pragma ----

function handlePragma(state: PreprocessorState, tok: TokenPreprocessor): void {
    const lineTokens = consumeRestOfDirectiveLine(state);
    if (!state.isActive) return;

    if (lineTokens.length > 0 && lineTokens[0].text === 'once') {
        state.pragmaOnceFiles.add(state.fileUri);
    } else {
        const name = lineTokens[0]?.text ?? '';
        state.addDiagnostic('warning', `Unknown pragma '${name}'`, tok.location);
    }
}

// ---- Consume rest of directive line ----

/**
 * Reads tokens that belong to the current directive's argument list.
 * Stops at the first token that starts on a DIFFERENT line than the directive token,
 * or at the next Preprocessor token, or at EOF.
 * The directive token's line is passed as `directiveLine` (0-based).
 */
function consumeRestOfDirectiveLine(state: PreprocessorState): TokenObject[] {
    const result: TokenObject[] = [];
    // Get the line of the directive token that was just consumed (pos-1)
    const directiveLine = state.tokens[state.pos - 1]?.location.start.line ?? -1;

    while (!state.isEOF) {
        const t = state.peek()!;
        if (t.kind === TokenKind.Preprocessor || t.kind === TokenKind.EOF) break;
        if (t.kind === TokenKind.Comment) { state.advance(); continue; }
        // Stop if this token is on a different line than the directive
        if (t.location.start.line !== directiveLine) break;
        result.push(t);
        state.advance();
    }
    return result;
}

// ---- Macro expansion ----

function tryExpand(
    state: PreprocessorState,
    tok: TokenObject,
    currentlyExpanding: Set<string>,
): TokenObject[] {
    if (tok.kind !== TokenKind.Identifier && tok.kind !== TokenKind.Reserved) {
        return [tok];
    }

    const name = tok.text;
    const def = state.macroDefs.get(name);
    if (!def) return [tok];
    if (currentlyExpanding.has(name)) return [tok]; // Self-recursion guard

    if (def.params !== undefined) {
        // Function-like — need to read arg list
        return expandFunctionLike(state, tok, def, currentlyExpanding);
    } else {
        // Object-like
        return expandObjectLike(state, tok, def, currentlyExpanding, 0);
    }
}

function expandObjectLike(
    state: PreprocessorState,
    siteTok: TokenObject,
    def: MacroDef,
    currentlyExpanding: Set<string>,
    depth: number,
): TokenObject[] {
    if (depth > MAX_EXPANSION_DEPTH) {
        state.addDiagnostic('error',
            'Macro expansion recursion limit exceeded', siteTok.location);
        return [siteTok];
    }

    if (def.body.length === 0) return [];

    const expandedRange: TextRange = {
        start: siteTok.location.start,
        end: siteTok.location.end,
    };

    const newExpanding = new Set(currentlyExpanding);
    newExpanding.add(def.name);

    const result: TokenObject[] = [];
    for (const bodyTok of def.body) {
        const expansion: MacroExpansion = {
            siteToken: siteTok,
            defToken: def.defToken,
            expandedRange,
            callerScope: state.fileUri,
        };
        // Stamp expanded token with original location (call site)
        const stamped = stampToken(bodyTok, siteTok.location);
        state.expansionTrace.set(stamped, expansion);
        // Re-expand (recursive expansion)
        const reExpanded = tryExpandToken(state, stamped, newExpanding, depth + 1);
        result.push(...reExpanded);
    }
    return result;
}

function expandFunctionLike(
    state: PreprocessorState,
    siteTok: TokenObject,
    def: MacroDef,
    currentlyExpanding: Set<string>,
): TokenObject[] {
    // Peek to see if there's a '(' following (possibly with whitespace — but our tokens
    // are already separated so just check the next token)
    if (state.isEOF) return [siteTok];
    const nextTok = state.peek();
    if (!nextTok || nextTok.kind !== TokenKind.Punctuation || nextTok.text !== '(') {
        // No argument list — treat as non-macro identifier
        return [siteTok];
    }

    state.advance(); // consume '('

    // Collect args (paren-balanced, comma splits at depth 0)
    const args = collectFunctionArgs(state);

    if (args === null) {
        // Unterminated arg list
        state.addDiagnostic('error',
            `Unterminated argument list for macro '${def.name}'`, siteTok.location);
        return [siteTok];
    }

    const params = def.params!;

    // Check arity
    if (args.length !== params.length && !(params.length === 0 && args.length === 1 && args[0].length === 0)) {
        // Allow empty call () for zero-param macros
        if (!(params.length === 0 && args.length === 0)) {
            state.addDiagnostic('warning',
                `Macro '${def.name}' expects ${params.length} argument(s), got ${args.length}`,
                siteTok.location);
        }
    }

    const newExpanding = new Set(currentlyExpanding);
    newExpanding.add(def.name);

    const expandedRange: TextRange = {
        start: siteTok.location.start,
        end: siteTok.location.end,
    };

    const expansion: MacroExpansion = {
        siteToken: siteTok,
        defToken: def.defToken,
        expandedRange,
        callerScope: state.fileUri,
    };

    const result: TokenObject[] = [];
    for (const bodyTok of def.body) {
        // Check if this body token is a parameter reference
        if (bodyTok.kind === TokenKind.Identifier || bodyTok.kind === TokenKind.Reserved) {
            const paramIdx = params.indexOf(bodyTok.text);
            if (paramIdx >= 0) {
                const argTokens = args[paramIdx] ?? [];
                // Expand the argument tokens first, then substitute
                for (const argTok of argTokens) {
                    const stamped = stampToken(argTok, siteTok.location);
                    state.expansionTrace.set(stamped, expansion);
                    const reExpanded = tryExpandToken(state, stamped, newExpanding, 1);
                    result.push(...reExpanded);
                }
                continue;
            }
        }

        const stamped = stampToken(bodyTok, siteTok.location);
        state.expansionTrace.set(stamped, expansion);
        const reExpanded = tryExpandToken(state, stamped, newExpanding, 1);
        result.push(...reExpanded);
    }

    return result;
}

function tryExpandToken(
    state: PreprocessorState,
    tok: TokenObject,
    currentlyExpanding: Set<string>,
    depth: number,
): TokenObject[] {
    if (depth > MAX_EXPANSION_DEPTH) {
        state.addDiagnostic('error',
            'Macro expansion recursion limit exceeded', tok.location);
        return [tok];
    }

    if (tok.kind !== TokenKind.Identifier && tok.kind !== TokenKind.Reserved) {
        return [tok];
    }

    const name = tok.text;
    const def = state.macroDefs.get(name);
    if (!def) return [tok];
    if (currentlyExpanding.has(name)) return [tok];

    if (def.params !== undefined) {
        // Function-like in body context — can't read args from stream here
        // (body args are already substituted tokens, not a stream)
        return [tok];
    }

    return expandObjectLike(state, tok, def, currentlyExpanding, depth);
}

function collectFunctionArgs(state: PreprocessorState): TokenObject[][] | null {
    const args: TokenObject[][] = [];
    let current: TokenObject[] = [];
    let depth = 0;

    while (!state.isEOF) {
        const t = state.peek()!;
        if (t.kind === TokenKind.EOF) break;

        state.advance();

        if (t.kind === TokenKind.Punctuation) {
            if (t.text === '(') {
                depth++;
                current.push(t);
            } else if (t.text === ')') {
                if (depth === 0) {
                    args.push(current);
                    return args;
                }
                depth--;
                current.push(t);
            } else if (t.text === ',' && depth === 0) {
                args.push(current);
                current = [];
            } else {
                current.push(t);
            }
        } else {
            current.push(t);
        }
    }

    return null; // Unterminated
}

// ---- Stamp a token with a new location (for expansion trace) ----

function stampToken(tok: TokenObject, loc: TextLocation): TokenObject {
    return { ...tok, location: loc } as TokenObject;
}

// ---- Expression evaluator for #if / #elif ----

type ExprToken = { type: 'num'; value: number } | { type: 'op'; text: string } | { type: 'name'; text: string };

function evaluateExpr(tokens: TokenObject[], macroDefs: Map<string, MacroDef>): number {
    const exprToks = buildExprTokens(tokens, macroDefs);
    const parser = new ExprParser(exprToks);
    const result = parser.parseOr();
    return result;
}

function buildExprTokens(tokens: TokenObject[], macroDefs: Map<string, MacroDef>): ExprToken[] {
    const result: ExprToken[] = [];
    let i = 0;
    while (i < tokens.length) {
        const t = tokens[i];
        if (t.kind === TokenKind.Number) {
            result.push({ type: 'num', value: parseNumber(t.text) });
            i++;
        } else if (t.kind === TokenKind.Identifier || t.kind === TokenKind.Reserved) {
            // Check for defined(NAME) or defined NAME
            if (t.text === 'defined') {
                i++;
                const hasParen = i < tokens.length &&
                    tokens[i].kind === TokenKind.Punctuation && tokens[i].text === '(';
                if (hasParen) i++; // skip '('
                if (i < tokens.length &&
                    (tokens[i].kind === TokenKind.Identifier || tokens[i].kind === TokenKind.Reserved)) {
                    const name = tokens[i].text;
                    i++;
                    if (hasParen && i < tokens.length &&
                        tokens[i].kind === TokenKind.Punctuation && tokens[i].text === ')') {
                        i++; // skip ')'
                    }
                    result.push({ type: 'num', value: macroDefs.has(name) ? 1 : 0 });
                } else {
                    result.push({ type: 'num', value: 0 });
                }
                continue;
            }
            // Resolve identifier: 1 if defined as numeric-like macro, 0 otherwise
            const def = macroDefs.get(t.text);
            if (def && def.body.length === 1 && def.body[0].kind === TokenKind.Number) {
                result.push({ type: 'num', value: parseNumber(def.body[0].text) });
            } else if (def) {
                result.push({ type: 'num', value: 1 });
            } else {
                result.push({ type: 'num', value: 0 });
            }
            i++;
        } else if (t.kind === TokenKind.Operator) {
            result.push({ type: 'op', text: t.text });
            i++;
        } else if (t.kind === TokenKind.Punctuation) {
            result.push({ type: 'op', text: t.text });
            i++;
        } else {
            i++;
        }
    }
    return result;
}

function parseNumber(text: string): number {
    // Enma v1.1: strip digit separators (`_`) before numeric conversion.
    const clean = text.replace(/_/g, '');
    if (clean.startsWith('0x') || clean.startsWith('0X')) {
        return parseInt(clean.slice(2), 16);
    }
    if (clean.startsWith('0b') || clean.startsWith('0B')) {
        return parseInt(clean.slice(2), 2);
    }
    if (clean.endsWith('f')) {
        return parseFloat(clean.slice(0, -1));
    }
    const n = parseFloat(clean);
    return isNaN(n) ? 0 : n;
}

class ExprParser {
    private pos = 0;
    constructor(private tokens: ExprToken[]) {}

    peek(): ExprToken | undefined { return this.tokens[this.pos]; }
    advance(): ExprToken | undefined { return this.tokens[this.pos++]; }
    isEOF(): boolean { return this.pos >= this.tokens.length; }

    /** Returns the op text if current token is an operator, else undefined */
    private peekOp(): string | undefined {
        const t = this.peek();
        return t?.type === 'op' ? t.text : undefined;
    }

    parseOr(): number {
        let left = this.parseAnd();
        while (!this.isEOF() && this.peekOp() === '||') {
            this.advance();
            const right = this.parseAnd();
            left = (left !== 0 || right !== 0) ? 1 : 0;
        }
        return left;
    }

    parseAnd(): number {
        let left = this.parseEquality();
        while (!this.isEOF() && this.peekOp() === '&&') {
            this.advance();
            const right = this.parseEquality();
            left = (left !== 0 && right !== 0) ? 1 : 0;
        }
        return left;
    }

    parseEquality(): number {
        let left = this.parseRelational();
        while (!this.isEOF() && this.peek()?.type === 'op') {
            const op = this.peekOp()!;
            if (op !== '==' && op !== '!=') break;
            this.advance();
            const right = this.parseRelational();
            left = op === '==' ? (left === right ? 1 : 0) : (left !== right ? 1 : 0);
        }
        return left;
    }

    parseRelational(): number {
        let left = this.parseAddSub();
        while (!this.isEOF() && this.peek()?.type === 'op') {
            const op = this.peekOp()!;
            if (op !== '<' && op !== '<=' && op !== '>' && op !== '>=') break;
            this.advance();
            const right = this.parseAddSub();
            if (op === '<') left = left < right ? 1 : 0;
            else if (op === '<=') left = left <= right ? 1 : 0;
            else if (op === '>') left = left > right ? 1 : 0;
            else left = left >= right ? 1 : 0;
        }
        return left;
    }

    parseAddSub(): number {
        let left = this.parseMulDiv();
        while (!this.isEOF() && this.peek()?.type === 'op') {
            const op = this.peekOp()!;
            if (op !== '+' && op !== '-') break;
            this.advance();
            const right = this.parseMulDiv();
            left = op === '+' ? left + right : left - right;
        }
        return left;
    }

    parseMulDiv(): number {
        let left = this.parseUnary();
        while (!this.isEOF() && this.peek()?.type === 'op') {
            const op = this.peekOp()!;
            if (op !== '*' && op !== '/' && op !== '%') break;
            this.advance();
            const right = this.parseUnary();
            if (op === '*') left = left * right;
            else if (op === '/') left = right !== 0 ? Math.trunc(left / right) : 0;
            else left = right !== 0 ? left % right : 0;
        }
        return left;
    }

    parseUnary(): number {
        const op = this.peekOp();
        if (op !== undefined) {
            if (op === '!') { this.advance(); return this.parseUnary() === 0 ? 1 : 0; }
            if (op === '-') { this.advance(); return -this.parseUnary(); }
            if (op === '+') { this.advance(); return this.parseUnary(); }
        }
        return this.parsePrimary();
    }

    parsePrimary(): number {
        if (this.isEOF()) throw new Error('Unexpected end of expression');
        const t = this.peek()!;
        if (t.type === 'num') {
            this.advance();
            return t.value;
        }
        if (t.type === 'op' && t.text === '(') {
            this.advance();
            const v = this.parseOr();
            if (!this.isEOF() && this.peekOp() === ')') {
                this.advance();
            }
            return v;
        }
        throw new Error(`Unexpected token in #if expression`);
    }
}

// ---- Synthetic token helpers (for predefined macros) ----

function makeSyntheticToken(name: string, value: string, uri: string): TokenObject | null {
    const loc = makeDummyLocation(uri);
    const num = parseFloat(value);
    if (!isNaN(num)) {
        return {
            kind: TokenKind.Number,
            text: value,
            numericKind: value.includes('.') ? 'float' : 'int',
            location: loc,
        };
    }
    if (value.startsWith('"') && value.endsWith('"')) {
        return {
            kind: TokenKind.String,
            text: value,
            stringKind: 'double',
            location: loc,
        };
    }
    return null;
}

function makeSyntheticIdentToken(name: string, uri: string): TokenObject {
    return {
        kind: TokenKind.Identifier,
        text: name,
        location: makeDummyLocation(uri),
    };
}

function makeDummyLocation(uri: string): TextLocation {
    const pos: TextPosition = { line: 0, character: 0 };
    return { uri, start: pos, end: pos };
}
