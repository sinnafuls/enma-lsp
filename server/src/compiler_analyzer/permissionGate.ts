// AC-9 — permission gate for [[dll(...)]], file-stdlib calls, and budget annotations.
//
// Permissions are read from a small in-memory settings object that the
// inspector layer (Phase 5) wires up from `enma.permissions.*`. Default is
// false (denied) — annotations / calls without the flag emit errorForce so
// they survive R21 demotion.

import { NodeAnnotation, NodeExprCall, NodeKind } from '../compiler_parser/nodes';
import { analyzerDiagnostic } from './analyzerDiagnostic';

export interface AnalyzerPermissions {
    /** enma.permissions.ffi — gates [[dll]] annotations on extern decls. */
    ffi: boolean;
    /** enma.permissions.file — gates calls into file-stdlib functions. */
    file: boolean;
}

let s_perms: AnalyzerPermissions = { ffi: false, file: false };

/** Replace the active permissions snapshot. Called by the inspector layer. */
export function setAnalyzerPermissions(perms: Partial<AnalyzerPermissions>): void {
    s_perms = {
        ffi: perms.ffi ?? false,
        file: perms.file ?? false,
    };
}

export function getAnalyzerPermissions(): AnalyzerPermissions {
    return s_perms;
}

/**
 * Check a single annotation for `[[dll(...)]]` and gate against ffi permission.
 * Caller is expected to scan only annotations on extern-declared symbols.
 */
export function checkDllAnnotationPermission(annotation: NodeAnnotation): void {
    if (annotation.name.text !== 'dll') return;
    if (s_perms.ffi) return;
    analyzerDiagnostic.errorForce(
        annotation.name.location,
        '[[dll]] requires permission flag enma.permissions.ffi',
        'EN_PERM_DLL',
    );
}

/**
 * File-stdlib callees gated behind enma.permissions.file. The matcher is a
 * small Record of functions in stdlib whose top-level name maps to a file
 * operation; expand as the stdlib JSON evolves.
 */
const FILE_STDLIB_NAMES: Record<string, true> = {
    fopen: true,
    fclose: true,
    fread: true,
    fwrite: true,
    fseek: true,
    ftell: true,
    remove: true,
    rename: true,
    file_open: true,
    file_read: true,
    file_write: true,
    file_close: true,
};

export function isFileStdlibName(name: string): boolean {
    return FILE_STDLIB_NAMES[name] === true;
}

/** Emit the permission diagnostic for a file-stdlib call. */
export function checkFileCallPermission(call: NodeExprCall, calleeName: string): void {
    if (FILE_STDLIB_NAMES[calleeName] !== true) return;
    if (s_perms.file) return;
    analyzerDiagnostic.errorForce(
        call.range.start
            ? { uri: '', start: call.range.start, end: call.range.end }
            : { uri: '', start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        `'${calleeName}' requires permission flag enma.permissions.file`,
        'EN_PERM_FILE',
    );
}

/** Budget annotation names that require a positive integer literal argument. */
const BUDGET_ANNOTATION_NAMES: Record<string, true> = {
    budget: true,
    memory_budget: true,
};

/**
 * Check that a [[budget(N)]] or [[memory_budget(N)]] annotation carries a
 * positive integer literal as its first argument. Emits EN_BAD_BUDGET via
 * errorForce (R21-exempt) when N is absent or non-integer.
 */
export function checkBudgetAnnotation(annotation: NodeAnnotation): void {
    if (BUDGET_ANNOTATION_NAMES[annotation.name.text] !== true) return;
    const name = annotation.name.text;
    if (annotation.args.length === 0 || annotation.args[0].kind !== NodeKind.ExprLiteralInt) {
        analyzerDiagnostic.errorForce(
            annotation.name.location,
            `[[${name}(N)]] requires a positive integer literal argument`,
            'EN_BAD_BUDGET',
        );
    }
}

/** Call names that must receive at least one argument. */
const SET_BUDGET_CALL_NAMES: Record<string, true> = {
    set_budget: true,
    set_memory_budget: true,
};

/**
 * When calleeName is `set_budget` or `set_memory_budget`, verify that the call
 * supplies at least one argument. Emits EN_BUDGET_ARGS via errorForce when the
 * argument list is empty.
 */
export function checkSetBudgetCall(call: NodeExprCall, calleeName: string): void {
    if (SET_BUDGET_CALL_NAMES[calleeName] !== true) return;
    if (call.args.length > 0) return;
    analyzerDiagnostic.errorForce(
        call.range.start
            ? { uri: '', start: call.range.start, end: call.range.end }
            : { uri: '', start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        `'${calleeName}' requires at least one argument`,
        'EN_BUDGET_ARGS',
    );
}
