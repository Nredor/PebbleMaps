// Pebble Maps - spoken directions through the watch speaker
//
// The phone sends each phrase as 4-bit IMA ADPCM (about 4 KB per second of
// speech). We keep the whole phrase, then decode it a little at a time into
// the speaker's audio stream.
#include "voice.h"
#include "comm.h"

#define PERSIST_VOLUME 4

#if VOICE_AVAILABLE

#define MAX_CLIP 16000
#define PUMP_MS 25
#define BLOCK 256           // samples decoded per step

static const int16_t STEPS[89] = {
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66,
  73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749,
  3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635,
  13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767 };
static const int8_t IDX[8] = { -1, -1, -1, -1, 2, 4, 6, 8 };

// clip being received
static uint8_t *s_rx;
static int s_rx_id, s_rx_total, s_rx_got, s_rx_samples, s_rx_pred, s_rx_index;

// clip being played
static uint8_t *s_play;
static int s_play_id;
static int s_samples, s_pos;       // total samples, next sample to decode
static int32_t s_pred;
static int s_index;
static int16_t *s_buf;   // on the heap (app image size limit)
static int s_buf_n, s_buf_off;     // decoded samples waiting, and how many already written
static AppTimer *s_timer;
static bool s_open;
static int s_volume = -1;
static bool s_enabled;

static void acknowledge(bool played) {
  if (s_play_id) {
    comm_cmd2(CMD_VOICE_DONE, s_play_id, played ? 1 : 0);
    s_play_id = 0;
  }
}

static void playback_finished(SpeakerFinishReason reason, void *ctx) {
  acknowledge(reason == SpeakerFinishReasonDone);
}

void voice_set_enabled(bool on) {
  s_enabled = on;
  if (!on) voice_stop();
}

int voice_volume(void) {
  if (s_volume < 0) s_volume = persist_exists(PERSIST_VOLUME) ? persist_read_int(PERSIST_VOLUME) : 70;
  if (s_volume < 10) s_volume = 10;
  if (s_volume > 100) s_volume = 100;
  return s_volume;
}

static void finish_play(void) {
  if (s_timer) { app_timer_cancel(s_timer); s_timer = NULL; }
  if (s_open) { speaker_stream_close(); s_open = false; }
  free(s_play);
  s_play = NULL;
}

void voice_stop(void) {
  free(s_rx);
  s_rx = NULL;
  speaker_set_finish_callback(NULL, NULL);
  if (s_open || s_play_id) speaker_stop();
  s_open = false;
  finish_play();
  acknowledge(false);
}

static void decode_block(void) {
  s_buf_n = 0;
  s_buf_off = 0;
  if (!s_buf) s_buf = malloc(BLOCK * sizeof(int16_t));
  if (!s_buf) return;
  while (s_buf_n < BLOCK && s_pos < s_samples) {
    uint8_t byte = s_play[s_pos >> 1];
    int code = (s_pos & 1) ? (byte & 0x0F) : (byte >> 4);
    int step = STEPS[s_index];
    int delta = step >> 3;
    if (code & 4) delta += step;
    if (code & 2) delta += step >> 1;
    if (code & 1) delta += step >> 2;
    s_pred += (code & 8) ? -delta : delta;
    if (s_pred > 32767) s_pred = 32767;
    if (s_pred < -32768) s_pred = -32768;
    s_index += IDX[code & 7];
    if (s_index < 0) s_index = 0;
    if (s_index > 88) s_index = 88;
    s_buf[s_buf_n++] = (int16_t)s_pred;
    s_pos++;
  }
}

static void pump(void *data) {
  s_timer = NULL;
  if (!s_open || !s_play) return;
  // keep feeding the speaker for as long as it accepts audio
  for (int guard = 0; guard < 16; guard++) {
    if (s_buf_off >= s_buf_n) {
      if (s_pos >= s_samples) { finish_play(); return; }
      decode_block();
      if (!s_buf) { voice_stop(); return; }
    }
    uint32_t want = (uint32_t)(s_buf_n - s_buf_off) * 2;
    uint32_t wrote = speaker_stream_write(&s_buf[s_buf_off], want);
    s_buf_off += wrote / 2;
    if (wrote < want) break;   // speaker buffer full: come back shortly
  }
  s_timer = app_timer_register(PUMP_MS, pump, NULL);
}

static void play(uint8_t *clip, int samples, int pred, int index, int id) {
  voice_stop();
  if (speaker_is_muted()) { free(clip); comm_cmd2(CMD_VOICE_DONE, id, 0); return; }
  s_play = clip;
  s_play_id = id;
  s_samples = samples;
  s_pos = 0;
  s_pred = pred;
  s_index = index < 0 ? 0 : (index > 88 ? 88 : index);
  s_buf_n = s_buf_off = 0;
  speaker_set_finish_callback(playback_finished, NULL);
  s_open = speaker_stream_open(SpeakerPcmFormat_8kHz_16bit, voice_volume());
  if (!s_open) { finish_play(); acknowledge(false); return; }
  pump(NULL);
}

void voice_handle(DictionaryIterator *it) {
  if (!s_enabled) return;
  int id = tuple_int(it, MESSAGE_KEY_idx, 0);
  int off = tuple_int(it, MESSAGE_KEY_offset, 0);
  if (off < 0) return;
  const Tuple *dt = dict_find(it, MESSAGE_KEY_data);
  if (off == 0) {
    free(s_rx);
    s_rx = NULL;
    s_rx_id = id;
    s_rx_total = tuple_int(it, MESSAGE_KEY_total, 0);
    s_rx_samples = tuple_int(it, MESSAGE_KEY_num, 0);
    s_rx_pred = tuple_int(it, MESSAGE_KEY_num2, 0);
    s_rx_index = tuple_int(it, MESSAGE_KEY_mode, 0);
    s_rx_got = 0;
    if (s_rx_total <= 0 || s_rx_total > MAX_CLIP) return;
    s_rx = malloc(s_rx_total);
    if (!s_rx) { APP_LOG(APP_LOG_LEVEL_WARNING, "voice: no memory for %d", s_rx_total); return; }
  }
  if (!s_rx || id != s_rx_id || !dt || off != s_rx_got || off >= s_rx_total) return;
  int len = dt->length;
  if (off + len > s_rx_total) len = s_rx_total - off;
  if (len > 0) memcpy(s_rx + off, dt->value->data, len);
  s_rx_got += len;
  if ((tuple_int(it, MESSAGE_KEY_flags, 0) & 1) && s_rx_got >= s_rx_total) {
    uint8_t *clip = s_rx;
    s_rx = NULL;
    int samples = s_rx_samples;
    if (samples > s_rx_total * 2) samples = s_rx_total * 2;
    play(clip, samples, s_rx_pred, s_rx_index, id);
  }
}

void voice_set_volume(int volume) {
  if (volume < 10) volume = 10;
  if (volume > 100) volume = 100;
  s_volume = volume;
  persist_write_int(PERSIST_VOLUME, volume);
  if (!s_open && !speaker_is_muted()) speaker_play_tone(880, 120, volume, SpeakerWaveformSine);
}

#else
void voice_handle(DictionaryIterator *it) {}
int voice_volume(void) { return 70; }
void voice_set_volume(int volume) {}
void voice_stop(void) {}
void voice_set_enabled(bool on) {}
#endif
