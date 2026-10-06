import type { Recording } from '../motion/recorder';
import type { CloseDecision } from './decision';

export type SheetState = 'idle' | 'opening' | 'open' | 'dragging' | 'closing';

/** what the decision function saw and said for one pull, stored on the recording */
export interface PullDecision extends CloseDecision {
  distance: number;
  velocity: number;
  sheetHeight: number;
  /** velocity samples inside the estimator window */
  samples: number;
  /** the browser took the gesture over (pointercancel) before release: no decision was made */
  cancelled?: boolean;
}

export interface PullMeta extends Record<string, unknown> {
  pointerType: 'mouse' | 'touch' | 'pen';
  slop: number;
  sheetHeight: number;
  sheetRect: { x: number; y: number; w: number; h: number };
}

export type PullRecording = Recording<PullDecision> & { meta: PullMeta };

/** the live card deck, as Inspect sees it (set on bridge by the cards chunk) */
export interface CardsHandle {
  state(): SheetState;
  /** a sheet is showing or on its way (anything but idle/closing) */
  isOpen(): boolean;
  recording(): PullRecording | null;
  /** where the Inspect panel mounts, and the SVG the trajectory is drawn on */
  dock: HTMLElement;
  overlay: SVGSVGElement;
  /** 'state' on every state change, 'recording' when a new pull was recorded */
  on(fn: (e: 'state' | 'recording') => void): () => void;
  /** the last transitions, newest last (for the developer details and for tests) */
  log(): string[];
}
