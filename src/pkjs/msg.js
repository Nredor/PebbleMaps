// Pebble Maps - ordered, retrying AppMessage queue
var queue = [];
var busy = false;

function pump() {
  if (busy || !queue.length) return;
  busy = true;
  var item = queue[0];
  Pebble.sendAppMessage(item.dict, function () {
    queue.shift();
    busy = false;
    if (item.done) item.done(true);
    pump();
  }, function (e) {
    busy = false;
    item.tries = (item.tries || 0) + 1;
    if (item.tries >= 4) {
      queue.shift();
      if (item.done) item.done(false);
    }
    setTimeout(pump, 150 * item.tries);
  });
}

// tag: optional string so stale messages can be dropped (e.g. old map images)
function send(dict, tag, done) {
  queue.push({ dict: dict, tag: tag || null, done: done });
  pump();
}

function drop(tagPrefix) {
  // never drop the in-flight message (index 0 while busy)
  var start = busy ? 1 : 0;
  for (var i = queue.length - 1; i >= start; i--) {
    if (queue[i].tag && queue[i].tag.indexOf(tagPrefix) === 0) queue.splice(i, 1);
  }
}

function pending() { return queue.length; }

module.exports = { send: send, drop: drop, pending: pending };
