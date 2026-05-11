// In-extension viewer for the Perception API docs.
//
// The bundled file at client/resources/perception-docs.html is the
// pre-stripped, themable output of `scripts/build-perception-docs.mjs`
// — see that script for the strip pipeline.

import * as fs from 'fs';
import * as path from 'path';
import { commands, ExtensionContext, Uri, ViewColumn, window, WebviewPanel } from 'vscode';

let panel: WebviewPanel | undefined;

export function registerDocsViewer(context: ExtensionContext): void {
    context.subscriptions.push(
        commands.registerCommand('enma.openDocs', () => showDocsPanel(context)),
    );
}

function showDocsPanel(context: ExtensionContext): void {
    if (panel) {
        panel.reveal(ViewColumn.Beside);
        return;
    }

    panel = window.createWebviewPanel(
        'enmaPerceptionDocs',
        'Perception API',
        ViewColumn.Beside,
        {
            enableScripts: false,
            retainContextWhenHidden: true,
            localResourceRoots: [Uri.file(context.asAbsolutePath('client/resources'))],
        },
    );

    const htmlPath = context.asAbsolutePath(path.join('client', 'resources', 'perception-docs.html'));
    panel.webview.html = fs.readFileSync(htmlPath, 'utf8');

    panel.onDidDispose(() => { panel = undefined; });
}
