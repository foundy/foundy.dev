# Sketch: comparing the three deck <-> detail transitions on a real iPhone

Three transitions share one deck, one input layer (M0a rules unchanged) and one progress model, so only the
transition differs. Pick by feel on the phone; emulators and headless GPUs do not tell you this.

## Setup

On the Mac: `cd bonnet && npx vite --host`, then open on the iPhone (same Wi-Fi, Safari, Low Power Mode off):

| What | URL |
|------|-----|
| lift  / bonnet | `http://<mac-ip>:5173/bonnet/?t=lift&set=bonnet&debug` |
| optic / bonnet | `http://<mac-ip>:5173/bonnet/?t=optic&set=bonnet&debug` |
| tunnel / bonnet | `http://<mac-ip>:5173/bonnet/?t=tunnel&set=bonnet&debug` |
| lift  / mixed | `http://<mac-ip>:5173/bonnet/?t=lift&set=mixed&debug` |
| optic / mixed | `http://<mac-ip>:5173/bonnet/?t=optic&set=mixed&debug` |
| tunnel / mixed | `http://<mac-ip>:5173/bonnet/?t=tunnel&set=mixed&debug` |

The segmented switchers at the bottom of the deck change the transition live (`lift | optic | tunnel`) and reload
into the other catalogue (`bonnet | mixed`). Drop `&debug` for the real-feel runs (the overlay costs a little).
`?nogl` forces the DOM-only (M0a) path for A/B comparison. Turning on iOS "Reduce Motion" also gives the DOM path.

`mixed` is the stress set: person on model (tall), clear glass bottle on near-white (padding blends with the photo),
text-heavy labels (any blur or warp shows), flat-lay on white, 16:9 wide and 9:16 tall (both letterboxed in the
uniform 4:5 card).

Debug overlay (`?debug`): first line = transition, GL mode (`deck` GL draws the deck, `run` transition, `detail` DOM),
`p` and its velocity; then GL frame p50/p95, share over 33 ms, longest stall (frames inside an animation run only),
texture count and memory estimate, the GPU renderer string, plus the M0a lines (input to first visual, event log).

## What to look at (do each for all three, both catalogues)

1. **First impression** (open and close 5 times, no overlay). Which one do you want to see again?
2. **Premium feel**: does the transition read as one material event (card -> page) or as an effect laid over a cut?
   Lift = liquid + ink; optic = light and glass at the card border; tunnel = depth and perspective.
3. **Face / product legibility mid-motion**: bonnet face and the label shelf at about 30-60 % of the motion.
   The centre 55 % of every photo must stay unwarped; look for any stretch of the face, text or the glass bottle.
4. **Interruptibility** (the key test): open, then tap the close button / swipe Back at roughly 10 %, 30 %, 60 % and
   90 % of the motion; also tap the card again during a close. It must always reverse from where it is, with no jump,
   no restart and no dead tap. Also tap next/prev or start a swipe right after tapping close: the close is cut short
   and the input is honoured.
5. **Hand-off pop**: at the very end of the open, does anything change (colour, sharpness, 1 px shift, the shadow,
   a flash)? Watch the hero and the page background. Repeat for the close start (hero -> GL).
6. **Scroll right after opening**: tap the card and immediately swipe up from the hero. The page must scroll at once
   while the animation is still running; the card should follow the hero as it scrolls. Then scroll down 300 px,
   tap close: the card should leave from the scrolled hero position (or fade-scale when the hero is off-screen).
7. **Deck feel**: drag 1:1 from the first pixel, tilt (+-10 deg), the broad specular band, the soft depth of the
   two cards behind, flick, buttons straight after a swipe (all M0a checklist rows 1-9 still apply).
8. **Heat after 5 minutes**: open/close in a loop for 5 min (and idle in the deck for 1 min). Note the temperature,
   the overlay `>33ms` share and `stall`. The GL layer should sleep when nothing moves: the overlay frame counters
   stop growing while idle.

## Notes

- Numbers worth writing down per transition: p50/p95 frame time during open/close, `>33ms`, `stall`, input to first
  visual for the card tap (`button`).
- The back-card pop when you drag toward the *previous* product and when it lands is known (see PR notes).
- Source: `src/gl/transitions/{lift,optic,tunnel}.ts` implement one interface (`Transition`); to keep one, delete the
  other two files and their entries in `src/gl/engine.ts` (`TRANSITIONS`).
