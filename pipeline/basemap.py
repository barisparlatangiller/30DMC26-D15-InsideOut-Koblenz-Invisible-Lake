"""Grey basemap (CARTO Positron, no labels; © OpenStreetMap contributors © CARTO), reprojected to EPSG:25832.
box: the 30 km 3D area at ~3.7 m/px (8192 px). ctx: 150 km context at 50 m/px (3000 px). Runs in GitHub Actions."""
import io, math, os, time, requests, numpy as np
from PIL import Image
from pyproj import Transformer
Image.MAX_IMAGE_PIXELS = None
OUT = "docs/data"; os.makedirs(OUT, exist_ok=True)
T = Transformer.from_crs(25832, 4326, always_xy=True)
S = requests.Session(); S.headers["User-Agent"] = "30DayMapChallenge Day15 (github.com/barisparlatangiller)"

def tile(z, x, y):
    for a in range(6):
        try:
            r = S.get(f"https://{'abcd'[(x+y)%4]}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png", timeout=60)
            if r.ok: return Image.open(io.BytesIO(r.content)).convert("RGB")
        except Exception as e: print("retry", e)
        time.sleep(2*(a+1))
    raise SystemExit(f"tile failed {z}/{x}/{y}")

def merc(lon, lat, z):
    n = 2**z * 512
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1/math.cos(math.radians(lat))) / math.pi) / 2 * n

TS = 256
def build(x0, y0, x1, y1, px, z, name, q=88):
    E = x0 + (np.arange(px) + 0.5) * (x1 - x0) / px; N = y1 - (np.arange(px) + 0.5) * (y1 - y0) / px
    EE, NN = np.meshgrid(E, N); lon, lat = T.transform(EE, NN)
    n = 2**z * TS
    mx = (lon + 180) / 360 * n
    my = (1 - np.log(np.tan(np.radians(lat)) + 1/np.cos(np.radians(lat))) / np.pi) / 2 * n
    tx0, tx1 = int(mx.min() // TS), int(mx.max() // TS); ty0, ty1 = int(my.min() // TS), int(my.max() // TS)
    print(name, "tiles", (tx1-tx0+1)*(ty1-ty0+1), flush=True)
    M = np.zeros(((ty1-ty0+1)*TS, (tx1-tx0+1)*TS, 3), np.uint8)
    from concurrent.futures import ThreadPoolExecutor
    jobs = [(tx, ty) for ty in range(ty0, ty1+1) for tx in range(tx0, tx1+1)]
    with ThreadPoolExecutor(8) as ex: imgs = list(ex.map(lambda a: tile(z, *a), jobs))
    for (tx, ty), im in zip(jobs, imgs):
        if True:
            M[(ty-ty0)*TS:(ty-ty0+1)*TS, (tx-tx0)*TS:(tx-tx0+1)*TS] = np.asarray(im.resize((TS, TS)))
    o = np.zeros((px, px, 3), np.uint8)
    for r0 in range(0, px, 512):
        fx = mx[r0:r0+512] - tx0*TS - 0.5; fy = my[r0:r0+512] - ty0*TS - 0.5
        ix = np.clip(fx.astype(int), 0, M.shape[1]-2); iy = np.clip(fy.astype(int), 0, M.shape[0]-2)
        u = (fx - ix)[..., None].astype(np.float32); v = (fy - iy)[..., None].astype(np.float32)
        o[r0:r0+512] = (M[iy, ix]*(1-u)*(1-v) + M[iy, ix+1]*u*(1-v) + M[iy+1, ix]*(1-u)*v + M[iy+1, ix+1]*u*v).astype(np.uint8)
    Image.fromarray(o).save(f"{OUT}/{name}.jpg", quality=q, optimize=True)

build(385000, 5565000, 415000, 5595000, 8192, 15, "base_8k")
im = Image.open(f"{OUT}/base_8k.jpg"); im.resize((4096, 4096), Image.LANCZOS).save(f"{OUT}/base.jpg", quality=88, optimize=True)
build(325000, 5505000, 475000, 5655000, 3000, 12, "base_ctx")
print("done")
