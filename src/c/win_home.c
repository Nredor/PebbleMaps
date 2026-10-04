// Pebble Maps - home screen: your location on a Google map, search bar, actions
#include "windows.h"
#include "comm.h"
#include "mapdata.h"

static Window *s_window;
static Layer *s_canvas;
static Layer *s_dots;
static DictationSession *s_dictation;
static int s_zoom = 15;
static bool s_map_requested;
static bool s_hello_sent;
static AppTimer *s_hello_timer;
static int s_hello_tries;
static char s_status[64] = "Connecting to phone";

Window *home_window_get(void) { return s_window; }

void pop_to_home(void) {
  while (window_stack_get_top_window() && window_stack_get_top_window() != s_window) {
    window_stack_pop(false);
  }
}

static GRect map_frame(GRect b) {
  return GRect(0, 0, b.size.w - STRIP_W, b.size.h);
}

static void send_hello(void) {
  Layer *root = window_get_root_layer(s_window);
  GRect b = layer_get_bounds(root);
  OutMsg m;
  comm_msg_init(&m, CMD_HELLO);
  m.width = b.size.w;
  m.height = b.size.h;
  m.num = PBL_IF_COLOR_ELSE(FMT_4BIT, FMT_1BIT);
  m.mode = (g_app.has_mic ? 1 : 0) | (PBL_IF_ROUND_ELSE(1, 0) << 1) | (g_app.touch ? 4 : 0);
  m.idx = g_app.inbox_size;
  comm_send(&m);
  s_hello_sent = true;
}

static void request_map(void) {
  GRect f = map_frame(layer_get_bounds(window_get_root_layer(s_window)));
  map_request(CMD_HOME_MAP, f.size.w, f.size.h, s_zoom, -1);
  s_map_requested = true;
  strncpy(s_status, "Finding you", sizeof(s_status));
  dots_layer_set_running(s_dots, true);
}

static void hello_timer_cb(void *ctx) {
  s_hello_timer = NULL;
  if (g_app.status_known) return;
  if (++s_hello_tries < 10) {
    send_hello();
    s_hello_timer = app_timer_register(2500, hello_timer_cb, NULL);
  } else {
    strncpy(s_status, "Can't reach your phone", sizeof(s_status));
    dots_layer_set_running(s_dots, false);
    layer_mark_dirty(s_canvas);
  }
}

static void show_setup(void) {
  msg_window_push(ICON_KEY, "Almost ready!",
                  "Pebble Maps needs a free Google Maps key.\n\n"
                  "On your phone, open the Pebble app, find Pebble Maps and tap Settings. "
                  "The settings page walks you through it step by step.",
                  true);
}

static void handle(int cmd, DictionaryIterator *it, void *ctx) {
  switch (cmd) {
    case CMD_STATUS:
      if (!s_hello_sent || !s_map_requested) send_hello();
      if (!g_app.configured) {
        dots_layer_set_running(s_dots, false);
        strncpy(s_status, "Setup needed", sizeof(s_status));
        layer_mark_dirty(s_canvas);
        show_setup();
      } else if (!s_map_requested || !g_map.bmp) {
        request_map();
      }
      break;
    case CMD_MAP_BEGIN:
      break;
    case CMD_BUSY:
      strncpy(s_status, tuple_str(it, MESSAGE_KEY_text), sizeof(s_status) - 1);
      dots_layer_set_running(s_dots, true);
      layer_mark_dirty(s_canvas);
      break;
    case CMD_TOAST:
      ui_toast(s_window, tuple_str(it, MESSAGE_KEY_text));
      dots_layer_set_running(s_dots, false);
      break;
    case CMD_ERROR:
      dots_layer_set_running(s_dots, false);
      s_status[0] = 0;
      layer_mark_dirty(s_canvas);
      if (tuple_int(it, MESSAGE_KEY_num, 0) == ERR_NO_KEY) show_setup();
      else show_error(it);
      break;
  }
}

static void canvas_update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  GRect mf = map_frame(b);
  map_draw(ctx, mf, -1);
  if (g_map.complete || g_map.n_markers) dots_layer_set_running(s_dots, false);

  // Search pill (Google style)
#ifdef PBL_ROUND
  // fit the pill inside the circle at its height
  int rad = b.size.w / 2;
  int py = b.size.h / 9;
  int dy = rad - py;
  int half = 0;
  while ((half + 1) * (half + 1) + dy * dy <= rad * rad) half++;
  half -= 10;
  GRect pill = GRect(rad - half, py, half * 2, 26);
#else
  GRect pill = GRect(6, 6, mf.size.w - 12, 26);
#endif
#ifdef PBL_COLOR
  graphics_context_set_fill_color(ctx, GColorLightGray);
  graphics_fill_rect(ctx, GRect(pill.origin.x + 1, pill.origin.y + 2, pill.size.w, pill.size.h), 13, GCornersAll);
#endif
  draw_card(ctx, pill, 13);
  icon_draw(ctx, ICON_SEARCH, GPoint(pill.origin.x + 14, pill.origin.y + 13), 14, C_SUBTEXT, C_BG);
  graphics_context_set_text_color(ctx, C_SUBTEXT);
  graphics_draw_text(ctx, g_app.has_mic ? PBL_IF_ROUND_ELSE("Search", "Search here") : "Explore", g_fonts.body,
                     GRect(pill.origin.x + 25, pill.origin.y + 1, pill.size.w - 30, 22),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);

  // Status bubble
  if (s_status[0] && !g_map.complete) {
    GRect sb = GRect(6, mf.size.h - PBL_IF_ROUND_ELSE(64, 52), mf.size.w - 12, 24);
#ifdef PBL_ROUND
    sb.origin.x += 14;
    sb.size.w -= 28;
#endif
    draw_card(ctx, sb, 6);
    graphics_context_set_text_color(ctx, C_TEXT);
    graphics_draw_text(ctx, s_status, g_fonts.small_b, GRect(sb.origin.x + 2, sb.origin.y + 3, sb.size.w - 4, 18),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }

  StripIcons ic = { .up = ICON_STAR, .select = g_app.has_mic ? ICON_MIC : ICON_SEARCH,
                    .down = ICON_EXPLORE, .select_color = C_BLUE };
  draw_action_strip(ctx, b, &ic);
}

// --- Dictation -------------------------------------------------------------
static void dictation_cb(DictationSession *session, DictationSessionStatus status,
                         char *transcription, void *ctx) {
  if (status == DictationSessionStatusSuccess && transcription && transcription[0]) {
    results_window_push_search(transcription);
  } else if (status == DictationSessionStatusFailureNoSpeechDetected ||
             status == DictationSessionStatusFailureTranscriptionRejected ||
             status == DictationSessionStatusFailureTranscriptionRejectedWithError) {
    // user cancelled or said nothing; stay quiet
  } else {
    msg_window_push(ICON_MIC, "Voice unavailable",
                    "Dictation didn't work. Make sure your phone is connected, "
                    "or browse with Explore (the bottom button).", false);
  }
}

static void start_search(void) {
  if (!g_app.configured) { show_setup(); return; }
#if defined(PBL_MICROPHONE)
  if (!s_dictation) s_dictation = dictation_session_create(160, dictation_cb, NULL);
  if (s_dictation) {
    dictation_session_enable_confirmation(s_dictation, true);
    dictation_session_start(s_dictation);
    return;
  }
#endif
  list_window_push(LW_CATEGORIES, 0);
}

// --- Buttons ---------------------------------------------------------------
static void up_click(ClickRecognizerRef r, void *ctx) {
  if (!g_app.configured) { show_setup(); return; }
  list_window_push(LW_FAVS, 0);
}
static void select_click(ClickRecognizerRef r, void *ctx) { start_search(); }
static void down_click(ClickRecognizerRef r, void *ctx) {
  if (!g_app.configured) { show_setup(); return; }
  list_window_push(LW_CATEGORIES, 0);
}
static void zoom(int d) {
  if (!g_app.configured) return;
  s_zoom = clampi(s_zoom + d, 3, 20);
  request_map();
  ui_toast(s_window, d > 0 ? "Zoom in" : "Zoom out");
}
static void up_long(ClickRecognizerRef r, void *ctx) { zoom(1); }
static void down_long(ClickRecognizerRef r, void *ctx) { zoom(-1); }
static void select_long(ClickRecognizerRef r, void *ctx) {
  if (!g_app.configured) { show_setup(); return; }
  request_map();
}

static void click_config(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
  window_long_click_subscribe(BUTTON_ID_UP, 500, up_long, NULL);
  window_long_click_subscribe(BUTTON_ID_DOWN, 500, down_long, NULL);
  window_long_click_subscribe(BUTTON_ID_SELECT, 600, select_long, NULL);
}

// --- Touch (Pebble Time 2) -------------------------------------------------
static void touch_cb(const TouchEvent *e, void *ctx) {
  if (e->type != TouchEvent_Liftoff) return;
  GRect b = layer_get_bounds(window_get_root_layer(s_window));
  if (e->x >= b.size.w - STRIP_W) {
    if (e->y < b.size.h / 3) up_click(NULL, NULL);
    else if (e->y > b.size.h * 2 / 3) down_click(NULL, NULL);
    else select_click(NULL, NULL);
  } else if (e->y < 40) {
    select_click(NULL, NULL);
  }
}

// --- Lifecycle -------------------------------------------------------------
static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  s_canvas = layer_create(b);
  layer_set_update_proc(s_canvas, canvas_update);
  layer_add_child(root, s_canvas);
  GRect mf = map_frame(b);
  s_dots = dots_layer_create(GRect(0, mf.size.h / 2 - 20, mf.size.w, 40));
  layer_add_child(root, s_dots);
  dots_layer_set_running(s_dots, true);
}

static void window_appear(Window *window) {
  comm_set_handler(handle, NULL);
  map_set_observer(s_canvas);
  if (g_app.touch) touch_service_subscribe(touch_cb, NULL);
  if (g_app.status_known && g_app.configured) {
    request_map();
  } else if (!s_hello_timer && !g_app.status_known) {
    send_hello();
    s_hello_timer = app_timer_register(2500, hello_timer_cb, NULL);
  }
}

static void window_disappear(Window *window) {
  comm_clear_handler(handle);
  map_set_observer(NULL);
  ui_toast_cancel();
  if (g_app.touch) touch_service_unsubscribe();
}

static void window_unload(Window *window) {
  dots_layer_destroy(s_dots);
  layer_destroy(s_canvas);
  if (s_dictation) dictation_session_destroy(s_dictation);
  s_dictation = NULL;
}

void home_window_push(void) {
  s_window = window_create();
  window_set_background_color(s_window, C_MAPBG);
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load, .appear = window_appear,
    .disappear = window_disappear, .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
