/**
 * Gesture recorder and deterministic replay.
 *
 * A Recording is the raw input ({t, x, y, type} samples, t in ms since pointerdown) plus the decision that was made
 * from it. Because the pipeline (./gesture) is a pure function of its samples, `replay()` feeds the same samples to a
 * fresh pipeline and gets the same events and the same velocity: the decision can be re-run with a different decision
 * function (Phase 6: old rule vs new rule on one recording) without a finger in the loop.
 *
 * The JSON form is versioned (`v`). `parseRecording` rejects anything it does not understand.
 */
import { GesturePipeline, type GestureConfig, type GestureEvent, type PointerKind, type Sample } from './gesture';

export const RECORDING_VERSION = 1;
const MAX_SAMPLES = 1200; // ~10 s at 120 Hz; a longer press is not a gesture we need to study

export interface Recording<D = Record<string, unknown>> {
  v: typeof RECORDING_VERSION;
  /** what was recorded, e.g. 'sheet-pull' */
  kind: string;
  /** context the decision needed (pointer type, slop, sheet size, ...) */
  meta: Record<string, unknown> & { pointerType: PointerKind; slop: number };
  samples: Sample[];
  /** what the decision function said, filled in on release (absent: the gesture was cancelled) */
  decision?: D;
}

export class GestureRecorder<D = Record<string, unknown>> {
  private cur: Recording<D> | null = null;

  /** start a new recording (replaces any unfinished one) */
  begin(kind: string, meta: Recording['meta']) {
    this.cur = { v: RECORDING_VERSION, kind, meta, samples: [] };
  }

  add(s: Sample) {
    const r = this.cur;
    if (r && r.samples.length < MAX_SAMPLES) r.samples.push({ t: s.t, x: s.x, y: s.y, type: s.type });
  }

  discard() {
    this.cur = null;
  }

  /** close the current recording and hand it over */
  finish(decision?: D): Recording<D> | null {
    const r = this.cur;
    this.cur = null;
    if (!r || r.samples.length < 2) return null;
    if (decision) r.decision = decision;
    return r;
  }
}

export const toJSON = (r: Recording) => JSON.stringify(r);

export function parseRecording(json: string): Recording {
  const o = JSON.parse(json) as Recording;
  if (!o || o.v !== RECORDING_VERSION) throw new Error(`unsupported recording version: ${o?.v}`);
  if (typeof o.kind !== 'string' || !Array.isArray(o.samples) || !o.meta) throw new Error('malformed recording');
  for (const s of o.samples) {
    if (typeof s.t !== 'number' || typeof s.x !== 'number' || typeof s.y !== 'number' || !['down', 'move', 'up', 'cancel'].includes(s.type)) {
      throw new Error('malformed sample');
    }
  }
  return o;
}

/**
 * Drive a fresh pipeline with the recorded samples, synchronously and in order.
 * Events go to `handler` and are also returned. `claim` defaults to "yes": recordings only exist for claimed gestures.
 */
export function replay(rec: Pick<Recording<unknown>, 'meta' | 'samples'>, handler?: (e: GestureEvent) => void, cfg: Partial<GestureConfig> = {}): GestureEvent[] {
  const out: GestureEvent[] = [];
  const pipe = new GesturePipeline({ slop: rec.meta.slop, claim: () => true, ...cfg }, rec.meta.pointerType, (e) => {
    out.push(e);
    handler?.(e);
  });
  for (const s of rec.samples) pipe.feed(s);
  return out;
}
