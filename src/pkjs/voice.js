// Pebble Maps - spoken directions for watches with a speaker
//
// Text -> Google Cloud Text-to-Speech (the user's own key, 8 kHz audio)
//      -> squeezed to 4-bit IMA ADPCM (about 4 KB per second)
//      -> sent to the watch, which plays it through its speaker.
// Phrases are prepared ahead of time so they play the moment an alert fires.

var P = require('./protocol');
var msg = require('./msg');
var google = require('./google');

var MAX_BYTES = 14000;          // ~3.5 s of speech; the watch keeps one clip in memory
var CACHE = 8;
var cache = {};                 // text -> {data, samples, pred, index}
var order = [];
var waiting = {};               // text -> [callbacks]
var clipId = 0;
var inbox = 2048;
var failedOnce = false;
var onProblem = null;
var lastSpoke = 0;

// --- base64 / WAV -----------------------------------------------------------------
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
var B64I = {};
for (var bi = 0; bi < 64; bi++) B64I[B64.charAt(bi)] = bi;

function b64decode(str) {
  str = String(str).replace(/[^A-Za-z0-9+/]/g, '');
  var out = new Uint8Array(Math.floor(str.length * 3 / 4));
  var o = 0;
  for (var i = 0; i + 1 < str.length; i += 4) {
    var a = B64I[str.charAt(i)], b = B64I[str.charAt(i + 1)];
    var c = i + 2 < str.length ? B64I[str.charAt(i + 2)] : 0;
    var d = i + 3 < str.length ? B64I[str.charAt(i + 3)] : 0;
    var n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (n >> 16) & 255;
    if (i + 2 < str.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < str.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

// 16-bit PCM samples from a WAV file (or raw PCM if there is no header)
function wavSamples(bytes) {
  var start = 0, len = bytes.length;
  if (bytes.length > 12 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF') {
    var p = 12;
    while (p + 8 <= bytes.length) {
      var id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
      var sz = bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24);
      if (id === 'data') { start = p + 8; len = Math.min(sz, bytes.length - start); break; }
      p += 8 + sz + (sz & 1);
    }
  }
  var n = len >> 1;
  var s = new Int16Array(n);
  for (var i = 0; i < n; i++) {
    var v = bytes[start + 2 * i] | (bytes[start + 2 * i + 1] << 8);
    s[i] = v >= 32768 ? v - 65536 : v;
  }
  return s;
}

// --- IMA ADPCM ----------------------------------------------------------------------
var STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66,
  73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749,
  3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635,
  13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
var IDX = [-1, -1, -1, -1, 2, 4, 6, 8];

function encode(samples) {
  // trim silence at both ends and make it as loud as is safe (small speaker)
  var a = 0, b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < 300) a++;
  while (b > a && Math.abs(samples[b]) < 300) b--;
  a = Math.max(0, a - 200);
  b = Math.min(samples.length - 1, b + 400);
  var peak = 1;
  for (var i = a; i <= b; i++) peak = Math.max(peak, Math.abs(samples[i]));
  var gain = Math.min(4, 30000 / peak);
  var n = b - a + 1;
  if (n > MAX_BYTES * 2) n = MAX_BYTES * 2;
  var out = new Uint8Array((n + 1) >> 1);
  var pred = Math.round(samples[a] * gain), index = 0;
  var startPred = pred, startIndex = index;
  for (var k = 0; k < n; k++) {
    var s = Math.max(-32768, Math.min(32767, Math.round(samples[a + k] * gain)));
    var step = STEPS[index];
    var diff = s - pred;
    var code = 0;
    if (diff < 0) { code = 8; diff = -diff; }
    var delta = step >> 3;
    if (diff >= step) { code |= 4; diff -= step; delta += step; }
    step >>= 1;
    if (diff >= step) { code |= 2; diff -= step; delta += step; }
    step >>= 1;
    if (diff >= step) { code |= 1; delta += step; }
    pred += (code & 8) ? -delta : delta;
    pred = Math.max(-32768, Math.min(32767, pred));
    index = Math.max(0, Math.min(88, index + IDX[code & 7]));
    if (k & 1) out[k >> 1] |= code;          // second sample: low nibble
    else out[k >> 1] = code << 4;            // first sample: high nibble
  }
  return { data: out, samples: n, pred: startPred, index: startIndex };
}

// --- Google Text-to-Speech ---------------------------------------------------------------
function synth(text, cb) {
  if (cache[text]) return cb(null, cache[text]);
  if (waiting[text]) { waiting[text].push(cb); return; }
  waiting[text] = [cb];
  google.tts(text, function (err, b64) {
    var clip = null;
    if (!err) {
      try {
        clip = encode(wavSamples(b64decode(b64)));
        cache[text] = clip;
        order.push(text);
        while (order.length > CACHE) delete cache[order.shift()];
      } catch (e) {
        err = { code: P.ERR.API, title: 'Voice problem', text: String(e.message || e) };
      }
    }
    if (err && !failedOnce) {
      failedOnce = true;
      if (onProblem) onProblem(err);
    }
    var cbs = waiting[text];
    delete waiting[text];
    cbs.forEach(function (fn) { fn(err, clip); });
  });
}

function sendClip(clip) {
  msg.drop('voice');                 // a newer phrase replaces one still waiting
  clipId = clipId % 30000 + 1;
  var room = Math.max(200, inbox - 110);
  var total = clip.data.length;
  for (var off = 0; off < total; off += room) {
    var part = clip.data.subarray(off, Math.min(total, off + room));
    var d = { cmd: P.CMD.VOICE, idx: clipId, offset: off, total: total, data: Array.prototype.slice.call(part),
              flags: off + room >= total ? 1 : 0 };
    if (off === 0) { d.num = clip.samples; d.num2 = clip.pred; d.mode = clip.index; }
    msg.send(d, 'voice');
  }
}

module.exports = {
  setInbox: function (n) { inbox = n || 2048; },
  onProblem: function (fn) { onProblem = fn; },
  lastSpoke: function () { return lastSpoke; },
  speak: function (text) {
    if (!text) return;
    lastSpoke = Date.now();
    synth(text, function (err, clip) { if (!err && clip) sendClip(clip); });
  },
  prepare: function (texts) {
    (texts || []).forEach(function (t) { if (t) synth(t, function () {}); });
  },
  reset: function () { failedOnce = false; },
  cancel: function () { msg.drop('voice'); }
};
