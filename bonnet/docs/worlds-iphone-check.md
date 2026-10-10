# One product, two worlds - what to try on iPhone

Emulated tests (Playwright/CDP) do not prove iPhone behaviour; this list is the real gate.

## Run it

On the Mac: `cd bonnet && npx vite --host`, then on the iPhone (same Wi-Fi, Safari, Low Power Mode off):

- `http://<mac-lan-ip>:5173/bonnet/` (add `?debug` for the overlay: fps, `>33ms`, stall, input to visual ms, state)
- Default world per catalogue: `?set=bonnet` (default) opens **Light**, `?set=mixed` opens **Water**. `?world=light|water` overrides; a click on the Light/Water switch is remembered per catalogue (a `?world=` visit is not remembered). The catalogue links do not carry the world over.
- `?set=mixed` swaps the catalogue (6 very different photos)
- `#moss` opens that product's detail directly

## What changed vs the two prototypes

- One app: Light (slide projector) and Water (still pool) share products, detail page, Back, input rules. The switch is the pill at the top right. The switch is the Phase B signature transition (~1.1 s, below).
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
| 11 | Switch Light -> Water: watch the beam | The wall picture is pulled down along the beam into the pool, a bright impact + shock ring, then a water line rises over the screen; the same product stays centred; no hitch on the tap frame |
| 11b | Switch Water -> Light | The sea calms, glints gather into a column at the product, the water drains downward with a meniscus, the dark room appears and the wall picture focuses in (shutter + focus pull) |
| 11c | Tap the other world while a switch is half way (both directions) | It reverses from where it is (same picture backwards), never restarts, never jumps |
| 11d | Switch 10x in a row | No frame drops beyond the first switch (both worlds already compiled), no black frame |
| 12 | Open from Light, close; open from Water, close | Hero lands without a seam at the hand-off |
| 13 | Scroll the detail past the hero, then x | Short crossfade back |
| 14 | `?set=mixed`: wide, tall, transparent-bottle photos in both worlds | Nothing breaks, frames look intentional |
| 15 | Lock phone mid-drag, return; switch apps | No stuck drag |
| 16 | Settings > Accessibility > Reduce Motion | No WebGL, plain photo, everything still works |
| 17 | 5-10 minutes of use | `>33ms` share stays low, no missing images, no black canvas |

## Phase B: detail page

| # | Try | Good when |
|---|-----|-----------|
| B1 | Detail of a product with 4 photos (moss): drag the hero sideways, slowly, from the first pixel | The photo is under the finger 1:1 (no dead zone), the next photo is attached to its edge; Light: the entering photo is blurred and comes into focus as it arrives, a brief shutter dip when it seats; Water: a glassy refraction band ripples at the seam |
| B2 | Release past 20% of the width / on a flick / short and slow / flick back | Snaps (critically damped, no overshoot) / reverts; a quick reversal reverts |
| B3 | Dots, the arrow buttons next to them, left/right keys | Same slide motion; wraps around with the arrows/keys |
| B4 | Drag the hero **down** (at the top of the page) a little and release | The hero followed the finger and shrank, the world showed behind; it springs back open |
| B5 | Drag the hero down far / flick it down | Releases into the close: Light the lamp dims and the picture returns to the wall; Water it sinks with a splash; same animation as the close button, Esc and Back; no pop at the end |
| B6 | Drag **up** on the hero | Nothing happens (by design: the hero is not a scroll start area) |
| B7 | Swipe up/down on the text below the hero, also starting right under the photo | Native scroll with momentum; **never** starts a close |
| B8 | Scroll a little so the hero is partly off screen, drag on the hero | It scrolls (the hero is a scroll start area again when the page is scrolled); never closes |
| B9 | Open a detail, watch the close button and the arrows/dots arrive | Light: warm glow settling; Water: cool glass coming into focus |

### Gesture rules (detail hero)
- The hero has `touch-action: none` (it is not a scroll start area): horizontal = photo slide, vertical-down = close drag. `[data-scrolled]` (page scrolled > 2 px) switches it back to `pan-y pinch-zoom` and disables the close drag.
- Axis lock after 6 px from the first pixel: |dx| >= |dy| -> slide (only with 2+ photos); dy > 0 -> close drag (only when scrollY <= 2); dy < 0 -> nothing. The photo follows from the first pixel even before the lock.
- The body text area has no gesture code at all. Pointer capture is taken on the hero at pointerdown (nothing clickable inside), nothing is preventDefault()ed, no global listeners except scroll (passive).
- Without WebGL (fallback / reduced motion) the close drag is off (the close button, Esc and Back remain).

## Known gaps to look for

- Real-device frame rates are unmeasured (desktop numbers are in the PR). The switch renders both worlds into FBOs every frame (outgoing layer at 0.75 scale above 1.5 MP): watch for dropped frames on the first 300 ms of the switch.
- Water sim format falls back f32 -> f16 -> packed bytes (`&fmt=u8` forces the last); look for visual differences.
- Idle Light hums at ~30 fps for 10 s after the last touch, then sleeps; Water sleeps right after the ripples die.
