# Unicorn API

> Pages 51-54 of `perception_enma_docs.pdf` (OCR'd).

<!-- page 51 -->
Unicorn API
x86_64 CPU emulation via Unicorn Engine
All unicorn natives are auto-registered into every loaded script. Register source:
enma_unicorn_api.cpp .
cpu_t is the emulator handle. RAIl destructor closes the engine + frees user
hooks. Standalone or process-bound (process-bound: unmapped reads pull from
proc.rvm , Writes go to proc.wvm ).
Constants — exposed as enums (no header import needed)
uc_reg::rax / rbx / rex / rdx / rsi / rdi / zbp / rsp
uc_reg::xr8 .. rib
uc_reg::rip / eflags
uc_reg::cs / ds / es / fs / gs / ss
uc_reg::fs_base / gs_base / mxcsr
uc_reg::xmm@ .. xmml5
uc_reg::ymm@ .. ymml5
uc_prot::none / read / write / exec / rw / rx / rwx / all
uc_hook: :code // fires per instruction
uc_hook: :mem_unmapped // fires on read/write/fetch to unmapped page
Construction
cpu_t cpu_create();
cpu_t cpu_create_process(proc_t proc, bool allow_writes);
® cpu_create — standalone emulator, no process backing.
® cpu_create_process — unmapped reads pull pages from proc.rvm ; writes go
to proc.wvm if allow_writes=true . Auto-installs read/write/fetch/unmapped
hooks plus invalid-instruction + interrupt handlers.

---

<!-- page 52 -->
The destructor closes the engine and frees any user hooks.
Memory
bool cpu.mem_map (inté4 addr, inté4 size, uc_prot perms);
bool cpu.mem_write(inté4 addr, array<uint8> bytes);
array<uint8> cpu.mem_read (int64 addr, int64 size); //
empty array on read failure
addr and size should be page-aligned. mem_map returns true on success or
already-mapped. perms accepts uc_prot::* values OR'd together.
Registers
bool cpu.reg_writeé4d(uc_reg reg, inté4 value);
int64 cpu.reg_read64 (uc_reg reg);
bool cpu.reg_writel28(uc_reg reg, array<uint8> bytes); //
XMM, must be exactly 16 bytes
array<uint8> cpu.reg_readl28 (uc_reg reg);
bool cpu.reg_write256(uc_reg reg, array<uint8> bytes); //
YMM, must be exactly 32 bytes
array<uint8> cpu.reg_read256 (uc_reg reg);
Execution
int64 cpu.start(inté4 begin, int64 end, int64 timeout, inté4 count);
Emulates from begin to end . timeout=0 and count=0 are unbounded. Returns a
uc_err code (0 = OK).

---

<!-- page 53 -->
void cpu.emu_stop(); // halt emulation from inside a hook
bool cpu.flush_code(); // drop translation cache (after self-
modifying writes)
bool cpu.setup_stack(int64 base, int64 size, int64 stop_addr);
setup_stack maps stack pages, plants a NOP page at stop_addr (soa RET out
lands somewhere mapped), and sets RSP .
Hooks (script callbacks)
bool cpu.hook_add(uc_hook hook_kind, inté4 fn_handle);
* fn_handle = cast<int64>(my_callback) closure handle.
* Callback shape: int64 cb(inté4 addr) . Return O to stop emulation; non-zero
to continue.
The currently-emulating CPU is available as cpu_active() from inside the callback
— useful for reading/writing state without capturing the handle.
cpu_t cpu_active(); // null outside a hook
Exception inspection
int64 cpu.get_last_exception(); // NTSTATUS-shaped: 0 = none,
0xCOOOOOLD = invalid insn, OxCOOEOEO5 = AV
int64 cpu.get_exception_address(); // RIP at the faulting instruction
Set when emulation stops due to invalid instruction, AV-style unmapped access, or
interrupt.

---

<!-- page 54 -->
Example: emulate mov rax, 0x42; hlt
cpu_t cpu = cpu_create();
cpu.mem_map (0x10000, 0x1000, uc_prot::rwx);
cpu.mem_map (0x20000, 0x1000, uc_prot::rw);
// Build code: mov rax, 0x42 + hlt (OxF4)
zydis_req_t 1;
r.set_mnemonic(zydis_mnemonic_from_string("mov"));
r.set_operand_count(2);
r.set_operand_reg(0, zydis_register_from_string("rax"));
r.set_operand_imm(1, 0x42);
array<uint8> code = zydis_encode(r);
code. push(cast<uint8>(0xF4));
cpu.mem_write (0x10000, code);
cpu.reg_write64(uc_reg::rsp, 0x21000 - 8);
cpu.start(0x10000, 0x10000 + code.length(), 1000000, 0);
println(cast<string>(cpu.reg_read64(uc_reg::rax))); // "66" (=
0x42)
Lifetime
cpu_t releases its host resources via the destructor at scope exit. If a script
forgets, the host sweeps remaining cpus at unload — engine closed, hooks freed,
no permanent leak.
Notes
* Hook callbacks fire on the emulating thread (whichever thread called
cpu.start ). Enma's TLS is already set up in that context — heap-alloc, string
concat etc. all work.
® cpu_create_process automatically maps a fake TEB at 0x101000 and a fake /
real PEB so guest code reading FS/GS doesn't fault. gs_base and fs_base are
set to the fake TEB.
