// Pebble Maps - demo data capture (runs in a web page with the user's Google key)
//
// Collects everything the emulator screenshots need from Google, once:
// nearby restaurants, a "Starbucks" search, "sta" suggestions, the routes,
// and map pictures on a fixed grid (the test build snaps its map requests to
// the same grid, so every picture it asks for is one of these).
// Produces pebblemaps-demo-data.zip. Built into pages by tools/build_capture.js,
// which fills in the app's own request settings below.
function pmDemoCapture(key, home, log, done) {
  var C = __CONSTS__;
  var SNAP = 192, SIZE = 640;
  var files = [];          // {name, data: Uint8Array}
  var enc = new TextEncoder();

  function addJSON(name, obj) { files.push({ name: name, data: enc.encode(JSON.stringify(obj, null, 1)) }); }

  function project(lat, lng, z) {
    var s = 256 * Math.pow(2, z);
    var sy = Math.sin(lat * Math.PI / 180);
    return [(lng + 180) / 360 * s, (0.5 - Math.log((1 + sy) / (1 - sy)) / (4 * Math.PI)) * s];
  }
  function unproject(x, y, z) {
    var s = 256 * Math.pow(2, z);
    var lng = x / s * 360 - 180;
    var n = Math.PI - 2 * Math.PI * y / s;
    return [180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng];
  }
  function decode(str) {
    var pts = [], i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      var b, sh = 0, r = 0;
      do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
      lat += (r & 1) ? ~(r >> 1) : (r >> 1);
      sh = 0; r = 0;
      do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
      lng += (r & 1) ? ~(r >> 1) : (r >> 1);
      pts.push([lat / 1e5, lng / 1e5]);
    }
    return pts;
  }

  function post(url, mask, body) {
    var headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key };
    if (mask) headers['X-Goog-FieldMask'] = mask;
    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function circle(radius) {
    return { circle: { center: { latitude: home[0], longitude: home[1] }, radius: radius } };
  }

  function route(dest, travel, full) {
    var body = {
      origin: { location: { latLng: { latitude: home[0], longitude: home[1] } } },
      destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
      travelMode: travel, languageCode: 'en', units: 'IMPERIAL'
    };
    if (travel === 'DRIVE') {
      body.routingPreference = 'TRAFFIC_AWARE';
      body.routeModifiers = { avoidTolls: false, avoidHighways: false, avoidFerries: false };
    }
    if (travel === 'TRANSIT') body.departureTime = new Date(Date.now() + 60000).toISOString();
    return post('https://routes.googleapis.com/directions/v2:computeRoutes', full ? C.ROUTE_FIELDS_FULL : C.ROUTE_FIELDS_SUMMARY, body);
  }

  function tileUrl(z, gx, gy) {
    var c = unproject(gx * SNAP, gy * SNAP, z);
    var q = ['center=' + c[0].toFixed(6) + ',' + c[1].toFixed(6), 'zoom=' + z, 'size=' + SIZE + 'x' + SIZE,
             'scale=1', 'format=png', 'maptype=roadmap', 'language=en'];
    C.STYLES.light.forEach(function (s) { q.push('style=' + encodeURIComponent(s)); });
    q.push('key=' + encodeURIComponent(key));
    return 'https://maps.googleapis.com/maps/api/staticmap?' + q.join('&');
  }

  var nearby, starbucks, sugg, dest, drive;
  var points = [home];
  log('Asking Google for nearby restaurants…');
  post('https://places.googleapis.com/v1/places:searchNearby', C.PLACE_FIELDS, {
    includedTypes: ['restaurant'], maxResultCount: 10, rankPreference: 'POPULARITY', languageCode: 'en',
    locationRestriction: circle(3000)
  }).then(function (j) {
    nearby = j;
    addJSON('places_nearby_restaurant.json', j);
    var list = (j.places || []);
    if (list.length < 5) throw new Error('Google found too few restaurants here.');
    var p = list[4].location;
    dest = { lat: p.latitude, lng: p.longitude, name: list[4].displayName && list[4].displayName.text };
    list.forEach(function (pl) { points.push([pl.location.latitude, pl.location.longitude]); });
    log('Searching "Starbucks"…');
    return post('https://places.googleapis.com/v1/places:searchText', C.PLACE_FIELDS, {
      textQuery: 'Starbucks', pageSize: 10, languageCode: 'en', locationBias: circle(40000)
    });
  }).then(function (j) {
    starbucks = j;
    addJSON('places_search_starbucks.json', j);
    log('Suggestions for "sta"…');
    return post('https://places.googleapis.com/v1/places:autocomplete',
      'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text,suggestions.placePrediction.distanceMeters', {
        input: 'sta', languageCode: 'en', includeQueryPredictions: false,
        locationBias: circle(30000), origin: { latitude: home[0], longitude: home[1] }
      });
  }).then(function (j) {
    sugg = j;
    addJSON('places_autocomplete_sta.json', j);
    log('Directions to ' + dest.name + '…');
    return route(dest, 'DRIVE', true);
  }).then(function (j) {
    drive = j;
    addJSON('route_DRIVE_full.json', j);
    var modes = ['DRIVE', 'WALK', 'BICYCLE', 'TRANSIT'];
    return modes.reduce(function (pr, m) {
      return pr.then(function () {
        return route(dest, m, false).then(function (r) { addJSON('route_' + m + '_summary.json', r); },
                                         function () { addJSON('route_' + m + '_summary.json', {}); });
      });
    }, Promise.resolve());
  }).then(function () {
    var r = (drive.routes || [])[0];
    var routePts = r ? decode(r.polyline.encodedPolyline) : [];
    // which map pictures: every zoom covers what that kind of screen shows
    var near = [home, [dest.lat, dest.lng]].concat(routePts);
    var sb = (starbucks.places || []).map(function (p) { return [p.location.latitude, p.location.longitude]; });
    // far-away Starbucks only need the zoomed-out pictures
    var sbNear = sb.filter(function (p) { return Math.abs(p[0] - home[0]) < 0.03 && Math.abs(p[1] - home[1]) < 0.04; });
    var plan = [
      { z: 12, pts: points.concat(sb), margin: 420 },
      { z: 13, pts: points.concat(sbNear), margin: 420 },
      { z: 14, pts: points.concat(sbNear), margin: 420 },
      { z: 15, pts: points.concat(near), margin: 420 },
      { z: 16, pts: near, margin: 420 }
    ];
    var jobs = [];
    plan.forEach(function (p) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      p.pts.forEach(function (pt) {
        var q = project(pt[0], pt[1], p.z);
        minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
        minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
      });
      for (var gx = Math.floor((minX - p.margin) / SNAP); gx <= Math.ceil((maxX + p.margin) / SNAP); gx++) {
        for (var gy = Math.floor((minY - p.margin) / SNAP); gy <= Math.ceil((maxY + p.margin) / SNAP); gy++) {
          jobs.push({ z: p.z, gx: gx, gy: gy });
        }
      }
    });
    if (jobs.length > 700) throw new Error('Too many map pictures (' + jobs.length + '). Pick a spot with places closer together.');
    addJSON('meta.json', { home: home, snap: SNAP, size: SIZE, style: 'light', dest: dest,
                           tiles: jobs.map(function (j) { return j.z + '_' + j.gx + '_' + j.gy; }) });
    var doneCount = 0;
    function one(j) {
      return fetch(tileUrl(j.z, j.gx, j.gy)).then(function (r) {
        if (!r.ok) throw new Error('Map picture failed (HTTP ' + r.status + ')');
        return r.arrayBuffer();
      }).then(function (buf) {
        files.push({ name: 'tiles/' + j.z + '_' + j.gx + '_' + j.gy + '.png', data: new Uint8Array(buf) });
        doneCount++;
        if (doneCount % 5 === 0 || doneCount === jobs.length) log('Map pictures: ' + doneCount + ' of ' + jobs.length);
      });
    }
    // four at a time
    var idx = 0;
    function worker() {
      if (idx >= jobs.length) return Promise.resolve();
      var j = jobs[idx++];
      return one(j).then(worker);
    }
    return Promise.all([worker(), worker(), worker(), worker()]);
  }).then(function () {
    log('Packing the zip…');
    done(null, makeZip(files));
  }).catch(function (e) {
    var msg = String(e && e.message || e);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) msg += ' (the page could not reach Google — check the connection)';
    done(msg);
  });

  // Minimal "stored" zip writer
  function makeZip(list) {
    var table = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    function crc32(d) {
      var c = 0xFFFFFFFF;
      for (var i = 0; i < d.length; i++) c = table[(c ^ d[i]) & 255] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    }
    var parts = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >> 8) & 255]; }
    function u32(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; }
    list.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      var head = [].concat([0x50, 0x4b, 3, 4], u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(size), u32(size),
                           u16(name.length), u16(0));
      parts.push(new Uint8Array(head), name, f.data);
      central.push(new Uint8Array([].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc),
                                            u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += head.length + name.length + size;
    });
    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var end = new Uint8Array([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(list.length), u16(list.length), u32(cdSize), u32(offset), u16(0)));
    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }
}
