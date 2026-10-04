// Pebble Maps - settings page layout (Clay)

function config() {
  return [
    { type: 'pmtheme' },
    { type: 'pmhero' },
    {
      type: 'section',
      items: [
        { type: 'heading', defaultValue: 'Get your free Google Maps key', size: 4 },
        { type: 'pmguide' }
      ]
    },
    {
      type: 'section',
      items: [
        { type: 'heading', defaultValue: 'Your Google Maps key', size: 4 },
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
        { type: 'heading', defaultValue: '★ Favorites', size: 4 },
        {
          type: 'text',
          defaultValue: 'Places you go often. Each one can have its own way of getting there. ' +
            'On the watch, press <strong>Up</strong> on the map to open Favorites.'
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
            '<strong>Map screen:</strong> Up = Favorites · Select = search by voice · Down = Explore nearby. ' +
            'Hold Up/Down to zoom.<br><br>' +
            '<strong>Results:</strong> Up/Down moves between pins, Select opens the place. Hold Select for a list.<br><br>' +
            '<strong>Place:</strong> Up = ☆ save · Select = choose how to get there · Down = go now with the usual way.<br><br>' +
            '<strong>Navigating:</strong> Up = all steps · Down = mute buzzing · Select = menu. Press Back twice to stop.'
        }
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
  });
}

module.exports = { config: config, customFn: customFn };
