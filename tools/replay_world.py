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
        return self.json.get("places_search_starbucks.json", {"places": []})

    def autocomplete(self):
        return self.json.get("places_autocomplete_sta.json", {"suggestions": []})

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
