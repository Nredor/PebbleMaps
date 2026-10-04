// Pebble Maps - search / explore results: map with pins + card, or list
#include "windows.h"
#include "comm.h"
#include "mapdata.h"

#define MAX_RESULTS 10

static Window *s_window;
static Layer *s_canvas;
static Layer *s_dots;
static MenuLayer *s_menu;
static ListItem *s_items;
static int s_count;
static int s_sel;
static bool s_loaded;
static bool s_list_mode;
static char s_title[48];
static char s_query[160];
static int s_category = -1;
static char s_status[96];

static int card_h(GRect b) { return PBL_IF_ROUND_ELSE(64, b.size.h >= 200 ? 62 : 56); }

static void request_results(void) {
  OutMsg m;
  if (s_category >= 0) {
    comm_msg_init(&m, CMD_NEARBY);
    m.idx = s_category;
  } else {
    comm_msg_init(&m, CMD_SEARCH);
    strncpy(m.text, s_query, sizeof(m.text) - 1);
  }
  comm_send(&m);
  s_loaded = false;
  snprintf(s_status, sizeof(s_status), "Searching");
  dots_layer_set_running(s_dots, true);
}

static void request_map(void) {
  GRect b = layer_get_bounds(window_get_root_layer(s_window));
  map_request(CMD_RESULTS_MAP, b.size.w, b.size.h, s_sel, card_h(b) + PBL_IF_ROUND_ELSE(10, 4));
}

static void handle(int cmd, DictionaryIterator *it, void *ctx) {
  switch (cmd) {
    case CMD_LIST:
      if (tuple_int(it, MESSAGE_KEY_num, -1) != LIST_RESULTS) return;
      s_count = parse_list(tuple_str(it, MESSAGE_KEY_list), s_items, MAX_RESULTS);
      s_sel = 0;
      s_loaded = true;
      s_status[0] = 0;
      if (s_menu) menu_layer_reload_data(s_menu);
      if (s_count) request_map();
      dots_layer_set_running(s_dots, false);
      layer_mark_dirty(s_canvas);
      break;
    case CMD_BUSY:
      strncpy(s_status, tuple_str(it, MESSAGE_KEY_text), sizeof(s_status) - 1);
      layer_mark_dirty(s_canvas);
      break;
    case CMD_TOAST:
      ui_toast(s_window, tuple_str(it, MESSAGE_KEY_text));
      break;
    case CMD_ERROR:
      dots_layer_set_running(s_dots, false);
      s_loaded = true;
      s_count = 0;
      if (tuple_int(it, MESSAGE_KEY_num, 0) == ERR_NO_RESULTS) {
        strncpy(s_status, tuple_str(it, MESSAGE_KEY_text), sizeof(s_status) - 1);
        layer_mark_dirty(s_canvas);
      } else {
        s_status[0] = 0;
        window_stack_remove(s_window, false);
        show_error(it);
      }
      break;
  }
}

static void draw_card_content(GContext *ctx, GRect card) {
  if (!s_count) return;
  ListItem *item = &s_items[s_sel];
  int pad = PBL_IF_ROUND_ELSE(22, 6);
  GRect tr = GRect(card.origin.x + pad, card.origin.y + 1, card.size.w - pad * 2, 24);
  graphics_context_set_text_color(ctx, C_TEXT);
  graphics_draw_text(ctx, item->title, g_fonts.body_b, tr, GTextOverflowModeTrailingEllipsis,
                     PBL_IF_ROUND_ELSE(GTextAlignmentCenter, GTextAlignmentLeft), NULL);
  GRect sr = GRect(tr.origin.x, tr.origin.y + 20, tr.size.w, card.size.h - 24);
  graphics_context_set_text_color(ctx, C_SUBTEXT);
  graphics_draw_text(ctx, item->sub, g_fonts.small, sr, GTextOverflowModeTrailingEllipsis,
                     PBL_IF_ROUND_ELSE(GTextAlignmentCenter, GTextAlignmentLeft), NULL);
  // counter chip
  char cnt[16];
  snprintf(cnt, sizeof(cnt), "%d/%d", s_sel + 1, s_count);
#ifndef PBL_ROUND
  GRect cr = GRect(card.origin.x + card.size.w - 34, card.origin.y - 20, 30, 16);
  graphics_context_set_fill_color(ctx, C_BLUE);
  graphics_fill_rect(ctx, cr, 8, GCornersAll);
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, cnt, g_fonts.small_b, GRect(cr.origin.x, cr.origin.y - 2, cr.size.w, 16),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
#endif
}

static void canvas_update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  map_draw(ctx, b, s_sel);
  int ch = card_h(b);
  GRect card = GRect(PBL_IF_ROUND_ELSE(0, 3), b.size.h - ch - PBL_IF_ROUND_ELSE(0, 3),
                     b.size.w - PBL_IF_ROUND_ELSE(0, 6), ch + PBL_IF_ROUND_ELSE(10, 0));
  // Title chip at the top
  GRect top = GRect(PBL_IF_ROUND_ELSE(36, 4), PBL_IF_ROUND_ELSE(10, 4), b.size.w - PBL_IF_ROUND_ELSE(72, 8), 22);
  draw_card(ctx, top, 11);
  graphics_context_set_text_color(ctx, C_TEXT);
  graphics_draw_text(ctx, s_title, g_fonts.small_b, GRect(top.origin.x + 6, top.origin.y + 2, top.size.w - 12, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  if (s_loaded && s_count) {
    draw_card(ctx, card, PBL_IF_ROUND_ELSE(0, 8));
    draw_card_content(ctx, card);
  } else if (s_status[0]) {
    draw_card(ctx, card, PBL_IF_ROUND_ELSE(0, 8));
    graphics_context_set_text_color(ctx, C_TEXT);
    int pad = PBL_IF_ROUND_ELSE(24, 6);
    graphics_draw_text(ctx, s_status, g_fonts.body_b,
                       GRect(card.origin.x + pad, card.origin.y + 4, card.size.w - pad * 2, ch - 6),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }
}

// --- List mode -------------------------------------------------------------
static uint16_t menu_rows(MenuLayer *m, uint16_t s, void *ctx) { return s_count; }
static int16_t menu_cell_h(MenuLayer *m, MenuIndex *i, void *ctx) {
  return PBL_IF_ROUND_ELSE(menu_layer_is_index_selected(m, i) ? 62 : 40, 48);
}
static void menu_draw_row(GContext *ctx, const Layer *cell, MenuIndex *i, void *cb) {
  ListItem *item = &s_items[i->row];
  GRect b = layer_get_bounds(cell);
  bool hl = menu_cell_layer_is_highlighted(cell);
#ifdef PBL_ROUND
  menu_cell_basic_draw(ctx, cell, item->title, hl ? item->sub : NULL, NULL);
  (void)b;
#else
  GColor fg = hl ? GColorWhite : C_RED;
  icon_draw(ctx, ICON_PIN, GPoint(14, b.size.h / 2), 18, fg, hl ? C_BLUE : C_BG);
  graphics_context_set_text_color(ctx, hl ? GColorWhite : C_TEXT);
  graphics_draw_text(ctx, item->title, g_fonts.body_b, GRect(28, 0, b.size.w - 32, 22),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(ctx, hl ? GColorWhite : C_SUBTEXT);
  graphics_draw_text(ctx, item->sub, g_fonts.small, GRect(28, 20, b.size.w - 32, 28),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
#endif
}
static void menu_select(MenuLayer *m, MenuIndex *i, void *ctx) {
  s_sel = i->row;
  place_window_push(SRC_RESULTS, s_sel, s_items[s_sel].title);
}
static void menu_select_long(MenuLayer *m, MenuIndex *i, void *ctx);

static void set_list_mode(bool on) {
  s_list_mode = on;
  Layer *root = window_get_root_layer(s_window);
  if (on && !s_menu) {
    GRect b = layer_get_bounds(root);
    s_menu = menu_layer_create(b);
    menu_layer_set_callbacks(s_menu, NULL, (MenuLayerCallbacks){
      .get_num_rows = menu_rows, .get_cell_height = menu_cell_h,
      .draw_row = menu_draw_row, .select_click = menu_select,
      .select_long_click = menu_select_long,
    });
    menu_layer_set_highlight_colors(s_menu, C_BLUE, GColorWhite);
    menu_layer_set_click_config_onto_window(s_menu, s_window);
    layer_add_child(root, menu_layer_get_layer(s_menu));
    menu_layer_set_selected_index(s_menu, MenuIndex(0, s_sel), MenuRowAlignCenter, false);
  } else if (!on && s_menu) {
    MenuIndex mi = menu_layer_get_selected_index(s_menu);
    s_sel = mi.row;
    layer_remove_from_parent(menu_layer_get_layer(s_menu));
    menu_layer_destroy(s_menu);
    s_menu = NULL;
    window_set_click_config_provider(s_window, NULL);
    extern void results_click_config(void *ctx);
    window_set_click_config_provider(s_window, results_click_config);
    layer_mark_dirty(s_canvas);
  }
}

static void menu_select_long(MenuLayer *m, MenuIndex *i, void *ctx) { set_list_mode(false); }

// --- Buttons ---------------------------------------------------------------
static void move(int d) {
  if (!s_count) return;
  s_sel = (s_sel + d + s_count) % s_count;
  layer_mark_dirty(s_canvas);
}
static void up_click(ClickRecognizerRef r, void *ctx) { move(-1); }
static void down_click(ClickRecognizerRef r, void *ctx) { move(1); }
static void select_click(ClickRecognizerRef r, void *ctx) {
  if (s_count) place_window_push(SRC_RESULTS, s_sel, s_items[s_sel].title);
  else if (s_loaded) request_results();
}
static void select_long(ClickRecognizerRef r, void *ctx) {
  if (s_count) set_list_mode(true);
}

void results_click_config(void *ctx) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 300, up_click);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 300, down_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_long_click_subscribe(BUTTON_ID_SELECT, 500, select_long, NULL);
}

static void touch_cb(const TouchEvent *e, void *ctx) {
  if (e->type != TouchEvent_Liftoff || s_list_mode) return;
  GRect b = layer_get_bounds(s_canvas);
  if (e->y > b.size.h - card_h(b)) {
    select_click(NULL, NULL);
    return;
  }
  int idx = map_pin_near(GPoint(e->x, e->y), b, 26);
  if (idx >= 0) {
    if (idx == s_sel) select_click(NULL, NULL);
    else {
      s_sel = idx;
      layer_mark_dirty(s_canvas);
    }
  }
}

// --- Lifecycle -------------------------------------------------------------
static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  s_items = calloc(MAX_RESULTS, sizeof(ListItem));
  s_canvas = layer_create(b);
  layer_set_update_proc(s_canvas, canvas_update);
  layer_add_child(root, s_canvas);
  s_dots = dots_layer_create(GRect(0, b.size.h / 2 - 30, b.size.w, 30));
  layer_add_child(root, s_dots);
  request_results();
}

static void window_appear(Window *window) {
  comm_set_handler(handle, NULL);
  map_set_observer(s_canvas);
  if (g_app.touch) touch_service_subscribe(touch_cb, NULL);
  // returning from a place card: get our map back
  if (s_loaded && s_count && !g_map.bmp) request_map();
}

static void window_disappear(Window *window) {
  comm_clear_handler(handle);
  map_set_observer(NULL);
  ui_toast_cancel();
  if (g_app.touch) touch_service_unsubscribe();
}

static void window_unload(Window *window) {
  if (s_menu) menu_layer_destroy(s_menu);
  s_menu = NULL;
  dots_layer_destroy(s_dots);
  layer_destroy(s_canvas);
  free(s_items);
  s_items = NULL;
  window_destroy(s_window);
  s_window = NULL;
}

static void push(void) {
  if (s_window) window_stack_remove(s_window, false);
  s_count = 0;
  s_sel = 0;
  s_loaded = false;
  s_list_mode = false;
  s_window = window_create();
  window_set_background_color(s_window, C_MAPBG);
  window_set_click_config_provider(s_window, results_click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load, .appear = window_appear,
    .disappear = window_disappear, .unload = window_unload,
  });
  window_stack_push(s_window, true);
}

void results_window_push_search(const char *query) {
  s_category = -1;
  strncpy(s_query, query, sizeof(s_query) - 1);
  s_query[sizeof(s_query) - 1] = 0;
  snprintf(s_title, sizeof(s_title), "\"%s\"", query);
  push();
}

void results_window_push_nearby(int category) {
  s_category = category;
  s_query[0] = 0;
  snprintf(s_title, sizeof(s_title), PBL_IF_ROUND_ELSE("%s", "%s nearby"), CATEGORY_NAMES[category]);
  push();
}
