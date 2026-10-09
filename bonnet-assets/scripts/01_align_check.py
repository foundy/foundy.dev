"""Measure residual misalignment between the 4 front photos (excluding the bonnet).
Optionally (--apply) write aligned copies if the residual exceeds 1px."""
import sys, os, json
import cv2
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

ims = {c: load(c, aligned=False) for c in COLORS}
gray = {c: cv2.cvtColor(ims[c], cv2.COLOR_RGB2GRAY).astype(np.float32) / 255 for c in COLORS}
ref = 'yellow'
# regions that never contain the bonnet: face (eyes..chin), left/right background, clothes
regions = {
    'face': (200, 440, 195, 425),
    'bg_left': (0, 380, 0, 140),
    'bg_right': (0, 380, 490, 625),
    'clothes': (470, 625, 90, 600),
}
res = {}
for c in COLORS:
    if c == ref:
        continue
    res[c] = {}
    for name, (y0, y1, x0, x1) in regions.items():
        a = gray[ref][y0:y1, x0:x1]
        b = gray[c][y0:y1, x0:x1]
        win = cv2.createHanningWindow((a.shape[1], a.shape[0]), cv2.CV_32F)
        (dx, dy), resp = cv2.phaseCorrelate(a, b, win)
        out = {'phase_dx': round(dx, 3), 'phase_dy': round(dy, 3), 'phase_resp': round(resp, 3)}
        try:
            wm = np.eye(2, 3, dtype=np.float32)
            _, wm = cv2.findTransformECC(cv2.GaussianBlur(a, (0, 0), 1.5), cv2.GaussianBlur(b, (0, 0), 1.5), wm,
                                         cv2.MOTION_AFFINE,
                                         (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-7), None, 5)
            out['ecc_affine'] = [[round(float(v), 5) for v in r] for r in wm]
            out['ecc_shift'] = [round(float(wm[0, 2]), 3), round(float(wm[1, 2]), 3)]
        except cv2.error as e:
            out['ecc_error'] = str(e)[:60]
        out['mean_abs_diff'] = round(float(np.abs(a - b).mean() * 255), 3)
        res[c][name] = out
    print(c, json.dumps(res[c]))
json.dump(res, open(os.path.join(OUT, 'alignment-report.json'), 'w'), indent=1)
