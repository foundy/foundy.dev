/** Deck layout: every card's look is a smooth function of d = index - position (no discrete states). */
import { smoothstep } from './motion/math';

export interface CardLook {
  x: number;
  y: number;
  rot: number;
  rotY: number;
  scale: number;
  opacity: number;
  /** 0..1 dark overlay (dimming instead of a per-frame CSS filter) */
  shade: number;
  /** 0..1 strength of the card's drop shadow */
  shadow: number;
  /** image parallax, as a fraction of the card width */
  px: number;
  /** image overscan scale that hides the parallax edges */
  pscale: number;
  z: number;
}

const A = 1.7; // reach of the fan; x(d) = spacing * A * tanh(d / A) has slope `spacing` at 0 so the front card tracks the finger 1:1

/**
 * @param d       index - position (negative = left of the front)
 * @param spacing px between neighbours; the finger moves the deck `spacing` px per card
 * @param p       open progress 0..1 (siblings recede and dim as the detail opens)
 * @param reduced prefers-reduced-motion: stack in place and crossfade instead
 */
export function cardLook(d: number, spacing: number, p: number, reduced: boolean): CardLook {
  const ad = Math.abs(d);
  const sgn = d < 0 ? -1 : 1;
  const recede = smoothstep(0, 0.6, p);
  if (reduced) {
    return { x: 0, y: 0, rot: 0, rotY: 0, scale: 1, opacity: Math.max(0, 1 - ad) * (1 - recede), shade: 0, shadow: 1, px: 0, pscale: 1, z: 1000 - Math.round(ad * 100) };
  }
  const x = spacing * A * Math.tanh(d / A) + sgn * p * spacing * 1.1;
  const y = 22 * Math.tanh(ad * 0.8) + p * 18;
  const rot = 7.5 * Math.tanh(d / 1.2);
  const rotY = -11 * Math.tanh(d);
  const scale = (1 - 0.13 * (1 - Math.exp(-1.3 * ad))) * (1 - 0.06 * p);
  const fade = ad <= 2 ? 1 : Math.max(0, 3 - ad);
  return {
    x,
    y,
    rot,
    rotY,
    scale,
    opacity: fade * (1 - smoothstep(0.05, 0.65, p)),
    shade: Math.min(0.5, 0.2 * (1 - Math.exp(-1.6 * ad)) + 0.3 * p),
    shadow: 1 - 0.55 * Math.min(1, ad),
    px: -0.036 * Math.tanh(d),
    pscale: 1 + 0.08 * Math.min(1, ad),
    z: 1000 - Math.round(ad * 100),
  };
}
