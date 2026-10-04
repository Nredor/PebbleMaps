// Pebble Maps - phone communication
#include "comm.h"
#include "mapdata.h"

#define QUEUE_LEN 6

static CommHandler s_handler;
static void *s_handler_ctx;
static OutMsg s_queue[QUEUE_LEN];
static int s_q_head, s_q_count;
static bool s_sending;
static int s_retries;
static AppTimer *s_retry_timer;

static void pump(void);

void comm_msg_init(OutMsg *m, int cmd) {
  memset(m, 0, sizeof(*m));
  m->cmd = cmd;
  m->idx = m->mode = m->seq = m->width = m->height = m->num = -1;
}

const Tuple *tuple_get(DictionaryIterator *it, uint32_t key) {
  return dict_find(it, key);
}

int tuple_int(DictionaryIterator *it, uint32_t key, int def) {
  const Tuple *t = dict_find(it, key);
  if (!t) return def;
  switch (t->type) {
    case TUPLE_INT:
      if (t->length == 1) return t->value->int8;
      if (t->length == 2) return t->value->int16;
      return t->value->int32;
    case TUPLE_UINT:
      if (t->length == 1) return t->value->uint8;
      if (t->length == 2) return t->value->uint16;
      return (int)t->value->uint32;
    case TUPLE_CSTRING:
      return atoi(t->value->cstring);
    default:
      return def;
  }
}

const char *tuple_str(DictionaryIterator *it, uint32_t key) {
  const Tuple *t = dict_find(it, key);
  if (!t || t->type != TUPLE_CSTRING) return "";
  return t->value->cstring;
}

static void add_int(DictionaryIterator *it, uint32_t key, int v) {
  if (v >= 0) dict_write_int32(it, key, v);
}

static void retry_cb(void *ctx) {
  s_retry_timer = NULL;
  pump();
}

static void pump(void) {
  if (s_sending || s_q_count == 0 || s_retry_timer) return;
  DictionaryIterator *it;
  AppMessageResult r = app_message_outbox_begin(&it);
  if (r != APP_MSG_OK) {
    s_retry_timer = app_timer_register(250, retry_cb, NULL);
    return;
  }
  const OutMsg *m = &s_queue[s_q_head];
  dict_write_int32(it, MESSAGE_KEY_cmd, m->cmd);
  add_int(it, MESSAGE_KEY_idx, m->idx);
  add_int(it, MESSAGE_KEY_mode, m->mode);
  add_int(it, MESSAGE_KEY_seq, m->seq);
  add_int(it, MESSAGE_KEY_width, m->width);
  add_int(it, MESSAGE_KEY_height, m->height);
  add_int(it, MESSAGE_KEY_num, m->num);
  if (m->text[0]) dict_write_cstring(it, MESSAGE_KEY_text, m->text);
  if (app_message_outbox_send() == APP_MSG_OK) {
    s_sending = true;
  } else {
    s_retry_timer = app_timer_register(250, retry_cb, NULL);
  }
}

void comm_send(const OutMsg *m) {
  if (s_q_count == QUEUE_LEN) {
    // drop the oldest pending message
    s_q_head = (s_q_head + 1) % QUEUE_LEN;
    s_q_count--;
  }
  s_queue[(s_q_head + s_q_count) % QUEUE_LEN] = *m;
  s_q_count++;
  pump();
}

void comm_cmd(int cmd) {
  OutMsg m;
  comm_msg_init(&m, cmd);
  comm_send(&m);
}

void comm_cmd2(int cmd, int idx, int mode) {
  OutMsg m;
  comm_msg_init(&m, cmd);
  m.idx = idx;
  m.mode = mode;
  comm_send(&m);
}

static void outbox_sent(DictionaryIterator *it, void *ctx) {
  s_sending = false;
  s_retries = 0;
  if (s_q_count) {
    s_q_head = (s_q_head + 1) % QUEUE_LEN;
    s_q_count--;
  }
  pump();
}

static void outbox_failed(DictionaryIterator *it, AppMessageResult reason, void *ctx) {
  s_sending = false;
  if (++s_retries > 3) {
    // give up on this message
    s_retries = 0;
    if (s_q_count) {
      s_q_head = (s_q_head + 1) % QUEUE_LEN;
      s_q_count--;
    }
  }
  if (!s_retry_timer) s_retry_timer = app_timer_register(400, retry_cb, NULL);
}

static void inbox_received(DictionaryIterator *it, void *ctx) {
  int cmd = tuple_int(it, MESSAGE_KEY_cmd, 0);
  switch (cmd) {
    case CMD_STATUS:
      g_app.status_known = true;
      g_app.configured = tuple_int(it, MESSAGE_KEY_num, 0) != 0;
      g_app.default_mode = tuple_int(it, MESSAGE_KEY_mode, MODE_DRIVE);
      {
        int flags = tuple_int(it, MESSAGE_KEY_flags, 0);
        g_app.imperial = flags & 1;
        g_app.vibrate = (flags & 2) != 0;
      }
      break;
    case CMD_MAP_BEGIN:
    case CMD_MAP_CHUNK:
    case CMD_MARKERS:
      map_handle(cmd, it);
      return;
    default:
      break;
  }
  if (s_handler) s_handler(cmd, it, s_handler_ctx);
}

static void inbox_dropped(AppMessageResult reason, void *ctx) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "inbox dropped %d", (int)reason);
}

void comm_set_handler(CommHandler handler, void *ctx) {
  s_handler = handler;
  s_handler_ctx = ctx;
}

void comm_clear_handler(CommHandler handler) {
  if (s_handler == handler) {
    s_handler = NULL;
    s_handler_ctx = NULL;
  }
}

void comm_init(void) {
  app_message_register_inbox_received(inbox_received);
  app_message_register_inbox_dropped(inbox_dropped);
  app_message_register_outbox_sent(outbox_sent);
  app_message_register_outbox_failed(outbox_failed);
  uint32_t in_max = app_message_inbox_size_maximum();
  uint32_t cap = PBL_IF_RECT_ELSE(4096, 4096);
#if defined(PBL_PLATFORM_EMERY) || defined(PBL_PLATFORM_GABBRO)
  cap = 8192;
#endif
  uint32_t in_size = in_max < cap ? in_max : cap;
  g_app.inbox_size = in_size;
  app_message_open(in_size, 512);
}
