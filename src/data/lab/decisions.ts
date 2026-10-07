// Lab copy: the four decisions of the card study, each compared live on /lab.
// Facts come from docs/card-study-notes.md (legacy prototypes read at tag legacy-v1). Anything inferred rather than
// read from the legacy files is listed in `mock` and rendered with a "mock" marker.
import type { DecisionId } from '../../lib/lab/rules';

export interface LabDecision {
  id: DecisionId;
  n: string;
  title: string;
  versions: string;
  problem: string;
  change: string;
  why: string;
  /** side captions */
  oldName: string;
  oldTag: string;
  newName: string;
  newTag: string;
  /** what to try in "your turn" */
  tryIt: string;
  /** specifics that are inferred, not read from the legacy code */
  mock: string[];
}

export const decisions: LabDecision[] = [
  {
    id: 'release-rule',
    n: '01',
    title: 'Close on where the pull is going, not where it is',
    versions: 'v1 → v12 → now',
    problem:
      'The first versions looked at distance only. A short fast flick was cancelled, and a long pull that you were already taking back was closed. The case study counted 31% missed closes.',
    change:
      'At release the sheet projects the pull forward: distance + release velocity × τ. If that lands past 35% of the sheet height, it closes. A pull shorter than 16 px never counts.',
    why: 'People judge intent by speed first and distance second. The projection is one multiplication, cheap enough to show and tune.',
    oldName: 'Old rule',
    oldTag: 'v12 · distance only',
    newName: 'New rule',
    newTag: 'now · projected',
    tryIt: 'Flick the sheet down quickly, then try a long pull that you swing back up.',
    mock: ['38% as the old line (v12)'],
  },
  {
    id: 'close-order',
    n: '02',
    title: 'Close the picture first, let the text go',
    versions: 'v18.0.4 → v18.0.5',
    problem: 'Closing shrank the whole sheet as one piece. The text was squashed on the way down and the picture reached its card late.',
    change: 'The picture flies straight to the card on its own spring. The text is already gone by the 40% mark, so nothing readable is ever distorted.',
    why: 'The picture is the thing that must be recognised on arrival; the text only has to get out of the way.',
    oldName: 'Old choreography',
    oldTag: 'v18.0.4 · all at once',
    newName: 'New choreography',
    newTag: 'v18.0.5+ · hero first',
    tryIt: 'Pull the sheet down far enough to close it, and watch the text and the picture separately.',
    mock: ['old spring stiffness 170 (slower than today’s 300)'],
  },
  {
    id: 'tap-vs-drag',
    n: '03',
    title: 'A drag is not a tap, and an echo is not a tap',
    versions: 'v20.0.5 → v20.0.7',
    problem:
      'Pulling the sheet down from a link lifted the finger over that link and the browser fired a click. And the echo of the tap that opened the sheet could land on the backdrop and close it right away.',
    change:
      'A press that moves past a slop (8 px mouse, 10 px touch) is a drag, and the click that follows it is swallowed once. A backdrop tap in the first 260 ms after opening is ignored.',
    why: 'Taps must still work with a shaky finger, so the slop is small. The grace window is long enough for a ghost click and short enough that nobody notices it.',
    oldName: 'Old guard',
    oldTag: 'v20.0.5 · none',
    newName: 'New guard',
    newTag: 'v20.0.7+ · slop + grace',
    tryIt: 'Press on “Read more” and pull down. Then tap it without moving. Then tap the dimmed strip above the sheet.',
    mock: ['“ghost click arrives 120 ms after opening” (typical, not measured)'],
  },
  {
    id: 'snap-back',
    n: '04',
    title: 'Snap back with the speed your hand had',
    versions: 'v20.0.x → this site',
    problem:
      'When a pull was not enough to close, the sheet returned with a fixed ease-out that started from rest. A hand that was moving still saw the sheet lurch.',
    change: 'The return is a spring that starts at the release position with the release velocity. A new press can grab it mid-flight with no jump.',
    why: 'Continuing the motion you just made reads as the sheet being physical; restarting it reads as an animation playing.',
    oldName: 'Old return',
    oldTag: 'legacy · fixed ease',
    newName: 'New return',
    newTag: 'now · velocity spring',
    tryIt: 'Pull a little, then let go slowly, then flick back up as you let go. Stay under the close line.',
    mock: ['old duration 220 ms (170–220 ms were used for reveals)'],
  },
];

export const decisionById = Object.fromEntries(decisions.map((d) => [d.id, d])) as Record<DecisionId, LabDecision>;

/** the one tunable: why the shipped value is what it is */
export const tauNote = {
  min: 0,
  max: 200,
  step: 5,
  why: 'On these four recordings the right answer holds for roughly 55 to 125 ms. Below that, the flick is missed again; above it, the twitch starts to close the sheet. 80 ms is about five frames at 60 Hz, inside the window and a little on the cautious side. It is still to be tuned by hand on a phone (mock).',
};
