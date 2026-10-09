"""Bonnet + tie mask (front) from per-pixel colour variance across the 4 colourways.
Pipeline: LAB chroma/hue variance -> threshold -> morphology -> hole-fill (lace holes)
 -> connected components -> manual overrides (overrides-front.json) -> adaptive feather.
Outputs (out/): mask-front.png (feathered, 8-bit), mask-front-hard.png (binary),
 mask-<colour>-front.png (per-colour boundary corrected), mask-report.json, debug images (out/tmp)."""
import sys, os, json
import cv2
import numpy as np
from scipy import ndimage as ndi
from skimage import measure, filters, color as skcolor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

TMP = os.path.join(OUT, 'tmp'); os.makedirs(TMP, exist_ok=True)
ims = {c: load(c) for c in COLORS}
H, W = ims['green'].shape[:2]
lab = {c: skcolor.rgb2lab(ims[c].astype(np.float32) / 255) for c in COLORS}

MAX_HOLE = 220   # px; lace holes are small; tie-loop openings (~500+) and the face opening stay open


def fill_small_holes(m):
    inv = (1 - m).astype(np.uint8)
    l, k = ndi.label(inv)
    sz = ndi.sum(inv, l, range(1, k + 1))
    out = m.copy()
    # holes touching the image border are background, never filled
    border = set(np.unique(np.concatenate([l[0], l[-1], l[:, 0], l[:, -1]])))
    for i, s_ in enumerate(sz):
        if (i + 1) not in border and s_ <= MAX_HOLE:
            out[l == i + 1] = 1
    return out.astype(np.uint8)


# ---- 1. variance across colours. Use chroma-plane (a,b) spread + a bit of L, since dyes differ mostly in hue
stack = np.stack([lab[c] for c in COLORS])            # 4,H,W,3
ab = stack[..., 1:]
# max pairwise distance in (a,b)
d = np.zeros((H, W), np.float32)
for i in range(4):
    for j in range(i + 1, 4):
        d = np.maximum(d, np.linalg.norm(ab[i] - ab[j], axis=-1))
dL = stack[..., 0].max(0) - stack[..., 0].min(0)
score = d + 0.25 * dL
score_s = cv2.GaussianBlur(score, (0, 0), 0.7)
np.save(os.path.join(TMP, 'score.npy'), score_s)
t_otsu = filters.threshold_otsu(score_s)
print('otsu', t_otsu)
THR = float(os.environ.get('THR', 40.0))
hard = score_s > THR

# ---- 2. morphology, hole-fill (lace holes), connected components
hard = cv2.morphologyEx(hard.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
hard = cv2.morphologyEx(hard, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
hard = fill_small_holes(hard)   # fills enclosed lace holes (size-limited: never the face)
lbl, n = ndi.label(hard)
sizes = ndi.sum(hard, lbl, range(1, n + 1))
keep = [i + 1 for i, s in enumerate(sizes) if s > 150]
print('components', n, 'kept', len(keep), sorted(sizes)[-5:])
hard = np.isin(lbl, keep).astype(np.uint8)
np.save(os.path.join(TMP, 'hard_auto.npy'), hard)

# ---- 3. manual overrides: polygons to ADD / REMOVE (JSON, committed)
ov_path = os.path.join(ROOT, 'overrides-front.json')
if os.path.exists(ov_path):
    ov = json.load(open(ov_path))
    for poly in ov.get('add', []):
        cv2.fillPoly(hard, [np.array(poly, np.int32)], 1)
    for poly in ov.get('remove', []):
        cv2.fillPoly(hard, [np.array(poly, np.int32)], 0)
    # an optional painted PNG (white=add, black=remove, grey=none) can also be dropped in
    pp = os.path.join(ROOT, 'overrides-front.png')
    if os.path.exists(pp):
        p = np.array(Image.open(pp).convert('L'))
        hard[p > 200] = 1; hard[p < 50] = 0
    # re-fill holes after additions and drop specks
    hard = fill_small_holes(hard)
    lbl, n = ndi.label(hard)
    sizes = ndi.sum(hard, lbl, range(1, n + 1))
    hard = np.isin(lbl, [i + 1 for i, s in enumerate(sizes) if s > 150]).astype(np.uint8)

# ---- 4. adaptive feather: radius from local thickness (2*max inscribed distance)
dist_in = ndi.distance_transform_edt(hard)
# local thickness: dilate the distance ridge back over the shape (max filter-ish) via grey dilation
thick = cv2.dilate(dist_in.astype(np.float32), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
thick = cv2.GaussianBlur(thick, (0, 0), 3)
# radius 6px where thick>=6 (broad), 1.5px for thin ties (thick<=2)
rad = np.clip(0.75 * thick, 1.5, 6.0)
dist_out = ndi.distance_transform_edt(1 - hard)
sdist = np.where(hard > 0, dist_in - 0.5, -(dist_out - 0.5))   # signed, + inside
# feather is centred on the hard edge: alpha = smoothstep over [-r/2, +r/2] (total width r)
t = np.clip(sdist / rad + 0.5, 0, 1)
alpha = t * t * (3 - 2 * t)
mask8 = np.round(alpha * 255).astype(np.uint8)
Image.fromarray(mask8).save(os.path.join(OUT, 'mask-front.png'), optimize=True)
Image.fromarray(hard * 255).save(os.path.join(OUT, 'mask-front-hard.png'), optimize=True)
np.save(os.path.join(TMP, 'rad.npy'), rad)
# extent of the feather: pixels with 0<alpha<1
ext = (mask8 > 0)
print('mask area hard', int(hard.sum()), 'frac', hard.mean(), 'feather support', int(ext.sum()))

# ---- 5. skin leakage: mask pixels whose hue is skin-like in ALL 4 photos
def skin_like(rgb):
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.float32)   # H 0..180
    h, s, v = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    return (h >= 5) & (h <= 35) & (s >= 0.18) & (s <= 0.65) & (v > 0.45)
sk = np.logical_and.reduce([skin_like(ims[c]) for c in COLORS])
leak = (hard > 0) & sk
print('skin-like-in-all-4 pixels inside hard mask:', int(leak.sum()))
# per colour: mask pixels with skin-like hue in that colour only (colour-specific leak)
rep = {'threshold': THR, 'otsu': float(t_otsu), 'mask_area_px': int(hard.sum()), 'mask_area_frac': float(hard.mean()),
       'feather_support_px': int(ext.sum()), 'skin_leak_all4_px': int(leak.sum()),
       'skin_leak_all4_frac_of_mask': float(leak.sum() / hard.sum())}
Image.fromarray((leak * 255).astype(np.uint8)).save(os.path.join(TMP, 'leak.png'))
json.dump(rep, open(os.path.join(OUT, 'mask-report.json'), 'w'), indent=1)

# ---- debug overlay
ov = ims['yellow'].copy()
edge = (hard - cv2.erode(hard, np.ones((3, 3), np.uint8))) > 0
ov[edge] = (255, 0, 255)
ov[leak] = (0, 255, 0)
big = cv2.resize(ov, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
Image.fromarray(big).save(os.path.join(TMP, 'overlay.png'))
