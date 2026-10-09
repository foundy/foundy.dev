"""Face QA: render the demo's actual shader (headless Chromium, 625x625 1:1) at p=0.25/0.5/0.75 for 3 colour pairs,
and a diff vs the base photo proving ZERO change outside mask+feather. Needs the static server (README).
Writes review/qa-<from>-<to>-p<NN>.webp (<=300KB), review/qa-diff-*.png, and prints / saves numbers."""
import sys, os, io, json, base64
import numpy as np
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

URL = os.environ.get('DEMO_URL', 'http://localhost:8765/demo/index.html?qa=1&size=625')
CHROME = os.environ.get('CHROME') or os.path.expanduser('~/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
REV = os.path.join(ROOT, 'review'); os.makedirs(REV, exist_ok=True)
pairs = [('green', 'red', 120, 220), ('skyblue', 'ivory', 500, 300), ('yellow', 'green', 312, 700)]
Ps = [0.25, 0.5, 0.75]

alpha = np.array(Image.open(os.path.join(ROOT, 'assets', 'mask-front.png')))
base = np.array(Image.open(os.path.join(ROOT, 'assets', 'yellow-front.webp')).convert('RGB'))
outside = alpha == 0
report = {}


def decode(durl):
    return np.array(Image.open(io.BytesIO(base64.b64decode(durl.split(',')[1]))).convert('RGB'))


with sync_playwright() as pw:
    kw = {'executable_path': CHROME} if os.path.exists(CHROME) else {}
    br = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], **kw)
    pg = br.new_page(viewport={'width': 700, 'height': 800}, device_scale_factor=1)
    pg.on('console', lambda m: print('console:', m.text) if m.type == 'error' else None)
    pg.goto(URL)
    pg.wait_for_function('window.__dye && window.__dye.ready', timeout=20000)
    strips = []
    for a, b, ox, oy in pairs:
        row = []
        for p in Ps:
            durl = pg.evaluate('(a)=>window.__dye.frame(a)', {'from': a, 'to': b, 'ox': ox, 'oy': oy, 'p': p})
            img = decode(durl)
            assert img.shape[:2] == (625, 625), img.shape
            d = np.abs(img.astype(int) - base.astype(int)).max(-1)
            n_out = int((d[outside] > 0).sum())
            key = f'{a}-{b}-p{int(p * 100):02d}'
            report[key] = {'changed_px_outside_support': n_out, 'max_diff_outside': int(d[outside].max()),
                           'max_diff_face_box': int(d[200:440, 195:425][outside[200:440, 195:425]].max()),
                           'changed_px_inside_support': int((d[~outside] > 0).sum())}
            Image.fromarray(img).save(os.path.join(REV, f'qa-{key}.webp'), quality=84, method=6)
            vis = np.clip(d * 8, 0, 255).astype(np.uint8)       # x8 amplified diff (white = changed)
            row.append(img);
            if p == 0.5:
                diffimg = np.stack([vis, vis, vis], -1)
                diffimg[outside & (d == 0)] = (diffimg[outside & (d == 0)] * 0)
                Image.fromarray(diffimg).save(os.path.join(REV, f'qa-diff-{a}-{b}-p50.png'), optimize=True)
        strips.append(np.hstack(row))
    sheet = np.vstack(strips)
    Image.fromarray(sheet).resize((sheet.shape[1] // 2, sheet.shape[0] // 2), Image.LANCZOS).save(os.path.join(REV, 'qa-contact-sheet.webp'), quality=80, method=6)
    br.close()
json.dump(report, open(os.path.join(REV, 'face-qa-report.json'), 'w'), indent=1)
print(json.dumps(report, indent=1))
print('TOTAL changed px outside mask+feather:', sum(v['changed_px_outside_support'] for v in report.values()))
