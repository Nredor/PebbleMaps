// Pebble Maps - receives Google Static Maps images (converted by the phone)
#include "mapdata.h"
#include "comm.h"
#include "ui.h"

MapData g_map;
static int s_next_seq = 1;

void map_release(void) {
  if (g_map.bmp) {
    gbitmap_destroy(g_map.bmp);
    g_map.bmp = NULL;
  }
  g_map.complete = false;
  g_map.got = g_map.total = 0;
}

void map_set_observer(Layer *layer) {
  g_map.observer = layer;
}

static void notify(void) {
  if (g_map.observer) layer_mark_dirty(g_map.observer);
}

int map_request(int cmd, int w, int h, int idx, int mode) {
  map_release();
  g_map.n_markers = 0;
  g_map.seq = s_next_seq++;
  if (s_next_seq > 30000) s_next_seq = 1;
  OutMsg m;
  comm_msg_init(&m, cmd);
  m.seq = g_map.seq;
  m.width = w;
  m.height = h;
  m.idx = idx;
  m.mode = mode;
  comm_send(&m);
  notify();
  return g_map.seq;
}

void map_handle(int cmd, DictionaryIterator *it) {
  int seq = tuple_int(it, MESSAGE_KEY_seq, -1);
  if (seq != g_map.seq) return;  // stale
  if (cmd == CMD_MAP_BEGIN) {
    map_release();
    int w = tuple_int(it, MESSAGE_KEY_width, 0);
    int h = tuple_int(it, MESSAGE_KEY_height, 0);
    int fmt = tuple_int(it, MESSAGE_KEY_fmt, FMT_4BIT);
    if (w <= 0 || h <= 0) return;
#ifdef PBL_COLOR
    if (fmt == FMT_4BIT) {
      GColor *pal = malloc(16 * sizeof(GColor));
      if (!pal) return;
      memset(pal, 0xFF, 16 * sizeof(GColor));
      const Tuple *pt = dict_find(it, MESSAGE_KEY_palette);
      if (pt) {
        int n = pt->length > 16 ? 16 : pt->length;
        for (int i = 0; i < n; i++) pal[i].argb = pt->value->data[i];
      }
      g_map.bmp = gbitmap_create_blank_with_palette(GSize(w, h), GBitmapFormat4BitPalette, pal, true);
      if (!g_map.bmp) free(pal);
    } else {
      g_map.bmp = gbitmap_create_blank(GSize(w, h), GBitmapFormat1Bit);
    }
#else
    (void)fmt;
    g_map.bmp = gbitmap_create_blank(GSize(w, h), GBitmapFormat1Bit);
#endif
    if (!g_map.bmp) {
      APP_LOG(APP_LOG_LEVEL_ERROR, "map alloc failed %dx%d", w, h);
      return;
    }
    g_map.w = w;
    g_map.h = h;
    g_map.stride = tuple_int(it, MESSAGE_KEY_stride, gbitmap_get_bytes_per_row(g_map.bmp));
    g_map.total = tuple_int(it, MESSAGE_KEY_total, 0);
    g_map.got = 0;
    g_map.complete = false;
  } else if (cmd == CMD_MAP_CHUNK) {
    if (!g_map.bmp) return;
    const Tuple *dt = dict_find(it, MESSAGE_KEY_data);
    if (!dt) return;
    int off = tuple_int(it, MESSAGE_KEY_offset, 0);
    int bpr = gbitmap_get_bytes_per_row(g_map.bmp);
    uint8_t *dst = gbitmap_get_data(g_map.bmp);
    int stride = g_map.stride > 0 ? g_map.stride : bpr;
    int copy = stride < bpr ? stride : bpr;
    const uint8_t *src = dt->value->data;
    int len = dt->length;
    int row = off / stride;
    for (int p = 0; p + stride <= len && row < g_map.h; p += stride, row++) {
      memcpy(dst + row * bpr, src + p, copy);
    }
    g_map.got += len;
    if (g_map.got >= g_map.total) g_map.complete = true;
    notify();
  } else if (cmd == CMD_MARKERS) {
    const Tuple *dt = dict_find(it, MESSAGE_KEY_data);
    g_map.n_markers = 0;
    if (dt) {
      int n = dt->length / 6;
      if (n > MAX_MARKERS) n = MAX_MARKERS;
      const uint8_t *d = dt->value->data;
      for (int i = 0; i < n; i++) {
        Marker *mk = &g_map.markers[i];
        mk->x = (int16_t)(d[i * 6] | (d[i * 6 + 1] << 8));
        mk->y = (int16_t)(d[i * 6 + 2] | (d[i * 6 + 3] << 8));
        mk->kind = d[i * 6 + 4];
        mk->index = d[i * 6 + 5];
      }
      g_map.n_markers = n;
    }
    notify();
  }
}

const Marker *map_marker_for(int index) {
  for (int i = 0; i < g_map.n_markers; i++) {
    if (g_map.markers[i].kind == MK_PIN && g_map.markers[i].index == index) return &g_map.markers[i];
  }
  return NULL;
}

int map_pin_near(GPoint p, GRect frame, int max_dist) {
  int best = -1, best_d = max_dist * max_dist;
  for (int i = 0; i < g_map.n_markers; i++) {
    const Marker *mk = &g_map.markers[i];
    if (mk->kind != MK_PIN) continue;
    int dx = frame.origin.x + mk->x - p.x;
    int dy = frame.origin.y + mk->y - 10 - p.y;  // pin body sits above the tip
    int d = dx * dx + dy * dy;
    if (d < best_d) {
      best_d = d;
      best = mk->index;
    }
  }
  return best;
}

void map_draw(GContext *ctx, GRect frame, int selected) {
  if (g_map.bmp) {
    GRect r = GRect(frame.origin.x + (frame.size.w - g_map.w) / 2,
                    frame.origin.y + (frame.size.h - g_map.h) / 2, g_map.w, g_map.h);
    graphics_context_set_compositing_mode(ctx, GCompOpAssign);
    graphics_draw_bitmap_in_rect(ctx, g_map.bmp, r);
    // rows not yet received: keep placeholder look
    if (!g_map.complete && g_map.stride > 0) {
      int rows = g_map.got / g_map.stride;
      if (rows < g_map.h) {
        draw_map_placeholder(ctx, GRect(r.origin.x, r.origin.y + rows, r.size.w, r.size.h - rows));
      }
    }
  } else {
    draw_map_placeholder(ctx, frame);
  }
  // markers: start/dest/me first, then pins, selected pin last (on top)
  for (int pass = 0; pass < 3; pass++) {
    for (int i = 0; i < g_map.n_markers; i++) {
      const Marker *mk = &g_map.markers[i];
      GPoint p = GPoint(frame.origin.x + mk->x, frame.origin.y + mk->y);
      bool is_sel = mk->kind == MK_PIN && mk->index == selected;
      if (pass == 0 && (mk->kind == MK_START || mk->kind == MK_ME)) {
        if (mk->kind == MK_ME) draw_me_dot(ctx, p, 5);
        else {
          graphics_context_set_fill_color(ctx, GColorWhite);
          graphics_fill_circle(ctx, p, 6);
          graphics_context_set_stroke_color(ctx, GColorBlack);
          graphics_context_set_stroke_width(ctx, 2);
          graphics_draw_circle(ctx, p, 5);
          graphics_context_set_stroke_width(ctx, 1);
        }
      } else if (pass == 1 && ((mk->kind == MK_PIN && !is_sel) || mk->kind == MK_DEST)) {
        draw_pin(ctx, p, mk->kind == MK_DEST ? 7 : 5, mk->kind == MK_DEST);
      } else if (pass == 2 && is_sel) {
        draw_pin(ctx, p, 6, true);
      }
    }
  }
}
