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

// Convert to a 16-color palettized 4-bit image (Pebble color watches).
// Returns { width, height, stride, palette:[16 bytes argb], data:Uint8Array }
function to4Bit(img) {
  var w = img.width, h = img.height, rgb = img.rgb;
  var n = w * h;
  var idx64 = new Uint8Array(n);
  var counts = new Array(64);
  for (var c = 0; c < 64; c++) counts[c] = 0;
  for (var i = 0; i < n; i++) {
    var pc = pebbleColor(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    idx64[i] = pc;
    counts[pc]++;
  }
  var used = [];
  for (var k = 0; k < 64; k++) if (counts[k]) used.push(k);
  used.sort(function (a, b) { return counts[b] - counts[a]; });
  var chosen = used.slice(0, 16);
  var map = new Uint8Array(64);
  for (var m = 0; m < 64; m++) {
    var best = 0, bestD = 1e9;
    for (var j = 0; j < chosen.length; j++) {
      var d = colorDist(m, chosen[j]);
      if (d < bestD) { bestD = d; best = j; }
    }
    map[m] = best;
  }
  var stride = (w + 1) >> 1;
  var data = new Uint8Array(stride * h);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var v = map[idx64[y * w + x]];
      var o = y * stride + (x >> 1);
      if (x & 1) data[o] |= v;
      else data[o] |= v << 4;   // leftmost pixel in the high nibble
    }
  }
  var palette = [];
  for (var p = 0; p < 16; p++) palette.push(0xC0 | (p < chosen.length ? chosen[p] : 0x3F));
  return { width: w, height: h, stride: stride, palette: palette, data: data, format: 1 };
}

var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// Convert to 1-bit with ordered dithering (Pebble 2 / black & white watches).
function to1Bit(img) {
  var w = img.width, h = img.height, rgb = img.rgb;
  var stride = ((w + 31) >> 5) * 4;
  var data = new Uint8Array(stride * h);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var o = (y * w + x) * 3;
      var lum = (rgb[o] * 299 + rgb[o + 1] * 587 + rgb[o + 2] * 114) / 1000;
      var t = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) * 16;
      if (lum > t) data[y * stride + (x >> 3)] |= 1 << (x & 7);  // 1 = white, LSB first
    }
  }
  return { width: w, height: h, stride: stride, palette: [], data: data, format: 0 };
}

function convert(img, format) {
  return format === 1 ? to4Bit(img) : to1Bit(img);
}

module.exports = {
  decodePNG: decodePNG,
  convert: convert,
  to4Bit: to4Bit,
  to1Bit: to1Bit,
  pebbleColor: pebbleColor
};
