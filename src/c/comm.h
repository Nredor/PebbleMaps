// Pebble Maps - phone communication
#pragma once
#include "common.h"

typedef void (*CommHandler)(int cmd, DictionaryIterator *iter, void *ctx);

void comm_init(void);
// The visible screen registers to receive phone messages.
void comm_set_handler(CommHandler handler, void *ctx);
void comm_clear_handler(CommHandler handler);

// Outgoing message. Fields left at OUT_NONE (or empty text) are not sent.
#define OUT_NONE (-999999)
typedef struct {
  int cmd, idx, mode, seq, width, height, num;
  char text[PM_LOWMEM ? 120 : 160];
} OutMsg;

void comm_msg_init(OutMsg *m, int cmd);
void comm_send(const OutMsg *m);
void comm_cmd(int cmd);
void comm_cmd2(int cmd, int idx, int mode);

// Tuple helpers
int tuple_int(DictionaryIterator *it, uint32_t key, int def);
const char *tuple_str(DictionaryIterator *it, uint32_t key);
const Tuple *tuple_get(DictionaryIterator *it, uint32_t key);
