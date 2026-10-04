// Pebble Maps - drawing toolkit
#include "ui.h"

Fonts g_fonts;

void ui_init(void) {
  g_fonts.small = fonts_get_system_font(FONT_KEY_GOTHIC_14);
  g_fonts.small_b = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  g_fonts.body = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  g_fonts.body_b = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  g_fonts.title = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  g_fonts.big = fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD);
  g_fonts.roboto = fonts_get_system_font(FONT_KEY_ROBOTO_CONDENSED_21);
}

// ---------------------------------------------------------------------------
// Geometry helpers. Icons are designed on a 40x40 grid.
// ---------------------------------------------------------------------------
static GPoint s_c;
static int s_sz;

static inline GPoint P(int x, int y) {
  return GPoint(s_c.x + (x - 20) * s_sz / 40, s_c.y + (y - 20) * s_sz / 40);
}
static inline int S(int v) {
  int r = v * s_sz / 40;
  return r < 1 ? 1 : r;
}

static void line(GContext *ctx, int x1, int y1, int x2, int y2) {
  graphics_draw_line(ctx, P(x1, y1), P(x2, y2));
}

static void poly(GContext *ctx, const int8_t *xy, int n, bool fill) {
  GPoint pts[12];
  if (n > 12) n = 12;
  for (int i = 0; i < n; i++) pts[i] = P(xy[2 * i], xy[2 * i + 1]);
  GPath path = { .num_points = n, .points = pts, .rotation = 0, .offset = GPointZero };
  if (fill) gpath_draw_filled(ctx, &path);
  else gpath_draw_outline(ctx, &path);
}

static void circle(GContext *ctx, int x, int y, int r, bool fill) {
  if (fill) graphics_fill_circle(ctx, P(x, y), S(r));
  else graphics_draw_circle(ctx, P(x, y), S(r));
}

static void rect(GContext *ctx, int x1, int y1, int x2, int y2, int radius) {
  GPoint a = P(x1, y1), b = P(x2, y2);
  graphics_fill_rect(ctx, GRect(a.x, a.y, b.x - a.x, b.y - a.y), radius ? S(radius) : 0,
                     GCornersAll);
}

static void text_glyph(GContext *ctx, const char *t, GColor fg) {
  GFont f = s_sz >= 28 ? g_fonts.big : (s_sz >= 20 ? g_fonts.title : g_fonts.body_b);
  int h = s_sz >= 28 ? 28 : (s_sz >= 20 ? 24 : 18);
  graphics_context_set_text_color(ctx, fg);
  graphics_draw_text(ctx, t, f, GRect(s_c.x - s_sz / 2 - 4, s_c.y - h / 2 - h / 5, s_sz + 8, h + 4),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
}

static int isqrt(int v) {
  if (v <= 0) return 0;
  int r = v, last;
  do { last = r; r = (r + v / r) / 2; } while (r < last);
  return last;
}

IconId icon_for_mode(int mode) {
  switch (mode) {
    case MODE_WALK: return ICON_WALK;
    case MODE_BIKE: return ICON_BIKE;
    case MODE_TRANSIT: return ICON_BUS;
    default: return ICON_CAR;
  }
}

static const int8_t STAR_PTS[] = {20, 2, 25, 15, 38, 15, 27, 23, 31, 36, 20, 28, 9, 36, 13, 23, 2, 15, 15, 15};

void icon_draw(GContext *ctx, IconId id, GPoint c, int size, GColor fg, GColor bg) {
  s_c = c;
  s_sz = size;
  int sw = size / 10;
  if (sw < 1) sw = 1;
#ifdef PBL_COLOR
  graphics_context_set_antialiased(ctx, true);
#endif
  graphics_context_set_fill_color(ctx, fg);
  graphics_context_set_stroke_color(ctx, fg);
  graphics_context_set_stroke_width(ctx, sw);

  switch (id) {
    case ICON_MIC: {
      rect(ctx, 14, 3, 26, 25, 6);
      graphics_draw_arc(ctx, GRect(P(9, 8).x, P(9, 8).y, S(22), S(22)), GOvalScaleModeFitCircle,
                        DEG_TO_TRIGANGLE(90), DEG_TO_TRIGANGLE(270));
      line(ctx, 20, 30, 20, 36);
      line(ctx, 13, 37, 27, 37);
      break;
    }
    case ICON_STAR:
      poly(ctx, STAR_PTS, 10, true);
      break;
    case ICON_STAR_OUTLINE:
      graphics_context_set_stroke_width(ctx, sw > 1 ? sw - 1 : 1);
      poly(ctx, STAR_PTS, 10, false);
      break;
    case ICON_EXPLORE: {
      graphics_context_set_stroke_width(ctx, sw);
      circle(ctx, 20, 20, 17, false);
      static const int8_t needle[] = {27, 13, 23, 23, 13, 27, 17, 17};
      poly(ctx, needle, 4, true);
      graphics_context_set_fill_color(ctx, bg);
      circle(ctx, 20, 20, 2, true);
      break;
    }
    case ICON_DIRECTIONS: {
      static const int8_t dia[] = {20, 1, 39, 20, 20, 39, 1, 20};
      poly(ctx, dia, 4, true);
      graphics_context_set_stroke_color(ctx, bg);
      graphics_context_set_fill_color(ctx, bg);
      graphics_context_set_stroke_width(ctx, sw + 1);
      line(ctx, 14, 28, 14, 20);
      line(ctx, 14, 20, 24, 20);
      static const int8_t head[] = {23, 14, 30, 20, 23, 26};
      poly(ctx, head, 3, true);
      break;
    }
    case ICON_LIST:
      graphics_context_set_stroke_width(ctx, sw);
      for (int i = 0; i < 3; i++) {
        circle(ctx, 7, 10 + i * 10, 2, true);
        line(ctx, 14, 10 + i * 10, 35, 10 + i * 10);
      }
      break;
    case ICON_NAV: {
      static const int8_t arrow[] = {20, 3, 34, 36, 20, 28, 6, 36};
      poly(ctx, arrow, 4, true);
      break;
    }
    case ICON_PIN: {
      static const int8_t tri[] = {9, 19, 31, 19, 20, 38};
      circle(ctx, 20, 14, 12, true);
      poly(ctx, tri, 3, true);
      graphics_context_set_fill_color(ctx, bg);
      circle(ctx, 20, 14, 4, true);
      break;
    }
    case ICON_CLOCK:
      circle(ctx, 20, 20, 16, false);
      line(ctx, 20, 20, 20, 10);
      line(ctx, 20, 20, 27, 24);
      break;
    case ICON_MYLOC:
      circle(ctx, 20, 20, 12, false);
      circle(ctx, 20, 20, 5, true);
      line(ctx, 20, 2, 20, 8);
      line(ctx, 20, 32, 20, 38);
      line(ctx, 2, 20, 8, 20);
      line(ctx, 32, 20, 38, 20);
      break;
    case ICON_FLAG: {
      line(ctx, 10, 4, 10, 38);
      static const int8_t flag[] = {10, 5, 33, 5, 27, 12, 33, 20, 10, 20};
      poly(ctx, flag, 5, true);
      break;
    }
    case ICON_SEARCH:
      graphics_context_set_stroke_width(ctx, sw + 1);
      circle(ctx, 17, 17, 11, false);
      line(ctx, 25, 25, 35, 35);
      break;
    case ICON_PLUS:
      graphics_context_set_stroke_width(ctx, sw + 1);
      line(ctx, 20, 6, 20, 34);
      line(ctx, 6, 20, 34, 20);
      break;
    case ICON_CAR: {
      static const int8_t roof[] = {11, 8, 29, 8, 33, 19, 7, 19};
      poly(ctx, roof, 4, true);
      rect(ctx, 4, 18, 36, 31, 3);
      rect(ctx, 7, 30, 13, 36, 1);
      rect(ctx, 27, 30, 33, 36, 1);
      graphics_context_set_fill_color(ctx, bg);
      static const int8_t win[] = {13, 11, 27, 11, 29, 18, 11, 18};
      poly(ctx, win, 4, true);
      circle(ctx, 10, 24, 2, true);
      circle(ctx, 30, 24, 2, true);
      break;
    }
    case ICON_WALK:
      circle(ctx, 22, 6, 4, true);
      graphics_context_set_stroke_width(ctx, sw + 1);
      line(ctx, 21, 12, 17, 24);
      line(ctx, 17, 24, 11, 36);
      line(ctx, 17, 24, 23, 29);
      line(ctx, 23, 29, 25, 37);
      graphics_context_set_stroke_width(ctx, sw);
      line(ctx, 20, 14, 13, 20);
      line(ctx, 20, 14, 27, 21);
      break;
    case ICON_BIKE:
      graphics_context_set_stroke_width(ctx, sw);
      circle(ctx, 9, 27, 7, false);
      circle(ctx, 31, 27, 7, false);
      line(ctx, 9, 27, 17, 16);
      line(ctx, 17, 16, 28, 16);
      line(ctx, 28, 16, 31, 27);
      line(ctx, 17, 16, 21, 27);
      line(ctx, 21, 27, 9, 27);
      line(ctx, 15, 11, 21, 11);
      line(ctx, 28, 16, 26, 9);
      line(ctx, 24, 9, 30, 9);
      break;
    case ICON_BUS:
      rect(ctx, 7, 3, 33, 32, 5);
      rect(ctx, 9, 31, 15, 37, 1);
      rect(ctx, 25, 31, 31, 37, 1);
      graphics_context_set_fill_color(ctx, bg);
      rect(ctx, 10, 8, 30, 19, 1);
      circle(ctx, 13, 26, 2, true);
      circle(ctx, 27, 26, 2, true);
      break;
    case ICON_TRAIN:
      rect(ctx, 9, 3, 31, 30, 7);
      line(ctx, 14, 30, 9, 38);
      line(ctx, 26, 30, 31, 38);
      graphics_context_set_fill_color(ctx, bg);
      rect(ctx, 12, 8, 28, 17, 1);
      circle(ctx, 14, 24, 2, true);
      circle(ctx, 26, 24, 2, true);
      break;
    case ICON_FERRY: {
      static const int8_t hull[] = {3, 24, 37, 24, 31, 33, 9, 33};
      poly(ctx, hull, 4, true);
      rect(ctx, 11, 12, 29, 24, 2);
      rect(ctx, 17, 6, 23, 12, 0);
      graphics_context_set_fill_color(ctx, bg);
      rect(ctx, 14, 15, 18, 19, 0);
      rect(ctx, 22, 15, 26, 19, 0);
      break;
    }
    case ICON_WARNING: {
      static const int8_t tri[] = {20, 3, 38, 36, 2, 36};
      poly(ctx, tri, 3, true);
      graphics_context_set_stroke_color(ctx, bg);
      graphics_context_set_fill_color(ctx, bg);
      graphics_context_set_stroke_width(ctx, sw + 1);
      line(ctx, 20, 14, 20, 25);
      circle(ctx, 20, 31, 2, true);
      break;
    }
    case ICON_PHONE:
      rect(ctx, 11, 2, 29, 38, 4);
      graphics_context_set_fill_color(ctx, bg);
      rect(ctx, 14, 7, 26, 30, 0);
      circle(ctx, 20, 34, 2, true);
      break;
    case ICON_COFFEE:
      rect(ctx, 7, 14, 27, 35, 4);
      graphics_context_set_stroke_width(ctx, sw + 1);
      circle(ctx, 29, 22, 5, false);
      graphics_context_set_stroke_width(ctx, sw);
      line(ctx, 12, 4, 12, 10);
      line(ctx, 17, 3, 17, 10);
      line(ctx, 22, 4, 22, 10);
      break;
    case ICON_FOOD: {
      graphics_context_set_stroke_width(ctx, sw + 1);
      line(ctx, 13, 4, 13, 37);
      graphics_context_set_stroke_width(ctx, sw);
      line(ctx, 8, 4, 8, 14);
      line(ctx, 18, 4, 18, 14);
      line(ctx, 8, 14, 18, 14);
      static const int8_t blade[] = {26, 3, 32, 7, 32, 22, 26, 22};
      poly(ctx, blade, 4, true);
      graphics_context_set_stroke_width(ctx, sw + 1);
      line(ctx, 27, 22, 27, 37);
      break;
    }
    case ICON_GAS:
      rect(ctx, 7, 5, 24, 37, 2);
      graphics_context_set_stroke_width(ctx, sw + 1);
      line(ctx, 24, 13, 31, 18);
      line(ctx, 31, 18, 31, 31);
      line(ctx, 31, 31, 35, 31);
      graphics_context_set_fill_color(ctx, bg);
      rect(ctx, 10, 9, 21, 17, 0);
      break;
    case ICON_CART: {
      graphics_context_set_stroke_width(ctx, sw + 1);
      line(ctx, 3, 7, 9, 7);
      line(ctx, 9, 7, 13, 27);
      line(ctx, 13, 27, 33, 27);
      static const int8_t basket[] = {10, 11, 37, 11, 33, 23, 12, 23};
      poly(ctx, basket, 4, true);
      circle(ctx, 15, 33, 3, true);
      circle(ctx, 30, 33, 3, true);
      break;
    }
    case ICON_TREE:
      circle(ctx, 20, 15, 13, true);
      rect(ctx, 17, 24, 23, 38, 0);
      break;
    case ICON_BED:
      rect(ctx, 3, 19, 37, 29, 1);
      rect(ctx, 3, 7, 8, 35, 1);
      rect(ctx, 32, 28, 37, 35, 0);
      rect(ctx, 10, 12, 18, 18, 2);
      break;
    case ICON_ATM:
      text_glyph(ctx, "$", fg);
      break;
    case ICON_PARKING:
      text_glyph(ctx, "P", fg);
      break;
    case ICON_PHARMACY:
      rect(ctx, 15, 4, 25, 36, 1);
      rect(ctx, 4, 15, 36, 25, 1);
      break;
    case ICON_PLUG: {
      static const int8_t bolt[] = {23, 2, 9, 22, 19, 22, 15, 38, 31, 16, 21, 16, 25, 2};
      poly(ctx, bolt, 7, true);
      break;
    }
    case ICON_BOOK: {
      static const int8_t l[] = {3, 7, 19, 10, 19, 35, 3, 32};
      static const int8_t r[] = {21, 10, 37, 7, 37, 32, 21, 35};
      poly(ctx, l, 4, true);
      poly(ctx, r, 4, true);
      break;
    }
    case ICON_MUTE:
    case ICON_SOUND: {
      static const int8_t spk[] = {4, 14, 12, 14, 22, 5, 22, 35, 12, 26, 4, 26};
      poly(ctx, spk, 6, true);
      if (id == ICON_MUTE) {
        line(ctx, 27, 14, 37, 26);
        line(ctx, 37, 14, 27, 26);
      } else {
        graphics_draw_arc(ctx, GRect(P(14, 10).x, P(14, 10).y, S(20), S(20)),
                          GOvalScaleModeFitCircle, DEG_TO_TRIGANGLE(45), DEG_TO_TRIGANGLE(135));
        graphics_draw_arc(ctx, GRect(P(8, 4).x, P(8, 4).y, S(32), S(32)),
                          GOvalScaleModeFitCircle, DEG_TO_TRIGANGLE(45), DEG_TO_TRIGANGLE(135));
      }
      break;
    }
    case ICON_CLOSE:
      graphics_context_set_stroke_width(ctx, sw + 1);
      line(ctx, 8, 8, 32, 32);
      line(ctx, 32, 8, 8, 32);
      break;
    case ICON_ZOOM_IN:
    case ICON_ZOOM_OUT:
      graphics_context_set_stroke_width(ctx, sw + 1);
      line(ctx, 8, 20, 32, 20);
      if (id == ICON_ZOOM_IN) line(ctx, 20, 8, 20, 32);
      break;
    case ICON_MAP: {
      static const int8_t a[] = {3, 8, 14, 4, 14, 32, 3, 36};
      static const int8_t b[] = {16, 4, 24, 8, 24, 36, 16, 32};
      static const int8_t c2[] = {26, 8, 37, 4, 37, 32, 26, 36};
      poly(ctx, a, 4, true);
      poly(ctx, b, 4, true);
      poly(ctx, c2, 4, true);
      break;
    }
    case ICON_KEY:
      graphics_context_set_stroke_width(ctx, sw + 1);
      circle(ctx, 12, 20, 8, false);
      line(ctx, 20, 20, 37, 20);
      line(ctx, 31, 20, 31, 27);
      line(ctx, 36, 20, 36, 26);
      break;
    default:
      break;
  }
  graphics_context_set_stroke_width(ctx, 1);
}

// ---------------------------------------------------------------------------
// Maneuver arrows: thick polyline + arrow head. Designed for right turns,
// mirrored for left.
// ---------------------------------------------------------------------------
typedef struct {
  int8_t n;
  int8_t pts[12];
  int8_t ghost[4];  // optional faint branch (x1,y1,x2,y2), all zero = none
} ManShape;

static const ManShape MAN_SHAPES[] = {
  [MAN_STRAIGHT]     = {2, {20, 38, 20, 8}, {0}},
  [MAN_SLIGHT_RIGHT] = {3, {15, 38, 15, 24, 27, 11}, {0}},
  [MAN_RIGHT]        = {3, {12, 38, 12, 19, 30, 19}, {0}},
  [MAN_SHARP_RIGHT]  = {3, {13, 38, 13, 9, 28, 25}, {0}},
  [MAN_UTURN_RIGHT]  = {6, {11, 38, 11, 15, 15, 8, 25, 8, 29, 15, 29, 26}, {0}},
  [MAN_RAMP_RIGHT]   = {3, {15, 38, 15, 24, 27, 11}, {15, 24, 15, 4}},
  [MAN_FORK_RIGHT]   = {3, {20, 38, 20, 25, 29, 12}, {20, 25, 11, 12}},
  [MAN_MERGE]        = {3, {28, 38, 20, 24, 20, 8}, {12, 38, 20, 24}},
};

static void draw_shape(GContext *ctx, const ManShape *sh, bool mirror, GColor fg, GColor ghost) {
  int sw = s_sz / 7;
  if (sw < 2) sw = 2;
  GPoint pts[6];
  for (int i = 0; i < sh->n; i++) {
    int x = sh->pts[2 * i];
    if (mirror) x = 40 - x;
    pts[i] = P(x, sh->pts[2 * i + 1]);
  }
  if (sh->ghost[0] || sh->ghost[1]) {
    graphics_context_set_stroke_color(ctx, ghost);
    graphics_context_set_stroke_width(ctx, sw > 3 ? sw - 2 : 2);
    int x1 = mirror ? 40 - sh->ghost[0] : sh->ghost[0];
    int x2 = mirror ? 40 - sh->ghost[2] : sh->ghost[2];
    graphics_draw_line(ctx, P(x1, sh->ghost[1]), P(x2, sh->ghost[3]));
  }
  graphics_context_set_stroke_color(ctx, fg);
  graphics_context_set_fill_color(ctx, fg);
  graphics_context_set_stroke_width(ctx, sw);
  // shorten the final segment so the head sits at the end
  GPoint a = pts[sh->n - 2], b = pts[sh->n - 1];
  int dx = b.x - a.x, dy = b.y - a.y;
  int len = isqrt(dx * dx + dy * dy);
  if (len == 0) len = 1;
  int hl = sw * 2;       // head length
  int hw = sw * 3 / 2 + 1;  // head half-width
  GPoint base = GPoint(b.x - dx * hl / len, b.y - dy * hl / len);
  for (int i = 0; i < sh->n - 2; i++) graphics_draw_line(ctx, pts[i], pts[i + 1]);
  graphics_draw_line(ctx, a, base);
  for (int i = 1; i < sh->n - 1; i++) graphics_fill_circle(ctx, pts[i], sw / 2);
  GPoint head[3] = {
    b,
    GPoint(base.x + (-dy) * hw / len, base.y + dx * hw / len),
    GPoint(base.x - (-dy) * hw / len, base.y - dx * hw / len),
  };
  GPath path = { .num_points = 3, .points = head };
  gpath_draw_filled(ctx, &path);
  graphics_context_set_stroke_width(ctx, 1);
}

void maneuver_draw(GContext *ctx, int code, GPoint c, int size, GColor fg, GColor ghost) {
  s_c = c;
  s_sz = size;
#ifdef PBL_COLOR
  graphics_context_set_antialiased(ctx, true);
#endif
  switch (code) {
    case MAN_STRAIGHT:
    case MAN_NONE:
      draw_shape(ctx, &MAN_SHAPES[MAN_STRAIGHT], false, fg, ghost);
      break;
    case MAN_SLIGHT_RIGHT: case MAN_RIGHT: case MAN_SHARP_RIGHT: case MAN_UTURN_RIGHT:
    case MAN_RAMP_RIGHT: case MAN_FORK_RIGHT: case MAN_MERGE:
      draw_shape(ctx, &MAN_SHAPES[code], false, fg, ghost);
      break;
    case MAN_SLIGHT_LEFT: draw_shape(ctx, &MAN_SHAPES[MAN_SLIGHT_RIGHT], true, fg, ghost); break;
    case MAN_LEFT: draw_shape(ctx, &MAN_SHAPES[MAN_RIGHT], true, fg, ghost); break;
    case MAN_SHARP_LEFT: draw_shape(ctx, &MAN_SHAPES[MAN_SHARP_RIGHT], true, fg, ghost); break;
    case MAN_UTURN_LEFT: draw_shape(ctx, &MAN_SHAPES[MAN_UTURN_RIGHT], true, fg, ghost); break;
    case MAN_RAMP_LEFT: draw_shape(ctx, &MAN_SHAPES[MAN_RAMP_RIGHT], true, fg, ghost); break;
    case MAN_FORK_LEFT: draw_shape(ctx, &MAN_SHAPES[MAN_FORK_RIGHT], true, fg, ghost); break;
    case MAN_ROUNDABOUT_LEFT:
    case MAN_ROUNDABOUT_RIGHT: {
      bool left = code == MAN_ROUNDABOUT_LEFT;
      graphics_context_set_stroke_color(ctx, ghost);
      graphics_context_set_stroke_width(ctx, s_sz / 10 > 1 ? s_sz / 10 : 2);
      graphics_draw_circle(ctx, P(20, 17), S(9));
      ManShape sh = {3, {20, 38, 20, 26, 31, 9}, {0}};
      draw_shape(ctx, &sh, left, fg, ghost);
      break;
    }
    case MAN_DEPART: icon_draw(ctx, ICON_NAV, c, size, fg, GColorWhite); break;
    case MAN_ARRIVE: icon_draw(ctx, ICON_FLAG, c, size, fg, GColorWhite); break;
    case MAN_FERRY: icon_draw(ctx, ICON_FERRY, c, size, fg, ghost); break;
    case MAN_BUS: icon_draw(ctx, ICON_BUS, c, size, fg, ghost); break;
    case MAN_TRAIN: case MAN_SUBWAY: case MAN_TRAM:
      icon_draw(ctx, ICON_TRAIN, c, size, fg, ghost);
      break;
    case MAN_WALK: icon_draw(ctx, ICON_WALK, c, size, fg, ghost); break;
    default:
      draw_shape(ctx, &MAN_SHAPES[MAN_STRAIGHT], false, fg, ghost);
      break;
  }
}

// ---------------------------------------------------------------------------
// Map glyphs
// ---------------------------------------------------------------------------
void draw_pin(GContext *ctx, GPoint tip, int r, bool selected) {
  if (selected) r = r * 3 / 2;
  GPoint c = GPoint(tip.x, tip.y - r * 2);
#ifdef PBL_COLOR
  graphics_context_set_antialiased(ctx, true);
#endif
  // body
  GPoint tri[3] = { GPoint(c.x - r + 1, c.y + r / 2), GPoint(c.x + r - 1, c.y + r / 2), tip };
  GPath path = { .num_points = 3, .points = tri };
  graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(C_RED_DARK, GColorWhite));
  graphics_fill_circle(ctx, c, r + 1);
  graphics_context_set_fill_color(ctx, selected ? C_RED : PBL_IF_COLOR_ELSE(GColorSunsetOrange, GColorBlack));
  graphics_fill_circle(ctx, c, r);
  gpath_draw_filled(ctx, &path);
#ifdef PBL_BW
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_draw_circle(ctx, c, r);
#endif
  graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(C_RED_DARK, GColorWhite));
  graphics_fill_circle(ctx, c, r / 3 + 1);
}

void draw_me_dot(GContext *ctx, GPoint c, int r) {
#ifdef PBL_COLOR
  graphics_context_set_antialiased(ctx, true);
  graphics_context_set_stroke_color(ctx, C_BLUE_LT);
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_circle(ctx, c, r * 3);
#endif
  graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorWhite, GColorBlack));
  graphics_fill_circle(ctx, c, r + 2);
  graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(C_BLUE, GColorWhite));
  graphics_fill_circle(ctx, c, r);
#ifdef PBL_BW
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_circle(ctx, c, r / 2);
#endif
}

void draw_puck(GContext *ctx, GPoint c, int r) {
#ifdef PBL_COLOR
  graphics_context_set_antialiased(ctx, true);
#endif
  GPoint outer[4] = { GPoint(c.x, c.y - r - 3), GPoint(c.x + r + 3, c.y + r + 3),
                      GPoint(c.x, c.y + r / 2 + 2), GPoint(c.x - r - 3, c.y + r + 3) };
  GPoint inner[4] = { GPoint(c.x, c.y - r), GPoint(c.x + r, c.y + r),
                      GPoint(c.x, c.y + r / 2), GPoint(c.x - r, c.y + r) };
  GPath po = { .num_points = 4, .points = outer };
  GPath pi = { .num_points = 4, .points = inner };
  graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorWhite, GColorWhite));
  gpath_draw_filled(ctx, &po);
  graphics_context_set_stroke_color(ctx, GColorBlack);
  graphics_context_set_stroke_width(ctx, 1);
  gpath_draw_outline(ctx, &po);
  graphics_context_set_fill_color(ctx, C_BLUE);
  gpath_draw_filled(ctx, &pi);
}

void draw_fab(GContext *ctx, GPoint c, int r, IconId icon, GColor fill) {
#ifdef PBL_COLOR
  graphics_context_set_antialiased(ctx, true);
#endif
  graphics_context_set_fill_color(ctx, fill);
  graphics_fill_circle(ctx, c, r);
  icon_draw(ctx, icon, c, r + r / 4, GColorWhite, fill);
}

void draw_card(GContext *ctx, GRect r, int radius) {
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_rect(ctx, r, radius, GCornersAll);
  graphics_context_set_stroke_color(ctx, C_DIVIDER);
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_round_rect(ctx, r, radius);
}

void draw_map_placeholder(GContext *ctx, GRect r) {
  graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorWhite, GColorWhite));
  graphics_fill_rect(ctx, r, 0, GCornerNone);
  graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorLightGray, GColorBlack));
  graphics_context_set_stroke_width(ctx, 1);
  for (int x = r.origin.x + 12; x < r.origin.x + r.size.w; x += 24) {
    for (int y = r.origin.y; y < r.origin.y + r.size.h; y += PBL_IF_COLOR_ELSE(1, 3)) {
      graphics_draw_pixel(ctx, GPoint(x, y));
    }
  }
  for (int y = r.origin.y + 12; y < r.origin.y + r.size.h; y += 24) {
    for (int x = r.origin.x; x < r.origin.x + r.size.w; x += PBL_IF_COLOR_ELSE(1, 3)) {
      graphics_draw_pixel(ctx, GPoint(x, y));
    }
  }
}

// ---------------------------------------------------------------------------
// Loading dots
// ---------------------------------------------------------------------------
typedef struct {
  AppTimer *timer;
  int phase;
  bool running;
} DotsData;

static void dots_tick(void *ctx) {
  Layer *layer = ctx;
  DotsData *d = layer_get_data(layer);
  d->timer = NULL;
  if (!d->running) return;
  d->phase = (d->phase + 1) % 36;
  layer_mark_dirty(layer);
  d->timer = app_timer_register(55, dots_tick, layer);
}

static void dots_update(Layer *layer, GContext *ctx) {
  DotsData *d = layer_get_data(layer);
  GRect b = layer_get_bounds(layer);
  static const uint8_t cols[4] = {
#ifdef PBL_COLOR
    GColorBlueMoonARGB8, GColorRedARGB8, GColorChromeYellowARGB8, GColorIslamicGreenARGB8
#else
    GColorBlackARGB8, GColorBlackARGB8, GColorBlackARGB8, GColorBlackARGB8
#endif
  };
  int r = 4, gap = 14;
  int x0 = b.size.w / 2 - gap * 3 / 2;
#ifdef PBL_COLOR
  graphics_context_set_antialiased(ctx, true);
#endif
  for (int i = 0; i < 4; i++) {
    int32_t ang = TRIG_MAX_ANGLE * ((d->phase + i * 4) % 36) / 36;
    int dy = (int)(sin_lookup(ang) * 6 / TRIG_MAX_RATIO);
    if (dy > 0) dy = dy / 3;
    graphics_context_set_fill_color(ctx, (GColor){ .argb = cols[i] });
    graphics_fill_circle(ctx, GPoint(x0 + i * gap, b.size.h / 2 - dy), r);
  }
}

Layer *dots_layer_create(GRect frame) {
  Layer *layer = layer_create_with_data(frame, sizeof(DotsData));
  DotsData *d = layer_get_data(layer);
  d->timer = NULL;
  d->phase = 0;
  d->running = false;
  layer_set_update_proc(layer, dots_update);
  return layer;
}

void dots_layer_set_running(Layer *layer, bool running) {
  if (!layer) return;
  DotsData *d = layer_get_data(layer);
  layer_set_hidden(layer, !running);
  if (running == d->running) return;
  d->running = running;
  if (running && !d->timer) d->timer = app_timer_register(55, dots_tick, layer);
  if (!running && d->timer) {
    app_timer_cancel(d->timer);
    d->timer = NULL;
  }
}

void dots_layer_destroy(Layer *layer) {
  if (!layer) return;
  dots_layer_set_running(layer, false);
  layer_destroy(layer);
}

// ---------------------------------------------------------------------------
// Action strip
// ---------------------------------------------------------------------------
void draw_action_strip(GContext *ctx, GRect bounds, const StripIcons *ic) {
  int w = STRIP_W;
  int cx;
#ifdef PBL_ROUND
  int R = bounds.size.h;
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_circle(ctx, GPoint(bounds.size.w - w + R, bounds.size.h / 2), R);
  graphics_context_set_stroke_color(ctx, C_DIVIDER);
  graphics_draw_circle(ctx, GPoint(bounds.size.w - w + R, bounds.size.h / 2), R);
  cx = bounds.size.w - w / 2 - 4;
  int dy = bounds.size.h / 4;
#else
  GRect strip = GRect(bounds.size.w - w, 0, w, bounds.size.h);
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_rect(ctx, strip, 0, GCornerNone);
  graphics_context_set_stroke_color(ctx, C_DIVIDER);
  graphics_draw_line(ctx, GPoint(strip.origin.x, 0), GPoint(strip.origin.x, bounds.size.h));
  cx = strip.origin.x + w / 2;
  int dy = bounds.size.h / 2 - 26;
  if (dy > 70) dy = 70;
#endif
  int cy = bounds.size.h / 2;
  if (ic->up) icon_draw(ctx, ic->up, GPoint(cx, cy - dy), 18, C_ICON, C_BG);
  if (ic->select) {
    GColor fill = ic->select_color.argb ? ic->select_color : C_BLUE;
    draw_fab(ctx, GPoint(cx, cy), 12, ic->select, fill);
  }
  if (ic->down) icon_draw(ctx, ic->down, GPoint(cx, cy + dy), 18, C_ICON, C_BG);
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
static TextLayer *s_toast;
static AppTimer *s_toast_timer;
static char s_toast_text[64];

static void toast_hide(void *ctx) {
  s_toast_timer = NULL;
  if (s_toast) {
    layer_remove_from_parent(text_layer_get_layer(s_toast));
    text_layer_destroy(s_toast);
    s_toast = NULL;
  }
}

void ui_toast_cancel(void) {
  if (s_toast_timer) app_timer_cancel(s_toast_timer);
  toast_hide(NULL);
}

void ui_toast(Window *window, const char *text) {
  ui_toast_cancel();
  if (!window) return;
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  strncpy(s_toast_text, text, sizeof(s_toast_text) - 1);
  s_toast_text[sizeof(s_toast_text) - 1] = 0;
  int w = b.size.w - PBL_IF_ROUND_ELSE(50, 16);
  GSize sz = graphics_text_layout_get_content_size(s_toast_text, g_fonts.body_b,
                                                   GRect(0, 0, w - 8, 60),
                                                   GTextOverflowModeWordWrap, GTextAlignmentCenter);
  int h = sz.h + 10;
  s_toast = text_layer_create(GRect((b.size.w - w) / 2, b.size.h - h - PBL_IF_ROUND_ELSE(22, 6), w, h));
  text_layer_set_background_color(s_toast, PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack));
  text_layer_set_text_color(s_toast, GColorWhite);
  text_layer_set_font(s_toast, g_fonts.body_b);
  text_layer_set_text_alignment(s_toast, GTextAlignmentCenter);
  text_layer_set_text(s_toast, s_toast_text);
  layer_add_child(root, text_layer_get_layer(s_toast));
  s_toast_timer = app_timer_register(2200, toast_hide, NULL);
}

void format_clock(time_t t, char *buf, size_t len) {
  struct tm *tm = localtime(&t);
  if (clock_is_24h_style()) {
    strftime(buf, len, "%H:%M", tm);
  } else {
    strftime(buf, len, "%I:%M %p", tm);
    if (buf[0] == '0') memmove(buf, buf + 1, strlen(buf));
  }
}

void vibe_soon(void) {
  if (!g_app.vibrate) return;
  static const uint32_t segs[] = {120, 120, 120};
  VibePattern p = { .durations = segs, .num_segments = ARRAY_LENGTH(segs) };
  vibes_enqueue_custom_pattern(p);
}

void vibe_now(void) {
  if (!g_app.vibrate) return;
  static const uint32_t segs[] = {400, 150, 400};
  VibePattern p = { .durations = segs, .num_segments = ARRAY_LENGTH(segs) };
  vibes_enqueue_custom_pattern(p);
}
