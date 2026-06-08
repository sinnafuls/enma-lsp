// .emb file inspector command.
//
// The Enma binary module format (.emb) is a proprietary SDK artifact produced
// by the host-side link() function. There is no script-level access to it and
// no documented magic number in the public Enma docs, so this command provides
// a practical debugging view: file size, the first 128 bytes as a hex dump, and
// whether the filename matches what the bundler would produce.
//
// Command: enma.inspectEmb
//   - Works on the active editor file if it is .emb, or prompts for a file.
//   - Outputs to the "Enma .emb" output channel.

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

let channel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
    channel ??= vscode.window.createOutputChannel('Enma .emb');
    return channel;
}

function hexDump(bytes: Buffer, maxBytes = 128): string {
    const lines: string[] = [];
    const n = Math.min(bytes.length, maxBytes);
    for (let i = 0; i < n; i += 16) {
        const chunk = bytes.slice(i, Math.min(i + 16, n));
        const hex = [...chunk].map((b) => b.toString(16).padStart(2, '0')).join(' ');
        const ascii = [...chunk].map((b) => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
        lines.push(`  ${i.toString(16).padStart(4, '0')}  ${hex.padEnd(47)}  ${ascii}`);
    }
    if (bytes.length > maxBytes) lines.push(`  … (${bytes.length - maxBytes} more bytes)`);
    return lines.join('\n');
}

export async function inspectEmb(fileUri?: vscode.Uri): Promise<void> {
    let targetPath: string | undefined;
    if (fileUri !== undefined) {
        targetPath = fileUri.fsPath;
    } else {
        const active = vscode.window.activeTextEditor?.document.uri;
        if (active && active.fsPath.endsWith('.emb')) {
            targetPath = active.fsPath;
        } else {
            const picked = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectMany: false,
                filters: { 'Enma Binary': ['emb'] },
                title: 'Select .emb file to inspect',
            });
            targetPath = picked?.[0]?.fsPath;
        }
    }

    if (targetPath === undefined) return;

    let buf: Buffer;
    try {
        buf = fs.readFileSync(targetPath);
    } catch (err) {
        vscode.window.showErrorMessage(`Cannot read ${targetPath}: ${err}`);
        return;
    }

    const ch = getChannel();
    ch.clear();
    ch.appendLine(`─── Enma Binary Module Inspector ─────────────────────────────────`);
    ch.appendLine(`File       : ${targetPath}`);
    ch.appendLine(`Basename   : ${path.basename(targetPath)}`);
    ch.appendLine(`Size       : ${buf.length.toLocaleString()} bytes`);
    ch.appendLine('');
    ch.appendLine(`Hex dump (first ${Math.min(128, buf.length)} bytes):`);
    ch.appendLine(hexDump(buf));
    ch.appendLine('');
    ch.appendLine('Note: The .emb format is a proprietary SDK artifact produced by the');
    ch.appendLine('host-side link() function and is not human-readable at the script level.');
    ch.appendLine('To load and use this module, call link(engine, path) from host code.');
    ch.show(true);
}

export function registerEmbInspector(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('enma.inspectEmb', (fileUri?: vscode.Uri) =>
            inspectEmb(fileUri),
        ),
    );
}
