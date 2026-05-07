# Render API

> Pages 40-48 of `perception_enma_docs.pdf` (OCR'd).

<!-- page 40 -->
Perception's 2D and custom-GPU rendering natives
All render natives are auto-registered into every loaded script. Register source:
enma_render_api.cpp .
Handles ( int64 ) are encrypted pointers. Pass them back into other render calls.
Don't dereference or arithmetic them.
color type
color ¢ = colox(x, g, b, a); // xr, g, b, a: uint8 (0..255)
c.x(); c.g); c.b(); c.a();
2D primitives
int64 draw_rect(vec2 pos, vec2 size, color c, float64 thickness,
float64 rounding, uint8 rounding_flags);
inté4 draw_rect_filled(vec2 pos, vec2 size, color c, floaté4 rounding,
uint8 rounding_flags);
int64 draw_line(vec2 a, vec2 b, color c, floaté64 thickness);
int64 draw_circle(vec2 center, float64 radius, color c, float6d
thickness, bool filled);
int64 draw_arc(vec2 center, vec2 radii, float64 start_deg, float64
sweep_deg, color c, floaté64 thickness, bool filled);
int64 draw_triangle(vec2 a, vec2 b, vec2 c, color col, floaté4d
thickness, bool filled);
int64 draw_four_corner_gradient(vec2 pos, vec2 size, color tl, color
tr, color bl, color br, floaté4 rounding);
int64 draw_polygon(array xy_pairs, uint32 count_pairs, color c, floaté4
thickness, bool filled);
inté64 draw_bitmap(inté4 bmp, vec2 pos, vec2 size, color tint, bool
rounded) ;
int64 draw_text(string text, vec2 pos, color c, inté4 font, int32
effect, color effect_color, float64 effect_amount);

---

<!-- page 41 -->
effect : 0=none, 1=shadow, 2=outline. rounding_flags : bitmask of which corners
to round (ImGui-style, 15 = all corners).
Text and fonts
float64 get_text_width(inté64 font, string text, int32 maxw, int32
maxh) ;
float6d get_text_height(inté4 font, string text, int32 maxw, int32
maxh) ;
int32 get_char_advance(int64 font, uint32 wchar32);
int64 create_font(string path, floaté4 size, bool antialias, bool
load_coloxr, array glyph_ranges);
inté4 create_font_mem(string label, floaté4 size, array buf, bool
antialias, bool load_color, array glyph_ranges);
inté4 create_bitmap(array data);
int64 get_fontl8();
int64 get_font20();
inté64 get_font24();
inté4 get_font28();
create_font first tries the path as-is, then retries under perception's main dir.
glyph_ranges may be an empty array.
Clipping
int64 clip_push(vec2 pos, vec2 size);
inté4 clip_pop();
Viewport
float64 get_view_width();
float64 get_view_height();
float6d get_view_scale();
float6d get_fps();

---

<!-- page 42 -->
Shaders
int64 create_shader(string vs_source, string ps_source, string layout);
int64 destroy_shader(int64 shader);
inté4 create_compute_shader (string cs_source);
inté4 destroy_compute_shader(inté4 cs);
Layout format: "SEMANTIC:INDEX:TYPE, ..." .Example: "POSITION:0:FLOAT2,
COLOR: 0:FLOAT4" . Types: FLOAT1, FLOAT2 , FLOAT3 , FLOAT4 , BYTE4 (unorm)
UINTZ .
Buffers
int64 create_vertex_buffer(uint32 stride, uint32 max_vertices, bool
dynamic);
inté4 destroy_vertex_buffer(inté4 vb);
int64 create_index_buffer(uint32 max_indices, bool use_32bit, bool
dynamic);
int64 destroy_index_buffer(inté4 ib);
int64 create_constant_buffer(uint32 size);
inté4 destroy_constant_buffer(inté4 cb);
inté4 create_structured_buffer(uint32 element_size, uint32
element_count, bool cpu_write, bool gpu_write);
int64 destroy_structured_buffer(inté4d sb);

---

<!-- page 43 -->
Pipeline state
inté4 create_blend_state(int32 src, int32 dst, int32 op, int32
src_alpha, int32 dst_alpha, int32 op_alpha);
inté4 destroy_blend_state(inté4 bs);
int64 create_sampler(int32 filter, int32 address_u, int32 address_v);
int64 destroy_sampler(inté4 s);
inté4 create_depth_stencil_state (bool depth_enable, bool depth_write,
int32 compare_func);
int64 destroy_depth_stencil_state(inté4 ds);
int64 create_rasterizer_state(int32 cull_mode, int32 fill_mode, bool
scissor_enable);
int64 destroy_rasterizer_state(int64 rs);
Enum values (all int32 ):
® blend_factor : 0=ZERO, 1=ONE, 2=SRC_ALPHA, 3=INV_SRC_ALPHA,
4=DEST_ALPHA, 5=INV_DEST_ALPHA, 6=SRC_COLOR, 7=INV_SRC_COLOR,
8=DEST_COLOR, 9=INV_DEST_COLOR.
® blend_op : 0=ADD, 1=SUBTRACT, 2=REV_SUBTRACT, 3=MIN, 4=MAX.
e filter : 0=POINT, 1=LINEAR, 2=ANISOTROPIC.
® address : 0=WRAP, 1=CLAMP, 2=MIRROR, 3=BORDER.
* compare_func : 0=NEVER, 1=LESS, 2=EQUAL, 3=LESS_EQUAL, 4=GREATER,
5=NOT_EQUAL, 6=GREATER_EQUAL, 7=ALWAYS.
Render targets and textures
inté4 create_render_target(uint32 width, uint32 height);
int64 destroy_render_target(intéd rt);
int64 create_depth_buffer(uint32 width, uint32 height);
inté4 destroy_depth_buffer(inté4 db);
int64 create_texture(uint32 width, uint32 height, array rgba_data);
inté4 destroy_texture(int64 tex);
inté4 load_texture(string path);
int64 load_texture_mem(array data);
float6d get_texture_width(inté4 tex);
float64 get_texture_height(int64 tex);

---

<!-- page 44 -->
create_texture wants width x height * 4 bytes of RGBA.

Meshes
int64 create_mesh_raw(array vertex_data, uint32 vertex_count, uint32
stride, array index_data, uint32 index_count, bool use_32bit);
int64 load_mesh (string path);
inté4 load_mesh_mem(array data);
int64 destroy_mesh(inté64 mesh);
int64 get_mesh_vert_count(inté4 mesh);
int64 get_mesh_index_count(inté4 mesh);
float64 get_mesh_stride(int64 mesh);
float64 get_mesh_bounds_min_x(int64 mesh);
float64 get_mesh_bounds_min_y(int64 mesh);
float64 get_mesh_bounds_min_z(int64 mesh);
floaté4 get_mesh_bounds_max_x(int64 mesh);
float64 get_mesh_bounds_max_y(int64 mesh);
float64 get_mesh_bounds_max_z(int64 mesh);

---

<!-- page 45 -->
Custom draw
inté4 custom_draw(inté4 shader, inté4 vb, array vertex_data, uint32
vertex_count, int32 topology,
inté4 blend, inté4 sampler, inté4 texture, int32
tex_slot,
int64 cb, array cb_data, int32 ch_slot);
inté4 custom_draw_indexed(int64 shader, int64 vb, array vertex_data,
uint32 vertex_count,
inté4 ib, array index_data, uint32
index_count, int32 topology,
int64 blend, int64 sampler, int64 texture,
int32 tex_slot,
int64 cb, array cb_data, int32 cb_slot);
int64 draw_mesh(int64 mesh, int64 shader, int32 topology,
int64 blend, int64 sampler, inté4 texture, int32
tex_slot,
inté4 cb, array cb_data, int32 cb_slot);
inté64 dispatch_compute(inté4 cs, uint32 x, uint32 y, uint32 z);
topology : O=TRIANGLE_LIST, 1=TRIANGLE_STRIP, 2=LINE_LIST, 3=LINE_STRIP,
4=POINT_LIST.
Any of blend / sampler / texture / cb canbe 0 to skip binding. cb_data
may be an empty array.

---

<!-- page 46 -->
Binding and state
int64 custom_set_render_target(inté4 rt);
int64 custom_set_render_target_ext(int64 rt, int64 depth_buffer);
inté4 custom_reset_render_target();
inté4 custom_bind_rt_as_texture(inté4 rt, int32 slot);
int64 custom_restore_state();
int64 custom_set_depth_stencil_state(inté4 ds);
int64 custom_set_rasterizer_state(int64 rs);
int64 custom_set_viewport(floaté4 x, floatéd y, float64 w, floatéd h);
inté4 custom_reset_viewport();
int64 custom_bind_texture(int64 texture, inté4 sampler, int32 slot);
int64 custom_bind_constant_buffer(inté4 cb, array data, int32 slot,
int32 stage);
int64 custom_update_texture(int64 tex, uint32 x, uint32 y, uint32 w,
uint32 h, array rgha_data);
int64 custom_clear_render_target(inté64 rt, floaté64 r, floated g,
floated b, floated a);
int64 custom_clear_depth_buffer(inté4 db);
int64 bind_structured_buffer(int64 sb, int32 slot, int32 stage);
int64 update_structured_buffer(inté4 sb, array data);
inté4 capture_backbuffer(int32 slot);
stage : 0=VS, 1=PS, 2=CS (matches D3D11 shader stages).
Call custom_restore_state() after any custom-pipeline sequence before returning
control to the 2D layer.

---

<!-- page 47 -->
Minimal triangle
int64 g_shader;
int64 g_vb;
inté4 main() {
string vs = "struct VSIn { float2 pos : POSITION; float4 color :
COLOR; %;\nstruct VSOut { float4 pos : SV_Position; float4 color :
COLOR; %;\nVSOut main(VSIn i) { VSOut o; o.pos = float4(i.pos, 0.0,
1.0); o.color = i.color; return o; ¥\n";
string ps = "struct VSOut { floatd4 pos : SV_Position; floatd color
: COLOR; %;\nfloat4 main(VSOut i) : SV_Target { return i.color; ¥\n";
g_shader = create_shader(vs, ps, "POSITION:0:FLOAT2,
COLOR:0:FLOAT4");
g_vb = create_vertex_buffer(24, 3, true); // 2x4 + 4x4 = 24 bytes
per vertex
register_routine(cast<int64>(my_draw), 0);
return 1;
¥
void my_draw(inté4 data) {
float32[] verts;
// vertex 0: pos(-0.5, -0.5) colox(1, 0, 0, 1)
verts.push(-0.5f); verts.push(-0.5f);
verts.push(1.0f); verts.push(0.0f); verts.push(0.0f);
verts.push (1.01);
// vertex 1: pos(0.5, -0.5) color(0, 1, 0, 1)
verts.push(0.5f); verts.push(-0.5f);
verts.push(0.0f); verts.push(1.0f); verts.push(0.0f);
verts.push (1.01);
// vertex 2: pos(0, 0.5) color(0, 0, 1, 1)
verts.push(0.0f); verts.push(0.5f);
verts.push(0.0f); verts.push(0.0f); verts.push(1.0f);
verts.push (1.01);
float32[] no_cb;
custom_draw(g_shader, g_vb, verts, 3, 0, 0, 0, 0, 0, 0, no_ch, 0);
I

---

<!-- page 48 -->
Cleanup
On script unload, every handle returned by create_* / load_x is destroyed
automatically. Explicit destroy_x is optional and only needed if you want to free a
resource mid-script.
