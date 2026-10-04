// Pebble Maps - turn-by-turn navigation
#include "windows.h"
#include "comm.h"
#include "mapdata.h"

#define MAX_PTS 64

static Window *s_window;
static Layer *s_canvas;
static Layer *s_maparea;
static Layer *s_dots;
static int s_mode;
static bool s_have;
static bool s_arrived;
static bool s_muted;
static int s_flags;
static int s_man = MAN_DEPART;
static int s_next_man = MAN_NONE;
static char s_instr[128] = "Starting navigation";
static char s_dist[24];
static char s_remain[48];
static char s_detail[64];
static time_t s_arrive;
static GPoint s_pts[MAX_PTS];
static int s_npts;
static bool s_dest_visible;
static AppTimer *s_back_timer;
static bool s_back_armed;
static ActionMenu *s_am;
static ActionMenuLevel *s_am_root;

#define F_DEST_VISIBLE (1 << 6)

static int banner_h(GRect b) { return PBL_IF_ROUND_ELSE(82, b.size.h >= 200 ? 78 : 64); }
static int bottom_h(GRect b) { return PBL_IF_ROUND_ELSE(42, b.size.h >= 200 ? 38 : 32); }
static int then_h(void) { return s_next_man != MAN_NONE && !s_arrived ? 18 : 0; }

static GRect map_rect(GRect b) {
  int top = banner_h(b) + then_h();
  return GRect(0, top, b.size.w, b.size.h - top - bottom_h(b));
}

static void handle(int cmd, DictionaryIterator *it, void *ctx) {
  switch (cmd) {
    case CMD_NAV: {
      s_have = true;
      dots_layer_set_running(s_dots, false);
      strncpy(s_instr, tuple_str(it, MESSAGE_KEY_text), sizeof(s_instr) - 1);
      strncpy(s_dist, tuple_str(it, MESSAGE_KEY_text2), sizeof(s_dist) - 1);
      strncpy(s_remain, tuple_str(it, MESSAGE_KEY_text3), sizeof(s_remain) - 1);
      strncpy(s_detail, tuple_str(it, MESSAGE_KEY_text4), sizeof(s_detail) - 1);
      s_man = tuple_int(it, MESSAGE_KEY_num, MAN_STRAIGHT);
      s_next_man = tuple_int(it, MESSAGE_KEY_idx, MAN_NONE);
      s_arrive = (time_t)tuple_int(it, MESSAGE_KEY_num2, 0);
      s_flags = tuple_int(it, MESSAGE_KEY_flags, 0);
      s_dest_visible = s_flags & F_DEST_VISIBLE;
      const Tuple *dt = dict_find(it, MESSAGE_KEY_data);
      if (dt) {
        int n = dt->length / 4;
        if (n > MAX_PTS) n = MAX_PTS;
        const uint8_t *d = dt->value->data;
        for (int i = 0; i < n; i++) {
          s_pts[i].x = (int16_t)(d[i * 4] | (d[i * 4 + 1] << 8));
          s_pts[i].y = (int16_t)(d[i * 4 + 2] | (d[i * 4 + 3] << 8));
        }
        s_npts = n;
      }
      bool was_arrived = s_arrived;
      s_arrived = (s_flags & NAV_ARRIVED) != 0;
      if (!s_muted) {
        if (s_arrived && !was_arrived) { vibe_now(); light_enable_interaction(); }
        else if (s_flags & NAV_ALERT_NOW) { vibe_now(); light_enable_interaction(); }
        else if (s_flags & NAV_ALERT_SOON) { vibe_soon(); light_enable_interaction(); }
      }
      layer_set_frame(s_maparea, map_rect(layer_get_bounds(s_canvas)));
      layer_mark_dirty(s_canvas);
      break;
    }
    case CMD_TOAST:
      ui_toast(s_window, tuple_str(it, MESSAGE_KEY_text));
      break;
    case CMD_ERROR:
      dots_layer_set_running(s_dots, false);
      strncpy(s_instr, tuple_str(it, MESSAGE_KEY_text), sizeof(s_instr) - 1);
      s_flags = NAV_NO_GPS;
      layer_mark_dirty(s_canvas);
      break;
  }
}

static void maparea_update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorWhite, GColorWhite));
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  // faint grid for a sense of motion-free "map"
  graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorLightGray, GColorWhite));
#ifdef PBL_COLOR
  for (int x = 10; x < b.size.w; x += 30) for (int y = 0; y < b.size.h; y += 2) graphics_draw_pixel(ctx, GPoint(x, y));
#endif
  GPoint puck = GPoint(b.size.w / 2, b.size.h * 68 / 100);
  if (s_npts >= 2) {
#ifdef PBL_COLOR
    graphics_context_set_antialiased(ctx, true);
#endif
    for (int pass = 0; pass < 2; pass++) {
      GColor c = pass == 0 ? PBL_IF_COLOR_ELSE(GColorDukeBlue, GColorBlack)
                           : PBL_IF_COLOR_ELSE(GColorBlueMoon, GColorWhite);
      int w = pass == 0 ? 11 : PBL_IF_COLOR_ELSE(7, 5);
      graphics_context_set_stroke_color(ctx, c);
      graphics_context_set_fill_color(ctx, c);
      graphics_context_set_stroke_width(ctx, w);
      for (int i = 0; i < s_npts - 1; i++) {
        GPoint a = GPoint(puck.x + s_pts[i].x, puck.y + s_pts[i].y);
        GPoint z = GPoint(puck.x + s_pts[i + 1].x, puck.y + s_pts[i + 1].y);
        graphics_draw_line(ctx, a, z);
        graphics_fill_circle(ctx, z, w / 2);
      }
    }
    graphics_context_set_stroke_width(ctx, 1);
    if (s_dest_visible) {
      GPoint e = GPoint(puck.x + s_pts[s_npts - 1].x, puck.y + s_pts[s_npts - 1].y);
      draw_pin(ctx, e, 6, true);
    }
  }
  draw_puck(ctx, puck, 7);
}

static void draw_banner(GContext *ctx, GRect b) {
  int bh = banner_h(b);
  GColor bg = (s_flags & (NAV_NO_GPS | NAV_REROUTING)) ? PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack) : C_NAVGREEN;
  if (s_flags & NAV_TRANSIT) bg = PBL_IF_COLOR_ELSE(GColorCobaltBlue, GColorBlack);
  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_rect(ctx, GRect(0, 0, b.size.w, bh), 0, GCornerNone);
  graphics_context_set_text_color(ctx, GColorWhite);
  GColor ghost = PBL_IF_COLOR_ELSE(GColorMintGreen, GColorLightGray);
#ifdef PBL_ROUND
  maneuver_draw(ctx, s_man, GPoint(b.size.w / 2 - 22, 24), 28, GColorWhite, ghost);
  graphics_draw_text(ctx, s_dist, g_fonts.title, GRect(b.size.w / 2 - 4, 8, 70, 30),
                     GTextOverflowModeFill, GTextAlignmentLeft, NULL);
  graphics_draw_text(ctx, s_instr, g_fonts.small_b, GRect(22, 38, b.size.w - 44, bh - 40),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
#else
  int col = b.size.w >= 200 ? 56 : 46;
  int isz = b.size.w >= 200 ? 38 : 30;
  maneuver_draw(ctx, s_man, GPoint(col / 2, 4 + isz / 2), isz, GColorWhite, ghost);
  graphics_draw_text(ctx, s_dist, g_fonts.small_b, GRect(0, isz + 2, col, 18),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
  GFont f = b.size.w >= 200 ? g_fonts.title : g_fonts.body_b;
  int lh = b.size.w >= 200 ? 24 : 18;
  GRect tr = GRect(col, -2, b.size.w - col - 3, bh);
  GSize ts = graphics_text_layout_get_content_size(s_instr, f, tr, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft);
  if (ts.h > bh - 2) f = g_fonts.small_b, lh = 14;
  (void)lh;
  graphics_draw_text(ctx, s_instr, f, tr, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
#endif
  // "Then" chip
  int th = then_h();
  if (th) {
    graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(C_NAVGREEN_DK, GColorBlack));
    GRect tr = GRect(PBL_IF_ROUND_ELSE(b.size.w / 2 - 34, 0), bh, 68, th);
    graphics_fill_rect(ctx, tr, 4, GCornersBottom);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "Then", g_fonts.small_b, GRect(tr.origin.x + 6, bh - 1, 34, 16),
                       GTextOverflowModeFill, GTextAlignmentLeft, NULL);
    maneuver_draw(ctx, s_next_man, GPoint(tr.origin.x + 52, bh + th / 2), 15, GColorWhite, GColorWhite);
  }
}

static void draw_bottom(GContext *ctx, GRect b) {
  int h = bottom_h(b);
  GRect r = GRect(0, b.size.h - h, b.size.w, h);
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_rect(ctx, r, 0, GCornerNone);
  graphics_context_set_stroke_color(ctx, C_DIVIDER);
  graphics_draw_line(ctx, r.origin, GPoint(b.size.w, r.origin.y));
  char clk[16] = "";
  if (s_arrive) format_clock(s_arrive, clk, sizeof(clk));
#ifdef PBL_ROUND
  char line[64];
  snprintf(line, sizeof(line), "%s · %s", s_remain, clk);
  graphics_context_set_text_color(ctx, C_GREEN);
  graphics_draw_text(ctx, line, g_fonts.small_b, GRect(30, r.origin.y + 2, b.size.w - 60, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
#else
  // remaining time big (green), distance + arrival small
  char t[32];
  strncpy(t, s_remain, sizeof(t) - 1);
  t[sizeof(t) - 1] = 0;
  char *sep = strstr(t, " · ");
  const char *dist = "";
  if (sep) { *sep = 0; dist = s_remain + (sep - t) + strlen(" · "); }
  graphics_context_set_text_color(ctx, C_GREEN);
  GFont tf = h >= 36 ? g_fonts.title : g_fonts.body_b;
  GSize ts = graphics_text_layout_get_content_size(t, tf, GRect(0, 0, b.size.w, h), GTextOverflowModeFill, GTextAlignmentLeft);
  graphics_draw_text(ctx, t, tf, GRect(5, r.origin.y + (h - ts.h) / 2 - 4, ts.w + 2, h),
                     GTextOverflowModeFill, GTextAlignmentLeft, NULL);
  char right[48];
  snprintf(right, sizeof(right), "%s%s%s", dist, (dist[0] && clk[0]) ? " · " : "", clk);
  graphics_context_set_text_color(ctx, C_SUBTEXT);
  graphics_draw_text(ctx, right, g_fonts.small_b, GRect(ts.w + 9, r.origin.y + (h - 16) / 2 - 2, b.size.w - ts.w - 12, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, NULL);
#endif
  if (s_muted) icon_draw(ctx, ICON_MUTE, GPoint(b.size.w - PBL_IF_ROUND_ELSE(40, 10), r.origin.y - 10), 12, C_SUBTEXT, C_BG);
}

static void draw_arrived(GContext *ctx, GRect b) {
  graphics_context_set_fill_color(ctx, C_NAVGREEN);
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  icon_draw(ctx, ICON_FLAG, GPoint(b.size.w / 2, b.size.h / 2 - 34), 40, GColorWhite, C_NAVGREEN);
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, "You've arrived", g_fonts.title, GRect(4, b.size.h / 2 - 8, b.size.w - 8, 30),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
  graphics_draw_text(ctx, s_instr, g_fonts.body, GRect(PBL_IF_ROUND_ELSE(20, 6), b.size.h / 2 + 20,
                     b.size.w - PBL_IF_ROUND_ELSE(40, 12), 44),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

static void canvas_update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  layer_set_hidden(s_maparea, s_arrived);
  if (s_arrived) {
    draw_arrived(ctx, b);
    return;
  }
  draw_banner(ctx, b);
  draw_bottom(ctx, b);
}

// --- Controls --------------------------------------------------------------
static void end_nav(void) {
  comm_cmd(CMD_NAV_STOP);
  window_stack_remove(s_window, true);
}

static void toggle_mute(void) {
  s_muted = !s_muted;
  ui_toast(s_window, s_muted ? "Turn alerts off" : "Turn alerts on");
  layer_mark_dirty(s_canvas);
}

static void am_cb(ActionMenu *menu, const ActionMenuItem *item, void *ctx) {
  int a = (int)action_menu_item_get_action_data(item);
  if (a == 1) list_window_push(LW_STEPS, 0);
  else if (a == 2) toggle_mute();
  else if (a == 3) end_nav();
}

static void am_closed(ActionMenu *menu, const ActionMenuItem *performed, void *ctx) {
  action_menu_hierarchy_destroy(s_am_root, NULL, NULL);
  s_am_root = NULL;
  s_am = NULL;
}

static void select_click(ClickRecognizerRef r, void *ctx) {
  if (s_arrived) { end_nav(); return; }
  s_am_root = action_menu_level_create(3);
  action_menu_level_add_action(s_am_root, "Directions list", am_cb, (void *)1);
  action_menu_level_add_action(s_am_root, s_muted ? "Turn alerts on" : "Turn alerts off", am_cb, (void *)2);
  action_menu_level_add_action(s_am_root, "End navigation", am_cb, (void *)3);
  ActionMenuConfig cfg = {
    .root_level = s_am_root,
    .colors = { .background = C_NAVGREEN, .foreground = GColorWhite },
    .align = ActionMenuAlignCenter,
    .did_close = am_closed,
  };
  s_am = action_menu_open(&cfg);
}

static void up_click(ClickRecognizerRef r, void *ctx) {
  if (!s_arrived) list_window_push(LW_STEPS, 0);
}
static void down_click(ClickRecognizerRef r, void *ctx) {
  if (!s_arrived) toggle_mute();
}

static void back_reset(void *ctx) {
  s_back_timer = NULL;
  s_back_armed = false;
}

static void back_click(ClickRecognizerRef r, void *ctx) {
  if (s_arrived || s_back_armed) {
    end_nav();
    return;
  }
  s_back_armed = true;
  ui_toast(s_window, "Press Back again to end");
  if (s_back_timer) app_timer_cancel(s_back_timer);
  s_back_timer = app_timer_register(2500, back_reset, NULL);
}

static void click_config(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
  window_single_click_subscribe(BUTTON_ID_BACK, back_click);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  s_canvas = layer_create(b);
  layer_set_update_proc(s_canvas, canvas_update);
  layer_add_child(root, s_canvas);
  s_maparea = layer_create(map_rect(b));
  layer_set_update_proc(s_maparea, maparea_update);
  layer_add_child(s_canvas, s_maparea);
  s_dots = dots_layer_create(GRect(0, banner_h(b) + 4, b.size.w, 24));
  layer_add_child(root, s_dots);
  dots_layer_set_running(s_dots, true);
}

static void window_appear(Window *window) {
  comm_set_handler(handle, NULL);
}

static void window_disappear(Window *window) {
  comm_clear_handler(handle);
  ui_toast_cancel();
}

static void window_unload(Window *window) {
  if (s_back_timer) app_timer_cancel(s_back_timer);
  s_back_timer = NULL;
  dots_layer_destroy(s_dots);
  layer_destroy(s_maparea);
  layer_destroy(s_canvas);
  window_destroy(s_window);
  s_window = NULL;
}

void nav_window_push(int mode) {
  if (s_window) window_stack_remove(s_window, false);
  s_mode = mode;
  s_have = false;
  s_arrived = false;
  s_back_armed = false;
  s_flags = 0;
  s_npts = 0;
  s_man = MAN_DEPART;
  s_next_man = MAN_NONE;
  strncpy(s_instr, "Starting navigation", sizeof(s_instr));
  s_dist[0] = s_remain[0] = s_detail[0] = 0;
  map_release();  // the nav view is drawn on the watch; free the image memory
  s_window = window_create();
  window_set_background_color(s_window, C_BG);
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load, .appear = window_appear,
    .disappear = window_disappear, .unload = window_unload,
  });
  window_stack_push(s_window, true);
  OutMsg m;
  comm_msg_init(&m, CMD_NAV_START);
  m.mode = mode;
  GRect b = layer_get_bounds(window_get_root_layer(s_window));
  GRect mr = map_rect(b);
  m.width = mr.size.w;
  m.height = mr.size.h;
  comm_send(&m);
}
