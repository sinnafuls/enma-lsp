// `Enma: Run Script (MCP)` command + on-save engine validation.
//
// Talks to a Perception engine MCP server at the configured endpoint. Two
// surfaces:
//
//   1. `enma.runScript` command — POSTs the active document (or its bundled
//      output, if `enma.projects` is configured) to the engine's
//      `script/execute` tool. Streams stdout/stderr to a dedicated output
//      channel.
//
//   2. on-save engine validation — when `enma.mcp.enabled` is true, every
//      save of a .em file invokes `script/validate` and publishes the
//      returned diagnostics into its own DiagnosticCollection. The LSP's
//      own diagnostics stay separate so the user can tell which side
//      flagged what.

import {
    DiagnosticCollection,
    ExtensionContext,
    OutputChannel,
    Range,
    TextDocument,
    commands,
    languages,
    window,
    workspace,
    Diagnostic,
    DiagnosticSeverity,
} from 'vscode';
import { McpClient } from './mcpClient';

let output: OutputChannel | undefined;
let diagnostics: DiagnosticCollection | undefined;

function getOutput(): OutputChannel {
    if (!output) output = window.createOutputChannel('Enma MCP');
    return output;
}

function getDiagnostics(): DiagnosticCollection {
    if (!diagnostics) diagnostics = languages.createDiagnosticCollection('enma-mcp');
    return diagnostics;
}

interface McpSettings {
    enabled: boolean;
    endpoint: string;
    timeoutMs: number;
    authToken?: string;
}

function readSettings(): McpSettings {
    const cfg = workspace.getConfiguration('enma.mcp');
    return {
        enabled:   cfg.get<boolean>('enabled', false),
        endpoint:  cfg.get<string>('endpoint', 'http://127.0.0.1:9077/mcp'),
        timeoutMs: cfg.get<number>('timeoutMs', 5000),
        authToken: cfg.get<string>('authToken', '') || undefined,
    };
}

function createClient(): McpClient | undefined {
    const s = readSettings();
    if (!s.enabled) return undefined;
    return new McpClient({
        endpoint: s.endpoint,
        timeoutMs: s.timeoutMs,
        authToken: s.authToken,
    });
}

async function runScriptCommand(): Promise<void> {
    const settings = readSettings();
    if (!settings.enabled) {
        const choice = await window.showInformationMessage(
            'Enma MCP is disabled. Enable `enma.mcp.enabled` to run scripts via the engine.',
            'Open Settings',
        );
        if (choice === 'Open Settings') {
            commands.executeCommand('workbench.action.openSettings', 'enma.mcp');
        }
        return;
    }

    const editor = window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'enma') {
        window.showErrorMessage('Enma: open an .em file first.');
        return;
    }

    const source = editor.document.getText();
    const oc = getOutput();
    oc.show(true);
    oc.appendLine(`[mcp] POST ${settings.endpoint}  (${source.length} bytes)`);

    const client = createClient();
    if (!client) return;
    try {
        const result = await client.callTool('script/execute', { source, uri: editor.document.uri.toString() });
        oc.appendLine(`[mcp] result: ${JSON.stringify(result)}`);
    } catch (e) {
        const msg = (e as Error).message;
        oc.appendLine(`[mcp] error: ${msg}`);
        window.showErrorMessage(`Enma MCP run failed: ${msg}`);
    }
}

interface EngineDiagnostic {
    line: number;
    character: number;
    endLine?: number;
    endCharacter?: number;
    severity?: 'error' | 'warning' | 'info' | 'hint';
    message: string;
    code?: string;
}

function toDiagnostic(d: EngineDiagnostic): Diagnostic {
    const startLine = Math.max(0, d.line);
    const startChar = Math.max(0, d.character);
    const endLine = d.endLine ?? startLine;
    const endChar = d.endCharacter ?? Math.max(startChar + 1, startChar);
    const sev = d.severity === 'warning' ? DiagnosticSeverity.Warning
        : d.severity === 'info' ? DiagnosticSeverity.Information
        : d.severity === 'hint' ? DiagnosticSeverity.Hint
        : DiagnosticSeverity.Error;
    const diag = new Diagnostic(new Range(startLine, startChar, endLine, endChar), d.message, sev);
    diag.source = 'enma-mcp';
    if (d.code) diag.code = d.code;
    return diag;
}

async function validateOnSave(doc: TextDocument): Promise<void> {
    const client = createClient();
    if (!client) return;

    const source = doc.getText();
    let result: unknown;
    try {
        result = await client.callTool('script/validate', { source, uri: doc.uri.toString() });
    } catch (e) {
        // Errors during background validation should NOT spam toasts. Log only.
        getOutput().appendLine(`[mcp] validate failed: ${(e as Error).message}`);
        getDiagnostics().set(doc.uri, []);
        return;
    }

    const arr = extractDiagnostics(result);
    getDiagnostics().set(doc.uri, arr.map(toDiagnostic));
}

function extractDiagnostics(raw: unknown): EngineDiagnostic[] {
    if (!raw || typeof raw !== 'object') return [];
    const wrap = raw as { diagnostics?: unknown; content?: unknown };
    if (Array.isArray(wrap.diagnostics)) return wrap.diagnostics as EngineDiagnostic[];
    if (Array.isArray(wrap.content)) {
        // Some MCP servers wrap arbitrary content in a tools/call envelope.
        const inner = (wrap.content as Array<{ type?: string; text?: string }>)
            .filter(c => c.type === 'text' && typeof c.text === 'string')
            .map(c => {
                try { return JSON.parse(c.text as string); }
                catch { return undefined; }
            })
            .filter(x => x && typeof x === 'object') as Array<{ diagnostics?: EngineDiagnostic[] }>;
        for (const entry of inner) {
            if (Array.isArray(entry.diagnostics)) return entry.diagnostics;
        }
    }
    return [];
}

export function registerEngineMcp(context: ExtensionContext): void {
    context.subscriptions.push(
        commands.registerCommand('enma.runScript', runScriptCommand),
        workspace.onDidSaveTextDocument(doc => {
            if (doc.languageId !== 'enma') return;
            // Run asynchronously; we intentionally don't await so saves stay fast.
            validateOnSave(doc).catch(() => {/* logged inside validateOnSave */});
        }),
    );
}
