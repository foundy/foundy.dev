"""Copy final deliverables to bonnet-assets/assets/ (committed). Ivory goes out as LOSSLESS WebP so the
byte-identical-face guarantee survives encoding. Verifies face/background identity vs the yellow base."""
import sys, os, shutil, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

A = os.path.join(ROOT, 'assets'); os.makedirs(A, exist_ok=True)
for c in COLORS:
    shutil.copy(os.path.join(SRC, f'bonnet-{c}-front.webp'), os.path.join(A, f'{c}-front.webp'))
iv = Image.open(os.path.join(OUT, 'ivory-front-yellow.png')).convert('RGB')
iv.save(os.path.join(A, 'ivory-front.webp'), lossless=True, quality=100, method=6)
for f in ('mask-front.png', 'mask-front-hard.png', 'cells-front.png', 'cells-front.json', 'cells-front-vis.png',
          'mask-green-front.png', 'mask-red-front.png', 'mask-skyblue-front.png', 'mask-yellow-front.png'):
    shutil.copy(os.path.join(OUT, f), os.path.join(A, f))
for f in ('alignment-report.json', 'mask-report.json', 'upscale-report.json'):
    if os.path.exists(os.path.join(OUT, f)):
        shutil.copy(os.path.join(OUT, f), os.path.join(ROOT, 'review', f))

# verify
base = np.array(Image.open(os.path.join(A, 'yellow-front.webp')).convert('RGB'))
ivr = np.array(Image.open(os.path.join(A, 'ivory-front.webp')).convert('RGB'))
alpha = np.array(Image.open(os.path.join(A, 'mask-front.png')))
out = alpha == 0
diff = np.abs(ivr.astype(int) - base.astype(int)).max(-1)
print('ivory.webp vs yellow base outside feather support: max diff', int(diff[out].max()),
      '| changed px outside', int((diff[out] > 0).sum()), '| changed px inside support', int((diff[~out] > 0).sum()))
for f in sorted(os.listdir(A)):
    print(f, os.path.getsize(os.path.join(A, f)))
