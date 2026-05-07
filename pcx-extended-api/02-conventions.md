# Conventions

> Pages 3-4 of `perception_enma_docs.pdf` (OCR'd).

<!-- page 3 -->
Conventions
* Colors and positions: always wrap. color(255, 255, 255, 255) , vec2(10.0,
20.0) . Freshly constructed each frame is fine; Enma drops the temporaries at
scope exit.
* Float32 literals: 0.2f , not cast<float32>(0.2) . Required for vertex buffers.
* Handles: all create_* / load_x natives return an encrypted inté4 . Pass it
back into draw / bind / destroy. Don't inspect.
Canonical dump
From the host side, enma::extract_documentation (engine) returns a pseudo-
header of every registered type and native with descriptions.
enma: :extract_intellisense (engine) returns the same as
std: :vector<doc_entry_t> for IDEs.
SDK
Perception's Enma SDK is not public yet.

---

<!-- page 4 -->
£3 o
Lifecycle and Routines
Script load, main() entry, routines, unload
Entry point
Every script needs a main() function. It runs once when the script is loaded.

int64 main() {

// setup state, load resources, register routines
return 1;

¥
main() 's return value decides what happens next:

Return Behavior

> 0 Script stays loaded.

= 0 Script unloads immediately after main()

- returns.

Use return 1; for any normal long-lived script. Return © for one-shot scripts
that just wanted to do work in main() and exit.
Routines
A routine is a script function that runs continuously after main() returns. Routines
are how your script keeps doing work over time.

int64 register_routine(int64 fn_handle, int64 data);

bool unregister_routine(inté4 routine_handle);
