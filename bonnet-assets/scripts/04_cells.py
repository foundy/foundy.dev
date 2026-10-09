"""Stitch cell map (front): polar cells following the brim rows.

Row field: crochet rounds run parallel to the (scalloped) brim, so row = floor(d_brim / ROW_H) where d_brim is the
distance to the face opening (hair/face side of the bonnet). Each row is split into angular sectors (angle about the
face-opening centroid) with equal pixel counts so cells are ~CELL px square. Rows are therefore scalloped like the brim.
Ties (below the chin line) continue the row index with geodesic distance from the crown along the string.
Cells are split by connected components (the two bow loops share row/sector keys), tiny cells merged.

Outputs: out/cells-front.png  RGBA 8-bit lossless: R=id low byte, G=id high byte, B=row index, A=255 where a cell is
         defined (= feather support, so feathered edge pixels also have an id; the soft mask is mask-front.png)
         out/cells-front.json   per-cell table {id, cx, cy, area, row, sector, jitter} + params
         out/cells-front-vis.png false colour for review (+ rows)"""
import sys, os, json
import cv2
import numpy as np
from scipy import ndimage as ndi
from skimage.graph import MCP_Geometric
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

CROWN = (317, 96)          # (x, y): centre of the top shell fan, px in the 625 photo
FACE_SEED = (320, 330)     # a pixel inside the face opening
CLOSE_LINES = [((211, 422), (234, 444))]   # gap between left cheek wall and chin strap
TIE_Y = 435                # below this y the mask is ties
ROW_H = 13.0               # px per row (cell height)
CELL = 13.0                # target cell side (px)
MIN_CELL = 40              # px; smaller fragments are merged into a neighbour
SEED = 7

alpha = np.array(Image.open(os.path.join(OUT, 'mask-front.png')))
hard = (np.array(Image.open(os.path.join(OUT, 'mask-front-hard.png'))) > 127)
H, W = hard.shape
support = alpha > 0

# ---- face opening: close the bottom, take the enclosed hole that contains FACE_SEED
# bridge small gaps in the chin strap so the opening is an enclosed hole
bridged = cv2.morphologyEx(hard.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))) > 0
bridged |= hard
# the left cheek wall ends ~30px short of the chin strap (tips don't close morphologically): bridge with a line
bb = bridged.astype(np.uint8)
for (p0, p1) in CLOSE_LINES:
    cv2.line(bb, p0, p1, 1, 3)
bridged = bb > 0
lab, _ = ndi.label(~bridged)
face_open = lab == lab[FACE_SEED[1], FACE_SEED[0]]
assert 20000 < face_open.sum() < 80000, face_open.sum()
d_brim = ndi.distance_transform_edt(~face_open)
cy0, cx0 = [float(v) for v in ndi.center_of_mass(face_open)]
print('face opening centroid (x,y)=(%.1f,%.1f) area=%d' % (cx0, cy0, face_open.sum()))

# ---- geodesic distance from crown inside the mask (for ties)
cost = np.where(support, 1.0, 1e4)
mcp = MCP_Geometric(cost)
d_c, _ = mcp.find_costs([(CROWN[1], CROWN[0])])
yy, xx = np.mgrid[0:H, 0:W]
# ties = thin parts: what survives neither a 6px-radius opening (+3px regrow) of the mask; keep large leftovers only
core = cv2.dilate(cv2.morphologyEx(hard.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))),
                  cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))).astype(bool)
left = support & ~core
ll, ln = ndi.label(left, structure=np.ones((3, 3)))
big = [i for i in range(1, ln + 1) if (ll == i).sum() > 300]
tie = np.isin(ll, big)
body = support & ~tie

row = np.zeros((H, W), np.int32)
row[body] = np.floor(d_brim[body] / ROW_H).astype(np.int32)
nbody_rows = int(row[body].max()) + 1
if tie.any():
    dmin = d_c[tie].min()
    row[tie] = nbody_rows + np.floor((d_c[tie] - dmin) / ROW_H).astype(np.int32)

# ---- sectors
theta = np.arctan2(xx - cx0, -(yy - cy0))        # 0 = up, +90 = right, +-180 = down
sector = np.zeros((H, W), np.int32)
rows_present = np.unique(row[body])
nsec = {}
for k in rows_present:
    m = body & (row == k)
    n = int(m.sum())
    length = n / ROW_H
    N = max(1, int(round(length / CELL)))
    nsec[int(k)] = N
    th = theta[m]
    order = np.argsort(th, kind='stable')
    ranks = np.empty(n, np.int32); ranks[order] = np.arange(n)
    sector[m] = np.minimum((ranks * N) // n, N - 1)
# ties: a single sector across the string, rows run along it

# ---- cell ids: (row, sector) key -> connected components
key = np.where(support, row * 1000 + sector + 1, 0)
ids = np.zeros((H, W), np.int32)
nid = 0
for kv in np.unique(key[key > 0]):
    m = key == kv
    l, n = ndi.label(m, structure=np.ones((3, 3)))   # 8-connected
    for i in range(1, n + 1):
        nid += 1
        ids[l == i] = nid
# merge tiny cells into the neighbour sharing the longest border
def merge_tiny(ids):
    changed = True
    while changed:
        changed = False
        areas = np.bincount(ids.ravel())
        tiny = [i for i in range(1, len(areas)) if 0 < areas[i] < MIN_CELL]
        for i in tiny:
            m = ids == i
            ring = cv2.dilate(m.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & ~m & (ids > 0)
            if not ring.any():
                continue
            nb = np.bincount(ids[ring], minlength=len(areas)); nb[i] = 0
            if nb.max() == 0:
                continue
            ids[m] = int(nb.argmax()); changed = True
    return ids
ids = merge_tiny(ids)
# compact ids to 1..N
u = np.unique(ids[ids > 0]); remap = np.zeros(ids.max() + 1, np.int32); remap[u] = np.arange(1, len(u) + 1)
ids = remap[ids]
N = int(ids.max())
assert N < 65535
print('cells:', N, 'body rows:', nbody_rows, 'total rows:', int(row[support].max()) + 1)

# ---- table
rng = np.random.default_rng(SEED)
jit = rng.random(N + 1)
cells = []
areas = np.bincount(ids.ravel(), minlength=N + 1)
cx = ndi.mean(xx.astype(np.float64), ids, range(1, N + 1))
cy = ndi.mean(yy.astype(np.float64), ids, range(1, N + 1))
# row/sector per cell = mode
rowmax = ndi.maximum(row, ids, range(1, N + 1))
for i in range(1, N + 1):
    cells.append({'id': i, 'cx': round(float(cx[i - 1]), 2), 'cy': round(float(cy[i - 1]), 2), 'area': int(areas[i]),
                  'row': int(rowmax[i - 1]), 'jitter': round(float(jit[i]), 4)})
a = areas[1:]
sides = np.sqrt(a)
stats = {'cells': N, 'area_px_mean': float(a.mean()), 'area_px_median': float(np.median(a)), 'area_px_p5': float(np.percentile(a, 5)),
         'area_px_p95': float(np.percentile(a, 95)), 'side_px_median': float(np.median(sides)),
         'side_px_p5': float(np.percentile(sides, 5)), 'side_px_p95': float(np.percentile(sides, 95)),
         'body_rows': nbody_rows, 'tie_rows': int(row[support].max()) + 1 - nbody_rows}
print(json.dumps(stats))
json.dump({'params': {'crown': CROWN, 'face_open_centroid': [round(cx0, 1), round(cy0, 1)], 'row_h': ROW_H, 'cell': CELL,
                      'tie_y': TIE_Y, 'size': [W, H], 'seed': SEED}, 'stats': stats, 'cells': cells},
          open(os.path.join(OUT, 'cells-front.json'), 'w'), separators=(',', ':'))

rgba = np.zeros((H, W, 4), np.uint8)
rgba[..., 0] = ids & 255; rgba[..., 1] = (ids >> 8) & 255
rgba[..., 2] = np.where(support, np.minimum(row, 255), 0).astype(np.uint8)
rgba[..., 3] = np.where(ids > 0, 255, 0)
Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, 'cells-front.png'), optimize=True)

# ---- false colour visualisation (on faded yellow photo)
base = load('yellow').astype(np.float32)
rs = np.random.default_rng(3)
pal = (rs.random((N + 1, 3)) * 200 + 40)
vis = pal[ids]
img = np.where((ids > 0)[..., None], 0.25 * base + 0.75 * vis, base)
edges = (ids != np.roll(ids, 1, 0)) | (ids != np.roll(ids, 1, 1))
img[edges & (ids > 0)] = (20, 20, 20)
img = np.clip(img, 0, 255).astype(np.uint8)
img = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
cv2.circle(img, (CROWN[0] * 2, CROWN[1] * 2), 8, (255, 255, 255), 2)
save_png(img, os.path.join(OUT, 'cells-front-vis.png'))
rowvis = (np.array([[v] for v in range(256)], np.uint8))
rv = cv2.applyColorMap(np.where(support, (row * 9) % 255, 0).astype(np.uint8), cv2.COLORMAP_TURBO)[..., ::-1]
rv = np.where(support[..., None], rv, base.astype(np.uint8))
save_png(cv2.resize(rv, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST), os.path.join(OUT, 'tmp', 'rows-vis.png'))
