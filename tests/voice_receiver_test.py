"""Exercise the actual watch receiver and playback lifecycle with a fake speaker."""
from pathlib import Path
import subprocess
import tempfile
import os

source = (Path(__file__).parents[1] / 'src/c/voice.c').read_text()
implementation = source.split('#if VOICE_AVAILABLE\n', 1)[1].split('\n#else', 1)[0]
harness = r'''
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#define APP_LOG(...) ((void)0)
#define PERSIST_VOLUME 4
#define CMD_VOICE_DONE 30
enum { MESSAGE_KEY_idx, MESSAGE_KEY_offset, MESSAGE_KEY_total, MESSAGE_KEY_num,
       MESSAGE_KEY_num2, MESSAGE_KEY_mode, MESSAGE_KEY_flags, MESSAGE_KEY_data };
typedef union { const uint8_t *data; } TupleValue;
typedef struct { int length; TupleValue *value; } Tuple;
typedef struct { int values[8]; Tuple tuple; } DictionaryIterator;
typedef struct { int dummy; } AppTimer;
typedef enum { SpeakerFinishReasonDone, SpeakerFinishReasonStopped } SpeakerFinishReason;
typedef void (*SpeakerFinishedCallback)(SpeakerFinishReason, void *);
enum { SpeakerPcmFormat_8kHz_16bit, SpeakerWaveformSine };
static AppTimer timer;
static SpeakerFinishedCallback finish_cb;
static bool muted, draining;
static int ack_id, ack_mode, acks, bytes_written;
static void comm_cmd2(int cmd, int idx, int mode) { assert(cmd == CMD_VOICE_DONE); ack_id = idx; ack_mode = mode; acks++; }
static bool persist_exists(int key) { return false; }
static int persist_read_int(int key) { return 70; }
static void persist_write_int(int key, int value) {}
static void app_timer_cancel(AppTimer *t) {}
static AppTimer *app_timer_register(int ms, void (*cb)(void *), void *ctx) { return &timer; }
static void speaker_set_finish_callback(SpeakerFinishedCallback cb, void *ctx) { finish_cb = cb; }
static void speaker_stream_close(void) { draining = true; }
static void speaker_stop(void) { draining = false; }
static bool speaker_is_muted(void) { return muted; }
static bool speaker_stream_open(int format, int volume) { draining = false; return true; }
static uint32_t speaker_stream_write(const void *data, uint32_t n) { assert(data); bytes_written += n; return n; }
static void speaker_play_tone(int hz, int ms, int volume, int waveform) {}
static int tuple_int(DictionaryIterator *it, int key, int fallback) { return it->values[key]; }
static const Tuple *dict_find(DictionaryIterator *it, int key) { return &it->tuple; }
void voice_stop(void);
int voice_volume(void);
'''
harness += implementation
harness += r'''
static DictionaryIterator message(int id, int off, int total, int length, int final) {
  static const uint8_t bytes[16] = { 0x11, 0x22, 0x33, 0x44 };
  static TupleValue value = { .data = bytes };
  DictionaryIterator it = {0};
  it.values[MESSAGE_KEY_idx] = id; it.values[MESSAGE_KEY_offset] = off;
  it.values[MESSAGE_KEY_total] = total; it.values[MESSAGE_KEY_num] = total * 2;
  it.values[MESSAGE_KEY_flags] = final;
  it.tuple.length = length; it.tuple.value = &value;
  return it;
}
int main(void) {
  voice_set_enabled(true);
  DictionaryIterator it = message(1, 0, 8, 8, 1);
  voice_handle(&it);
  assert(bytes_written == 32 && draining && finish_cb);
  assert(acks == 0); // close only starts draining; it is not playback completion
  finish_cb(SpeakerFinishReasonDone, NULL);
  assert(acks == 1 && ack_id == 1 && ack_mode == 1);
  it = message(2, 0, 8, 8, 1); voice_handle(&it);
  voice_stop(); assert(acks == 2 && ack_id == 2 && ack_mode == 0 && !finish_cb);
  it = message(3, 0, 8, 2, 0); voice_handle(&it);
  assert(s_rx && s_rx_got == 2);
  it = message(3, 4, 8, 4, 1); voice_handle(&it); assert(s_rx_got == 2); // missing chunk
  it = message(3, -1, 8, 2, 0); voice_handle(&it); assert(s_rx_got == 2);
  voice_set_enabled(false); assert(!s_rx);
  it = message(4, 0, 8, 8, 1); voice_handle(&it); assert(acks == 2); // disabled
  voice_set_enabled(true); muted = true;
  voice_handle(&it); assert(acks == 3 && ack_id == 4 && ack_mode == 0);
  free(s_buf);
  return 0;
}
'''
with tempfile.TemporaryDirectory() as directory:
    directory = Path(directory)
    (directory / 'voice.c').write_text(harness)
    subprocess.run(['gcc', '-std=c99', '-Wall', '-Wno-unused-parameter', '-fsanitize=address,undefined', str(directory / 'voice.c'), '-o', str(directory / 'voice')], check=True)
    # LeakSanitizer cannot inspect /proc in some hosted runners. Buffer lifetime
    # is asserted above; retain address and undefined-behavior checks.
    subprocess.run([str(directory / 'voice')], check=True, env=dict(os.environ, ASAN_OPTIONS='detect_leaks=0'))
print('Voice receiver regression: drain acknowledgement, cancellation, incomplete chunks and mute passed')
