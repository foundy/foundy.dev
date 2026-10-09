"""Synthesize 'ivory' front: recolour ONLY the bonnet+tie mask of one 625 photo to a cream/undyed-cotton yarn.
LAB: L remapped with a gentle curve around the yarn's mean (stitch luminance texture kept), chroma shifted to
target (a*,b*) with the original local chroma variation damped. Feather-blended with the shared adaptive mask.
Usage: 03_ivory.py [base=yellow]  -> out/ivory-front.png (lossless master) and out/ivory-front-<base>.png"""
import sys, os, json
import numpy as np
from skimage import color as skcolor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

base_name = sys.argv[1] if len(sys.argv) > 1 else 'yellow'
TARGET_L, TARGET_A, TARGET_B = 90.0, 1.2, 9.0   # warm undyed cotton: high L, low chroma, slight warm b*
L_GAIN = 1.05                                    # >1 keeps stitch relief at least as strong as the source
CHROMA_KEEP = 0.25                               # fraction of original chroma texture preserved

base = load(base_name)
alpha = np.array(Image.open(os.path.join(OUT, 'mask-front.png'))).astype(np.float32) / 255
hard = np.array(Image.open(os.path.join(OUT, 'mask-front-hard.png'))) > 127
lab = skcolor.rgb2lab(base.astype(np.float32) / 255)
L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
Lm = np.median(L[hard]); am = np.median(a[hard]); bm = np.median(b[hard])
Lr = L - Lm
# soft-knee curve: highlights compress towards 100 so the yarn never clips to flat white; shadows kept
L2 = TARGET_L + L_GAIN * Lr
over = L2 > 94
L2 = np.where(over, 94 + (L2 - 94) / (1 + (L2 - 94) / 6.0), L2)
a2 = TARGET_A + CHROMA_KEEP * (a - am)
b2 = TARGET_B + CHROMA_KEEP * (b - bm)
# darker (shadowed) stitches get slightly more chroma, like real undyed yarn
sh = np.clip((TARGET_L - L2) / 25.0, 0, 1)
b2 = b2 + 3.0 * sh
rec = skcolor.lab2rgb(np.stack([np.clip(L2, 0, 100), a2, b2], -1))
rec = np.clip(np.round(rec * 255), 0, 255).astype(np.uint8)
al = alpha[..., None]
blend = np.round(base.astype(np.float32) * (1 - al) + rec.astype(np.float32) * al).astype(np.uint8)
out = np.where((alpha > 0)[..., None], blend, base)
save_png(out, os.path.join(OUT, f'ivory-front-{base_name}.png'))
diff = np.abs(out.astype(int) - base.astype(int)).max(-1)
outside = alpha == 0
print(base_name, 'max diff outside feather support:', int(diff[outside].max()), 'px changed outside:', int((diff[outside] > 0).sum()),
      'byte-identical:', bool(np.array_equal(out[outside], base[outside])))
face = np.zeros_like(outside); face[200:440, 195:425] = True
print('face region (eyes..chin) max diff:', int(diff[face & outside].max()))
print('ivory yarn mean RGB', out[hard].mean(0).round(1), 'Lab median', np.median(skcolor.rgb2lab(out[hard].astype(np.float32) / 255), 0).round(1))
