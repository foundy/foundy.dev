# One product, two worlds - what to try on iPhone

Emulated tests (Playwright/CDP) do not prove iPhone behaviour; this list is the real gate.

## Run it

On the Mac: `cd bonnet && npx vite --host`, then on the iPhone (same Wi-Fi, Safari, Low Power Mode off):

- `http://<mac-lan-ip>:5173/bonnet/` (add `?debug` for the overlay: fps, `>33ms`, stall, input to visual ms, state)
- `?world=light` / `?world=water` pick the world (also remembered), `?set=mixed` swaps the catalogue (6 very different photos)
- `#moss` opens that product's detail directly

## What changed vs the two prototypes

- One app: Light (slide projector) and Water (still pool) share products, detail page, Back, input rules. The switch is the pill at the top right. A switch is a 600 ms crossfade at the same product (Phase B replaces it with the signature transition).
- Water: product **sticks to the finger 1:1 from the first pixel**, tilts a little, leaves a wake; the next product rises in as you drag. Release: velocity-projected decision, critically damped spring (no overshoot). Prev/next buttons (bottom corners) run the same spring.
- Light: the tray spin follows the finger 1:1 too (the slide under the finger stays under the finger; flings still carry several slides). Rear half of the tray is darker/simpler; detail text waits until the lamp is out.

## Checklist (do each 3-5 times)

| # | Try | Good when |
|---|-----|-----------|
| 1 | Water: put a finger on the product and move 5-10 px slowly | It moves with the finger from the first pixel, no dead zone, no catch-up jump |
| 2 | Water: drag 40%, hold, release | It follows while held, springs back, no overshoot |
| 3 | Water: drag 60% slowly, release | Commits exactly one product, lands with no wobble |
| 4 | Water: short fast flick | Always moves one product, never two |
| 5 | Water: drag left, quickly flick back right, release | Stays on the same product |
| 6 | Light: same 1-5 | The slide under the finger stays under the finger; a hard fling travels further |
| 7 | Buttons: tap next 4x fast, prev 4x fast (both worlds) | Every tap registers, lands on the last target, same motion as a swipe |
| 8 | Swipe, then tap next within 100 ms | Always works (no swallowed click) |
| 9 | Tap the product / the light | Detail opens; swipe up immediately, during the opening | It scrolls at once |
| 10 | Detail: scroll, then x / Safari Back / edge swipe | Returns to browse on the same product in the same world |
| 11 | Switch Light -> Water -> Light (also mid-way) | Same product, smooth, no hitch on the tap frame |
| 12 | Open from Light, close; open from Water, close | Hero lands without a seam at the hand-off |
| 13 | Scroll the detail past the hero, then x | Short crossfade back |
| 14 | `?set=mixed`: wide, tall, transparent-bottle photos in both worlds | Nothing breaks, frames look intentional |
| 15 | Lock phone mid-drag, return; switch apps | No stuck drag |
| 16 | Settings > Accessibility > Reduce Motion | No WebGL, plain photo, everything still works |
| 17 | 5-10 minutes of use | `>33ms` share stays low, no missing images, no black canvas |

## Known gaps to look for

- Real-device frame rates are unmeasured (desktop numbers are in the PR).
- Water sim format falls back f32 -> f16 -> packed bytes (`&fmt=u8` forces the last); look for visual differences.
- Idle Light hums at ~30 fps for 10 s after the last touch, then sleeps; Water sleeps right after the ripples die.
