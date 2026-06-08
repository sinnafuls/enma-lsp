// Evo Framework style menu — converted from ImGuiMenu-s #1 by Dutu
// Original: C++ ImGui / DX9. Converted to Perception Enma.
//
// Features: 5 tabs (Rage, Legit, Visuals, Misc, Config), 2-column section grid,
//           animated sidebar tab indicator, animated checkboxes/sliders,
//           INSERT to toggle visibility.

import "math";

// ─── Globals ────────────────────────────────────────────────────────────────

frame_t g_frame;
bool    g_visible = true;

// Tab state
int64   g_tab       = 0;
float64 g_tanim0    = 0.0;
float64 g_tanim1    = 0.0;
float64 g_tanim2    = 0.0;
float64 g_tanim3    = 0.0;
float64 g_tanim4    = 0.0;

// Rage
bool    g_rage_enabled   = true;
float64 g_rage_fov       = 0.3;
float64 g_rage_hc        = 0.45;
bool    g_rage_autoshoot = false;
bool    g_rage_autostop  = true;
bool    g_rage_baim      = false;
float64 g_rage_mindmg    = 0.5;

// Legit
bool    g_legit_enabled  = false;
float64 g_legit_fov      = 0.15;
float64 g_legit_smooth   = 0.6;
bool    g_legit_rcs      = true;
bool    g_legit_backtrack = false;

// Visuals
bool    g_vis_esp      = true;
bool    g_vis_box      = true;
bool    g_vis_health   = true;
bool    g_vis_name     = false;
bool    g_vis_skeleton = false;
bool    g_vis_chams    = false;

// Misc
bool    g_misc_bunnyhop   = false;
bool    g_misc_autostrafe = false;
bool    g_misc_thirdperson = false;
float64 g_misc_fakelag    = 0.2;
bool    g_misc_autope     = false;

// ─── Color helpers ──────────────────────────────────────────────────────────

color C(int64 r, int64 g, int64 b) {
    return color(r, g, b, 255);
}

color CA(int64 r, int64 g, int64 b, int64 a) {
    return color(r, g, b, a);
}

color lerp_col(color a, color b, float64 t) {
    int64 r = cast<int64>(cast<float64>(a.r()) + (cast<float64>(b.r()) - cast<float64>(a.r())) * t);
    int64 g = cast<int64>(cast<float64>(a.g()) + (cast<float64>(b.g()) - cast<float64>(a.g())) * t);
    int64 bl = cast<int64>(cast<float64>(a.b()) + (cast<float64>(b.b()) - cast<float64>(a.b())) * t);
    int64 al = cast<int64>(cast<float64>(a.a()) + (cast<float64>(b.a()) - cast<float64>(a.a())) * t);
    return color(r, g, bl, al);
}

float64 lp(float64 v, float64 target) {
    return v + (target - v) * (8.0 / get_fps());
}

// ─── Widget helpers ─────────────────────────────────────────────────────────

bool draw_checkbox(vec2 pos, bool checked, string label) {
    float64 sz  = 13.0;
    color bg    = checked ? C(86, 98, 246) : C(28, 30, 46);
    color border = C(55, 60, 92);
    draw_rect_filled(pos, vec2(sz, sz), bg, 2.0, 0);
    draw_rect(pos, vec2(sz, sz), border, 1.0, 2.0, 0);
    if (checked) {
        // checkmark: two lines
        draw_line(vec2(pos.x + 3.0, pos.y + 6.5), vec2(pos.x + 5.5, pos.y + 9.5), C(255, 255, 255), 1.5);
        draw_line(vec2(pos.x + 5.5, pos.y + 9.5), vec2(pos.x + 10.0, pos.y + 3.5), C(255, 255, 255), 1.5);
    }
    draw_text(label, vec2(pos.x + sz + 7.0, pos.y - 1.0), C(200, 202, 218), get_font18(), 0, C(0,0,0), 0.0);
    bool clicked = is_hovered(pos, vec2(sz + get_text_width(get_font18(), label, 0, 0) + 7.0, sz)) && key_fired(vk.lbutton);
    return clicked;
}

void draw_slider(vec2 pos, float64 width, float64* val, string label) {
    float64 th = 4.0;
    float64 ty = pos.y + 18.0;
    // label
    string pct = format("{.0f}%", *val * 100.0);
    draw_text(label, pos, C(200, 202, 218), get_font18(), 0, C(0,0,0), 0.0);
    draw_text(pct, vec2(pos.x + width - get_text_width(get_font18(), pct, 0, 0), pos.y), CA(150, 155, 190, 200), get_font18(), 0, C(0,0,0), 0.0);
    // track
    draw_rect_filled(vec2(pos.x, ty), vec2(width, th), C(28, 30, 46), 2.0, 0);
    draw_rect_filled(vec2(pos.x, ty), vec2(width * *val, th), C(86, 98, 246), 2.0, 0);
    // thumb
    float64 tx = pos.x + width * *val;
    draw_circle(vec2(tx, ty + th * 0.5), 6.0, C(86, 98, 246), 0.0, true);
    draw_circle(vec2(tx, ty + th * 0.5), 6.0, C(100, 115, 255), 1.5, false);
    // drag
    if (is_hovered(vec2(pos.x - 6.0, ty - 6.0), vec2(width + 12.0, th + 12.0)) && key_down(vk.lbutton)) {
        float64 mx = get_mouse_pos().x;
        float64 nv = (mx - pos.x) / width;
        if (nv < 0.0) nv = 0.0;
        if (nv > 1.0) nv = 1.0;
        *val = nv;
    }
}

// ─── Section container ──────────────────────────────────────────────────────

void begin_section(vec2 pos, vec2 size, string title) {
    draw_rect_filled(pos, size, C(18, 20, 32), 5.0, 0);
    draw_rect(pos, size, C(35, 38, 60), 1.0, 5.0, 0);
    draw_text(title, vec2(pos.x + 12.0, pos.y + 10.0), CA(150, 155, 200, 200), get_font18(), 0, C(0,0,0), 0.0);
    // title separator
    draw_line(vec2(pos.x + 8.0, pos.y + 30.0), vec2(pos.x + size.x - 8.0, pos.y + 30.0), C(30, 33, 52), 1.0);
}

// ─── Draw callback ──────────────────────────────────────────────────────────

void on_draw(int64 wh) {
    if (key_fired(vk.insert)) {
        g_visible = !g_visible;
        g_frame.set_visible(g_visible);
    }
    if (!g_visible) return;

    vec2 p  = g_frame.get_pos();
    vec2 sz = g_frame.get_size();
    float64 W  = sz.x;
    float64 H  = sz.y;
    float64 sw = 62.0;   // sidebar width

    // ── Background
    draw_rect_filled(p, sz, C(12, 14, 22), 8.0, 0);
    // sidebar strip
    draw_rect_filled(p, vec2(sw, H), C(16, 18, 28), 0.0, 0);
    // sidebar right border
    draw_line(vec2(p.x + sw, p.y), vec2(p.x + sw, p.y + H), C(30, 33, 52), 1.0);

    // ── Logo / title at top of sidebar
    draw_text("E", vec2(p.x + 20.0, p.y + 14.0), C(86, 98, 246), get_font24(), 0, C(0,0,0), 0.0);
    draw_text("vo", vec2(p.x + 32.0, p.y + 16.0), CA(180, 185, 220, 200), get_font18(), 0, C(0,0,0), 0.0);

    // separator under logo
    draw_line(vec2(p.x + 8.0, p.y + 44.0), vec2(p.x + sw - 8.0, p.y + 44.0), C(30, 33, 52), 1.0);

    // ── Tab animations
    float64 target_t0 = g_tab == 0 ? 1.0 : 0.0;
    float64 target_t1 = g_tab == 1 ? 1.0 : 0.0;
    float64 target_t2 = g_tab == 2 ? 1.0 : 0.0;
    float64 target_t3 = g_tab == 3 ? 1.0 : 0.0;
    float64 target_t4 = g_tab == 4 ? 1.0 : 0.0;
    g_tanim0 = lp(g_tanim0, target_t0);
    g_tanim1 = lp(g_tanim1, target_t1);
    g_tanim2 = lp(g_tanim2, target_t2);
    g_tanim3 = lp(g_tanim3, target_t3);
    g_tanim4 = lp(g_tanim4, target_t4);

    array<string> tab_labels = {"Rage", "Legit", "Visuals", "Misc", "Config"};
    array<float64> tab_anims = {g_tanim0, g_tanim1, g_tanim2, g_tanim3, g_tanim4};

    int64 i = 0;
    while (i < 5) {
        float64 ty   = p.y + 58.0 + cast<float64>(i) * 44.0;
        vec2   tpos  = vec2(p.x, ty);
        vec2   tsz   = vec2(sw, 36.0);
        float64 a    = tab_anims.get(i);
        color  tcol  = lerp_col(CA(130, 135, 170, 200), C(220, 225, 255), a);

        // hover bg
        if (is_hovered(tpos, tsz)) {
            draw_rect_filled(tpos, tsz, CA(86, 98, 246, 20), 0.0, 0);
            if (key_fired(vk.lbutton)) g_tab = i;
        }

        // active indicator: 3px line on right edge
        if (a > 0.02) {
            float64 ind_h = 20.0 * a;
            float64 ind_y = ty + (36.0 - ind_h) * 0.5;
            draw_rect_filled(vec2(p.x + sw - 3.0, ind_y), vec2(3.0, ind_h), CA(86, 98, 246, cast<int64>(255.0 * a)), 1.5, 0);
        }

        // active bg tint
        if (a > 0.02) {
            draw_rect_filled(tpos, tsz, CA(86, 98, 246, cast<int64>(18.0 * a)), 0.0, 0);
        }

        string lbl = tab_labels.get(i);
        float64 tw = get_text_width(get_font18(), lbl, 0, 0);
        draw_text(lbl, vec2(p.x + (sw - tw) * 0.5, ty + 10.0), tcol, get_font18(), 0, C(0,0,0), 0.0);
        i = i + 1;
    }

    // ── Content area ─────────────────────────────────────────────────────────
    float64 cx  = p.x + sw + 10.0;
    float64 cy  = p.y + 14.0;
    float64 cw  = W - sw - 20.0;

    // Tab title
    array<string> titles = {"Ragebot", "Legitbot", "Visuals", "Misc", "Config"};
    draw_text(titles.get(g_tab), vec2(cx, cy), C(220, 225, 255), get_font20(), 0, C(0,0,0), 0.0);
    draw_line(vec2(cx, cy + 22.0), vec2(cx + cw, cy + 22.0), C(30, 33, 52), 1.0);

    float64 scol_w = cw * 0.5 - 5.0;
    float64 scol_h = H - 55.0;
    vec2    lp_s   = vec2(cx, p.y + 30.0);
    vec2    rp_s   = vec2(cx + scol_w + 10.0, p.y + 30.0);

    if (g_tab == 0) {
        // ── Rage tab ──────────────────────────────────────────────────────────
        begin_section(lp_s, vec2(scol_w, scol_h * 0.5 - 4.0), "General");
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 38.0), g_rage_enabled, "Enable ragebot"))   g_rage_enabled   = !g_rage_enabled;
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 64.0), g_rage_autoshoot, "Auto shoot"))    g_rage_autoshoot = !g_rage_autoshoot;
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 90.0), g_rage_autostop, "Auto stop"))      g_rage_autostop  = !g_rage_autostop;
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 116.0), g_rage_baim, "Body aim"))          g_rage_baim      = !g_rage_baim;

        float64 sb = lp_s.y + scol_h * 0.5 + 4.0;
        begin_section(vec2(lp_s.x, sb), vec2(scol_w, scol_h * 0.5 - 4.0), "Accuracy");
        draw_slider(vec2(lp_s.x + 12.0, sb + 38.0), scol_w - 24.0, &g_rage_fov,  "FOV");
        draw_slider(vec2(lp_s.x + 12.0, sb + 70.0), scol_w - 24.0, &g_rage_hc,   "Hitchance");
        draw_slider(vec2(lp_s.x + 12.0, sb + 102.0), scol_w - 24.0, &g_rage_mindmg, "Min damage");

        begin_section(rp_s, vec2(scol_w, scol_h), "Exploits");
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 38.0), g_rage_baim,       "Double tap"))   {}
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 64.0), g_misc_bunnyhop,   "Hide shots"))   {}
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 90.0), g_legit_backtrack, "Teleport"))     {}
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 116.0), g_rage_autostop,  "Safe point"))   {}
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 142.0), g_rage_enabled,   "Force baim"))   {}

    } else if (g_tab == 1) {
        // ── Legit tab ─────────────────────────────────────────────────────────
        begin_section(lp_s, vec2(scol_w, scol_h), "Aimbot");
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 38.0), g_legit_enabled, "Enable legitbot")) g_legit_enabled = !g_legit_enabled;
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 64.0), g_legit_rcs,    "RCS"))              g_legit_rcs     = !g_legit_rcs;
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 90.0), g_legit_backtrack, "Backtrack"))     g_legit_backtrack = !g_legit_backtrack;
        draw_slider(vec2(lp_s.x + 12.0, lp_s.y + 118.0), scol_w - 24.0, &g_legit_fov,    "FOV");
        draw_slider(vec2(lp_s.x + 12.0, lp_s.y + 150.0), scol_w - 24.0, &g_legit_smooth, "Smooth");

        begin_section(rp_s, vec2(scol_w, scol_h), "Triggerbot");
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 38.0), g_vis_esp,  "Enable trigger")) {}
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 64.0), g_vis_box,  "Head only"))      {}

    } else if (g_tab == 2) {
        // ── Visuals tab ───────────────────────────────────────────────────────
        begin_section(lp_s, vec2(scol_w, scol_h), "ESP");
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 38.0),  g_vis_esp,      "Enable ESP"))    g_vis_esp      = !g_vis_esp;
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 64.0),  g_vis_box,      "Box ESP"))       g_vis_box      = !g_vis_box;
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 90.0),  g_vis_health,   "Health bar"))    g_vis_health   = !g_vis_health;
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 116.0), g_vis_name,     "Name"))          g_vis_name     = !g_vis_name;
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 142.0), g_vis_skeleton, "Skeleton"))      g_vis_skeleton = !g_vis_skeleton;
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 168.0), g_vis_chams,    "Chams"))         g_vis_chams    = !g_vis_chams;

        begin_section(rp_s, vec2(scol_w, scol_h), "World");
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 38.0),  g_legit_rcs,   "Radar"))          {}
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 64.0),  g_rage_baim,   "Dropped weapons")) {}
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 90.0),  g_rage_enabled,"Bomb timer"))      {}

    } else if (g_tab == 3) {
        // ── Misc tab ──────────────────────────────────────────────────────────
        begin_section(lp_s, vec2(scol_w, scol_h), "Movement");
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 38.0),  g_misc_bunnyhop,    "Bunny hop"))    g_misc_bunnyhop    = !g_misc_bunnyhop;
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 64.0),  g_misc_autostrafe,  "Auto strafe"))  g_misc_autostrafe  = !g_misc_autostrafe;
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 90.0),  g_misc_thirdperson, "Third person")) g_misc_thirdperson = !g_misc_thirdperson;
        draw_slider(vec2(lp_s.x + 12.0, lp_s.y + 118.0), scol_w - 24.0, &g_misc_fakelag, "Fake lag");
        if (draw_checkbox(vec2(lp_s.x + 12.0, lp_s.y + 148.0), g_misc_autope, "Auto-PE")) g_misc_autope = !g_misc_autope;

        begin_section(rp_s, vec2(scol_w, scol_h), "Exploits");
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 38.0), g_rage_autoshoot, "Fake angle"))  {}
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 64.0), g_legit_rcs,      "Clantag"))     {}
        if (draw_checkbox(vec2(rp_s.x + 12.0, rp_s.y + 90.0), g_vis_chams,      "Skin changer")) {}

    } else {
        // ── Config tab ────────────────────────────────────────────────────────
        draw_text("Save / Load configs", vec2(cx + 10.0, p.y + 45.0), CA(150, 155, 200, 200), get_font18(), 0, C(0,0,0), 0.0);

        // config slot buttons
        int64 ci = 0;
        while (ci < 4) {
            float64 by = p.y + 65.0 + cast<float64>(ci) * 36.0;
            string cn = format("Config {:d}", ci + 1);
            bool hov = is_hovered(vec2(cx, by), vec2(cw * 0.5 - 5.0, 26.0));
            draw_rect_filled(vec2(cx, by), vec2(cw * 0.5 - 5.0, 26.0),
                             hov ? C(86, 98, 246) : C(22, 24, 38), 4.0, 0);
            draw_text(cn, vec2(cx + 10.0, by + 6.0), C(210, 215, 240), get_font18(), 0, C(0,0,0), 0.0);
            ci = ci + 1;
        }
    }

    // ── Outer border
    draw_rect(p, sz, C(35, 38, 60), 1.0, 8.0, 0);
}

int64 main() {
    layer_t layer = get_default_layer();
    float64 cx    = get_view_width()  * 0.5 - 325.0;
    float64 cy    = get_view_height() * 0.5 - 225.0;
    g_frame = create_draggable_frame("evo_menu", vec2(cx, cy), vec2(650.0, 450.0), layer);
    create_widget(g_frame, "evo_draw", cast<int64>(on_draw), true);
    return 1;
}
