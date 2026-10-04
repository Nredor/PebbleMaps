// Pebble Maps - turn-by-turn navigation on a live Google map
#include "windows.h"
#include "comm.h"
#include "mapdata.h"
#include "mapbar.h"
#ifndef IDLE_MS
#define IDLE_MS 5000
#endif

static Window *s_window;
static Layer *s_canvas;
static Layer *s_dots;
static int s_mode;
static bool s_have;
static bool s_arrived;
static bool s_muted;
static bool s_cards_hidden;   // this navigation session only
static int s_flags;
static int s_man = MAN_DEPART;
static int s_next_man = MAN_NONE;
static char s_instr[128] = "Starting navigation";
static char s_dist[24];
static char s_remain[48];
static char s_detail[64];
static time_t s_arrive;
static GPoint s_puck, s_focus;
static bool s_have_puck;
static int s_heading;
static AppTimer *s_back_timer;
static bool s_back_armed;

// right-side options bar
static bool s_menu_open;
static int s_menu_page;
static AppTimer *s_menu_timer;
static MapBar s_bar;          // map controls (zoom / move)
static MapTouch s_touch;
static bool s_moved;          // user moved the map: re-center when controls close

#define MENU_PAGES 3

static bool cards_visible(void) {
  return !s_cards_hidden || s_arrived || (s_flags & (NAV_NEAR | NAV_ALERT_NOW | NAV_ALERT_SOON | NAV_NO_GPS | NAV_REROUTING));
}

// --- Layout helpers -------------------------------------------------------------
static int icon_size(void) { return g_fonts.level >= 1 ? 38 : 30; }

static int banner_h(GRect b) {
#ifdef PBL_ROUND
  GSize ts = graphics_text_layout_get_content_size(s_instr, g_fonts.small_b, GRect(0, 0, b.size.w - 50, 100),
                                                   GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter);
  int h = 40 + ts.h + 8;
  return clampi(h, 70, b.size.h * 45 / 100);
#else
  int col = icon_size() + 16;
  GSize ts = graphics_text_layout_get_content_size(s_instr, g_fonts.body_b, GRect(0, 0, b.size.w - col - 4, 200),
                                                   GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft);
  int left = icon_size() + g_fonts.small_h + 8;
  int h = ts.h + 8 > left ? ts.h + 8 : left;
  return clampi(h, left, b.size.h * 42 / 100);
#endif
}
static int bottom_h(void) { return PBL_IF_ROUND_ELSE(g_fonts.small_h * 2 + 18, g_fonts.title_h + 8); }
static int then_h(void) { return s_next_man != MAN_NONE && !s_arrived ? 18 : 0; }

// --- Phone messages ------------------------------------------------------------
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
      if (dict_find(it, MESSAGE_KEY_width)) {
        s_have_puck = true;
        s_puck = GPoint(tuple_int(it, MESSAGE_KEY_width, 0), tuple_int(it, MESSAGE_KEY_height, 0));
        s_focus = GPoint(tuple_int(it, MESSAGE_KEY_stride, s_puck.x), tuple_int(it, MESSAGE_KEY_total, s_puck.y));
        s_heading = tuple_int(it, MESSAGE_KEY_offset, 0);
      }
      bool was_arrived = s_arrived;
      s_arrived = (s_flags & NAV_ARRIVED) != 0;
      if (!s_muted) {
        if (s_arrived && !was_arrived) { vibe_now(); light_enable_interaction(); }
        else if (s_flags & NAV_ALERT_NOW) { vibe_now(); light_enable_interaction(); }
        else if (s_flags & NAV_ALERT_SOON) { vibe_soon(); light_enable_interaction(); }
      }
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

// --- Drawing -------------------------------------------------------------------
static void draw_map(GContext *ctx, GRect b, GRect visible) {
  draw_map_placeholder(ctx, b);
  GPoint anchor = GPoint(visible.origin.x + visible.size.w / 2, visible.origin.y + visible.size.h / 2);
  GPoint origin = GPoint(anchor.x - s_focus.x + g_map.shift_x, anchor.y - s_focus.y + g_map.shift_y);
  if (g_map.bmp) {
    graphics_context_set_compositing_mode(ctx, GCompOpAssign);
    graphics_draw_bitmap_in_rect(ctx, g_map.bmp, GRect(origin.x, origin.y, g_map.w, g_map.h));
  }
  if (s_have_puck) draw_puck(ctx, GPoint(origin.x + s_puck.x, origin.y + s_puck.y), g_fonts.level >= 1 ? 9 : 7, s_heading);
}

static void draw_banner(GContext *ctx, GRect b, int bh) {
  GColor bg = (s_flags & (NAV_NO_GPS | NAV_REROUTING)) ? PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack) : C_NAVGREEN;
  if (s_flags & NAV_TRANSIT) bg = PBL_IF_COLOR_ELSE(GColorCobaltBlue, GColorBlack);
  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_rect(ctx, GRect(0, 0, b.size.w, bh), 0, GCornerNone);
  graphics_context_set_text_color(ctx, GColorWhite);
  GColor ghost = PBL_IF_COLOR_ELSE(GColorMintGreen, GColorLightGray);
  const char *text = (s_flags & NAV_REROUTING) ? "Finding a new route..." : s_instr;
#ifdef PBL_ROUND
  maneuver_draw(ctx, s_man, GPoint(b.size.w / 2 - 24, 24), 28, GColorWhite, ghost);
  graphics_draw_text(ctx, s_dist, g_fonts.title, GRect(b.size.w / 2 - 6, 6, 80, 32),
                     GTextOverflowModeFill, GTextAlignmentLeft, NULL);
  graphics_draw_text(ctx, text, g_fonts.small_b, GRect(25, 38, b.size.w - 50, bh - 40),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
#else
  int isz = icon_size();
  int col = isz + 16;
  maneuver_draw(ctx, s_man, GPoint(col / 2, 4 + isz / 2), isz, GColorWhite, ghost);
  graphics_draw_text(ctx, s_dist, g_fonts.small_b, GRect(0, isz + 2, col, g_fonts.small_h + 4),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
  GFont f = g_fonts.body_b;
  GRect tr = GRect(col, -3, b.size.w - col - 3, bh);
  GSize ts = graphics_text_layout_get_content_size(text, f, tr, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft);
  if (ts.h > bh) f = g_fonts.small_b;
  graphics_draw_text(ctx, text, f, tr, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
#endif
  int th = then_h();
  if (th) {
    graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(C_NAVGREEN_DK, GColorBlack));
    GRect r = GRect(PBL_IF_ROUND_ELSE(b.size.w / 2 - 34, 0), bh, 68, th);
    graphics_fill_rect(ctx, r, 4, GCornersBottom);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "Then", g_fonts.chip, GRect(r.origin.x + 6, bh - 1, 34, 16),
                       GTextOverflowModeFill, GTextAlignmentLeft, NULL);
    maneuver_draw(ctx, s_next_man, GPoint(r.origin.x + 52, bh + th / 2), 15, GColorWhite, GColorWhite);
  }
}

static void draw_bottom(GContext *ctx, GRect b) {
  int h = bottom_h();
  GRect r = GRect(0, b.size.h - h, b.size.w, h);
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_rect(ctx, r, 0, GCornerNone);
  graphics_context_set_stroke_color(ctx, C_DIVIDER);
  graphics_draw_line(ctx, r.origin, GPoint(b.size.w, r.origin.y));
  char clk[16] = "";
  if (s_arrive) format_clock(s_arrive, clk, sizeof(clk));
#ifdef PBL_ROUND
  graphics_context_set_text_color(ctx, C_GREEN);
  graphics_draw_text(ctx, s_remain, g_fonts.small_b, GRect(24, r.origin.y + 1, b.size.w - 48, g_fonts.small_h + 4),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  if (clk[0]) {
    char arr[32];
    snprintf(arr, sizeof(arr), "Arrive %s", clk);
    graphics_context_set_text_color(ctx, C_SUBTEXT);
    graphics_draw_text(ctx, arr, g_fonts.small, GRect(34, r.origin.y + g_fonts.small_h, b.size.w - 68, g_fonts.small_h + 4),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }
#else
  int rw = b.size.w - ((s_bar.open || s_menu_open) ? STRIP_W : 0);
  char t[32];
  strncpy(t, s_remain, sizeof(t) - 1);
  t[sizeof(t) - 1] = 0;
  char *sep = strstr(t, " · ");
  const char *dist = "";
  if (sep) { *sep = 0; dist = s_remain + (sep - t) + strlen(" · "); }
  graphics_context_set_text_color(ctx, C_GREEN);
  GSize ts = graphics_text_layout_get_content_size(t, g_fonts.title, GRect(0, 0, b.size.w, h), GTextOverflowModeFill, GTextAlignmentLeft);
  graphics_draw_text(ctx, t, g_fonts.title, GRect(5, r.origin.y + (h - g_fonts.title_h) / 2 - 5, ts.w + 2, h),
                     GTextOverflowModeFill, GTextAlignmentLeft, NULL);
  char right[48];
  snprintf(right, sizeof(right), "%s%s%s", dist, (dist[0] && clk[0]) ? " · " : "", clk);
  graphics_context_set_text_color(ctx, C_SUBTEXT);
  graphics_draw_text(ctx, right, g_fonts.small_b,
                     GRect(ts.w + 9, r.origin.y + (h - g_fonts.small_h) / 2 - 3, rw - ts.w - 12, g_fonts.small_h + 4),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, NULL);
#endif
}

static void draw_arrived(GContext *ctx, GRect b) {
  graphics_context_set_fill_color(ctx, C_NAVGREEN);
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  icon_draw(ctx, ICON_FLAG, GPoint(b.size.w / 2, b.size.h / 2 - 34), 40, GColorWhite, C_NAVGREEN);
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, "You've arrived", g_fonts.title, GRect(4, b.size.h / 2 - 8, b.size.w - 8, 34),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
  graphics_draw_text(ctx, s_instr, g_fonts.body, GRect(PBL_IF_ROUND_ELSE(20, 6), b.size.h / 2 + 24,
                     b.size.w - PBL_IF_ROUND_ELSE(40, 12), g_fonts.body_h * 2 + 8),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

static void draw_menu(GContext *ctx, GRect b) {
  StripIcons ic = { .select = ICON_MORE, .select_plain = true, .page = s_menu_page, .pages = MENU_PAGES };
  switch (s_menu_page) {
    case 0:
      ic.up = ICON_MOVE;
      ic.down = s_muted ? ICON_MUTE : ICON_SOUND;
      ic.down_color = s_muted ? C_RED : C_ICON;
      break;
    case 1:
      ic.up = s_cards_hidden ? ICON_EYE : ICON_EYE_OFF;
      ic.down = ICON_LIST;
      break;
    default:
      ic.up = ICON_MAP;
      ic.down = ICON_STOP;
      ic.up_color = C_BLUE;
      ic.down_color = C_RED;
      break;
  }
  draw_action_strip(ctx, b, &ic);
}

static void canvas_update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  if (s_arrived) {
    draw_arrived(ctx, b);
    return;
  }
  bool cards = cards_visible();
  int top = cards ? banner_h(b) + then_h() : 0;
  int bot = cards ? bottom_h() : 0;
  GRect visible = GRect(0, top, b.size.w, b.size.h - top - bot);
  draw_map(ctx, b, visible);
  if (cards) {
    draw_banner(ctx, b, banner_h(b));
    draw_bottom(ctx, b);
  }
  if (s_bar.open) mapbar_draw(&s_bar, ctx, b);
  else if (s_menu_open) draw_menu(ctx, b);
  else draw_side_tab(ctx, GRect(0, top, b.size.w, b.size.h - top - bot));
  if (s_muted && !s_menu_open && !s_bar.open && cards) {
    icon_draw(ctx, ICON_MUTE, GPoint(b.size.w - PBL_IF_ROUND_ELSE(40, 12), b.size.h - bot - 12), 14, C_RED, C_BG);
  }
}

// --- Options bar -----------------------------------------------------------------
static void end_nav(void) {
  comm_cmd(CMD_NAV_STOP);
  window_stack_remove(s_window, true);
}

static void recenter_if_moved(void) {
  if (s_moved) {
    s_moved = false;
    map_adjust(ADJ_RESET, 0, 0);
  }
}

static void menu_close(void) {
  s_menu_open = false;
  if (s_menu_timer) { app_timer_cancel(s_menu_timer); s_menu_timer = NULL; }
  recenter_if_moved();
  layer_mark_dirty(s_canvas);
}

static void menu_timeout(void *ctx) {
  s_menu_timer = NULL;
  menu_close();
}

static void menu_poke(void) {
  if (s_menu_timer) app_timer_reschedule(s_menu_timer, IDLE_MS);
  else s_menu_timer = app_timer_register(IDLE_MS, menu_timeout, NULL);
}

static void menu_open(void) {
  s_menu_open = true;
  s_menu_page = 0;
  menu_poke();
  layer_mark_dirty(s_canvas);
}

static void bar_cb(MapBarEvent ev, void *ctx) {
  switch (ev) {
    case MB_EV_MOVED: s_moved = true; break;
    case MB_EV_EXTRA_UP: s_moved = false; map_adjust(ADJ_RESET, 0, 0); break;
    case MB_EV_EXTRA_DOWN: mapbar_close(&s_bar); break;
    case MB_EV_CLOSED: menu_close(); break;
  }
  if (s_canvas) layer_mark_dirty(s_canvas);
}

static void menu_action(ButtonId b) {
  menu_poke();
  if (b == BUTTON_ID_SELECT) {
    s_menu_page = (s_menu_page + 1) % MENU_PAGES;
  } else if (s_menu_page == 0) {
    if (b == BUTTON_ID_UP) {
      // map controls replace the options bar
      if (s_menu_timer) { app_timer_cancel(s_menu_timer); s_menu_timer = NULL; }
      mapbar_open(&s_bar);
    } else {
      s_muted = !s_muted;
      ui_toast(s_window, s_muted ? "Turn alerts off" : "Turn alerts on");
    }
  } else if (s_menu_page == 1) {
    if (b == BUTTON_ID_UP) {
      s_cards_hidden = !s_cards_hidden;
      ui_toast(s_window, s_cards_hidden ? "Cards hidden until the next turn" : "Cards shown");
    } else {
      menu_close();
      list_window_push(LW_STEPS, 0);
      return;
    }
  } else {
    if (b == BUTTON_ID_UP) {
      s_moved = true;  // re-center when the bar closes
      map_adjust(ADJ_FIT_ROUTE, 0, 0);
    } else {
      end_nav();
      return;
    }
  }
  layer_mark_dirty(s_canvas);
}

// --- Buttons ---------------------------------------------------------------------
static void back_reset(void *ctx) {
  s_back_timer = NULL;
  s_back_armed = false;
}

static void press(ButtonId b) {
  if (s_arrived) {
    if (b == BUTTON_ID_SELECT || b == BUTTON_ID_BACK) end_nav();
    return;
  }
  if (mapbar_button(&s_bar, b)) return;
  if (s_menu_open) {
    if (b == BUTTON_ID_BACK) menu_close();
    else menu_action(b);
    return;
  }
  switch (b) {
    case BUTTON_ID_SELECT: menu_open(); break;
    case BUTTON_ID_UP: list_window_push(LW_STEPS, 0); break;
    case BUTTON_ID_DOWN:
      s_muted = !s_muted;
      ui_toast(s_window, s_muted ? "Turn alerts off" : "Turn alerts on");
      layer_mark_dirty(s_canvas);
      break;
    case BUTTON_ID_BACK:
      if (s_back_armed) { end_nav(); return; }
      s_back_armed = true;
      ui_toast(s_window, "Press Back again to end");
      if (s_back_timer) app_timer_cancel(s_back_timer);
      s_back_timer = app_timer_register(2500, back_reset, NULL);
      break;
    default: break;
  }
}

static void up_click(ClickRecognizerRef r, void *ctx) { press(BUTTON_ID_UP); }
static void select_click(ClickRecognizerRef r, void *ctx) { press(BUTTON_ID_SELECT); }
static void down_click(ClickRecognizerRef r, void *ctx) { press(BUTTON_ID_DOWN); }
static void back_click(ClickRecognizerRef r, void *ctx) { press(BUTTON_ID_BACK); }

static void click_config(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
  window_single_click_subscribe(BUTTON_ID_BACK, back_click);
}

// --- Touch -----------------------------------------------------------------------
static void map_tap(GPoint p, void *ctx) {
  if (!s_menu_open && !s_bar.open) menu_open();
}

static void touch_cb(const TouchEvent *e, void *ctx) {
  GRect b = layer_get_bounds(s_canvas);
  if (e->x >= b.size.w - STRIP_W && e->type == TouchEvent_Liftoff && !e->non_navigational) {
    ButtonId btn = e->y < b.size.h / 3 ? BUTTON_ID_UP : (e->y > b.size.h * 2 / 3 ? BUTTON_ID_DOWN : BUTTON_ID_SELECT);
    if (s_bar.open || s_menu_open) { press(btn); return; }
    if (btn == BUTTON_ID_SELECT) { menu_open(); return; }
  }
  if (maptouch_event(&s_touch, e) && s_touch.dragging && !s_bar.open) {
    mapbar_open(&s_bar);   // moving the map shows the controls
  }
}

// --- Lifecycle ---------------------------------------------------------------------
static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  s_canvas = layer_create(b);
  layer_set_update_proc(s_canvas, canvas_update);
  layer_add_child(root, s_canvas);
  s_dots = dots_layer_create(GRect(0, b.size.h / 2 - 12, b.size.w, 24));
  layer_add_child(root, s_dots);
  dots_layer_set_running(s_dots, true);
  mapbar_init(&s_bar, s_canvas, b.size, ICON_MYLOC, ICON_CLOSE, bar_cb, NULL);
  s_bar.extra_up_color = C_BLUE;
  maptouch_init(&s_touch, GRect(0, 0, b.size.w - STRIP_W, b.size.h), map_tap, NULL, &s_bar);
}

static void window_appear(Window *window) {
  comm_set_handler(handle, NULL);
  map_set_observer(s_canvas);
  if (g_app.touch) touch_service_subscribe(touch_cb, NULL);
}

static void window_disappear(Window *window) {
  comm_clear_handler(handle);
  map_set_observer(NULL);
  ui_toast_cancel();
  mapbar_deinit(&s_bar);
  maptouch_deinit(&s_touch);
  if (s_menu_timer) { app_timer_cancel(s_menu_timer); s_menu_timer = NULL; }
  s_menu_open = false;
  if (g_app.touch) touch_service_unsubscribe();
}

static void window_unload(Window *window) {
  if (s_back_timer) app_timer_cancel(s_back_timer);
  s_back_timer = NULL;
  dots_layer_destroy(s_dots);
  layer_destroy(s_canvas);
  s_canvas = NULL;
  window_destroy(s_window);
  s_window = NULL;
}

void nav_window_push(int mode) {
  if (s_window) window_stack_remove(s_window, false);
  // free memory: only home and the route overview stay underneath
  list_windows_close_all();
  place_window_close();
  results_window_close();
  s_mode = mode;
  s_have = s_arrived = s_back_armed = false;
  s_cards_hidden = false;
  s_moved = false;
  s_have_puck = false;
  s_flags = 0;
  s_man = MAN_DEPART;
  s_next_man = MAN_NONE;
  strncpy(s_instr, "Starting navigation", sizeof(s_instr));
  s_dist[0] = s_remain[0] = s_detail[0] = 0;
  s_window = window_create();
  window_set_background_color(s_window, C_BG);
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load, .appear = window_appear,
    .disappear = window_disappear, .unload = window_unload,
  });
  window_stack_push(s_window, true);
  GRect b = layer_get_bounds(window_get_root_layer(s_window));
  map_request(CMD_NAV_START, b.size.w, b.size.h, -1, mode);
}
