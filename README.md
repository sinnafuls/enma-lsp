# Enma for Perception

A fully pre-configured Enma Language Server for [Perception.cx](https://perception.cx) — install and start writing `.em` scripts immediately, with zero setup required.

Structured 1:1 with [angel-lsp-pcx](https://github.com/sinnafuls/angel-lsp-pcx) (AngelScript → Enma): same authoring loop, bundler UX, status bar, multi-project settings, and Perception API bake-in — swapped onto the Enma language and current docs.

> **Install:** Download the latest `.vsix` from [Releases](https://github.com/sinnafuls/enma-lsp/releases) and use **"Extensions: Install from VSIX..."** in VS Code.

Also works outside VS Code (Neovim, Helix, Zed, Claude Code, …) via the stdio server — see [`docs/standalone-lsp.md`](docs/standalone-lsp.md).

## Features

The entire Perception Enma API is bundled directly into the extension. Every feature works out-of-the-box:

| Feature | Description |
|---------|-------------|
| **Autocompletion** | All Perception globals, classes, and methods with parameter hints |
| **Hover docs** | Inline documentation for every API function and type |
| **Signature help** | Parameter hints as you type function calls |
| **Go to Definition** | Ctrl+click any symbol to jump to its declaration |
| **Find References** | Find every use of a variable, function, or class |
| **Type Checking** | Catch type mismatches and undefined symbols as you code |
| **Error Highlighting** | Syntax and semantic errors highlighted in real time |
| **Symbol Renaming** | Safe rename across all files in your project |
| **Snippets** | Enma / Perception code templates |
| **Formatter** | Auto-format on type |
| **Bundler** | Built-in multi-file bundler for `.em` projects |
| **Debugger** | DAP attach proxy for the Enma SDK TCP server |
| **Engine MCP** | Optional on-save `script/validate` + Run Script against a live engine |

## Getting Started

1. Download the latest `.vsix` from [Releases](https://github.com/sinnafuls/enma-lsp/releases).
2. In VS Code: Command Palette → **"Extensions: Install from VSIX..."**.
3. Open a folder containing your `.em` files.
4. Start writing — IntelliSense is active immediately.

No `em.predefined` file needed. The full Perception host API (lifecycle, proc, CPU, GUI, input, net, render, sound, unicorn, win, zydis) plus modern std containers is baked in.

Docs:

- Host APIs: https://docs.perception.cx/perception/
- Enma language: https://docs.perception.cx/perception/enma-lang/

## Bundling Multi-File Projects

Perception scripts are typically submitted as a single `.em` file. This extension includes a bundler that concatenates `#include`-linked files into one output file.

### Quick command

Command Palette (`Ctrl+Shift+P`):

- **`Enma: Bundle Script`** — bundles with comments preserved (default setting)
- **`Enma: Bundle Script (Strip Comments)`** — comments removed  
  Shortcuts: `Ctrl+Alt+B` / `Ctrl+Alt+Shift+B`

Status bar (**Perception Enma**) exposes the same menu as angel-lsp-pcx.

### Automated build task

```jsonc
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "Bundle Perception Script",
            "type": "enma-bundle",
            "src": "source",
            "out": "output/script.em",
            "strip": true,
            "group": {
                "kind": "build",
                "isDefault": true
            }
        }
    ]
}
```

Or run **`Enma: Initialize Project`** to scaffold `source/main.em` + `.vscode/tasks.json`.

## Project Layout (Recommended)

```
my-script/
├── source/
│   ├── main.em
│   ├── core/
│   │   └── process.em
│   └── render/
│       └── esp.em
└── .vscode/
    └── tasks.json        ← enma-bundle task
```

In `main.em`:

```cpp
#include "core/process.em"
#include "render/esp.em"

int64 main()
{
    // return > 0 to stay loaded
    return 1;
}
```

## Adding Project-Specific Symbols

Create an `em.predefined` (or `*.em.predefined`) in your project root — the LSP merges it over the bundled definitions (workspace > forceInclude > bundled).

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `enma.projects` | `[]` | Multi-project workspaces (source/output/lspMode per entry) |
| `enma.implicitMutualInclusion` | — | Make sibling `.em` files visible without explicit `#include` |
| `enma.forceIncludePredefined` | `[]` | Extra `.em.predefined` files injected globally |
| `enma.formatter.indentSpaces` | `4` | Indentation width |
| `enma.formatter.useTabIndent` | `false` | Use tabs instead of spaces |
| `enma.mcp.enabled` | `false` | On-save engine `script/validate` via MCP |

Full settings reference: [docs/user_settings.md](./docs/user_settings.md)

## Credits

Client UX and Perception bake-in model follow [sinnafuls/angel-lsp-pcx](https://github.com/sinnafuls/angel-lsp-pcx) (AngelScript for Perception), itself based on [sashi0034/angel-lsp](https://github.com/sashi0034/angel-lsp).

Enma language server, analyzer, and `.em` predefined surface are maintained in this repo against current [Perception](https://docs.perception.cx/perception/) / [enma-lang](https://docs.perception.cx/perception/enma-lang/) docs.

## License

[MIT License](./LICENSE)
