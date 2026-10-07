---
title: Card Interaction Study
summary: One card, opened and closed by hand, revised across more than forty iterations from v1 to v20.
kicker: A card deck that expands to a hero and pulls down to close.
order: 2
year: 2026
role: Interaction design and engineering
stack: [TypeScript, Pointer Events, CSS, Web Animations API]
mock: true
facts:
  - { label: 'Iterations', value: '40+ across v1 to v20' }
  - { label: 'Close rule', value: 'Projected travel past 35% of the sheet' }
  - { label: 'Motion', value: 'Time-based springs, one owner per property' }
preview:
  - 'A card that grows into a sheet and pulls down to close. Nothing about it is new; getting the decision at the moment of release right is the whole study.'
  - 'Pull this sheet down from its top edge, slowly and then in a quick flick, and open Inspect: it replays your gesture and shows why it closed, or why it did not.'
  - 'Close needs the sheet scrolled to the top, so a pull never fights reading. Escape, the close button, a tap outside and the browser Back button all close it too, and focus returns to the card.'
---

## Problem

The brief I gave myself was small: a deck of cards, tap one and it grows into a full hero, pull it down to put it back. Every phone has a version of this gesture, and almost every web version of it feels slightly wrong. It either snaps shut at the wrong moment, lags behind the finger, or jumps when the page underneath moves.

The interesting question was not how to animate it. It was how to decide, at the instant the finger lifts, whether the person meant to close the card. That decision is invisible when it is right and infuriating when it is wrong, which makes it a good thing to study.

## Choices and alternatives

I kept a numbered log of every change, v1 to v20, with roughly two attempts per number that did not survive. The choices that mattered:

**Decide on velocity and distance together.** The first version closed the card when the pull passed a fixed distance. It cancelled fast, short flicks and closed slow, accidental drags. Adding release velocity as a second trigger fixed both. The rule that survived is: close if velocity exceeds 1.2 px/ms or if travel exceeds 38 percent of the card height.

**Resistance beats a wall.** A hard stop at the threshold felt broken, and free tracking felt weightless. Following the finger at a decaying ratio, down to about 0.35, communicates that the gesture is registered and has a limit.

**One measurement, taken at release.** Early versions re-read the card rectangle on every frame of the close animation. If the page scrolled or resized mid-gesture the card jumped by a frame. The fix was to freeze the rectangle at release and animate from it to the origin slot, so the animation depends only on where it started.

**Time, not frames.** Springs stepped once per frame behaved differently on 60 Hz and 120 Hz displays, and a dropped frame became a visible stall. The final version integrates against real elapsed time, clamped, with small fixed sub-steps.

**CSS where it is enough, code where it is not.** Opening is a plain transition. Only the pull-down, which has to follow a finger and hand over to a spring, runs in a gesture loop. Mixing the two on one transform was the source of three separate bugs, so each property has exactly one owner.

## What it does

A tap or Enter on a card expands it into the hero layout. Pulling the hero down follows the finger with resistance past the threshold. On release, the close decision is made from velocity and distance, and the card either springs back open or flies to its slot in the deck. Escape and a visible close button do the same without a gesture.

<figure class="placeholder" aria-label="Where to try the card study live">
  <div class="placeholder__frame">
    <span class="label">Live demo (mock copy)</span>
    <p>The real thing is on the <a href="/#work/card-study">home page</a>: open the card, pull the sheet down, then switch on Inspect to replay your own gesture and see the close decision. Replaying one recording against the v12 and v20 rules arrives with the Lab.</p>
  </div>
  <figcaption>Fig. 1. The preview sheet with Inspect, on the home page. Copy around it is still mock.</figcaption>
</figure>

### How the versions moved

| Version | Change | Effect (mock) |
| --- | --- | --- |
| v1 | Close on distance only | 31% of intended closes missed |
| v6 | Rubber-band resistance | Release felt "understood" |
| v12 | Add release velocity | Missed closes down to 4% |
| v18 | Freeze the close rect | Mid-gesture jumps eliminated |
| v20 | Time-based spring | Same feel at 60 and 120 Hz |

## Outcome and limits

The final rule is two numbers and a spring, and it feels unremarkable, which is the goal. In a small test with eight people using their own phones, intended closes that were missed fell from roughly a third to about one in twenty-five, and nobody mentioned the gesture unprompted.

What it does not solve:

- The thresholds are tuned for thumbs on phones. On a trackpad the same numbers feel twitchy, and I have not settled on a separate pointer profile.
- Pulling down only works from the top of the scroll area. Starting a pull while scrolled requires a separate edge handoff I have deliberately not attempted yet.
- Eight testers is a sanity check, not a study, and the figures above are placeholders until the final write-up.

The four decisions that carried the most weight are collected on the [Lab](/lab) page, with room for a side-by-side replay.
