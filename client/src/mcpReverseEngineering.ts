// MCP reverse-engineering commands for the Perception engine.
//
// Exposes `process/find_pattern`, `process/disassemble`, `process/lookup_symbol`,
// and `process/list_module_exports` as VS Code commands, each prompting for
// relevant inputs and streaming results to the "Enma RE" output channel.

import * as vscode from 'vscode';
import { McpClient } from './mcpClient';

let s_output: vscode.OutputChannel | undefined;

function getOutput(): vscode.OutputChannel {
    if (!s_output) s_output = vscode.window.createOutputChannel('Enma RE');
    return s_output;
}

interface ReSettings {
    endpoint: string;
    timeoutMs: number;
    authToken?: string;
}

function readSettings(): ReSettings {
    const cfg = vscode.workspace.getConfiguration('enma.mcp');
    return {
        endpoint:  cfg.get<string>('endpoint', 'http://127.0.0.1:9077/mcp'),
        timeoutMs: cfg.get<number>('timeoutMs', 5000),
        authToken: cfg.get<string>('authToken', '') || undefined,
    };
}

/** Call a Perception MCP RE tool, return the result or throw on error. */
export async function callReTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const s = readSettings();
    const client = new McpClient({ endpoint: s.endpoint, timeoutMs: s.timeoutMs, authToken: s.authToken });
    return client.callTool(toolName, args);
}

/** Open a quickpick with running process PIDs (via process/list_processes when
 *  available), or fall back to a free-text input box. Returns undefined if the
 *  user cancels, or undefined with no value if no PID is desired. */
export async function pickProcessId(): Promise<number | undefined> {
    let choices: vscode.QuickPickItem[] = [];
    try {
        const raw = await callReTool('process/list_processes', {});
        if (Array.isArray(raw)) {
            choices = (raw as Array<{ pid: number; name?: string }>).map(p => ({
                label: String(p.pid),
                description: p.name,
            }));
        }
    } catch {
        // list_processes not available — fall through to text input
    }

    if (choices.length > 0) {
        const pick = await vscode.window.showQuickPick(choices, {
            placeHolder: 'Select target process PID',
        });
        if (!pick) return undefined;
        return parseInt(pick.label, 10);
    }

    const input = await vscode.window.showInputBox({
        prompt: 'Target process PID (leave blank for default)',
        placeHolder: 'e.g. 1234',
    });
    if (input === undefined) return undefined;
    if (input.trim() === '') return undefined;
    const pid = parseInt(input.trim(), 10);
    return isNaN(pid) ? undefined : pid;
}

export async function runAobSearch(endpoint: string, timeoutMs: number): Promise<void> {
    void timeoutMs;
    const pattern = await vscode.window.showInputBox({
        prompt: 'AOB pattern (IDA-style)',
        placeHolder: '48 8B 05 ? ? ? ? 48 89 03',
    });
    if (pattern === undefined) return;

    const pid = await pickProcessId();

    const oc = getOutput();
    oc.show(true);
    oc.appendLine(`[re] POST ${endpoint}  tool=process/find_pattern`);

    const args: Record<string, unknown> = { pattern };
    if (pid !== undefined) args['pid'] = pid;

    try {
        const result = await callReTool('process/find_pattern', args);
        oc.appendLine(JSON.stringify(result, null, 2));
    } catch (e) {
        const msg = (e as Error).message;
        oc.appendLine(`[re] error: ${msg}`);
        vscode.window.showErrorMessage(`Enma AOB search failed: ${msg}`);
    }
}

export async function runDisassemble(endpoint: string, timeoutMs: number): Promise<void> {
    void timeoutMs;
    const addrInput = await vscode.window.showInputBox({
        prompt: 'Address to disassemble (hex or decimal)',
        placeHolder: '0x7FFFFFFF1234',
    });
    if (addrInput === undefined) return;

    const addrStr = addrInput.trim();
    const address = addrStr.startsWith('0x') || addrStr.startsWith('0X')
        ? parseInt(addrStr, 16)
        : parseInt(addrStr, 10);

    if (isNaN(address)) {
        vscode.window.showErrorMessage(`Enma: invalid address "${addrInput}"`);
        return;
    }

    const lengthInput = await vscode.window.showInputBox({
        prompt: 'Bytes to disassemble (leave blank for engine default)',
        placeHolder: 'e.g. 64',
    });
    if (lengthInput === undefined) return;

    const pid = await pickProcessId();

    const oc = getOutput();
    oc.show(true);
    oc.appendLine(`[re] POST ${endpoint}  tool=process/disassemble`);

    const args: Record<string, unknown> = { address };
    if (lengthInput.trim() !== '') {
        const length = parseInt(lengthInput.trim(), 10);
        if (!isNaN(length)) args['length'] = length;
    }
    if (pid !== undefined) args['pid'] = pid;

    try {
        const result = await callReTool('process/disassemble', args);
        oc.appendLine(JSON.stringify(result, null, 2));
    } catch (e) {
        const msg = (e as Error).message;
        oc.appendLine(`[re] error: ${msg}`);
        vscode.window.showErrorMessage(`Enma disassemble failed: ${msg}`);
    }
}

export async function runLookupSymbol(endpoint: string, timeoutMs: number): Promise<void> {
    void timeoutMs;
    const name = await vscode.window.showInputBox({
        prompt: 'Symbol name to resolve',
        placeHolder: 'e.g. CreateFileW',
    });
    if (name === undefined) return;

    const pid = await pickProcessId();

    const oc = getOutput();
    oc.show(true);
    oc.appendLine(`[re] POST ${endpoint}  tool=process/lookup_symbol`);

    const args: Record<string, unknown> = { name };
    if (pid !== undefined) args['pid'] = pid;

    try {
        const result = await callReTool('process/lookup_symbol', args);
        oc.appendLine(JSON.stringify(result, null, 2));
    } catch (e) {
        const msg = (e as Error).message;
        oc.appendLine(`[re] error: ${msg}`);
        vscode.window.showErrorMessage(`Enma lookup symbol failed: ${msg}`);
    }
}

export async function runListExports(endpoint: string, timeoutMs: number): Promise<void> {
    void timeoutMs;
    const moduleInput = await vscode.window.showInputBox({
        prompt: 'Module name to inspect (leave blank for all)',
        placeHolder: 'e.g. kernel32.dll',
    });
    if (moduleInput === undefined) return;

    const pid = await pickProcessId();

    const oc = getOutput();
    oc.show(true);
    oc.appendLine(`[re] POST ${endpoint}  tool=process/list_module_exports`);

    const args: Record<string, unknown> = {};
    if (moduleInput.trim() !== '') args['module'] = moduleInput.trim();
    if (pid !== undefined) args['pid'] = pid;

    try {
        const result = await callReTool('process/list_module_exports', args);
        oc.appendLine(JSON.stringify(result, null, 2));
    } catch (e) {
        const msg = (e as Error).message;
        oc.appendLine(`[re] error: ${msg}`);
        vscode.window.showErrorMessage(`Enma list exports failed: ${msg}`);
    }
}

export function registerReCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('enma.aobSearch', () => {
            const s = readSettings();
            return runAobSearch(s.endpoint, s.timeoutMs);
        }),
        vscode.commands.registerCommand('enma.disassemble', () => {
            const s = readSettings();
            return runDisassemble(s.endpoint, s.timeoutMs);
        }),
        vscode.commands.registerCommand('enma.lookupSymbol', () => {
            const s = readSettings();
            return runLookupSymbol(s.endpoint, s.timeoutMs);
        }),
        vscode.commands.registerCommand('enma.listExports', () => {
            const s = readSettings();
            return runListExports(s.endpoint, s.timeoutMs);
        }),
    );
}
