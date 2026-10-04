// Pebble Maps - human-friendly distances and times

function distance(m, imperial, forNav) {
  if (m === null || m === undefined || isNaN(m)) return '';
  if (imperial) {
    var ft = m * 3.28084;
    var mi = m / 1609.344;
    if (mi < 0.1 || (forNav && ft < 1000)) {
      var step = ft < 300 ? 25 : 50;
      return Math.max(step, Math.round(ft / step) * step) + ' ft';
    }
    if (mi < 10) return (Math.round(mi * 10) / 10).toFixed(1) + ' mi';
    return Math.round(mi) + ' mi';
  }
  if (m < 1000) {
    var s = m < 300 ? 10 : 50;
    return Math.max(s, Math.round(m / s) * s) + ' m';
  }
  var km = m / 1000;
  if (km < 10) return (Math.round(km * 10) / 10).toFixed(1) + ' km';
  return Math.round(km) + ' km';
}

function duration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  var min = Math.round(sec / 60);
  if (min < 1) return '1 min';
  if (min < 60) return min + ' min';
  var h = Math.floor(min / 60);
  var mm = min % 60;
  if (h >= 24) {
    var d = Math.floor(h / 24);
    return d + ' d ' + (h % 24) + ' hr';
  }
  return h + ' hr' + (mm ? ' ' + mm + ' min' : '');
}

// "1234s" -> 1234
function seconds(s) {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  return parseFloat(String(s).replace('s', '')) || 0;
}

function clip(text, n) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  if (text.length <= n) return text;
  return text.substr(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

// Strip characters our list packing reserves
function clean(text) {
  return String(text || '').replace(/[\x1e\x1f]/g, ' ');
}

function packList(items) {
  return items.map(function (it) {
    return [clean(it.title), clean(it.sub), it.icon || 0, it.extra || 0].join('\x1f');
  }).join('\x1e');
}

module.exports = {
  distance: distance,
  duration: duration,
  seconds: seconds,
  clip: clip,
  packList: packList
};
