// Pebble Maps - custom Clay components for the settings page.
//
// IMPORTANT: Clay serializes these objects into the settings web page with
// toSource(), so every function here must be self-contained (no references
// to variables outside the function).

var THEME_CSS = [
  'html,body{font-family:Roboto,"Helvetica Neue",-apple-system,"Segoe UI",Arial,sans-serif!important;color:#202124;}',
  'body{background:#f1f3f4!important;padding:0 12px 24px!important;}',
  'h1,h2,h3,h4,h5,h6{text-transform:none!important;font-family:inherit!important;letter-spacing:0!important;}',
  '.section{background:#fff!important;border-radius:14px!important;box-shadow:0 1px 2px rgba(60,64,67,.3),0 1px 3px 1px rgba(60,64,67,.15)!important;margin-top:16px;overflow:hidden;}',
  '.section>.component:after{background:#e8eaed!important;}',
  '.section>.component-heading:first-child{background:#fff!important;padding-top:14px;}',
  '.component-heading h4,.component-heading h3{font-size:19px!important;font-weight:600!important;color:#202124;margin:0;}',
  '.component-heading h5,.component-heading h6{font-size:13px!important;color:#5f6368!important;}',
  '.description{color:#5f6368!important;font-size:14px!important;line-height:1.45;}',
  'strong{color:#1a73e8!important;font-family:inherit!important;font-weight:600;}',
  'a{color:#1a73e8!important;}',
  'label{color:#202124;}',
  '.component-input input{background:#f8f9fa!important;color:#202124!important;border:1px solid #dadce0!important;border-radius:10px!important;padding:10px 12px!important;font-size:16px!important;}',
  '.component-input input:focus{border-color:#1a73e8!important;box-shadow:0 0 0 2px rgba(26,115,232,.2)!important;outline:none;}',
  '.component-toggle .graphic .slide{background:#bdc1c6!important;}',
  '.component-toggle .graphic .marker{background:#fff!important;box-shadow:0 1px 3px rgba(0,0,0,.4)!important;}',
  '.component-toggle input:checked+.graphic .slide{background:#8ab4f8!important;}',
  '.component-toggle input:checked+.graphic .marker{background:#1a73e8!important;}',
  '.component-select .value{color:#1a73e8;font-weight:500;}',
  '.component-select .value:after{border-top-color:#1a73e8!important;}',
  'button,.button{font-family:inherit!important;text-transform:none!important;border-radius:22px!important;}',
  'button[type=submit]{background:#1a73e8!important;color:#fff!important;font-size:17px!important;font-weight:600;width:100%;padding:13px!important;margin-top:18px!important;box-shadow:0 1px 3px rgba(26,115,232,.5);}',
  '.tap-highlight{-webkit-tap-highlight-color:rgba(26,115,232,.12)!important;}',
  // hero
  '.pm-hero{text-align:center;padding:22px 8px 6px;}',
  '.pm-hero svg{width:76px;height:76px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.2));}',
  '.pm-hero h1{font-size:26px!important;margin:8px 0 2px;color:#202124;font-weight:700;}',
  '.pm-hero p{color:#5f6368;margin:0;font-size:15px;}',
  '.pm-dots{display:inline-flex;gap:6px;margin-top:10px;}',
  '.pm-dots i{width:9px;height:9px;border-radius:50%;display:inline-block;}',
  // status pill
  '.pm-status{text-align:left;display:flex;align-items:center;gap:10px;margin:8px 0 4px;box-sizing:border-box;padding:12px 14px;border-radius:12px;font-size:15px;line-height:1.35;}',
  '.pm-status.ok{background:#e6f4ea;color:#137333;}',
  '.pm-status.todo{background:#fef7e0;color:#7a4f01;}',
  '.pm-status b{display:block;font-size:16px;}',
  '.pm-status .ic{font-size:24px;flex:0 0 auto;}',
  // guide
  '.pm-guide{padding:4px 14px 12px;}',
  '.pm-gh{font-size:19px!important;font-weight:600!important;margin:10px 0 4px!important;color:#202124;}',
  '.pm-guide .pm-mini{display:none;text-align:center;}',
  '.pm-guide.collapsed .pm-mini{display:block;}',
  '.pm-guide.collapsed .pm-full{display:none;}',
  '.section.pm-folded{background:transparent!important;box-shadow:none!important;margin-top:8px!important;}',
  '.pm-show,.pm-hide{min-width:0!important;margin:4px auto!important;padding:6px 14px!important;font-size:14px!important;background:#e8f0fe!important;color:#1a73e8!important;font-weight:600;}',
  '.pm-hide-row{text-align:center;}',
  '.pm-guide .intro{color:#3c4043;font-size:15px;line-height:1.5;margin:6px 0 10px;}',
  '.pm-need{background:#f8f9fa;border-radius:10px;padding:10px 12px;font-size:14px;color:#3c4043;line-height:1.5;margin-bottom:10px;}',
  '.pm-need b{color:#202124;}',
  '.pm-guide b,.pm-status b,.pm-step b{font-weight:700!important;}',
  '.pm-step{border:1px solid #e8eaed;border-radius:12px;margin:10px 0;overflow:hidden;background:#fff;}',
  '.pm-step summary{list-style:none;display:flex;align-items:center;gap:12px;padding:12px;cursor:pointer;font-weight:600;font-size:16px;color:#202124;}',
  '.pm-step summary::-webkit-details-marker{display:none;}',
  '.pm-step summary .n{flex:0 0 30px;height:30px;border-radius:50%;background:#1a73e8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;}',
  '.pm-step.done summary .n{background:#1e8e3e;}',
  '.pm-step summary .t{flex:1;}',
  '.pm-step summary .chev{color:#5f6368;transition:transform .2s;}',
  '.pm-step[open] summary .chev{transform:rotate(90deg);}',
  '.pm-step .body{padding:0 14px 14px 54px;font-size:15px;line-height:1.55;color:#3c4043;}',
  '.pm-step .body ol{padding-left:20px;margin:6px 0;list-style:decimal!important;}',
  '.pm-step .body ul{list-style:disc!important;}',
  '.pm-step .body ol li,.pm-step .body ul li{display:list-item!important;}',
  '.pm-step .body li{margin:5px 0;}',
  '.pm-step .tip{background:#e8f0fe;color:#174ea6;border-radius:8px;padding:8px 10px;margin-top:8px;font-size:14px;}',
  '.pm-step .warn{background:#fce8e6;color:#a50e0e;border-radius:8px;padding:8px 10px;margin-top:8px;font-size:14px;}',
  '.pm-link{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap;}',
  '.pm-link button.go{min-width:0;margin:0;background:#1a73e8!important;color:#fff!important;border:0!important;border-radius:20px;padding:8px 18px!important;font-weight:600;font-size:15px!important;}',
  '.pm-link .note{font-size:13px;color:#188038;font-weight:600;}',
  '.pm-link button.copy{min-width:0;margin:0;background:#fff!important;color:#1a73e8!important;border:1px solid #dadce0!important;padding:7px 12px!important;font-size:14px!important;}',
  '.pm-link .url{display:block;width:100%;font-size:12px;color:#5f6368;word-break:break-all;-webkit-user-select:all;user-select:all;}',
  '.pm-jump{margin-top:12px;}',
  '.pm-keytest .voice{font-size:14px;line-height:1.4;margin-top:8px;border-radius:10px;}',
  '.pm-keytest .voice.ok{color:#188038;}',
  '.pm-keytest .voice.wait{color:#5f6368;}',
  '.pm-keytest .voice.bad{color:#a50e0e;background:#fce8e6;padding:10px 12px;}',
  '.pm-jump button{background:#fef7e0!important;color:#3c4043!important;border:1px solid #f9ab00!important;border-radius:20px;padding:8px 16px!important;font-size:15px!important;}',
  '.pm-check{display:flex!important;align-items:center;justify-content:flex-start!important;gap:8px;padding:8px 0 0!important;font-size:14px;color:#1e8e3e;font-weight:600;}',
  '.pm-check input{width:20px;height:20px;}',
  '.pm-chip{display:inline-block;background:#f1f3f4;border-radius:6px;padding:1px 6px;font-weight:600;color:#202124;}',
  '.pm-free{font-size:14px;color:#3c4043;background:#e6f4ea;border-radius:10px;padding:10px 12px;margin-top:10px;line-height:1.5;}',
  // key test
  '.pm-keytest{padding:0 14px 14px;}',
  '.pm-keytest .msg{font-size:15px;padding:10px 12px;border-radius:10px;margin-top:4px;line-height:1.4;}',
  '.pm-keytest .msg.ok{background:#e6f4ea;color:#137333;}',
  '.pm-keytest .msg.bad{background:#fce8e6;color:#a50e0e;}',
  '.pm-keytest .msg.wait{background:#f1f3f4;color:#3c4043;}',
  '.pm-keytest .mapbox{margin-top:10px;border-radius:12px;overflow:hidden;border:1px solid #dadce0;display:none;}',
  '.pm-keytest .mapbox img{display:block;width:100%;}',
  // favorites
  '.pm-favs{padding:4px 14px 14px;}',
  '.pm-fav{border:1px solid #e8eaed;border-radius:12px;padding:10px 12px;margin:10px 0;background:#fff;}',
  '.pm-fav .row{display:flex;gap:8px;align-items:center;}',
  '.pm-fav .star{color:#f9ab00;font-size:20px;}',
  '.pm-fav input,.pm-fav select{flex:1;width:100%;box-sizing:border-box;font-family:inherit;font-size:16px;color:#202124;background:#f8f9fa;border:1px solid #dadce0;border-radius:8px;padding:8px 10px;margin:4px 0;-webkit-appearance:none;}',
  '.pm-fav select{background-image:linear-gradient(45deg,transparent 50%,#1a73e8 50%),linear-gradient(135deg,#1a73e8 50%,transparent 50%);background-position:calc(100% - 18px) 55%,calc(100% - 12px) 55%;background-size:6px 6px;background-repeat:no-repeat;}',
  '.pm-fav input.name{font-weight:600;}',
  '.pm-fav .lbl{font-size:12px;color:#5f6368;margin-top:6px;}',
  '.pm-fav .tools{display:flex;gap:6px;justify-content:flex-end;margin-top:6px;}',
  '.pm-fav .tools button{min-width:0;margin:0;padding:6px 12px!important;font-size:14px!important;background:#f1f3f4!important;color:#3c4043!important;}',
  '.pm-fav .tools button.del{color:#d93025!important;}',
  '.pm-fav .saved{font-size:12px;color:#1e8e3e;margin-top:2px;}',
  '.pm-favs .add{width:100%;background:#e8f0fe!important;color:#1a73e8!important;font-weight:600;padding:12px!important;margin:6px 0 0!important;}',
  '.pm-favs .empty{color:#5f6368;font-size:15px;text-align:center;padding:14px 4px;}',
  '.pm-footer{color:#5f6368;font-size:13px;text-align:center;padding:16px 10px 0;line-height:1.5;}'
].join('\n');

// A fresh object per component (Clay's serializer marks shared objects as circular)
function staticManipulator() {
  return {
    get: function () { return ''; },
    set: function () { return this; },
    hide: function () { this.$element.set('+hide'); return this; },
    show: function () { this.$element.set('-hide'); return this; }
  };
}

module.exports = [
  // Global theme (Google Material look)
  {
    name: 'pmtheme',
    template: '<div class="pm-theme"></div>',
    style: THEME_CSS,
    manipulator: staticManipulator()
  },

  // Hero header
  {
    name: 'pmhero',
    template: [
      '<div class="pm-hero">',
      '<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">',
      '<rect x="4" y="4" width="88" height="88" rx="22" fill="#ffffff" stroke="#dadce0" stroke-width="2"/>',
      '<path d="M4 62 L40 92 L4 92 Z" fill="#a8dab5"/>',
      '<path d="M14 80 C30 60 44 56 70 60" stroke="#1a73e8" stroke-width="8" fill="none" stroke-linecap="round"/>',
      '<path d="M60 12c-11 0-19 8-19 19 0 14 19 31 19 31s19-17 19-31c0-11-8-19-19-19z" fill="#ea4335"/>',
      '<circle cx="60" cy="31" r="7" fill="#a50e0e"/>',
      '</svg>',
      '<h1>Pebble Maps</h1>',
      '<p>Google Maps directions on your wrist</p>',
      '<div class="pm-dots"><i style="background:#4285f4"></i><i style="background:#ea4335"></i>',
      '<i style="background:#fbbc04"></i><i style="background:#34a853"></i></div>',
      '<div class="pm-jump" style="display:none"><button type="button">🔑 Set up your Google key ↓</button></div>',
      '</div>'
    ].join(''),
    manipulator: staticManipulator(),
    initialize: function (minified, clay) {
      var root = this.$element[0];
      var jump = root.querySelector('.pm-jump');
      jump.querySelector('button').addEventListener('click', function () {
        var target = document.getElementById('pm-key-area');
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      clay.on(clay.EVENTS.AFTER_BUILD, function () {
        var item = clay.getItemByMessageKey('apiKey');
        function refresh() {
          var v = item ? String(item.get() || '').trim() : '';
          jump.style.display = (v || window.pmSetupFirst) ? 'none' : 'block';
        }
        if (item) {
          item.on('change', refresh);
          var input = item.$manipulatorTarget[0];
          if (input) input.addEventListener('input', refresh);
        }
        refresh();
      });
    }
  },

  // Key status ("You're all set" / "Let's get you set up"), shown with the key box
  {
    name: 'pmstatus',
    template: '<div id="pm-key-area"><div class="pm-status todo" id="pm-status"></div></div>',
    manipulator: staticManipulator(),
    initialize: function (minified, clay) {
      var root = this.$element[0];
      clay.on(clay.EVENTS.AFTER_BUILD, function () {
        var item = clay.getItemByMessageKey('apiKey');
        var status = root.querySelector('#pm-status');
        function refresh() {
          var v = String(item.get() || '').trim();
          if (v) {
            status.className = 'pm-status ok';
            status.innerHTML = '<span class="ic">✅</span><span><b>You\'re all set</b>' +
              'Your Google key is saved.</span>';
          } else {
            status.className = 'pm-status todo';
            status.innerHTML = '<span class="ic">🔑</span><span><b>Let\'s get you set up</b>' +
              'Pebble Maps uses your own free Google Maps key. Follow the steps below — about 10 minutes, one time only.</span>';
          }
        }
        if (item) {
          item.on('change', refresh);
          var input = item.$manipulatorTarget[0];
          if (input) input.addEventListener('input', refresh);
          refresh();
        }
      });
    }
  },

  // Step-by-step guide to get a Google Maps API key
  {
    name: 'pmguide',
    template: [
      '<div class="pm-guide">',
      '<div class="pm-mini"><button type="button" class="pm-show">Show setup instructions</button></div>',
      '<div class="pm-full">',
      '<h4 class="pm-gh">Get your free Google Maps key</h4>',
      '<p class="intro">Google charges apps for map data, so instead of a subscription, Pebble Maps lets you use ',
      '<b>your own Google key</b>. Google gives every key a big free monthly allowance — far more than one person uses.</p>',

      '<div class="pm-need"><b>You will need:</b><br>',
      '• A Google account (your Gmail login works)<br>',
      '• A credit or debit card — Google uses it to confirm you\'re a real person<br>',
      '<b>Tip:</b> it\'s easiest on a computer. When you get your key in step 5, email it to yourself, then open this page on your phone and paste it.</div>',

      // Step 1
      '<details class="pm-step" data-step="1"><summary><span class="n">1</span><span class="t">Sign in to Google Cloud</span><span class="chev">›</span></summary>',
      '<div class="body"><ol>',
      '<li>Open Google Cloud:</li></ol>',
      '<div class="pm-link" data-url="https://console.cloud.google.com/"></div>',
      '<ol start="2"><li>Sign in with your Google account.</li>',
      '<li>If Google asks, choose your <b>country</b>, tick the box to agree to the <b>Terms of Service</b>, and tap <span class="pm-chip">Agree and continue</span>.</li>',
      '<li>If a "free trial" offer pops up, you can close it for now — billing is step 3.</li></ol>',
      '</div></details>',

      // Step 2
      '<details class="pm-step" data-step="2"><summary><span class="n">2</span><span class="t">Make a project</span><span class="chev">›</span></summary>',
      '<div class="body"><p>A "project" is just a folder in Google Cloud for your key.</p><ol>',
      '<li>Open the new-project page:</li></ol>',
      '<div class="pm-link" data-url="https://console.cloud.google.com/projectcreate"></div>',
      '<ol start="2"><li>In <b>Project name</b>, type <span class="pm-chip">Pebble Maps</span></li>',
      '<li>Leave everything else alone and tap <span class="pm-chip">Create</span>.</li>',
      '<li>Wait about 30 seconds. At the top of the page, make sure it says <b>Pebble Maps</b>. If not, tap the project name at the top and pick Pebble Maps.</li></ol>',
      '</div></details>',

      // Step 3
      '<details class="pm-step" data-step="3"><summary><span class="n">3</span><span class="t">Turn on billing (stays free)</span><span class="chev">›</span></summary>',
      '<div class="body"><p>Google requires a card on file before it will hand out map data, even for the free allowance.</p><ol>',
      '<li>Open the billing page for your project:</li></ol>',
      '<div class="pm-link" data-url="https://console.cloud.google.com/billing/linkedaccount"></div>',
      '<ol start="2"><li>Tap <span class="pm-chip">Link a billing account</span>, then <span class="pm-chip">Create billing account</span> (or pick one you already have).</li>',
      '<li>Follow Google\'s screens: your name, address, and card.</li>',
      '<li>When it asks which project to use, choose <b>Pebble Maps</b>.</li></ol>',
      '<div class="tip">If Google gives you a free trial and later shows an <b>"Activate full account"</b> button, tap it — otherwise your key stops when the trial ends. You still only pay if you go over the free allowance (see below), and step 6 adds an email alert just in case.</div>',
      '</div></details>',

      // Step 4
      '<details class="pm-step" data-step="4"><summary><span class="n">4</span><span class="t">Turn on the map services</span><span class="chev">›</span></summary>',
      '<div class="body"><p>This one link turns on all five services Pebble Maps uses:</p>',
      '<div class="pm-link" data-url="https://console.cloud.google.com/flows/enableapi?apiid=static-maps-backend.googleapis.com,places.googleapis.com,routes.googleapis.com,geocoding-backend.googleapis.com,texttospeech.googleapis.com"></div>',
      '<ol><li>Check the project at the top says <b>Pebble Maps</b>.</li>',
      '<li>Tap <span class="pm-chip">Next</span>, then <span class="pm-chip">Enable</span>.</li></ol>',
      '<p>That turns on:</p><ul style="padding-left:18px;margin:4px 0">',
      '<li><b>Maps Static API</b> — the map pictures</li>',
      '<li><b>Places API (New)</b> — searching for places</li>',
      '<li><b>Routes API</b> — directions and travel times</li>',
      '<li><b>Geocoding API</b> — turning addresses into map spots</li>',
      '<li><b>Cloud Text-to-Speech API</b> — spoken directions on watches with a speaker (Pebble Time 2, Pebble Round 2)</li></ul>',
      '<div class="tip">If Google says billing is required, finish step 3 first, then open this link again.</div>',
      '</div></details>',

      // Step 5
      '<details class="pm-step" data-step="5"><summary><span class="n">5</span><span class="t">Create your key</span><span class="chev">›</span></summary>',
      '<div class="body"><ol>',
      '<li>Open the Credentials page:</li></ol>',
      '<div class="pm-link" data-url="https://console.cloud.google.com/apis/credentials"></div>',
      '<ol start="2"><li>Tap <span class="pm-chip">+ Create credentials</span> at the top, then <span class="pm-chip">API key</span>.</li>',
      '<li>If it asks for a name, type <span class="pm-chip">Pebble Maps</span>. If you see a box about a "service account", leave it <b>unticked</b>.</li>',
      '<li>Your key appears. It starts with <b>AIza</b> and is about 39 letters and numbers long. Tap the <b>copy</b> icon next to it.</li></ol>',
      '<p><b>Make it safer (recommended):</b></p><ol>',
      '<li>Tap the key\'s name (or <span class="pm-chip">Edit API key</span>).</li>',
      '<li>Under <b>API restrictions</b>, choose <span class="pm-chip">Restrict key</span> and tick the five services from step 4.</li>',
      '<li>Tap <span class="pm-chip">Save</span>.</li></ol>',
      '<div class="warn">Leave <b>Application restrictions</b> set to <b>None</b>. "Websites", "Android apps" or "iOS apps" will block Pebble Maps.</div>',
      '</div></details>',

      // Step 6
      '<details class="pm-step" data-step="6"><summary><span class="n">6</span><span class="t">Optional: $1 email alert</span><span class="chev">›</span></summary>',
      '<div class="body"><p>For peace of mind, ask Google to email you if your bill ever goes above $1.</p>',
      '<div class="pm-link" data-url="https://console.cloud.google.com/billing/budgets"></div>',
      '<ol><li>Tap <span class="pm-chip">Create budget</span>.</li>',
      '<li>Name it <span class="pm-chip">Pebble Maps</span> and tap <span class="pm-chip">Next</span>.</li>',
      '<li>Set the amount to <span class="pm-chip">1</span>, keep the suggested alerts, and tap <span class="pm-chip">Finish</span>.</li></ol>',
      '</div></details>',

      // Step 7
      '<details class="pm-step" data-step="7" open><summary><span class="n">7</span><span class="t">Paste your key</span><span class="chev">›</span></summary>',
      '<div class="body">Tap the <b>Google Maps key</b> box (with these steps), paste your key, then tap <b>Save settings</b> at the bottom. ',
      'A map preview appears when the key works, and your watch will say <b>"Your Google key works!"</b></div></details>',

      '<div class="pm-free"><b>What\'s free?</b> Every month Google includes about 10,000 map pictures, 5,000 place searches and 5,000–10,000 route lookups at no charge. ',
      'A typical trip in Pebble Maps uses around 10, so normal use costs nothing.</div>',
      '<div class="pm-hide-row"><button type="button" class="pm-hide">Hide instructions</button></div>',
      '</div></div>'
    ].join(''),
    manipulator: staticManipulator(),
    initialize: function (minified, clay) {
      var root = this.$element[0];
      // Once a key is saved and confirmed, fold the guide into one small button
      function setCollapsed(on) {
        var section = root.parentNode;
        root.className = 'pm-guide' + (on ? ' collapsed' : '');
        if (section && section.classList) {
          if (on) section.classList.add('pm-folded');
          else section.classList.remove('pm-folded');
        }
      }
      root.querySelector('.pm-show').addEventListener('click', function () { setCollapsed(false); });
      root.querySelector('.pm-hide').addEventListener('click', function () { setCollapsed(true); });
      window.addEventListener('pm-key-ok', function () { setCollapsed(true); });
      window.addEventListener('pm-key-empty', function () { setCollapsed(false); });
      clay.on(clay.EVENTS.AFTER_BUILD, function () {
        var item = clay.getItemByMessageKey('apiKey');
        var has = item && String(item.get() || '').trim();
        setCollapsed(!!has);
        root.querySelector('.pm-hide-row').style.display = has ? 'block' : 'none';
        // Until setup is finished (every step ticked, or the key confirmed working),
        // the guide and the key box come first; after that the everyday settings do.
        var doneAll = true;
        for (var k = 1; k <= 6; k++) if (!done[k]) doneAll = false;
        var ud = (clay.meta && clay.meta.userData) || {};
        var verified = !!has && !!ud.keyOk;   // the phone has used this key successfully
        try { if (!!has && localStorage.getItem('pm-key-ok') === String(has)) verified = true; } catch (e) { /* no storage */ }
        var setupFirst = !(doneAll || verified);
        window.pmSetupFirst = setupFirst;
        if (setupFirst) {
          var guideSection = root.parentElement;
          var keyArea = document.getElementById('pm-key-area');
          var keySection = keyArea && keyArea.parentElement;
          var hero = document.querySelector('.pm-hero');
          var form = hero && hero.parentElement;
          if (form && guideSection && keySection) {
            form.insertBefore(guideSection, hero.nextSibling);
            form.insertBefore(keySection, guideSection.nextSibling);
          }
          setCollapsed(false);
        }
        var jump = document.querySelector('.pm-jump');
        if (jump && setupFirst) jump.style.display = 'none';
      });
      // Link rows. Links opened from here would load inside the Pebble app, where you aren't
      // signed in to Google, so we copy the address for you to paste into Chrome instead.
      function copyText(text) {
        var ok = false;
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.top = '0';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          ta.setSelectionRange(0, text.length);
          ok = document.execCommand('copy');
          document.body.removeChild(ta);
        } catch (e) { ok = false; }
        if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
          try { navigator.clipboard.writeText(text); ok = true; } catch (e2) { ok = false; }
        }
        return ok;
      }
      var links = root.querySelectorAll('.pm-link');
      Array.prototype.forEach.call(links, function (box) {
        var url = box.getAttribute('data-url');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'go';
        b.textContent = 'Copy link';
        var note = document.createElement('span');
        note.className = 'note';
        var u = document.createElement('span');
        u.className = 'url';
        u.textContent = url;
        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          if (copyText(url)) {
            b.textContent = 'Copied ✓';
            note.textContent = 'Now open Chrome, tap the address bar, and paste.';
          } else {
            note.textContent = 'Press and hold the address below, then choose Copy.';
          }
          setTimeout(function () { b.textContent = 'Copy link'; }, 3000);
        });
        box.appendChild(b);
        box.appendChild(note);
        box.appendChild(u);
      });
      // "I did this" checkboxes remembered on this phone
      var done = {};
      try { done = JSON.parse(localStorage.getItem('pm-guide-done') || '{}'); } catch (e) { done = {}; }
      var steps = root.querySelectorAll('.pm-step');
      Array.prototype.forEach.call(steps, function (st) {
        var n = st.getAttribute('data-step');
        if (n === '7') return;
        var lab = document.createElement('label');
        lab.className = 'pm-check';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!done[n];
        if (done[n]) st.className += ' done';
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode('I did this step'));
        cb.addEventListener('change', function () {
          done[n] = cb.checked;
          try { localStorage.setItem('pm-guide-done', JSON.stringify(done)); } catch (e) { /* private mode */ }
          st.className = 'pm-step' + (cb.checked ? ' done' : '');
          if (cb.checked) {
            st.removeAttribute('open');
            var next = root.querySelector('.pm-step[data-step="' + (parseInt(n, 10) + 1) + '"]');
            if (next) {
              next.setAttribute('open', '');
              if (next.scrollIntoView) next.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }
        });
        st.querySelector('.body').appendChild(lab);
      });
      // open the first unfinished step
      for (var i = 1; i <= 6; i++) {
        if (!done[i]) {
          var s = root.querySelector('.pm-step[data-step="' + i + '"]');
          if (s) s.setAttribute('open', '');
          break;
        }
      }
    }
  },

  // Live key check: shows a Google map preview using the pasted key
  {
    name: 'pmkeytest',
    template: '<div class="pm-keytest"><div class="msg wait">Paste your key above to test it.</div><div class="mapbox"><img alt="Map preview"></div><div class="voice"></div></div>',
    manipulator: staticManipulator(),
    initialize: function (minified, clay) {
      var root = this.$element[0];
      var msg = root.querySelector('.msg');
      var box = root.querySelector('.mapbox');
      var img = root.querySelector('img');
      var ud = (clay.meta && clay.meta.userData) || {};
      var lat = ud.lat || 40.7580, lng = ud.lng || -73.9855;
      var timer = null;
      function show(cls, text) {
        msg.className = 'msg ' + cls;
        msg.textContent = text;
      }
      // Spoken directions use Google's Text-to-Speech: check it separately
      var voiceEl = root.querySelector('.voice');
      function testVoice(key) {
        voiceEl.className = 'voice wait';
        voiceEl.textContent = 'Spoken directions: checking…';
        var x = new XMLHttpRequest();
        x.open('POST', 'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(key), true);
        x.setRequestHeader('Content-Type', 'application/json');
        x.onload = function () {
          if (x.status >= 200 && x.status < 300) {
            voiceEl.className = 'voice ok';
            voiceEl.textContent = '✓ Spoken directions are ready (Pebble Time 2 and Round 2).';
            return;
          }
          var body = String(x.responseText || '');
          var why;
          if (/API_KEY_SERVICE_BLOCKED|are blocked/i.test(body)) {
            why = 'your key is limited to certain services. Open your key (step 5) and also tick "Cloud Text-to-Speech API" under API restrictions, then save.';
          } else if (/SERVICE_DISABLED|has not been used|is disabled/i.test(body)) {
            why = 'the Text-to-Speech service is off. Open the link in step 4 and tap Enable. It can take a few minutes to start working.';
          } else if (/billing/i.test(body)) {
            why = 'Google needs billing turned on (step 3).';
          } else {
            var m = body.match(/"message"\s*:\s*"([^"]+)"/);
            why = 'Google said: ' + (m ? m[1] : 'error ' + x.status);
          }
          voiceEl.className = 'voice bad';
          voiceEl.textContent = 'Spoken directions won\'t work yet: ' + why + ' (Everything else works without it.)';
        };
        x.onerror = function () {
          voiceEl.className = 'voice wait';
          voiceEl.textContent = 'Spoken directions: couldn\'t check right now.';
        };
        x.send(JSON.stringify({ input: { text: 'ok' }, voice: { languageCode: 'en-US' },
                                audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 8000 } }));
      }
      function test(key) {
        voiceEl.className = 'voice';
        voiceEl.textContent = '';
        key = String(key || '').replace(/\s+/g, '');
        function fire(name) {
          try {
            var ev = document.createEvent('Event');
            ev.initEvent(name, true, true);
            window.dispatchEvent(ev);
          } catch (e) { /* old browser */ }
        }
        if (!key) {
          box.style.display = 'none';
          fire('pm-key-empty');
          return show('wait', 'Paste your key above to test it.');
        }
        if (key.indexOf('test:') === 0) return show('ok', 'Developer test mode');
        if (key.indexOf('AIza') !== 0 || key.length < 30) {
          show('bad', 'That doesn\'t look like a whole Google key. Keys start with "AIza" and are about 39 characters. Try copying it again.');
        } else {
          show('wait', 'Checking your key with Google…');
        }
        img.onload = function () {
          box.style.display = 'block';
          show('ok', '✓ It works! Google sent a map with your key. Tap Save settings below.');
          try { localStorage.setItem('pm-key-ok', key); } catch (e) { /* private mode */ }
          fire('pm-key-ok');
          testVoice(key);
        };
        img.onerror = function () {
          box.style.display = 'none';
          show('bad', '✗ Google didn\'t accept this key yet. Check steps 3–5 (billing, the services in step 4, and "Application restrictions: None"). New keys can take a few minutes to start working.');
        };
        img.src = 'https://maps.googleapis.com/maps/api/staticmap?center=' + lat + ',' + lng +
          '&zoom=15&size=480x240&scale=2&key=' + encodeURIComponent(key) + '&markers=color:red%7C' + lat + ',' + lng;
      }
      clay.on(clay.EVENTS.AFTER_BUILD, function () {
        var item = clay.getItemByMessageKey('apiKey');
        if (!item) return;
        var input = item.$manipulatorTarget[0];
        function changed() {
          // tidy up accidental spaces from copy/paste
          var clean = String(input.value || '').replace(/\s+/g, '');
          if (clean !== input.value) input.value = clean;
          clearTimeout(timer);
          timer = setTimeout(function () { test(clean); }, 500);
        }
        input.addEventListener('input', changed);
        input.addEventListener('change', changed);
        if (input.value) test(input.value);
      });
    }
  },

  // Favorites editor. Value is a JSON string shared with the watch app.
  {
    name: 'pmfavorites',
    template: '<div class="pm-favs"><input type="hidden" class="pm-favs-value" data-manipulator-target><div class="list"></div><button type="button" class="add">+ Add a favorite</button></div>',
    manipulator: {
      get: function () {
        var el = this.$element[0];
        return el._pmGet ? el._pmGet() : '[]';
      },
      set: function (value) {
        var el = this.$element[0];
        if (el._pmSet) el._pmSet(value);
        return this;
      },
      hide: function () { this.$element.set('+hide'); return this; },
      show: function () { this.$element.set('-hide'); return this; }
    },
    initialize: function () {
      var root = this.$element[0];
      var list = root.querySelector('.list');
      var favs = [];
      var MODES = [['default', 'Use my default'], ['0', 'Drive'], ['1', 'Walk'], ['2', 'Bike'], ['3', 'Transit']];

      function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text) e.textContent = text;
        return e;
      }

      function render() {
        list.innerHTML = '';
        if (!favs.length) {
          list.appendChild(el('div', 'empty', 'No favorites yet. Add places you go often — like Home or Work — or tap the ☆ star on a place in the watch app.'));
        }
        favs.forEach(function (f, i) {
          var card = el('div', 'pm-fav');
          var row = el('div', 'row');
          row.appendChild(el('span', 'star', '★'));
          var name = el('input', 'name');
          name.placeholder = 'Name (e.g. Home)';
          name.value = f.name || '';
          name.addEventListener('input', function () { f.name = name.value; });
          row.appendChild(name);
          card.appendChild(row);

          card.appendChild(el('div', 'lbl', 'Address or place'));
          var addr = el('input', 'addr');
          addr.placeholder = 'e.g. 1600 Amphitheatre Pkwy, Mountain View, CA';
          addr.value = f.address || '';
          addr.addEventListener('input', function () {
            f.address = addr.value;
            // the location will be looked up again from the new address
            delete f.lat;
            delete f.lng;
            f.placeId = '';
          });
          card.appendChild(addr);
          if (f.lat !== undefined && f.lat !== null && f.lat !== '') {
            card.appendChild(el('div', 'saved', '✓ Saved from your watch / map'));
          }

          card.appendChild(el('div', 'lbl', 'Usually get there by'));
          var sel = el('select');
          MODES.forEach(function (m) {
            var o = el('option', null, m[1]);
            o.value = m[0];
            sel.appendChild(o);
          });
          sel.value = (f.mode === undefined || f.mode === null || f.mode === '' || f.mode === 'default') ? 'default' : String(f.mode);
          sel.addEventListener('change', function () { f.mode = sel.value === 'default' ? 'default' : parseInt(sel.value, 10); });
          card.appendChild(sel);

          var tools = el('div', 'tools');
          var up = el('button', null, '↑');
          up.type = 'button';
          up.disabled = i === 0;
          up.addEventListener('click', function () {
            var t = favs[i - 1]; favs[i - 1] = favs[i]; favs[i] = t; render();
          });
          var down = el('button', null, '↓');
          down.type = 'button';
          down.disabled = i === favs.length - 1;
          down.addEventListener('click', function () {
            var t = favs[i + 1]; favs[i + 1] = favs[i]; favs[i] = t; render();
          });
          var del = el('button', 'del', 'Remove');
          del.type = 'button';
          del.addEventListener('click', function () {
            if (window.confirm('Remove "' + (f.name || f.address || 'this favorite') + '"?')) {
              favs.splice(i, 1);
              render();
            }
          });
          tools.appendChild(up);
          tools.appendChild(down);
          tools.appendChild(del);
          card.appendChild(tools);
          list.appendChild(card);
        });
      }

      root._pmGet = function () {
        var clean = favs.filter(function (f) {
          return String(f.name || '').trim() || String(f.address || '').trim();
        }).map(function (f) {
          var o = { name: String(f.name || '').trim() || String(f.address || '').trim(), address: String(f.address || '').trim(), mode: f.mode === undefined ? 'default' : f.mode };
          if (f.lat !== undefined && f.lat !== null && f.lat !== '') { o.lat = f.lat; o.lng = f.lng; }
          if (f.placeId) o.placeId = f.placeId;
          if (f.geocodedFrom !== undefined && o.lat !== undefined) o.geocodedFrom = f.geocodedFrom;
          return o;
        });
        return JSON.stringify(clean.slice(0, 20));
      };
      root._pmSet = function (value) {
        try {
          favs = JSON.parse(value || '[]');
          if (!Array.isArray(favs)) favs = [];
        } catch (e) {
          favs = [];
        }
        render();
      };
      root.querySelector('.add').addEventListener('click', function () {
        if (favs.length >= 20) return window.alert('You can save up to 20 favorites.');
        favs.push({ name: '', address: '', mode: 'default' });
        render();
        var inputs = list.querySelectorAll('input.name');
        if (inputs.length) inputs[inputs.length - 1].focus();
      });
      render();
    }
  }
];
