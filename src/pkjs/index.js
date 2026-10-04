// Pebble Maps - phone side
//
// The watch asks for things (maps, searches, routes); this file talks to
// Google Maps Platform with the user's own API key and sends results back.

var P = require('./protocol');
var geo = require('./geo');
var fmt = require('./format');
var image = require('./image');
var google = require('./google');
var msg = require('./msg');
var settings = require('./settings');
var nav = require('./nav');
var Clay = require('./vendor/clay');
var clayConfig = require('./clay-config');
var clayComponents = require('./clay-components');
var dev = require('./dev');
var tiles = require('./tiles');

var CMD = P.CMD;

var clay = new Clay(clayConfig.config(), clayConfig.customFn, { autoHandleEvents: false });
clayComponents.forEach(function (c) { clay.registerComponent(c); });

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var watch = { w: 144, h: 168, fmt: 1, mic: true, round: false, touch: false, inbox: 4096 };
var me = null;            // [lat, lng]
var meAcc = 50;
var meTime = 0;
var results = [];
var dest = null;
var destWaiters = null;   // callbacks waiting for dest coordinates
var route = null;         // built route (nav model)
var routeKey = '';
var routeTime = 0;
var navigator_ = null;
var watchId = null;
var simTimer = null;
var gpsTimer = null;
var currentMapSeq = 0;

var S = settings.get();

function reloadSettings() {
  S = settings.get();
  var key = S.apiKey || dev.testKey || '';
  google.setKey(key);
}

// ---------------------------------------------------------------------------
// Sending helpers
// ---------------------------------------------------------------------------
function send(dict, tag) { msg.send(dict, tag); }

function sendStatus() {
  send({
    cmd: CMD.STATUS,
    num: google.hasKey() ? 1 : 0,
    mode: S.defaultMode,
    flags: (S.imperial ? 1 : 0) | (S.vibrate ? 2 : 0) | ((S.textSize & 3) << 2)
  });
}

function sendError(err, fallbackCode) {
  err = err || {};
  send({
    cmd: CMD.ERROR,
    num: err.code || fallbackCode || P.ERR.API,
    text: fmt.clip(err.text || 'Something went wrong. Please try again.', 220),
    text2: fmt.clip(err.title || '', 40)
  });
}

function sendBusy(text) { send({ cmd: CMD.BUSY, text: text }); }
function toast(text) { send({ cmd: CMD.TOAST, text: fmt.clip(text, 60) }); }

function utf8Len(str) { return unescape(encodeURIComponent(str)).length; }

// Fit the list into one message for this watch (drops items from the end if needed)
function sendList(kind, items) {
  var packed = fmt.packList(items) || '';
  var room = watch.inbox - 80;
  while (items.length > 1 && utf8Len(packed) > room) {
    items = items.slice(0, items.length - 1);
    packed = fmt.packList(items);
  }
  send({ cmd: CMD.LIST, num: kind, list: packed });
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------
var LOCATION_ERROR = {
  code: P.ERR.NO_LOCATION,
  title: 'Where are you?',
  text: 'Your phone couldn\'t find your location. Make sure Location is turned on and the Pebble app is allowed to use it.'
};

function getLocation(maxAge, cb) {
  if (dev.simLocation) {
    me = me || dev.simLocation.slice();
    meTime = Date.now();
    return cb(null, me);
  }
  if (me && Date.now() - meTime < maxAge) return cb(null, me);
  var answered = false;
  navigator.geolocation.getCurrentPosition(function (pos) {
    if (answered) return;
    answered = true;
    me = [pos.coords.latitude, pos.coords.longitude];
    meAcc = pos.coords.accuracy || 50;
    meTime = Date.now();
    cb(null, me);
  }, function () {
    if (answered) return;
    answered = true;
    if (me) return cb(null, me);  // fall back to the last known spot
    cb(LOCATION_ERROR);
  }, { enableHighAccuracy: true, maximumAge: Math.min(maxAge, 60000), timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Maps: fetch from Google, convert, stream to the watch
// ---------------------------------------------------------------------------
function mapStyle() {
  if (watch.fmt === P.FMT.BIT1) return 'bw';
  return S.mapStyle === 'dark' ? 'dark' : 'light';
}

// The watch keeps one picture buffer; on roomier watches it is bigger than the
// screen so panning shows real map right away.
var buf = { w: 144, h: 168 };

function outSize(fw, fh) {
  var m = Math.max(0, Math.min(Math.floor((buf.w - fw) / 2), Math.floor((buf.h - fh) / 2)));
  return [fw + 2 * m, fh + 2 * m];
}

function encodeMarkers(list) {
  var data = [];
  list.slice(0, 12).forEach(function (m) {
    var x = m.x & 0xffff, y = m.y & 0xffff;
    data.push(x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff, m.kind, m.index || 0);
  });
  return data;
}

function markerFor(p, view, kind, index) {
  var s = geo.toScreen(p, view.center, view.zoom, view.w, view.h);
  var os = outSize(view.w, view.h);
  var mx = (os[0] - view.w) / 2 + 30, my = (os[1] - view.h) / 2 + 30;
  if (s[0] < -mx || s[1] < -my || s[0] > view.w + mx || s[1] > view.h + my) return null;
  return { x: s[0], y: s[1], kind: kind, index: index || 0 };
}

// --- What the watch's picture buffer holds ------------------------------------
// The watch keeps its current picture on screen and moves it (slide / zoom /
// turn) to line up with each new one; we then only send what is new.
var wimg = null;          // { id, c:[x,y] world px at center, zoom, heading, w, h, key, ok, valid }
var imgCounter = 0;
var panAck = 0;           // newest map move from the watch that we've applied
var renderToken = 0;
var refreshFn = null;
var refreshTimer = null;

function scheduleRefresh() {
  if (refreshTimer || !refreshFn) return;
  refreshTimer = setTimeout(function () {
    refreshTimer = null;
    if (wimg) wimg.valid = false;
    if (refreshFn) refreshFn();
  }, 400);
}

// The watch zooms its picture the moment the button is pressed; keep our copy in step
function mirrorAdjust(p) {
  if (p.num !== undefined && p.num !== null) panAck = p.num;
  if (wimg && (p.idx === P.ADJ.ZOOM_IN || p.idx === P.ADJ.ZOOM_OUT)) {
    var f = p.idx === P.ADJ.ZOOM_IN ? 2 : 0.5;
    wimg.c = [wimg.c[0] * f, wimg.c[1] * f];
    wimg.zoom += p.idx === P.ADJ.ZOOM_IN ? 1 : -1;
    wimg.valid = false;
  }
}

// Choose the exact picture center so it is a whole-pixel slide of what the watch has
function planImage(c, zoom, heading, w, h) {
  var p = wimg;
  if (p && p.ok && p.zoom === zoom && p.heading === heading && p.w === w && p.h === h) {
    var v = toScreenOffset(p.c[0] - c[0], p.c[1] - c[1], heading);
    v = [Math.round(v[0]), Math.round(v[1])];
    var dw = toWorld(v[0], v[1], heading);
    return { c: [p.c[0] - dw[0], p.c[1] - dw[1]], ref: p.id, v: v };
  }
  return { c: c, ref: 0, v: [0, 0] };
}

// Parts of a w x h picture that are new after sliding by v (null = send it all)
function stripRects(v, w, h) {
  var vx = v[0], vy = v[1];
  var ax = Math.abs(vx), ay = Math.abs(vy);
  if (ax >= w || ay >= h) return null;
  if ((ay * w + ax * (h - ay)) > 0.6 * w * h) return null;
  var rects = [];
  if (vy > 0) rects.push({ y0: 0, y1: vy, x0: 0, x1: w });
  else if (vy < 0) rects.push({ y0: h + vy, y1: h, x0: 0, x1: w });
  var ry0 = vy > 0 ? vy : 0, ry1 = vy < 0 ? h + vy : h;
  if (vx > 0) rects.push({ y0: ry0, y1: ry1, x0: 0, x1: vx });
  else if (vx < 0) rects.push({ y0: ry0, y1: ry1, x0: w + vx, x1: w });
  return rects;
}

// Whole picture, as bands of rows from the middle outward
function centerOutRects(w, h, rowsPer) {
  var rects = [];
  var mid = Math.floor(h / 2);
  var top = Math.max(0, mid - Math.floor(rowsPer / 2)), bot = Math.min(h, top + rowsPer);
  rects.push({ y0: top, y1: bot, x0: 0, x1: w });
  while (top > 0 || bot < h) {
    if (top > 0) { var t0 = Math.max(0, top - rowsPer); rects.push({ y0: t0, y1: top, x0: 0, x1: w }); top = t0; }
    if (bot < h) { var b1 = Math.min(h, bot + rowsPer); rects.push({ y0: bot, y1: b1, x0: 0, x1: w }); bot = b1; }
  }
  return rects;
}

// Cut rects into AppMessage-sized pieces: { y, xb, stride, data }
function chunksFor(img, rects) {
  var out = [];
  var room = Math.max(64, watch.inbox - 110);
  rects.forEach(function (r) {
    var xb0, xb1;
    if (img.format === 1) { xb0 = r.x0 >> 1; xb1 = (r.x1 + 1) >> 1; }
    else { xb0 = r.x0 >> 3; xb1 = (r.x1 + 7) >> 3; }
    xb1 = Math.min(xb1, img.stride);
    var bw = xb1 - xb0;
    if (bw <= 0 || r.y1 <= r.y0) return;
    var rows = Math.max(1, Math.floor(room / bw));
    for (var y = r.y0; y < r.y1; y += rows) {
      var n = Math.min(rows, r.y1 - y);
      var data = new Array(n * bw);
      for (var i = 0; i < n; i++) {
        var so = (y + i) * img.stride + xb0;
        for (var j = 0; j < bw; j++) data[i * bw + j] = img.data[so + j];
      }
      out.push({ y: y, xb: xb0, stride: bw, data: data });
    }
  });
  return out;
}

// Send a picture. plan: from planImage; info: { zoom, heading, key }
// onBegin runs right after the start message is queued; onDone when every piece is delivered (or failed).
function pushImage(seq, img, plan, info, markers, opts) {
  opts = opts || {};
  var prev = wimg;
  var ref = prev && plan.ref && prev.id === plan.ref ? plan.ref : 0;
  var rects = null;
  if (ref && prev.valid && prev.key === info.key) rects = stripRects(plan.v, img.width, img.height);
  if (!rects) {
    msg.drop('map:');   // a whole new picture replaces anything still waiting
    rects = centerOutRects(img.width, img.height, Math.max(1, Math.floor((watch.inbox - 110) / img.stride)));
  }
  imgCounter = imgCounter % 30000 + 1;
  var cur = { id: imgCounter, c: plan.c, zoom: info.zoom, heading: info.heading, w: img.width, h: img.height,
              key: info.key, ok: true, valid: true };
  wimg = cur;
  var dict = {
    cmd: CMD.MAP_BEGIN, seq: seq, width: img.width, height: img.height, fmt: img.format,
    stride: img.stride, palette: img.palette, img: cur.id, ref: ref, vx: plan.v[0], vy: plan.v[1],
    idx: Math.round(plan.c[0]), mode: Math.round(plan.c[1]), num: info.zoom,
    num2: ((Math.round(info.heading || 0) % 360) + 360) % 360
  };
  if (opts.ack) dict.ack = panAck;
  var chunks = chunksFor(img, rects);
  var pending = chunks.length + 1;
  var finished = false;
  function oneDone(ok) {
    if (!ok) {
      cur.valid = false;
      scheduleRefresh();
    }
    if (--pending === 0 && !finished) {
      finished = true;
      if (opts.onDone) opts.onDone();
    }
  }
  msg.send(dict, 'map:' + seq, function (ok) {
    if (!ok) cur.ok = false;
    oneDone(ok);
  });
  if (markers) {
    var mk = encodeMarkers(markers.filter(Boolean));
    if (mk.length) send({ cmd: CMD.MARKERS, seq: seq, data: mk }, 'map:' + seq);
    else send({ cmd: CMD.MARKERS, seq: seq }, 'map:' + seq);
  }
  if (opts.onBegin) opts.onBegin();
  chunks.forEach(function (ch) {
    msg.send({ cmd: CMD.MAP_CHUNK, seq: seq, img: cur.id, offset: ch.y, num: ch.xb, stride: ch.stride, data: ch.data },
      'map:' + seq, oneDone);
  });
}

// view: {center, zoom, w, h (screen area), path?, gmarkers?}
// markers: array of {x,y,kind,index} or null. done(err) once the picture starts streaming.
function streamMap(seq, view, markers, done, quiet) {
  currentMapSeq = seq;
  var token = ++renderToken;
  var os = outSize(view.w, view.h);
  var c0 = geo.project(view.center[0], view.center[1], view.zoom);
  var plan = planImage(c0, view.zoom, 0, os[0], os[1]);
  var o = { c: plan.c, center: view.center, zoom: view.zoom, w: os[0], h: os[1], heading: 0,
            style: mapStyle(), format: watch.fmt, path: view.path, markers: view.gmarkers };
  refreshFn = function () { if (currentMapSeq === seq && !navState) streamMap(seq, view, markers, null, true); };
  tiles.get(o, function (err, img) {
    if (token !== renderToken || seq !== currentMapSeq) { if (done) done({ stale: true }); return; }
    if (err) {
      console.log('map error ' + JSON.stringify(err));
      if (!quiet && (err.code === P.ERR.NO_KEY || err.title)) sendError(err);
      if (done) done(err);
      return;
    }
    pushImage(seq, img, plan, { zoom: view.zoom, heading: 0, key: tiles.styleKey(o) }, markers, {
      ack: true,
      onBegin: function () { if (done) done(null); }
    });
    tiles.prefetchAround(o, true);
  });
}

// Each screen's map remembers where the user moved it
var views = {};      // kind -> { view, base, markers: fn(view) }
var lastKind = null;

function cloneView(v) {
  return { center: v.center.slice(), zoom: v.zoom, w: v.w, h: v.h, path: v.path, gmarkers: v.gmarkers };
}

function showView(seq, kind, base, markersFn, restore) {
  var st = views[kind];
  if (restore && st && st.view.w === base.w && st.view.h === base.h) {
    st.base = base;
    st.markers = markersFn;
  } else {
    st = views[kind] = { view: cloneView(base), base: base, markers: markersFn };
  }
  lastKind = kind;
  streamMap(seq, st.view, markersFn(st.view));
}

function onAdjust(p) {
  mirrorAdjust(p);
  if (navigator_ && navState) return navAdjust(p);
  var st = views[lastKind];
  if (!st) return;
  var v = cloneView(st.view);
  var dx = p.width || 0, dy = p.height || 0;
  switch (p.idx) {
    case P.ADJ.ZOOM_IN: v.zoom = Math.min(20, v.zoom + 1); break;
    case P.ADJ.ZOOM_OUT: v.zoom = Math.max(2, v.zoom - 1); break;
    case P.ADJ.PAN: {
      var q = geo.project(v.center[0], v.center[1], v.zoom);
      v.center = geo.unproject(q[0] + dx, q[1] + dy, v.zoom);
      break;
    }
    default:
      v = cloneView(st.base);
      if (lastKind === 'home' && me) v.center = me.slice();
      break;
  }
  st.view = v;
  streamMap(p.seq, v, st.markers(v));
}

function clampSize(w, h) {
  return [Math.max(16, Math.min(640, w || watch.w)), Math.max(16, Math.min(640, h || watch.h))];
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
function needKey() {
  if (google.hasKey()) return false;
  sendError({ code: P.ERR.NO_KEY, title: 'Setup needed', text: 'Add your Google Maps key in the Pebble app: Pebble Maps → Settings.' });
  return true;
}

function onHomeMap(p) {
  if (needKey()) return;
  var size = clampSize(p.width, p.height);
  var zoom = p.idx > 0 ? p.idx : 15;
  getLocation(20000, function (err, loc) {
    if (err) return sendError(err);
    showView(p.seq, 'home', { center: loc.slice(), zoom: zoom, w: size[0], h: size[1] }, function (v) {
      return [me ? markerFor(me, v, P.MK.ME) : null];
    }, p.mode === 1);
  });
}

function resultItems() {
  return results.map(function (r) {
    var bits = [];
    if (r.type) bits.push(r.type);
    if (me) bits.push(fmt.distance(geo.haversine(me, [r.lat, r.lng]), S.imperial));
    if (r.address) bits.push(r.address);
    return { title: fmt.clip(r.name, 46), sub: fmt.clip(bits.join(' · '), 62) };
  });
}

function onSearch(p) {
  if (needKey()) return;
  var query = String(p.text || '').trim();
  if (!query) return sendError({ code: P.ERR.NO_RESULTS, text: 'Say a place, like "coffee" or "public library".' });
  sendBusy('Searching for "' + fmt.clip(query, 30) + '"');
  getLocation(60000, function (err, loc) {
    google.searchText(query, err ? null : loc, function (e2, list) {
      if (e2) return sendError(e2);
      results = list;
      if (!list.length) return sendError({ code: P.ERR.NO_RESULTS, text: 'No results for "' + fmt.clip(query, 40) + '"' });
      sendList(P.LIST.RESULTS, resultItems());
    });
  });
}

// --- Suggestions while typing on the watch keyboard ------------------------
var suggestions = [];
var acToken = null, acTokenTime = 0;

function newToken() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
    var r = Math.random() * 16 | 0;
    return (ch === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}

function onAutocomplete(p) {
  if (!google.hasKey()) return;
  var text = String(p.text || '').trim();
  var reqId = p.idx || 0;
  if (!text) return;
  if (!acToken || p.mode === 1 || Date.now() - acTokenTime > 170000) {
    acToken = newToken();
    acTokenTime = Date.now();
  }
  getLocation(120000, function (err, loc) {
    google.autocomplete(text, err ? null : loc, acToken, function (e2, list) {
      if (e2) { console.log('autocomplete: ' + (e2.text || e2.title)); list = []; }
      suggestions = list.slice(0, 5);
      var items = suggestions.map(function (sg) {
        var bits = [];
        if (sg.distance !== undefined) bits.push(fmt.distance(sg.distance, S.imperial));
        if (sg.address) bits.push(sg.address);
        return { title: fmt.clip(sg.name, 46), sub: fmt.clip(bits.join(' · '), 62) };
      });
      send({ cmd: CMD.LIST, num: P.LIST.SUGGEST, idx: reqId, list: fmt.packList(items) || '' });
    });
  });
}

function onNearby(p) {
  if (needKey()) return;
  var cat = P.CATEGORIES[p.idx] || P.CATEGORIES[0];
  sendBusy('Finding ' + cat.name.toLowerCase());
  getLocation(60000, function (err, loc) {
    if (err) return sendError(err);
    google.searchNearby(cat, loc, function (e2, list) {
      if (e2) return sendError(e2);
      results = list;
      if (!list.length) return sendError({ code: P.ERR.NO_RESULTS, text: 'No ' + cat.name.toLowerCase() + ' found nearby.' });
      sendList(P.LIST.RESULTS, resultItems());
    });
  });
}

function onResultsMap(p) {
  if (!results.length) return;
  var size = clampSize(p.width, p.height);
  var restore = p.mode >= 10000;
  var bottom = (p.mode > 0 ? p.mode : 60) % 10000;
  var pts = results.map(function (r) { return [r.lat, r.lng]; });
  var fit = geo.fitBounds(pts, size[0], size[1], { top: 52, bottom: bottom + 4, left: 16, right: 16 }, 16);
  var list = results;
  showView(p.seq, 'results', { center: fit.center, zoom: fit.zoom, w: size[0], h: size[1] }, function (v) {
    var markers = list.map(function (r, i) { return markerFor([r.lat, r.lng], v, P.MK.PIN, i); });
    if (me) markers.unshift(markerFor(me, v, P.MK.ME));
    return markers;
  }, restore);
}

// Resolve the chosen destination's coordinates (favorites may only have an address)
function withDest(cb) {
  if (!dest) return cb({ code: P.ERR.API, text: 'Pick a place first.' });
  if (dest.lat !== undefined && dest.lat !== null && !isNaN(dest.lat)) return cb(null, dest);
  if (destWaiters) { destWaiters.push(cb); return; }
  destWaiters = [cb];
  var target = dest;
  function finish(err) {
    var w = destWaiters;
    destWaiters = null;
    w.forEach(function (fn) { fn(err, err ? null : target); });
  }
  if (target.fromSuggest && target.placeId) {
    // a place picked from the typing suggestions: ask Google where it is
    var token = acToken;
    acToken = null;
    return google.placeDetails(target.placeId, token, function (e0, pl) {
      if (e0 || !pl || pl.lat === undefined) return finish(e0 || { code: P.ERR.NO_RESULTS, text: 'Couldn\'t find that place.' });
      target.lat = pl.lat;
      target.lng = pl.lng;
      target.fullAddress = pl.fullAddress;
      target.type = pl.type;
      if (pl.name) target.name = pl.name;
      finish(null);
    });
  }
  google.geocode(target.address || target.name, function (err, g) {
    if (!err && g) {
      target.lat = g.lat;
      target.lng = g.lng;
      target.placeId = target.placeId || g.placeId;
      target.fullAddress = g.address;
      if (target.favIndex !== undefined) settings.updateFavoriteLocation(target.favIndex, g);
      return finish(null);
    }
    // fall back to a place search (handles names like "Riverfront Park")
    google.searchText(target.address || target.name, me, function (e2, list) {
      if (!e2 && list && list.length) {
        target.lat = list[0].lat;
        target.lng = list[0].lng;
        target.placeId = target.placeId || list[0].placeId;
        if (target.favIndex !== undefined) settings.updateFavoriteLocation(target.favIndex, list[0]);
        return finish(null);
      }
      finish(err || e2 || { code: P.ERR.NO_RESULTS, title: 'Address not found', text: 'Google couldn\'t find "' + fmt.clip(target.address || target.name, 60) + '". Check the address in Settings.' });
    });
  });
}

function destMode(d) {
  if (d && d.favIndex !== undefined) {
    var f = settings.favorites()[d.favIndex];
    return settings.favMode(f, S);
  }
  return S.defaultMode;
}

function sendPlace() {
  withDest(function (err, d) {
    if (err) return sendError(err);
    var distText = me ? fmt.distance(geo.haversine(me, [d.lat, d.lng]), S.imperial) + ' away' : '';
    send({
      cmd: CMD.PLACE,
      text: fmt.clip(d.name || d.address, 60),
      text2: fmt.clip(d.type || (d.favIndex !== undefined ? 'Favorite' : ''), 40),
      text3: fmt.clip(d.fullAddress || d.address || '', 90),
      text4: distText,
      flags: settings.findFavorite(d) >= 0 ? 1 : 0,
      mode: destMode(d)
    });
  });
}

function onSelect(p) {
  var src = p.mode, idx = p.idx;
  var d = null;
  if (src === P.SRC.RESULTS) d = results[idx];
  else if (src === P.SRC.FAVS) {
    var f = settings.favorites()[idx];
    if (f) {
      d = JSON.parse(JSON.stringify(f));
      d.favIndex = idx;
      if (f.geocodedFrom !== undefined && f.geocodedFrom !== f.address) { d.lat = undefined; d.lng = undefined; }
      if (f.lat === undefined || f.lat === null || f.lat === '') { d.lat = undefined; d.lng = undefined; }
    }
  } else if (src === P.SRC.RECENTS) d = settings.recents()[idx];
  else if (src === P.SRC.SUGGEST && suggestions[idx]) {
    var sg = suggestions[idx];
    d = { name: sg.name, address: sg.address, placeId: sg.placeId, fromSuggest: true };
  }
  if (!d) return sendError({ code: P.ERR.API, text: 'That place is no longer available.' });
  dest = d;
  route = null;
  sendPlace();
}

function onPlaceMap(p) {
  var size = clampSize(p.width, p.height);
  withDest(function (err, d) {
    if (err) return;
    // move the pin down a little so its body is centered
    var q = geo.project(d.lat, d.lng, 16);
    var base = { center: geo.unproject(q[0], q[1] - 10, 16), zoom: 16, w: size[0], h: size[1] };
    showView(p.seq, 'place', base, function (v) {
      var markers = [markerFor([d.lat, d.lng], v, P.MK.DEST)];
      if (me) markers.unshift(markerFor(me, v, P.MK.ME));
      return markers;
    }, false);
  });
}

function prefs() {
  return { imperial: S.imperial, avoidTolls: S.avoidTolls, avoidHighways: S.avoidHighways, avoidFerries: S.avoidFerries };
}

function onModeTimes() {
  withDest(function (err, d) {
    if (err) return sendError(err);
    var items = P.MODE_NAMES.map(function (n) { return { title: n, sub: '' }; });
    if (!S.allModeTimes) return sendList(P.LIST.MODES, items);
    getLocation(60000, function (e1, loc) {
      if (e1) return sendList(P.LIST.MODES, items);
      var pending = 4;
      [0, 1, 2, 3].forEach(function (mode) {
        google.computeRoute(loc, d, mode, prefs(), false, function (e2, r) {
          if (e2 || !r) items[mode].sub = e2 && e2.code === P.ERR.NO_RESULTS ? 'Not available here' : 'Unavailable';
          else items[mode].sub = fmt.duration(fmt.seconds(r.duration)) + ' · ' + fmt.distance(r.distanceMeters, S.imperial);
          if (--pending === 0) sendList(P.LIST.MODES, items);
        });
      });
    });
  });
}

function getRoute(mode, force, cb) {
  withDest(function (err, d) {
    if (err) return cb(err);
    getLocation(15000, function (e1, loc) {
      if (e1) return cb(e1);
      var key = [d.lat.toFixed(5), d.lng.toFixed(5), mode].join(',');
      if (!force && route && routeKey === key && Date.now() - routeTime < 180000 &&
          geo.haversine(route.points[0] || loc, loc) < 150) {
        return cb(null, route);
      }
      google.computeRoute(loc, d, mode, prefs(), true, function (e2, r) {
        if (e2) return cb(e2);
        route = nav.buildRoute(r, mode, d);
        routeKey = key;
        routeTime = Date.now();
        cb(null, route);
      });
    });
  });
}

function routeExtra(rt) {
  var tr = rt.steps.filter(function (s) { return s.transit; })[0];
  if (tr) {
    var t = tr.transit;
    return fmt.clip(t.line + (t.departs ? ' at ' + t.departs : '') + (t.from ? ' from ' + t.from : ''), 60);
  }
  if (rt.hasTolls) return 'Route has tolls';
  return '';
}

function onRoute(p) {
  var mode = p.mode >= 0 && p.mode <= 3 ? p.mode : S.defaultMode;
  var size = clampSize(p.width, p.height);
  sendBusy('Getting directions');
  getRoute(mode, false, function (err, rt) {
    if (err) return sendError(err);
    settings.addRecent(rt.dest);
    var traffic = 0;
    if (mode === P.MODE.DRIVE && rt.staticDuration > 0) {
      var ratio = rt.duration / rt.staticDuration;
      traffic = ratio > 1.35 ? 2 : (ratio > 1.12 ? 1 : 0);
    }
    send({
      cmd: CMD.ROUTE_INFO,
      text: fmt.duration(rt.duration),
      text2: fmt.distance(rt.distanceMeters || rt.total, S.imperial),
      text3: rt.description ? fmt.clip('via ' + rt.description, 60) : fmt.clip('to ' + (rt.dest.name || ''), 60),
      text4: routeExtra(rt),
      num2: Math.round(Date.now() / 1000 + rt.duration),
      flags: traffic,
      mode: mode
    });
    var pts = rt.points.length ? rt.points : [me, [rt.dest.lat, rt.dest.lng]];
    var fit = geo.fitBounds(pts, size[0], size[1], { top: 34, bottom: 14, left: 14, right: 14 }, 17);
    var base = { center: fit.center, zoom: fit.zoom, w: size[0], h: size[1], path: geo.thin(pts, 600) };
    showView(p.seq, 'route', base, function (v) {
      return [markerFor(pts[0], v, P.MK.START), markerFor(pts[pts.length - 1], v, P.MK.DEST)];
    }, false);
  });
}

function onSteps() {
  var rt = (navigator_ && navigator_.route) || route;
  if (!rt) return sendList(P.LIST.STEPS, []);
  sendList(P.LIST.STEPS, nav.stepList(rt, S.imperial).slice(0, 40));
}

// --- Navigation ------------------------------------------------------------
// The navigation map follows you. The phone cuts it out of a big Google
// picture, turned so your direction of travel points up (or north-up), and
// sends a fresh one only when you turn or get near its edge. In between, the
// watch slides the picture under your position arrow.
var navState = null;

function navBaseZoom(mode) {
  return mode === P.MODE.DRIVE ? 16 : (mode === P.MODE.WALK ? 17 : 16);
}

function angleDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// screen offset (dx,dy) -> world offset, for a picture turned to heading h
function toWorld(dx, dy, h) {
  var a = geo.rad(h), c = Math.cos(a), s = Math.sin(a);
  return [dx * c - dy * s, dx * s + dy * c];
}
function toScreenOffset(wx, wy, h) {
  var a = geo.rad(h), c = Math.cos(a), s = Math.sin(a);
  return [wx * c + wy * s, -wx * s + wy * c];
}

function navZoom() {
  return Math.max(3, Math.min(20, navBaseZoom(navigator_.route.mode) + navState.zoomDelta));
}

// Where the screen should be focused right now (world pixels) and the picture turn
function navTarget() {
  var st = navState, r = navigator_.route;
  if (st.overview) {
    var pts = r.points.length ? r.points : [navigator_.pos];
    var fit = geo.fitBounds(pts, st.w, st.h, { top: 24, bottom: 24, left: 16, right: 16 }, 17);
    return { zoom: fit.zoom, focus: geo.project(fit.center[0], fit.center[1], fit.zoom), heading: 0, follow: false };
  }
  var z = navZoom();
  var heading = st.headingUp ? (navigator_.heading || 0) : 0;
  if (st.pan) {
    return { zoom: z, focus: geo.project(st.pan[0], st.pan[1], z), heading: st.panHeading, follow: false };
  }
  // look ahead: your arrow sits a bit below the middle
  var pos = geo.project(navigator_.pos[0], navigator_.pos[1], z);
  var hd = geo.rad(navigator_.heading || 0);
  var ahead = 0.10 * st.h;
  return { zoom: z, focus: [pos[0] + Math.sin(hd) * ahead, pos[1] - Math.cos(hd) * ahead], heading: heading, follow: true };
}

// Fill NAV message with arrow / focus positions inside the picture the watch has
function navAugment(d) {
  var st = navState;
  if (!st || !st.shown || !wimg || !navigator_ || !navigator_.pos) return d;
  var sh = wimg;
  var pos = geo.project(navigator_.pos[0], navigator_.pos[1], sh.zoom);
  var pv = toScreenOffset(pos[0] - sh.c[0], pos[1] - sh.c[1], sh.heading);
  d.width = Math.round(pv[0] + sh.w / 2);
  d.height = Math.round(pv[1] + sh.h / 2);
  var t = navTarget();
  if (t.zoom === sh.zoom && !st.overview) {
    var fv = toScreenOffset(t.focus[0] - sh.c[0], t.focus[1] - sh.c[1], sh.heading);
    d.stride = Math.round(fv[0] + sh.w / 2);
    d.total = Math.round(fv[1] + sh.h / 2);
  } else {
    d.stride = Math.round(sh.w / 2);
    d.total = Math.round(sh.h / 2);
  }
  d.offset = Math.round((((navigator_.heading || 0) - sh.heading) % 360 + 360) % 360);
  d.mode = ((Math.round(sh.heading) % 360) + 360) % 360;
  d.img = sh.id;
  d.ack = panAck;
  return d;
}

function navNeedsRender(t) {
  var st = navState, sh = st.shown, w = wimg;
  if (!sh || !w || w.zoom !== t.zoom || sh.follow !== t.follow || sh.overview !== st.overview) return true;
  if (angleDiff(w.heading, t.heading) > 15) return true;
  // how far the focus point has slid inside the picture
  var fv = toScreenOffset(t.focus[0] - w.c[0], t.focus[1] - w.c[1], w.heading);
  var mx = (w.w - st.w) / 2, my = (w.h - st.h) / 2;
  var ahead = 0.22 * st.h;   // the picture reaches this much further ahead of the focus
  var v = [fv[0], fv[1] - (sh.follow ? ahead : 0)];
  return Math.abs(v[0]) > mx + 0.12 * st.w || v[1] < -(my + ahead - 4) || v[1] > my + 0.15 * st.h;
}

function navRender(force) {
  var st = navState;
  if (!st || !navigator_ || !navigator_.pos || navigator_.arrived) return;
  var t = navTarget();
  if (!force && !navNeedsRender(t)) return;
  if (st.streaming && !force) { st.pending = true; return; }
  var r = navigator_.route;
  var d = r.dest;
  // keep the picture's turn while the heading only drifts a little: the watch can then just slide it
  var heading = t.heading;
  if (wimg && wimg.zoom === t.zoom && angleDiff(wimg.heading, heading) <= 15) heading = wimg.heading;
  // picture center: a little further ahead than the focus, so there is map in front of you
  var shift = t.follow ? toWorld(0, -0.22 * st.h, heading) : [0, 0];
  var c = [t.focus[0] + shift[0], t.focus[1] + shift[1]];
  var os = outSize(st.w, st.h);
  var plan = planImage(c, t.zoom, heading, os[0], os[1]);
  var seq = st.seq;
  var token = ++renderToken;
  st.streaming = true;
  st.pending = false;
  clearTimeout(st.streamTimer);
  st.streamTimer = setTimeout(function () { if (navState) navState.streaming = false; }, 9000);
  var view = { zoom: t.zoom, heading: heading, focus: t.focus, follow: t.follow, overview: st.overview };
  currentMapSeq = seq;
  refreshFn = function () { if (navState && navState.seq === seq) { navState.streaming = false; navRender(true); } };
  var o = {
    c: plan.c, center: geo.unproject(plan.c[0], plan.c[1], t.zoom), zoom: t.zoom, w: os[0], h: os[1], heading: heading,
    style: mapStyle(), format: watch.fmt, path: geo.thin(r.points, 300),
    markers: d ? ['size:small|color:red|' + d.lat.toFixed(6) + ',' + d.lng.toFixed(6)] : null,
    ahead: t.follow ? toWorld(0, -1, navigator_.heading || 0) : null
  };
  tiles.get(o, function (err, img) {
    if (!navState || navState.seq !== seq || token !== renderToken) return;
    if (err) { navState.streaming = false; return; }
    pushImage(seq, img, plan, { zoom: t.zoom, heading: heading, key: tiles.styleKey(o) }, null, {
      onBegin: function () {
        navState.shown = view;
        if (navigator_ && navigator_.lastDict) send(navAugment(JSON.parse(JSON.stringify(navigator_.lastDict))), 'nav');
      },
      onDone: function () {
        if (!navState) return;
        navState.streaming = false;
        if (navState.pending) navRender(false);
      }
    });
  });
}

function navSend(d) {
  if (d.cmd === CMD.NAV && !(d.flags & P.NAV_FLAG.ARRIVED)) {
    navRender(false);
    navAugment(d);
  }
  send(d, 'nav');
}

function navAdjust(p) {
  var st = navState;
  if (!navigator_ || !navigator_.pos) return;
  st.seq = p.seq;
  switch (p.idx) {
    case P.ADJ.ZOOM_IN: st.zoomDelta = Math.min(4, st.zoomDelta + 1); break;
    case P.ADJ.ZOOM_OUT: st.zoomDelta = Math.max(-6, st.zoomDelta - 1); break;
    case P.ADJ.PAN: {
      var t = navTarget();
      var sh = st.shown;
      var h = sh ? sh.heading : t.heading;
      var w = toWorld(p.width || 0, p.height || 0, h);
      var z = t.zoom;
      if (st.overview) { st.zoomDelta = z - navBaseZoom(navigator_.route.mode); st.overview = false; }
      st.pan = geo.unproject(t.focus[0] + w[0], t.focus[1] + w[1], z);
      st.panHeading = h;
      break;
    }
    case P.ADJ.FIT_ROUTE: st.overview = true; st.pan = null; break;
    default: st.pan = null; st.overview = false; break;
  }
  st.streaming = false;
  navRender(true);
}

function onNavView(p) {
  if (!navState) return;
  navState.headingUp = p.idx === 1;
  if (p.seq !== undefined) navState.seq = p.seq;
  navState.streaming = false;
  navRender(true);
}

function stopNav() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  if (gpsTimer) { clearInterval(gpsTimer); gpsTimer = null; }
  navigator_ = null;
  if (navState) clearTimeout(navState.streamTimer);
  navState = null;
  refreshFn = null;
}

function startSimulation() {
  // Test mode only: drive along the route
  var speed = { 0: 22, 1: 6, 2: 10, 3: 14 }[navigator_.route.mode] || 10;
  var s = 0;
  simTimer = setInterval(function () {
    if (!navigator_) return;
    var r = navigator_.route;
    s += speed;
    var i = 0;
    while (i < r.cum.length - 2 && r.cum[i + 1] < s) i++;
    var segLen = Math.max(1, r.cum[i + 1] - r.cum[i]);
    var t = Math.min(1, (s - r.cum[i]) / segLen);
    var a = r.points[i], b = r.points[i + 1] || a;
    me = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    navigator_.update(me, 5);
    if (navigator_ && navigator_.arrived) { clearInterval(simTimer); simTimer = null; }
  }, dev.simInterval || 1000);
}

function onNavStart(p) {
  stopNav();
  var mode = p.mode >= 0 && p.mode <= 3 ? p.mode : S.defaultMode;
  navState = { seq: p.seq, w: clampSize(p.width, p.height)[0], h: clampSize(p.width, p.height)[1],
    zoomDelta: 0, pan: null, panHeading: 0, overview: false, shown: null, streaming: false, pending: false,
    headingUp: p.num !== 0 };
  getRoute(mode, false, function (err, rt) {
    if (err) return sendError(err);
    navigator_ = new nav.Navigator({
      route: rt,
      view: { w: p.width > 0 ? p.width : watch.w, h: p.height > 0 ? p.height : watch.h - 100 },
      settings: S,
      send: navSend,
      reroute: function (pos, cb) {
        google.computeRoute(pos, rt.dest, mode, prefs(), true, function (e2, r) {
          if (e2) return cb(e2);
          route = nav.buildRoute(r, mode, rt.dest);
          routeTime = Date.now();
          cb(null, route);
          setTimeout(function () { if (navState) { navState.streaming = false; navRender(true); } }, 0);  // redraw the new route line
        });
      },
      onArrive: function () {
        setTimeout(stopNav, 1000);
      }
    });
    if (me) navigator_.update(me, meAcc);
    if (dev.simLocation) return startSimulation();
    watchId = navigator.geolocation.watchPosition(function (pos) {
      me = [pos.coords.latitude, pos.coords.longitude];
      meAcc = pos.coords.accuracy || 30;
      meTime = Date.now();
      if (navigator_) navigator_.update(me, meAcc);
    }, function (e) {
      console.log('watchPosition error ' + (e && e.message));
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    gpsTimer = setInterval(function () {
      if (navigator_ && !navigator_.arrived && Date.now() - navigator_.lastFix > 20000) navigator_.noGps();
    }, 10000);
  });
}

// --- Favorites --------------------------------------------------------------
function onFavList() {
  var favs = settings.favorites();
  sendList(P.LIST.FAVS, favs.map(function (f) {
    var m = parseInt(f.mode, 10);
    var modeText = isNaN(m) ? P.MODE_NAMES[S.defaultMode] + ' (default)' : P.MODE_NAMES[m];
    return { title: fmt.clip(f.name || f.address, 46), sub: fmt.clip(modeText + (f.address && f.name ? ' · ' + f.address : ''), 62) };
  }));
  sendList(P.LIST.RECENTS, settings.recents().map(function (r) {
    return { title: fmt.clip(r.name, 46), sub: fmt.clip(r.address || r.type || '', 62) };
  }));
}

function onFavToggle() {
  if (!dest) return;
  withDest(function (err, d) {
    if (err) return sendError(err);
    var i = settings.findFavorite(d);
    if (i >= 0) {
      settings.removeFavorite(i);
      if (d.favIndex !== undefined) delete d.favIndex;
      toast('Removed from favorites');
    } else {
      settings.addFavorite(d);
      d.favIndex = settings.findFavorite(d);
      toast('Saved to favorites');
    }
  });
}

function onSaveHere() {
  getLocation(5000, function (err, loc) {
    if (err) return sendError(err);
    google.reverseGeocode(loc, function (e2, g) {
      var addr = (!e2 && g && g.address) || (loc[0].toFixed(5) + ', ' + loc[1].toFixed(5));
      var name = addr.split(',')[0];
      var place = { name: name, address: addr, lat: loc[0], lng: loc[1], placeId: (g && g.placeId) || '' };
      if (!settings.addFavorite(place)) return toast('Already saved');
      toast('Saved ' + fmt.clip(name, 30));
    });
  });
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------
function onMessage(e) {
  var p = e.payload || {};
  var cmd = p.cmd;
  try {
    switch (cmd) {
      case CMD.HELLO:
        watch.w = p.width || watch.w;
        watch.h = p.height || watch.h;
        watch.fmt = p.num === 0 ? 0 : 1;
        watch.mic = !!(p.mode & 1);
        watch.round = !!(p.mode & 2);
        watch.touch = !!(p.mode & 4);
        watch.inbox = p.idx > 0 ? p.idx : 4096;
        if (p.text && /^\d+,\d+$/.test(p.text)) {
          buf.w = parseInt(p.text.split(',')[0], 10);
          buf.h = parseInt(p.text.split(',')[1], 10);
        } else {
          buf.w = watch.w;
          buf.h = watch.h;
        }
        sendStatus();
        break;
      case CMD.HOME_MAP: wimg = null; onHomeMap(p); break;
      case CMD.SEARCH: onSearch(p); break;
      case CMD.NEARBY: onNearby(p); break;
      case CMD.AUTOCOMPLETE: onAutocomplete(p); break;
      case CMD.RESULTS_MAP: wimg = null; onResultsMap(p); break;
      case CMD.SELECT: onSelect(p); break;
      case CMD.PLACE_MAP: wimg = null; onPlaceMap(p); break;
      case CMD.MODE_TIMES: onModeTimes(); break;
      case CMD.ROUTE: wimg = null; onRoute(p); break;
      case CMD.STEPS: onSteps(); break;
      case CMD.NAV_START: wimg = null; onNavStart(p); break;
      case CMD.NAV_STOP: stopNav(); break;
      case CMD.FAV_LIST: onFavList(); break;
      case CMD.FAV_TOGGLE: onFavToggle(); break;
      case CMD.FAV_DELETE:
        settings.removeFavorite(p.idx);
        toast('Favorite removed');
        break;
      case CMD.FAV_SETMODE:
        settings.setFavoriteMode(p.idx, p.mode);
        toast(p.mode === P.MODE_USE_DEFAULT ? 'Uses app default' : 'Default: ' + P.MODE_NAMES[p.mode]);
        break;
      case CMD.SAVE_HERE: onSaveHere(); break;
      case CMD.MAP_ADJUST: onAdjust(p); break;
      case CMD.NAV_VIEW: onNavView(p); break;
      default:
        break;
    }
  } catch (ex) {
    console.log('Error handling ' + cmd + ': ' + ex + ' ' + (ex.stack || ''));
    sendError({ code: P.ERR.API, text: 'Phone error: ' + ex.message });
  }
}

Pebble.addEventListener('ready', function () {
  reloadSettings();
  if (dev.simLocation) me = dev.simLocation.slice();
  sendStatus();
  // warm up the location so the first map is quick
  if (google.hasKey() && !dev.simLocation) getLocation(0, function () {});
});

Pebble.addEventListener('appmessage', onMessage);

// ---------------------------------------------------------------------------
// Settings page (Clay)
// ---------------------------------------------------------------------------
Pebble.addEventListener('showConfiguration', function () {
  clay.meta = clay.meta || {};
  clay.meta.userData = {
    lat: me ? me[0] : null,
    lng: me ? me[1] : null,
    color: watch.fmt === 1
  };
  try {
    clay.meta.activeWatchInfo = Pebble.getActiveWatchInfo ? Pebble.getActiveWatchInfo() : null;
    clay.meta.accountToken = Pebble.getAccountToken ? Pebble.getAccountToken() : '';
    clay.meta.watchToken = Pebble.getWatchToken ? Pebble.getWatchToken() : '';
  } catch (e) { /* not available in every app */ }
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) return;
  var oldKey = S.apiKey;
  try {
    clay.getSettings(e.response, false);
  } catch (ex) {
    console.log('settings parse error ' + ex);
    return;
  }
  reloadSettings();
  tiles.clear();
  route = null;
  sendStatus();
  if (google.hasKey() && S.apiKey !== oldKey) {
    toast('Checking your key...');
    google.checkKey(me, function (res) {
      var bad = res.filter(function (r) { return !r.ok; });
      if (!bad.length) return toast('Your Google key works!');
      var first = bad[0];
      var names = bad.map(function (b) { return b.name; }).join(', ');
      sendError({
        code: first.error && first.error.code === P.ERR.NO_KEY ? P.ERR.NO_KEY : P.ERR.API,
        title: first.error && first.error.title ? first.error.title : 'Key needs a fix',
        text: (first.error && first.error.text ? first.error.text + ' ' : '') + '(Not working: ' + names + ')'
      });
    });
  }
});

module.exports = { _test: { onMessage: onMessage, state: function () { return { results: results, dest: dest, route: route }; } } };
