// Pebble Maps - on-screen touch keyboard (Pebble Time 2 / Round 2)
//
// Adapted from the "pgkb" keyboard in Pebblegram (github.com/TomBolger/Pebblegram).
// Planned, work in progress: auto-correct and gesture (swipe) typing. Keep this
// module self-contained so those features can be shared between both apps.
#pragma once
#include "common.h"

#if defined(PBL_PLATFORM_EMERY) || defined(PBL_PLATFORM_GABBRO)
#define KEYBOARD_AVAILABLE 1
#else
#define KEYBOARD_AVAILABLE 0
#endif

typedef void (*KeyboardDone)(const char *text, void *ctx);

// Opens a full-screen keyboard. done() is called with the typed text when the
// user taps the action key (or presses Select); Back cancels.
void keyboard_window_push(const char *placeholder, const char *action_label, KeyboardDone done, void *ctx);
