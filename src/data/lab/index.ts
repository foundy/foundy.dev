// Build-time access to the canned recordings (written by scripts/lab/make-recordings.mjs). Only pages and the
// endpoint import this; the browser fetches /lab/data/<id>.json on demand so the recordings stay out of the JS chunk.
import type { Recording } from '../../lib/motion/recorder';
import type { DecisionId } from '../../lib/lab/rules';
import releaseRule from './release-rule.json';
import closeOrder from './close-order.json';
import tapVsDrag from './tap-vs-drag.json';
import snapBack from './snap-back.json';

export interface CannedRecording {
  id: string;
  title: string;
  note: string;
  recording: Recording;
}
export interface CannedSet {
  id: DecisionId;
  recordings: CannedRecording[];
}

export const canned = {
  'release-rule': releaseRule,
  'close-order': closeOrder,
  'tap-vs-drag': tapVsDrag,
  'snap-back': snapBack,
} as unknown as Record<DecisionId, CannedSet>;
