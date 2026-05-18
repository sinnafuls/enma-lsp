# Enma Language Support

Full LSP, syntax highlighting, debugger, bundler, and IDE tooling for [Enma](https://enma-1.gitbook.io/enma) — the JIT-compiled scripting language with C-style syntax, multi-inheritance, templates, exceptions, RAII, and a serialized `.emb` binary format. Built primarily for [Perception](https://docs.perception.cx/perception/enma) script authoring, but the language server works on any Enma project.

- **VS Code & VS Code forks** — ships as a packaged extension (`enma-language.vsix`).
- **Neovim, Helix, Zed, Sublime, Emacs, JetBrains, Cursor, Antigravity, Claude Code, OpenCode, Copilot CLI** — drive the stock stdio server directly. See [`docs/standalone-lsp.md`](docs/standalone-lsp.md).
- 1003 passing unit tests, 900 stdlib entries indexed, 100% formatter idempotency on the showcase corpus.

---

## Highlights

| | |
|---|---|
| Full LSP services | completion, hover, signature help, go-to-def, references, rename, workspace/document symbols, semantic tokens, code actions, inlay hints, folding, diagnostics |
| Idempotent formatter | brace style, indent, comma/operator spacing, designated-init alignment, f-string verbatim preservation |
| Engine MCP integration | on-save `script/validate` against a running Perception engine, `Enma: Run Script (MCP)` |
| DAP debugger | attach proxy for the Enma SDK's published TCP DAP server (default `localhost:27979`) |
| Bundler | recursive `#include` resolver, `#pragma once`, comment stripping, bundle-on-save, multi-project workflows |
| Scaffolding | `Enma: Scaffold From Template…`, `Enma: Generate CI Workflow`, `Enma: Initialize Project` |
| Reference tooling | in-extension Perception API docs viewer, AOB explorer, Zydis playground, Unicorn reference panel |
| Per-project config | multiple `enma.projects` with isolated source dirs, `lspMode: "full" | "syntaxOnly"`, `.em.predefined` walk-up |

---

## Features

### Language services

- **Completion** — stdlib globals, types, factories, methods; user-defined symbols across the workspace; namespace members after `::`, locals inside functions; closure captures and lambda params.
- **Hover** — real signatures for every stdlib name; user-defined symbol signatures; keyword/type docs fallback; documentation pulled from upstream Enma + Perception MCP catalogues.
- **Signature help** — triggered on `(` and `,`; highlights active parameter; lists all overloads with descriptions.
- **Go-to-definition / find references / rename** — across `.em` files and through `#include` chains.
- **Workspace symbols** — `Ctrl+T` / `Cmd+T` searches user-defined symbols across all `.em` files with exact / prefix / substring scoring.
- **Document symbols** — Outline panel + breadcrumbs show namespaces → members, classes → methods/fields, enums → values.
- **Semantic tokens** — global vs local variable coloring, user-defined types painted teal, functions yellow, intrinsics highlighted.
- **Code actions** — auto-import (`vec`, `color`, `math3d`, `regex`, `json`, `time`, `thread`, `atomic`, `file`); quick-fixes from analyzer diagnostics.
- **Inlay hints** — parameter names at call sites.
- **Diagnostics** — unknown types, shadowed-predefined warnings (configurable severity), strict-mode kill-rule rejection (`enma.parser.strict`), permission gates (`[[dll(...)]]` / file IO).
- **Folding** — brace pairs, block comments, line-comment runs, `#region`/`#endregion`.

### Stdlib & predefined coverage

- **900 stdlib entries** from the upstream Enma reference: 21 types (`array`, `map`, `list`, `imap`, `hash_set`, `sorted_map`, `vec2/3/4`, `mat4`, `quat`, `variant`, `string`, `regex`, `json_value`, `file_t`, `mutex`, `cond_var`, `atomic_int32/64`, `coroutine_t`, `lock_guard`), 534 free functions, plus all factories and methods.
- **Full Perception host API** — proc, render (with the new `color.with_alpha`), CPU, GUI, input, win, net, sound, unicorn, zydis, lifecycle, MCP. Synced from the [`perception-docs` MCP catalogue](docs/docs-mcp-sync.md).
- **Workspace `.em.predefined`** — projects can add their own declarations; precedence is `workspace > forceInclude > bundled`. Walk-up discovery scans parent directories (depth-bounded by `enma.predefined.walkUpDepth`).

### Bundler

A recursive `#include` resolver that flattens an Enma project into a single `.em` file ready for `enma::compile()` ingest.

- Resolves `#include "path"` against the includer's directory, then the entry's directory.
- `#pragma once` deduplicates; circular includes warn and skip.
- `--strip` removes line and block comments while preserving string literals.
- Multi-project support via `enma.projects`.
- Optional `bundleOnSave` (debounced 750ms) — every save re-bundles the active project.

### Engine MCP integration

Talk directly to a running Perception engine over the [MCP API](https://docs.perception.cx/perception/enma/mcp-api):

- **On-save validation** — when `enma.mcp.enabled` is `true`, every save runs `script/validate` against the engine; engine diagnostics show up in a dedicated `enma-mcp` Problems collection, separate from LSP diagnostics.
- **`Enma: Run Script (MCP)`** — posts the active script (or the bundled output) to the engine's `script/execute`.
- Configurable endpoint, bearer token, and timeout — point at `http://127.0.0.1:9077/mcp` by default.

### Debugger (DAP attach)

`Enma Debugger (DAP)` debug type ships as an attach-only proxy that connects to the Enma SDK's published TCP DAP server.

```jsonc
// .vscode/launch.json
{
  "type": "enma-lsp-dap",
  "request": "attach",
  "name": "Attach to Enma DAP server",
  "address": "localhost",
  "port": 27979
}
```

The server-side DAP implementation is owned upstream; this extension provides the editor surface (breakpoints, attach config, debugger contribution).

### Reference panels

Script-free webviews shipped inside the extension — no internet required:

- **`Enma: Open Perception API Docs`** — browse the full Perception API reference in a side-panel webview.
- **`Enma: AOB Pattern Explorer`** — live IDA-style hex pattern decoder (hex / decimal / wildcard breakdown). Strict nonce-CSP.
- **`Enma: Zydis Playground`** — reference card for `import "zydis";` — mnemonic / register / operand types.
- **`Enma: Unicorn Reference Panel`** — reference card for `import "unicorn";` — registers, protection flags, hooks.

### Templates & scaffolding

- **`Enma: Initialize Project`** — scaffolds `source/main.em` + `.vscode/tasks.json` with sensible defaults.
- **`Enma: Scaffold From Template…`** — two starter templates: `perception-minimal` and `perception-multi`. Templates inline into the bundle; no resource pipeline.
- **`Enma: Generate CI Workflow`** — writes `.github/workflows/enma.yml` that bundles every project on PR and uploads the output as a workflow artifact.
- **`Enma: Edit Project em.predefined`** — creates `em.predefined` at the workspace root with a seed header on first run, then opens it.
- **`Enma: Diff Current File With Snapshot…`** — picks a snapshot via the native file dialog, opens VS Code's diff view against the active editor.

### Format / lint

- **Document formatter** — opt-out via `enma.formatter.enabled`. 100% idempotency on the showcase corpus (AC-11), 30/30 f-string verbatim preservation tests.
- **Snippets** — ~20 language patterns + 50 stdlib snippets (math, vec, `list`/`imap`, `mat4`/`quat`, time, file, regex, json, mutex, atomic, coroutine, annotations).

### File type handling

- `.em` — source files, `enma` language id, full LSP services.
- `.em.predefined` / `em.predefined` — declaration files (no bodies); same grammar.
- `.emb` — binary marker so VS Code doesn't try to render the serialized format as text.

---

## Install

### VS Code & VS Code forks

The marketplace listing is in flight. For now grab the latest VSIX from [Releases](https://github.com/sinnafuls/enma-lsp/releases):

```sh
code --install-extension enma-language-1.1.17.vsix
# Cursor:
cursor --install-extension enma-language-1.1.17.vsix
# Antigravity:
antigravity --install-extension enma-language-1.1.17.vsix
```

Or from the UI: `Extensions` → `…` menu → `Install from VSIX…`.

### Other editors & AI agents

The language server is a stock stdio LSP — it's not tied to VS Code. The launcher at `bin/enma-language-server.js` auto-injects `--stdio` when no transport flag is supplied.

```sh
git clone https://github.com/sinnafuls/enma-lsp.git
cd enma-lsp
npm install && npm run compile
export ENMA_LSP_PATH="$PWD/bin/enma-language-server.js"
```

Then point your editor at `node $ENMA_LSP_PATH`. Setup snippets for **Neovim** (multiple paths), **Helix**, **Zed**, **Sublime LSP**, **Emacs**, **JetBrains via LSP4IJ**, **Claude Code**, **OpenCode**, **Copilot CLI**, and **Cursor / Antigravity** live in [`docs/standalone-lsp.md`](docs/standalone-lsp.md).

The bundled `perception.em.predefined` ships inside the server, so IntelliSense for every Perception API works out of the box.

---

## Quick start

1. **`Enma: Initialize Project`** (`Ctrl+Shift+P`) — scaffolds `source/main.em` + `.vscode/tasks.json`.
2. Edit `source/main.em` (add more files with `#include "…"` as needed).
3. **`Ctrl+Alt+B`** (`Cmd+Alt+B` on macOS) bundles the project. Output → `output/bundled.em` by default.
4. Optional: enable `enma.bundler.bundleOnSave` so every `.em` save re-bundles automatically.

---

## Commands

All commands are in the `Enma:` category in the command palette.

| Command | Default keybinding | What it does |
|---|---|---|
| `Bundle current project` | `Ctrl+Alt+B` | Bundle using the current `enma.bundler.*` settings |
| `Bundle current project (strip)` | `Ctrl+Alt+Shift+B` | Same, but strip line and block comments |
| `Bundle a configured project` | — | Pick from `enma.projects` |
| `Bundle all configured projects` | — | Run every entry in `enma.projects` |
| `Initialize Project` | — | Scaffold `source/main.em` + `.vscode/tasks.json` |
| `Scaffold From Template…` | — | Pick `perception-minimal` / `perception-multi` |
| `Generate CI Workflow` | — | Writes `.github/workflows/enma.yml` |
| `Edit Project em.predefined` | — | Create + open the workspace `em.predefined` |
| `Run Script (MCP)` | — | POST the active script to a Perception engine MCP server |
| `Diff Current File With Snapshot…` | — | Pick a snapshot file, open VS Code's diff view |
| `Open Perception API Docs` | — | In-extension docs webview |
| `AOB Pattern Explorer` | — | Live hex / decimal / wildcard pattern decoder |
| `Zydis Playground` | — | Reference card for `import "zydis";` |
| `Unicorn Reference Panel` | — | Reference card for `import "unicorn";` |

### CLI tasks

```jsonc
{
  "type": "enma-bundle",
  "src": "source/main.em",
  "out": "output/bundled.em",
  "strip": false
}
```

Or directly:

```sh
node scripts/bundler.mjs <srcEntry.em> <out.em> [--strip]
```

---

## Settings reference

### Indexing & parser

| Setting | Type | Default | Description |
|---|---|---|---|
| `enma.indexCache.maxClosedFiles` | number | `300` | Max closed files in the LRU index cache (§A8) |
| `enma.preprocessor.maxIncludeDepth` | number | `64` | Max `#include` nesting depth (§A4) |
| `enma.indexExclude` | array | `["node_modules",".git","output","dist","build"]` | Directories skipped during workspace indexing |
| `enma.implicitMutualInclusion` | boolean | `false` | Every `.em` file sees every other without an explicit `#include` |
| `enma.parser.strict` | boolean | `false` | Reject all kill-rule recoveries (§A1) |

### Analyzer & diagnostics

| Setting | Type | Default | Description |
|---|---|---|---|
| `enma.analyzer.severity` | string | `"error"` | Global severity for analyzer diagnostics (`"error"` or `"warning"`) |
| `enma.diagnostics.predefinedCollisionSeverity` | string | `"information"` | Severity for "user symbol shadows bundled predefined" — `"warning"`, `"information"`, `"off"`. `[[shadow]]` always suppresses. |
| `enma.permissions.ffi` | boolean | `false` | Allow `[[dll]]` / FFI annotations without a permission error |
| `enma.permissions.file` | boolean | `false` | Allow file-system intrinsics without a permission error |

### Predefined

| Setting | Type | Default | Description |
|---|---|---|---|
| `enma.forceIncludePredefined` | array | `[]` | Additional `.em.predefined` files with forceInclude precedence |
| `enma.predefined.walkUpDepth` | number | `4` | Parent directories scanned for `.em.predefined` (0 disables) |

### Formatter

| Setting | Type | Default | Description |
|---|---|---|---|
| `enma.formatter.enabled` | boolean | `true` | Enable the document formatter |
| `enma.formatter.indentSpaces` | number | `4` | Spaces per indent level |
| `enma.formatter.useTabIndent` | boolean | `false` | Use tab for indentation instead of spaces |
| `enma.formatter.maxBlankLines` | number | `1` | Max consecutive blank lines to preserve |
| `enma.formatter.bracePosition` | string | `"sameLine"` | `"sameLine"` (K&R) or `"nextLine"` (Allman) |
| `enma.formatter.spaceAfterComma` | boolean | `true` | Space after commas |
| `enma.formatter.spaceAroundBinaryOp` | boolean | `true` | Spaces around binary operators |
| `enma.formatter.alignDesignatedInit` | boolean | `false` | Align `=` in designated initializer lists |
| `enma.formatter.fStringPreserveVerbatim` | boolean | `true` | Preserve f-string byte content verbatim |

### Bundler

| Setting | Type | Default | Description |
|---|---|---|---|
| `enma.bundler.sourceDirectory` | string | `source` | Workspace-relative source directory |
| `enma.bundler.outputFile` | string | `output/bundled.em` | Workspace-relative output path |
| `enma.bundler.stripComments` | boolean | `true` | Strip comments by default |
| `enma.bundler.bundleOnSave` | boolean | `false` | Debounced (750ms) re-bundle on `.em` save |
| `enma.projects` | array | `[]` | Multi-project list: `{ name, sourceDirectory, outputFile, stripComments?, lspMode? }` |

`lspMode` per project:

- `"full"` *(default)* — all IntelliSense services.
- `"syntaxOnly"` — disables hover, completion, signature help, go-to-def, references, rename, code actions, inlay hints, analyzer diagnostics. Useful for reference folders that shouldn't pollute the workspace symbol table.

### Engine MCP

| Setting | Type | Default | Description |
|---|---|---|---|
| `enma.mcp.enabled` | boolean | `false` | Talk to a Perception engine MCP server |
| `enma.mcp.endpoint` | string | `http://127.0.0.1:9077/mcp` | URL of the engine MCP server |
| `enma.mcp.timeoutMs` | number | `5000` | Per-call timeout (ms) |
| `enma.mcp.authToken` | string | `""` | Optional `Authorization: Bearer …` token |

---

## Architecture

```
┌─────────────────────┐         ┌──────────────────────┐
│  VS Code / Neovim / │ stdio   │  enma-language-      │
│  Helix / Zed / …    │ ◄────► │  server.js (LSP)     │
└─────────────────────┘         └──────────┬───────────┘
                                           │
                                ┌──────────▼───────────┐
                                │ tokenizer → parser → │
                                │ analyzer → formatter │
                                │ → LSP services       │
                                └──────────┬───────────┘
                                           │
                                ┌──────────▼───────────┐
                                │ bundled predefined:  │
                                │ enma-stdlib (900)    │
                                │ perception (full)    │
                                └──────────────────────┘
```

- **`server/src/`** — TypeScript compiler pipeline (tokenizer → parser → analyzer → formatter) + LSP services. Pure stdio JSON-RPC, no editor dependency.
- **`client/src/extension.ts`** — VS Code glue: LSP client wiring, bundler, debugger, MCP client, reference panels.
- **`bin/enma-language-server.js`** — standalone launcher with `--stdio` auto-injection.
- **`server/src/predefined/`** — canonical predefined files; refreshed via [`docs/docs-mcp-sync.md`](docs/docs-mcp-sync.md).

---

## Contributing

```sh
npm install
npm run compile     # tsc + esbuild bundles both client and server
npm test            # 1003 server-side unit tests (mocha)
npm run lint
```

- Press `F5` in VS Code to launch an Extension Development Host.
- Server-side parser tests live under `server/test/unit/`, integration tests under `server/test/integration/`.
- Predefined syncing workflow: [`docs/docs-mcp-sync.md`](docs/docs-mcp-sync.md).
- Parser-decision history & tree-sitter spike: [`docs/parser-decision.md`](docs/parser-decision.md).
- Standalone LSP setup for every supported editor: [`docs/standalone-lsp.md`](docs/standalone-lsp.md).

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## License

MIT.
