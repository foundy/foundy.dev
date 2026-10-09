# M0a iPhone checklist (side by side vs the original prototype)

Gate from the plan: **M0a passes only if it feels at least as good as the original on the same iPhone.** Emulated
tests (Playwright/CDP) do not prove iPhone behaviour; this checklist is the real gate.

## Setup

- A: original prototype, `https://foundy.dev/prototypes/card-deck-v20.0.15-product-assets-no-flash.html`
- B: M0a on the LAN dev server. On the Mac: `cd bonnet && npx vite --host`, then open the printed
  `http://<mac-lan-ip>:5173/bonnet/?debug` in Safari on the iPhone (same Wi-Fi). Also run it once without
  `?debug` (the overlay costs a little).
- Same iPhone, same iOS, Safari (not in-app browser), Low Power Mode off, both pages freshly loaded. Open each in its own tab.
- Debug overlay (`?debug`): top-left, tap `dbg` to hide/show, `reset` clears counters. It shows fps, share of frames
  over 33 ms, longest stall, input to first visual change (ms, last/avg/max), the recent pointer/touch/scroll/click log and
  the state (`page`, `c`olor, `a`ngle, `dye from>to p origin`).
- Record the screen (Control Center) for each scenario below, A then B, and attach the recordings to the PR.
  For first-response comparison also record with the second iPhone/camera at 240 fps if available.

Color order in B: Ivory (disabled placeholder), Moss, Poppy, Sky, Butter. Ivory is intentionally not selectable in M0a.

## Scenarios

For each row: do it 5 times on A, then 5 times on B. Mark pass/fail for B.

| # | Scenario | How | B passes when |
|---|----------|-----|---------------|
| 1 | First response | Put a finger on the photo and move it very slowly 10-20 px sideways | The next color starts to appear under the finger from the first pixel: no dead zone, no jump when it "catches". Overlay `input->visual` for `drag` is typically below 40 ms; A is not visibly more immediate. |
| 2 | Slow drag and release | Drag 30% of the width, hold 1 s, release | It follows 1:1 while held and returns smoothly; no color change. |
| 3 | Past half, slow | Drag 60% slowly, release | Commits to exactly one next color. |
| 4 | Flick | Short quick flick (about 1 cm, under 100 ms) | Commits to exactly one color (never two); settles without overshoot, finishes within about 250 ms. A flick is never ignored. |
| 5 | Direction reversal | Drag left 40%, quickly flick right and release | Goes back, no commit. |
| 6 | Consecutive buttons | Tap next 4 times as fast as possible, then prev 4 times | Every tap registers (no dead taps, no queued animation catching up afterwards); the color lands settled on the last one. |
| 7 | Buttons right after a swipe | Swipe, then tap next at once (aim for under 100 ms), repeat for rail balls | The tap always works. Zero swallowed taps (check overlay log: a `click` follows every tap). |
| 8 | Diagonal micro move then tap | Tap a button while sliding the finger 3-5 px diagonally; same on the photo | Button activates; photo tap opens the detail. |
| 9 | Rail jump | Tap the far-right ball from Moss | Jumps straight there (no passing colors), about 220 ms. |
| 10 | Open detail | Tap the photo | Detail appears in 300 ms or less, heading is focused, URL becomes `#<color>`. |
| 11 | Scroll from the hero | In detail, put the finger on the **hero photo** and swipe up | The page scrolls immediately, including during the opening transition (try swiping instantly after tapping). No rubber banding glitches, no close, no stuck state. |
| 12 | Scroll from the body | Swipe up/down starting on text, on the swatches, on the dots | Scrolls normally with inertia, address bar collapses/expands naturally. Pull down at the top only rubber-bands, it never closes. |
| 13 | Hero angle swipe | Swipe horizontally on the hero | Changes the angle (crossfade). A vertical swipe on the same hero still scrolls. Diagonal swipes go to whichever axis dominates, never both. |
| 14 | Taps after hero swipe | Tap a swatch/dot right after an angle swipe | The tap works. |
| 15 | Swatch | Tap swatches | Hero crossfades (about 200 ms), page tone changes, hash updates. |
| 16 | Close | Close button; then open again and use Safari Back (swipe from the left edge or the button) | Deck returns instantly (no scroll-to-top first), on the color last chosen in the detail. |
| 17 | Back/Forward | Open, Back, Forward, Back | Alternates deck / detail correctly, no duplicated history entries. |
| 18 | Deep link | Open `.../bonnet/#sky` from a fresh tab | Detail shows immediately without animation; close goes to the deck. |
| 19 | Scroll then close | Scroll to the bottom, tap close | Deck appears at once. |
| 20 | Inertia then act | Start inertial scroll, tap a swatch while it still glides | The tap lands (or stops the scroll, as in any Safari page); nothing breaks afterwards. |
| 21 | Rotation, address bar, pinch | Rotate, pull the address bar, pinch-zoom both screens | No layout break; pinch-zoom is allowed everywhere. |
| 22 | Lock / background | Lock the phone mid-drag and unlock; switch apps and return | No stuck drag (next touch works), no frozen state. |
| 23 | Soak | Use it for 5-10 minutes | Overlay `>33ms` share stays low and `stall` does not grow; no missing images. |

## What "pass" means overall

- B is **at least as responsive as A in scenarios 1, 4, 6, 7** and clearly better in 11-12 (scroll) and 16-17 (Back).
- Zero dead taps and zero unscrollable detail states in all repeats.
- No scenario where B needs a second attempt that A does not.
- Write the numbers from the overlay (input to visual ms, `>33ms`, `stall`) for scenarios 1, 4, 6 next to each recording.
- Any single fail: do not start M1; note scenario number, device/iOS, and attach the recording.
