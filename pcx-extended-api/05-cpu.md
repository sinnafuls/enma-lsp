# CPU API

> Pages 14-16 of `perception_enma_docs.pdf` (OCR'd).

<!-- page 14 -->
CPU identification, timing, datetime helpers, bitcasts, thread priority
All CPU natives are auto-registered into every loaded script. Register source:
enma_cpu_api.cpp .
Stuff that doesn't fit cleanly into other host APIs and isn't already in Enma's
preshipped addons. For wall-clock time, ISO formatting, and unix_seconds() see
the preshipped Time 2 addon. For popcount / c1z / bswap etc., the preshipped Bits
~ addon.
CPU identification
string cpu_vendox(); // CPUID leaf 0, e.g. "GenuineIntel"
string cpu_brand(); // CPUID leaves 0x80000002..4, e.g. "Intel(R)
Core(TM) i9-..."
Timing
int64 rdtsc(); // raw cycle counter; not stable across
cores or sleep
inté4 perf_time(); // QueryPerformanceCounter
inté4 perf_frequency(); // counter ticks per second
int6é4 get_tickcounté4d(); // ms since system boot (monotonic, 64-bit
safe)
perf_time / perf_frequency together give sub-microsecond timestamps:
inté4 to = perf_time();
do_work();
float64 secs = cast<float64>(perf_time() - tO) / cast<floatesd>
(perf_frequency());

---

<!-- page 15 -->
Datetime helpers
Companions to the preshipped time addon's
year / month / day / hour / day_of_week /etc. decoders. The time addon takes a
unix timestamp; these convert intermediate fields:
inté4 now_millisecond(); // 0..999, current local time
string day_name(int64 dow); // 0..6 -> "Sunday".."Saturday";
"Unknown" out of range
string month_name(int64 month); // 1..12 -> "January".."December";
"Unknown" out of range
int64 hourl2(int64 hour24); // 0..23 -> 1..12 (12-hour wall
format)
string ampm(int64 hour24); // 0..23 -> "AM" / "PM"
Bitcasts (float « int)
Reinterpret the bit pattern; not a value conversion.
uint32 bits_£32_to_u32(float32 v);
float32 bits_u32_to_£32(uint32 v);
uint64 bits_£f64_to_ubd(floatésd v);
float64 bits_ub4_to_f64(uinted v);
For narrow ints, just cast<uint32>(x) etc. — Enma already keeps narrow ints
zero/sign-extended in 64-bit slots, so no host help needed.
Thread priority
Affects whatever thread invokes the call. Routine callbacks run each tick on their
own ticker thread, so calling from a routine adjusts that ticker thread (NOT the
script's main thread).
bool set_thread_priority(thread_priority p);

---

<!-- page 16 -->
thread_priority enum values: lowest , below_normal , normal , above_normal ,
highest .
set_thread_priority(thread_priority::highest);
