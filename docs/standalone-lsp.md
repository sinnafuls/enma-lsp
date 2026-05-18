# Standalone Enma Language Server

The Enma language server is a stock stdio LSP. The VS Code extension drives it
over Node IPC, but the same server bundle works in any LSP-capable editor or
AI agent. The launcher at `bin/enma-language-server.js` auto-injects `--stdio`
when no transport flag is passed.

## Prerequisites

Clone and build once:

```sh
git clone https://github.com/sin/enma-lsp.git
cd enma-lsp
npm install
npm run compile
```

After that, point your editor at `bin/enma-language-server.js`. If you'd like
a stable absolute path that everything can share, set the `ENMA_LSP_PATH`
environment variable to the launcher and reference `$ENMA_LSP_PATH` (or
`%ENMA_LSP_PATH%` on Windows) below.

The bundled `perception.em.predefined` ships inside the server, so
IntelliSense for every Perception API works out of the box — no extra
`.em.predefined` required.

---
## Claude Code

Drop into `~/.claude/lsp.json` (or your workspace `.claude/lsp.json`):

```json
{
  "enma": {
    "command": ["node", "/abs/path/to/enma-lsp/bin/enma-language-server.js"],
    "extensions": [".em", ".em.predefined"]
  }
}
```

The launcher speaks stdio by default — no flag needed.

---
## OpenCode

`opencode.json`:

```json
{
  "lsp": {
    "enma": {
      "command": ["node", "/abs/path/to/enma-lsp/bin/enma-language-server.js"],
      "extensions": [".em", ".em.predefined"]
    }
  }
}
```

---
## GitHub Copilot CLI

`~/.config/copilot/lsp.toml`:

```toml
[language-server.enma]
command = "node"
args    = ["/abs/path/to/enma-lsp/bin/enma-language-server.js"]
filetypes = ["enma"]
```

Copilot CLI hosts the server alongside Copilot Chat; both surfaces see the
same IntelliSense data.

---
## Neovim (nvim-lspconfig / vim.lsp.start)

```lua
vim.filetype.add({ extension = { em = 'enma' } })

vim.lsp.start({
  name = 'enma',
  cmd  = { 'node', vim.fn.expand('$ENMA_LSP_PATH') },
  root_dir = vim.fs.dirname(
    vim.fs.find({ '.git', 'em.predefined' }, { upward = true })[1]
  ),
})
```

If you prefer `nvim-lspconfig`, register a custom server:

```lua
local lspconfig = require('lspconfig')
local configs   = require('lspconfig.configs')

if not configs.enma then
  configs.enma = {
    default_config = {
      cmd      = { 'node', vim.fn.expand('$ENMA_LSP_PATH') },
      filetypes = { 'enma' },
      root_dir = lspconfig.util.root_pattern('em.predefined', '.git'),
    },
  }
end
lspconfig.enma.setup({})
```

---
## Helix (`languages.toml`)

```toml
[language-server.enma]
command = "node"
args    = ["/abs/path/to/enma-lsp/bin/enma-language-server.js"]

[[language]]
name           = "enma"
file-types     = ["em"]
language-servers = ["enma"]
roots          = ["em.predefined", ".git"]
```

---
## Cursor / Antigravity / Cursor-forks

Cursor and Antigravity are VS Code forks — install the VSIX directly:

```sh
# Build a VSIX (one-time) from the repo
npx @vscode/vsce package --no-yarn --skip-license -o enma-language.vsix

# Cursor:
cursor --install-extension enma-language.vsix
# Antigravity:
antigravity --install-extension enma-language.vsix
```

The same VSIX works in VSCodium and any other Code-OSS host.

---
## Zed (`~/.config/zed/settings.json`)

```json
{
  "lsp": {
    "enma": {
      "binary": {
        "path": "node",
        "arguments": ["/abs/path/to/enma-lsp/bin/enma-language-server.js"]
      },
      "language": "enma"
    }
  },
  "languages": {
    "Enma": {
      "file_types": ["em"],
      "language_servers": ["enma"]
    }
  }
}
```

---
## Sublime LSP (`LSP.sublime-settings`)

```json
{
  "clients": {
    "enma": {
      "enabled": true,
      "command": ["node", "/abs/path/to/enma-lsp/bin/enma-language-server.js"],
      "selector": "source.enma"
    }
  }
}
```

Pair with a `.sublime-syntax` mapping `*.em` → `source.enma` if you don't
already have one.

---
## Verifying the install

Once the editor reports `enma-language-server` is running:

1. Open any `.em` file.
2. Hover a Perception native like `register_routine` — you should see the
   signature inline.
3. Type `vec3(` and see signature help pop.

If hovers don't surface but autocompletion does, the server is up but the
bundled predefined didn't load. Common cause: launching `node server/dist/
server.js` directly instead of `bin/enma-language-server.js` — the launcher
ensures the predefined files are resolved relative to the bundle.

## Reporting issues

`Help → Toggle Developer Tools` (in any VSCode-based host) or the LSP log of
your editor will show stderr from the server. Copy that block into an issue
at [enma-lsp/issues](https://github.com/sin/enma-lsp/issues) and we'll look.
