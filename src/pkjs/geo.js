// Pebble Maps - geometry: polylines, distances, Web Mercator projection

var R = 6371008.8;
var TILE = 256;

function rad(d) { return d * Math.PI / 180; }
function deg(r) { return r * 180 / Math.PI; }

// Google encoded polyline -> [[lat, lng], ...]
function decodePolyline(str) {
  var pts = [];
  var index = 0, lat = 0, lng = 0;
  if (!str) return pts;
  while (index < str.length) {
    var b, shift = 0, result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

function encodeValue(v) {
  v = v < 0 ? ~(v << 1) : (v << 1);
  var out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

function encodePolyline(pts) {
  var out = '', plat = 0, plng = 0;
  for (var i = 0; i < pts.length; i++) {
    var lat = Math.round(pts[i][0] * 1e5), lng = Math.round(pts[i][1] * 1e5);
    out += encodeValue(lat - plat) + encodeValue(lng - plng);
    plat = lat;
    plng = lng;
  }
  return out;
}

function haversine(a, b) {
  var dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function bearing(a, b) {
  var y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  var x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Local flat-earth offset in meters of point p from origin o: [east, north]
function toLocal(o, p) {
  return [rad(p[1] - o[1]) * R * Math.cos(rad(o[0])), rad(p[0] - o[0]) * R];
}

// World pixel coordinates at zoom z
function project(lat, lng, z) {
  var scale = TILE * Math.pow(2, z);
  var s = Math.sin(rad(Math.max(-85, Math.min(85, lat))));
  return [
    scale * (lng + 180) / 360,
    scale * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI))
  ];
}

function unproject(x, y, z) {
  var scale = TILE * Math.pow(2, z);
  var lng = x / scale * 360 - 180;
  var n = Math.PI - 2 * Math.PI * y / scale;
  var lat = deg(Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
  return [lat, lng];
}

// Screen position of point p on a w x h map centered at c with zoom z
function toScreen(p, c, z, w, h) {
  var a = project(p[0], p[1], z), b = project(c[0], c[1], z);
  return [Math.round(a[0] - b[0] + w / 2), Math.round(a[1] - b[1] + h / 2)];
}

// Choose center + integer zoom so that all points fit inside the padded area.
// pad = {top, right, bottom, left} in pixels
function fitBounds(points, w, h, pad, maxZoom) {
  maxZoom = maxZoom || 17;
  if (!points.length) return { center: [0, 0], zoom: 2 };
  if (points.length === 1) {
    var single = { center: points[0], zoom: maxZoom };
    return recenterForPadding(single, points, w, h, pad);
  }
  var aw = Math.max(20, w - pad.left - pad.right);
  var ah = Math.max(20, h - pad.top - pad.bottom);
  for (var z = maxZoom; z >= 1; z--) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < points.length; i++) {
      var q = project(points[i][0], points[i][1], z);
      minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
      minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
    }
    if (maxX - minX <= aw && maxY - minY <= ah) {
      // center of the bounds, shifted so the box sits in the padded area
      var cx = (minX + maxX) / 2 - (pad.left - pad.right) / 2;
      var cy = (minY + maxY) / 2 - (pad.top - pad.bottom) / 2;
      return { center: unproject(cx, cy, z), zoom: z };
    }
  }
  return { center: points[0], zoom: 1 };
}

function recenterForPadding(fit, points, w, h, pad) {
  var q = project(points[0][0], points[0][1], fit.zoom);
  var cx = q[0] - (pad.left - pad.right) / 2;
  var cy = q[1] - (pad.top - pad.bottom) / 2;
  return { center: unproject(cx, cy, fit.zoom), zoom: fit.zoom };
}

// Reduce a polyline to at most maxPts points (keeps first and last)
function thin(points, maxPts) {
  if (points.length <= maxPts) return points;
  var out = [];
  var step = (points.length - 1) / (maxPts - 1);
  for (var i = 0; i < maxPts; i++) out.push(points[Math.round(i * step)]);
  return out;
}

module.exports = {
  decodePolyline: decodePolyline,
  encodePolyline: encodePolyline,
  haversine: haversine,
  bearing: bearing,
  toLocal: toLocal,
  project: project,
  unproject: unproject,
  toScreen: toScreen,
  fitBounds: fitBounds,
  thin: thin,
  rad: rad,
  deg: deg
};
