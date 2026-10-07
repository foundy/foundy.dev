/** Copy shared by the static Lab page (build time) and the live controls (src/lib/lab/section.ts), so the placeholder
 *  that is server-rendered and the real controls that replace it have the same text and therefore the same height. */
export const HINT_LEAD = 'Your turn. ';
export const hintBody = (tryIt: string) => `Drag on either phone to record your own gesture; both rules replay it. ${tryIt} `;
// one unit everywhere: the phone is a 390 × 720 px screen drawn smaller, so a drag on it is scaled up to that size
export const UNIT_NOTE =
  'Distances and speeds are in phone px: the little phone stands for a 390 × 720 px screen, so your drag is scaled up to that size before it is measured.';
