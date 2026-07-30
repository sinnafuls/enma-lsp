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

async function ensureMcpEnabled(): Promise<boolean> {
    const settings = readSettings();
    if (settings.enabled) return true;
    const choice = await window.showInformationMessage(
        'Enma MCP is disabled. Enable `enma.mcp.enabled` to talk to the Perception engine.',
        'Enable Now',
        'Open Settings',
        'Cancel',
    );
    if (choice === 'Enable Now') {
        await workspace.getConfiguration('enma.mcp').update('enabled', true, true);
        return true;
    }
    if (choice === 'Open Settings') {
        commands.executeCommand('workbench.action.openSettings', 'enma.mcp');
    }
    return false;
}

async function activeEmSource(): Promise<{ source: string; uri: string } | undefined> {
    const editor = window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'enma') {
        window.showErrorMessage('Enma: open an .em file first.');
        return undefined;
    }
    return { source: editor.document.getText(), uri: editor.document.uri.toString() };
}

async function runScriptCommand(): Promise<void> {
    if (!(await ensureMcpEnabled())) return;

    const file = await activeEmSource();
    if (!file) return;

    const settings = readSettings();
    const oc = getOutput();
    oc.show(true);
    oc.appendLine(`[mcp] script/execute  ${settings.endpoint}  (${file.source.length} bytes)`);

    const client = createClient();
    if (!client) return;
    try {
        const result = await client.callTool('script/execute', file);
        oc.appendLine(`[mcp] result: ${JSON.stringify(result, null, 2)}`);
        window.showInformationMessage('Enma MCP: script/execute completed — see "Enma MCP" output.');
    } catch (e) {
        const msg = (e as Error).message;
        oc.appendLine(`[mcp] error: ${msg}`);
        window.showErrorMessage(`Enma MCP run failed: ${msg}`);
    }
}

/** Manual validate (same tool as on-save) — always shows output. */
async function validateScriptCommand(): Promise<void> {
    if (!(await ensureMcpEnabled())) return;

    const editor = window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'enma') {
        window.showErrorMessage('Enma: open an .em file first.');
        return;
    }

    const settings = readSettings();
    const oc = getOutput();
    oc.show(true);
    oc.appendLine(`[mcp] script/validate  ${settings.endpoint}`);

    const client = createClient();
    if (!client) return;
    try {
        const result = await client.callTool('script/validate', {
            source: editor.document.getText(),
            uri: editor.document.uri.toString(),
        });
        const arr = extractDiagnostics(result);
        getDiagnostics().set(editor.document.uri, arr.map(toDiagnostic));
        oc.appendLine(`[mcp] validate: ${arr.length} diagnostic(s)`);
        for (const d of arr) {
            oc.appendLine(`  L${(d.line ?? 0) + 1}: [${d.severity ?? 'error'}] ${d.message}`);
        }
        if (arr.length === 0) {
            window.showInformationMessage('Enma MCP: script/validate clean.');
        } else {
            window.showWarningMessage(`Enma MCP: ${arr.length} diagnostic(s) — see Problems + "Enma MCP" output.`);
        }
    } catch (e) {
        const msg = (e as Error).message;
        oc.appendLine(`[mcp] validate error: ${msg}`);
        window.showErrorMessage(`Enma MCP validate failed: ${msg}`);
    }
}

/** Pull live host declarations / context once per session (docs skill path). */
async function getContextCommand(): Promise<void> {
    if (!(await ensureMcpEnabled())) return;

    const settings = readSettings();
    const oc = getOutput();
    oc.show(true);
    oc.appendLine(`[mcp] script/get_context  ${settings.endpoint}`);

    const client = createClient();
    if (!client) return;
    try {
        const result = await client.callTool('script/get_context', {});
        oc.appendLine(`[mcp] get_context:\n${JSON.stringify(result, null, 2)}`);
        window.showInformationMessage('Enma MCP: script/get_context — see "Enma MCP" output.');
    } catch (e) {
        const msg = (e as Error).message;
        oc.appendLine(`[mcp] get_context error: ${msg}`);
        window.showErrorMessage(`Enma MCP get_context failed: ${msg}`);
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
        commands.registerCommand('enma.validateScript', validateScriptCommand),
        commands.registerCommand('enma.getContext', getContextCommand),
        workspace.onDidSaveTextDocument(doc => {
            if (doc.languageId !== 'enma') return;
            // Run asynchronously; we intentionally don't await so saves stay fast.
            validateOnSave(doc).catch(() => {/* logged inside validateOnSave */});
        }),
        // Clear engine diagnostics when the document closes.
        workspace.onDidCloseTextDocument(doc => {
            getDiagnostics().delete(doc.uri);
        }),
    );
}
