// Pebble Maps - short, glanceable directions
//
// Google: "Continue straight onto Martin Luther King Jr. Boulevard/CR649 W"
// Watch:  "Stay on CR649 W"
//
// brief(text, maneuver, forSpeech): forSpeech keeps whole words ("Street",
// "North") so the voice reads them naturally.

var ABBR = [
  [/\bNortheast\b/g, 'NE'], [/\bNorthwest\b/g, 'NW'], [/\bSoutheast\b/g, 'SE'], [/\bSouthwest\b/g, 'SW'],
  [/\bNorth\b/g, 'N'], [/\bSouth\b/g, 'S'], [/\bEast\b/g, 'E'], [/\bWest\b/g, 'W'],
  [/\bBoulevard\b/g, 'Blvd'], [/\bStreet\b/g, 'St'], [/\bAvenue\b/g, 'Ave'], [/\bRoad\b/g, 'Rd'],
  [/\bDrive\b/g, 'Dr'], [/\bHighway\b/g, 'Hwy'], [/\bParkway\b/g, 'Pkwy'], [/\bLane\b/g, 'Ln'],
  [/\bCourt\b/g, 'Ct'], [/\bPlace\b/g, 'Pl'], [/\bTerrace\b/g, 'Ter'], [/\bExpressway\b/g, 'Expy'],
  [/\bFreeway\b/g, 'Fwy'], [/\bCircle\b/g, 'Cir'], [/\bTurnpike\b/g, 'Tpke'], [/\bCounty Road\b/g, 'CR'],
  [/\bState Route\b/g, 'SR'], [/\bInterstate\b/g, 'I'], [/\bMount\b/g, 'Mt'], [/\bFort\b/g, 'Ft'],
  [/\bCenter\b/g, 'Ctr'], [/\bJunior\b/g, 'Jr']
];

function abbreviate(s) {
  ABBR.forEach(function (a) { s = s.replace(a[0], a[1]); });
  return s;
}

function tidy(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,.]+$/g, '');
}

// "Martin Luther King Jr. Blvd/CR649 W" -> the shortest of the names
function roadName(s, forSpeech) {
  s = tidy(s);
  if (!s) return '';
  var parts = s.split('/').map(tidy).filter(Boolean);
  if (!forSpeech) parts = parts.map(abbreviate);
  parts.sort(function (a, b) { return a.length - b.length; });
  var best = parts[0] || s;
  // a number-only name ("649") reads better with its sibling if that's short too
  return best;
}

// Text after a keyword (onto / on / to / toward), stopping at "toward"/"for"
function after(text, re) {
  var m = text.match(re);
  if (!m) return '';
  return tidy(m[1].split(/,|\s+(?:toward|towards|for|via|and|then)\s+/i)[0]);
}

function brief(text, maneuver, forSpeech) {
  text = String(text || '');
  if (!tidy(text)) return 'Continue';
  // first sentence only ("... Destination will be on the right")
  var first = tidy(text.split(/\n|\.\s+(?=(?:Destination|Pass|Go|Continue|Then|Restricted|Toll|Partial|Entering|Parts?|Your)\b)/)[0]);
  var lower = first.toLowerCase();
  var onto = after(first, /\b(?:onto|on to)\s+(.+)$/i);
  var on = onto || after(first, /\b(?:on|to stay on)\s+(.+)$/i);
  var road = roadName(on, forSpeech);
  var exit = first.match(/\bexit\s+(\w+[A-Za-z]?)/i);
  var toward = after(first, /\btoward(?:s)?\s+(.+)$/i);
  var towardName = roadName(toward, forSpeech);
  var side = /\bleft\b/i.test(lower) ? 'left' : (/\bright\b/i.test(lower) ? 'right' : '');
  var out;
  maneuver = maneuver || '';

  if (/ROUNDABOUT/.test(maneuver) || /roundabout|traffic circle|rotary/i.test(lower)) {
    var nth = lower.match(/\b(\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth)\s+exit/);
    if (!nth && /straight|stay on/.test(lower)) out = road ? 'Roundabout, stay on ' + road : 'Roundabout, go straight';
    else out = (nth ? 'Roundabout, ' + nth[1] + ' exit' : 'Roundabout') + (road ? ' onto ' + road : '');
  } else if (exit && /RAMP|exit/i.test(maneuver + ' ' + lower)) {
    out = 'Take exit ' + exit[1] + (towardName ? ' to ' + towardName : '');
  } else if (/RAMP/.test(maneuver) || /\bramp\b/i.test(lower)) {
    out = 'Take ramp' + (road ? ' onto ' + road : (towardName ? ' to ' + towardName : ''));
  } else if (/MERGE/.test(maneuver) || /^merge/i.test(lower)) {
    out = 'Merge' + (road ? ' onto ' + road : '');
  } else if (/FORK/.test(maneuver) || /^keep/i.test(lower)) {
    out = 'Keep ' + (side || 'straight') + (road ? ' on ' + road : (towardName ? ' to ' + towardName : ''));
  } else if (/UTURN/.test(maneuver) || /u-turn/i.test(lower)) {
    out = 'Make a U-turn' + (road ? ' onto ' + road : '');
  } else if (/TURN_SLIGHT/.test(maneuver) || /^(?:turn )?slight/i.test(lower)) {
    out = 'Slight ' + side + (road ? ' onto ' + road : '');
  } else if (/TURN_SHARP/.test(maneuver) || /^(?:turn )?sharp/i.test(lower)) {
    out = 'Sharp ' + side + (road ? ' onto ' + road : '');
  } else if (/TURN_(LEFT|RIGHT)/.test(maneuver) || /^turn (left|right)/i.test(lower)) {
    out = 'Turn ' + side + (road ? ' onto ' + road : '');
  } else if (/STRAIGHT|NAME_CHANGE/.test(maneuver) || /^continue/i.test(lower)) {
    out = road ? 'Stay on ' + road : 'Continue straight';
  } else if (/DEPART/.test(maneuver) || /^head/i.test(lower)) {
    var dir = lower.match(/^head\s+(north|south|east|west|northeast|northwest|southeast|southwest)/);
    out = 'Head ' + (dir ? (forSpeech ? dir[1] : abbreviate(dir[1].charAt(0).toUpperCase() + dir[1].slice(1))) : '') +
          (road ? ' on ' + road : '');
  } else {
    out = forSpeech ? first : abbreviate(first);
  }
  out = tidy(out);
  return forSpeech ? speakable(out) : out;
}

// Spell out short road words so the voice doesn't say "W" or "saint"
var SAY = [
  [/(^|\s)NE(?=\s|$)/g, '$1Northeast'], [/(^|\s)NW(?=\s|$)/g, '$1Northwest'],
  [/(^|\s)SE(?=\s|$)/g, '$1Southeast'], [/(^|\s)SW(?=\s|$)/g, '$1Southwest'],
  [/(^|\s)N(?=\s|$)/g, '$1North'], [/(^|\s)S(?=\s|$)/g, '$1South'],
  [/(^|\s)E(?=\s|$)/g, '$1East'], [/(^|\s)W(?=\s|$)/g, '$1West'],
  [/\bSt\b\.?/g, 'Street'], [/\bAve\b\.?/g, 'Avenue'], [/\bRd\b\.?/g, 'Road'], [/\bDr\b\.?/g, 'Drive'],
  [/\bBlvd\b\.?/g, 'Boulevard'], [/\bHwy\b\.?/g, 'Highway'], [/\bPkwy\b\.?/g, 'Parkway'], [/\bLn\b\.?/g, 'Lane'],
  [/\bCt\b\.?/g, 'Court'], [/\bPl\b\.?/g, 'Place'], [/\bI-(\d)/g, 'I $1']
];

function speakable(s) {
  SAY.forEach(function (a) { s = s.replace(a[0], a[1]); });
  return s;
}

// "0.3 mi" -> "0.3 miles" for the voice
function spokenDistance(d) {
  return String(d || '')
    .replace(/^0\.(\d) mi$/, '0.$1 miles').replace(/ mi$/, ' miles').replace(/^1(?:\.0)? miles$/, '1 mile')
    .replace(/ ft$/, ' feet').replace(/ km$/, ' kilometers').replace(/ m$/, ' meters');
}

module.exports = { brief: brief, abbreviate: abbreviate, spokenDistance: spokenDistance };
