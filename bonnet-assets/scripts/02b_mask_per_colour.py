"""Per-colour boundary-corrected masks.
For colour c: within 3px of the shared boundary, drop mask pixels that look like skin/surround in c's photo
(colour-specific leak), then re-feather with the same adaptive radius. Writes out/mask-<c>-front.png."""
import sys, os, json
import cv2
import numpy as np
from scipy import ndimage as ndi
from skimage import color as skcolor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

hard = (np.array(Image.open(os.path.join(OUT, 'mask-front-hard.png'))) > 127).astype(np.uint8)
rad = np.load(os.path.join(OUT, 'tmp', 'rad.npy'))


def skin_like(rgb):
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.float32)
    h, s, v = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    return (h >= 5) & (h <= 35) & (s >= 0.18) & (s <= 0.65) & (v > 0.45)


def feather(m):
    din = ndi.distance_transform_edt(m)
    dout = ndi.distance_transform_edt(1 - m)
    sd = np.where(m > 0, din - 0.5, -(dout - 0.5))
    t = np.clip(sd / rad + 0.5, 0, 1)
    return np.round(t * t * (3 - 2 * t) * 255).astype(np.uint8)


din = ndi.distance_transform_edt(hard)
dout = ndi.distance_transform_edt(1 - hard)
near_edge = din <= 3
rep = json.load(open(os.path.join(OUT, 'mask-report.json')))
per = {}
for c in COLORS:
    im = load(c)
    lab = skcolor.rgb2lab(im.astype(np.float32) / 255)
    yarn = np.median(lab[din > 6], axis=0)
    sur = np.median(lab[(dout <= 6) & (hard == 0)], axis=0)
    dy = np.linalg.norm(lab[..., 1:] - yarn[1:], axis=-1)
    ds = np.linalg.norm(lab[..., 1:] - sur[1:], axis=-1)
    drop = near_edge & (hard > 0) & skin_like(im) & (ds < dy)
    hc = hard.copy()
    hc[drop] = 0
    hc = cv2.morphologyEx(hc, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    Image.fromarray(feather(hc)).save(os.path.join(OUT, f'mask-{c}-front.png'), optimize=True)
    per[c] = {'dropped_px': int(((hard > 0) & (hc == 0)).sum()), 'area_px': int(hc.sum())}
print('per-colour', per)
rep['per_colour'] = per
json.dump(rep, open(os.path.join(OUT, 'mask-report.json'), 'w'), indent=1)
