// CodeLens provider — context-aware action chips above declarations.
//
// Two lens kinds (matching existing client commands):
//   "▶ Run with MCP"  — on every top-level function; triggers enma.runScript
//   "📦 Bundle"       — once at line 0 of each file; triggers enma.bundle
//
// Both are pre-resolved (command field set). Client-side: the commands
// `enma.runScript` and `enma.bundle` are registered in client/src/runScript.ts
// and client/src/bundler.ts respectively.
//
// resolveProvider is false (no second round-trip needed).

import * as lsp from 'vscode-languageserver';

import { NodeScript, NodeKind } from '../compiler_parser/nodes';

export function provideCodeLens(ast: NodeScript, uri: string): lsp.CodeLens[] {
    const out: lsp.CodeLens[] = [];

    // "Bundle" at the top of every .em file.
    out.push({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        command: {
            title: '$(package) Bundle',
            command: 'enma.bundle',
            arguments: [uri],
        },
    });

    // "Run with MCP" above each top-level function / coroutine.
    for (const child of ast.children) {
        if (child.kind !== NodeKind.Function && child.kind !== NodeKind.Coroutine) continue;
        const name = 'name' in child ? child.name : undefined;
        if (name === undefined) continue;
        out.push({
            range: {
                start: { line: child.range.start.line, character: child.range.start.character },
                end: { line: child.range.start.line, character: child.range.end.character },
            },
            command: {
                title: '$(run) Run with MCP',
                command: 'enma.runScript',
                arguments: [uri, (name as { text: string }).text],
            },
        });
    }

    return out;
}
