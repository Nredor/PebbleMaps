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
| Map (home) | Map controls | Search by voice | Places & favorites |
| Results | Previous pin | Open place (hold: list) | Next pin |
| Place | Save ☆ | Pick travel mode | Info (photos, hours, reviews) |
| Info | Scroll | Next photo (hold: directions) | Scroll |
| Route | Steps | Start | Switch mode |
| Navigating | Steps | Menu | Alerts |

Your location is live on the map (an arrow while you move); turn off Live location in
Settings to save battery. On the last page of the map controls, the top button switches between driving mode
(the map turns with you), north up and a plain map; the bottom button picks which places
show on the map (and their names). Hold Up/Down on the home map to zoom. Press Back twice to stop
navigating. On Pebble Time 2 and Round 2 you can also tap pins, places on the map and buttons.
Pebble Time and Time Round show place info as text (no photos) and places as dots only, to save memory.

## Google services used

Maps Static API (map pictures), Places API (New) (search, places on the map, info and photos),
Routes API (directions), Geocoding API (addresses), Cloud Text-to-Speech (spoken directions). Your key is stored only on your phone and sent only to Google.

## Development

`pebble build` builds the PBW. `tools/mock_google.py` is a fake Google server for testing
in the emulator without a key (see `src/pkjs/dev.js`).

Pebble Maps is not made by or affiliated with Google.
