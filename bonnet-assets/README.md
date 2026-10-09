# bonnet-assets — M0b asset feasibility (front angle only)

Proof that the "Live Dye" asset pipeline works for one angle: mask, synthesized ivory, stitch cell map, static demo.
Everything here is independent of `bonnet/`. Inputs: `public/prototypes/assets/bonnet-{green,red,skyblue,yellow}-front.webp`
(625x625, pixel-aligned). The beige/"ivory" originals (1122x1402, a different generated photo) are **not used**.

## Setup

```bash
cd bonnet-assets
python3.11 -m venv .venv                      # python >= 3.9 works
.venv/bin/pip install numpy opencv-python-headless pillow scikit-image scipy playwright   # playwright only for QA/screenshots
```

## Pipeline (run in order; each step is deterministic)

```bash
.venv/bin/python scripts/01_align_check.py      # phase-corr / ECC residuals between the 4 photos  -> out/alignment-report.json
.venv/bin/python scripts/02_mask.py             # bonnet+tie mask (+ overrides-front.json if present) -> out/mask-front*.png
.venv/bin/python scripts/02b_mask_per_colour.py # per-colour boundary-corrected masks -> out/mask-<colour>-front.png
.venv/bin/python scripts/01b_align_global.py    # global masked ECC (needs the mask) -> adds to alignment-report.json
.venv/bin/python scripts/03_ivory.py yellow     # synthesized ivory -> out/ivory-front-yellow.png
.venv/bin/python scripts/04_cells.py            # stitch cell map -> out/cells-front.{png,json}, cells-front-vis.png
.venv/bin/python scripts/05_publish.py          # copy finals to assets/ (committed), ivory as LOSSLESS webp, verify face identity
```

Optional 2x experiment (Real-ESRGAN, ncnn/Vulkan binary, took ~13 s for all 4 on an M-series Mac):

```bash
.venv/bin/python scripts/06a_upscale_prep.py    # dumps the 4 photos to /tmp/resr/in
# download https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip
# into its own EMPTY directory (e.g. /tmp/resr/x), unzip, then (identical settings for every colour):
mkdir -p /tmp/resr/out && /tmp/resr/x/realesrgan-ncnn-vulkan -i /tmp/resr/in -o /tmp/resr/out -n realesrgan-x4plus -s 4
.venv/bin/python scripts/06b_upscale_compare.py # x4 -> Lanczos to 2x; review/upscale-{stitch,face}.webp + metrics
```

Demo + QA (static server must run from `bonnet-assets/` so `../assets/` resolves):

```bash
python3 -m http.server 8765 --bind 0.0.0.0      # leave running; Ctrl-C to stop
# desktop:  http://localhost:8765/demo/index.html
# iPhone (same Wi-Fi):  http://<mac-LAN-ip>:8765/demo/index.html     (ipconfig getifaddr en0)
.venv/bin/python scripts/07_face_qa.py          # renders the real shader at 625px, p=.25/.5/.75, diff vs base -> review/
.venv/bin/python scripts/08_demo_screenshot.py  # mobile 390x844 mid-drag screenshots -> review/demo-mobile-*.webp
```

## Choices

* **SAM2 skipped.** The 4 colourways differ *only* in bonnet colour, so the per-pixel chroma spread across colours is
  strongly bimodal (background/face/clothes ~3, bonnet ~90; Otsu 50). A half-max threshold (40) already gives the true edge,
  so no learned segmenter (heavy install, GPU-ish) is needed. Manual fixes are supported through
  `overrides-front.json` (`{"add":[[[x,y],...]], "remove":[...]}` polygons) and/or a painted `overrides-front.png`
  (white = add, black = remove) — none was needed for the front, the files are intentionally absent.
* **Hole-fill is size-limited** (<= 220 px): lace holes are filled; the face opening and the two tie-bow loops (which show
  neck/clothes) stay open. A naive `binary_fill_holes` would have swallowed the face.
* **Adaptive feather**: signed distance from the hard edge, radius = 0.75 x local thickness (clamped 1.5..6 px), smoothstep.
  Thin ties get ~1.5 px, the broad dome 6 px.
* **Fixed base photo.** Outside the mask the demo *always* samples the yellow photo (identical to ivory there). The four
  photos carry slightly different global grades (red's face is pinker: mean |dY| about 10 vs yellow), so "base = current colour"
  would make the face tone jump on commit. Inside the mask each cell shows photo A or B.
* **Ivory** = yellow photo, LAB recolour inside the mask only: L remapped to median 90 with gain 1.05 and a soft highlight knee,
  chroma pulled to a*=1.2, b*=9 with 25 % of the original chroma texture kept (+ a little extra warmth in shadows).
  Sky was tried too and left a blue fringe on the feather; yellow is the more natural base.
* **Cells**: rows run parallel to the scalloped brim (row = floor(distance-to-face-opening / 13 px)), each row split into angular
  sectors (angle about the face-opening centroid) with equal pixel counts, ~13 px cells; rows are staggered like brick/crochet.
  Ties continue the row index along geodesic distance from the crown. Cells are split by connected components (the two
  bow loops share keys) and fragments < 40 px are merged. Crown point (317, 96) = centre of the top shell fan (used for ties only).
  `B` holds the 13 px row index; one visible scallop/shell row is about 3 of these rows (~35-40 px).

## Output formats

| file | content |
|---|---|
| `assets/mask-front.png` | 8-bit, adaptive-feathered alpha (0 = hard outside) |
| `assets/mask-front-hard.png` | binary (255) |
| `assets/mask-<colour>-front.png` | per-colour boundary-corrected feathered masks (see report; not used by the demo) |
| `assets/cells-front.png` | RGBA lossless: R = id low byte, G = id high byte, B = row index, A = 255 where an id exists (= feather support). Sample NEAREST, no premultiply, no colour conversion |
| `assets/cells-front.json` | `cells[]` {id, cx, cy, area, row, jitter} + params/stats. Jitter is the per-cell threshold offset (0..1, x10 px in the demo) |
| `assets/ivory-front.webp` | synthesized ivory, lossless |
| `assets/cells-front-vis.png` | false-colour cells for review (2x) |

Demo shader: `threshold(cell) = |centroid - origin| + jitter*10px`; a cell flips when `R(p) > threshold`
(6 px cross-fade), `R(p) = -2 + p*(Rmax+4)`, 2 CSS px seam ring and a short per-cell brightness pop at the front,
both multiplied by the mask so nothing outside it can change.
