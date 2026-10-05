#!/usr/bin/env python3
"""Fake Google Maps Platform server for testing Pebble Maps in the emulator.

Serves the same URL shapes as Google (Places API (New), Routes API, Geocoding,
Maps Static API) under http://127.0.0.1:8765/<service>/... and renders map
PNGs styled like the app's "light" style so map/marker alignment can be
checked visually.

Use it by setting the API key to:  test:http://127.0.0.1:8765
"""
import io
import json
import math
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw, ImageFont

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

PLACES = [
    ("Northtown Library", "Library", 47.6850, -117.4080),
    ("Riverside Coffee Roasters", "Coffee shop", 47.6601, -117.4237),
    ("Lilac City Library", "Library", 47.6565, -117.4290),
    ("Falls Park", "Park", 47.6620, -117.4300),
    ("Monroe St Diner", "Restaurant", 47.6575, -117.4205),
    ("Garden Market", "Grocery store", 47.6545, -117.4250),
    ("Corner Pharmacy", "Pharmacy", 47.6610, -117.4185),
    ("Downtown Transit Center", "Bus station", 47.6582, -117.4268),
    ("Northside Fuel", "Gas station", 47.6640, -117.4220),
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
        "formattedAddress": "%d W Main Ave, Spokane, WA 99201, USA" % (100 + abs(hash(name)) % 900),
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
         "navigationInstruction": {"maneuver": "DEPART", "instructions": "Head %s on N Monroe St" % ("north" if north else "south")},
         "travelMode": mode},
        {"distanceMeters": dist(s2), "staticDuration": "%ds" % (dist(s2) / speed),
         "polyline": {"encodedPolyline": encode(s2)},
         "navigationInstruction": {"maneuver": "TURN_RIGHT" if (north == east) else "TURN_LEFT",
                                   "instructions": "Turn %s onto W Riverside Ave" % ("right" if (north == east) else "left")},
         "travelMode": mode},
        {"distanceMeters": dist(s3), "staticDuration": "%ds" % (dist(s3) / speed),
         "polyline": {"encodedPolyline": encode(s3)},
         "navigationInstruction": {"maneuver": "TURN_SLIGHT_LEFT", "instructions": "Slight left to stay on W Riverside Ave. Destination will be on the right"},
         "travelMode": mode},
    ]
    if mode == "TRANSIT":
        steps[1]["travelMode"] = "TRANSIT"
        steps[1]["navigationInstruction"] = {"instructions": "Bus towards Downtown"}
        steps[1]["transitDetails"] = {
            "stopDetails": {"departureStop": {"name": "Monroe & Main"}, "arrivalStop": {"name": "Riverside & Post"}},
            "localizedValues": {"departureTime": {"time": {"text": "3:12 PM"}}, "arrivalTime": {"time": {"text": "3:20 PM"}}},
            "headsign": "Downtown", "stopCount": 4,
            "transitLine": {"nameShort": "25", "name": "Division", "vehicle": {"type": "BUS", "name": {"text": "Bus"}}},
        }
    pts = s1 + s2[1:] + s3[1:]
    total = sum(s["distanceMeters"] for s in steps)
    static = int(sum(int(s["staticDuration"][:-1]) for s in steps))
    route = {
        "distanceMeters": total,
        "duration": "%ds" % int(static * (1.2 if mode == "DRIVE" else 1)),
        "staticDuration": "%ds" % static,
        "description": "N Monroe St" if mode == "DRIVE" else "",
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
    dr.polygon([px(47.6635, -117.4330), px(47.6635, -117.4280), px(47.6605, -117.4280), px(47.6605, -117.4330)], fill=(170, 255, 170))
    river = [px(47.6630 + 0.0012 * math.sin(i / 3), -117.45 + i * 0.002) for i in range(40)]
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
        if u.path.endswith("/staticmap"):
            return self.send(200, render_map(q), "image/png")
        if u.path.endswith("/geocode/json"):
            if "latlng" in q:
                return self.send(200, {"status": "OK", "results": [{"formatted_address": "421 W Riverside Ave, Spokane, WA 99201, USA", "place_id": "mock-here"}]})
            return self.send(200, {"status": "OK", "results": [{"formatted_address": q["address"][0] + ", Spokane, WA", "place_id": "mock-geo",
                                                                 "geometry": {"location": {"lat": 47.6512, "lng": -117.4145}}}]})
        if "/places/" in u.path:
            pid = urllib.parse.unquote(u.path.rsplit("/", 1)[1])
            for p in PLACES:
                if "mock-" + p[0].lower().replace(" ", "-") == pid:
                    return self.send(200, place_json(p))
        self.send(404, {"error": {"message": "not found"}})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
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
                "structuredFormat": {"mainText": {"text": p[0]}, "secondaryText": {"text": "W Main Ave, Spokane, WA"}},
                "distanceMeters": 400 + 300 * i}} for i, p in enumerate(res[:5])]})
        if self.path.endswith("places:searchNearby"):
            return self.send(200, {"places": [place_json(p) for p in PLACES[:6]]})
        if self.path.endswith("computeRoutes"):
            o = body["origin"]["location"]["latLng"]
            dd = body["destination"].get("location", {}).get("latLng", {"latitude": 47.6512, "longitude": -117.4145})
            if body.get("travelMode") == "BICYCLE" and "summary-nobike" in self.path:
                return self.send(200, {})
            return self.send(200, make_route((o["latitude"], o["longitude"]), (dd["latitude"], dd["longitude"]), body.get("travelMode", "DRIVE")))
        self.send(404, {"error": {"message": "not found"}})


if __name__ == "__main__":
    print("Mock Google on http://127.0.0.1:%d" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
