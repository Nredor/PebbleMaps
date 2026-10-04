// Pebble Maps - on-screen touch keyboard (Pebble Time 2 / Round 2)
//
// Adapted from the "pgkb" keyboard in Pebblegram (github.com/TomBolger/Pebblegram):
// docked at the bottom at the same size, with the search bar at the top and
// suggestions dropping down under it.
// Planned, work in progress: auto-correct and gesture (swipe) typing. Keep this
// module self-contained so those features can be shared between both apps.
#pragma once
#include "common.h"

#if defined(PBL_PLATFORM_EMERY) || defined(PBL_PLATFORM_GABBRO)
#define KEYBOARD_AVAILABLE 1
#else
#define KEYBOARD_AVAILABLE 0
#endif

typedef struct {
  void (*background)(GContext *gctx, GRect bounds, void *ctx);  // draws what's behind (the map)
  void (*appear)(void *ctx);                          // keyboard is on screen
  void (*changed)(const char *text, void *ctx);      // text changed (after a short pause)
  void (*pick)(int index, const char *title, void *ctx);  // a suggestion was tapped
  void (*done)(const char *text, void *ctx);         // action key / Select pressed
} KeyboardHooks;

// Opens the keyboard. Back cancels.
void keyboard_window_push(const char *placeholder, const char *action_label, const KeyboardHooks *hooks, void *ctx);
// Show suggestions above the keys (the keyboard takes ownership of the list and frees it)
void keyboard_set_suggestions(ListItem *items, int count);
// The text the suggestions are for
const char *keyboard_text(void);
