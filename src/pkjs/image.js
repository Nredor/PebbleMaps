// Pebble Maps - decode Google Static Maps PNGs and convert them for the watch
var inflate = require('tiny-inflate');

function readU32(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

// Decode a (non-interlaced) PNG into { width, height, rgb: Uint8Array(w*h*3) }
function decodePNG(bytes) {
  var sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (var s = 0; s < 8; s++) {
    if (bytes[s] !== sig[s]) throw new Error('not a PNG');
  }
  var pos = 8, width = 0, height = 0, depth = 8, ctype = 0, interlace = 0;
  var palette = null, trns = null;
  var idat = [], idatLen = 0;
  while (pos < bytes.length) {
    var len = readU32(bytes, pos);
    var type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    var data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = readU32(data, 0);
      height = readU32(data, 4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
      idatLen += data.length;
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (interlace) throw new Error('interlaced PNG not supported');
  var channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error('bad PNG color type');
  var zdata = new Uint8Array(idatLen);
  var off = 0;
  for (var i = 0; i < idat.length; i++) {
    zdata.set(idat[i], off);
    off += idat[i].length;
  }
  var bpp = Math.max(1, (channels * depth) >> 3);         // bytes per pixel for filtering
  var rowBytes = (width * channels * depth + 7) >> 3;
  var raw = new Uint8Array((rowBytes + 1) * height);
  // zlib stream: skip 2-byte header, tiny-inflate handles raw deflate
  inflate(zdata.subarray(2), raw);

  var out = new Uint8Array(rowBytes * height);
  var prev = new Uint8Array(rowBytes);
  for (var y = 0; y < height; y++) {
    var ft = raw[y * (rowBytes + 1)];
    var src = raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1));
    var cur = out.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (var x = 0; x < rowBytes; x++) {
      var a = x >= bpp ? cur[x - bpp] : 0;
      var b = prev[x];
      var c = x >= bpp ? prev[x - bpp] : 0;
      var v = src[x];
      switch (ft) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          var p = a + b - c;
          var pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }

  // Expand to RGB (alpha composited over white)
  var rgb = new Uint8Array(width * height * 3);
  var maxv = (1 << depth) - 1;
  for (var yy = 0; yy < height; yy++) {
    var row = out.subarray(yy * rowBytes, (yy + 1) * rowBytes);
    for (var xx = 0; xx < width; xx++) {
      var r, g, bl, al = 255;
      if (ctype === 3 || ctype === 0) {
        var val;
        if (depth === 8) val = row[xx];
        else if (depth === 16) val = row[xx * 2];
        else {
          var bitpos = xx * depth;
          val = (row[bitpos >> 3] >> (8 - depth - (bitpos & 7))) & maxv;
        }
        if (ctype === 3) {
          r = palette[val * 3]; g = palette[val * 3 + 1]; bl = palette[val * 3 + 2];
          if (trns && val < trns.length) al = trns[val];
        } else {
          var gv = depth === 16 ? val : Math.round(val * 255 / maxv);
          r = g = bl = gv;
        }
      } else if (ctype === 2) {
        var k = xx * 3 * (depth >> 3);
        var st = depth >> 3;
        r = row[k]; g = row[k + st]; bl = row[k + 2 * st];
      } else if (ctype === 4) {
        var k4 = xx * 2 * (depth >> 3);
        r = g = bl = row[k4]; al = row[k4 + (depth >> 3)];
      } else {
        var st6 = depth >> 3;
        var k6 = xx * 4 * st6;
        r = row[k6]; g = row[k6 + st6]; bl = row[k6 + 2 * st6]; al = row[k6 + 3 * st6];
      }
      if (al < 255) {
        r = (r * al + 255 * (255 - al)) / 255;
        g = (g * al + 255 * (255 - al)) / 255;
        bl = (bl * al + 255 * (255 - al)) / 255;
      }
      var o = (yy * width + xx) * 3;
      rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = bl;
    }
  }
  return { width: width, height: height, rgb: rgb };
}

// Nearest Pebble 64-color index (0bRRGGBB) for an RGB triple
function pebbleColor(r, g, b) {
  return (Math.round(r / 85) << 4) | (Math.round(g / 85) << 2) | Math.round(b / 85);
}

function colorDist(a, b) {
  var dr = ((a >> 4) & 3) - ((b >> 4) & 3);
  var dg = ((a >> 2) & 3) - ((b >> 2) & 3);
  var db = (a & 3) - (b & 3);
  return dr * dr * 3 + dg * dg * 4 + db * db * 2;
}

// "Base" pixels: one byte per pixel that rotating/cropping can sample directly.
// Color watches: Pebble 64-color index (0bRRGGBB). Black & white: luminance.
var WHITE = { 1: 0x3F, 0: 255 };

function toBase(img, format) {
  var n = img.width * img.height, rgb = img.rgb;
  var px = new Uint8Array(n);
  for (var i = 0; i < n; i++) {
    var r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    px[i] = format === 1 ? pebbleColor(r, g, b) : (r * 299 + g * 587 + b * 114) / 1000;
  }
  return { width: img.width, height: img.height, px: px };
}

// Each map style uses one fixed set of 16 colors, so a picture the watch
// already has and new pieces sent later always match. Slot 0 is the map
// background (used to fill areas with nothing in them yet).
var PALETTES = {
  light: [0x3F, 0x15, 0x2E, 0x04, 0x1B, 0x06, 0x2A, 0x38, 0x00, 0x07, 0x30, 0x24, 0x2B, 0x3A, 0x0B, 0x3E],
  dark: [0x01, 0x2A, 0x04, 0x02, 0x15, 0x24, 0x3F, 0x1B, 0x30, 0x00, 0x05, 0x16, 0x06, 0x10, 0x2F, 0x19]
};
var palMaps = {};

function paletteFor(style) { return PALETTES[style] || PALETTES.light; }

function paletteMap(style) {
  var key = PALETTES[style] ? style : 'light';
  if (palMaps[key]) return palMaps[key];
  var pal = PALETTES[key];
  var map = new Uint8Array(64);
  for (var m = 0; m < 64; m++) {
    var best = 0, bestD = 1e9;
    for (var j = 0; j < pal.length; j++) {
      var d = colorDist(m, pal[j]);
      if (d < bestD) { bestD = d; best = j; }
    }
    map[m] = best;
  }
  palMaps[key] = map;
  return map;
}

// Background "base" pixel for a style
function background(format, style) {
  return format === 1 ? paletteFor(style)[0] : 255;
}

// Pack base pixels for the watch (16-color 4-bit, or dithered 1-bit)
function pack(px, w, h, format, style) {
  if (format !== 1) {
    var stride1 = ((w + 31) >> 5) * 4;
    var data1 = new Uint8Array(stride1 * h);
    for (var y1 = 0; y1 < h; y1++) {
      for (var x1 = 0; x1 < w; x1++) {
        var t = (BAYER[(y1 & 3) * 4 + (x1 & 3)] + 0.5) * 16;
        if (px[y1 * w + x1] > t) data1[y1 * stride1 + (x1 >> 3)] |= 1 << (x1 & 7);  // 1 = white, LSB first
      }
    }
    return { width: w, height: h, stride: stride1, palette: [], data: data1, format: 0 };
  }
  var map = paletteMap(style);
  var stride = (w + 1) >> 1;
  var data = new Uint8Array(stride * h);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var v = map[px[y * w + x]];
      var o = y * stride + (x >> 1);
      if (x & 1) data[o] |= v;
      else data[o] |= v << 4;   // leftmost pixel in the high nibble
    }
  }
  var palette = paletteFor(style).map(function (c) { return 0xC0 | c; });
  return { width: w, height: h, stride: stride, palette: palette, data: data, format: 1 };
}

var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// Older helpers (used by tests): RGB image -> watch format
function convert(img, format) {
  var b = toBase(img, format);
  return pack(b.px, b.width, b.height, format);
}

module.exports = {
  decodePNG: decodePNG,
  convert: convert,
  toBase: toBase,
  pack: pack,
  WHITE: WHITE,
  background: background,
  PALETTES: PALETTES,
  pebbleColor: pebbleColor
};
