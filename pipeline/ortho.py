"""Fetch the RLP DOP20 orthophoto (open data, dl-de/by-2.0) via WMS and build the terrain textures.
Runs in GitHub Actions (the WMS is not reachable from every network)."""
import io, os, time, requests
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
WMS = "https://geo4.service24.rlp.de/wms/rp_dop20.fcgi"
OUT = "docs/data"

def fetch(minx, miny, maxx, maxy, px, py):
    q = dict(SERVICE="WMS", VERSION="1.3.0", REQUEST="GetMap", LAYERS="rp_dop20", STYLES="", CRS="EPSG:25832",
             BBOX=f"{minx},{miny},{maxx},{maxy}", WIDTH=px, HEIGHT=py, FORMAT="image/jpeg")
    for a in range(6):
        try:
            r = requests.get(WMS, params=q, timeout=120)
            if r.ok and r.headers.get("content-type", "").startswith("image"):
                return Image.open(io.BytesIO(r.content)).convert("RGB")
            print("bad", r.status_code, r.text[:200])
        except Exception as e:
            print("retry", e)
        time.sleep(3 * (a + 1))
    raise SystemExit("WMS failed")

def mosaic(x0, y0, x1, y1, mpp, tile_m):
    W, H = round((x1 - x0) / mpp), round((y1 - y0) / mpp)
    img = Image.new("RGB", (W, H))
    tp = round(tile_m / mpp)
    for ty, y in enumerate(range(int(y1), int(y0), -int(tile_m))):
        for tx, x in enumerate(range(int(x0), int(x1), int(tile_m))):
            t = fetch(x, y - tile_m, x + tile_m, y, tp, tp)
            img.paste(t, (tx * tp, ty * tp))
        print("row", ty, flush=True)
    return img

os.makedirs(OUT, exist_ok=True)
# whole 30 km box at 3 m/px -> 8192 (film) and 4096 (web)
big = mosaic(385000, 5565000, 415000, 5595000, 3.0, 3000)
big.resize((8192, 8192), Image.LANCZOS).save(f"{OUT}/ortho_8k.jpg", quality=86, optimize=True)
big.resize((4096, 4096), Image.LANCZOS).save(f"{OUT}/ortho.jpg", quality=86, optimize=True)
# Koblenz core 8 x 8 km at 1 m/px -> 8192 (film) and 4096 (web)
core = mosaic(396000, 5574000, 404000, 5582000, 1.0, 1000)
core.resize((8192, 8192), Image.LANCZOS).save(f"{OUT}/ortho_core_8k.jpg", quality=86, optimize=True)
core.resize((4096, 4096), Image.LANCZOS).save(f"{OUT}/ortho_core.jpg", quality=86, optimize=True)
print("done")
