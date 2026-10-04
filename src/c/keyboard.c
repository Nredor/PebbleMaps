// Pebble Maps - on-screen touch keyboard (adapted from Pebblegram's "pgkb")
#include "keyboard.h"
#include "ui.h"

#if KEYBOARD_AVAILABLE

#define KB_MAX_TEXT 64
#define KB_ROWS 4

static Window *s_window;
static Layer *s_layer;
static char s_text[KB_MAX_TEXT];
static const char *s_placeholder;
static const char *s_action;
static KeyboardDone s_done;
static void *s_ctx;
static bool s_shift, s_symbols;
static GRect s_pressed;          // key under the finger (highlighted)
static bool s_has_press;

// --- Layout -------------------------------------------------------------------------
static GRect input_rect(GRect b) {
#ifdef PBL_ROUND
  return GRect(b.size.w / 2 - 88, 34, 176, 34);
#else
  return GRect(6, 8, b.size.w - 12, 34);
#endif
}

static GRect keys_rect(GRect b) {
#ifdef PBL_ROUND
  return GRect(20, 76, b.size.w - 40, 4 * 30);
#else
  int row_h = (b.size.h - 52) / KB_ROWS;   // as tall as the screen allows: easier to hit
  if (row_h > 44) row_h = 44;
  return GRect(0, b.size.h - KB_ROWS * row_h - 2, b.size.w, KB_ROWS * row_h);
#endif
}

static GRect key_rect(GRect kr, int row, int start, int units, int total) {
  int row_h = kr.size.h / KB_ROWS;
  int y = kr.origin.y + row * row_h;
  int left = kr.size.w * start / total, right = kr.size.w * (start + units) / total;
  return GRect(kr.origin.x + left + 1, y + 1, right - left - 2, row_h - 3);
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
  struct { int row, start, units, total; char code; } specials[] = {
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
static void draw_key(GContext *ctx, GRect r, const char *label, GColor fill, GColor text, GFont font) {
  bool pressed = s_has_press && gpoint_equal(&r.origin, &s_pressed.origin);
  graphics_context_set_fill_color(ctx, pressed ? C_BLUE_LT : fill);
  graphics_fill_rect(ctx, r, 4, GCornersAll);
  graphics_context_set_text_color(ctx, text);
  int fh = font == g_fonts.small_b ? g_fonts.small_h : 24;
  graphics_draw_text(ctx, label, font, GRect(r.origin.x, r.origin.y + (r.size.h - fh) / 2 - 3, r.size.w, fh + 4),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
}

static void update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, GColorDarkGray);
  graphics_fill_rect(ctx, b, 0, GCornerNone);

  // text box
  GRect ir = input_rect(b);
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, ir, ir.size.h / 2, GCornersAll);
  icon_draw(ctx, ICON_SEARCH, GPoint(ir.origin.x + 16, ir.origin.y + ir.size.h / 2), 14, C_TEXT, GColorWhite);
  GFont tf = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GRect tr = GRect(ir.origin.x + 28, ir.origin.y + 1, ir.size.w - 36, ir.size.h);
  if (s_text[0]) {
    // show the end of long text
    const char *shown = s_text;
    while (*shown && graphics_text_layout_get_content_size(shown, tf, GRect(0, 0, 1000, 40),
           GTextOverflowModeFill, GTextAlignmentLeft).w > tr.size.w - 6) shown++;
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, shown, tf, tr, GTextOverflowModeFill, GTextAlignmentLeft, NULL);
    GSize ts = graphics_text_layout_get_content_size(shown, tf, tr, GTextOverflowModeFill, GTextAlignmentLeft);
    graphics_context_set_fill_color(ctx, C_BLUE);
    graphics_fill_rect(ctx, GRect(tr.origin.x + ts.w + 1, ir.origin.y + 7, 2, ir.size.h - 14), 0, GCornerNone);
  } else {
    graphics_context_set_text_color(ctx, GColorDarkGray);
    graphics_draw_text(ctx, s_placeholder, fonts_get_system_font(FONT_KEY_GOTHIC_18), GRect(tr.origin.x, tr.origin.y + 4, tr.size.w, tr.size.h),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  }

  // keys
  GRect kr = keys_rect(b);
  GFont kf = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  char label[2] = { 0, 0 };
  for (int row = 0; row < 3; row++) {
    const char *c = row_chars(row);
    int n = strlen(c);
    for (int i = 0; i < n; i++) {
      label[0] = c[i];
      if (s_shift && !s_symbols && label[0] >= 'a' && label[0] <= 'z') label[0] -= 'a' - 'A';
      GRect r = row < 2 ? key_rect(kr, row, i, 1, n) : key_rect(kr, 2, i + 2, 1, 11);
      draw_key(ctx, r, label, GColorWhite, GColorBlack, kf);
    }
  }
  GColor sp = GColorLightGray;
  GRect shift = key_rect(kr, 2, 0, 2, 11);
  draw_key(ctx, shift, "", s_shift ? GColorWhite : sp, GColorBlack, g_fonts.small_b);
  icon_draw(ctx, ICON_UP, grect_center_point(&shift), 16, s_shift ? C_BLUE : GColorBlack, GColorWhite);
  draw_key(ctx, key_rect(kr, 2, 9, 2, 11), "del", sp, GColorBlack, g_fonts.small_b);
  draw_key(ctx, key_rect(kr, 3, 0, 2, 10), s_symbols ? "ABC" : "123", sp, GColorBlack, g_fonts.small_b);
  draw_key(ctx, key_rect(kr, 3, 2, 5, 10), "space", GColorWhite, GColorBlack, g_fonts.small_b);
  draw_key(ctx, key_rect(kr, 3, 7, 3, 10), s_action, s_text[0] ? C_BLUE : sp, s_text[0] ? GColorWhite : GColorDarkGray, g_fonts.small_b);
}

// --- Typing ---------------------------------------------------------------------------
static void finish(void) {
  if (!s_text[0]) return;
  char text[KB_MAX_TEXT];
  strncpy(text, s_text, sizeof(text));
  KeyboardDone done = s_done;
  void *ctx = s_ctx;
  window_stack_remove(s_window, false);
  if (done) done(text, ctx);
}

static void type_key(char code) {
  size_t n = strlen(s_text);
  switch (code) {
    case '^': s_shift = !s_shift; break;
    case 'm': s_symbols = !s_symbols; s_shift = false; break;
    case 'b': if (n) s_text[n - 1] = 0; break;
    case '>': finish(); return;
    default:
      if (n + 1 >= KB_MAX_TEXT) break;
      if (code == ' ' && (n == 0 || s_text[n - 1] == ' ')) break;
      if (s_shift && !s_symbols && code >= 'a' && code <= 'z') code -= 'a' - 'A';
      s_text[n] = code;
      s_text[n + 1] = 0;
      s_shift = false;
      break;
  }
  layer_mark_dirty(s_layer);
}

static void touch_cb(const TouchEvent *e, void *ctx) {
  GRect b = layer_get_bounds(s_layer);
  GRect kr = keys_rect(b), r;
  char code = key_at(kr, GPoint(e->x, e->y), &r);
  if (e->type == TouchEvent_Liftoff) {
    s_has_press = false;
    if (code) type_key(code);
    else layer_mark_dirty(s_layer);
  } else {
    // finger down or sliding: highlight the key it is on
    s_has_press = code != 0;
    if (code) s_pressed = r;
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
}

static void window_disappear(Window *w) {
  touch_service_unsubscribe();
  app_touch_navigation_enable(true);
}

static void window_unload(Window *w) {
  layer_destroy(s_layer);
  window_destroy(s_window);
  s_window = NULL;
}

void keyboard_window_push(const char *placeholder, const char *action_label, KeyboardDone done, void *ctx) {
  if (s_window) return;
  s_text[0] = 0;
  s_shift = true;        // capitalize the first letter
  s_symbols = false;
  s_has_press = false;
  s_placeholder = placeholder;
  s_action = action_label;
  s_done = done;
  s_ctx = ctx;
  s_window = window_create();
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load, .appear = window_appear,
    .disappear = window_disappear, .unload = window_unload,
  });
  window_stack_push(s_window, true);
}

#else
void keyboard_window_push(const char *placeholder, const char *action_label, KeyboardDone done, void *ctx) {}
#endif
