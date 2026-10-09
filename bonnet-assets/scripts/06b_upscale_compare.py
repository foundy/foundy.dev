"""Optional 2x experiment, step 3: realesrgan-x4plus output (2500px) -> Lanczos to 1250 (2x), compare with bicubic 2x.
Writes review/upscale-stitch.webp, review/upscale-face.webp (rows: bicubic | ESRGAN per colour) and prints
cross-colour consistency metrics: mean |luma diff| between colour pairs inside the face region (should stay at the
source level if no per-colour hallucination) and in the bonnet interior (structure similarity of luma texture)."""
import sys, os, json
import cv2
import numpy as np
from skimage.metrics import structural_similarity as ssim
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

REV = os.path.join(ROOT, 'review'); os.makedirs(REV, exist_ok=True)
up = {}; bic = {}
for c in COLORS:
    big = np.array(Image.open(f'/tmp/resr/out/{c}.png').convert('RGB'))
    up[c] = cv2.resize(big, (1250, 1250), interpolation=cv2.INTER_AREA)
    bic[c] = cv2.resize(load(c, aligned=False), (1250, 1250), interpolation=cv2.INTER_CUBIC)
    save_png(up[c], os.path.join(OUT, 'tmp', f'esrgan2x-{c}.png'))

def luma(a): return cv2.cvtColor(a, cv2.COLOR_RGB2GRAY).astype(np.float32)
face = (slice(2 * 230, 2 * 420), slice(2 * 215, 2 * 410))     # eyes..mouth
bon = (slice(2 * 90, 2 * 200), slice(2 * 230, 2 * 400))       # crown stitches
res = {}
pairs = [(a, b) for i, a in enumerate(COLORS) for b in COLORS[i + 1:]]
for name, region in (('face', face), ('stitch', bon)):
    for kind, S in (('bicubic', bic), ('esrgan', up)):
        d = []; s = []
        for a, b in pairs:
            la, lb = luma(S[a])[region], luma(S[b])[region]
            # remove global tone difference between colourways before comparing structure
            lb = (lb - lb.mean()) / (lb.std() + 1e-6) * la.std() + la.mean()
            d.append(float(np.abs(la - lb).mean())); s.append(float(ssim(la, lb, data_range=255)))
        res[f'{name}_{kind}'] = {'mean_abs_luma_diff': round(float(np.mean(d)), 3), 'ssim': round(float(np.mean(s)), 4)}
print(json.dumps(res, indent=1))
json.dump(res, open(os.path.join(OUT, 'upscale-report.json'), 'w'), indent=1)

def sheet(region_xy, fname, size):
    x0, y0, x1, y1 = region_xy
    rows = []
    for S in (bic, up):
        rows.append(np.hstack([S[c][y0:y1, x0:x1] for c in COLORS]))
    img = np.vstack(rows)
    Image.fromarray(img).save(os.path.join(REV, fname), quality=82, method=6)
sheet((2 * 250, 2 * 85, 2 * 250 + 200, 2 * 85 + 150), 'upscale-stitch.webp', None)
sheet((2 * 250, 2 * 270, 2 * 250 + 200, 2 * 270 + 150), 'upscale-face.webp', None)
