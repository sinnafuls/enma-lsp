// Perception docs opener — angel-lsp-pcx 1:1 (Enma swap).
//
// Primary action opens the live docs in the browser (same as angel-lsp-pcx).
// Optional in-extension webview remains available as `enma.openDocsPanel`.

import * as fs from 'fs';
import * as path from 'path';
import {
    commands,
    env,
    ExtensionContext,
    Uri,
    ViewColumn,
    window,
    WebviewPanel,
} from 'vscode';

let panel: WebviewPanel | undefined;

const DOCS_HOME = 'https://docs.perception.cx/perception/';
const DOCS_LANG = 'https://docs.perception.cx/perception/enma-lang/';

export function registerDocsViewer(context: ExtensionContext): void {
    context.subscriptions.push(
        // angel-lsp-pcx parity: open live Perception docs in the browser
        commands.registerCommand('enma.openDocs', () =>
            env.openExternal(Uri.parse(DOCS_HOME)),
        ),
        commands.registerCommand('enma.openLangDocs', () =>
            env.openExternal(Uri.parse(DOCS_LANG)),
        ),
        commands.registerCommand('enma.openDocsPanel', () => showDocsPanel(context)),
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
    try {
        panel.webview.html = fs.readFileSync(htmlPath, 'utf8');
    } catch {
        panel.webview.html = `<html><body style="font-family:sans-serif;padding:1.5rem">
            <h2>Perception API docs</h2>
            <p>Bundled HTML missing. Open the live docs instead:</p>
            <ul>
              <li><a href="${DOCS_HOME}">${DOCS_HOME}</a></li>
              <li><a href="${DOCS_LANG}">${DOCS_LANG}</a></li>
            </ul>
        </body></html>`;
    }

    panel.onDidDispose(() => {
        panel = undefined;
    });
}
