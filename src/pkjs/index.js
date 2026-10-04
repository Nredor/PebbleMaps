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
    flags: (S.imperial ? 1 : 0) | (S.vibrate ? 2 : 0)
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

// view: {center, zoom, w, h, path?}; markers: array of {x,y,kind,index}
function streamMap(seq, view, markers) {
  currentMapSeq = seq;
  msg.drop('map:');
  var mk = encodeMarkers(markers.filter(Boolean));
  if (mk.length) send({ cmd: CMD.MARKERS, seq: seq, data: mk }, 'map:' + seq);
  else send({ cmd: CMD.MARKERS, seq: seq }, 'map:' + seq);
  getImage({ center: view.center, zoom: view.zoom, w: view.w, h: view.h, style: mapStyle(), path: view.path },
    function (err, img) {
      if (seq !== currentMapSeq) return;  // watch moved on
      if (err) {
        console.log('map error ' + JSON.stringify(err));
        if (err.code === P.ERR.NO_KEY || err.title) sendError(err);
        return;
      }
      send({
        cmd: CMD.MAP_BEGIN, seq: seq, width: img.width, height: img.height, fmt: img.format,
        stride: img.stride, palette: img.palette, total: img.data.length
      }, 'map:' + seq);
      var rows = Math.max(1, Math.floor((watch.inbox - 80) / img.stride));
      var chunk = rows * img.stride;
      for (var off = 0; off < img.data.length; off += chunk) {
        var part = img.data.subarray(off, Math.min(img.data.length, off + chunk));
        send({ cmd: CMD.MAP_CHUNK, seq: seq, offset: off, data: Array.prototype.slice.call(part) }, 'map:' + seq);
      }
    });
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
    var view = { center: loc, zoom: zoom, w: size[0], h: size[1] };
    streamMap(p.seq, view, [markerFor(loc, view, P.MK.ME)]);
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
  var bottom = p.mode > 0 ? p.mode : 60;
  var pts = results.map(function (r) { return [r.lat, r.lng]; });
  var fit = geo.fitBounds(pts, size[0], size[1], { top: 52, bottom: bottom + 4, left: 16, right: 16 }, 16);
  var view = { center: fit.center, zoom: fit.zoom, w: size[0], h: size[1] };
  var markers = results.map(function (r, i) { return markerFor([r.lat, r.lng], view, P.MK.PIN, i); });
  if (me) markers.unshift(markerFor(me, view, P.MK.ME));
  streamMap(p.seq, view, markers);
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
    var view = { center: [d.lat, d.lng], zoom: 16, w: size[0], h: size[1] };
    // move the pin down a little so its body is centered
    var q = geo.project(d.lat, d.lng, 16);
    view.center = geo.unproject(q[0], q[1] - 10, 16);
    var markers = [markerFor([d.lat, d.lng], view, P.MK.DEST)];
    if (me) markers.unshift(markerFor(me, view, P.MK.ME));
    streamMap(p.seq, view, markers);
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
    var view = { center: fit.center, zoom: fit.zoom, w: size[0], h: size[1], path: geo.thin(pts, 600) };
    streamMap(p.seq, view, [
      markerFor(pts[0], view, P.MK.START),
      markerFor(pts[pts.length - 1], view, P.MK.DEST)
    ]);
  });
}

function onSteps() {
  var rt = (navigator_ && navigator_.route) || route;
  if (!rt) return sendList(P.LIST.STEPS, []);
  sendList(P.LIST.STEPS, nav.stepList(rt, S.imperial).slice(0, 40));
}

// --- Navigation ------------------------------------------------------------
function stopNav() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  if (gpsTimer) { clearInterval(gpsTimer); gpsTimer = null; }
  navigator_ = null;
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
  getRoute(mode, false, function (err, rt) {
    if (err) return sendError(err);
    navigator_ = new nav.Navigator({
      route: rt,
      view: { w: p.width > 0 ? p.width : watch.w, h: p.height > 0 ? p.height : watch.h - 100 },
      settings: S,
      send: function (d) { send(d, 'nav'); },
      reroute: function (pos, cb) {
        google.computeRoute(pos, rt.dest, mode, prefs(), true, function (e2, r) {
          if (e2) return cb(e2);
          route = nav.buildRoute(r, mode, rt.dest);
          routeTime = Date.now();
          cb(null, route);
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
