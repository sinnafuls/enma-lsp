# Docs MCP sync

The bundled `.em.predefined` files are the source of truth for IntelliSense.
New declarations are pulled from the upstream Enma + Perception documentation
via two MCP servers — `enma-docs` and `perception-docs` — but the predefined
files themselves are **append-only**: existing declarations are never
overwritten, only added to.

## Catalogue format

The sync script reads `data/docs-catalogue.json`:

```jsonc
{
  "generatedAt": "2026-05-18T...",
  "sources": [
    "mcp__enma-docs__searchDocumentation",
    "mcp__perception-docs__getPage"
  ],
  "symbols": [
    {
      "module": "perception",                                     // "enma_stdlib" | "perception"
      "name": "host_t",                                            // identifier the script keys off
      "kind": "type",                                              // "type" | "function" | "funcdef" | "global"
      "declaration": "class host_t { proc_t* current; };",         // verbatim text appended to the predefined
      "source": "https://docs.perception.cx/perception/enma/proc"  // optional URL recorded for traceability
    }
  ]
}
```

The catalogue is committed to the repo. Each refresh PR is a diff against this
file — that's the review surface. The sync script never queries MCP servers
directly so CI can verify the merge without an MCP server reachable.

## Refresh workflow

1. **Pull symbols from the docs MCP servers.** In any MCP-aware host with
   the `enma-docs` and `perception-docs` servers configured, query the
   sections you want to import. Typical queries:
   - All types declared under `perception::proc`.
   - Every signature in a given `*_api.md` page.
   - The full surface of an Enma stdlib addon (e.g. `vec`).
2. **Convert to the catalogue shape.** For each symbol, emit a `{module, name,
   kind, declaration, source}` object and add it to `data/docs-catalogue.json`.
   Keep the JSON sorted by module then name to keep the diff readable.
3. **Dry-run the merge:**
   ```sh
   npm run sync-docs
   ```
   The script prints what it WOULD append. Eyeball it. Look for false
   positives (a name you intended but that the script reports as
   already-declared — usually means the catalogue entry uses a slightly
   different identifier than the predefined).
4. **Apply:**
   ```sh
   npm run sync-docs -- --write
   ```
   The new declarations land under a `// ─── Imported via npm run sync-docs
   <YYYY-MM-DD> ───` header inside each predefined file.
5. **Validate** with the existing checks:
   ```sh
   npm run validate-predefined
   npm test
   ```

## Why a catalogue file and not direct MCP calls?

- **Reviewability.** Every new symbol shows up in `git diff` on the catalogue
  before it ever touches the predefined.
- **CI determinism.** `validate-predefined` runs in CI without needing the MCP
  servers to be reachable.
- **Cross-team transparency.** Engineers reading a PR can see what came from
  which doc page (via the `source` field).

## When the merge skips a symbol

The sync script logs `- <name> (already declared)` for any catalogue entry
whose identifier already appears in the target predefined file. Skipped entries
are noise — re-running the script is safe. If you intentionally want to
overwrite an existing declaration:

- Edit the predefined file by hand. The sync script is intentionally
  append-only and has no overwrite mode — the predefined is the source of
  truth.
- After editing, drop the corresponding entry from the catalogue (the script
  will skip it on the next run anyway).
