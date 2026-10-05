"""Replay backend for tools/mock_google.py: serves data collected with the
demo capture page (tools/build_capture.js) so emulator screenshots show real
Google maps and places.

    python3 tools/mock_google.py 8765 --replay pebblemaps-demo-data.zip

Use with a test build whose src/pkjs/dev.js sets snapTiles: 192 (the grid the
capture used) and simLocation to the capture's home.
"""
import io
import json
import math
import zipfile

import numpy as np
from PIL import Image, ImageDraw

LIGHT = np.array([[255, 255, 255], [170, 170, 170], [255, 170, 0], [170, 255, 170], [85, 170, 255],
                  [85, 85, 85], [0, 85, 0], [0, 85, 170]], dtype=np.int32)
BW = np.array([[255, 255, 255], [0, 0, 0], [0, 0, 0], [216, 216, 216], [144, 144, 144],
               [0, 0, 0], [0, 0, 0], [0, 0, 0]], dtype=np.uint8)


def project(lat, lng, z):
    s = 256 * (2 ** z)
    sy = math.sin(math.radians(lat))
    return (lng + 180) / 360 * s, (0.5 - math.log((1 + sy) / (1 - sy)) / (4 * math.pi)) * s


class Replay:
    def __init__(self, path):
        zf = zipfile.ZipFile(path)
        self.meta = json.loads(zf.read("meta.json"))
        self.home = self.meta["home"]
        self.snap = self.meta["snap"]
        self.json = {n: json.loads(zf.read(n)) for n in zf.namelist() if n.endswith(".json")}
        self.tiles = {}
        for n in zf.namelist():
            if n.startswith("tiles/") and n.endswith(".png"):
                z, gx, gy = (int(v) for v in n[6:-4].split("_"))
                self.tiles[(z, gx, gy)] = Image.open(io.BytesIO(zf.read(n))).convert("RGB")
        self.zooms = sorted({k[0] for k in self.tiles})

    # --- places / routes -----------------------------------------------------------
    def nearby(self):
        return self.json.get("places_nearby_restaurant.json", {"places": []})

    def search(self):
        # keep the results near home (what a "near me" voice search shows)
        j = self.json.get("places_search_starbucks.json", {"places": []})
        h = self.home
        near = [p for p in j.get("places", []) if abs(p["location"]["latitude"] - h[0]) < 0.012
                and abs(p["location"]["longitude"] - h[1]) < 0.016]
        return {"places": near or j.get("places", [])}

    def autocomplete(self):
        # well-known names first (as Google tends to rank them for people nearby)
        j = self.json.get("places_autocomplete_sta.json", {"suggestions": []})
        sug = j.get("suggestions", [])
        key = lambda s: 0 if "starbucks" in json.dumps(s).lower() else 1
        return {"suggestions": sorted(sug, key=key)}

    def place(self, pid):
        for src in (self.nearby(), self.search()):
            for p in src.get("places", []):
                if p.get("id") == pid:
                    return p
        return None

    def route(self, mode, full):
        if full and mode == "DRIVE":
            return self.json.get("route_DRIVE_full.json", {})
        return self.json.get("route_%s_summary.json" % mode, {})

    # --- map pictures ----------------------------------------------------------------
    def _compose(self, z, cx, cy, w, h):
        """Paste recorded pictures of zoom z under a w x h view centered at world (cx, cy)."""
        out = Image.new("RGB", (w, h), (255, 255, 255))
        s = self.snap
        cands = []
        for (tz, gx, gy), im in self.tiles.items():
            if tz != z:
                continue
            tx, ty = gx * s, gy * s
            if abs(tx - cx) < w / 2 + 320 and abs(ty - cy) < h / 2 + 320:
                cands.append((math.hypot(tx - cx, ty - cy), tx, ty, im))
        if not cands:
            return None
        crop = 34   # keep Google's logo and copyright lines out of the middle of the picture
        for _, tx, ty, im in sorted(cands, key=lambda c: -c[0]):
            part = im.crop((crop, crop, 640 - crop, 640 - crop))
            out.paste(part, (int(round(tx - 320 + crop - (cx - w / 2))), int(round(ty - 320 + crop - (cy - h / 2)))))
        # the picture nearest the middle goes on top, whole
        _, tx, ty, im = min(cands, key=lambda c: c[0])
        out.paste(im, (int(round(tx - 320 - (cx - w / 2))), int(round(ty - 320 - (cy - h / 2)))))
        return out

    def render(self, center, z, w, h, style, paths, markers):
        cx, cy = project(center[0], center[1], z)
        img = None
        s = self.snap
        key = (z, round(cx / s), round(cy / s))
        if w == 640 and h == 640 and key in self.tiles and abs(key[1] * s - cx) < 1.5 and abs(key[2] * s - cy) < 1.5:
            img = self.tiles[key].copy()
        if img is None:
            img = self._compose(z, cx, cy, w, h)
        if img is None:
            # borrow a neighbouring zoom, scaled
            for dz in (1, -1, 2, -2):
                z2 = z - dz
                if z2 in self.zooms:
                    f = 2 ** (z2 - z)
                    big = self._compose(z2, cx * f, cy * f, max(1, int(w * f)), max(1, int(h * f)))
                    if big:
                        img = big.resize((w, h), Image.BICUBIC)
                        break
        if img is None:
            img = Image.new("RGB", (w, h), (255, 255, 255))
        dr = ImageDraw.Draw(img)

        def px(lat, lng):
            x, y = project(lat, lng, z)
            return (x - cx + w / 2, y - cy + h / 2)

        for p in paths:
            pts = [px(a, b) for a, b in p["pts"]]
            if len(pts) > 1:
                dr.line(pts, fill=p["color"], width=p["weight"], joint="curve")
        for m in markers:
            x, y = px(*m)
            r = 6
            dr.ellipse((x - r, y - 2.6 * r, x + r, y - 0.6 * r), fill=(234, 67, 53))
            dr.polygon([(x - 0.8 * r, y - 1.3 * r), (x + 0.8 * r, y - 1.3 * r), (x, y)], fill=(234, 67, 53))
            dr.ellipse((x - 2, y - 13, x + 2, y - 9), fill=(165, 14, 14))
        if style == "bw":
            a = np.asarray(img, dtype=np.int32)
            d = ((a[:, :, None, :] - LIGHT[None, None, :, :]) ** 2).sum(-1)
            img = Image.fromarray(BW[d.argmin(-1)])
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()


# --- extra demo data (tools/demo_extras.js): places of several kinds, one place's full
# details and photos, a transit trip and its departures ------------------------------------
import datetime
import os
import re

ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")
TZ_NAME = "America/Los_Angeles"


def _local(dt):
    try:
        from zoneinfo import ZoneInfo
        return dt.astimezone(ZoneInfo(TZ_NAME))
    except Exception:
        return dt


def _parse(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))


def _iso(dt):
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _dist(a, b):
    dy = (a[0] - b[0]) * 111320
    dx = (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


class Extras:
    KIND_OF = {"restaurant": "restaurant", "cafe": "cafe", "coffee_shop": "cafe", "bar": "bar", "pub": "bar",
               "wine_bar": "bar"}

    def __init__(self, path, best_photo=0):
        if os.path.isdir(path):
            names = []
            for root, _, files in os.walk(path):
                names += [os.path.relpath(os.path.join(root, f), path) for f in files]
            read = lambda n: open(os.path.join(path, n), "rb").read()
        else:
            zf = zipfile.ZipFile(path)
            names = zf.namelist()
            read = zf.read
        self.json = {n: json.loads(read(n)) for n in names if n.endswith(".json")}
        self.photos = {int(n[7:-4]): read(n) for n in names if n.startswith("photos/") and n.endswith(".jpg")}
        self.meta = self.json["extras_meta.json"]
        self.home = self.meta["home"]
        self.captured = _parse(self.meta["capturedAt"][:19] + "Z")
        self.info = self.json["info.json"]
        # show the nicest photo first
        order = sorted(self.photos)
        if best_photo in order:
            order.remove(best_photo)
            order.insert(0, best_photo)
        self.photo_order = order
        self.reset_clock()

    def reset_clock(self):
        """The recorded trip leaves a few minutes from now (fixed until the next reset)."""
        self.delta = datetime.datetime.now(datetime.timezone.utc) - self.captured

    # times: the recorded trip happens "now"
    def shift(self, obj):
        d = self.delta

        def walk(o):
            if isinstance(o, dict):
                out = {k: walk(v) for k, v in o.items()}
                lv = out.get("localizedValues")
                sd = out.get("stopDetails")
                if lv and sd:
                    for k, src in (("departureTime", "departureTime"), ("arrivalTime", "arrivalTime")):
                        if k in lv and src in sd:
                            t = _local(_parse(sd[src]))
                            lv[k]["time"]["text"] = t.strftime("%I:%M\u202f%p").lstrip("0")
                return out
            if isinstance(o, list):
                return [walk(v) for v in o]
            if isinstance(o, str) and ISO.match(o):
                return _iso(_parse(o) + d)
            return o
        return walk(obj)

    def kind(self, types):
        for t in types or []:
            if t in self.KIND_OF:
                return self.KIND_OF[t]
        return "tourist_attraction"

    def pois(self, types):
        return json.loads(json.dumps(self.json.get("pois_%s.json" % self.kind(types), {"places": []})))

    def nearest(self, types, n=10):
        """Places list: the nearest places that really are of that kind."""
        k = self.kind(types)
        want = {"restaurant": r"restaurant|steak_house|diner", "cafe": r"cafe|coffee",
                "bar": r"bar$|^bar|pub|brew", "tourist_attraction": r"."}[k]
        ps = [p for p in self.pois(types)["places"] if re.search(want, p.get("primaryType", ""))]
        seen, out = set(), []
        for p in sorted(ps, key=lambda p: _dist(self.home, (p["location"]["latitude"], p["location"]["longitude"]))):
            if p["id"] not in seen:
                seen.add(p["id"])
                out.append(p)
        return {"places": out[:n]}

    def place(self, pid):
        if pid == self.info["id"]:
            return self.details()
        for n, j in self.json.items():
            if n.startswith("pois_"):
                for p in j.get("places", []):
                    if p.get("id") == pid:
                        return p
        return None

    def details(self):
        """The info page place, shown open (it was captured on its day off)."""
        p = json.loads(json.dumps(self.info))
        now = datetime.datetime.now(datetime.timezone.utc)
        loc = _local(now)
        close = loc.replace(hour=23, minute=30, second=0, microsecond=0)
        if close < loc:
            close += datetime.timedelta(days=1)
        for key in ("currentOpeningHours", "regularOpeningHours"):
            h = p.get(key)
            if not h:
                continue
            h["openNow"] = True
            h.pop("nextOpenTime", None)
            h["nextCloseTime"] = _iso(close)
            h["weekdayDescriptions"] = [w.replace("Closed", "11:30\u202fAM\u2009\u2013\u200911:30\u202fPM")
                                        for w in h.get("weekdayDescriptions", [])]
        p["photos"] = [dict(self.info["photos"][i], name="places/%s/photos/x%d" % (p["id"], k))
                       for k, i in enumerate(self.photo_order) if i < len(self.info["photos"])]
        return p

    def photo(self, k):
        b = self.photos[self.photo_order[k]]
        if b[:2] != b"\xff\xd8":   # Google sometimes hands out PNGs; the replay sends JPEGs
            out = io.BytesIO()
            Image.open(io.BytesIO(b)).convert("RGB").save(out, "JPEG", quality=90)
            b = out.getvalue()
        return b

    def transit_route(self):
        return self.shift(self.json["route_TRANSIT_full.json"])

    def departures(self, when):
        """The recorded departure lookup that starts at the asked time."""
        t = _parse(when)
        rounds = sorted(n for n in self.json if n.startswith("transit_deps_"))
        best = None
        for n in rounds:
            j = self.shift(self.json[n])
            times = [s["transitDetails"]["stopDetails"]["departureTime"] for r in j.get("routes", [])
                     for l in r.get("legs", []) for s in l.get("steps", []) if s.get("transitDetails")]
            if times and _parse(min(times)) >= t - datetime.timedelta(seconds=90):
                return j
            best = j
        return {"routes": []} if best is None else {"routes": []}
