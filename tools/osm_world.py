"""Real-map backend for tools/mock_google.py, built from an OpenStreetMap extract.

Renders map pictures in the app's Google styles from real streets, water and
parks, answers place searches with real places, and plans real routes on the
street network - so emulator screenshots look like the real thing without a
Google key.

    pip install osmium pillow
    python3 tools/mock_google.py 8765 --osm city.osm.pbf

(City extracts: for example the test files in the Valhalla / OSRM projects on
GitHub, or any .osm.pbf export.)
"""
import heapq
import io
import math
import os

import osmium
from PIL import Image, ImageDraw, ImageFont

ROAD_CLASSES = {
    "motorway": 9, "motorway_link": 5, "trunk": 8, "trunk_link": 5, "primary": 7, "primary_link": 5,
    "secondary": 6.5, "secondary_link": 4.5, "tertiary": 6, "tertiary_link": 4, "unclassified": 4.5,
    "residential": 4.5, "living_street": 4, "service": 2.5, "pedestrian": 4, "road": 4,
    "footway": 1.4, "path": 1.4, "cycleway": 1.6, "steps": 1.2, "track": 1.6,
}
HIGHWAY = {"motorway", "motorway_link", "trunk", "trunk_link"}
CAR = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary",
       "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service", "road"}
SPEED = {"motorway": 28, "trunk": 22, "primary": 14, "secondary": 12, "tertiary": 11, "unclassified": 9,
         "residential": 8, "living_street": 5, "service": 5}
LABEL_MIN_ZOOM = {"motorway": 12, "trunk": 13, "primary": 13, "secondary": 14, "tertiary": 14,
                  "unclassified": 15, "residential": 15, "living_street": 16, "pedestrian": 16, "road": 15}

STYLES = {
    "light": {"bg": (255, 255, 255), "park": (170, 255, 170), "water": (85, 170, 255), "road": (170, 170, 170),
              "hwy": (255, 170, 0), "minor": (205, 205, 205), "text": (85, 85, 85), "halo": (255, 255, 255),
              "wtext": (0, 85, 170)},
    "dark": {"bg": (0, 0, 85), "park": (0, 85, 0), "water": (0, 0, 170), "road": (85, 85, 85),
             "hwy": (170, 85, 0), "minor": (40, 40, 110), "text": (170, 170, 170), "halo": (0, 0, 85),
             "wtext": (85, 170, 255)},
    "bw": {"bg": (255, 255, 255), "park": (216, 216, 216), "water": (144, 144, 144), "road": (0, 0, 0),
           "hwy": (0, 0, 0), "minor": (150, 150, 150), "text": (0, 0, 0), "halo": (255, 255, 255),
           "wtext": (0, 0, 0)},
}

FONT_PATHS = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/freefont/FreeSans.ttf"]


def project(lat, lng, z):
    s = 256 * (2 ** z)
    x = (lng + 180) / 360 * s
    sy = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + sy) / (1 - sy)) / (4 * math.pi)) * s
    return x, y


def haversine(a, b):
    R = 6371008.8
    dlat = math.radians(b[0] - a[0])
    dlng = math.radians(b[1] - a[1])
    s = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlng / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(s), math.sqrt(1 - s))


def bearing(a, b):
    y = math.sin(math.radians(b[1] - a[1])) * math.cos(math.radians(b[0]))
    x = math.cos(math.radians(a[0])) * math.sin(math.radians(b[0])) - \
        math.sin(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.cos(math.radians(b[1] - a[1]))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


POI_KIND = {
    ("amenity", "restaurant"): "Restaurant", ("amenity", "cafe"): "Café", ("amenity", "fast_food"): "Fast food",
    ("amenity", "bar"): "Bar", ("amenity", "pub"): "Pub", ("amenity", "fuel"): "Gas station",
    ("shop", "supermarket"): "Supermarket", ("shop", "convenience"): "Convenience store",
    ("amenity", "pharmacy"): "Pharmacy", ("amenity", "atm"): "ATM", ("amenity", "bank"): "Bank",
    ("tourism", "hotel"): "Hotel", ("tourism", "hostel"): "Hostel", ("amenity", "parking"): "Parking",
    ("amenity", "library"): "Library", ("amenity", "charging_station"): "EV charging station",
    ("leisure", "park"): "Park", ("railway", "station"): "Train station", ("amenity", "bus_station"): "Bus station",
    ("tourism", "museum"): "Museum", ("amenity", "cinema"): "Cinema", ("amenity", "theatre"): "Theater",
}
GOOGLE_TYPES = {
    "restaurant": {"Restaurant"}, "cafe": {"Café"}, "coffee_shop": {"Café"}, "gas_station": {"Gas station"},
    "grocery_store": {"Supermarket"}, "supermarket": {"Supermarket"}, "park": {"Park"},
    "lodging": {"Hotel", "Hostel"}, "atm": {"ATM", "Bank"}, "pharmacy": {"Pharmacy"}, "drugstore": {"Pharmacy"},
    "transit_station": {"Train station", "Bus station"}, "bus_station": {"Bus station"},
    "train_station": {"Train station"}, "subway_station": {"Train station"}, "light_rail_station": {"Train station"},
    "electric_vehicle_charging_station": {"EV charging station"}, "parking": {"Parking"}, "library": {"Library"},
}


class _Loader(osmium.SimpleHandler):
    def __init__(self, bbox):
        super().__init__()
        self.bbox = bbox
        self.roads, self.water_lines, self.areas, self.pois = [], [], [], []

    def inside(self, coords):
        s, w, n, e = self.bbox
        return any(s <= la <= n and w <= lo <= e for la, lo in coords)

    def way(self, wy):
        t = wy.tags
        try:
            coords = [(nd.location.lat, nd.location.lon) for nd in wy.nodes]
            ids = [nd.ref for nd in wy.nodes]
        except osmium.InvalidLocationError:
            return
        if len(coords) < 2 or not self.inside(coords):
            return
        hw = t.get("highway")
        if hw in ROAD_CLASSES:
            name = t.get("name", "")
            oneway = t.get("oneway") in ("yes", "1", "true") or t.get("junction") == "roundabout" or hw in ("motorway",)
            self.roads.append({"cls": hw, "name": name, "ref": t.get("ref", ""), "coords": coords, "ids": ids,
                               "oneway": oneway, "roundabout": t.get("junction") == "roundabout"})
        ww = t.get("waterway")
        if ww in ("canal", "river", "stream"):
            self.water_lines.append({"kind": ww, "name": t.get("name", ""), "coords": coords})

    def area(self, a):
        t = a.tags
        kind = None
        if t.get("natural") == "water" or t.get("waterway") == "riverbank" or t.get("landuse") in ("reservoir", "basin"):
            kind = "water"
        elif t.get("leisure") in ("park", "garden") or t.get("landuse") in ("grass", "forest", "recreation_ground", "meadow") \
                or t.get("natural") == "wood":
            kind = "park"
        if not kind:
            return
        try:
            for outer in a.outer_rings():
                coords = [(nd.lat, nd.lon) for nd in outer]
                if len(coords) > 2 and self.inside(coords):
                    self.areas.append({"kind": kind, "coords": coords, "name": t.get("name", "")})
        except Exception:
            pass

    def node(self, n):
        t = n.tags
        if "name" not in t:
            return
        kind = None
        for (k, v), label in POI_KIND.items():
            if t.get(k) == v:
                kind = label
                break
        if not kind:
            return
        la, lo = n.location.lat, n.location.lon
        s, w, nn, e = self.bbox
        if not (s <= la <= nn and w <= lo <= e):
            return
        self.pois.append({"id": "osm-n%d" % n.id, "name": t.get("name"), "kind": kind, "lat": la, "lng": lo,
                          "street": t.get("addr:street", ""), "num": t.get("addr:housenumber", ""),
                          "city": t.get("addr:city", "")})


class World:
    def __init__(self, path, center, radius_km=3.0, city=""):
        self.center = center
        dlat = radius_km / 111.0
        dlng = radius_km / (111.0 * math.cos(math.radians(center[0])))
        self.bbox = (center[0] - dlat, center[1] - dlng, center[0] + dlat, center[1] + dlng)
        ld = _Loader(self.bbox)
        ld.apply_file(path, locations=True)
        self.roads, self.water_lines, self.areas, self.pois = ld.roads, ld.water_lines, ld.areas, ld.pois
        self.city = city
        for f in self.roads + self.water_lines + self.areas:
            la = [c[0] for c in f["coords"]]
            lo = [c[1] for c in f["coords"]]
            f["bb"] = (min(la), min(lo), max(la), max(lo))
        self._fill_addresses()
        self._build_graph()
        self.font = None
        for p in FONT_PATHS:
            if os.path.exists(p):
                self.font_path = p
                break

    # --- places ------------------------------------------------------------------
    def _fill_addresses(self):
        # places without an address get the nearest named street
        named = [r for r in self.roads if r["name"] and r["cls"] in CAR]
        for p in self.pois:
            if p["street"]:
                continue
            best, bd = "", 1e9
            for r in named:
                bb = r["bb"]
                if not (bb[0] - 0.002 <= p["lat"] <= bb[2] + 0.002 and bb[1] - 0.003 <= p["lng"] <= bb[3] + 0.003):
                    continue
                for c in r["coords"][::2]:
                    d = abs(c[0] - p["lat"]) + abs(c[1] - p["lng"])
                    if d < bd:
                        bd, best = d, r["name"]
            p["street"] = best

    def place_json(self, p):
        short = (p["street"] + (" " + p["num"] if p["num"] else "")).strip()
        full = ", ".join(x for x in [short, p["city"] or self.city] if x)
        return {
            "id": p["id"],
            "displayName": {"text": p["name"], "languageCode": "en"},
            "formattedAddress": full,
            "shortFormattedAddress": short or full,
            "location": {"latitude": p["lat"], "longitude": p["lng"]},
            "primaryTypeDisplayName": {"text": p["kind"], "languageCode": "en"},
        }

    def by_id(self, pid):
        for p in self.pois:
            if p["id"] == pid:
                return p
        return None

    def _near(self, items, center):
        return sorted(items, key=lambda p: haversine(center, (p["lat"], p["lng"])))

    def search_text(self, text, center):
        words = [w for w in text.lower().split() if w]
        kinds = {"coffee": "Café", "cafe": "Café", "restaurant": "Restaurant", "pharmacy": "Pharmacy",
                 "hotel": "Hotel", "library": "Library", "park": "Park", "gas": "Gas station"}
        hits = [p for p in self.pois if all(w in p["name"].lower() for w in words)]
        if not hits:
            k = [kinds[w] for w in words if w in kinds]
            hits = [p for p in self.pois if p["kind"] in k]
        return self._near(hits, center or self.center)[:10]

    def search_nearby(self, types, center, radius):
        want = set()
        for t in types:
            want |= GOOGLE_TYPES.get(t, set())
        hits = [p for p in self.pois if p["kind"] in want and haversine(center, (p["lat"], p["lng"])) <= radius]
        return self._near(hits, center)[:10]

    def autocomplete(self, text, center):
        q = text.lower().strip()
        prefix, word = [], []
        seen = set()
        for p in self.pois:
            n = p["name"].lower()
            if n.startswith(q):
                prefix.append(p)
            elif any(w.startswith(q) for w in n.replace("-", " ").split()):
                word.append(p)
        out = []
        popular = ("starbucks", "mcdonald", "albert heijn", "subway", "burger king")
        prefix = sorted(self._near(prefix, center), key=lambda p: 0 if p["name"].lower().startswith(popular) else 1)
        for p in prefix + self._near(word, center):
            if p["name"] in seen:
                continue
            seen.add(p["name"])
            out.append(p)
        return out[:5]

    # --- routing ----------------------------------------------------------------------
    def _build_graph(self):
        self.nodes = {}       # id -> (lat, lng)
        self.adj = {}         # id -> [(other, meters, road index, mode mask)]
        for i, r in enumerate(self.roads):
            car = r["cls"] in CAR
            walk = r["cls"] not in HIGHWAY
            for (a, ca), (b, cb) in zip(zip(r["ids"], r["coords"]), list(zip(r["ids"], r["coords"]))[1:]):
                self.nodes[a] = ca
                self.nodes[b] = cb
                d = haversine(ca, cb)
                fwd = (1 if car else 0) | (2 if walk else 0) | (4 if walk or car else 0)
                bwd = ((0 if r["oneway"] else 1) if car else 0) | (2 if walk else 0) | (4 if (walk or (car and not r["oneway"])) else 0)
                self.adj.setdefault(a, []).append((b, d, i, fwd))
                self.adj.setdefault(b, []).append((a, d, i, bwd))

    def _nearest(self, pt, mask):
        best, bd = None, 1e18
        for nid, c in self.nodes.items():
            if not any(m & mask for _, _, _, m in self.adj.get(nid, [])):
                continue
            d = (c[0] - pt[0]) ** 2 + ((c[1] - pt[1]) * math.cos(math.radians(pt[0]))) ** 2
            if d < bd:
                bd, best = d, nid
        return best

    def route(self, origin, dest, mode):
        mask = {"DRIVE": 1, "WALK": 2, "BICYCLE": 4, "TRANSIT": 2}.get(mode, 1)
        a, b = self._nearest(origin, mask), self._nearest(dest, mask)
        dist, prev = {a: 0.0}, {}
        heap = [(0.0, a)]
        while heap:
            d, u = heapq.heappop(heap)
            if u == b:
                break
            if d > dist.get(u, 1e18):
                continue
            for v, w, ri, m in self.adj.get(u, []):
                if not (m & mask):
                    continue
                cls = self.roads[ri]["cls"]
                cost = w / (SPEED.get(cls.replace("_link", ""), 6) if mask == 1 else 1.4)
                nd = d + cost
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    prev[v] = (u, ri)
                    heapq.heappush(heap, (nd, v))
        if b not in prev and a != b:
            return None
        path, roads = [b], []
        while path[-1] != a:
            u, ri = prev[path[-1]]
            roads.append(ri)
            path.append(u)
        path.reverse()
        roads.reverse()
        return self._steps([self.nodes[n] for n in path], roads, mode)

    def _steps(self, pts, roads, mode):
        speed = {"DRIVE": 10, "WALK": 1.4, "BICYCLE": 4.5, "TRANSIT": 1.4}.get(mode, 8)

        def label(ri):
            r = self.roads[ri]
            return r["name"] or r["ref"] or ""

        # group edges into runs on the same street
        runs = []
        for i, ri in enumerate(roads):
            nm = label(ri)
            if runs and (runs[-1]["name"] == nm or not nm):
                runs[-1]["end"] = i + 1
            else:
                runs.append({"name": nm, "start": i, "end": i + 1, "ri": ri})
        # fold very short pieces into their neighbours
        merged = []
        for r in runs:
            length = sum(haversine(pts[k], pts[k + 1]) for k in range(r["start"], r["end"]))
            if merged and length < 20:
                merged[-1]["end"] = r["end"]
            else:
                merged.append(r)
        steps = []
        for si, r in enumerate(merged):
            seg = pts[r["start"]:r["end"] + 1]
            meters = sum(haversine(p, q) for p, q in zip(seg, seg[1:]))
            name = r["name"] or "the road"
            if si == 0:
                b = bearing(seg[0], seg[min(len(seg) - 1, 2)])
                dirs = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
                man, text = "DEPART", "Head %s on %s" % (dirs[int((b + 22.5) // 45) % 8], name)
            else:
                prevseg = pts[merged[si - 1]["start"]:merged[si - 1]["end"] + 1]
                b1 = bearing(prevseg[-2] if len(prevseg) > 1 else prevseg[0], prevseg[-1])
                b2 = bearing(seg[0], seg[min(len(seg) - 1, 1)])
                turn = ((b2 - b1 + 540) % 360) - 180
                side = "right" if turn > 0 else "left"
                at = abs(turn)
                if self.roads[r["ri"]]["roundabout"]:
                    man, text = "ROUNDABOUT_" + side.upper(), "At the roundabout, take the 1st exit onto %s" % name
                elif at < 25:
                    man, text = "NAME_CHANGE", "Continue onto %s" % name
                elif at < 60:
                    man, text = "TURN_SLIGHT_" + side.upper(), "Slight %s onto %s" % (side, name)
                elif at < 140:
                    man, text = "TURN_" + side.upper(), "Turn %s onto %s" % (side, name)
                else:
                    man, text = "TURN_SHARP_" + side.upper(), "Sharp %s onto %s" % (side, name)
            if si == len(merged) - 1:
                text += "\nDestination will be on the right"
            steps.append({
                "distanceMeters": int(meters), "staticDuration": "%ds" % int(meters / speed),
                "polyline": {"encodedPolyline": encode(seg)},
                "navigationInstruction": {"maneuver": man, "instructions": text},
                "startLocation": {"latLng": {"latitude": seg[0][0], "longitude": seg[0][1]}},
                "endLocation": {"latLng": {"latitude": seg[-1][0], "longitude": seg[-1][1]}},
                "travelMode": "WALK" if mode == "TRANSIT" else mode,
            })
        total = sum(s["distanceMeters"] for s in steps)
        static = sum(int(s["staticDuration"][:-1]) for s in steps)
        longest = max(merged, key=lambda r: r["end"] - r["start"])["name"] if merged else ""
        return {"routes": [{
            "distanceMeters": total, "duration": "%ds" % int(static * 1.1), "staticDuration": "%ds" % static,
            "description": longest, "polyline": {"encodedPolyline": encode(pts)}, "legs": [{"steps": steps}],
        }]}

    # --- map pictures -------------------------------------------------------------------
    def render(self, center, z, w, h, style, paths, markers):
        st = STYLES.get(style, STYLES["light"])
        S = 2   # draw at double size, then shrink: smooth like Google's pictures
        cx, cy = project(center[0], center[1], z)
        im = Image.new("RGB", (w * S, h * S), st["bg"])
        dr = ImageDraw.Draw(im)

        def px(c):
            x, y = project(c[0], c[1], z)
            return ((x - cx) * S + w * S / 2, (y - cy) * S + h * S / 2)

        span_lat = h / (256 * 2 ** z) * 360 * 1.2
        span_lng = w / (256 * 2 ** z) * 360 * 1.2
        view = (center[0] - span_lat, center[1] - span_lng, center[0] + span_lat, center[1] + span_lng)

        def visible(bb):
            return not (bb[2] < view[0] or bb[0] > view[2] or bb[3] < view[1] or bb[1] > view[3])

        k = 2 ** (z - 16)
        for kind in ("park", "water"):
            for a in self.areas:
                if a["kind"] == kind and visible(a["bb"]):
                    dr.polygon([px(c) for c in a["coords"]], fill=st[kind])
        for wl in self.water_lines:
            if visible(wl["bb"]):
                wd = {"river": 14, "canal": 9, "stream": 3}[wl["kind"]] * k
                dr.line([px(c) for c in wl["coords"]], fill=st["water"], width=max(2, int(wd * S)), joint="curve")
        order = sorted((r for r in self.roads if visible(r["bb"])), key=lambda r: ROAD_CLASSES[r["cls"]])
        for r in order:
            base = ROAD_CLASSES[r["cls"]]
            if base < 2 and z < 16:
                continue
            if r["cls"] == "service" and z < 17:
                continue
            wd = max(1.0, base * k * (1.15 if style == "bw" else 1.0))
            if style == "bw" and r["cls"] in ("residential", "service", "living_street", "unclassified"):
                wd = max(1.0, wd * 0.45)
            col = st["hwy"] if r["cls"] in HIGHWAY else (st["minor"] if base < 2 else st["road"])
            pts = [px(c) for c in r["coords"]]
            dr.line(pts, fill=col, width=max(1, int(wd * S)), joint="curve")
            rad = wd * S / 2
            if rad >= 2:
                for p in (pts[0], pts[-1]):
                    dr.ellipse((p[0] - rad, p[1] - rad, p[0] + rad, p[1] + rad), fill=col)
        # route line
        for p in paths:
            pts = [px(c) for c in p["pts"]]
            if len(pts) > 1:
                dr.line(pts, fill=p["color"], width=int(p["weight"] * S), joint="curve")
        # labels
        self._labels(im, dr, px, z, st, view, visible, S)
        for m in markers:
            x, y = px(m)
            r = 6 * S
            dr.ellipse((x - r, y - 2.6 * r, x + r, y - 0.6 * r), fill=(234, 67, 53))
            dr.polygon([(x - 0.8 * r, y - 1.3 * r), (x + 0.8 * r, y - 1.3 * r), (x, y)], fill=(234, 67, 53))
            dr.ellipse((x - 0.35 * r, y - 1.95 * r, x + 0.35 * r, y - 1.25 * r), fill=(165, 14, 14))
        im = im.resize((w, h), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "PNG")
        return buf.getvalue()

    def _labels(self, im, dr, px, z, st, view, visible, S):
        font = ImageFont.truetype(self.font_path, 11 * S)
        boxes, placed = [], {}
        cands = []

        def straight_run(pts, need):
            # the longest fairly straight stretch, as a chord (a, b)
            best = None
            for i in range(len(pts) - 1):
                h0 = math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0])
                L = 0.0
                for j in range(i + 1, len(pts)):
                    seg = math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1])
                    hj = math.atan2(pts[j][1] - pts[j - 1][1], pts[j][0] - pts[j - 1][0])
                    if abs(((hj - h0 + math.pi) % (2 * math.pi)) - math.pi) > 0.45:
                        break
                    L += seg
                    if best is None or L > best[0]:
                        best = (L, pts[i], pts[j])
                    if L >= need * 1.6:
                        break
            return best

        for r in self.roads:
            if not r["name"] or not visible(r["bb"]) or z < LABEL_MIN_ZOOM.get(r["cls"], 30):
                continue
            pts = [px(c) for c in r["coords"]]
            best = straight_run(pts, 60 * S)
            if best:
                cands.append((ROAD_CLASSES[r["cls"]], best, r["name"]))
        for wl in self.water_lines:
            if wl["name"] and visible(wl["bb"]) and z >= 14:
                best = straight_run([px(c) for c in wl["coords"]], 60 * S)
                if best:
                    cands.append((20, best, wl["name"]))
        cands.sort(key=lambda c: -c[0])
        W, H = im.size
        for prio, (L, a, b), name in cands:
            tw = dr.textlength(name, font=font)
            if L < tw + 12 * S:
                continue
            mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            if not (20 * S < mx < W - 20 * S and 20 * S < my < H - 20 * S):
                continue
            if any(math.hypot(mx - q[0], my - q[1]) < 180 * S for q in placed.get(name, [])):
                continue
            ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
            if ang > 90:
                ang -= 180
            if ang < -90:
                ang += 180
            th = 15 * S
            tile = Image.new("RGBA", (int(tw + 8 * S), th + 6 * S), (0, 0, 0, 0))
            td = ImageDraw.Draw(tile)
            color = st["wtext"] if prio == 20 else st["text"]
            td.text((4 * S, 2 * S), name, font=font, fill=color + (255,), stroke_width=2 * S, stroke_fill=st["halo"] + (255,))
            rot = tile.rotate(-ang, expand=True, resample=Image.BICUBIC)
            box = (mx - rot.width / 2, my - rot.height / 2, mx + rot.width / 2, my + rot.height / 2)
            pad = 4 * S
            if any(not (box[2] + pad < o[0] or box[0] - pad > o[2] or box[3] + pad < o[1] or box[1] - pad > o[3]) for o in boxes):
                continue
            boxes.append(box)
            placed.setdefault(name, []).append((mx, my))
            im.paste(rot, (int(box[0]), int(box[1])), rot)


def encode(pts):
    out, plat, plng = [], 0, 0
    for la, lo in pts:
        a, b = int(round(la * 1e5)), int(round(lo * 1e5))
        for v in (a - plat, b - plng):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plng = a, b
    return "".join(out)
