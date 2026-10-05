#!/usr/bin/env python3
"""Fake Google Maps Platform server for testing Pebble Maps in the emulator.

Serves the same URL shapes as Google (Places API (New), Routes API, Geocoding,
Maps Static API) under http://127.0.0.1:8765/<service>/... and renders map
PNGs styled like the app's "light" style so map/marker alignment can be
checked visually.

Use it by setting the API key to:  test:http://127.0.0.1:8765

Real maps for screenshots: pass an OpenStreetMap extract (see tools/osm_world.py):
    python3 tools/mock_google.py 8765 --osm city.osm.pbf --center 52.0929,5.1183 --city Utrecht
"""
import io
import json
import math
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw, ImageFont

ARGS = sys.argv[1:]
PORT = int(ARGS[0]) if ARGS and ARGS[0].isdigit() else 8765


def _arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS and ARGS.index(name) + 1 < len(ARGS) else default


WORLD = None
REPLAY = None
if _arg("--replay"):
    sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
    import replay_world
    REPLAY = replay_world.Replay(_arg("--replay"))
    sys.stderr.write("Replay: %d map pictures, home %s\n" % (len(REPLAY.tiles), REPLAY.home))
EXTRAS = None
if _arg("--extras"):
    # more demo data: places of several kinds, one place's details and photos, a transit trip
    EXTRAS = replay_world.Extras(_arg("--extras"), int(_arg("--best-photo", "0")))
    sys.stderr.write("Extras: %d photos\n" % len(EXTRAS.photos))
if _arg("--osm"):
    sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
    import osm_world
    _c = [float(v) for v in _arg("--center", "52.0907,5.1214").split(",")]
    WORLD = osm_world.World(_arg("--osm"), _c, float(_arg("--radius", "3")), _arg("--city", ""))
    sys.stderr.write("OSM: %d roads, %d places\n" % (len(WORLD.roads), len(WORLD.pois)))


def world_map(q):
    w, h = map(int, q["size"][0].split("x"))
    center = [float(v) for v in q["center"][0].split(",")]
    styles = " ".join(q.get("style", []))
    style = "dark" if "0x000055" in styles else ("bw" if "road.local|element:geometry.fill|color:0x000000" in styles else "light")
    paths = []
    for p in q.get("path", []):
        parts = dict(kv.split(":", 1) for kv in p.split("|") if ":" in kv and not kv.startswith("enc"))
        enc = p.split("enc:", 1)[1] if "enc:" in p else ""
        c = parts.get("color", "0x0055ffff")[2:8]
        paths.append({"pts": decode(enc), "weight": int(parts.get("weight", 5)),
                      "color": tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))})
    markers = []
    for m in q.get("markers", []):
        loc = m.split("|")[-1]
        try:
            markers.append(tuple(float(v) for v in loc.split(",")))
        except ValueError:
            pass
    src = REPLAY or WORLD
    return src.render(center, int(q["zoom"][0]), w, h, style, paths, markers)


def _center(body, key="locationBias"):
    try:
        c = body[key]["circle"]["center"]
        return (c["latitude"], c["longitude"])
    except (KeyError, TypeError):
        return tuple(WORLD.center)

PLACES = [
    ("North Branch Library", "Library", 40.0262, -99.9820),
    ("Riverside Coffee Roasters", "Coffee shop", 40.0013, -99.9977),
    ("Central Library", "Library", 39.9977, -100.0030),
    ("River Park", "Park", 40.0032, -100.0040),
    ("Main St Diner", "Restaurant", 39.9987, -99.9945),
    ("Garden Market", "Grocery store", 39.9957, -99.9990),
    ("Corner Pharmacy", "Pharmacy", 40.0022, -99.9925),
    ("Downtown Transit Center", "Bus station", 39.9994, -100.0008),
    ("Northside Fuel", "Gas station", 40.0052, -99.9960),
]


def enc_value(v):
    v = ~(v << 1) if v < 0 else (v << 1)
    out = ""
    while v >= 0x20:
        out += chr((0x20 | (v & 0x1F)) + 63)
        v >>= 5
    return out + chr(v + 63)


def encode(pts):
    out, plat, plng = "", 0, 0
    for lat, lng in pts:
        a, b = round(lat * 1e5), round(lng * 1e5)
        out += enc_value(a - plat) + enc_value(b - plng)
        plat, plng = a, b
    return out


def decode(s):
    pts, i, lat, lng = [], 0, 0, 0
    while i < len(s):
        for which in (0, 1):
            shift = result = 0
            while True:
                b = ord(s[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(result >> 1) if result & 1 else result >> 1
            if which == 0:
                lat += d
            else:
                lng += d
        pts.append((lat / 1e5, lng / 1e5))
    return pts


def project(lat, lng, z):
    scale = 256 * 2 ** z
    s = math.sin(math.radians(lat))
    return scale * (lng + 180) / 360, scale * (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi))


def place_json(p):
    name, typ, lat, lng = p
    return {
        "id": "mock-" + name.replace(" ", "-").lower(),
        "displayName": {"text": name, "languageCode": "en"},
        "formattedAddress": "%d W Main Ave, Springfield, USA" % (100 + abs(hash(name)) % 900),
        "shortFormattedAddress": "%d W Main Ave" % (100 + abs(hash(name)) % 900),
        "location": {"latitude": lat, "longitude": lng},
        "primaryTypeDisplayName": {"text": typ, "languageCode": "en"},
    }


def make_route(o, d, mode):
    """L-shaped route: north/south first, then east/west, then a short jog."""
    mid = (d[0], o[1])
    jog = (d[0], d[1] - (d[1] - o[1]) * 0.15)

    def seg(a, b, n=6):
        return [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n + 1)]

    s1, s2, s3 = seg(o, mid), seg(mid, jog), seg(jog, d, 3)

    def dist(pts):
        t = 0
        for a, b in zip(pts, pts[1:]):
            dy = (b[0] - a[0]) * 111000
            dx = (b[1] - a[1]) * 111000 * math.cos(math.radians(a[0]))
            t += math.hypot(dx, dy)
        return int(t)

    speed = {"DRIVE": 11, "WALK": 1.4, "BICYCLE": 4.5, "TRANSIT": 6}.get(mode, 8)
    north = d[0] > o[0]
    east = d[1] > o[1]
    steps = [
        {"distanceMeters": dist(s1), "staticDuration": "%ds" % (dist(s1) / speed),
         "polyline": {"encodedPolyline": encode(s1)},
         "navigationInstruction": {"maneuver": "DEPART", "instructions": "Head %s on N Oak St" % ("north" if north else "south")},
         "travelMode": mode},
        {"distanceMeters": dist(s2), "staticDuration": "%ds" % (dist(s2) / speed),
         "polyline": {"encodedPolyline": encode(s2)},
         "navigationInstruction": {"maneuver": "TURN_RIGHT" if (north == east) else "TURN_LEFT",
                                   "instructions": "Turn %s onto W River Ave" % ("right" if (north == east) else "left")},
         "travelMode": mode},
        {"distanceMeters": dist(s3), "staticDuration": "%ds" % (dist(s3) / speed),
         "polyline": {"encodedPolyline": encode(s3)},
         "navigationInstruction": {"maneuver": "TURN_SLIGHT_LEFT", "instructions": "Slight left to stay on W River Ave. Destination will be on the right"},
         "travelMode": mode},
    ]
    if mode == "TRANSIT":
        steps[1]["travelMode"] = "TRANSIT"
        steps[1]["navigationInstruction"] = {"instructions": "Bus towards Downtown"}
        steps[1]["transitDetails"] = {
            "stopDetails": {"departureStop": {"name": "Oak & Main"}, "arrivalStop": {"name": "River & 1st"}},
            "localizedValues": {"departureTime": {"time": {"text": "3:12 PM"}}, "arrivalTime": {"time": {"text": "3:20 PM"}}},
            "headsign": "Downtown", "stopCount": 4,
            "transitLine": {"nameShort": "25", "name": "Crosstown", "vehicle": {"type": "BUS", "name": {"text": "Bus"}}},
        }
    pts = s1 + s2[1:] + s3[1:]
    total = sum(s["distanceMeters"] for s in steps)
    static = int(sum(int(s["staticDuration"][:-1]) for s in steps))
    route = {
        "distanceMeters": total,
        "duration": "%ds" % int(static * (1.2 if mode == "DRIVE" else 1)),
        "staticDuration": "%ds" % static,
        "description": "N Oak St" if mode == "DRIVE" else "",
        "polyline": {"encodedPolyline": encode(pts)},
        "legs": [{"steps": steps}],
    }
    return {"routes": [route]}


def render_map(q):
    w, h = map(int, q["size"][0].split("x"))
    lat, lng = map(float, q["center"][0].split(","))
    z = int(q["zoom"][0])
    cx, cy = project(lat, lng, z)
    im = Image.new("RGB", (w, h), (255, 255, 255))
    dr = ImageDraw.Draw(im)

    def px(la, lo):
        x, y = project(la, lo, z)
        return (x - cx + w / 2, y - cy + h / 2)

    # park and river
    dr.polygon([px(40.0047, -100.0070), px(40.0047, -100.0020), px(40.0017, -100.0020), px(40.0017, -100.0070)], fill=(170, 255, 170))
    river = [px(40.0042 + 0.0012 * math.sin(i / 3), -100.0240 + i * 0.002) for i in range(40)]
    dr.line(river, fill=(85, 170, 255), width=max(3, int(2 ** (z - 13))))
    # street grid every 0.0025 deg
    step = 0.0025
    for i in range(-40, 41):
        la = round(lat / step) * step + i * step
        lo = round(lng / step) * step + i * step
        wd = 1 if z < 15 else 2
        col = (255, 170, 0) if i % 8 == 0 else (170, 170, 170)
        dr.line([px(la, lng - 1), px(la, lng + 1)], fill=col, width=wd + (1 if i % 8 == 0 else 0))
        dr.line([px(lat - 1, lo), px(lat + 1, lo)], fill=col, width=wd)
    try:
        font = ImageFont.load_default()
        dr.text((6, h - 30), "W Main Ave", fill=(85, 85, 85), font=font)
    except Exception:
        pass
    for p in q.get("path", []):
        parts = dict(kv.split(":", 1) for kv in p.split("|") if ":" in kv and not kv.startswith("enc"))
        enc = p.split("enc:", 1)[1] if "enc:" in p else ""
        pts = [px(a, b) for a, b in decode(enc)]
        if len(pts) > 1:
            dr.line(pts, fill=(0, 85, 255), width=int(parts.get("weight", 5)))
    buf = io.BytesIO()
    im.convert("P", palette=Image.ADAPTIVE, colors=32).save(buf, "PNG")
    return buf.getvalue()


def enrich(p, pid):
    """Made-up details for the place info page (rating, hours, reviews, photos)."""
    p = dict(p)
    h = sum(ord(c) for c in pid)
    p.setdefault("primaryType", "restaurant")
    p.update({
        "rating": round(3.6 + (h % 14) / 10.0, 1), "userRatingCount": 120 + h * 7 % 4000,
        "priceLevel": ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE"][h % 3],
        "businessStatus": "OPERATIONAL",
        "currentOpeningHours": {"openNow": True, "nextCloseTime": "2030-01-01T05:00:00Z",
                                "weekdayDescriptions": ["Monday: 11:00\u202fAM\u2009\u2013\u200910:00\u202fPM",
                                                        "Tuesday: 11:00\u202fAM\u2009\u2013\u200910:00\u202fPM",
                                                        "Wednesday: 11:00\u202fAM\u2009\u2013\u200910:00\u202fPM",
                                                        "Thursday: 11:00\u202fAM\u2009\u2013\u200910:00\u202fPM",
                                                        "Friday: 11:00\u202fAM\u2009\u2013\u200911:00\u202fPM",
                                                        "Saturday: 10:00\u202fAM\u2009\u2013\u200911:00\u202fPM",
                                                        "Sunday: 10:00\u202fAM\u2009\u2013\u20099:00\u202fPM"]},
        "nationalPhoneNumber": "(555) 010-%04d" % (h % 10000),
        "websiteUri": "https://www.example.com/",
        "editorialSummary": {"text": "Cozy spot with a seasonal menu, friendly staff and a lively atmosphere."},
        "reviews": [
            {"authorAttribution": {"displayName": "Sam R."}, "rating": 5, "relativePublishTimeDescription": "2 weeks ago",
             "text": {"text": "Great food and quick service. The window seats have a lovely view. Would come back."}},
            {"authorAttribution": {"displayName": "Alex P."}, "rating": 4, "relativePublishTimeDescription": "a month ago",
             "text": {"text": "Tasty and fairly priced. It gets busy around noon, so come early or expect a short wait."}},
            {"authorAttribution": {"displayName": "Jordan K."}, "rating": 4, "relativePublishTimeDescription": "3 months ago",
             "text": {"text": "Nice staff, good coffee, comfortable chairs."}},
        ],
        "photos": [{"name": "places/%s/photos/p%d" % (pid, k), "widthPx": 1200, "heightPx": 900} for k in range(4)],
    })
    return p


def fake_transit(body, schedule):
    """Made-up transit: the drive route with its second step as a bus ride (or, for the
    schedule page, three departures of that bus)."""
    import datetime
    t0 = datetime.datetime.fromisoformat(body.get("departureTime", "2030-01-01T00:00:00Z").replace("Z", "+00:00"))

    def td(k):
        dep = (t0 + datetime.timedelta(minutes=4 + 12 * k)).strftime("%Y-%m-%dT%H:%M:%SZ")
        return {"transitLine": {"nameShort": "8", "vehicle": {"type": "BUS", "name": {"text": "Bus"}},
                                "agencies": [{"name": "King County Metro"}]},
                "headsign": "Seattle Center", "stopCount": 4,
                "stopDetails": {"departureStop": {"name": "4th Ave & Pine St", "location": {"latLng": {"latitude": 47.6112, "longitude": -122.3371}}},
                                "arrivalStop": {"name": "Western Ave & Virginia", "location": {"latLng": {"latitude": 47.6105, "longitude": -122.3426}}},
                                "departureTime": dep},
                "localizedValues": {"departureTime": {"time": {"text": "10:%02d AM" % (4 + 12 * k)}}}}
    if schedule:
        return {"routes": [{"legs": [{"steps": [{"transitDetails": td(k)}]}]} for k in range(3)]}
    r = json.loads(json.dumps(REPLAY.route("DRIVE", True)))
    steps = r["routes"][0]["legs"][0]["steps"]
    steps[0]["travelMode"] = "WALK"
    if len(steps) > 1:
        steps[1]["travelMode"] = "TRANSIT"
        steps[1]["transitDetails"] = td(0)
        steps[1]["navigationInstruction"] = {"maneuver": "STRAIGHT", "instructions": "Bus towards Seattle Center"}
    return r


def fake_photo(k):
    """A simple made-up picture (sky, building, plate) as JPEG."""
    w, hgt = 480, 360
    im = Image.new("RGB", (w, hgt))
    d = ImageDraw.Draw(im)
    tones = [((90, 160, 230), (200, 120, 60)), ((240, 200, 150), (120, 70, 40)),
             ((60, 120, 70), (230, 230, 220)), ((40, 40, 60), (250, 180, 40))][k % 4]
    for y in range(hgt):
        t = y / hgt
        d.line([(0, y), (w, y)], fill=tuple(int(tones[0][i] * (1 - t) + tones[1][i] * t) for i in range(3)))
    d.ellipse((w * 0.25, hgt * 0.35, w * 0.75, hgt * 0.9), fill=(245, 245, 240), outline=(90, 90, 90), width=4)
    d.ellipse((w * 0.36, hgt * 0.47, w * 0.64, hgt * 0.78), fill=[(200, 60, 40), (90, 160, 60), (230, 180, 60), (150, 80, 160)][k % 4])
    d.rectangle((w * 0.05, hgt * 0.1, w * 0.2, hgt * 0.6), fill=(110, 80, 50))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return buf.getvalue()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        sys.stderr.write("mock: " + (a[0] % a[1:]) + "\n")

    def send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if EXTRAS and u.path == "/__clock":   # test hook: the recorded transit trip starts over from now
            EXTRAS.reset_clock()
            return self.send(200, {"ok": True})
        if u.path.endswith("/staticmap"):
            return self.send(200, world_map(q) if (WORLD or REPLAY) else render_map(q), "image/png")
        if EXTRAS and "/photos/x" in u.path and u.path.endswith("/media"):
            k = int(u.path.split("/photos/x")[1].split("/")[0])
            return self.send(200, {"photoUri": "http://%s/xphoto/%d.jpg" % (self.headers.get("Host"), k)})
        if EXTRAS and u.path.startswith("/xphoto/"):
            return self.send(200, EXTRAS.photo(int(u.path[8:].split(".")[0])), "image/jpeg")
        if "/photos/" in u.path and u.path.endswith("/media"):
            k = int(u.path.split("/photos/p")[1].split("/")[0])
            return self.send(200, {"photoUri": "http://%s/photo/%d.jpg" % (self.headers.get("Host"), k)})
        if u.path.startswith("/photo/"):
            return self.send(200, fake_photo(int(u.path[7:].split(".")[0])), "image/jpeg")
        rich = "reviews" in (self.headers.get("X-Goog-FieldMask") or "")
        if EXTRAS and "/places/" in u.path:
            pid = urllib.parse.unquote(u.path.rsplit("/", 1)[1])
            p = EXTRAS.place(pid)
            if p:
                return self.send(200, p if (pid == EXTRAS.info["id"] or not rich) else enrich(p, pid))
        if rich and "/places/" in u.path:
            pid = urllib.parse.unquote(u.path.rsplit("/", 1)[1])
            p = (REPLAY.place(pid) if REPLAY else None) or (WORLD.place_json(WORLD.by_id(pid)) if WORLD and WORLD.by_id(pid) else None)
            if not p:
                for pp in PLACES:
                    if "mock-" + pp[0].lower().replace(" ", "-") == pid:
                        p = place_json(pp)
            return self.send(200, enrich(p, pid)) if p else self.send(404, {"error": {"message": "not found"}})
        if REPLAY and "/places/" in u.path:
            p = REPLAY.place(urllib.parse.unquote(u.path.rsplit("/", 1)[1]))
            return self.send(200, p) if p else self.send(404, {"error": {"message": "not found"}})
        if REPLAY and u.path.endswith("/geocode/json"):
            h = REPLAY.home
            return self.send(200, {"status": "OK", "results": [{"formatted_address": "Seattle, WA", "place_id": "here",
                                                                 "geometry": {"location": {"lat": h[0], "lng": h[1]}}}]})
        if WORLD and "/places/" in u.path:
            p = WORLD.by_id(urllib.parse.unquote(u.path.rsplit("/", 1)[1]))
            return self.send(200, WORLD.place_json(p)) if p else self.send(404, {"error": {"message": "not found"}})
        if WORLD and u.path.endswith("/geocode/json"):
            c = WORLD.center
            return self.send(200, {"status": "OK", "results": [{"formatted_address": WORLD.city, "place_id": "osm-here",
                                                                 "geometry": {"location": {"lat": c[0], "lng": c[1]}}}]})
        if u.path.endswith("/geocode/json"):
            if "latlng" in q:
                return self.send(200, {"status": "OK", "results": [{"formatted_address": "421 W River Ave, Springfield, USA", "place_id": "mock-here"}]})
            return self.send(200, {"status": "OK", "results": [{"formatted_address": q["address"][0] + ", Springfield", "place_id": "mock-geo",
                                                                 "geometry": {"location": {"lat": 39.9924, "lng": -99.9885}}}]})
        if "/places/" in u.path:
            pid = urllib.parse.unquote(u.path.rsplit("/", 1)[1])
            for p in PLACES:
                if "mock-" + p[0].lower().replace(" ", "-") == pid:
                    return self.send(200, place_json(p))
        self.send(404, {"error": {"message": "not found"}})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        mask = self.headers.get("X-Goog-FieldMask") or ""
        if EXTRAS:
            if self.path.endswith("places:searchNearby"):
                types = body.get("includedTypes", [])
                if "places.primaryType," in mask + ",":
                    return self.send(200, EXTRAS.pois(types))    # places on the map
                return self.send(200, EXTRAS.nearest(types))      # Places list
            if self.path.endswith("places:searchText"):
                if body.get("includedType"):
                    return self.send(200, EXTRAS.pois([body["includedType"]]))   # open places on the map
                if "pink" in body.get("textQuery", "").lower():
                    return self.send(200, {"places": [EXTRAS.info]})
            if self.path.endswith("computeRoutes") and body.get("travelMode") == "TRANSIT" and "legs" in mask:
                if "polyline" in mask:
                    return self.send(200, EXTRAS.transit_route())
                return self.send(200, EXTRAS.departures(body.get("departureTime")))
        if REPLAY:
            if self.path.endswith("places:searchText"):
                return self.send(200, REPLAY.search())
            if self.path.endswith("places:searchNearby"):
                res = json.loads(json.dumps(REPLAY.nearby()))
                for pl in res.get("places", []):
                    pl.setdefault("primaryType", "restaurant")
                if "primaryType" in (self.headers.get("X-Goog-FieldMask") or ""):
                    # places-on-the-map lookups: add a few made-up neighbors so labels can be checked
                    c = {"latitude": REPLAY.home[0], "longitude": REPLAY.home[1]}
                    kinds = ["cafe", "clothing_store", "park", "museum", "hotel", "bakery", "book_store", "bar"]
                    names = ["Blue Door Cafe", "Hanger Outfitters", "Pocket Park", "City Art Museum",
                             "The Grand Hotel", "Rise Bakery", "Paper & Ink Books", "Corner Tap"]
                    for k in range(8):
                        a = k * 0.8
                        res["places"].append({"id": "fake-%d" % k, "displayName": {"text": names[k]},
                                              "location": {"latitude": c["latitude"] + 0.0012 * math.sin(a) * (1 + k % 3),
                                                           "longitude": c["longitude"] + 0.0018 * math.cos(a) * (1 + k % 3)},
                                              "primaryType": kinds[k], "formattedAddress": "Seattle, WA"})
                return self.send(200, res)
            if self.path.endswith("places:autocomplete"):
                return self.send(200, REPLAY.autocomplete())
            if self.path.endswith("computeRoutes"):
                mask = self.headers.get("X-Goog-FieldMask") or ""
                full = "legs" in mask
                mode = body.get("travelMode", "DRIVE")
                if mode == "TRANSIT" and full:
                    return self.send(200, fake_transit(body, "transitDetails" in mask and "polyline" not in mask))
                return self.send(200, REPLAY.route(mode, full))
        if WORLD and self.path.endswith("places:searchText"):
            res = WORLD.search_text(body.get("textQuery", ""), _center(body))
            return self.send(200, {"places": [WORLD.place_json(p) for p in res]})
        if WORLD and self.path.endswith("places:searchNearby"):
            c = body["locationRestriction"]["circle"]
            res = WORLD.search_nearby(body.get("includedTypes", []), (c["center"]["latitude"], c["center"]["longitude"]), c["radius"])
            return self.send(200, {"places": [WORLD.place_json(p) for p in res]})
        if WORLD and self.path.endswith("places:autocomplete"):
            o = _center(body, "origin") if "origin" in body else tuple(WORLD.center)
            if "origin" in body:
                o = (body["origin"]["latitude"], body["origin"]["longitude"])
            out = []
            for p in WORLD.autocomplete(body.get("input", ""), o):
                pj = WORLD.place_json(p)
                out.append({"placePrediction": {"placeId": p["id"], "structuredFormat": {
                    "mainText": {"text": p["name"]}, "secondaryText": {"text": pj["formattedAddress"]}},
                    "distanceMeters": int(osm_world.haversine(o, (p["lat"], p["lng"])))}})
            return self.send(200, {"suggestions": out})
        if WORLD and self.path.endswith("computeRoutes"):
            o = body["origin"]["location"]["latLng"]
            dd = body["destination"].get("location", {}).get("latLng")
            if not dd:
                p = WORLD.by_id(body["destination"].get("placeId", ""))
                dd = {"latitude": p["lat"], "longitude": p["lng"]} if p else {"latitude": WORLD.center[0], "longitude": WORLD.center[1]}
            r = WORLD.route((o["latitude"], o["longitude"]), (dd["latitude"], dd["longitude"]), body.get("travelMode", "DRIVE"))
            return self.send(200, r or {})
        if self.path.endswith("places:searchText"):
            text = body.get("textQuery", "").lower()
            res = [p for p in PLACES if any(w in p[0].lower() or w in p[1].lower() for w in text.split())] or PLACES[:5]
            return self.send(200, {"places": [place_json(p) for p in res]})
        if self.path.endswith("text:synthesize"):
            import base64, struct, wave
            text = body.get("input", {}).get("text", "")
            sys.stderr.write("TTS: " + text + "\n")
            n = int(8000 * min(3.0, 0.3 + 0.06 * len(text)))
            buf = io.BytesIO()
            w = wave.open(buf, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
            w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / 8000))) for i in range(n)))
            w.close()
            return self.send(200, {"audioContent": base64.b64encode(buf.getvalue()).decode()})
        if self.path.endswith("places:autocomplete"):
            text = body.get("input", "").lower()
            res = [p for p in PLACES if p[0].lower().startswith(text) or any(w.startswith(text) for w in p[0].lower().split())]
            return self.send(200, {"suggestions": [{"placePrediction": {
                "placeId": "mock-" + p[0].lower().replace(" ", "-"),
                "structuredFormat": {"mainText": {"text": p[0]}, "secondaryText": {"text": "W Main Ave, Springfield"}},
                "distanceMeters": 400 + 300 * i}} for i, p in enumerate(res[:5])]})
        if self.path.endswith("places:searchNearby"):
            return self.send(200, {"places": [place_json(p) for p in PLACES[:6]]})
        if self.path.endswith("computeRoutes"):
            o = body["origin"]["location"]["latLng"]
            dd = body["destination"].get("location", {}).get("latLng", {"latitude": 39.9924, "longitude": -99.9885})
            if body.get("travelMode") == "BICYCLE" and "summary-nobike" in self.path:
                return self.send(200, {})
            return self.send(200, make_route((o["latitude"], o["longitude"]), (dd["latitude"], dd["longitude"]), body.get("travelMode", "DRIVE")))
        self.send(404, {"error": {"message": "not found"}})


if __name__ == "__main__":
    print("Mock Google on http://127.0.0.1:%d" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
