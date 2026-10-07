const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const P = require('../src/pkjs/protocol');

function voice() {
  const synth = [], messages = [], timers = new Map(); let timerId = 0;
  const c = {
    module: { exports: {} }, Uint8Array, Int16Array, Math, Date,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    require: n => n === './protocol' ? P : n === './google' ? { tts: (text, cb) => synth.push({ text, cb }) } : {
      send: d => messages.push(d), drop: () => { messages.length = 0; }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/pkjs/voice.js'), 'utf8'), c);
  const pcm = seconds => { const data = Buffer.alloc(seconds * 8000 * 2); for (let i = 0; i < data.length; i += 2) data.writeInt16LE(1000, i); return data.toString('base64'); };
  return { api: c.module.exports, c, synth, messages, pcm, timers };
}

test('cancel invalidates pending synthesis', () => {
  const v = voice(); v.api.speak('Old turn'); v.api.cancel(); v.synth[0].cb(null, v.pcm(1)); assert.equal(v.messages.length, 0);
});

test('late synthesis cannot replace newer directions', () => {
  const v = voice(); v.api.speak('Old'); v.api.speak('New');
  v.synth[1].cb(null, v.pcm(1)); const id = v.messages[0].idx;
  v.synth[0].cb(null, v.pcm(1)); assert.equal(v.messages[0].idx, id);
});

test('long directions retain all samples and wait for each playback acknowledgement', () => {
  const v = voice(); v.api.speak('A long street name'); v.synth[0].cb(null, v.pcm(10));
  let samples = 0; const ids = [];
  for (let i = 0; i < 3; i++) {
    const first = v.messages[0]; assert.ok(first); assert.equal(first.offset, 0); ids.push(first.idx); samples += first.num;
    assert.ok(first.total <= 14000); assert.ok(v.messages.every(m => m.idx === first.idx));
    v.api.completed(-1); assert.equal(v.messages[0].idx, first.idx);
    v.api.completed(first.idx);
  }
  assert.equal(samples, 80000); assert.equal(new Set(ids).size, 3); assert.equal(v.c.active, null);
});

test('cancel prevents the remaining segments from playing', () => {
  const v = voice(); v.api.speak('Long phrase'); v.synth[0].cb(null, v.pcm(10));
  const id = v.messages[0].idx; v.api.cancel(); v.api.completed(id); assert.equal(v.messages.length, 0); assert.equal(v.timers.size, 0);
});

test('lost playback acknowledgement stops the phrase instead of playing a fragment', () => {
  const v = voice(); v.api.speak('Long phrase'); v.synth[0].cb(null, v.pcm(10));
  [...v.timers.values()][0](); assert.equal(v.c.active, null); assert.equal(v.messages.length, 0);
});

test('a muted or interrupted clip stops the remaining phrase', () => {
  const v = voice(); v.api.speak('Long phrase'); v.synth[0].cb(null, v.pcm(10));
  v.api.completed(v.messages[0].idx, false); assert.equal(v.c.active, null); assert.equal(v.messages.length, 0);
});
