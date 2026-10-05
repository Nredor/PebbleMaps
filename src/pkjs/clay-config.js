// Pebble Maps - settings page layout (Clay)

function config() {
  return [
    { type: 'pmtheme' },
    { type: 'pmhero' },
    {
      type: 'section',
      items: [
        { type: 'heading', defaultValue: '★ Favorites', size: 4 },
        {
          type: 'text',
          defaultValue: 'Places you go often. Each one can have its own way of getting there. ' +
            'On the watch, press the red pin button (<strong>Down</strong>) on the map, then Favorites.'
        },
        { type: 'pmfavorites', messageKey: 'favorites', defaultValue: '[]' }
      ]
    },
    {
      type: 'section',
      items: [
        { type: 'heading', defaultValue: 'Getting around', size: 4 },
        {
          type: 'select',
          messageKey: 'defaultMode',
          label: 'Default travel mode',
          defaultValue: '0',
          description: 'Used for new places. You can still pick a different way each time.',
          options: [
            { label: 'Drive', value: '0' },
            { label: 'Walk', value: '1' },
            { label: 'Bike', value: '2' },
            { label: 'Transit', value: '3' }
          ]
        },
        {
          type: 'select',
          messageKey: 'units',
          label: 'Distances in',
          defaultValue: 'auto',
          options: [
            { label: 'Automatic', value: 'auto' },
            { label: 'Miles & feet', value: 'imperial' },
            { label: 'Kilometers & meters', value: 'metric' }
          ]
        },
        {
          type: 'toggle',
          messageKey: 'allModeTimes',
          label: 'Show times for every travel mode',
          description: 'When you pick a place, see how long it takes to drive, walk, bike or take transit.',
          defaultValue: true
        },
        {
          type: 'toggle',
          messageKey: 'vibrate',
          label: 'Buzz before turns',
          defaultValue: true
        },
        {
          type: 'toggle',
          messageKey: 'avoidTolls',
          label: 'Avoid tolls (driving)',
          defaultValue: false
        },
        {
          type: 'toggle',
          messageKey: 'avoidHighways',
          label: 'Avoid highways (driving)',
          defaultValue: false
        },
        {
          type: 'toggle',
          messageKey: 'avoidFerries',
          label: 'Avoid ferries (driving)',
          defaultValue: false
        },
        { type: 'heading', defaultValue: 'Map', size: 4 },
        {
          type: 'toggle',
          messageKey: 'liveLocation',
          label: 'Live location',
          description: 'Your blue dot moves with you on the map (it turns into an arrow while you\'re moving). ' +
            'Turn off to save battery: the map then shows where you were when you opened it.',
          defaultValue: true
        },
        {
          type: 'toggle',
          messageKey: 'driveMode',
          label: 'Driving mode',
          description: 'The main map turns with you and keeps you near the bottom, like the Google Maps app. ' +
            'Off: north is always up.',
          defaultValue: false
        },
        {
          type: 'toggle',
          messageKey: 'drivePois',
          id: 'drivePois',
          label: 'Places in driving mode',
          description: 'Show restaurants, shops, parks and more as small colored dots while in driving mode.',
          defaultValue: true
        },
        {
          type: 'toggle',
          messageKey: 'driveNames',
          id: 'driveNames',
          label: 'Place names in driving mode',
          description: 'Label those places with their names.',
          defaultValue: true
        },
        { type: 'heading', defaultValue: 'Display', size: 4 },
        {
          type: 'select',
          messageKey: 'textSize',
          label: 'Text size on the watch',
          defaultValue: 'auto',
          description: 'Automatic uses Large on Pebble Time 2 and Round 2.',
          options: [
            { label: 'Automatic', value: 'auto' },
            { label: 'Standard', value: '0' },
            { label: 'Large', value: '1' },
            { label: 'Extra large', value: '2' }
          ]
        },
        {
          type: 'select',
          messageKey: 'mapStyle',
          id: 'mapStyle',
          label: 'Map colors',
          defaultValue: 'light',
          description: 'For color watches.',
          options: [
            { label: 'Light (like Google Maps)', value: 'light' },
            { label: 'Dark (night)', value: 'dark' }
          ]
        }
      ]
    },
    {
      type: 'section',
      items: [
        { type: 'heading', defaultValue: 'Using Pebble Maps', size: 4 },
        {
          type: 'text',
          defaultValue:
            '<strong>Map screen:</strong> Up = move the map · Select = search by voice · ' +
            'Down (red pin) = Favorites and nearby places.<br><br>' +
            '<strong>Moving the map:</strong> on any map, the right bar shows + and − to zoom. ' +
            'Press Select (⋯) to switch to up/down, then left/right, then extra options. ' +
            'It goes back to normal after 5 seconds. On Pebble Time 2, drag the map with your finger, ' +
            'double-tap to zoom in, or press and hold to zoom out.<br><br>' +
            '<strong>Places on the map:</strong> open the map controls (Up) and press Select (⋯) until the last page. ' +
            'The bottom button switches places between dots, dots with names, and off. ' +
            'On Pebble Time 2 and Round 2, tap a place for photos, hours and reviews.<br><br>' +
            '<strong>Place info:</strong> on a place, press Down (<strong>i</strong>) for photos, hours and reviews. ' +
            'Select shows the next photo; hold Select for directions.<br><br>' +
            '<strong>Results:</strong> Up/Down moves between pins, Select opens the place. ' +
            'Hold Select for map controls and the list view.<br><br>' +
            '<strong>Place and route screens:</strong> hold Select to move the map.<br><br>' +
            '<strong>Navigating:</strong> press Select to open the options bar: move the map, alerts ' +
            '(buzz → buzz + voice on Pebble Time 2 / Round 2 → off), voice volume, ' +
            'hide the direction cards (they come back before each turn), see all steps, overview, or end. ' +
            'Tap the compass to switch between north-up and the map turning with you. ' +
            'Press Back twice to stop.'
        }
      ]
    },
    {
      type: 'section',
      items: [
        { type: 'heading', defaultValue: 'Your Google Maps key', size: 4 },
        { type: 'pmstatus' },
        {
          type: 'input',
          messageKey: 'apiKey',
          defaultValue: '',
          label: 'Google Maps key',
          description: 'Stored only on your phone and sent only to Google.',
          attributes: {
            placeholder: 'Paste here — starts with AIza',
            type: 'text',
            autocapitalize: 'off',
            autocorrect: 'off',
            autocomplete: 'off',
            spellcheck: 'false'
          }
        },
        { type: 'pmkeytest' }
      ]
    },
    {
      type: 'section',
      items: [
        { type: 'pmguide' }
      ]
    },
    {
      type: 'text',
      defaultValue: '<div class="pm-footer">Map data and directions by Google. Pebble Maps is not made by or affiliated with Google.</div>'
    },
    { type: 'submit', defaultValue: 'Save settings' }
  ];
}

// Runs inside the settings page
function customFn() {
  var clayConfig = this;
  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function () {
    var ud = (clayConfig.meta && clayConfig.meta.userData) || {};
    var style = clayConfig.getItemById('mapStyle');
    if (style && ud.color === false) style.hide();
    // "Place names" only matters when places are shown at all
    var pois = clayConfig.getItemById('drivePois'), names = clayConfig.getItemById('driveNames');
    if (pois && names) {
      var sync = function () { if (pois.get()) names.enable(); else names.disable(); };
      pois.on('change', sync);
      sync();
    }
  });
}

module.exports = { config: config, customFn: customFn };
