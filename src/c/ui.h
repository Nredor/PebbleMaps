// Pebble Maps - drawing toolkit: colors, fonts, icons, pins, loading dots
#pragma once
#include "common.h"

// Google-ish palette mapped to the Pebble 64-color palette.
#define C_BLUE      PBL_IF_COLOR_ELSE(GColorBlueMoon, GColorBlack)
#define C_BLUE_DARK PBL_IF_COLOR_ELSE(GColorDukeBlue, GColorBlack)
#define C_BLUE_LT   PBL_IF_COLOR_ELSE(GColorPictonBlue, GColorLightGray)
#define C_RED       PBL_IF_COLOR_ELSE(GColorRed, GColorBlack)
#define C_RED_DARK  PBL_IF_COLOR_ELSE(GColorDarkCandyAppleRed, GColorBlack)
#define C_YELLOW    PBL_IF_COLOR_ELSE(GColorChromeYellow, GColorBlack)
#define C_GREEN     PBL_IF_COLOR_ELSE(GColorIslamicGreen, GColorBlack)
#define C_NAVGREEN  PBL_IF_COLOR_ELSE(GColorJaegerGreen, GColorBlack)
#define C_NAVGREEN_DK PBL_IF_COLOR_ELSE(GColorDarkGreen, GColorBlack)
#define C_TEXT      PBL_IF_COLOR_ELSE(GColorBlack, GColorBlack)
#define C_SUBTEXT   PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack)
#define C_ICON      PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack)
#define C_BG        GColorWhite
#define C_DIVIDER   PBL_IF_COLOR_ELSE(GColorLightGray, GColorBlack)
#define C_MAPBG     PBL_IF_COLOR_ELSE(GColorWhite, GColorWhite)

typedef enum {
  ICON_NONE = 0,
  ICON_MIC, ICON_STAR, ICON_STAR_OUTLINE, ICON_EXPLORE, ICON_DIRECTIONS,
  ICON_LIST, ICON_NAV, ICON_PIN, ICON_CLOCK, ICON_MYLOC, ICON_FLAG,
  ICON_SEARCH, ICON_PLUS, ICON_CAR, ICON_WALK, ICON_BIKE, ICON_BUS,
  ICON_TRAIN, ICON_FERRY, ICON_WARNING, ICON_PHONE, ICON_COFFEE,
  ICON_FOOD, ICON_GAS, ICON_CART, ICON_TREE, ICON_BED, ICON_ATM,
  ICON_PHARMACY, ICON_PLUG, ICON_PARKING, ICON_BOOK, ICON_MUTE,
  ICON_SOUND, ICON_CLOSE, ICON_ZOOM_IN, ICON_ZOOM_OUT, ICON_MAP,
  ICON_KEY, ICON_COUNT
} IconId;

// Fonts (loaded once)
typedef struct {
  GFont small;     // Gothic 14
  GFont small_b;   // Gothic 14 bold
  GFont body;      // Gothic 18
  GFont body_b;    // Gothic 18 bold
  GFont title;     // Gothic 24 bold
  GFont big;       // Gothic 28 bold
  GFont roboto;    // Roboto Condensed 21
} Fonts;
extern Fonts g_fonts;

void ui_init(void);

// Icons: size is the icon's bounding box edge in pixels, centered at c.
void icon_draw(GContext *ctx, IconId id, GPoint c, int size, GColor fg, GColor bg);
IconId icon_for_mode(int mode);
// Maneuver arrow, centered at c
void maneuver_draw(GContext *ctx, int code, GPoint c, int size, GColor fg, GColor ghost);

// Map glyphs
void draw_pin(GContext *ctx, GPoint tip, int r, bool selected);
void draw_me_dot(GContext *ctx, GPoint c, int r);
void draw_puck(GContext *ctx, GPoint c, int r);

// Google "FAB": a filled circle with a white icon
void draw_fab(GContext *ctx, GPoint c, int r, IconId icon, GColor fill);

// Loading dots (blue, red, yellow, green bouncing)
typedef struct DotsLayer DotsLayer;
Layer *dots_layer_create(GRect frame);
void dots_layer_set_running(Layer *layer, bool running);
void dots_layer_destroy(Layer *layer);

// Simple action strip on the right edge (Up / Select / Down)
#define STRIP_W PBL_IF_ROUND_ELSE(40, 30)
typedef struct {
  IconId up, select, down;
  GColor select_color;
} StripIcons;
void draw_action_strip(GContext *ctx, GRect bounds, const StripIcons *icons);

// Toast banner (one at a time, attached to a window)
void ui_toast(Window *window, const char *text);
void ui_toast_cancel(void);

// Format a unix time as local clock text ("2:43 PM" or "14:43")
void format_clock(time_t t, char *buf, size_t len);

// Rounded "card" background with subtle border
void draw_card(GContext *ctx, GRect r, int radius);

// Placeholder map tile pattern while loading
void draw_map_placeholder(GContext *ctx, GRect r);

// Vibrations
void vibe_soon(void);
void vibe_now(void);
