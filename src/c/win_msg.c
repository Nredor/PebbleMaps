// Pebble Maps - friendly message screens (setup, errors)
#include "windows.h"
#include "comm.h"

typedef struct {
  Window *window;
  ScrollLayer *scroll;
  Layer *icon_layer;
  TextLayer *title;
  TextLayer *body;
  IconId icon;
  bool pop_on_configured;
  char title_text[48];
  char body_text[256];
} MsgWin;

static MsgWin *s_setup;  // only one setup screen at a time

static void icon_update(Layer *layer, GContext *ctx) {
  MsgWin *mw = *(MsgWin **)layer_get_data(layer);
  GRect b = layer_get_bounds(layer);
  GColor c = mw->icon == ICON_WARNING ? C_RED : C_BLUE;
  graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorCeleste, GColorWhite));
  if (mw->icon == ICON_WARNING) graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorMelon, GColorWhite));
  graphics_fill_circle(ctx, GPoint(b.size.w / 2, b.size.h / 2), b.size.h / 2);
  icon_draw(ctx, mw->icon, GPoint(b.size.w / 2, b.size.h / 2), b.size.h * 6 / 10, c, PBL_IF_COLOR_ELSE(GColorCeleste, GColorWhite));
}

static void handle(int cmd, DictionaryIterator *it, void *ctx) {
  MsgWin *mw = ctx;
  if (cmd == CMD_STATUS && mw->pop_on_configured && g_app.configured) {
    window_stack_remove(mw->window, true);
  }
}

static void window_load(Window *window) {
  MsgWin *mw = window_get_user_data(window);
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  int pad = PBL_IF_ROUND_ELSE(22, 8);
  mw->scroll = scroll_layer_create(b);
  scroll_layer_set_click_config_onto_window(mw->scroll, window);
#ifdef PBL_ROUND
  scroll_layer_set_paging(mw->scroll, true);
#endif
  int y = PBL_IF_ROUND_ELSE(14, 8);
  mw->icon_layer = layer_create_with_data(GRect(b.size.w / 2 - 22, y, 44, 44), sizeof(MsgWin *));
  *(MsgWin **)layer_get_data(mw->icon_layer) = mw;
  layer_set_update_proc(mw->icon_layer, icon_update);
  scroll_layer_add_child(mw->scroll, mw->icon_layer);
  y += 48;
  mw->title = text_layer_create(GRect(pad, y, b.size.w - pad * 2, 60));
  text_layer_set_font(mw->title, g_fonts.title);
  text_layer_set_text_alignment(mw->title, GTextAlignmentCenter);
  text_layer_set_text(mw->title, mw->title_text);
  GSize ts = text_layer_get_content_size(mw->title);
  layer_set_frame(text_layer_get_layer(mw->title), GRect(pad, y, b.size.w - pad * 2, ts.h + 6));
  scroll_layer_add_child(mw->scroll, text_layer_get_layer(mw->title));
  y += ts.h + 6;
  mw->body = text_layer_create(GRect(pad, y, b.size.w - pad * 2, 2000));
  text_layer_set_font(mw->body, g_fonts.body);
  text_layer_set_text_alignment(mw->body, GTextAlignmentCenter);
  text_layer_set_text(mw->body, mw->body_text);
  GSize bs = text_layer_get_content_size(mw->body);
  layer_set_frame(text_layer_get_layer(mw->body), GRect(pad, y, b.size.w - pad * 2, bs.h + 8));
  scroll_layer_add_child(mw->scroll, text_layer_get_layer(mw->body));
  y += bs.h + PBL_IF_ROUND_ELSE(40, 16);
  scroll_layer_set_content_size(mw->scroll, GSize(b.size.w, y));
  layer_add_child(root, scroll_layer_get_layer(mw->scroll));
}

static void window_appear(Window *window) {
  comm_set_handler(handle, window_get_user_data(window));
}

static void window_disappear(Window *window) {
  comm_clear_handler(handle);
}

static void window_unload(Window *window) {
  MsgWin *mw = window_get_user_data(window);
  text_layer_destroy(mw->title);
  text_layer_destroy(mw->body);
  layer_destroy(mw->icon_layer);
  scroll_layer_destroy(mw->scroll);
  if (s_setup == mw) s_setup = NULL;
  free(mw);
  window_destroy(window);
}

void msg_window_push(IconId icon, const char *title, const char *body, bool pop_on_configured) {
  if (pop_on_configured && s_setup) return;
  MsgWin *mw = calloc(1, sizeof(MsgWin));
  if (!mw) return;
  mw->icon = icon;
  mw->pop_on_configured = pop_on_configured;
  strncpy(mw->title_text, title, sizeof(mw->title_text) - 1);
  strncpy(mw->body_text, body, sizeof(mw->body_text) - 1);
  if (pop_on_configured) s_setup = mw;
  mw->window = window_create();
  window_set_user_data(mw->window, mw);
  window_set_background_color(mw->window, C_BG);
  window_set_window_handlers(mw->window, (WindowHandlers){
    .load = window_load, .appear = window_appear,
    .disappear = window_disappear, .unload = window_unload,
  });
  window_stack_push(mw->window, true);
}

void show_error(DictionaryIterator *it) {
  int code = tuple_int(it, MESSAGE_KEY_num, ERR_API);
  const char *text = tuple_str(it, MESSAGE_KEY_text);
  const char *title = tuple_str(it, MESSAGE_KEY_text2);
  IconId icon = ICON_WARNING;
  if (!title[0]) {
    switch (code) {
      case ERR_NO_KEY: title = "Setup needed"; icon = ICON_KEY; break;
      case ERR_NO_LOCATION: title = "Where are you?"; icon = ICON_MYLOC; break;
      case ERR_NETWORK: title = "No connection"; icon = ICON_PHONE; break;
      case ERR_NO_RESULTS: title = "Nothing found"; icon = ICON_SEARCH; break;
      default: title = "Something went wrong"; break;
    }
  }
  if (code == ERR_NO_LOCATION) icon = ICON_MYLOC;
  msg_window_push(icon, title, text[0] ? text : "Please try again.", code == ERR_NO_KEY);
}
