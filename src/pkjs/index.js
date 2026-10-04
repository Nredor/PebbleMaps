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
var imageCache = [];      // [{url, img}]
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

function sendList(kind, items) {
  send({ cmd: CMD.LIST, num: kind, list: fmt.packList(items) || '' });
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

function getImage(opts, cb) {
  var u = google.staticMapUrl(opts) + '#' + watch.fmt;
  for (var i = 0; i < imageCache.length; i++) {
    if (imageCache[i].url === u) return cb(null, imageCache[i].img);
  }
  google.staticMap(opts, function (err, bytes) {
    if (err) return cb(err);
    var img;
    try {
      img = image.convert(image.decodePNG(bytes), watch.fmt);
    } catch (e) {
      return cb({ code: P.ERR.API, title: 'Map problem', text: 'Couldn\'t read the map picture from Google (' + e.message + ').' });
    }
    imageCache.unshift({ url: u, img: img });
    if (imageCache.length > 6) imageCache.pop();
    cb(null, img);
  });
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
  if (s[0] < -30 || s[1] < -30 || s[0] > view.w + 30 || s[1] > view.h + 30) return null;
  return { x: s[0], y: s[1], kind: kind, index: index || 0 };
}

// view: {center, zoom, w, h, path?, gmarkers?}; markers: array of {x,y,kind,index} or null
// done(err) is called once the picture starts streaming (or failed)
function streamMap(seq, view, markers, done, quiet) {
  currentMapSeq = seq;
  msg.drop('map:');
  getImage({ center: view.center, zoom: view.zoom, w: view.w, h: view.h, style: mapStyle(), path: view.path,
    markers: view.gmarkers }, function (err, img) {
    if (seq !== currentMapSeq) { if (done) done({ stale: true }); return; }
    if (err) {
      console.log('map error ' + JSON.stringify(err));
      if (!quiet && (err.code === P.ERR.NO_KEY || err.title)) sendError(err);
      if (done) done(err);
      return;
    }
    send({
      cmd: CMD.MAP_BEGIN, seq: seq, width: img.width, height: img.height, fmt: img.format,
      stride: img.stride, palette: img.palette, total: img.data.length
    }, 'map:' + seq);
    if (markers) {
      var mk = encodeMarkers(markers.filter(Boolean));
      if (mk.length) send({ cmd: CMD.MARKERS, seq: seq, data: mk }, 'map:' + seq);
      else send({ cmd: CMD.MARKERS, seq: seq }, 'map:' + seq);
    }
    if (done) done(null);
    var rows = Math.max(1, Math.floor((watch.inbox - 80) / img.stride));
    var chunk = rows * img.stride;
    for (var off = 0; off < img.data.length; off += chunk) {
      var part = img.data.subarray(off, Math.min(img.data.length, off + chunk));
      send({ cmd: CMD.MAP_CHUNK, seq: seq, offset: off, data: Array.prototype.slice.call(part) }, 'map:' + seq);
    }
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
// The navigation map follows you. It is a Google map picture centered a bit
// ahead of you; the watch slides it under your position arrow and asks for a
// new picture only when you get near its edge.
var navState = null;

function navBaseZoom(mode) {
  return mode === P.MODE.DRIVE ? 16 : (mode === P.MODE.WALK ? 17 : 16);
}

function navAugment(d) {
  var st = navState;
  if (!st || !st.shown || !navigator_ || !navigator_.pos) return d;
  var sh = st.shown;
  var pk = geo.toScreen(navigator_.pos, sh.center, sh.zoom, sh.w, sh.h);
  d.width = pk[0];
  d.height = pk[1];
  if (sh.follow) {
    d.stride = pk[0];
    d.total = pk[1];
  } else {
    d.stride = Math.round(sh.w / 2);
    d.total = Math.round(sh.h / 2);
  }
  d.offset = Math.round(navigator_.heading || 0);
  return d;
}

function navWanted() {
  var st = navState, r = navigator_.route;
  var w = st.w, h = st.h;
  var z = Math.max(3, Math.min(20, navBaseZoom(r.mode) + st.zoomDelta));
  if (st.overview) {
    var pts = r.points.length ? r.points : [navigator_.pos];
    var fit = geo.fitBounds(pts, w, h, { top: 24, bottom: 24, left: 16, right: 16 }, 17);
    return { center: fit.center, zoom: fit.zoom, follow: false };
  }
  if (st.pan) return { center: st.pan, zoom: z, follow: false };
  var pos = navigator_.pos;
  var look = 0.22 * Math.min(w, h);
  var q = geo.project(pos[0], pos[1], z);
  var hd = geo.rad(navigator_.heading || 0);
  return { center: geo.unproject(q[0] + Math.sin(hd) * look, q[1] - Math.cos(hd) * look, z), zoom: z, follow: true };
}

function navMaybeFetch(force) {
  var st = navState;
  if (!st || !navigator_ || !navigator_.pos || navigator_.arrived) return;
  var want = navWanted();
  var sh = st.shown;
  if (!force && sh) {
    if (st.fetching) return;
    if (want.follow && sh.follow && sh.zoom === want.zoom) {
      var pk = geo.toScreen(navigator_.pos, sh.center, sh.zoom, sh.w, sh.h);
      var dx = pk[0] - sh.w / 2, dy = pk[1] - sh.h / 2;
      if (Math.sqrt(dx * dx + dy * dy) < 0.3 * Math.min(sh.w, sh.h)) return;
      if (Date.now() - st.lastFetch < 3000) return;
    } else if (!want.follow && !sh.follow && sh.zoom === want.zoom &&
               Math.abs(sh.center[0] - want.center[0]) < 1e-7 && Math.abs(sh.center[1] - want.center[1]) < 1e-7) {
      return;
    }
  }
  var r = navigator_.route;
  var d = r.dest;
  var view = {
    center: want.center, zoom: want.zoom, w: st.w, h: st.h, follow: want.follow,
    path: geo.thin(r.points, 300),
    gmarkers: d ? ['size:small|color:red|' + d.lat.toFixed(6) + ',' + d.lng.toFixed(6)] : null
  };
  st.fetching = true;
  st.lastFetch = Date.now();
  var seq = st.seq;
  streamMap(seq, view, null, function (err) {
    if (!navState || navState.seq !== seq) return;
    navState.fetching = false;
    if (err) return;
    navState.shown = view;
    if (navigator_ && navigator_.lastDict) send(navAugment(JSON.parse(JSON.stringify(navigator_.lastDict))), 'nav');
  }, true);
}

function navSend(d) {
  if (d.cmd === CMD.NAV && !(d.flags & P.NAV_FLAG.ARRIVED)) {
    navMaybeFetch(false);
    navAugment(d);
  }
  send(d, 'nav');
}

function navAdjust(p) {
  var st = navState;
  if (!navigator_ || !navigator_.pos) return;
  st.seq = p.seq;
  var z = Math.max(3, Math.min(20, navBaseZoom(navigator_.route.mode) + st.zoomDelta));
  switch (p.idx) {
    case P.ADJ.ZOOM_IN: st.zoomDelta = Math.min(4, st.zoomDelta + 1); break;
    case P.ADJ.ZOOM_OUT: st.zoomDelta = Math.max(-6, st.zoomDelta - 1); break;
    case P.ADJ.PAN: {
      var from = st.pan || (st.overview && st.shown ? st.shown.center : navigator_.pos);
      var zz = st.overview && st.shown ? st.shown.zoom : z;
      var q = geo.project(from[0], from[1], zz);
      st.pan = geo.unproject(q[0] + (p.width || 0), q[1] + (p.height || 0), zz);
      if (st.overview) { st.zoomDelta = zz - navBaseZoom(navigator_.route.mode); st.overview = false; }
      break;
    }
    case P.ADJ.FIT_ROUTE: st.overview = true; st.pan = null; break;
    default: st.pan = null; st.overview = false; break;
  }
  navMaybeFetch(true);
}

function stopNav() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  if (gpsTimer) { clearInterval(gpsTimer); gpsTimer = null; }
  navigator_ = null;
  navState = null;
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
    zoomDelta: 0, pan: null, overview: false, shown: null, fetching: false, lastFetch: 0 };
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
          setTimeout(function () { navMaybeFetch(true); }, 0);  // redraw the new route line
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
        sendStatus();
        break;
      case CMD.HOME_MAP: onHomeMap(p); break;
      case CMD.SEARCH: onSearch(p); break;
      case CMD.NEARBY: onNearby(p); break;
      case CMD.RESULTS_MAP: onResultsMap(p); break;
      case CMD.SELECT: onSelect(p); break;
      case CMD.PLACE_MAP: onPlaceMap(p); break;
      case CMD.MODE_TIMES: onModeTimes(); break;
      case CMD.ROUTE: onRoute(p); break;
      case CMD.STEPS: onSteps(); break;
      case CMD.NAV_START: onNavStart(p); break;
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
  imageCache = [];
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
