# Standalone Enma language server

The Enma language server is a stdio LSP. The VS Code extension drives it
over Node IPC; the same server bundle works in any LSP-capable editor.
The launcher at `bin/enma-language-server.js` auto-injects `--stdio` when
no transport flag is passed.

## Prerequisites

Clone and build once:

```sh
git clone https://github.com/sinnafuls/enma-lsp.git
cd enma-lsp
npm install
npm run compile
```

Then point your editor at `bin/enma-language-server.js`. To share a stable
absolute path between configs, set the `ENMA_LSP_PATH` environment variable
to the launcher and reference `$ENMA_LSP_PATH` (or `%ENMA_LSP_PATH%` on
Windows) in every snippet below.

The bundled `perception.em.predefined` ships inside the server, so
IntelliSense for the Perception host API works without any additional
`.em.predefined` file.

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
## Neovim

The Enma server is not on the Mason registry yet — register it manually. Three
setup paths below, pick whichever matches your config. All three share the
same filetype detection, so add this once at the top of your `init.lua`:

```lua
-- Detect .em as the "enma" filetype, and .em.predefined as "enma-predefined"
-- (same grammar, declaration-only — useful if you want to disable bundling
-- for predefined files separately).
vim.filetype.add({
  extension = { em = 'enma' },
  pattern   = {
    ['.*%.em%.predefined'] = 'enma-predefined',
    ['em%.predefined']     = 'enma-predefined',
  },
})
```

### Path 1 — built-in `vim.lsp.start` (no plugin)

Neovim 0.11+ ships everything you need. Drop this into your `init.lua` or an
`ftplugin/enma.lua`:

```lua
vim.api.nvim_create_autocmd('FileType', {
  pattern = { 'enma', 'enma-predefined' },
  callback = function(args)
    vim.lsp.start({
      name    = 'enma',
      cmd     = { 'node', vim.fn.expand('$ENMA_LSP_PATH') },
      root_dir = vim.fs.dirname(
        vim.fs.find({ 'em.predefined', '.git', '.vscode' }, {
          upward = true,
          path   = vim.api.nvim_buf_get_name(args.buf),
        })[1]
      ),
      -- Tell the server which language id this buffer is so the right
      -- predefined precedence kicks in.
      init_options = {},
    })
  end,
})
```

### Path 2 — `nvim-lspconfig`

```lua
local lspconfig = require('lspconfig')
local configs   = require('lspconfig.configs')

if not configs.enma then
  configs.enma = {
    default_config = {
      cmd       = { 'node', vim.fn.expand('$ENMA_LSP_PATH') },
      filetypes = { 'enma', 'enma-predefined' },
      root_dir  = lspconfig.util.root_pattern('em.predefined', '.git', '.vscode'),
      single_file_support = true,
      settings  = {
        -- All `enma.*` settings from the VS Code extension work here too;
        -- they're forwarded as workspace configuration to the server.
        enma = {
          formatter = { enabled = true },
          parser    = { strict  = false },
        },
      },
    },
  }
end

lspconfig.enma.setup({
  on_attach = function(client, bufnr)
    local opts = { buffer = bufnr, silent = true }
    vim.keymap.set('n', 'gd',    vim.lsp.buf.definition,      opts)
    vim.keymap.set('n', 'gr',    vim.lsp.buf.references,      opts)
    vim.keymap.set('n', 'K',     vim.lsp.buf.hover,           opts)
    vim.keymap.set('n', '<C-k>', vim.lsp.buf.signature_help,  opts)
    vim.keymap.set('n', '<F2>',  vim.lsp.buf.rename,          opts)
    vim.keymap.set('n', '<leader>ca', vim.lsp.buf.code_action, opts)
    vim.keymap.set('n', '<leader>f',  function()
      vim.lsp.buf.format({ async = true })
    end, opts)
  end,
})
```

### Path 3 — lazy.nvim spec (one-liner inside a plugin manager)

```lua
{
  'neovim/nvim-lspconfig',
  ft = { 'enma', 'enma-predefined' },
  config = function()
    -- (paste the Path 2 block here)
  end,
}
```

### Completion engine integration

The server advertises completion with `triggerCharacters = ['.', '::', '(', ',']`
and supports snippets in completion items. Wire up `nvim-cmp` or `blink.cmp`
so it surfaces stdlib factories and method completions:

```lua
-- nvim-cmp
local capabilities = require('cmp_nvim_lsp').default_capabilities()
lspconfig.enma.setup({ capabilities = capabilities, on_attach = on_attach })

-- blink.cmp (Neovim 0.10+)
local capabilities = require('blink.cmp').get_lsp_capabilities()
lspconfig.enma.setup({ capabilities = capabilities, on_attach = on_attach })
```

### Snippets

The extension ships ~70 snippets under `snippets/`. To use them in Neovim with
LuaSnip + `friendly-snippets`-style loading:

```lua
require('luasnip.loaders.from_vscode').lazy_load({
  paths = { vim.fn.expand('$ENMA_LSP_PATH:h:h') .. '/snippets' },
})
```

The snippet JSON files are `enma.code-snippets` (language patterns) and
`stdlib.code-snippets` (math / vec / list / regex / json / time / atomic / …).

### Treesitter (optional)

There's no Treesitter parser on the registry yet. A grammar spike lives at
`spike/tree-sitter-enma/` in the repo, retained as a v2.0 candidate — see
`docs/parser-decision.md`. Until then, the TextMate grammar provided by the
language server's semantic-token output covers highlighting for any
LSP-aware client.

### Bundling from Neovim

The bundler is a plain Node script — no editor coupling. Drop a user command
that runs it for the current buffer's project root:

```lua
vim.api.nvim_create_user_command('EnmaBundle', function(opts)
  local root = vim.fs.dirname(vim.fs.find({ 'em.predefined', '.git' }, {
    upward = true,
  })[1]) or vim.fn.getcwd()
  local entry = opts.fargs[1] or (root .. '/source/main.em')
  local out   = opts.fargs[2] or (root .. '/output/bundled.em')
  local cmd   = ('node %s/../scripts/bundler.mjs %q %q'):format(
    vim.fn.expand('$ENMA_LSP_PATH:h'), entry, out
  )
  vim.notify(vim.fn.system(cmd))
end, { nargs = '*' })
```

Then `:EnmaBundle` from any `.em` buffer.

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
## Emacs

### `eglot` (Emacs 29+)

```elisp
(require 'eglot)

(add-to-list 'auto-mode-alist '("\\.em\\'" . enma-mode))
(define-derived-mode enma-mode prog-mode "Enma"
  "Major mode for Enma source files."
  (setq-local comment-start "//")
  (setq-local comment-end ""))

(add-to-list 'eglot-server-programs
             '(enma-mode . ("node" "/abs/path/to/enma-lsp/bin/enma-language-server.js")))

(add-hook 'enma-mode-hook 'eglot-ensure)
```

### `lsp-mode`

```elisp
(require 'lsp-mode)

(add-to-list 'lsp-language-id-configuration '(enma-mode . "enma"))

(lsp-register-client
 (make-lsp-client
  :new-connection (lsp-stdio-connection
                   '("node" "/abs/path/to/enma-lsp/bin/enma-language-server.js"))
  :major-modes '(enma-mode)
  :server-id 'enma))

(add-hook 'enma-mode-hook #'lsp)
```

---
## JetBrains IDEs (IntelliJ, CLion, Rider, PyCharm, WebStorm…)

JetBrains IDEs support generic stdio LSPs via the **LSP4IJ** plugin
(`Settings → Plugins → Marketplace → "LSP4IJ"`).

1. Install LSP4IJ.
2. `Settings → Languages & Frameworks → Language Servers → +`.
3. Configure:
   - **Name**: `Enma`
   - **Command**: `node /abs/path/to/enma-lsp/bin/enma-language-server.js`
   - **Mappings → File name patterns**: `*.em`, `*.em.predefined`, `em.predefined`
   - **Mappings → Language ID**: `enma`
4. Apply, then open any `.em` file — completion, hover, diagnostics, go-to-def
   light up.

Syntax highlighting needs a textmate bundle; LSP4IJ doesn't import the VSIX
directly. A workable approximation: select C/C++ syntax for `.em` and let
semantic tokens (delivered by the server) overlay the right colors.

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
at [enma-lsp/issues](https://github.com/sinnafuls/enma-lsp/issues) and we'll look.
