# Perception MCP — AI Agent Reference

Complete guide for AI agents using the Perception MCP server. Covers all 59 tools,
handle lifecycle, address encoding, and six concrete workflow recipes.

---

## Setup

**Enable in Perception:** Settings → MCP → Enable MCP Server. Default endpoint:
`http://127.0.0.1:9077/mcp` (configurable port and optional bearer token).

**Claude Code** — add to `~/.claude/mcp.json` or workspace `.claude/mcp.json`:

```json
{
  "perception": {
    "type": "http",
    "url": "http://127.0.0.1:9077/mcp"
  }
}
```

**Other MCP clients** — point at `http://127.0.0.1:9077/mcp` over HTTP with
`Content-Type: application/json`. Bearer auth: set `Authorization: Bearer <token>`
if configured.

**VS Code extension integration** — `enma.mcp.enabled: true` auto-wires
`script/validate` on save and exposes `Enma: Run Script (MCP)` from the command
palette. The extension talks to the same endpoint.

---

## The prime directive: `script/get_context`

**Call `script/get_context` before writing any Enma code.** This is non-negotiable.

Enma is a proprietary JIT-compiled language with C-style syntax, multi-inheritance,
templates, exceptions, RAII, a serialized `.emb` binary format, and a large host
API (`proc_t`, `routine_t`, GUI types, net, sound, unicorn, zydis, …). None of
this is in any model's training data with sufficient accuracy. The context string
returned by `script/get_context` is the authoritative language reference — types,
methods, overloads, signatures, annotations, and the full Perception scripting API.

```
→ script/get_context
← { "context": "<full language + API reference>" }
```

Feed the returned string verbatim to your script-generation context before
producing any `.em` source. Missing this step produces syntactically plausible
but semantically wrong code that will fail `script/validate`.

---

## Handle lifecycle

Process handles are per-connection references. They are **not** implicit — you
must acquire one, use it, and release it.

```
1. Acquire
   process/reference_by_name("target.exe")  →  { "handle": "0xabcd1234" }
   process/reference_by_pid(1234)           →  { "handle": "0xabcd1234" }

2. Work
   process/read_virtual_memory   handle="0xabcd1234"  address="0x7ff7abc00000"  size=256
   process/disassemble            handle="0xabcd1234"  address="0x7ff7abc01000"
   ... (all memory/module/scan tools take the handle)

3. Release
   process/dereference            handle="0xabcd1234"
```

**If you skip dereference:** handles are auto-released when the MCP connection
closes. During a long session, unreleased handles accumulate. Call
`process/cleanup_references` to drop all handles for the current connection, or
`process/list_references` to see what is live.

**Per-connection isolation:** handles from one connection are not visible to
another. If Perception is restarted or the target process exits, the handle
becomes stale — any tool call returns error `-32002`.

---

## Address encoding

All addresses in requests and responses are **hex strings**: `"0x7ff7abc12340"`.

**Why:** JavaScript `Number` (IEEE 754 double) loses precision above 2^53 ≈
9,007,199,254,740,992. Modern 64-bit user-space addresses (e.g. `0x7ff7abc12340`
= 140,699,140,628,288) exceed this boundary. Integer truncation produces silently
wrong reads and corrupted writes with no error.

**Correct:** `"address": "0x7ff7abc12340"`
**Wrong:** `"address": 140699140628288`  ← loses bits above 2^53

Parse returned addresses with BigInt in JS, or just pass them as opaque strings
between tools — the server accepts whatever it returned.

---

## Workflow cookbook

### 1. Write and test an Enma script

```
script/get_context
→ context string

[compose script using context as reference]

script/validate  source="<script text>"
→ { "ok": true, "errors": [] }
  or { "ok": false, "errors": [{ "line": 12, "message": "..." }] }

[fix errors, re-validate until ok]

script/execute   source="<script text>"
→ { "ok": true, "logs": ["[PASS] ...", "result: 42"] }
```

`script/execute` compiles and calls `main()`. Log output comes from
`print_console(...)` calls inside the script. Errors from runtime exceptions
appear in `logs` with stack context.

---

### 2. Find a function by name and signature

```
process/list
→ [{ "pid": 1234, "name": "target.exe", ... }, ...]

process/reference_by_name("target.exe")
→ { "handle": "0xabcd1234" }

process/find_function_by_name  handle  pattern="Init"  case_sensitive=false  max_results=64
→ [{ "address": "0x7ff7abc01000", "module": "target.exe", "name": "InitEngine" }, ...]

process/disassemble  handle  address="0x7ff7abc01000"  max_bytes=256  max_instructions=32
→ [{ "address": "0x7ff7abc01000", "mnemonic": "push", "operands": "rbp" }, ...]

process/generate_signature  handle  address="0x7ff7abc01000"  max_length=32
→ { "signature": "55 48 8B EC 48 83 EC ?? 48 8B 05", "is_unique": true }

process/dereference  handle
```

`find_function_by_name` does substring/case-insensitive match against all export
tables in the loaded modules. For non-exported functions, use
`find_function_by_signature` with an AOB pattern instead.

---

### 3. Trace a pointer chain

```
process/reference_by_name("game.exe")
→ { "handle": "0xabcd1234" }

process/get_modules  handle
→ [{ "name": "game.exe", "base": "0x7ff700000000", "size": 4194304 }, ...]

# Read a single pointer at base + 0x1a2b38
process/read_typed_value  handle  address="0x7ff7001a2b38"  type="ptr"
→ { "value": "0x1f3a000000" }

# Or resolve the whole chain in one call
process/read_pointer_chain  handle  base_address="0x7ff700000000"  offsets=["0x1a2b38", "0x18", "0x2c0"]
→ { "value": "0x0000001234", "chain": ["0x7ff7001a2b38", "0x1f3a000000", "0x1f3a000018", "0x1f3a0002e0"] }

process/dereference  handle
```

`read_pointer_chain` resolves up to 64 levels. Each offset is relative to the
pointer value resolved at the previous step. If any intermediate pointer is null
or invalid, the call returns an error — check intermediate addresses with
`is_valid_address` before building deep chains.

---

### 4. Scan for a value and track changes

```
process/reference_by_name("game.exe")
→ { "handle": "0xabcd1234" }

# Initial scan — heap_only defaults to the MCP UI toggle (see note below)
process/scan_value  handle  type="i32"  value=100  aligned=true
→ { "count": 847, "results": [{ "address": "0x1f3a001234" }, ...] }

# [trigger in-game action that changes the value to 99]

process/scan_next  handle  compare="exact"  value=99
→ { "count": 12, "results": [...] }

# [trigger another change]

process/scan_next  handle  compare="decreased"
→ { "count": 3, "results": [...] }

# Keep narrowing until 1 candidate, then lock the address
process/dereference  handle
```

`scan_next` compare values: `exact` (match specific value), `range` (with `min`
and `max`), `unchanged`, `changed`, `increased`, `decreased`. For `range`, pass
both `min` and `max`. For `exact`, pass `value`. For `unchanged`/`changed`/
`increased`/`decreased`, no value needed.

Each `scan_next` runs against the previous scan's candidate list, not a fresh
scan — state is per-handle, so don't dereference between steps.

---

### 5. Reverse-engineer a class from a vtable

```
process/reference_by_name("target.exe")
→ { "handle": "0xabcd1234" }

process/read_rtti  handle  vtable_address="0x7ff7abc56700"
→ {
    "class_name": "CPlayerController",
    "bases": ["CBaseEntity", "IController"]
  }

process/analyze_vtable  handle  vtable_address="0x7ff7abc56700"  max_entries=64
→ [
    { "slot": 0, "address": "0x7ff7abc10100", "likely_code": true },
    { "slot": 1, "address": "0x7ff7abc10200", "likely_code": true },
    ...
  ]

# For each slot:
process/lookup_symbol  handle  address="0x7ff7abc10100"
→ {
    "module_name": "target.exe",
    "module_base": "0x7ff7abc00000",
    "module_offset": "0x10100",
    "section": ".text",
    "nearest_export": "CBaseEntity::Update"
  }

process/find_function_bounds  handle  address="0x7ff7abc10100"
→ { "start": "0x7ff7abc10100", "end": "0x7ff7abc10180", "size": 128 }

process/dereference  handle
```

`read_rtti` requires the vtable pointer (not the object pointer). Dereference the
object pointer first to get the vtable address. `analyze_vtable` filters slots
where the address falls outside executable sections (sets `likely_code: false`).

---

### 6. Find string references and write a hook script

```
process/reference_by_name("target.exe")
→ { "handle": "0xabcd1234" }

process/get_module_by_name  handle  name="target.exe"
→ { "base": "0x7ff7abc00000", "size": 4194304, "path": "C:\\...\\target.exe" }

process/find_string_refs  handle  module_base="0x7ff7abc00000"  text="Achievement Unlocked"  encoding="auto"
→ {
    "hits": [{ "address": "0x7ff7abc3a100", "text": "Achievement Unlocked" }],
    "code_refs": [{ "address": "0x7ff7abc12340", "type": "lea" }]
  }

# Disassemble context around each code reference
process/disassemble  handle  address="0x7ff7abc12340"  max_instructions=20
→ [{ "address": "0x7ff7abc12340", "mnemonic": "lea", "operands": "rcx, [rip+0x2bdb9]" }, ...]

# Generate a stable AOB signature for the hook site
process/generate_signature  handle  address="0x7ff7abc12340"  max_length=32
→ { "signature": "48 8D 0D ?? ?? ?? ?? E8 ?? ?? ?? ??", "is_unique": true }

process/dereference  handle

# Now get Enma language context and write the hook
script/get_context
→ context string

[write hook script using context — register a routine that patches or monitors
 the call site identified by the signature above]

script/validate  source="<hook script>"
→ { "ok": true, "errors": [] }
```

Always validate before execute. Hook scripts that install routine callbacks or
modify memory at runtime can be hard to undo — validate confirms compilation
succeeds before any code runs.

---

## Permissions table

| Permission flag | Gated tools |
|---|---|
| `write_memory` | `write_virtual_memory`, `write_typed_value`, `write_string`, `copy_memory`, `fill_memory` |
| `virtual_memory_operations` | `allocate_memory`, `free_memory` |
| `kernel_rw_access` | Kernel addresses in any read/write/disasm/query/find_pattern; `eprocess`/`ethread` fields; `system/list_drivers` |

**Enable in Perception:** Settings → MCP → Permissions. Each flag is toggled
independently. Scripts inherit the permissions active at `script/execute` time.

`write_memory` is off by default. The LSP extension shows a permission-gate
diagnostic (`[[dll(...)]]` annotations also require `enma.permissions.ffi: true`
in VS Code settings) so permission mismatches surface before execution.

---

## Error handling

| Code | Name | Meaning | Action |
|---|---|---|---|
| `-32001` | permission denied | Tool requires a permission flag not currently enabled | Enable the flag in Perception Settings → MCP → Permissions |
| `-32002` | stale handle | The process exited, Perception restarted, or the handle was already dereferenced | Re-acquire: `process/reference_by_name` or `reference_by_pid` |
| `-32003` | target not found | Process name/pid not found, module not loaded, address has no mapping | Verify with `process/list` or `process/get_modules`; check spelling |
| `-32004` | operation failed | Read/write fault, allocation failure, scan state missing, disasm error | Check address validity with `is_valid_address`; for scans, ensure a `scan_value` or `scan_string` was called first |

Standard JSON-RPC errors (`-32700` parse error, `-32600` invalid request,
`-32601` method not found) indicate a malformed call — check tool name spelling
and required parameters.

---

## Heap-only scan default

`scan_value`, `scan_next`, `scan_string`, and `scan_pointer_to` all have a
`heap_only` parameter. When omitted, the value defaults to whatever the **MCP UI
toggle** is set to in Perception's Settings → MCP panel — this is a per-session
user setting, not a hardcoded default.

**Pass `heap_only=false` explicitly** when you need to scan image/module memory
(e.g. scanning for a PE signature or a string inside a DLL's read-only data).

**Pass `heap_only=true` explicitly** when you want to limit scope to private heap
regions for speed (avoids scanning several hundred MB of mapped image files).

Do not rely on the implicit default for deterministic behavior across different
Perception configurations.

---

## Tool index

### Discovery + reference lifecycle (no handle required)

| Tool | Parameters | Returns |
|---|---|---|
| `process/list` | — | `[{pid, name, arch, ...}]` |
| `process/info_by_pid` | `pid` | process metadata |
| `process/info_by_name` | `name` | process metadata |
| `process/reference_by_pid` | `pid` | `{handle}` hex string |
| `process/reference_by_name` | `name` | `{handle}` hex string |
| `process/dereference` | `handle` | — |
| `process/cleanup_references` | — | drops all handles for this connection |
| `process/list_references` | — | `[{handle, pid, name}]` |

### Memory I/O (all take `handle`)

| Tool | Key parameters | Notes |
|---|---|---|
| `process/read_virtual_memory` | `address`, `size` | hex bytes, max 16 MiB |
| `process/write_virtual_memory` | `address`, `data` | gated: write_memory |
| `process/is_valid_address` | `address` | bool |
| `process/read_typed_value` | `address`, `type` | type ∈ u8/u16/u32/u64/i8/i16/i32/i64/f32/f64/ptr/bool |
| `process/write_typed_value` | `address`, `type`, `value` | gated: write_memory |
| `process/read_string` | `address`, `max_len?`, `encoding?` | encoding ∈ auto/ascii/utf16 |
| `process/write_string` | `address`, `text`, `encoding?`, `null_terminate?` | gated: write_memory |
| `process/copy_memory` | `src_address`, `dst_address`, `size` | max 64 MiB; gated: write_memory |
| `process/fill_memory` | `address`, `size`, `byte` | `0x90`=NOP, `0xCC`=int3; gated: write_memory |
| `process/read_pointer_chain` | `base_address`, `offsets[]` | up to 64 offsets |
| `process/disassemble` | `address`, `max_bytes?`, `max_instructions?` | default 256B/32 insns; Zydis backend |

### Modules / threads / PE (all take `handle`)

| Tool | Key parameters | Notes |
|---|---|---|
| `process/get_modules` | — | all loaded modules |
| `process/get_threads` | — | thread list with TEB addresses |
| `process/get_module_by_name` | `name` | `{base, size, path}` |
| `process/get_export_address` | `module_base`, `export_name` | resolved VA |
| `process/get_import_address` | `module_base`, `import_name` | IAT slot VA |
| `process/get_module_imports` | `module_base` | all imports |
| `process/list_module_exports` | `module_base` | all exports |
| `process/get_module_sections` | `module_base` | PE sections |
| `process/get_pe_header` | `module_base` | parsed PE header fields |
| `process/get_module_strings` | `module_base`, `min_length?`, `encoding?` | encoding ∈ ascii/utf16/both |
| `process/get_exception_table` | `module_base`, `max_entries?` | x64 RUNTIME_FUNCTION from .pdata |
| `process/get_data_directory` | `module_base`, `directory` | directory ∈ export/import/resource/exception/security/basereloc/debug/tls/load_config/iat/delay_import/com_descriptor or 0–15 |

### Memory regions + allocation (take `handle`)

| Tool | Key parameters | Notes |
|---|---|---|
| `process/query_memory_region` | `address` | VirtualQuery-style result |
| `process/enumerate_memory_regions` | `heap_only?` | all committed regions |
| `process/allocate_memory` | `size` | max 256 MiB; gated: virtual_memory_operations |
| `process/free_memory` | `address` | gated: virtual_memory_operations |

### Pattern / scanner / xrefs / signature (take `handle`)

| Tool | Key parameters | Notes |
|---|---|---|
| `process/find_pattern` | `start`, `size`, `signature` | IDA-style `"AB CD ?? EF"`, first hit |
| `process/find_all_patterns` | `start`, `size`, `signature` | all hits, cap 1024 |
| `process/scan_value` | `type`, `value`, `aligned?`, `heap_only?` | initial scan |
| `process/scan_next` | `compare`, `value?`, `min?`, `max?` | compare ∈ exact/range/unchanged/changed/increased/decreased |
| `process/scan_string` | `text`, `encoding?`, `heap_only?` | — |
| `process/scan_pointer_to` | `target_address`, `heap_only?` | find pointers to address |
| `process/find_xrefs` | `module_base`, `target_address` | code refs within module |
| `process/find_string_refs` | `module_base`, `text`, `encoding?`, `heap_only?`, `string_module?` | code refs to string |
| `process/generate_signature` | `address`, `max_length?` | default 32 bytes; returns IDA sig + `is_unique` |
| `process/diff_memory` | `addr_a`, `addr_b`, `size` | cap 1 MiB |

### Code analysis (take `handle`)

| Tool | Key parameters | Notes |
|---|---|---|
| `process/find_function_bounds` | `address`, `scan_back?`, `scan_forward?` | heuristic prologue/epilogue walk |
| `process/find_function_by_signature` | `module_base`, `signature` | AOB in .text + bounds walk |
| `process/analyze_vtable` | `vtable_address`, `max_entries?` | default 64 slots |
| `process/read_rtti` | `vtable_address` | Win64 RTTI: class name + base class list |

### Symbol / function lookup (take `handle`)

| Tool | Key parameters | Notes |
|---|---|---|
| `process/lookup_symbol` | `address` | `{module_base, module_name, module_offset, section, nearest_export}` |
| `process/find_function_by_name` | `pattern`, `case_sensitive?`, `max_results?` | export table substring match; default 64 results |

### Handles (take `handle`)

| Tool | Key parameters | Notes |
|---|---|---|
| `process/enum_handles` | `max_entries?` | default 8192; NtQuerySystemInformation |

### System (no handle)

| Tool | Parameters | Notes |
|---|---|---|
| `system/info` | — | build number, page size, CPU count, `is_24h2_or_later` |
| `system/list_drivers` | — | kernel module list; gated: kernel_rw_access |
| `process/get_command_line` | — | PEB.ProcessParameters.CommandLine |
| `process/list_environment` | `max_bytes?` | PEB.ProcessParameters.Environment |

### Enma scripting bridge (no handle)

| Tool | Parameters | Notes |
|---|---|---|
| `script/get_context` | — | **Call first.** Returns full language + API reference string. |
| `script/validate` | `source` | Compile-check only. Returns `{ok, errors[{line, message}]}` |
| `script/execute` | `source` | Compile + run `main()`. Returns `{ok, logs[]}` |
