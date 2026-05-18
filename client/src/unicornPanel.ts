// `Enma: Unicorn Reference Panel` — a static reference card webview for the
// Unicorn CPU emulator bindings Perception ships under `import "unicorn";`.

import { ExtensionContext, ViewColumn, WebviewPanel, commands, window } from 'vscode';

let s_panel: WebviewPanel | undefined;

export function registerUnicornPanel(context: ExtensionContext): void {
    context.subscriptions.push(
        commands.registerCommand('enma.unicorn.panel', () => openPanel()),
    );
}

function openPanel(): void {
    if (s_panel) {
        s_panel.reveal(ViewColumn.Beside);
        return;
    }
    s_panel = window.createWebviewPanel(
        'enmaUnicornPanel',
        'Enma Unicorn Reference',
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
<title>Unicorn Reference</title>
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
<h1>Unicorn Reference</h1>
<p>Quick reference for <code>import "unicorn";</code> — Perception's Unicorn CPU emulator bindings.</p>

<h2>cpu_t setup</h2>
<table>
<tr><th>Member</th><th>Notes</th></tr>
<tr><td><code>arch</code></td><td><code>0</code> = x86, <code>1</code> = arm64.</td></tr>
<tr><td><code>mode</code></td><td>For x86: <code>16</code> / <code>32</code> / <code>64</code>. For arm64: <code>0</code>.</td></tr>
<tr><td><code>memory_map[]</code></td><td>List of <code>{base, size, perms}</code> tuples.</td></tr>
<tr><td><code>registers</code></td><td>Map from register-name string → uint64.</td></tr>
</table>

<h2>Memory permission flags</h2>
<table>
<tr><th>Flag</th><th>Value</th></tr>
<tr><td><code>UC_PROT_READ</code></td><td><code>1</code></td></tr>
<tr><td><code>UC_PROT_WRITE</code></td><td><code>2</code></td></tr>
<tr><td><code>UC_PROT_EXEC</code></td><td><code>4</code></td></tr>
<tr><td><code>UC_PROT_ALL</code></td><td><code>7</code></td></tr>
</table>

<h2>Minimal emulator</h2>
<pre>import "unicorn";

cpu_t cpu;
cpu.arch = 0;
cpu.mode = 64;
cpu.memory_map = {
    { base: 0x1000, size: 0x4000, perms: 7 },
    { base: 0x10000, size: 0x4000, perms: 7 },
};

// Stage instructions at 0x1000.
uint8[] code = { 0x48, 0xC7, 0xC0, 0x2A, 0x00, 0x00, 0x00 };  // mov rax, 0x2A
cpu_write(cpu, 0x1000, code);

// Set RSP and run.
cpu.registers["rsp"] = 0x10000 + 0x2000;
cpu_run(cpu, 0x1000, 0x1000 + code.length);

// Read RAX.
uint64 rax = cpu.registers["rax"];
println(f"rax = 0x{rax:016X}");</pre>

<h2>Common register names</h2>
<table>
<tr><th>x86 (64-bit)</th><th>arm64</th></tr>
<tr><td><code>rax rbx rcx rdx rsi rdi rbp rsp r8 … r15 rip rflags</code></td>
    <td><code>x0 … x30 sp pc cpsr</code></td></tr>
</table>

<h2>Hook patterns</h2>
<pre>// Hook every executed instruction.
cpu_hook_code(cpu, [](cpu_t@ uc, uint64 addr, int32 size) {
    println(f"trace {addr:016X}  size={size}");
});

// Hook unmapped accesses.
cpu_hook_invalid(cpu, [](cpu_t@ uc, int32 type, uint64 addr) {
    println(f"invalid {type} at {addr:016X}");
});</pre>
</body>
</html>`;
}
