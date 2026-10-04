# Pebble Maps

Google Maps on your Pebble: voice search, nearby places, favorites, and turn-by-turn
directions for driving, walking, biking and transit. It uses **your own Google Maps
API key**, so it stays free (Google's monthly free allowance covers normal personal use).

Works on Pebble Time / Time Steel, Time Round, Pebble 2, Pebble 2 Duo, Pebble Time 2
and Pebble Round 2.

## Install

1. Download `pebblemaps.pbw` (from the Actions tab → latest "Build PBW" run → artifact).
2. Open it with the Pebble app on your phone.
3. In the Pebble app, open Pebble Maps → **Settings** and follow the step-by-step guide
   to get your Google Maps key (about 10 minutes, once).

## Using it

| Screen | Up | Select | Down |
|---|---|---|---|
| Map (home) | Favorites | Search by voice | Explore nearby |
| Results | Previous pin | Open place (hold: list) | Next pin |
| Place | Save ☆ | Pick travel mode | Go with usual mode |
| Route | Steps | Start | Switch mode |
| Navigating | Steps | Menu | Mute buzzing |

Hold Up/Down on the home map to zoom. Press Back twice to stop navigating.
On Pebble Time 2 you can also tap pins and buttons.

## Google services used

Maps Static API (map pictures), Places API (New) (search), Routes API (directions),
Geocoding API (addresses). Your key is stored only on your phone and sent only to Google.

## Development

`pebble build` builds the PBW. `tools/mock_google.py` is a fake Google server for testing
in the emulator without a key (see `src/pkjs/dev.js`).

Pebble Maps is not made by or affiliated with Google.
