// `Enma: AOB Pattern Explorer` — a webview that lets the user paste an
// IDA-style hex pattern (e.g. `48 8B 05 ? ? ? ? 48 89 03`) and renders the
// byte breakdown side-by-side: hex, decimal, and a flag for wildcard slots.
//
// The webview ships its own tiny script bundle inline behind a nonce-based
// CSP. No external resources are loaded.

import { ExtensionContext, ViewColumn, WebviewPanel, commands, window } from 'vscode';

let s_panel: WebviewPanel | undefined;

export function registerAobExplorer(context: ExtensionContext): void {
    context.subscriptions.push(
        commands.registerCommand('enma.aob.explore', () => openPanel()),
    );
}

function openPanel(): void {
    if (s_panel) {
        s_panel.reveal(ViewColumn.Beside);
        return;
    }
    s_panel = window.createWebviewPanel(
        'enmaAobExplorer',
        'Enma AOB Pattern Explorer',
        ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        },
    );
    s_panel.webview.html = renderHtml();
    s_panel.onDidDispose(() => { s_panel = undefined; });
}

function renderHtml(): string {
    const nonce = makeNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>AOB Pattern Explorer</title>
<style>
  body { font: 13px/1.5 var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 1rem 1.5rem; }
  h1   { font-size: 1.3rem; margin: 0 0 0.5rem; }
  p    { color: var(--vscode-descriptionForeground); }
  textarea { width: 100%; height: 4.5rem; font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #333); padding: 0.4rem 0.6rem; box-sizing: border-box; }
  table { border-collapse: collapse; margin-top: 0.8rem; font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; }
  th, td { border: 1px solid var(--vscode-panel-border, #333); padding: 0.25rem 0.55rem; text-align: left; }
  th     { background: var(--vscode-sideBar-background); }
  td.wild { color: var(--vscode-errorForeground); font-style: italic; }
  .stats { margin-top: 0.6rem; }
  .stats span { display: inline-block; margin-right: 1rem; }
  code   { background: var(--vscode-textCodeBlock-background); padding: 0 0.25rem; border-radius: 2px; }
</style>
</head>
<body>
<h1>AOB Pattern Explorer</h1>
<p>Paste an IDA-style hex pattern below. <code>?</code> or <code>??</code> = wildcard.
Tokens separated by whitespace. Example: <code>48 8B 05 ? ? ? ? 48 89 03</code>.</p>
<textarea id="pattern" placeholder="48 8B 05 ? ? ? ? 48 89 03"></textarea>
<div class="stats" id="stats"></div>
<table id="out"><thead><tr><th>#</th><th>hex</th><th>dec</th><th>wildcard?</th></tr></thead><tbody></tbody></table>

<script nonce="${nonce}">
(function() {
    const ta = document.getElementById('pattern');
    const tbody = document.querySelector('#out tbody');
    const stats = document.getElementById('stats');

    function render() {
        const tokens = ta.value.trim().split(/\\s+/).filter(t => t.length > 0);
        tbody.innerHTML = '';
        let wildcards = 0;
        let invalid = 0;
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            const isWild = t === '?' || t === '??';
            const isValid = isWild || /^[0-9A-Fa-f]{1,2}$/.test(t);
            if (!isValid) invalid++;
            if (isWild) wildcards++;
            const tr = document.createElement('tr');
            const td = (txt, cls) => { const el = document.createElement('td'); el.textContent = txt; if (cls) el.className = cls; return el; };
            tr.appendChild(td(String(i + 1)));
            tr.appendChild(td(isWild ? '??' : t.toUpperCase().padStart(2, '0'), isWild ? 'wild' : null));
            tr.appendChild(td(isWild ? '—' : String(parseInt(t, 16)), isWild ? 'wild' : null));
            tr.appendChild(td(isWild ? 'yes' : 'no', isWild ? 'wild' : null));
            tbody.appendChild(tr);
        }
        stats.innerHTML = '';
        const make = (label, value) => { const s = document.createElement('span'); s.textContent = label + ': ' + value; return s; };
        stats.appendChild(make('tokens', tokens.length));
        stats.appendChild(make('wildcards', wildcards));
        if (invalid > 0) {
            const warn = document.createElement('span');
            warn.style.color = 'var(--vscode-errorForeground)';
            warn.textContent = 'invalid: ' + invalid;
            stats.appendChild(warn);
        }
    }
    ta.addEventListener('input', render);
    render();
})();
</script>
</body>
</html>`;
}

function makeNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
}
