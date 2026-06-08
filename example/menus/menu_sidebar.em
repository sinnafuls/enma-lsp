// 1011 Collapsible Sidebar style menu — converted from ImGuiMenu-s #2
// Original: C++ ImGui / DX9 with ImTricks animations.
// Converted to Perception Enma.
//
// Features: animated collapse sidebar (click ≡ button), 5 main tabs,
//           3 sub-tabs, 4-panel section grid, smooth lerp animations.

import "math";

// ─── Globals ────────────────────────────────────────────────────────────────

frame_t g_frame;
bool    g_visible     = true;
int64   g_tab         = 0;
int64   g_subtab      = 0;
bool    g_nav_open    = true;
float64 g_nav_anim    = 1.0;   // 0=collapsed(52px) 1=expanded(160px)

// tab anims
float64 g_ta0 = 1.0; float64 g_ta1 = 0.0; float64 g_ta2 = 0.0;
float64 g_ta3 = 0.0; float64 g_ta4 = 0.0;
// subtab anims
float64 g_sa0 = 1.0; float64 g_sa1 = 0.0; float64 g_sa2 = 0.0;

// Settings
bool    g_en1 = true;  bool    g_en2 = false; bool g_en3 = true;
bool    g_en4 = false; bool    g_en5 = true;  bool g_en6 = false;
float64 g_sl1 = 0.4;   float64 g_sl2 = 0.7;
float64 g_sl3 = 0.25;  float64 g_sl4 = 0.6;
int64   g_opt  = 1;

// ─── Helpers ────────────────────────────────────────────────────────────────

color C(int64 r, int64 g, int64 b) { return color(r, g, b, 255); }
color CA(int64 r, int64 g, int64 b, int64 a) { return color(r, g, b, a); }

color lerp_col(color a, color b, float64 t) {
    int64 r  = cast<int64>(cast<float64>(a.r()) + (cast<float64>(b.r()) - cast<float64>(a.r())) * t);
    int64 g  = cast<int64>(cast<float64>(a.g()) + (cast<float64>(b.g()) - cast<float64>(a.g())) * t);
    int64 bl = cast<int64>(cast<float64>(a.b()) + (cast<float64>(b.b()) - cast<float64>(a.b())) * t);
    int64 al = cast<int64>(cast<float64>(a.a()) + (cast<float64>(b.a()) - cast<float64>(a.a())) * t);
    return color(r, g, bl, al);
}

float64 lp(float64 v, float64 t) { return v + (t - v) * (9.0 / get_fps()); }

bool draw_cb(vec2 pos, bool val, string lbl) {
    color bg = val ? C(100, 110, 240) : C(24, 27, 40);
    draw_rect_filled(pos, vec2(13.0, 13.0), bg, 2.0, 0);
    draw_rect(pos, vec2(13.0, 13.0), C(48, 55, 80), 1.0, 2.0, 0);
    if (val) {
        draw_line(vec2(pos.x+3.0, pos.y+6.5), vec2(pos.x+5.5, pos.y+9.5), C(255,255,255), 1.5);
        draw_line(vec2(pos.x+5.5, pos.y+9.5), vec2(pos.x+10.0,pos.y+3.5), C(255,255,255), 1.5);
    }
    draw_text(lbl, vec2(pos.x + 20.0, pos.y - 1.0), C(195, 200, 225), get_font18(), 0, C(0,0,0), 0.0);
    return is_hovered(pos, vec2(20.0 + get_text_width(get_font18(), lbl, 0, 0), 14.0)) && key_fired(vk.lbutton);
}

void draw_slider(vec2 pos, float64 w, float64* val, string lbl) {
    string pct = format("{.0f}%", *val * 100.0);
    draw_text(lbl, pos, C(195, 200, 225), get_font18(), 0, C(0,0,0), 0.0);
    draw_text(pct, vec2(pos.x + w - get_text_width(get_font18(), pct, 0, 0), pos.y), CA(140,148,190,200), get_font18(), 0, C(0,0,0), 0.0);
    float64 ty = pos.y + 18.0;
    draw_rect_filled(vec2(pos.x, ty), vec2(w, 4.0), C(26, 30, 48), 2.0, 0);
    draw_rect_filled(vec2(pos.x, ty), vec2(w * *val, 4.0), C(100, 110, 240), 2.0, 0);
    draw_circle(vec2(pos.x + w * *val, ty + 2.0), 5.5, C(100, 110, 240), 0.0, true);
    if (is_hovered(vec2(pos.x - 5.0, ty - 5.0), vec2(w + 10.0, 14.0)) && key_down(vk.lbutton)) {
        float64 v = (get_mouse_pos().x - pos.x) / w;
        if (v < 0.0) v = 0.0;
        if (v > 1.0) v = 1.0;
        *val = v;
    }
}

void draw_section(vec2 pos, vec2 size, string title) {
    draw_rect_filled(pos, size, C(16, 18, 28), 4.0, 0);
    draw_rect(pos, size, C(30, 35, 55), 1.0, 4.0, 0);
    draw_text(title, vec2(pos.x + 10.0, pos.y + 9.0), C(100, 110, 240), get_font18(), 0, C(0,0,0), 0.0);
    draw_line(vec2(pos.x + 8.0, pos.y + 28.0), vec2(pos.x + size.x - 8.0, pos.y + 28.0), C(28, 32, 50), 1.0);
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
    float64 W = sz.x;
    float64 H = sz.y;

    // Animate nav
    g_nav_anim = lp(g_nav_anim, g_nav_open ? 1.0 : 0.0);
    float64 nav_w = 52.0 + 108.0 * g_nav_anim;

    // Background
    draw_rect_filled(p, sz, C(14, 16, 24), 7.0, 0);
    // Sidebar bg
    draw_rect_filled(p, vec2(nav_w, H), C(18, 20, 30), 0.0, 0);
    draw_line(vec2(p.x + nav_w, p.y), vec2(p.x + nav_w, p.y + H), C(28, 32, 50), 1.0);

    // ── Collapse toggle button (hamburger ≡)
    vec2 tb_pos = vec2(p.x + nav_w - 30.0, p.y + 14.0);
    bool tb_hov = is_hovered(tb_pos, vec2(24.0, 20.0));
    draw_rect_filled(tb_pos, vec2(24.0, 20.0), tb_hov ? CA(100,110,240,40) : CA(0,0,0,0), 3.0, 0);
    // draw three lines of hamburger
    int64 li = 0;
    while (li < 3) {
        float64 ly = tb_pos.y + 4.0 + cast<float64>(li) * 6.0;
        draw_line(vec2(tb_pos.x + 4.0, ly), vec2(tb_pos.x + 20.0, ly), C(160, 165, 200), 1.5);
        li = li + 1;
    }
    if (tb_hov && key_fired(vk.lbutton)) g_nav_open = !g_nav_open;

    // ── Tab animations
    g_ta0 = lp(g_ta0, g_tab == 0 ? 1.0 : 0.0); g_ta1 = lp(g_ta1, g_tab == 1 ? 1.0 : 0.0);
    g_ta2 = lp(g_ta2, g_tab == 2 ? 1.0 : 0.0); g_ta3 = lp(g_ta3, g_tab == 3 ? 1.0 : 0.0);
    g_ta4 = lp(g_ta4, g_tab == 4 ? 1.0 : 0.0);

    array<string> tab_icons  = {"RG", "AA", "VS", "IN", "MS"};
    array<string> tab_labels = {"Ragebot", "Anti-Aim", "Visuals", "Inventory", "Misc"};
    array<float64> ta_vals   = {g_ta0, g_ta1, g_ta2, g_ta3, g_ta4};

    int64 ti = 0;
    while (ti < 5) {
        float64 ty   = p.y + 52.0 + cast<float64>(ti) * 44.0;
        float64 a    = ta_vals.get(ti);
        color   tcol = lerp_col(CA(120,128,170,180), C(215,220,255), a);

        bool thov = is_hovered(vec2(p.x, ty), vec2(nav_w, 36.0));
        if (thov) {
            draw_rect_filled(vec2(p.x, ty), vec2(nav_w, 36.0), CA(100,110,240,18), 0.0, 0);
            if (key_fired(vk.lbutton)) g_tab = ti;
        }
        if (a > 0.02) {
            draw_rect_filled(vec2(p.x, ty), vec2(nav_w, 36.0), CA(100,110,240, cast<int64>(14.0*a)), 0.0, 0);
            float64 ih = 18.0 * a;
            draw_rect_filled(vec2(p.x + nav_w - 3.0, ty + (36.0 - ih)*0.5), vec2(3.0, ih), CA(100,110,240, cast<int64>(255.0*a)), 1.5, 0);
        }
        // icon (always visible)
        string icon = tab_icons.get(ti);
        draw_text(icon, vec2(p.x + 14.0, ty + 10.0), tcol, get_font18(), 0, C(0,0,0), 0.0);
        // label (fades in with nav)
        if (g_nav_anim > 0.05) {
            string lbl = tab_labels.get(ti);
            draw_text(lbl, vec2(p.x + 40.0, ty + 10.0), CA(tcol.r(), tcol.g(), tcol.b(), cast<int64>(255.0 * g_nav_anim)), get_font18(), 0, C(0,0,0), 0.0);
        }
        ti = ti + 1;
    }

    // ── Content area
    float64 cx  = p.x + nav_w + 10.0;
    float64 cw  = W - nav_w - 20.0;

    // Tab title
    array<string> titles = {"Ragebot", "Anti-Aim", "Visuals", "Inventory", "Misc"};
    draw_text(titles.get(g_tab), vec2(cx, p.y + 12.0), C(215, 220, 255), get_font20(), 0, C(0,0,0), 0.0);

    // Sub-tabs (Ragebot only)
    if (g_tab == 0) {
        array<string> stabs = {"General", "Accuracy", "Exploits"};
        g_sa0 = lp(g_sa0, g_subtab == 0 ? 1.0 : 0.0);
        g_sa1 = lp(g_sa1, g_subtab == 1 ? 1.0 : 0.0);
        g_sa2 = lp(g_sa2, g_subtab == 2 ? 1.0 : 0.0);
        array<float64> sa_vals = {g_sa0, g_sa1, g_sa2};

        float64 st_x = cx;
        int64   si   = 0;
        while (si < 3) {
            string  sn  = stabs.get(si);
            float64 stw = get_text_width(get_font18(), sn, 0, 0) + 10.0;
            float64 sa  = sa_vals.get(si);
            color   sc  = lerp_col(CA(130,138,175,180), C(100,110,240), sa);
            draw_text(sn, vec2(st_x + 5.0, p.y + 34.0), sc, get_font18(), 0, C(0,0,0), 0.0);
            if (sa > 0.02)
                draw_rect_filled(vec2(st_x, p.y + 48.0), vec2(stw, 2.0), CA(100,110,240, cast<int64>(255.0*sa)), 1.0, 0);
            if (is_hovered(vec2(st_x, p.y + 30.0), vec2(stw, 22.0)) && key_fired(vk.lbutton)) g_subtab = si;
            st_x = st_x + stw + 8.0;
            si = si + 1;
        }
    }

    float64 sec_y = p.y + (g_tab == 0 ? 56.0 : 36.0);
    float64 sec_h = H - sec_y + p.y - 10.0;
    float64 sw2   = cw * 0.5 - 5.0;

    // ── Sections (shared layout: 2×2 grid)
    vec2 s1 = vec2(cx, sec_y);
    vec2 s2 = vec2(cx + sw2 + 10.0, sec_y);
    vec2 s3 = vec2(cx, sec_y + sec_h * 0.5 + 4.0);
    vec2 s4 = vec2(cx + sw2 + 10.0, sec_y + sec_h * 0.5 + 4.0);
    vec2 sh = vec2(sw2, sec_h * 0.5 - 4.0);

    if (g_tab == 0) {
        draw_section(s1, sh, "General");
        if (draw_cb(vec2(s1.x+10.0,s1.y+36.0), g_en1, "Enabled"))      g_en1 = !g_en1;
        if (draw_cb(vec2(s1.x+10.0,s1.y+58.0), g_en2, "Auto shoot"))   g_en2 = !g_en2;
        draw_slider(vec2(s1.x+10.0, s1.y+82.0), sw2-20.0, &g_sl1, "FOV");

        draw_section(s2, sh, "Accuracy");
        if (draw_cb(vec2(s2.x+10.0,s2.y+36.0), g_en3, "Safe point"))   g_en3 = !g_en3;
        draw_slider(vec2(s2.x+10.0, s2.y+60.0), sw2-20.0, &g_sl2, "Hitchance");
        draw_slider(vec2(s2.x+10.0, s2.y+92.0), sw2-20.0, &g_sl3, "Min damage");

        draw_section(s3, sh, "Exploits");
        if (draw_cb(vec2(s3.x+10.0,s3.y+36.0), g_en4, "Double tap"))   g_en4 = !g_en4;
        if (draw_cb(vec2(s3.x+10.0,s3.y+58.0), g_en5, "Hide shots"))   g_en5 = !g_en5;

        draw_section(s4, sh, "Anti-aim");
        if (draw_cb(vec2(s4.x+10.0,s4.y+36.0), g_en6, "Enable AA"))    g_en6 = !g_en6;
        draw_slider(vec2(s4.x+10.0, s4.y+60.0), sw2-20.0, &g_sl4, "Desync");
    } else {
        draw_section(s1, sh, "Settings A");
        if (draw_cb(vec2(s1.x+10.0,s1.y+36.0), g_en1, "Option 1"))     g_en1 = !g_en1;
        if (draw_cb(vec2(s1.x+10.0,s1.y+58.0), g_en2, "Option 2"))     g_en2 = !g_en2;
        draw_slider(vec2(s1.x+10.0, s1.y+82.0), sw2-20.0, &g_sl1, "Value 1");

        draw_section(s2, sh, "Settings B");
        if (draw_cb(vec2(s2.x+10.0,s2.y+36.0), g_en3, "Option 3"))     g_en3 = !g_en3;
        draw_slider(vec2(s2.x+10.0, s2.y+60.0), sw2-20.0, &g_sl2, "Value 2");

        draw_section(s3, sh, "Settings C");
        if (draw_cb(vec2(s3.x+10.0,s3.y+36.0), g_en4, "Option 4"))     g_en4 = !g_en4;
        if (draw_cb(vec2(s3.x+10.0,s3.y+58.0), g_en5, "Option 5"))     g_en5 = !g_en5;

        draw_section(s4, sh, "Settings D");
        if (draw_cb(vec2(s4.x+10.0,s4.y+36.0), g_en6, "Option 6"))     g_en6 = !g_en6;
        draw_slider(vec2(s4.x+10.0, s4.y+60.0), sw2-20.0, &g_sl4, "Value 3");
    }

    // Outer border
    draw_rect(p, sz, C(28, 32, 50), 1.0, 7.0, 0);
}

int64 main() {
    layer_t layer = get_default_layer();
    float64 cx    = get_view_width()  * 0.5 - 325.0;
    float64 cy    = get_view_height() * 0.5 - 225.0;
    g_frame = create_draggable_frame("sidebar_menu", vec2(cx, cy), vec2(650.0, 450.0), layer);
    create_widget(g_frame, "sb_draw", cast<int64>(on_draw), true);
    return 1;
}
