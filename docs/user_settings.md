# Enma LSP user settings

Settings live under the `enma.*` namespace (VS Code: **Enma: View Settings**).

## Indexing & projects

| Setting | Default | Description |
|---|---|---|
| `enma.projects` | `[]` | Multi-project workspaces. Each entry: `sourceDirectory`, `outputFile`, optional `stripComments`, optional `lspMode`. |
| `enma.indexExclude` | (globs) | Paths skipped when indexing. |
| `enma.indexCache.maxClosedFiles` | number | How many closed files stay in the analysis cache. |
| `enma.implicitMutualInclusion` | bool | Mutual include of siblings (angel-style). |
| `enma.forceIncludePredefined` | `[]` | Extra `.em.predefined` paths (forceInclude precedence). |
| `enma.predefined.walkUpDepth` | number | Parent dirs to scan for workspace predefined. |

## Analyzer / parser

| Setting | Default | Description |
|---|---|---|
| `enma.parser.strict` | `false` | Stricter parse diagnostics. |
| `enma.analyzer.parity` | — | Analyzer parity toggles. |
| `enma.diagnostics.predefinedCollisionSeverity` | `information` | `warning` \| `information` \| `off` for shadow diagnostics. |
| `enma.preprocessor.maxIncludeDepth` | number | `#include` depth cap. |
| `enma.permissions.ffi` | bool | Treat FFI as granted for permission-gate hints. |
| `enma.permissions.file` | bool | Treat file addon as granted for permission-gate hints. |

## Formatter

| Setting | Default | Description |
|---|---|---|
| `enma.formatter.enabled` | `true` | Document formatting. |
| `enma.formatter.indentSpaces` | `4` | Indent width when not using tabs. |
| `enma.formatter.useTabIndent` | `false` | Tabs instead of spaces. |
| `enma.formatter.maxBlankLines` | number | Collapse runs of blank lines. |
| `enma.formatter.bracePosition` | — | Brace style. |
| `enma.formatter.spaceAfterComma` | bool | |
| `enma.formatter.spaceAroundBinaryOp` | bool | |
| `enma.formatter.alignDesignatedInit` | bool | |
| `enma.formatter.fStringPreserveVerbatim` | bool | |

## Bundler

| Setting | Default | Description |
|---|---|---|
| `enma.bundler.sourceDirectory` | `source` | Default project source root. |
| `enma.bundler.outputFile` | `output/bundled.em` | Default bundle output. |
| `enma.bundler.stripComments` | `true` | Strip comments in bundle. |
| `enma.bundler.bundleOnSave` | `false` | Debounced rebundle on `.em` save. |

## Engine MCP

Docs: https://docs.perception.cx/perception/mcp-api.md

| Setting | Default | Description |
|---|---|---|
| `enma.mcp.enabled` | `false` | Master switch for engine MCP. When on: on-save `script/validate`, Run Script, Validate, Get Context, and RE commands. |
| `enma.mcp.endpoint` | `http://127.0.0.1:9077/mcp` | Perception MCP HTTP endpoint. |
| `enma.mcp.timeoutMs` | `5000` | Per-call timeout (ms). |
| `enma.mcp.authToken` | `""` | Optional bearer token. |

### Commands (also on status-bar menus)

| Command | MCP tool / action |
|---|---|
| `Enma: Run Script (MCP)` (`Ctrl+Alt+R`) | `script/execute` |
| `Enma: Validate Script (MCP)` (`Ctrl+Alt+V`) | `script/validate` |
| `Enma: Get Engine Context (MCP)` | `script/get_context` |
| `Enma: Reconnect MCP` | Re-probe endpoint + status bar |
| `Enma: AOB / Pattern Search (MCP)` | `process/find_pattern` |
| `Enma: Disassemble (MCP)` | `process/disassemble` |
| `Enma: Lookup Symbol (MCP)` | `process/lookup_symbol` |
| `Enma: List Module Exports (MCP)` | `process/list_module_exports` |
| `Enma: AOB Pattern Explorer` | Local webview (no engine) |
| `Enma: Zydis Playground` | Local reference webview |
| `Enma: Unicorn Reference Panel` | Local reference webview |
| `Enma: Inspect .emb Binary Module` | Explorer context on `.emb` |

Engine diagnostics use the **enma-mcp** collection (separate from LSP).

## Multi-editor

The language server is stdio-capable. See [`standalone-lsp.md`](./standalone-lsp.md)
for Claude Code, Neovim, Helix, Zed, Sublime, Emacs, and JetBrains setups.

## Docs

- Host APIs: https://docs.perception.cx/perception/
- Enma language: https://docs.perception.cx/perception/enma-lang/
