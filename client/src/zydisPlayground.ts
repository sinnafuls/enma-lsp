// `Enma: Zydis Playground` — a static reference card webview for the Zydis
// disassembler / encoder bindings Perception ships under `import "zydis";`.
//
// Pure HTML, no scripts. CSP bans script-src outright.

import { ExtensionContext, ViewColumn, WebviewPanel, commands, window } from 'vscode';

let s_panel: WebviewPanel | undefined;

export function registerZydisPlayground(context: ExtensionContext): void {
    context.subscriptions.push(
        commands.registerCommand('enma.zydis.playground', () => openPanel()),
    );
}

function openPanel(): void {
    if (s_panel) {
        s_panel.reveal(ViewColumn.Beside);
        return;
    }
    s_panel = window.createWebviewPanel(
        'enmaZydisPlayground',
        'Enma Zydis Playground',
        ViewColumn.Beside,
        { enableScripts: false, retainContextWhenHidden: true },
    );
    s_panel.webview.html = renderHtml();
    s_panel.onDidDispose(() => { s_panel = undefined; });
}

function renderHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<title>Zydis Playground</title>
<style>
  body { font: 13px/1.5 var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 1rem 1.5rem; }
  h1   { font-size: 1.3rem; margin: 0 0 0.5rem; }
  h2   { font-size: 1.05rem; margin: 1rem 0 0.4rem; }
  code, pre { font-family: var(--vscode-editor-font-family, monospace); background: var(--vscode-textCodeBlock-background); padding: 0 0.25rem; border-radius: 2px; }
  pre  { padding: 0.7rem 0.9rem; border: 1px solid var(--vscode-panel-border, #333); overflow-x: auto; }
  table { border-collapse: collapse; margin: 0.4rem 0; }
  th, td { border: 1px solid var(--vscode-panel-border, #333); padding: 0.3rem 0.65rem; text-align: left; vertical-align: top; }
  th     { background: var(--vscode-sideBar-background); }
</style>
</head>
<body>
<h1>Zydis Playground</h1>
<p>Quick reference for <code>import "zydis";</code> — Perception's Zydis disassembler bindings.</p>

<h2>zydis_req_t (decode request)</h2>
<table>
<tr><th>Field</th><th>Type</th><th>Notes</th></tr>
<tr><td><code>bytes</code></td><td><code>uint8[]</code></td><td>Raw instruction bytes.</td></tr>
<tr><td><code>address</code></td><td><code>uint64</code></td><td>Runtime address (for IP-relative decodes).</td></tr>
<tr><td><code>machine_mode</code></td><td><code>int32</code></td><td><code>0</code> = 64-bit (default), <code>1</code> = 32-bit, <code>2</code> = 16-bit.</td></tr>
</table>

<h2>zydis_builder_t (encode request)</h2>
<table>
<tr><th>Field</th><th>Type</th><th>Notes</th></tr>
<tr><td><code>mnemonic</code></td><td><code>string</code></td><td>e.g. <code>"mov"</code>, <code>"call"</code>, <code>"jmp"</code>.</td></tr>
<tr><td><code>operands</code></td><td><code>string[]</code></td><td>Each operand in AT&amp;T or Intel syntax depending on builder mode.</td></tr>
<tr><td><code>machine_mode</code></td><td><code>int32</code></td><td>Same encoding as <code>zydis_req_t.machine_mode</code>.</td></tr>
</table>

<h2>Disassemble bytes</h2>
<pre>import "zydis";

zydis_req_t req;
req.bytes = { 0x48, 0x89, 0xC3 };
req.address = 0x140001000;
req.machine_mode = 0;

string disasm = zydis_disasm(req);
println(disasm);   // mov rbx, rax</pre>

<h2>Encode an instruction</h2>
<pre>import "zydis";

zydis_builder_t b;
b.mnemonic = "mov";
b.operands = { "rax", "rcx" };
b.machine_mode = 0;

uint8[] encoded = zydis_encode(b);
print_hex(encoded);   // 48 89 C8</pre>

<h2>Walk a code stream</h2>
<pre>import "zydis";

void walk(uint8[] bytes, uint64 base) {
    uint64 cursor = base;
    int32 i = 0;
    while (i < bytes.length) {
        zydis_req_t req;
        req.bytes = bytes.slice(i, i + 15);
        req.address = cursor;
        req.machine_mode = 0;
        string s = zydis_disasm(req);
        println(f"{cursor:016X}  {s}");
        int32 len = zydis_length(req);
        i = i + len;
        cursor = cursor + cast<uint64>(len);
    }
}</pre>
</body>
</html>`;
}
