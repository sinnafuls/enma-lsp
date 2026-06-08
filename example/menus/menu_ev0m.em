// ev0m CS2 style menu — converted from ImGuiMenu-s #3
// Original by enqdesign.  Converted to Perception Enma.
//
// Features: header bar, 7 bottom tabs, 4 left subtabs, 2-column sections,
//           steel-blue accent, full CS2 cheat feature set.

import "math";

// ─── Globals ────────────────────────────────────────────────────────────────

frame_t g_frame;
bool    g_visible = true;

int64   g_tab     = 0;
int64   g_subtab  = 0;

float64 g_ta0 = 1.0; float64 g_ta1 = 0.0; float64 g_ta2 = 0.0;
float64 g_ta3 = 0.0; float64 g_ta4 = 0.0; float64 g_ta5 = 0.0;
float64 g_ta6 = 0.0;
float64 g_sa0 = 1.0; float64 g_sa1 = 0.0;
float64 g_sa2 = 0.0; float64 g_sa3 = 0.0;

// Rage
bool    g_rage_en    = true;
float64 g_rage_fov   = 0.35;
float64 g_rage_hc    = 0.50;
bool    g_rage_as    = true;
bool    g_rage_stop  = false;
bool    g_rage_baim  = true;
float64 g_rage_mdmg  = 0.45;
bool    g_rage_dt    = false;

// Legit
bool    g_leg_en     = false;
float64 g_leg_fov    = 0.18;
float64 g_leg_smo    = 0.55;
bool    g_leg_rcs    = true;
bool    g_leg_bt     = false;

// Visuals
bool    g_vis_esp    = true;
bool    g_vis_glow   = false;
bool    g_vis_chams  = false;
bool    g_vis_radar  = true;
bool    g_vis_name   = true;
bool    g_vis_health = true;

// Misc
bool    g_misc_bh    = false;
bool    g_misc_as    = false;
bool    g_misc_nr    = false;
bool    g_misc_tp    = false;

// ─── Color / math helpers ───────────────────────────────────────────────────

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

// ─── Widgets ────────────────────────────────────────────────────────────────

bool draw_cb(vec2 pos, bool val, string lbl) {
    color bg  = val ? C(112, 146, 190) : C(26, 28, 40);
    draw_rect_filled(pos, vec2(12.0, 12.0), bg, 2.0, 0);
    draw_rect(pos, vec2(12.0, 12.0), C(48, 54, 75), 1.0, 2.0, 0);
    if (val) {
        draw_line(vec2(pos.x+2.5, pos.y+6.0), vec2(pos.x+5.0, pos.y+9.0), C(255,255,255), 1.5);
        draw_line(vec2(pos.x+5.0, pos.y+9.0), vec2(pos.x+9.5, pos.y+3.5), C(255,255,255), 1.5);
    }
    draw_text(lbl, vec2(pos.x + 18.0, pos.y - 1.0), C(195, 200, 220), get_font18(), 0, C(0,0,0), 0.0);
    return is_hovered(pos, vec2(18.0 + get_text_width(get_font18(), lbl, 0, 0), 13.0)) && key_fired(vk.lbutton);
}

void draw_slider(vec2 pos, float64 w, float64* val, string lbl) {
    string pct = format("{.0f}%", *val * 100.0);
    draw_text(lbl, pos, C(195, 200, 220), get_font18(), 0, C(0,0,0), 0.0);
    draw_text(pct, vec2(pos.x+w-get_text_width(get_font18(),pct,0,0), pos.y), CA(140,150,180,200), get_font18(), 0, C(0,0,0), 0.0);
    float64 ty = pos.y + 18.0;
    draw_rect_filled(vec2(pos.x, ty), vec2(w, 4.0), C(26, 28, 40), 2.0, 0);
    draw_rect_filled(vec2(pos.x, ty), vec2(w * *val, 4.0), C(112, 146, 190), 2.0, 0);
    draw_circle(vec2(pos.x + w * *val, ty + 2.0), 5.5, C(112, 146, 190), 0.0, true);
    if (is_hovered(vec2(pos.x-5.0, ty-5.0), vec2(w+10.0, 14.0)) && key_down(vk.lbutton)) {
        float64 v = (get_mouse_pos().x - pos.x) / w;
        if (v < 0.0) v = 0.0;
        if (v > 1.0) v = 1.0;
        *val = v;
    }
}

void draw_sec(vec2 pos, vec2 size, string title) {
    draw_rect_filled(pos, size, C(22, 24, 34), 5.0, 0);
    draw_rect(pos, size, C(32, 36, 52), 1.0, 5.0, 0);
    draw_text(title, vec2(pos.x + 10.0, pos.y + 8.0), CA(112, 146, 190, 200), get_font18(), 0, C(0,0,0), 0.0);
    draw_line(vec2(pos.x+8.0, pos.y+26.0), vec2(pos.x+size.x-8.0, pos.y+26.0), C(30,34,50), 1.0);
}

// ─── Draw callback ──────────────────────────────────────────────────────────

void on_draw(int64 wh) {
    if (key_fired(vk.insert)) {
        g_visible = !g_visible;
        g_frame.set_visible(g_visible);
    }
    if (!g_visible) return;

    vec2   p  = g_frame.get_pos();
    vec2   sz = g_frame.get_size();
    float64 W = sz.x;
    float64 H = sz.y;
    float64 tab_h = 42.0;  // bottom tab bar height
    float64 hdr_h = 40.0;  // top header height
    float64 stab_w = 128.0; // left sub-tab column width

    // Background
    draw_rect_filled(p, sz, C(16, 17, 22), 6.0, 0);
    // Header
    draw_rect_filled(p, vec2(W, hdr_h), C(20, 22, 32), 0.0, 0);
    draw_line(vec2(p.x, p.y+hdr_h), vec2(p.x+W, p.y+hdr_h), C(30, 34, 50), 1.0);
    // Game title in header
    draw_text("Counter-Strike 2", vec2(p.x + W*0.5 - get_text_width(get_font18(), "Counter-Strike 2", 0, 0)*0.5, p.y + 12.0), C(200, 205, 230), get_font18(), 0, C(0,0,0), 0.0);
    // Accent dot indicator in header
    draw_circle(vec2(p.x + 16.0, p.y + hdr_h*0.5), 4.0, C(112, 146, 190), 0.0, true);

    // Bottom tab bar
    float64 tab_y = p.y + H - tab_h;
    draw_rect_filled(vec2(p.x, tab_y), vec2(W, tab_h), C(20, 22, 30), 0.0, 0);
    draw_line(vec2(p.x, tab_y), vec2(p.x+W, tab_y), C(28, 32, 48), 1.0);

    // Tab animations
    g_ta0=lp(g_ta0,g_tab==0?1.0:0.0); g_ta1=lp(g_ta1,g_tab==1?1.0:0.0);
    g_ta2=lp(g_ta2,g_tab==2?1.0:0.0); g_ta3=lp(g_ta3,g_tab==3?1.0:0.0);
    g_ta4=lp(g_ta4,g_tab==4?1.0:0.0); g_ta5=lp(g_ta5,g_tab==5?1.0:0.0);
    g_ta6=lp(g_ta6,g_tab==6?1.0:0.0);

    array<string>  tnames = {"RAGE","LEGIT","VISUALS","SKINS","MISC","CONFIGS","LUA"};
    array<float64> tanims = {g_ta0,g_ta1,g_ta2,g_ta3,g_ta4,g_ta5,g_ta6};
    float64 tw = W / 7.0;
    int64 ti = 0;
    while (ti < 7) {
        float64 tx = p.x + cast<float64>(ti) * tw;
        float64 a  = tanims.get(ti);
        color   tc = lerp_col(CA(120,128,165,180), C(112,146,190), a);
        string  tn = tnames.get(ti);
        float64 tnw = get_text_width(get_font18(), tn, 0, 0);
        draw_text(tn, vec2(tx + (tw-tnw)*0.5, tab_y + 12.0), tc, get_font18(), 0, C(0,0,0), 0.0);
        if (a > 0.02)
            draw_rect_filled(vec2(tx + (tw-tnw)*0.5 - 2.0, tab_y + tab_h - 3.0), vec2(tnw+4.0, 2.0), CA(112,146,190,cast<int64>(255.0*a)), 1.0, 0);
        if (is_hovered(vec2(tx, tab_y), vec2(tw, tab_h)) && key_fired(vk.lbutton)) {
            g_tab    = ti;
            g_subtab = 0;
        }
        ti = ti + 1;
    }

    // Sub-tab column (left side of content)
    float64 cnt_y = p.y + hdr_h + 1.0;
    float64 cnt_h = tab_y - cnt_y - 1.0;
    draw_rect_filled(vec2(p.x, cnt_y), vec2(stab_w, cnt_h), C(18, 20, 30), 0.0, 0);
    draw_line(vec2(p.x+stab_w, cnt_y), vec2(p.x+stab_w, tab_y), C(28,32,48), 1.0);

    // Sub-tab animations
    g_sa0=lp(g_sa0,g_subtab==0?1.0:0.0); g_sa1=lp(g_sa1,g_subtab==1?1.0:0.0);
    g_sa2=lp(g_sa2,g_subtab==2?1.0:0.0); g_sa3=lp(g_sa3,g_subtab==3?1.0:0.0);

    array<string>  stnames = {"General","Weapons","Anti-Aim","Misc"};
    array<float64> stanims = {g_sa0,g_sa1,g_sa2,g_sa3};
    int64 si = 0;
    while (si < 4) {
        float64 sy = cnt_y + cast<float64>(si) * 36.0;
        float64 sa = stanims.get(si);
        color   sc = lerp_col(CA(130,140,175,180), C(112,146,190), sa);
        string  sn = stnames.get(si);
        if (sa > 0.02)
            draw_rect_filled(vec2(p.x, sy), vec2(3.0, 36.0), CA(112,146,190,cast<int64>(255.0*sa)), 0.0, 0);
        if (is_hovered(vec2(p.x, sy), vec2(stab_w, 36.0)))
            draw_rect_filled(vec2(p.x, sy), vec2(stab_w, 36.0), CA(112,146,190,16), 0.0, 0);
        draw_text(sn, vec2(p.x + 14.0, sy + 10.0), sc, get_font18(), 0, C(0,0,0), 0.0);
        draw_line(vec2(p.x+6.0, sy+35.0), vec2(p.x+stab_w-6.0, sy+35.0), C(26,30,44), 1.0);
        if (is_hovered(vec2(p.x, sy), vec2(stab_w, 36.0)) && key_fired(vk.lbutton)) g_subtab = si;
        si = si + 1;
    }

    // Content area
    float64 cx  = p.x + stab_w + 10.0;
    float64 cw  = W - stab_w - 20.0;
    float64 sch = cnt_h - 10.0;
    float64 sw2 = cw * 0.5 - 5.0;
    vec2    lss = vec2(cx, cnt_y + 6.0);
    vec2    rss = vec2(cx + sw2 + 10.0, cnt_y + 6.0);
    float64 sh  = sch - 6.0;

    if (g_tab == 0) {
        draw_sec(lss, vec2(sw2, sh * 0.5 - 4.0), "Settings");
        if (draw_cb(vec2(lss.x+10.0,lss.y+34.0), g_rage_en,   "Enable ragebot")) g_rage_en   = !g_rage_en;
        if (draw_cb(vec2(lss.x+10.0,lss.y+56.0), g_rage_as,   "Auto shoot"))     g_rage_as   = !g_rage_as;
        if (draw_cb(vec2(lss.x+10.0,lss.y+78.0), g_rage_stop, "Auto stop"))      g_rage_stop = !g_rage_stop;
        if (draw_cb(vec2(lss.x+10.0,lss.y+100.0),g_rage_baim, "Body aim"))       g_rage_baim = !g_rage_baim;

        float64 sb2 = lss.y + sh * 0.5 + 4.0;
        draw_sec(vec2(lss.x, sb2), vec2(sw2, sh * 0.5 - 4.0), "Accuracy");
        draw_slider(vec2(lss.x+10.0, sb2+34.0), sw2-20.0, &g_rage_fov,  "FOV");
        draw_slider(vec2(lss.x+10.0, sb2+66.0), sw2-20.0, &g_rage_hc,   "Hitchance");
        draw_slider(vec2(lss.x+10.0, sb2+98.0), sw2-20.0, &g_rage_mdmg, "Min damage");

        draw_sec(rss, vec2(sw2, sh), "Exploits");
        if (draw_cb(vec2(rss.x+10.0,rss.y+34.0), g_rage_dt,   "Double tap"))   g_rage_dt   = !g_rage_dt;
        if (draw_cb(vec2(rss.x+10.0,rss.y+56.0), g_leg_bt,    "Backtrack"))    g_leg_bt    = !g_leg_bt;
        if (draw_cb(vec2(rss.x+10.0,rss.y+78.0), g_misc_nr,   "No recoil"))    g_misc_nr   = !g_misc_nr;

    } else if (g_tab == 1) {
        draw_sec(lss, vec2(sw2, sh), "Legitbot");
        if (draw_cb(vec2(lss.x+10.0,lss.y+34.0), g_leg_en,  "Enable"))     g_leg_en  = !g_leg_en;
        if (draw_cb(vec2(lss.x+10.0,lss.y+56.0), g_leg_rcs, "RCS"))        g_leg_rcs = !g_leg_rcs;
        if (draw_cb(vec2(lss.x+10.0,lss.y+78.0), g_leg_bt,  "Backtrack"))  g_leg_bt  = !g_leg_bt;
        draw_slider(vec2(lss.x+10.0, lss.y+104.0), sw2-20.0, &g_leg_fov, "FOV");
        draw_slider(vec2(lss.x+10.0, lss.y+136.0), sw2-20.0, &g_leg_smo, "Smooth");

        draw_sec(rss, vec2(sw2, sh), "Triggerbot");
        if (draw_cb(vec2(rss.x+10.0,rss.y+34.0), g_vis_esp,  "Enable trigger")) {}
        if (draw_cb(vec2(rss.x+10.0,rss.y+56.0), g_vis_glow, "Head only"))      {}

    } else if (g_tab == 2) {
        draw_sec(lss, vec2(sw2, sh), "Players");
        if (draw_cb(vec2(lss.x+10.0,lss.y+34.0), g_vis_esp,    "Enable ESP"))    g_vis_esp    = !g_vis_esp;
        if (draw_cb(vec2(lss.x+10.0,lss.y+56.0), g_vis_glow,   "Glow"))          g_vis_glow   = !g_vis_glow;
        if (draw_cb(vec2(lss.x+10.0,lss.y+78.0), g_vis_chams,  "Chams"))         g_vis_chams  = !g_vis_chams;
        if (draw_cb(vec2(lss.x+10.0,lss.y+100.0),g_vis_health, "Health bar"))    g_vis_health = !g_vis_health;
        if (draw_cb(vec2(lss.x+10.0,lss.y+122.0),g_vis_name,   "Name"))          g_vis_name   = !g_vis_name;

        draw_sec(rss, vec2(sw2, sh), "World");
        if (draw_cb(vec2(rss.x+10.0,rss.y+34.0), g_vis_radar, "Radar"))          g_vis_radar  = !g_vis_radar;
        if (draw_cb(vec2(rss.x+10.0,rss.y+56.0), g_leg_bt,    "Dropped weapons")) {}

    } else if (g_tab == 4) {
        draw_sec(lss, vec2(sw2, sh), "Movement");
        if (draw_cb(vec2(lss.x+10.0,lss.y+34.0), g_misc_bh, "Bunny hop"))    g_misc_bh = !g_misc_bh;
        if (draw_cb(vec2(lss.x+10.0,lss.y+56.0), g_misc_as, "Auto strafe"))  g_misc_as = !g_misc_as;
        if (draw_cb(vec2(lss.x+10.0,lss.y+78.0), g_misc_tp, "Third person")) g_misc_tp = !g_misc_tp;

        draw_sec(rss, vec2(sw2, sh), "Other");
        if (draw_cb(vec2(rss.x+10.0,rss.y+34.0), g_misc_nr, "No recoil"))     g_misc_nr = !g_misc_nr;

    } else {
        draw_text("Nothing here yet.", vec2(cx + 10.0, cnt_y + 20.0), CA(120,128,165,200), get_font18(), 0, C(0,0,0), 0.0);
    }

    // Outer border
    draw_rect(p, sz, C(28, 32, 48), 1.0, 6.0, 0);
}

int64 main() {
    layer_t layer = get_default_layer();
    float64 cx    = get_view_width()  * 0.5 - 345.0;
    float64 cy    = get_view_height() * 0.5 - 235.0;
    g_frame = create_draggable_frame("ev0m_menu", vec2(cx, cy), vec2(690.0, 470.0), layer);
    create_widget(g_frame, "ev0m_draw", cast<int64>(on_draw), true);
    return 1;
}
