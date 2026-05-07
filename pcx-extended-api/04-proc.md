# Proc API

> Pages 8-13 of `perception_enma_docs.pdf` (OCR'd).

<!-- page 8 -->
Process reference, memory read/write, module enum, scans
All proc natives are auto-registered into every loaded script. Register source:
enma_proc_api.cpp .
proc_t is a value-type handle. Construct it via ref_process(...) ; the host ref is
released automatically when the variable goes out of scope.
Some natives are gated by permission flags toggled host-side. Gated calls log and
return O / false when blocked. See Permissions.
proc_t
proc_t ref_process(uint32 pid);
proc_t ref_process(string name);
Returns an alive handle on success, a null one on failure. Verify with .alive() .
Identity
inté4 proc.base_address();
inté4 proc.peb();
uint32 proc.pid();
bool proc.alive();
bool proc.is_valid_address(int64 addr);

---

<!-- page 9 -->
Read primitives
uint8/16/32/64 proc.ru8/rul6/ru32/rub4(inté4 addr);
int8/16/32/64 proc.r8/r16/r32/r64 (int64 addr);
float32 proc.rf32(int64 addr);
float64 proc.rf64(int64 addr);
string proc.rs (int64 addr, int32 max_chars); // null-terminated UTF-
8, cap 8192
string proc.rws(int64 addr, int32 max_chars); // UTF-16, returns UTF-
8, cap 8192
All return O / empty on failure or non-usermode address.
Write primitives (gated: write_memory )
bool proc.wu8/wul6/wu32/wub4d(int64 addr, uintN v);
bool proc.w8/wl6/w32/w6s4 (int64 addr, intN wv);
bool proc.wf32(int64 addr, float32 v);
bool proc.wf64(int64 addr, float6d v);
bool proc.ws (int64 addr, string text); // UTF-8 bytes
bool proc.wws(inté64 addr, string text); // converts UTF-8 to UTF-16
Bulk read/write
array<uint8> proc.rvm(inté64 addr, int64 size); // length =
bytes actually read
bool proc.wvm(int64 addr, array<uint8> bytes); // gated:
write_memory

---

<!-- page 10 -->
SIMD-width reads/writes
array<uint8> proc.r128(int64 addr); // 16 bytes
array<uint8> proc.r256(int64 addr); // 32 bytes
array<uint8> proc.r512(int64 addr); // 64 bytes
bool proc.wl28(int64 addr, array<uint8> bytes); // gated:
write_memory
bool proc.w256(int64 addr, array<uint8> bytes); // gated:
write_memory
bool proc.w512(int64 addr, array<uint8> bytes); // gated:
write_memory

Modules and exports
int64 proc.get_module_base(string name); // © if missing
inté4 proc.get_module_size (string name); // © if missing
int64 proc.get_proc_address(int64 module_base, string export_name);
int64 proc.get_import_rdata_address(int64 module_base, string
import_name);

Pattern scanning
inte4 proc.find_code_pattern (int64 search_start, inté4
search_size, string sig);
array<inté64> proc.find_all_code_patterns(int64 search_start, inté64
search_size, string sig);

Sig syntax: hex bytes separated by spaces, ?? is a wildcard. Example: "48 8B ??

?? 48 89" .

n

---

<!-- page 11 -->
Threads
array<inté64> proc.get_all_tebs();
Pointer arrays
array<int64> proc.read_pointer_array(int64 base, inté4 count, inté64
offset_delta);
Reads count consecutive uinté4 s starting at base . offset_delta is added to
each value before storing (useful when the target stores relative offsets).
VAD / virtual_query
Both calls exclude PE-image regions (modules, exes). Use get_module_base/size
for those.
vad_region_t proc.virtual_query(inté64 address);
array<vad_region_t> proc.get_vad_snapshot(bool heap_likely_only);
virtual_query returns a vad_region_t handle on hit, © on miss.
vad_region_t
int64 region.start();
int64 region.size();
inté4 region.protection(); // host page-protection bits
(PAGE_READWRITE, PAGE_EXECUTE, etc.)
bool region.heap_likely(); // host's heuristic for heap allocations

---

<!-- page 12 -->
array<vad_region_t> snap = p.get_vad_snapshot(false);
for (inté4 i = 0; i < snap.length(); i =1 + 1) {
vad_region_t r = snap.get(i);
inté4 start = r.start();
inté4 size = r.size();
inté4 prot = r.protection();
bool heap = r.heap_likely();
3
Memory scans
All scans walk the VAD snapshot (so module memory is excluded — same caveat
as above). heap_only=true restricts to heap-likely regions.
array<int64> proc.scan_string (string text, bool heap_only);
array<inté4> proc.scan_wstring(string text, bool heap_only); //
text is UTF-8, converted to UTF-16
array<int64> proc.scan_pointer(inté4 target, bool heap_only);
array<inté64> proc.scan_u64 (int64 value, bool heap_only);
array<inté64> proc.scan_u32 (uint32 value, bool heap_only);
array<int64> proc.scan_float (float32 value, bool heap_only);
array<inté4> proc.scan_double (floaté4 value, bool heap_only);
VM alloc / free (gated: virtual_memory_operations )
inté4 proc.alloc_vm(inté4 size); // 0 on failure
bool proc.free_vm (int64 address);
Permissions
Two flags gate destructive operations. Both default to off; the user grants them per
script via the host Ul.

---

<!-- page 13 -->
Flag Gates
wux , wx , wx, ws, wws , wvm,
write_memory
w128/256/512
virtual_memory_operations alloc_vm , free_vm
When a gated call runs without permission it logs [ENMA] ... blocked: '<flag>'
permission not granted and returns O / false.
Lifetime and cleanup
proc_t releases its host ref via the destructor when the variable goes out of
scope. If a script forgets (e.g. leaks a proc_t* heap-allocation), the host sweeps
remaining refs at script unload — no permanent leak.
int64 main() §
proc_t p = ref_process("notepad.exe");
if (!p.alive()) return 0;
inté4 base = p.base_address();
println(cast<string>(p.r32(base + 0x3C))); // e_lfanew
return 0;
// p drops here; host ref released
¥
Conventions
* Addresses are int64 . Cast hex literals as needed: inté4 a =
Ox7FFO00000000; .
* Failed reads return 0, not an exception. Check is_valid_address first if you
need certainty.
* Strings returned by rs / rws are heap strings — drop normally at scope exit.
* Array returns are length-correct. arr.length() is the actual element count,
not a max.
