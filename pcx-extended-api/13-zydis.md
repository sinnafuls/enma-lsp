# Zydis API

> Pages 59-62 of `perception_enma_docs.pdf` (OCR'd).

<!-- page 59 -->
Zydis API

x86_64 assembler / disassembler via Zydis

All Zydis natives are auto-registered into every loaded script. Register source:

enma_zydis_api.cpp .

Two handle types:

* zydis_req_t — single-instruction encoder request (mnemonic + operands).
* zydis_builder_t — sequence of requests + raw byte chunks; encodes to a
flat byte buffer with absolute addressing.

Constants are exposed as enums ( zydis_machine_mode: :long_64 etc.) so no

header import is needed.

zydis_req_t
zydis_req_t r; // factory:
defaults to MODE_LONG_64
r.set_mnemonic (int64 mnemonic); //
ZydisMnemonic value (use zydis_mnemonic_from_string)
r.set_machine_mode(zydis_machine_mode mode);
r.set_operand_count(int64 count); // 0..4
r.set_branch_type (zydis_branch_type type);
r.set_branch_width(zydis_branch_width width);
r.set_operand_reg(int64 idx, inté4 reg);
// ZydisRegister value
r.set_operand_imm(int64 idx, int64 imm);
r.set_operand_mem(int64 idx, int64 base, int64 idx_reg, inté4 scale,
int64 disp, int64 size);
r.set_operand_ptr(inté64 idx, inté64 segment, inté4 offset);
int64 r.get_mnemonic();
zydis_machine_mode r.get_machine_mode();
inté4 r.get_operand_count();

---

<!-- page 60 -->
Encoding
array<uint8> zydis_encode (zydis_req_t req);
// empty array on failure
array<uint8> zydis_encode_absolute(zydis_req_t req, int64 runtime_rip);
// bakes RIP-relative immediates
array<uint8> zydis_nop_fill (int64 length);
// minimal NOP padding
zydis_req_t zydis_decoded_to_request(array<uint8> bytes, inté4
runtime_rip);
zydis_decoded_to_request decodes the bytes and returns a fresh request you can
mutate and re-encode (useful for instruction patching).
Mnemonic / register name lookup
int64 zydis_mnemonic_from_string(string name); // case-insensitive;
© (INVALID) if no match
string zydis_mnemonic_to_string (int64 mnemonic);
int64 zydis_register_from_string(string name); // case-insensitive;
0 (NONE) if no match
string zydis_register_to_string (int64 reg);
Disassembly (textual)
array<string> zydis_disasm(array<uint8> bytes, int64 runtime_rip);
One element per decoded instruction, formatted as Zydis's intel syntax (e.g. "mov
rax, 0x1234" ). Decoding stops at the first invalid byte.
For per-operand structure, decode + convertto a zydis_req_t via
zydis_decoded_to_request and read the request fields.

---

<!-- page 61 -->
zydis_builder_t
Builds a sequence of instructions (and raw bytes) into one flat output buffer. Tracks
a base address so RIP-relative encoding produces correct offsets.
zydis_builder_t b;
b.set_machine_mode(zydis_machine_mode mode);
b.set_base_address(inté64 addr);
b.clear();
b.push (zydis_req_t req);
b.push_bytes (array<uint8> bytes);
b.push_byte (uint8 b);
b.push_ul6 (uintl16 v); // little-endian
b.push_u32 (uint32 v); // little-endian
b.push_u64 (uinté4d v); // little-endian
b.push_nop (int64 count);
b.push_int3 0;
b.push_ret ©3
array<uint8> b.build(); // encode every entry in order
int64 b.get_count(); // number of entries
Enums (no header needed)
zydis_machine_mode::1long_64 / long_compat_32 / long_compat_16 /
legacy_32 / legacy_16 / real_16
zydis_branch_type::none / short / near / far
zydis_branch_width::none / w8 / wl6 / w32 / wé4d

---

<!-- page 62 -->
Example: encode mov rax, 0x42 ,then disasm
int64 mov_id = zydis_mnemonic_from_string("mov");
int64 rax_id = zydis_register_from_string("rax");

zydis_req_t 1;
r.set_mnemonic(mov_id);
r.set_operand_count(2);
r.set_operand_reg(0, rax_id);
r.set_operand_imm(1, 0x42);
array<uint8> bytes = zydis_encode(x);
array<string> texts = zydis_disasm(bytes, 0);
println(texts.get(0)); // "mov rax, 0x42"
