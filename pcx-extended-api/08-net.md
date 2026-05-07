# Net API

> Pages 37-39 of `perception_enma_docs.pdf` (OCR'd).

<!-- page 37 -->
HTTP GET / POST and WebSocket client (gated)
All net natives are auto-registered into every loaded script. Register source:
enma_net_api.cpp .
All network calls are gated by the network_access permission flag (toggled host-
side per script). Without permission, calls log + return a transport-failure shape
(status=0 / null handle).
HTTP — sync, with timeout
http_response_t http_get (string url, inté64 timeout_ms);
http_response_t http_post(string url, string content_type, string body,
int64 timeout_ms);
Both always return a non-null http_response_t . Read via methods:
inté4 response.status(); // © on transport failure / permission
denied
string response.body();
bool response.ok(); // true if status is 200..299
content_type may be empty for http_post .
WebSocket
ws_t ws_connect (string url, inté4 timeout_ms);
Connects to ws://, wss:// (also http:// | https:// accepted). Spawns a
background recv thread. Returns a null handle on failure or permission denied.

---

<!-- page 38 -->
ws_t methods
bool ws.is_open();
bool ws.send_text (string msg);
bool ws.send_binary(array<uint8> data);
ws_message_t ws.recv(); // blocks until a message arrives or the
connection closes
ws_message_t ws.poll(); // non-blocking
void ws.close(inté64 code); // standard WS close codes (1000
= normal)
ws_message_t methods
bool msg.ok(); // true if a message was returned
bool msg.is_text(); // payload framing
bool msg.is_closed(); // peer / local close has fired
string msg.payload();
Example
http_response_t r = http_get("https://api.example.com/status", 5000);
if (r.ok()) {
println("got: " + r.body());
t else if (r.status() == 0) {
println ("transport failed or permission denied");
1 else {
println("server returned " + cast<string>(r.status()));
k

---

<!-- page 39 -->
ws_t ws = ws_connect("wss://echo.example.com/", 5000);
if (cast<int64>(ws) == 0) return 0;
ws.send_text ("hello");
ws_message_t m = ws.recv();
if (m.ok()) {
println("got: " + m.payload());
5
ws.close (1000) ;
Permission
network_access is a host-side permission gate. The user grants it per script via
the host Ul. When off, every net native logs + returns transport-failure shape.
[ENMA] http_get: blocked by 'network_access' permission gate
Lifetime
ws_t closes + frees via the destructor at scope exit. The recv thread is joined. If
the script forgets, the host sweeps remaining websockets at unload — connections
closed, threads joined, no permanent leak.
