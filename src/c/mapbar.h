// Pebble Maps - shared map controls: zoom / move bar and touch gestures
#pragma once
#include "common.h"
#include "ui.h"

typedef enum { MB_EV_EXTRA_UP, MB_EV_EXTRA_DOWN, MB_EV_CLOSED, MB_EV_MOVED } MapBarEvent;
typedef void (*MapBarCallback)(MapBarEvent ev, void *ctx);

enum { MB_PAGE_ZOOM = 0, MB_PAGE_DOLLY, MB_PAGE_PAN, MB_PAGE_EXTRA };

typedef struct {
  bool open;
  int page;
  AppTimer *timer;
  Layer *layer;           // redrawn on changes
  GSize frame;            // map area size (pan step)
  IconId extra_up, extra_down;
  GColor extra_up_color, extra_down_color;
  MapBarCallback cb;
  void *ctx;
} MapBar;

void mapbar_init(MapBar *mb, Layer *layer, GSize frame, IconId extra_up, IconId extra_down,
                 MapBarCallback cb, void *ctx);
void mapbar_open(MapBar *mb);
void mapbar_close(MapBar *mb);
void mapbar_poke(MapBar *mb);             // restart the 5 s timeout
bool mapbar_button(MapBar *mb, ButtonId b); // true if the bar handled it
void mapbar_draw(MapBar *mb, GContext *ctx, GRect bounds);
void mapbar_deinit(MapBar *mb);

// Touch gestures on a map area
typedef void (*MapTapCallback)(GPoint p, void *ctx);
typedef struct {
  bool down, dragging, ignore;
  int16_t x0, y0, x, y;
  uint32_t last_tap_ms;
  int16_t last_tap_x, last_tap_y;
  AppTimer *hold;
  GRect frame;            // map area (touches outside are ignored)
  MapTapCallback on_tap;  // single tap (after double-tap window)
  void *ctx;
  MapBar *bar;            // poked while touching
} MapTouch;

void maptouch_init(MapTouch *mt, GRect frame, MapTapCallback on_tap, void *ctx, MapBar *bar);
// returns true if the event was used
bool maptouch_event(MapTouch *mt, const TouchEvent *e);
void maptouch_deinit(MapTouch *mt);
