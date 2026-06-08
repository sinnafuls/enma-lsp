// Modern gradient style menu — inspired by ImGuiMenu-s #8-#22
// Covers the "newer" menu aesthetic: gradient header, rounded everything,
// checkmark widgets, colored accent left-lines on sections, hover highlights.

import "math";

// ─── Globals ────────────────────────────────────────────────────────────────

frame_t g_frame;
bool    g_vis    = true;
int64   g_tab    = 0;

float64 g_ta0 = 1.0; float64 g_ta1 = 0.0; float64 g_ta2 = 0.0;
float64 g_ta3 = 0.0; float64 g_ta4 = 0.0;

// Rage
bool    g_rg_en  = true;  float64 g_rg_fov = 0.35; float64 g_rg_hc  = 0.5;
bool    g_rg_as  = true;  bool    g_rg_st  = false; bool    g_rg_dt  = false;
float64 g_rg_md  = 0.45;  bool    g_rg_ba  = false;

// Legit
bool    g_lg_en  = false; float64 g_lg_fov = 0.18; float64 g_lg_smo = 0.55;
bool    g_lg_rcs = true;  bool    g_lg_bt  = false;

// Visuals
bool    g_vs_en  = true;  bool    g_vs_box = true;  bool g_vs_hp = true;
bool    g_vs_nm  = false; bool    g_vs_dst = false; bool g_vs_gw = false;
bool    g_ch     = false; bool    g_rd     = true;

// Misc
bool    g_bh = false; bool g_as2 = false; bool g_ct = false;
bool    g_tp = false; bool g_ns  = false;
float64 g_fl = 0.2;

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
    float64 sz = 14.0;
    color bg = val ? C(80,100,220) : C(20,22,36);
    draw_rect_filled(pos, vec2(sz,sz), bg, 3.0, 0);
    draw_rect(pos, vec2(sz,sz), C(50,55,80), 1.0, 3.0, 0);
    if (val) {
        draw_line(vec2(pos.x+3.0,pos.y+7.0),  vec2(pos.x+6.0,pos.y+10.0), C(255,255,255), 1.5);
        draw_line(vec2(pos.x+6.0,pos.y+10.0), vec2(pos.x+11.0,pos.y+4.0), C(255,255,255), 1.5);
    }
    bool hov = is_hovered(pos, vec2(sz+get_text_width(get_font18(),lbl,0,0)+10.0, sz));
    if (hov) draw_rect_filled(pos, vec2(sz+get_text_width(get_font18(),lbl,0,0)+10.0,sz), CA(255,255,255,10), 3.0, 0);
    draw_text(lbl, vec2(pos.x+sz+7.0,pos.y-1.0), C(195,200,225), get_font18(), 0, C(0,0,0), 0.0);
    return hov && key_fired(vk.lbutton);
}

void draw_slider(vec2 pos, float64 w, float64* val, string lbl) {
    string pct = format("{.0f}%", *val*100.0);
    bool hov = is_hovered(vec2(pos.x,pos.y+18.0-5.0), vec2(w,15.0));
    draw_text(lbl, pos, C(195,200,225), get_font18(), 0, C(0,0,0), 0.0);
    draw_text(pct, vec2(pos.x+w-get_text_width(get_font18(),pct,0,0),pos.y), CA(140,148,190,200), get_font18(), 0, C(0,0,0), 0.0);
    float64 ty = pos.y+18.0;
    // track with rounded ends
    draw_rect_filled(vec2(pos.x,ty), vec2(w,5.0), C(22,24,40), 2.5, 0);
    draw_rect_filled(vec2(pos.x,ty), vec2(w * *val,5.0), C(80,100,220), 2.5, 0);
    // thumb circle
    float64 tx = pos.x + w * *val;
    draw_circle(vec2(tx,ty+2.5), 7.0, C(80,100,220), 0.0, true);
    draw_circle(vec2(tx,ty+2.5), 7.0, CA(130,150,255,150), 1.5, false);
    if (hov && key_down(vk.lbutton)) {
        float64 v = (get_mouse_pos().x - pos.x) / w;
        if (v < 0.0) v = 0.0;
        if (v > 1.0) v = 1.0;
        *val = v;
    }
}

void draw_sec(vec2 pos, vec2 size, string title) {
    draw_rect_filled(pos, size, C(16,18,28), 8.0, 0);
    draw_rect(pos, size, C(32,36,60), 1.0, 8.0, 0);
    // Accent left border line on title
    draw_rect_filled(vec2(pos.x+8.0, pos.y+10.0), vec2(3.0,12.0), C(80,100,220), 1.5, 0);
    draw_text(title, vec2(pos.x+18.0, pos.y+10.0), C(175,185,230), get_font18(), 0, C(0,0,0), 0.0);
    draw_line(vec2(pos.x+8.0, pos.y+30.0), vec2(pos.x+size.x-8.0, pos.y+30.0), C(28,32,52), 1.0);
}

// ─── Draw callback ──────────────────────────────────────────────────────────

void on_draw(int64 wh) {
    if (key_fired(vk.insert)) {
        g_vis = !g_vis;
        g_frame.set_visible(g_vis);
    }
    if (!g_vis) return;

    vec2   p  = g_frame.get_pos();
    vec2   sz = g_frame.get_size();
    float64 W = sz.x;
    float64 H = sz.y;
    float64 hh = 48.0;  // header
    float64 sw = 72.0;  // sidebar

    // Main background
    draw_rect_filled(p, sz, C(10,12,18), 10.0, 0);

    // Gradient header bar
    draw_four_corner_gradient(p, vec2(W, hh),
        C(25,28,50), C(15,18,40),
        C(25,28,50), C(15,18,40), 0.0);
    // Header bottom accent line
    draw_line(vec2(p.x, p.y+hh), vec2(p.x+W, p.y+hh), C(80,100,220), 2.0);

    // Header title
    draw_text("Cheat Menu", vec2(p.x+sw+10.0, p.y+14.0), C(220,225,255), get_font20(), 0, C(0,0,0), 0.0);
    // Version subtitle right
    string ver = "v1.0";
    draw_text(ver, vec2(p.x+W-get_text_width(get_font18(),ver,0,0)-12.0, p.y+16.0), CA(120,128,170,200), get_font18(), 0, C(0,0,0), 0.0);

    // Sidebar
    draw_rect_filled(vec2(p.x, p.y+hh), vec2(sw, H-hh), C(14,16,26), 0.0, 0);
    draw_line(vec2(p.x+sw, p.y+hh), vec2(p.x+sw, p.y+H), C(28,32,52), 1.0);

    // Tab animations
    g_ta0=lp(g_ta0,g_tab==0?1.0:0.0); g_ta1=lp(g_ta1,g_tab==1?1.0:0.0);
    g_ta2=lp(g_ta2,g_tab==2?1.0:0.0); g_ta3=lp(g_ta3,g_tab==3?1.0:0.0);
    g_ta4=lp(g_ta4,g_tab==4?1.0:0.0);

    array<string>  tics = {"RG","LG","VS","MS","CFG"};
    array<float64> tans = {g_ta0,g_ta1,g_ta2,g_ta3,g_ta4};

    int64 ti = 0;
    while (ti < 5) {
        float64 ty = p.y + hh + 12.0 + cast<float64>(ti) * 48.0;
        float64 a  = tans.get(ti);
        color   tc = lerp_col(CA(110,115,150,180), C(220,228,255), a);

        bool hov = is_hovered(vec2(p.x, ty), vec2(sw, 38.0));
        if (hov) {
            draw_rect_filled(vec2(p.x, ty), vec2(sw, 38.0), CA(80,100,220,20), 0.0, 0);
            if (key_fired(vk.lbutton)) g_tab = ti;
        }
        if (a > 0.02) {
            draw_rect_filled(vec2(p.x, ty), vec2(sw, 38.0), CA(80,100,220, cast<int64>(16.0*a)), 0.0, 0);
            // Active indicator dot
            draw_circle(vec2(p.x+sw-8.0, ty+19.0), 4.0*a, CA(80,100,220,cast<int64>(255.0*a)), 0.0, true);
        }
        string ic = tics.get(ti);
        draw_text(ic, vec2(p.x+(sw-get_text_width(get_font18(),ic,0,0))*0.5, ty+11.0), tc, get_font18(), 0, C(0,0,0), 0.0);
        ti = ti + 1;
    }

    // Content area
    float64 cx   = p.x + sw + 10.0;
    float64 cy   = p.y + hh + 8.0;
    float64 cw   = W - sw - 20.0;
    float64 ch   = H - hh - 16.0;

    // Tab name header in content
    array<string> tnames = {"Ragebot","Legitbot","Visuals","Misc","Config"};
    string tname = tnames.get(g_tab);
    draw_text(tname, vec2(cx, cy), C(215,220,255), get_font20(), 0, C(0,0,0), 0.0);
    draw_line(vec2(cx, cy+22.0), vec2(cx+cw, cy+22.0), C(28,32,52), 1.0);

    float64 sec_y  = cy + 28.0;
    float64 sec_h  = H - sec_y + p.y - 10.0;
    float64 sw2    = cw * 0.5 - 5.0;
    vec2    ls     = vec2(cx, sec_y);
    vec2    rs     = vec2(cx+sw2+10.0, sec_y);
    vec2    shl    = vec2(sw2, sec_h*0.5 - 4.0);
    float64 sb2y   = sec_y + sec_h*0.5 + 4.0;
    vec2    sh     = vec2(sw2, sec_h);

    if (g_tab == 0) {
        draw_sec(ls, shl, "General");
        if (draw_cb(vec2(ls.x+10.0,ls.y+38.0), g_rg_en, "Enable ragebot")) g_rg_en = !g_rg_en;
        if (draw_cb(vec2(ls.x+10.0,ls.y+62.0), g_rg_as, "Auto shoot"))     g_rg_as = !g_rg_as;
        if (draw_cb(vec2(ls.x+10.0,ls.y+86.0), g_rg_st, "Auto stop"))      g_rg_st = !g_rg_st;
        if (draw_cb(vec2(ls.x+10.0,ls.y+110.0),g_rg_ba, "Body aim"))       g_rg_ba = !g_rg_ba;

        draw_sec(vec2(ls.x, sb2y), shl, "Accuracy");
        draw_slider(vec2(ls.x+10.0, sb2y+38.0), sw2-20.0, &g_rg_fov, "FOV");
        draw_slider(vec2(ls.x+10.0, sb2y+72.0), sw2-20.0, &g_rg_hc,  "Hitchance");
        draw_slider(vec2(ls.x+10.0, sb2y+106.0),sw2-20.0, &g_rg_md,  "Min damage");

        draw_sec(rs, sh, "Exploits");
        if (draw_cb(vec2(rs.x+10.0,rs.y+38.0), g_rg_dt, "Double tap"))  g_rg_dt = !g_rg_dt;
        if (draw_cb(vec2(rs.x+10.0,rs.y+62.0), g_lg_bt, "Backtrack"))   g_lg_bt = !g_lg_bt;
        if (draw_cb(vec2(rs.x+10.0,rs.y+86.0), g_ns,    "No spread"))    g_ns    = !g_ns;

    } else if (g_tab == 1) {
        draw_sec(ls, sh, "Aimbot");
        if (draw_cb(vec2(ls.x+10.0,ls.y+38.0), g_lg_en,  "Enable"))    g_lg_en  = !g_lg_en;
        if (draw_cb(vec2(ls.x+10.0,ls.y+62.0), g_lg_rcs, "RCS"))       g_lg_rcs = !g_lg_rcs;
        if (draw_cb(vec2(ls.x+10.0,ls.y+86.0), g_lg_bt,  "Backtrack")) g_lg_bt  = !g_lg_bt;
        draw_slider(vec2(ls.x+10.0,ls.y+114.0), sw2-20.0, &g_lg_fov, "FOV");
        draw_slider(vec2(ls.x+10.0,ls.y+148.0), sw2-20.0, &g_lg_smo, "Smooth");

        draw_sec(rs, sh, "Triggerbot");
        if (draw_cb(vec2(rs.x+10.0,rs.y+38.0), g_vs_en, "Enable trigger")) {}

    } else if (g_tab == 2) {
        draw_sec(ls, sh, "Players");
        if (draw_cb(vec2(ls.x+10.0,ls.y+38.0),  g_vs_en,  "Enable ESP"))  g_vs_en  = !g_vs_en;
        if (draw_cb(vec2(ls.x+10.0,ls.y+62.0),  g_vs_box, "Box ESP"))     g_vs_box = !g_vs_box;
        if (draw_cb(vec2(ls.x+10.0,ls.y+86.0),  g_vs_hp,  "Health bar"))  g_vs_hp  = !g_vs_hp;
        if (draw_cb(vec2(ls.x+10.0,ls.y+110.0), g_vs_nm,  "Name"))        g_vs_nm  = !g_vs_nm;
        if (draw_cb(vec2(ls.x+10.0,ls.y+134.0), g_vs_dst, "Distance"))    g_vs_dst = !g_vs_dst;
        if (draw_cb(vec2(ls.x+10.0,ls.y+158.0), g_vs_gw,  "Glow"))        g_vs_gw  = !g_vs_gw;

        draw_sec(rs, sh, "World");
        if (draw_cb(vec2(rs.x+10.0,rs.y+38.0), g_ch, "Chams"))          g_ch = !g_ch;
        if (draw_cb(vec2(rs.x+10.0,rs.y+62.0), g_rd, "Radar"))          g_rd = !g_rd;

    } else if (g_tab == 3) {
        draw_sec(ls, sh, "Movement");
        if (draw_cb(vec2(ls.x+10.0,ls.y+38.0),  g_bh,  "Bunny hop"))    g_bh  = !g_bh;
        if (draw_cb(vec2(ls.x+10.0,ls.y+62.0),  g_as2, "Auto strafe"))  g_as2 = !g_as2;
        if (draw_cb(vec2(ls.x+10.0,ls.y+86.0),  g_tp,  "Third person")) g_tp  = !g_tp;
        if (draw_cb(vec2(ls.x+10.0,ls.y+110.0), g_ns,  "No spread"))    g_ns  = !g_ns;
        draw_slider(vec2(ls.x+10.0,ls.y+138.0), sw2-20.0, &g_fl, "Fake lag");

        draw_sec(rs, sh, "Other");
        if (draw_cb(vec2(rs.x+10.0,rs.y+38.0), g_ct, "Clantag"))       g_ct = !g_ct;
        if (draw_cb(vec2(rs.x+10.0,rs.y+62.0), g_ch, "Skin changer"))  {}

    } else {
        draw_text("Save / Load Configs", vec2(cx+10.0, sec_y+8.0), CA(140,148,190,200), get_font18(), 0, C(0,0,0), 0.0);
        int64 ci = 0;
        while (ci < 5) {
            float64 by = sec_y + 30.0 + cast<float64>(ci) * 34.0;
            bool hov = is_hovered(vec2(cx, by), vec2(cw*0.6, 26.0));
            draw_rect_filled(vec2(cx,by), vec2(cw*0.6,26.0), hov ? C(80,100,220) : C(18,20,32), 5.0, 0);
            draw_rect(vec2(cx,by), vec2(cw*0.6,26.0), C(32,36,60), 1.0, 5.0, 0);
            draw_text(format("Config {:d}", ci+1), vec2(cx+10.0,by+5.0), C(200,208,240), get_font18(), 0, C(0,0,0), 0.0);
            ci = ci + 1;
        }
    }

    // Outer border
    draw_rect(p, sz, C(32,36,60), 1.0, 10.0, 0);
}

int64 main() {
    layer_t layer = get_default_layer();
    float64 cx    = get_view_width()  * 0.5 - 360.0;
    float64 cy    = get_view_height() * 0.5 - 240.0;
    g_frame = create_draggable_frame("modern_menu", vec2(cx, cy), vec2(720.0, 480.0), layer);
    create_widget(g_frame, "mod_draw", cast<int64>(on_draw), true);
    return 1;
}
