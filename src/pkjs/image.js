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

// --- Photos (place pictures) ------------------------------------------------------
// Scale and crop an RGB picture to fill w x h (box filter), keeping the middle
function cover(src, sw, sh, w, h) {
  var scale = Math.max(w / sw, h / sh);
  var cw = w / scale, ch = h / scale;          // source area that is shown
  var x0 = (sw - cw) / 2, y0 = (sh - ch) / 2;
  var out = new Float32Array(w * h * 3);
  for (var y = 0; y < h; y++) {
    var sy0 = y0 + y * ch / h, sy1 = y0 + (y + 1) * ch / h;
    var ya = Math.floor(sy0), yb = Math.max(ya + 1, Math.ceil(sy1));
    for (var x = 0; x < w; x++) {
      var sx0 = x0 + x * cw / w, sx1 = x0 + (x + 1) * cw / w;
      var xa = Math.floor(sx0), xb = Math.max(xa + 1, Math.ceil(sx1));
      var r = 0, g = 0, b = 0, n = 0;
      for (var yy = ya; yy < yb && yy < sh; yy++) {
        for (var xx = xa; xx < xb && xx < sw; xx++) {
          var o = (yy * sw + xx) * 3;
          r += src[o]; g += src[o + 1]; b += src[o + 2]; n++;
        }
      }
      var k = (y * w + x) * 3;
      n = n || 1;
      out[k] = r / n; out[k + 1] = g / n; out[k + 2] = b / n;
    }
  }
  return out;
}

// 16 Pebble colors that suit this picture: the most used colors, spread apart
function photoPalette(px, n) {
  var hist = new Float64Array(64);
  for (var i = 0; i < n; i++) {
    hist[pebbleColor(px[i * 3], px[i * 3 + 1], px[i * 3 + 2])]++;
  }
  var chosen = [];
  var best = 0;
  for (var c = 1; c < 64; c++) if (hist[c] > hist[best]) best = c;
  chosen.push(best);
  while (chosen.length < 16) {
    var pick = -1, score = -1;
    for (var m = 0; m < 64; m++) {
      if (chosen.indexOf(m) >= 0) continue;
      var dmin = 1e9;
      for (var j = 0; j < chosen.length; j++) dmin = Math.min(dmin, colorDist(m, chosen[j]));
      var sc = (hist[m] + 0.01) * dmin;
      if (sc > score) { score = sc; pick = m; }
    }
    chosen.push(pick);
  }
  // darkest first: the last slot (what the watch fills empty space with) is the lightest
  var lum = function (c) { return ((c >> 4) & 3) * 3 + ((c >> 2) & 3) * 6 + (c & 3); };
  return chosen.sort(function (a, b) { return lum(a) - lum(b); });
}

// RGB picture -> watch image (16 picked colors, or 1-bit), error-diffusion dithered
function photo(src, sw, sh, w, h, format) {
  var px = cover(src, sw, sh, w, h);
  var x, y, i, e;
  if (format !== 1) {
    var lum = new Float32Array(w * h);
    for (i = 0; i < w * h; i++) lum[i] = (px[i * 3] * 299 + px[i * 3 + 1] * 587 + px[i * 3 + 2] * 114) / 1000;
    var stride1 = ((w + 31) >> 5) * 4;
    var data1 = new Uint8Array(stride1 * h);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var v = lum[i], on = v >= 128;
        if (on) data1[y * stride1 + (x >> 3)] |= 1 << (x & 7);
        // Atkinson dithering: crisp on small black & white screens
        e = (v - (on ? 255 : 0)) / 8;
        if (x + 1 < w) lum[i + 1] += e;
        if (x + 2 < w) lum[i + 2] += e;
        if (y + 1 < h) {
          if (x > 0) lum[i + w - 1] += e;
          lum[i + w] += e;
          if (x + 1 < w) lum[i + w + 1] += e;
        }
        if (y + 2 < h) lum[i + 2 * w] += e;
      }
    }
    return { width: w, height: h, stride: stride1, palette: [], data: data1, format: 0 };
  }
  var pal = photoPalette(px, w * h);
  var prgb = pal.map(function (c) { return [((c >> 4) & 3) * 85, ((c >> 2) & 3) * 85, (c & 3) * 85]; });
  var stride = (w + 1) >> 1;
  var data = new Uint8Array(stride * h);
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      i = (y * w + x) * 3;
      var r = px[i], g = px[i + 1], b = px[i + 2];
      var bi = 0, bd = 1e12;
      for (var k = 0; k < 16; k++) {
        var dr = r - prgb[k][0], dg = g - prgb[k][1], db = b - prgb[k][2];
        var d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
        if (d < bd) { bd = d; bi = k; }
      }
      var o = y * stride + (x >> 1);
      if (x & 1) data[o] |= bi; else data[o] |= bi << 4;
      // Floyd-Steinberg, softened a little so photos don't look grainy
      var er = (r - prgb[bi][0]) * 0.85, eg = (g - prgb[bi][1]) * 0.85, eb = (b - prgb[bi][2]) * 0.85;
      var spread = [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]];
      for (var s2 = 0; s2 < 4; s2++) {
        var nx = x + spread[s2][0], ny = y + spread[s2][1];
        if (nx < 0 || nx >= w || ny >= h) continue;
        var f = spread[s2][2] / 16, q = (ny * w + nx) * 3;
        px[q] += er * f; px[q + 1] += eg * f; px[q + 2] += eb * f;
      }
    }
  }
  return { width: w, height: h, stride: stride, palette: pal.map(function (c) { return 0xC0 | c; }), data: data, format: 1 };
}

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
  pebbleColor: pebbleColor,
  photo: photo
};
