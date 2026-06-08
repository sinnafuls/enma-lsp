// Nixware dark icon-tab style menu — converted from ImGuiMenu-s #5
// Original: Byman. Converted to Perception Enma.
//
// Features: near-black theme, left icon strip (67px), 7 icon tabs with
//           accent circle indicator, thin header bar, "NW" logo at bottom,
//           full section layout with crisp minimal widgets.

import "math";

// ─── Globals ────────────────────────────────────────────────────────────────

frame_t g_frame;
bool    g_visible = true;
int64   g_tab     = 0;

float64 g_ta0 = 1.0; float64 g_ta1 = 0.0; float64 g_ta2 = 0.0;
float64 g_ta3 = 0.0; float64 g_ta4 = 0.0; float64 g_ta5 = 0.0;
float64 g_ta6 = 0.0;

// Tab 0 - Legitbot
bool    g_lb_en    = true;
float64 g_lb_fov   = 0.22;
float64 g_lb_smo   = 0.50;
bool    g_lb_rcs   = true;
bool    g_lb_bt    = false;

// Tab 1 - Ragebot
bool    g_rb_en    = false;
float64 g_rb_fov   = 0.40;
float64 g_rb_hc    = 0.50;
bool    g_rb_as    = true;
bool    g_rb_stop  = false;

// Tab 2 - Visuals
bool    g_vis_en   = true;
bool    g_vis_box  = true;
bool    g_vis_hp   = true;
bool    g_vis_arm  = false;
bool    g_vis_nam  = true;
bool    g_vis_dst  = false;

// Tab 3 - Misc
bool    g_mc_bh    = false;
bool    g_mc_as    = false;
bool    g_mc_tp    = false;
bool    g_mc_ct    = false;

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

float64 lp(float64 v, float64 t) { return v + (t - v) * (8.0 / get_fps()); }

bool draw_cb(vec2 pos, bool val, string lbl) {
    color bg = val ? C(80,160,255) : C(28,28,28);
    draw_rect_filled(pos, vec2(12.0,12.0), bg, 2.0, 0);
    draw_rect(pos, vec2(12.0,12.0), C(60,60,60), 1.0, 2.0, 0);
    if (val) {
        draw_line(vec2(pos.x+2.5,pos.y+6.0), vec2(pos.x+5.0,pos.y+9.0), C(255,255,255), 1.5);
        draw_line(vec2(pos.x+5.0,pos.y+9.0), vec2(pos.x+9.5,pos.y+3.5), C(255,255,255), 1.5);
    }
    draw_text(lbl, vec2(pos.x+18.0,pos.y-1.0), C(200,200,200), get_font18(), 0, C(0,0,0), 0.0);
    return is_hovered(pos, vec2(18.0+get_text_width(get_font18(),lbl,0,0),13.0)) && key_fired(vk.lbutton);
}

void draw_slider(vec2 pos, float64 w, float64* val, string lbl) {
    string pct = format("{.0f}%", *val*100.0);
    draw_text(lbl, pos, C(200,200,200), get_font18(), 0, C(0,0,0), 0.0);
    draw_text(pct, vec2(pos.x+w-get_text_width(get_font18(),pct,0,0),pos.y), CA(130,138,160,200), get_font18(), 0, C(0,0,0), 0.0);
    float64 ty = pos.y+17.0;
    draw_rect_filled(vec2(pos.x,ty), vec2(w,3.0), C(28,28,28), 1.5, 0);
    draw_rect_filled(vec2(pos.x,ty), vec2(w * *val,3.0), C(80,160,255), 1.5, 0);
    draw_circle(vec2(pos.x+w * *val,ty+1.5), 5.0, C(80,160,255), 0.0, true);
    if (is_hovered(vec2(pos.x-5.0,ty-5.0), vec2(w+10.0,13.0)) && key_down(vk.lbutton)) {
        float64 v = (get_mouse_pos().x - pos.x) / w;
        if (v < 0.0) v = 0.0;
        if (v > 1.0) v = 1.0;
        *val = v;
    }
}

void draw_sec(vec2 pos, vec2 size, string title) {
    draw_rect_filled(pos, size, C(22,22,22), 4.0, 0);
    draw_rect(pos, size, C(35,35,35), 1.0, 4.0, 0);
    draw_text(title, vec2(pos.x+10.0,pos.y+8.0), CA(80,160,255,220), get_font18(), 0, C(0,0,0), 0.0);
    draw_line(vec2(pos.x+8.0,pos.y+26.0), vec2(pos.x+size.x-8.0,pos.y+26.0), C(32,32,32), 1.0);
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
    float64 sw = 67.0;
    float64 hh = 21.0;  // header height in content area

    // Background
    draw_rect_filled(p, sz, C(15,15,15), 6.0, 0);
    // Left icon strip
    draw_rect_filled(p, vec2(sw, H), C(20,20,20), 0.0, 0);
    draw_line(vec2(p.x+sw,p.y), vec2(p.x+sw,p.y+H), C(32,32,32), 1.0);

    // Tab animations
    g_ta0=lp(g_ta0,g_tab==0?1.0:0.0); g_ta1=lp(g_ta1,g_tab==1?1.0:0.0);
    g_ta2=lp(g_ta2,g_tab==2?1.0:0.0); g_ta3=lp(g_ta3,g_tab==3?1.0:0.0);
    g_ta4=lp(g_ta4,g_tab==4?1.0:0.0); g_ta5=lp(g_ta5,g_tab==5?1.0:0.0);
    g_ta6=lp(g_ta6,g_tab==6?1.0:0.0);

    array<string>  ticons = {"LB","RB","VS","MC","SK","CF","LU"};
    array<float64> tanims = {g_ta0,g_ta1,g_ta2,g_ta3,g_ta4,g_ta5,g_ta6};

    int64 ti = 0;
    while (ti < 7) {
        float64 ty = p.y + 40.0 + cast<float64>(ti) * 48.0;
        float64 a  = tanims.get(ti);
        color   tc = lerp_col(CA(90,90,100,180), C(220,228,255), a);
        string  ic = ticons.get(ti);
        float64 iw = get_text_width(get_font18(), ic, 0, 0);

        bool hov = is_hovered(vec2(p.x, ty), vec2(sw, 36.0));
        if (hov) {
            draw_rect_filled(vec2(p.x, ty), vec2(sw, 36.0), CA(80,160,255,14), 0.0, 0);
            if (key_fired(vk.lbutton)) g_tab = ti;
        }
        // active circle indicator on right edge
        if (a > 0.02)
            draw_circle(vec2(p.x+sw-4.0, ty+18.0), 3.0*a, CA(80,160,255,cast<int64>(255.0*a)), 0.0, true);

        draw_text(ic, vec2(p.x+(sw-iw)*0.5, ty+10.0), tc, get_font18(), 0, C(0,0,0), 0.0);
        ti = ti + 1;
    }

    // Logo "NW" at bottom of icon strip
    draw_text("NW", vec2(p.x+(sw-get_text_width(get_font18(),"NW",0,0))*0.5, p.y+H-26.0), CA(80,160,255,200), get_font18(), 0, C(0,0,0), 0.0);

    // Content area
    float64 cx = p.x + sw + 1.0;
    float64 cw = W - sw - 10.0;

    // Thin header bar at top of content
    draw_rect_filled(vec2(cx, p.y), vec2(W-sw, hh), C(22,22,22), 0.0, 0);
    draw_line(vec2(cx, p.y+hh), vec2(p.x+W, p.y+hh), C(28,28,28), 1.0);

    // Tab name in header
    array<string> tnames = {"Legitbot","Ragebot","Visuals","Misc","Skins","Config","Lua"};
    draw_text(tnames.get(g_tab), vec2(cx+10.0, p.y+4.0), CA(80,160,255,220), get_font18(), 0, C(0,0,0), 0.0);

    float64 cnt_y  = p.y + hh + 6.0;
    float64 cnt_h  = H - hh - 12.0;
    float64 sw2    = cw * 0.5 - 5.0;
    vec2    ls     = vec2(cx, cnt_y);
    vec2    rs     = vec2(cx+sw2+10.0, cnt_y);
    vec2    sh     = vec2(sw2, cnt_h);
    vec2    shl    = vec2(sw2, cnt_h*0.5 - 4.0);
    float64 sb2y   = cnt_y + cnt_h*0.5 + 4.0;

    if (g_tab == 0) {
        draw_sec(ls, shl, "Aimbot");
        if (draw_cb(vec2(ls.x+10.0,ls.y+34.0), g_lb_en,  "Enable"))     g_lb_en  = !g_lb_en;
        if (draw_cb(vec2(ls.x+10.0,ls.y+56.0), g_lb_rcs, "RCS"))        g_lb_rcs = !g_lb_rcs;
        if (draw_cb(vec2(ls.x+10.0,ls.y+78.0), g_lb_bt,  "Backtrack"))  g_lb_bt  = !g_lb_bt;
        draw_slider(vec2(ls.x+10.0, ls.y+104.0), sw2-20.0, &g_lb_fov, "FOV");

        draw_sec(vec2(ls.x, sb2y), shl, "Triggerbot");
        draw_slider(vec2(ls.x+10.0, sb2y+34.0), sw2-20.0, &g_lb_smo, "Smooth");
        if (draw_cb(vec2(ls.x+10.0, sb2y+66.0), g_lb_bt, "Enable trigger")) {}

        draw_sec(rs, sh, "Misc");
        if (draw_cb(vec2(rs.x+10.0,rs.y+34.0), g_mc_bh, "Bunny hop"))    g_mc_bh = !g_mc_bh;
        if (draw_cb(vec2(rs.x+10.0,rs.y+56.0), g_mc_as, "Auto strafe"))  g_mc_as = !g_mc_as;
        if (draw_cb(vec2(rs.x+10.0,rs.y+78.0), g_mc_tp, "Third person")) g_mc_tp = !g_mc_tp;

    } else if (g_tab == 1) {
        draw_sec(ls, shl, "Ragebot");
        if (draw_cb(vec2(ls.x+10.0,ls.y+34.0), g_rb_en,   "Enable"))     g_rb_en   = !g_rb_en;
        if (draw_cb(vec2(ls.x+10.0,ls.y+56.0), g_rb_as,   "Auto shoot")) g_rb_as   = !g_rb_as;
        if (draw_cb(vec2(ls.x+10.0,ls.y+78.0), g_rb_stop, "Auto stop"))  g_rb_stop = !g_rb_stop;

        draw_sec(vec2(ls.x, sb2y), shl, "Accuracy");
        draw_slider(vec2(ls.x+10.0, sb2y+34.0), sw2-20.0, &g_rb_fov, "FOV");
        draw_slider(vec2(ls.x+10.0, sb2y+66.0), sw2-20.0, &g_rb_hc,  "Hitchance");

        draw_sec(rs, sh, "Exploits");
        if (draw_cb(vec2(rs.x+10.0,rs.y+34.0), g_mc_ct, "Double tap")) {}
        if (draw_cb(vec2(rs.x+10.0,rs.y+56.0), g_lb_bt, "Hide shots")) {}

    } else if (g_tab == 2) {
        draw_sec(ls, sh, "Players");
        if (draw_cb(vec2(ls.x+10.0,ls.y+34.0), g_vis_en,  "Enable ESP"))  g_vis_en  = !g_vis_en;
        if (draw_cb(vec2(ls.x+10.0,ls.y+56.0), g_vis_box, "Box"))         g_vis_box = !g_vis_box;
        if (draw_cb(vec2(ls.x+10.0,ls.y+78.0), g_vis_hp,  "Health bar"))  g_vis_hp  = !g_vis_hp;
        if (draw_cb(vec2(ls.x+10.0,ls.y+100.0),g_vis_arm, "Armor bar"))   g_vis_arm = !g_vis_arm;
        if (draw_cb(vec2(ls.x+10.0,ls.y+122.0),g_vis_nam, "Name"))        g_vis_nam = !g_vis_nam;
        if (draw_cb(vec2(ls.x+10.0,ls.y+144.0),g_vis_dst, "Distance"))    g_vis_dst = !g_vis_dst;

        draw_sec(rs, sh, "World");
        if (draw_cb(vec2(rs.x+10.0,rs.y+34.0), g_lb_bt, "Dropped weapons")) {}
        if (draw_cb(vec2(rs.x+10.0,rs.y+56.0), g_mc_tp, "Bomb timer"))      {}

    } else if (g_tab == 3) {
        draw_sec(ls, sh, "Movement");
        if (draw_cb(vec2(ls.x+10.0,ls.y+34.0), g_mc_bh, "Bunny hop"))    g_mc_bh = !g_mc_bh;
        if (draw_cb(vec2(ls.x+10.0,ls.y+56.0), g_mc_as, "Auto strafe"))  g_mc_as = !g_mc_as;
        if (draw_cb(vec2(ls.x+10.0,ls.y+78.0), g_mc_tp, "Third person")) g_mc_tp = !g_mc_tp;
        if (draw_cb(vec2(ls.x+10.0,ls.y+100.0),g_mc_ct, "Clantag"))      g_mc_ct = !g_mc_ct;

        draw_sec(rs, sh, "Other");
        if (draw_cb(vec2(rs.x+10.0,rs.y+34.0), g_lb_rcs, "No recoil"))   {}
        if (draw_cb(vec2(rs.x+10.0,rs.y+56.0), g_vis_en, "Skin changer")) {}

    } else {
        draw_text("Nothing configured for this tab.", vec2(cx+10.0, cnt_y+12.0), CA(90,96,120,200), get_font18(), 0, C(0,0,0), 0.0);
    }

    // Outer border
    draw_rect(p, sz, C(32,32,32), 1.0, 6.0, 0);
}

int64 main() {
    layer_t layer = get_default_layer();
    float64 cx    = get_view_width()  * 0.5 - 410.0;
    float64 cy    = get_view_height() * 0.5 - 260.0;
    g_frame = create_draggable_frame("nixware_menu", vec2(cx, cy), vec2(820.0, 520.0), layer);
    create_widget(g_frame, "nw_draw", cast<int64>(on_draw), true);
    return 1;
}
