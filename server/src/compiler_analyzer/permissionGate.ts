// AC-9 — permission gate for [[dll(...)]] and file-stdlib calls.
//
// Permissions are read from a small in-memory settings object that the
// inspector layer (Phase 5) wires up from `enma.permissions.*`. Default is
// false (denied) — annotations / calls without the flag emit errorForce so
// they survive R21 demotion.

import { NodeAnnotation, NodeExprCall } from '../compiler_parser/nodes';
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
 * File-stdlib callees gated behind enma.permissions.file. The matcher set is
 * the small list of functions in stdlib whose top-level name maps to a file
 * operation; expand as the stdlib JSON evolves.
 */
const FILE_STDLIB_NAMES: ReadonlySet<string> = new Set([
    'fopen',
    'fclose',
    'fread',
    'fwrite',
    'fseek',
    'ftell',
    'remove',
    'rename',
    'file_open',
    'file_read',
    'file_write',
    'file_close',
]);

export function isFileStdlibName(name: string): boolean {
    return FILE_STDLIB_NAMES.has(name);
}

/** Emit the permission diagnostic for a file-stdlib call. */
export function checkFileCallPermission(call: NodeExprCall, calleeName: string): void {
    if (!FILE_STDLIB_NAMES.has(calleeName)) return;
    if (s_perms.file) return;
    analyzerDiagnostic.errorForce(
        call.range.start
            ? { uri: '', start: call.range.start, end: call.range.end }
            : { uri: '', start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        `'${calleeName}' requires permission flag enma.permissions.file`,
        'EN_PERM_FILE',
    );
}
