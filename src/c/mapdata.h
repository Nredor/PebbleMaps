// Pebble Maps - receives Google Static Maps images (converted by the phone)
#pragma once
#include "common.h"

#define MAX_MARKERS 12

typedef struct {
  int16_t x, y;
  uint8_t kind;   // MK_*
  uint8_t index;  // result index for pins
} Marker;

typedef struct {
  GBitmap *bmp;
  int seq;          // current request id
  int w, h;
  int stride;
  uint32_t total, got;
  bool complete;
  Marker markers[MAX_MARKERS];
  int n_markers;
  Layer *observer;
} MapData;

extern MapData g_map;

// Request a new map. Clears the current image. Returns the request id.
int map_request(int cmd, int w, int h, int idx, int mode);
void map_set_observer(Layer *layer);
void map_release(void);
void map_handle(int cmd, DictionaryIterator *it);
// Draw the image (or placeholder) and markers into frame. selected = result index or -1.
void map_draw(GContext *ctx, GRect frame, int selected);
// Find a marker for a result index; returns NULL if missing
const Marker *map_marker_for(int index);
// Nearest pin to a point (touch); returns result index or -1
int map_pin_near(GPoint p, GRect frame, int max_dist);
