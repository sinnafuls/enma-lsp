# Perception API — Index & Minimal Example

> Pages 2-2 of `perception_enma_docs.pdf` (OCR'd).

<!-- page 2 -->
Perception API
* Lifecycle and Routines
* Render
* Proc
e CPU
* Sound
e Zydis
e Win
* [Input
e Unicorn
* Net
* GUI
Minimal example
int64 g_tick;
void my_draw(int64 data) {
g_tick = g_tick + 1;
color white = color(255, 255, 255, 255);
color noeffect = color(0, 0, 0, 0);
string text = "tick=" + cast<string>(g_tick);
draw_text (text, vec2(40.0, 40.0), white, get_font20(), 0, noeffect,
0.0);
¥
inté64 main() {
g_tick = 0;
register_routine(cast<int64>(my_draw), 0);
return 1;
¥
See Lifecycle and Routines for the entry point, return-value semantics, and how
routines tick.
