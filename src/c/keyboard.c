// Pebble Maps - on-screen touch keyboard (adapted from Pebblegram's "pgkb")
//
// The keys sit at the bottom at the same size as Pebblegram's keyboard;
// suggestions for what you're typing appear in the space above.
#include "keyboard.h"
#include "ui.h"

#if KEYBOARD_AVAILABLE

#define KB_MAX_TEXT 64
#define KB_ROWS 4
#define KB_ROW_H 21
#define KB_PAUSE_MS 350

static Window *s_window;
static Layer *s_layer;
static char s_text[KB_MAX_TEXT];
static const char *s_placeholder;
static const char *s_action;
static KeyboardHooks s_hooks;
static void *s_ctx;
static bool s_shift, s_symbols;
static GRect s_pressed;          // key or suggestion under the finger
static bool s_has_press;
static AppTimer *s_pause_timer;
static ListItem *s_sugg;
static int s_nsugg;

// --- Layout -------------------------------------------------------------------------
// Search bar at the top (where the home screen's bar is)
static GRect bar_rect(GRect b) {
  int h = g_fonts.small_h + 12;
#ifdef PBL_ROUND
  return GRect(b.size.w / 2 - 80, 22, 160, h);
#else
  return GRect(6, 6, b.size.w - 12, h);
#endif
}

// Dark panel with the keys, docked at the bottom
static GRect panel_rect(GRect b) {
  int top = PBL_IF_ROUND_ELSE(132, b.size.h - KB_ROWS * KB_ROW_H - 4);
  return GRect(0, top, b.size.w, b.size.h - top);
}

static GRect keys_rect(GRect b) {
  GRect p = panel_rect(b);
#ifdef PBL_ROUND
  return GRect(38, p.origin.y + 3, b.size.w - 76, KB_ROWS * KB_ROW_H);
#else
  return GRect(0, p.origin.y + 3, b.size.w, KB_ROWS * KB_ROW_H);
#endif
}

// Suggestions drop down under the search bar
static int sugg_row_h(void) { return 36; }

static GRect sugg_rect(GRect b) {
  GRect br = bar_rect(b), pr = panel_rect(b);
  int top = br.origin.y + br.size.h + 3;
  int rows = (pr.origin.y - 4 - top) / sugg_row_h();
#ifdef PBL_ROUND
  return GRect(br.origin.x - 14, top, br.size.w + 28, rows * sugg_row_h());
#else
  return GRect(br.origin.x, top, br.size.w, rows * sugg_row_h());
#endif
}

static int sugg_rows(GRect b) {
  int n = sugg_rect(b).size.h / sugg_row_h();
  return n < s_nsugg ? n : s_nsugg;
}

static GRect sugg_row(GRect b, int i) {
  GRect sr = sugg_rect(b);
  return GRect(sr.origin.x, sr.origin.y + i * sugg_row_h(), sr.size.w, sugg_row_h());
}

static GRect key_rect(GRect kr, int row, int start, int units, int total) {
  int y = kr.origin.y + row * KB_ROW_H;
  int left = kr.size.w * start / total, right = kr.size.w * (start + units) / total;
  return GRect(kr.origin.x + left + 1, y + 1, right - left - 2, KB_ROW_H - 2);
}

static const char *row_chars(int row) {
  static const char *alpha[] = { "qwertyuiop", "asdfghjkl", "zxcvbnm" };
  static const char *sym[] = { "1234567890", "-/:;()$&@", ".,!?'#+" };
  return s_symbols ? sym[row] : alpha[row];
}

// What is at point p: a character, or an action ('^' shift, 'b' delete, 'm' 123/ABC, ' ' space, '>' go)
static char key_at(GRect kr, GPoint p, GRect *out) {
  for (int row = 0; row < 2; row++) {
    const char *c = row_chars(row);
    int n = strlen(c);
    for (int i = 0; i < n; i++) {
      GRect r = key_rect(kr, row, i, 1, n);
      if (grect_contains_point(&r, &p)) { *out = r; return c[i]; }
    }
  }
  static const struct { int8_t row, start, units, total; char code; } specials[] = {
    { 2, 0, 2, 11, '^' }, { 2, 9, 2, 11, 'b' },
    { 3, 0, 2, 10, 'm' }, { 3, 2, 5, 10, ' ' }, { 3, 7, 3, 10, '>' },
  };
  for (unsigned s = 0; s < ARRAY_LENGTH(specials); s++) {
    GRect r = key_rect(kr, specials[s].row, specials[s].start, specials[s].units, specials[s].total);
    if (grect_contains_point(&r, &p)) { *out = r; return specials[s].code; }
  }
  const char *c = row_chars(2);
  for (int i = 0; i < 7; i++) {
    GRect r = key_rect(kr, 2, i + 2, 1, 11);
    if (grect_contains_point(&r, &p)) { *out = r; return c[i]; }
  }
  return 0;
}

// --- Drawing --------------------------------------------------------------------------
static bool is_pressed(GRect r) {
  return s_has_press && gpoint_equal(&r.origin, &s_pressed.origin) && r.size.w == s_pressed.size.w;
}

static void draw_key(GContext *ctx, GRect r, const char *label, GColor fill, GColor text, GFont font, int font_h) {
  graphics_context_set_fill_color(ctx, is_pressed(r) ? C_BLUE_LT : fill);
  graphics_fill_rect(ctx, r, 3, GCornersAll);
  graphics_context_set_text_color(ctx, text);
  graphics_draw_text(ctx, label, font, GRect(r.origin.x, r.origin.y + (r.size.h - font_h) / 2 - 3, r.size.w, font_h + 4),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
}

static void draw_suggestions(GContext *ctx, GRect b) {
  int n = sugg_rows(b);
  if (n == 0) return;
  GRect sr = sugg_rect(b);
  GRect card = GRect(sr.origin.x, sr.origin.y, sr.size.w, n * sugg_row_h());
  draw_card(ctx, card, 6);
  GFont tf = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), sf = fonts_get_system_font(FONT_KEY_GOTHIC_14);
  for (int i = 0; i < n; i++) {
    GRect r = sugg_row(b, i);
    bool hl = is_pressed(r);
    if (hl) {
      graphics_context_set_fill_color(ctx, C_BLUE);
      graphics_fill_rect(ctx, grect_inset(r, GEdgeInsets(1)), 5, GCornersAll);
    }
    int pad = 6;
    int tx = r.origin.x + pad + 16;
    icon_draw(ctx, ICON_PIN, GPoint(r.origin.x + pad + 6, r.origin.y + r.size.h / 2), 14, hl ? GColorWhite : C_PIN, hl ? C_BLUE : GColorWhite);
    graphics_context_set_text_color(ctx, hl ? GColorWhite : GColorBlack);
    graphics_draw_text(ctx, s_sugg[i].title, tf, GRect(tx, r.origin.y - 1, r.origin.x + r.size.w - tx - pad, 22),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    graphics_context_set_text_color(ctx, hl ? GColorWhite : GColorDarkGray);
    graphics_draw_text(ctx, s_sugg[i].sub, sf, GRect(tx, r.origin.y + 17, r.origin.x + r.size.w - tx - pad, 18),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    if (i < n - 1) {
      graphics_context_set_stroke_color(ctx, C_DIVIDER);
      graphics_draw_line(ctx, GPoint(tx, r.origin.y + r.size.h - 1), GPoint(r.origin.x + r.size.w - pad, r.origin.y + r.size.h - 1));
    }
  }
}

static void update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  if (s_hooks.background) s_hooks.background(ctx, b, s_ctx);

  // search bar with what you've typed
  GRect br = bar_rect(b);
  draw_card(ctx, br, br.size.h / 2);
  graphics_context_set_stroke_color(ctx, C_BLUE);
  graphics_context_set_stroke_width(ctx, 2);
  graphics_draw_round_rect(ctx, grect_inset(br, GEdgeInsets(1)), br.size.h / 2 - 1);
  graphics_context_set_stroke_width(ctx, 1);
  icon_draw(ctx, ICON_SEARCH, GPoint(br.origin.x + 13, br.origin.y + br.size.h / 2), 13, C_TEXT, GColorWhite);
  GFont tf = g_fonts.small_b;
  GRect tr = GRect(br.origin.x + 24, br.origin.y + (br.size.h - g_fonts.small_h) / 2 - 3, br.size.w - 34, g_fonts.small_h + 4);
  if (s_text[0]) {
    const char *shown = s_text;   // show the end of long text
    while (*shown && graphics_text_layout_get_content_size(shown, tf, GRect(0, 0, 1000, 40),
           GTextOverflowModeFill, GTextAlignmentLeft).w > tr.size.w - 4) shown++;
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, shown, tf, tr, GTextOverflowModeFill, GTextAlignmentLeft, NULL);
    GSize ts = graphics_text_layout_get_content_size(shown, tf, tr, GTextOverflowModeFill, GTextAlignmentLeft);
    graphics_context_set_fill_color(ctx, C_BLUE);
    graphics_fill_rect(ctx, GRect(tr.origin.x + ts.w + 1, br.origin.y + 5, 2, br.size.h - 10), 0, GCornerNone);
  } else {
    graphics_context_set_text_color(ctx, GColorDarkGray);
    graphics_draw_text(ctx, s_placeholder, g_fonts.small, tr, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  }
  draw_suggestions(ctx, b);

  // keyboard panel
  GRect kr = keys_rect(b);
  graphics_context_set_fill_color(ctx, GColorDarkGray);
  graphics_fill_rect(ctx, panel_rect(b), 0, GCornerNone);
  GFont kf = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), lf = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  char label[2] = { 0, 0 };
  for (int row = 0; row < 3; row++) {
    const char *c = row_chars(row);
    int n = strlen(c);
    for (int i = 0; i < n; i++) {
      label[0] = c[i];
      if (s_shift && !s_symbols && label[0] >= 'a' && label[0] <= 'z') label[0] -= 'a' - 'A';
      GRect r = row < 2 ? key_rect(kr, row, i, 1, n) : key_rect(kr, 2, i + 2, 1, 11);
      draw_key(ctx, r, label, GColorWhite, GColorBlack, kf, 18);
    }
  }
  GColor sp = GColorLightGray;
  GRect shift = key_rect(kr, 2, 0, 2, 11);
  draw_key(ctx, shift, "", s_shift ? GColorWhite : sp, GColorBlack, lf, 14);
  icon_draw(ctx, ICON_UP, grect_center_point(&shift), 12, s_shift ? C_BLUE : GColorBlack, GColorWhite);
  draw_key(ctx, key_rect(kr, 2, 9, 2, 11), "del", sp, GColorBlack, lf, 14);
  draw_key(ctx, key_rect(kr, 3, 0, 2, 10), s_symbols ? "ABC" : "123", sp, GColorBlack, lf, 14);
  draw_key(ctx, key_rect(kr, 3, 2, 5, 10), "space", GColorWhite, GColorBlack, lf, 14);
  draw_key(ctx, key_rect(kr, 3, 7, 3, 10), s_action, s_text[0] ? C_BLUE : sp, s_text[0] ? GColorWhite : GColorDarkGray, lf, 14);
}

// --- Typing ---------------------------------------------------------------------------
static void clear_suggestions(void) {
  free(s_sugg);
  s_sugg = NULL;
  s_nsugg = 0;
}

void keyboard_set_suggestions(ListItem *items, int count) {
  clear_suggestions();
  if (!s_window) { free(items); return; }
  s_sugg = items;
  s_nsugg = items ? count : 0;
  layer_mark_dirty(s_layer);
}

const char *keyboard_text(void) { return s_text; }

static void pause_cb(void *data) {
  s_pause_timer = NULL;
  if (s_hooks.changed) s_hooks.changed(s_text, s_ctx);
}

static void text_changed(void) {
  if (strlen(s_text) < 2) clear_suggestions();
  if (s_pause_timer) app_timer_reschedule(s_pause_timer, KB_PAUSE_MS);
  else s_pause_timer = app_timer_register(KB_PAUSE_MS, pause_cb, NULL);
}

static void finish(void) {
  if (!s_text[0]) return;
  char text[KB_MAX_TEXT];
  strncpy(text, s_text, sizeof(text));
  void (*done)(const char *, void *) = s_hooks.done;
  void *ctx = s_ctx;
  window_stack_remove(s_window, false);
  if (done) done(text, ctx);
}

static void pick(int i) {
  if (i < 0 || i >= s_nsugg) return;
  char title[64];
  strncpy(title, s_sugg[i].title, sizeof(title) - 1);
  title[sizeof(title) - 1] = 0;
  void (*fn)(int, const char *, void *) = s_hooks.pick;
  void *ctx = s_ctx;
  window_stack_remove(s_window, false);
  if (fn) fn(i, title, ctx);
}

static void type_key(char code) {
  size_t n = strlen(s_text);
  switch (code) {
    case '^': s_shift = !s_shift; break;
    case 'm': s_symbols = !s_symbols; s_shift = false; break;
    case 'b':
      if (n) { s_text[n - 1] = 0; text_changed(); }
      if (n <= 1) s_shift = true;
      break;
    case '>': finish(); return;
    default:
      if (n + 1 >= KB_MAX_TEXT) break;
      if (code == ' ' && (n == 0 || s_text[n - 1] == ' ')) break;
      if (s_shift && !s_symbols && code >= 'a' && code <= 'z') code -= 'a' - 'A';
      s_text[n] = code;
      s_text[n + 1] = 0;
      s_shift = false;
      text_changed();
      break;
  }
  layer_mark_dirty(s_layer);
}

static void touch_cb(const TouchEvent *e, void *ctx) {
  GRect b = layer_get_bounds(s_layer);
  GPoint p = GPoint(e->x, e->y);
  GRect r;
  int sugg = -1;
  char code = key_at(keys_rect(b), p, &r);
  if (!code) {
    for (int i = 0; i < sugg_rows(b); i++) {
      GRect sr = sugg_row(b, i);
      if (grect_contains_point(&sr, &p)) { sugg = i; r = sr; break; }
    }
  }
  if (e->type == TouchEvent_Liftoff) {
    s_has_press = false;
    if (code) type_key(code);
    else if (sugg >= 0) pick(sugg);
    else layer_mark_dirty(s_layer);
  } else {
    // finger down or sliding: highlight what it is on
    s_has_press = code != 0 || sugg >= 0;
    if (s_has_press) s_pressed = r;
    layer_mark_dirty(s_layer);
  }
}

static void select_click(ClickRecognizerRef rec, void *ctx) { finish(); }
static void up_click(ClickRecognizerRef rec, void *ctx) { type_key('b'); }
static void down_click(ClickRecognizerRef rec, void *ctx) { type_key(' '); }

static void click_config(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 150, up_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
}

static void window_load(Window *w) {
  Layer *root = window_get_root_layer(w);
  s_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_layer, update);
  layer_add_child(root, s_layer);
}

static void window_appear(Window *w) {
  app_touch_navigation_enable(false);   // swipes type, they don't press buttons
  touch_service_subscribe(touch_cb, NULL);
  if (s_hooks.appear) s_hooks.appear(s_ctx);
}

static void window_disappear(Window *w) {
  touch_service_unsubscribe();
  app_touch_navigation_enable(true);
}

static void window_unload(Window *w) {
  if (s_pause_timer) app_timer_cancel(s_pause_timer);
  s_pause_timer = NULL;
  clear_suggestions();
  layer_destroy(s_layer);
  window_destroy(s_window);
  s_window = NULL;
}

void keyboard_window_push(const char *placeholder, const char *action_label, const KeyboardHooks *hooks, void *ctx) {
  if (s_window) return;
  s_text[0] = 0;
  s_shift = true;        // capitalize the first letter
  s_symbols = false;
  s_has_press = false;
  s_placeholder = placeholder;
  s_action = action_label;
  memset(&s_hooks, 0, sizeof(s_hooks));
  if (hooks) s_hooks = *hooks;
  s_ctx = ctx;
  s_window = window_create();
  window_set_background_color(s_window, GColorWhite);
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load, .appear = window_appear,
    .disappear = window_disappear, .unload = window_unload,
  });
  window_stack_push(s_window, true);
}

#else
void keyboard_window_push(const char *placeholder, const char *action_label, const KeyboardHooks *hooks, void *ctx) {}
void keyboard_set_suggestions(ListItem *items, int count) { free(items); }
const char *keyboard_text(void) { return ""; }
#endif
