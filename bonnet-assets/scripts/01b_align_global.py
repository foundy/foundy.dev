"""Second, more robust alignment estimate: translation ECC over ALL non-bonnet pixels (final mask, dilated 15px),
on blurred luma normalised per image (the colourways differ in global grade). Run after 02_mask.py."""
import sys, os, json
import cv2
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

ref = 'yellow'
gray = {c: cv2.cvtColor(load(c, aligned=False), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255 for c in COLORS}
hard = np.array(Image.open(os.path.join(OUT, 'mask-front-hard.png'))) > 127
keep = (~cv2.dilate(hard.astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool)).astype(np.uint8)
keep[:, 620:] = 0   # source photos carry a 2px white column at x=623..624


def norm(g):
    g = cv2.GaussianBlur(g, (0, 0), 1.2)
    return ((g - g[keep > 0].mean()) / g[keep > 0].std()).astype(np.float32)


glob = {}
for c in COLORS:
    if c == ref:
        continue
    wm = np.eye(2, 3, dtype=np.float32)
    cc, wm = cv2.findTransformECC(norm(gray[ref]), norm(gray[c]), wm, cv2.MOTION_TRANSLATION,
                                  (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-8), keep, 5)
    glob[c] = {'dx': round(float(wm[0, 2]), 3), 'dy': round(float(wm[1, 2]), 3), 'ecc_cc': round(float(cc), 4),
               'residual_px': round(float(np.hypot(wm[0, 2], wm[1, 2])), 3)}
print('GLOBAL masked ECC translation vs', ref, json.dumps(glob))
rep_path = os.path.join(OUT, 'alignment-report.json')
rep = json.load(open(rep_path))
rep['_global_masked_ecc_translation'] = glob
json.dump(rep, open(rep_path, 'w'), indent=1)
