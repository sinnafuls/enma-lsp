// Analyzer diagnostic emission. Per-session collection so tests can drain.
//
// Severity follows §R21 rollback: when `enma.analyzer.severity = "warning"` the
// majority of analyzer errors demote to Warning. Exempt diagnostics (AC-7, AC-9,
// AC-18 ambiguous-method-resolution, [[align/dll]] arg type errors) STAY Error
// regardless via the `forceError` parameter.

import { TextLocation } from '../compiler_tokenizer/textLocation';

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface AnalyzerDiagnostic {
    severity: DiagnosticSeverity;
    location: TextLocation;
    message: string;
    /** Stable code so test harness + code actions can match without prose. */
    code?: string;
    source?: string;
}

const SOURCE_NAME = 'Enma - Analyzer';

let s_session: AnalyzerDiagnostic[] = [];

// §R21 rollback knob — settable by host (Inspector / config layer). Default error.
let s_globalSeverity: 'error' | 'warning' = 'error';

/** Set the global rollback severity. */
export function setAnalyzerSeverity(severity: 'error' | 'warning'): void {
    s_globalSeverity = severity;
}

export function getAnalyzerSeverity(): 'error' | 'warning' {
    return s_globalSeverity;
}

function beginSession(): void {
    s_session = [];
}

function endSession(): AnalyzerDiagnostic[] {
    const out = s_session;
    s_session = [];
    return out;
}

/**
 * Emit a non-rollback-exempt error. Demotes to Warning when global severity is
 * `warning` (§R21 rollback). Use `errorForce` for the AC-7/9/18/[[align/dll]]
 * exemption list — those stay Error always.
 */
function error(location: TextLocation, message: string, code?: string): void {
    s_session.push({
        severity: s_globalSeverity,
        location,
        message,
        code,
        source: SOURCE_NAME,
    });
}

/**
 * Emit an error that ignores the §R21 rollback severity flag. The exemption
 * list per the plan: AC-7 (pointer rule), AC-9 (permission gate),
 * AC-18 (MRO ambiguous method resolution), [[align/dll]] argument-type errors.
 */
function errorForce(location: TextLocation, message: string, code?: string): void {
    s_session.push({
        severity: 'error',
        location,
        message,
        code,
        source: SOURCE_NAME,
    });
}

function warning(location: TextLocation, message: string, code?: string): void {
    s_session.push({
        severity: 'warning',
        location,
        message,
        code,
        source: SOURCE_NAME,
    });
}

function info(location: TextLocation, message: string, code?: string): void {
    s_session.push({
        severity: 'info',
        location,
        message,
        code,
        source: SOURCE_NAME,
    });
}

function hint(location: TextLocation, message: string, code?: string): void {
    s_session.push({
        severity: 'hint',
        location,
        message,
        code,
        source: SOURCE_NAME,
    });
}

/** Push an already-formed diagnostic (used by sub-analyzers that build their own). */
function push(diag: AnalyzerDiagnostic): void {
    s_session.push(diag);
}

export const analyzerDiagnostic = {
    beginSession,
    endSession,
    error,
    errorForce,
    warning,
    info,
    hint,
    push,
} as const;
