"""Playwright screenshots of the demo at mobile 390x844, mid-drag (real pointer events), plus debug views."""
import sys, os, io
from playwright.sync_api import sync_playwright
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

URL = os.environ.get('DEMO_URL', 'http://localhost:8765/demo/index.html')
CHROME = os.path.expanduser('~/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
REV = os.path.join(ROOT, 'review')


def save(png, name):
    Image.open(io.BytesIO(png)).convert('RGB').save(os.path.join(REV, name), quality=84, method=6)


with sync_playwright() as pw:
    kw = {'executable_path': CHROME} if os.path.exists(CHROME) else {}
    br = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], **kw)
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: print('console', m.type, m.text) if m.type in ('error', 'warning') else None)
    pg.goto(URL)
    pg.wait_for_function('window.__dye && window.__dye.ready', timeout=20000)
    box = pg.locator('#stage').bounding_box()
    print('stage box', box)
    x0, y0 = box['x'] + box['width'] * 0.78, box['y'] + box['height'] * 0.30
    pg.mouse.move(x0, y0); pg.mouse.down()
    for i in range(1, 13):
        pg.mouse.move(x0 - i * 10, y0 + i * 0.5)
    pg.wait_for_timeout(120)
    print(pg.evaluate('JSON.stringify(window.__dye.state().dye)'))
    save(pg.screenshot(), 'demo-mobile-middrag.webp')
    pg.evaluate("for (const i of ['dbgCells','dbgDist']) { const e=document.getElementById(i); e.checked=true; e.dispatchEvent(new Event('change')); }"); pg.wait_for_timeout(100)
    save(pg.screenshot(), 'demo-mobile-debug.webp')
    pg.evaluate("for (const i of ['dbgCells','dbgDist']) { const e=document.getElementById(i); e.checked=false; e.dispatchEvent(new Event('change')); }")
    pg.mouse.up(); pg.wait_for_timeout(700)
    print('after release', pg.evaluate('JSON.stringify(window.__dye.state())'))
    # swatch tap path
    pg.locator('.sw').nth(1).click(); pg.wait_for_timeout(120)
    save(pg.screenshot(), 'demo-mobile-tap-mid.webp')
    pg.wait_for_timeout(400)
    print('after tap', pg.evaluate('JSON.stringify(window.__dye.state())'))
    br.close()
