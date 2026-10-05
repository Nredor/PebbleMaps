// Builds the demo-data capture page from tools/demo_capture.js:
//   node tools/build_capture.js <out.html> [clay-component.js]
// The page asks for a Google key, collects the screenshot data and downloads a zip.
var fs = require('fs');
var path = require('path');
var g = require('../src/pkjs/google.js')._internal;
var HOME = process.env.PM_HOME ? JSON.parse(process.env.PM_HOME) : [47.6110, -122.3370];   // Seattle, Westlake Park

var EXTRAS = process.argv.indexOf('--extras') > 0;   // second capture: places, photos, transit
var ZIPNAME = EXTRAS ? 'pebblemaps-demo-extras.zip' : 'pebblemaps-demo-data.zip';
var core = fs.readFileSync(path.join(__dirname, EXTRAS ? 'demo_extras.js' : 'demo_capture.js'), 'utf8')
  .replace('__CONSTS__', JSON.stringify({ STYLES: { light: g.STYLES.light }, PLACE_FIELDS: g.PLACE_FIELDS,
                                          ROUTE_FIELDS_FULL: g.ROUTE_FIELDS_FULL, ROUTE_FIELDS_SUMMARY: g.ROUTE_FIELDS_SUMMARY,
                                          INFO_FIELDS: g.INFO_FIELDS }));

var ui = [
  'function pmStartCapture(root, getKey) {',
  '  var btn = root.querySelector(".pmc-go"), logEl = root.querySelector(".pmc-log"), out = root.querySelector(".pmc-out");',
  '  btn.addEventListener("click", function () {',
  '    var key = String(getKey() || "").replace(/\\s+/g, "");',
  '    if (!key) { logEl.textContent = "Paste your Google key first."; return; }',
  '    btn.disabled = true; out.innerHTML = ""; logEl.textContent = "";',
  '    function log(t) { logEl.textContent = t; }',
  '    pmDemoCapture(key, ' + JSON.stringify(HOME) + ', log, function (err, blob) {',
  '      btn.disabled = false;',
  '      if (err) { log("Stopped: " + err); return; }',
  '      var url = URL.createObjectURL(blob);',
  '      var a = document.createElement("a");',
  '      a.href = url; a.download = "' + ZIPNAME + '"; a.className = "pmc-dl";',
  '      a.textContent = "Download ' + ZIPNAME + ' (" + Math.round(blob.size / 1024) + " KB)";',
  '      out.appendChild(a);',
  '      log("Done! Tap the download link, then attach the zip in the chat.");',
  '      try { a.click(); } catch (e) {}',
  '    });',
  '  });',
  '}'
].join('\n');

var css = '.pmc{font:15px/1.4 system-ui,sans-serif;color:#202124}.pmc button{background:#1a73e8;color:#fff;border:0;border-radius:20px;' +
  'padding:10px 18px;font-size:15px;font-weight:600}.pmc button:disabled{opacity:.5}.pmc .pmc-log{margin:10px 0;color:#5f6368}' +
  '.pmc .pmc-dl{display:inline-block;margin-top:6px;background:#188038;color:#fff;padding:10px 16px;border-radius:20px;text-decoration:none;font-weight:600}' +
  '.pmc input{width:100%;box-sizing:border-box;padding:10px;font-size:15px;border:1px solid #dadce0;border-radius:8px;margin:6px 0 10px}';

var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Pebble Maps demo data</title><style>body{margin:0;padding:16px;background:#fff}' + css + '</style></head><body>' +
  '<div class="pmc"><h2>Pebble Maps — demo data</h2><p>Collects Google map pictures and places around downtown Seattle for the app store screenshots. ' +
  'Uses your key only to talk to Google (about 150 map pictures and 9 searches — well inside the free allowance).</p>' +
  '<label>Your Google Maps key<input class="pmc-key" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
  '<button class="pmc-go">Collect demo data</button><div class="pmc-log"></div><div class="pmc-out"></div></div>' +
  '<script>' + core + '\n' + ui + '\npmStartCapture(document.querySelector(".pmc"), function () { return document.querySelector(".pmc-key").value; });</script></body></html>';
fs.writeFileSync(process.argv[2], html);

if (process.argv[3]) {
  // Clay component: same tool inside the Pebble Maps settings page (uses the key box there)
  var comp = 'module.exports = {\n  name: "pmcapture",\n  template: ' + JSON.stringify(
    '<div class="pmc"><style>' + css + '</style><h4>Demo data for screenshots</h4><p>Uses the Google key below to collect map pictures and places around downtown Seattle, then downloads a zip to attach in the chat.</p>' +
    '<button type="button" class="pmc-go">' + (EXTRAS ? 'Collect more demo data' : 'Collect demo data') + '</button><div class="pmc-log"></div><div class="pmc-out"></div></div>') +
    ',\n  manipulator: { get: function () { return ""; }, set: function () { return this; }, hide: function () { return this; }, show: function () { return this; } },\n' +
    '  initialize: function (minified, clay) {\n' + core + '\n' + ui + '\n' +
    '    var root = this.$element[0];\n' +
    '    pmStartCapture(root, function () { var it = clay.getItemByMessageKey("apiKey"); return it ? it.get() : ""; });\n  }\n};\n';
  fs.writeFileSync(process.argv[3], comp);
}
console.log('ok');
