# Lifecycle and Routines

> Pages 5-7 of `perception_enma_docs.pdf` (OCR'd).

<!-- page 5 -->
Callback shape
The function you register takes one inté64 parameter:
void my_callback(inté64 data) {
// data: the value you passed as the second arg to register_routine
¥
Pass the function as a closure handle via cast<int64>(£fn_name) :
int64 main() $
inté4 r = register_routine(cast<int64>(my_callback), 42);
return 1;
t
register_routine returns a handle. Keep it if you intend to unregister later, or
discard.
Multiple routines
Register as many as you need.
void on_render(inté64 data) { /x draw */ }
void on_tick(inté4 data) i /* update logic */ }
int64 main() §
register_routine(cast<int64>(on_render), 0);
register_routine(cast<int64>(on_tick), 0);
return 1;
3
Unregistering
unregister_routine(my_handle);

---

<!-- page 6 -->
A routine can also unregister itself from inside its own callback:
int64 g_handle;
void my_callback(inté4 data) {
if (should_stop()) {
unregister_routine(g_handle);
return;
}
// normal work
kh
int64 main() {
g_handle = register_routine(cast<inté4>(my_callback), 0);
return 1;
3
Unload
A script unloads when main() returns <= 0 , when the user unloads it from the Ul,
or when the host shuts down. On unload all routines stop and any GPU resources
you created via the render API are destroyed automatically.
Exceptions
Routines automatically catch uncaught throws and faults. The error is logged to
<my_games>\exceptions\enma.log with a timestamp, the routine id, the thrown
value, and the source line where it happened. The script keeps running.
Diagnostic helpers
Quick tracing without touching the renderer:

---

<!-- page 7 -->
void heartbeat(); // log "heartbeat called"
void take_int(int64 x); // log an int value
void take_ptr(inté4 p); // log a pointer in hex
void test_3arg(inté64 a, inté4 b, inté4 c); // log three ints
Useful for confirming a code path is reached or sanity-checking a value.
