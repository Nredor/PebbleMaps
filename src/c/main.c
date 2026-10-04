// Pebble Maps - entry point
#include "common.h"
#include "comm.h"
#include "mapdata.h"
#include "ui.h"
#include "windows.h"

AppState g_app = { .default_mode = MODE_DRIVE, .vibrate = true };

const char *const CATEGORY_NAMES[CATEGORY_COUNT] = {
  "Restaurants", "Coffee", "Gas", "Groceries", "Parks", "Hotels",
  "ATMs", "Pharmacies", "Transit", "EV charging", "Parking", "Libraries",
};
const uint8_t CATEGORY_ICONS[CATEGORY_COUNT] = {
  ICON_FOOD, ICON_COFFEE, ICON_GAS, ICON_CART, ICON_TREE, ICON_BED,
  ICON_ATM, ICON_PHARMACY, ICON_BUS, ICON_PLUG, ICON_PARKING, ICON_BOOK,
};
#ifdef PBL_COLOR
const uint8_t CATEGORY_COLORS[CATEGORY_COUNT] = {
  GColorOrangeARGB8, GColorWindsorTanARGB8, GColorBlueMoonARGB8, GColorBlueMoonARGB8,
  GColorIslamicGreenARGB8, GColorPurpleARGB8, GColorDarkGreenARGB8, GColorRedARGB8,
  GColorBlueMoonARGB8, GColorJaegerGreenARGB8, GColorCobaltBlueARGB8, GColorImperialPurpleARGB8,
};
#else
const uint8_t CATEGORY_COLORS[CATEGORY_COUNT] = { 0 };
#endif

const char *mode_name(int mode) {
  switch (mode) {
    case MODE_WALK: return "Walk";
    case MODE_BIKE: return "Bike";
    case MODE_TRANSIT: return "Transit";
    default: return "Drive";
  }
}

int count_list(const char *packed) {
  if (!packed || !*packed) return 0;
  int n = 1;
  for (const char *p = packed; *p; p++) if (*p == 0x1E) n++;
  return n;
}

ListItem *alloc_list(const char *packed, int max, int *count) {
  int n = count_list(packed);
  if (n > max) n = max;
  *count = 0;
  if (n == 0) return NULL;
  ListItem *items = calloc(n, sizeof(ListItem));
  if (!items) return NULL;
  *count = parse_list(packed, items, n);
  return items;
}

int parse_list(const char *packed, ListItem *items, int max) {
  int n = 0;
  const char *p = packed;
  while (*p && n < max) {
    ListItem *it = &items[n];
    memset(it, 0, sizeof(*it));
    int field = 0;
    char num[6] = {0};
    int ti = 0, si = 0, ni = 0;
    while (*p && *p != 0x1E) {
      if (*p == 0x1F) {
        if (field == 2) it->icon = atoi(num);
        field++;
        memset(num, 0, sizeof(num));
        ni = 0;
      } else if (field == 0) {
        if (ti < ITEM_TITLE_LEN - 1) it->title[ti++] = *p;
      } else if (field == 1) {
        if (si < ITEM_SUB_LEN - 1) it->sub[si++] = *p;
      } else {
        if (ni < 5) num[ni++] = *p;
      }
      p++;
    }
    if (field == 2) it->icon = atoi(num);
    else if (field == 3) it->extra = atoi(num);
    n++;
    if (*p == 0x1E) p++;
  }
  return n;
}

static void init(void) {
  ui_init();
#if defined(PBL_PLATFORM_APLITE)
  g_app.has_mic = false;
#else
  g_app.has_mic = true;
#endif
  g_app.touch = touch_service_is_enabled();
  if (g_app.touch) app_touch_navigation_enable(true);
  comm_init();
  home_window_push();
  map_reserve();
}

static void deinit(void) {
  map_release();
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
