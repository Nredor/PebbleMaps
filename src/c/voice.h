// Pebble Maps - spoken directions through the watch speaker (Pebble Time 2 / Round 2)
#pragma once
#include "common.h"

#if defined(PBL_PLATFORM_EMERY) || defined(PBL_PLATFORM_GABBRO)
#define VOICE_AVAILABLE 1
#else
#define VOICE_AVAILABLE 0
#endif

// A piece of a spoken phrase from the phone (4-bit ADPCM, 8 kHz)
void voice_handle(DictionaryIterator *it);
// Saved volume, 10..100
int voice_volume(void);
void voice_set_volume(int volume);   // saves it and plays a short beep at that level
void voice_stop(void);
// Only play phrases while voice is switched on
void voice_set_enabled(bool on);
