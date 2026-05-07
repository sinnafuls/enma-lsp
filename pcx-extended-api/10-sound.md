# Sound API

> Pages 49-50 of `perception_enma_docs.pdf` (OCR'd).

<!-- page 49 -->
Load and play .wav / .ogg sounds
All sound natives are auto-registered into every loaded script. Register source:
enma_sound_api.cpp .
Two handle types:

* sound_t — a loaded resource. Multiple instances can play from one resource

concurrently.

* sound_inst_t — a live playback instance. Returned by sound.play(...) .
Both are int64 -backed handles with auto-cleanup destructors. Resources are
tracked per-script; an unload sweep frees anything the user forgot to drop.
Load / unload

sound_t load_sound(string relative_path);
Loads <my_games>/<relative_path> . Path is validated:

* No .. segments.

e No : (drive letters), \n, \r.

e Cannot start with / or \ (must be relative).

Returns a null handle on validation failure or read failure. The destructor frees the
resource.
Playback
sound_inst_t sound.play(floaté4 volume, floaté4 pan, bool loop);

---

<!-- page 50 -->
® volume :0.0..1.0 (clamped)
® pan: -10 (full left) .. 1.0 (full right) (clamped)
® loop : repeat forever until stopped
Instance control
bool sound_inst.is_playing();
void sound_inst.stop();
void sound_inst.set_volume(float64 v); // 0..1
void sound_inst.set_pan(floaté4 p); // -1..1
Globals
void stop_all_sounds(); // halts every instance globally
Example
int64 main() §
sound_t snd = load_sound("sounds/notification.wav");
if (cast<inté64>(snd) == 0) return 0;
sound_inst_t inst = snd.play(0.5, 0.0, false);
while (inst.is_playing()) sleep_ms(50);
return 1;
// snd / inst drop here; resource + instance freed
¥
Lifetime
sound_t and sound_inst_t both release at scope exit. If the script forgets, the
host sweeps remaining handles at unload. No permanent leak.
