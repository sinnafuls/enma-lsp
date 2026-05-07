// Shared diagnostic conversion helpers for inspector + analysisResolver.

import * as lsp from 'vscode-languageserver/node';

import { AnalyzerDiagnostic } from '../compiler_analyzer/analyzerDiagnostic';
import { TextLocation } from '../compiler_tokenizer/textLocation';

export function locationToRange(loc: TextLocation): lsp.Range {
    return {
        start: { line: loc.start.line, character: loc.start.character },
        end: { line: loc.end.line, character: loc.end.character },
    };
}

export function analyzerDiagToLsp(d: AnalyzerDiagnostic): lsp.Diagnostic {
    let sev: lsp.DiagnosticSeverity;
    switch (d.severity) {
        case 'error':   sev = lsp.DiagnosticSeverity.Error;       break;
        case 'warning': sev = lsp.DiagnosticSeverity.Warning;     break;
        case 'info':    sev = lsp.DiagnosticSeverity.Information; break;
        case 'hint':    sev = lsp.DiagnosticSeverity.Hint;        break;
    }
    return {
        severity: sev,
        range: locationToRange(d.location),
        message: d.message,
        code: d.code,
        source: d.source ?? 'Enma - Analyzer',
    };
}
