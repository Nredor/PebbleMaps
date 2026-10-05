// Pebble Maps - extra demo data for the store screenshots (runs in the settings page with the
// user's Google key). Adds what the first capture didn't have: places of several kinds
// around home (for the name flags), full details and photos of the destination (place info
// page), and a real transit route with upcoming departures (schedule page).
// Produces pebblemaps-demo-extras.zip. Built into the settings page by tools/build_capture.js --extras.
function pmDemoCapture(key, home, log, done) {
  var C = __CONSTS__;
  var files = [];
  var enc = new TextEncoder();
  function addJSON(name, obj) { files.push({ name: name, data: enc.encode(JSON.stringify(obj, null, 1)) }); }
  function circle(radius) { return { circle: { center: { latitude: home[0], longitude: home[1] }, radius: radius } }; }

  function req(method, url, mask, body) {
    var headers = { 'X-Goog-Api-Key': key };
    if (mask) headers['X-Goog-FieldMask'] = mask;
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
        return j;
      });
    });
  }
  function post(url, mask, body) { return req('POST', url, mask, body); }

  // the kinds of places the map shows by default (same lists as the app)
  var KINDS = [
    { key: 'restaurant', types: ['restaurant'] },
    { key: 'cafe', types: ['cafe', 'coffee_shop'] },
    { key: 'bar', types: ['bar', 'pub', 'wine_bar'] },
    { key: 'tourist_attraction', types: ['tourist_attraction', 'museum', 'art_gallery', 'shopping_mall', 'clothing_store',
      'book_store', 'movie_theater', 'performing_arts_theater', 'bakery', 'ice_cream_shop'] }
  ];

  var meta = { home: home, capturedAt: new Date().toISOString() };
  var chain = Promise.resolve();
  KINDS.forEach(function (k) {
    chain = chain.then(function () {
      log('Places on the map: ' + k.key + '…');
      return post('https://places.googleapis.com/v1/places:searchNearby', C.PLACE_FIELDS + ',places.primaryType', {
        includedTypes: k.types, maxResultCount: 20, rankPreference: 'POPULARITY', languageCode: 'en',
        locationRestriction: circle(900)
      }).then(function (j) { addJSON('pois_' + k.key + '.json', j); });
    });
  });

  // the destination's info page: details, reviews and photos
  var photoNames = [];
  chain = chain.then(function () {
    log('The Pink Door: details…');
    return post('https://places.googleapis.com/v1/places:searchText', 'places.id,places.displayName', {
      textQuery: 'The Pink Door, Post Alley, Seattle', pageSize: 1, languageCode: 'en', locationBias: circle(3000)
    });
  }).then(function (j) {
    var id = j.places && j.places[0] && j.places[0].id;
    if (!id) throw new Error('Google didn\'t find The Pink Door');
    meta.infoId = id;
    return req('GET', 'https://places.googleapis.com/v1/places/' + encodeURIComponent(id) + '?languageCode=en', C.INFO_FIELDS);
  }).then(function (info) {
    addJSON('info.json', info);
    photoNames = (info.photos || []).slice(0, 8).map(function (p) { return p.name; });
    var k = 0;
    return photoNames.reduce(function (pr, name, i) {
      return pr.then(function () {
        log('Photos: ' + (i + 1) + ' of ' + photoNames.length);
        return req('GET', 'https://places.googleapis.com/v1/' + name + '/media?skipHttpRedirect=true&maxWidthPx=900&maxHeightPx=900')
          .then(function (j) { return fetch(j.photoUri); })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
          .then(function (buf) { files.push({ name: 'photos/' + i + '.jpg', data: new Uint8Array(buf) }); k++; })
          .catch(function (e) { log('Photo ' + (i + 1) + ' skipped (' + e.message + ')'); });
      });
    }, Promise.resolve()).then(function () {
      if (!k) throw new Error('No photos could be downloaded');
      meta.photos = k;
    });
  });

  // a transit trip with a ride in it, and that ride's next departures
  var DESTS = ['Capitol Hill Station, Seattle', 'Space Needle, Seattle', 'University of Washington Station, Seattle'];
  function tryTransit(i) {
    if (i >= DESTS.length) throw new Error('No transit route with a ride found');
    log('Transit to ' + DESTS[i] + '…');
    return post('https://places.googleapis.com/v1/places:searchText', 'places.id,places.location,places.displayName', {
      textQuery: DESTS[i], pageSize: 1, languageCode: 'en', locationBias: circle(10000)
    }).then(function (j) {
      var p = j.places && j.places[0];
      if (!p) return tryTransit(i + 1);
      return post('https://routes.googleapis.com/directions/v2:computeRoutes', C.ROUTE_FIELDS_FULL, {
        origin: { location: { latLng: { latitude: home[0], longitude: home[1] } } },
        destination: { location: { latLng: p.location } },
        travelMode: 'TRANSIT', languageCode: 'en', units: 'IMPERIAL',
        departureTime: new Date(Date.now() + 60000).toISOString()
      }).then(function (r) {
        var route = r.routes && r.routes[0];
        var td = null;
        ((route && route.legs) || []).forEach(function (l) {
          (l.steps || []).forEach(function (s) { if (!td && s.transitDetails) td = s.transitDetails; });
        });
        if (!td) return tryTransit(i + 1);
        addJSON('route_TRANSIT_full.json', r);
        meta.transitDest = p.displayName && p.displayName.text;
        var sd = td.stopDetails || {};
        var from = sd.departureStop.location.latLng, to = sd.arrivalStop.location.latLng;
        var start = new Date(Date.now() - 60000);
        var rounds = [0, 1, 2];
        return rounds.reduce(function (pr, n) {
          return pr.then(function () {
            log('Departures ' + (n + 1) + ' of 3…');
            return post('https://routes.googleapis.com/directions/v2:computeRoutes', 'routes.legs.steps.transitDetails,routes.warnings', {
              origin: { location: { latLng: from } }, destination: { location: { latLng: to } },
              travelMode: 'TRANSIT', computeAlternativeRoutes: true, languageCode: 'en', departureTime: start.toISOString()
            }).then(function (d) {
              addJSON('transit_deps_' + n + '.json', d);
              var latest = null;
              (d.routes || []).forEach(function (rr) {
                (rr.legs || []).forEach(function (l) {
                  (l.steps || []).forEach(function (s) {
                    var t = s.transitDetails && s.transitDetails.stopDetails && s.transitDetails.stopDetails.departureTime;
                    if (t && (!latest || t > latest)) latest = t;
                  });
                });
              });
              if (latest) start = new Date(new Date(latest).getTime() + 60000);
            });
          });
        }, Promise.resolve());
      });
    });
  }
  chain = chain.then(function () { return tryTransit(0); });

  chain.then(function () {
    addJSON('extras_meta.json', meta);
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
