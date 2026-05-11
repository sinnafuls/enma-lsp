# Enma Language — VSCode Extension & Language Server

Full LSP support for [Enma](https://enma-1.gitbook.io/enma) — the JIT-compiled scripting language with C-style syntax, multi-inheritance, templates, namespaces, exceptions, RAII, and a serialized `.emb` binary format.

## Features (v1.0.0)

- **Syntax highlighting** — TM grammar for keywords, types, strings (including f-string interpolation), char/numeric literals, comments, preprocessor directives, annotations, `->` vs `.` access, function references, intrinsics
- **Completion** — stdlib globals, types, factories, methods; user-defined symbols across the workspace; namespace members after `::`, locals inside functions
- **Hover** — real signatures for stdlib names; user-defined symbol signatures; keyword/type docs fallback
- **Signature help** — triggered on `(` and `,`; highlights active parameter; lists all overloads
- **Go-to-definition** — `F12` jumps to the declaration of any indexed user symbol
- **Workspace symbols** — `Ctrl+T` / `Cmd+T` searches user-defined symbols across all `.em` files
- **Document symbols** — Outline panel and breadcrumbs show file structure (namespaces → members, classes → methods/fields, enums → values)
- **Semantic tokens** — global vs local variable coloring; user-defined types painted teal; functions yellow
- **Diagnostics** — unknown-type squiggles; parser strict-mode scaffolded (`enma.parser.strict`)
- **Document formatter** — `enma.formatter.*` settings: brace position, indent spaces/tabs, blank-line collapsing, comma/operator spacing, designated-init alignment, f-string verbatim preservation
- **Cross-file indexing** — LRU index cache (§A8, default 300 closed files); preprocessor `#include` / `#define` support; workspace `.em.predefined` files
- **Predefined file support** — bundled stdlib + workspace `.em.predefined` with §A10 precedence
- **Permissions banner** — warns when FFI (`[[dll]]`) or file-system intrinsics are used without explicit opt-in
- **Snippets** — ~20 language patterns + 50 stdlib snippets (math, vec, `list`/`imap`, `mat4`/`quat`, time, file, regex, json, mutex, atomic, coroutine, annotations)
- **Stdlib coverage** — 900 entries from the upstream Enma reference: 21 types (`array`, `map`, `list`, `imap`, `hash_set`, `sorted_map`, `vec2/3/4`, `mat4`, `quat`, `variant`, `string`, `regex`, `json_value`, `file_t`, `mutex`, `cond_var`, `atomic_int32/64`, `coroutine_t`, `lock_guard`), 534 free functions, plus all factories and methods
- **Bracket matching, auto-closing pairs, comment toggling, folding markers**
- **`.emb` binary marker** — VSCode doesn't try to render binary format as text

## Install

### VSCode Marketplace

Search for **Enma Language** by `deadlock` in the Extensions panel, or:

```
ext install deadlock.enma-language
```

### Install from VSIX

1. Download `enma-language-1.0.0.vsix` from the [releases page](https://github.com/deadlock/enma-lsp/releases).
2. In VSCode: `Extensions` → `...` menu → `Install from VSIX...` → select the file.

Or from the terminal:

```
code --install-extension enma-language-1.0.0.vsix
```

## Bundler

The extension ships a recursive `#include` resolver that flattens an Enma project into a single `.em` file ready for `enma::compile()` ingest.

### Quick start

1. Run **Enma: Initialize Enma project** (`Ctrl+Shift+P`) — scaffolds `source/main.em` and `.vscode/tasks.json`.
2. Edit `source/main.em` (and add more files with `#include "..."` as needed).
3. Press `Ctrl+Alt+B` (`Cmd+Alt+B` on macOS) to bundle. Output goes to `output/bundled.em` by default.

### Commands

| Command                                 | Default keybinding | Description |
|-----------------------------------------|--------------------|-------------|
| `Enma: Bundle current project`          | `Ctrl+Alt+B`        | Bundle using `enma.bundler.*` settings |
| `Enma: Bundle current project (strip)`  | `Ctrl+Alt+Shift+B`  | Same, with line/block comments stripped |
| `Enma: Bundle a configured project`     | —                  | Pick from `enma.projects` |
| `Enma: Bundle all configured projects`  | —                  | Run every entry in `enma.projects` |
| `Enma: Initialize Enma project`         | —                  | Scaffold `source/main.em` + `.vscode/tasks.json` |

### Settings

| Setting                          | Default                | Description |
|----------------------------------|------------------------|-------------|
| `enma.bundler.sourceDirectory`   | `source`               | Workspace-relative directory holding the entry file (`main.em`) |
| `enma.bundler.outputFile`        | `output/bundled.em`    | Workspace-relative path for the bundled output |
| `enma.bundler.stripComments`     | `true`                 | Strip line and block comments by default |
| `enma.projects`                  | `[]`                   | Multi-project list: `[{ name, src, out, strip? }]` |

### Task definition

```jsonc
{
  "type": "enma-bundle",
  "src": "source/main.em",
  "out": "output/bundled.em",
  "strip": false
}
```

### Behaviour

- `#include "path"` is resolved against the includer's directory, then against the entry's directory.
- `#pragma once` deduplicates — a file marked once is included exactly once.
- Circular includes emit a warning and the second occurrence is skipped (no infinite loop).
- `--strip` (or `enma.bundler.stripComments`) removes line and block comments while preserving string literals.

### CLI

```
node scripts/bundler.mjs <srcEntry.em> <out.em> [--strip]
```

## Multi-editor setup

The language server ships as a standalone npm package (`enma-lsp`). Install it globally:

```
npm install -g enma-lsp
```

Then configure your editor:

### Neovim (nvim-lspconfig)

```lua
require'lspconfig'.enma.setup{
  cmd = {"npx", "enma-lsp", "--stdio"},
  filetypes = {"enma"},
}
```

### Helix (languages.toml)

```toml
[[language]]
name = "enma"
file-types = ["em"]
language-server = { command = "npx", args = ["enma-lsp", "--stdio"] }
```

### Zed (settings.json)

```toml
[language_servers.enma]
command = "npx"
args = ["enma-lsp", "--stdio"]
```

> Until `enma-lsp` is published to npm, use `node path/to/server/dist/server.js --stdio` or a local `npm link` from the `server/` directory.

## Settings reference

| Setting | Type | Default | Description |
|---|---|---|---|
| `enma.indexCache.maxClosedFiles` | number | `300` | Max closed files in the LRU index cache (§A8) |
| `enma.preprocessor.maxIncludeDepth` | number | `64` | Max `#include` nesting depth (§A4) |
| `enma.indexExclude` | array | `["node_modules",".git","output","dist","build"]` | Directories skipped during workspace indexing |
| `enma.implicitMutualInclusion` | boolean | `false` | Every `.em` file sees every other without an explicit `#include` |
| `enma.permissions.ffi` | boolean | `false` | Allow `[[dll]]` / FFI annotations without a permission error |
| `enma.permissions.file` | boolean | `false` | Allow file-system intrinsics without a permission error |
| `enma.parser.strict` | boolean | `false` | Reject all kill-rule recoveries (§A1) — defaults to `false` until 95% corpus threshold |
| `enma.analyzer.severity` | string | `"error"` | Global severity for non-exempt analyzer diagnostics (`"error"` or `"warning"`) |
| `enma.forceIncludePredefined` | array | `[]` | Additional `.em.predefined` files with forceInclude precedence |
| `enma.formatter.enabled` | boolean | `true` | Enable the document formatter |
| `enma.formatter.indentSpaces` | number | `4` | Spaces per indent level |
| `enma.formatter.useTabIndent` | boolean | `false` | Use tab for indentation instead of spaces |
| `enma.formatter.maxBlankLines` | number | `1` | Max consecutive blank lines to preserve |
| `enma.formatter.bracePosition` | string | `"sameLine"` | Opening brace placement: `"sameLine"` (K&R) or `"nextLine"` (Allman) |
| `enma.formatter.spaceAfterComma` | boolean | `true` | Space after commas in argument/parameter lists |
| `enma.formatter.spaceAroundBinaryOp` | boolean | `true` | Spaces around binary operators |
| `enma.formatter.alignDesignatedInit` | boolean | `false` | Align `=` in designated initializer lists |
| `enma.formatter.fStringPreserveVerbatim` | boolean | `true` | Preserve f-string byte content verbatim |

## v1.0.0 status

| Feature | Status |
|---|---|
| Full LSP (completion, hover, sig help, go-to-def, workspace/document symbols, semantic tokens, diagnostics) | Ships |
| Document formatter | Ships — AC-11 idempotency 100%, f-string verbatim 30/30 |
| DAP debugger | **Demoted to v1.1** — upstream gate not met; see [`docs/dap-gate-decision.md`](docs/dap-gate-decision.md) |

## Contributing

```
npm install
npm run compile   # tsc + esbuild bundles both client and server
npm test          # runs 936 server-side unit tests (mocha)
```

- Press `F5` in VSCode to launch an Extension Development Host.
- Server source: `server/src/` — compiler pipeline (tokenizer → parser → analyzer → formatter → LSP services).
- Client source: `client/src/extension.ts` — VSCode glue, permissions banner, LSP client wiring.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## License

MIT.
