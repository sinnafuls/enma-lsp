# Win API

> Pages 55-58 of `perception_enma_docs.pdf` (OCR'd).

<!-- page 55 -->
Win API
Window enumeration + queries, clipboard, keyboard / mouse SEND
All win natives are auto-registered into every loaded script. Register source:
enma_win_api.cpp .
This API sends input and reads window state. For state polling (mouse position, key
down/up etc.), see Input API.
HWND is exposed as raw inté4 . OS-owned; if the window disappears, subsequent
calls reject via IsWindow() .
window_info_t
Snapshot of a window at enumeration time. Heap-allocated; fields read via
methods.

int64 info.hwnd();

inté4 info.pid();

int64 info.tid();

string info.process_name(); // exe basename

string info.title(); // window title at snapshot time

string info.class_name();
Enumerate / find

array<window_info_t> get_all_hwnds();

int64 find_window(string title);

int64 find_window(string title, string class_name);
find_window returns O when no match.

---

<!-- page 56 -->
Window queries
Geometry is split per axis (no array tuples). Combine pos + size for a rect.
int64 get_window_width(int64 hwnd); // © on invalid
hwnd
int64 get_window_height(int64 hwnd); // © on invalid
hwnd
vec2 get_window_pos(int64 hwnd); // screen
coords; (0,0) on invalid
vec2  get_window_size(int64 hwnd); // (width,
height) as vec2
bool is_foreground_window(inté64 hwnd);
bool is_window_active(int64 hwnd); // visible AND
not minimized
string get_window_title(inté4 hwnd);
string get_window_class(int64 hwnd);
bool set_foreground_window(int64 hwnd);
int64 get_window_thread_id(int64 hwnd); // © on invalid
hwnd
int64 get_window_process_id(int64 hwnd); // © on invalid
hwnd
bool post_message (int64 hwnd, inté4 msg, int64 wparam, inté64 lparam);
Clipboard
bool  copy_to_clipboard(string text);
string copy_from_clipboard(); // empty string when nothing or wrong
format
copy_to_clipboard is gated by perception's restricted-string filter (returns false +
logs when blocked).

---

<!-- page 57 -->
Keyboard SEND
Synthesized via SendInput . Restricted virtual keys (set host-side) are blocked +
logged.
void win_key_down (inté4 vk);
void win_key_up (int64 vk);
void win_key_press(inté4 vk, int64 delay_ms); // down + sleep + up;
delay capped at 1000ms
bool send_char(int64 hwnd, string text); //
PostMessageW (WM_CHAR), first wide char only
bool send_key (int64 hwnd, inté4 vk); //
PostMessagel (WM_KEYDOWN+WM_KEYUP) targeted at hwnd
Mouse SEND
void mouse_move (int64 x, inté64 vy); // absolute screen
coords
void mouse_move_relative(int64 dx, inté4 dy);
void mouse_left_click 0; // down + 10ms +
up
void mouse_right_click ();
void mouse_middle_click ();
void mouse_scroll (int64 amount); // multiples of
WHEEL _DELTA
void send_mouse_input (int64 dx, int64 dy, inté4 flags, inté64
mouse_data) ; // raw SendInput

---

<!-- page 58 -->
Example: focus a window and click in it
inté4 hwnd = find_window("Notepad");
if (hwnd == 0) return 0;
set_foreground_window (hwnd);
sleep_ms (50);
vec2 pos = get_window_pos (hwnd);
vec2 sz = get_window_size (hwnd);
mouse_move (pos.x() + sz.x() / 2.0, pos.y() + sz.y() / 2.0);
mouse_left_click();
