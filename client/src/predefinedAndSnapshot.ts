// Two small editor productivity commands matching VoidChecksum's parity set:
//
//   enma.predefined.edit  — open (creating if necessary) the workspace
//                            em.predefined file. Seeded with a header comment
//                            and a `// add your shared types here` placeholder.
//
//   enma.snapshot.diff    — prompt for a snapshot path and open a native
//                            vscode.diff against the active editor.

import * as fs from 'fs';
import * as path from 'path';
import {
    ExtensionContext,
    Uri,
    commands,
    window,
    workspace,
} from 'vscode';

const PREDEFINED_HEADER = [
    '// em.predefined — workspace-shared declarations for Enma.',
    '//',
    '// Anything you declare here is visible across every .em file in this',
    '// workspace without an explicit `#include`. Use it for cross-cutting',
    '// types, shared globals, and FFI signatures.',
    '//',
    '// Tag user-defined names that intentionally shadow the bundled stdlib',
    '// with [[shadow]] to suppress the predefined-collision diagnostic.',
    '',
].join('\n');

function workspaceRootFsPath(): string | undefined {
    const folders = workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    return folders[0].uri.fsPath;
}

async function predefinedEditCommand(): Promise<void> {
    const root = workspaceRootFsPath();
    if (!root) {
        window.showErrorMessage('Enma: open a workspace folder first.');
        return;
    }
    const file = path.join(root, 'em.predefined');
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, PREDEFINED_HEADER, 'utf8');
        window.showInformationMessage(`Enma: created ${path.relative(root, file)}.`);
    }
    const doc = await workspace.openTextDocument(Uri.file(file));
    await window.showTextDocument(doc);
}

async function snapshotDiffCommand(): Promise<void> {
    const editor = window.activeTextEditor;
    if (!editor) {
        window.showErrorMessage('Enma: open a file first.');
        return;
    }
    const picks = await window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Diff against this file',
        filters: { 'Enma files': ['em'], 'All files': ['*'] },
    });
    if (!picks || picks.length === 0) return;
    const snapshot = picks[0];
    if (!fs.existsSync(snapshot.fsPath)) {
        window.showErrorMessage(`Enma: snapshot not found at ${snapshot.fsPath}.`);
        return;
    }
    await commands.executeCommand(
        'vscode.diff',
        snapshot,
        editor.document.uri,
        `Snapshot ↔ ${path.basename(editor.document.uri.fsPath)}`,
    );
}

export function registerPredefinedAndSnapshot(context: ExtensionContext): void {
    context.subscriptions.push(
        commands.registerCommand('enma.predefined.edit', predefinedEditCommand),
        commands.registerCommand('enma.snapshot.diff', snapshotDiffCommand),
    );
}
