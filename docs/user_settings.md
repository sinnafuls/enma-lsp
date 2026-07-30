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

| Setting | Default | Description |
|---|---|---|
| `enma.mcp.enabled` | `false` | Enable Run Script / on-save validate. |
| `enma.mcp.endpoint` | — | Perception MCP HTTP endpoint. |
| `enma.mcp.timeoutMs` | number | Per-call timeout. |
| `enma.mcp.authToken` | — | Optional bearer token. |

## Multi-editor

The language server is stdio-capable. See [`standalone-lsp.md`](./standalone-lsp.md)
for Claude Code, Neovim, Helix, Zed, Sublime, Emacs, and JetBrains setups.

## Docs

- Host APIs: https://docs.perception.cx/perception/
- Enma language: https://docs.perception.cx/perception/enma-lang/
