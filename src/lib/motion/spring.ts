/**
 * Time-based damped spring (framework-free). The step is the closed-form solution of
 *   m x'' = -k (x - target) - c x'
 * so it is exact for any dt (no integrator drift, no stiffness-vs-frame-rate instability). The only guard is a dt clamp,
 * so a long stall (hidden tab, GC pause) advances the spring by at most MAX_DT_MS instead of teleporting it.
 *
 * Units: value in whatever you animate, time in ms at the API (`step(dtMs)`), velocity in value/second.
 * Retargeting mid-flight keeps the current value AND velocity, so a reversal bends the motion instead of restarting it.
 */
export interface SpringConfig {
  /** k, default 300 */
  stiffness: number;
  /** c, default 30 (damping ratio about 0.87 with mass 1) */
  damping: number;
  /** m, default 1 */
  mass: number;
  /** |x - target| below this counts as at rest (default 0.0005) */
  restDelta: number;
  /** |velocity| (units/s) below this counts as at rest (default 0.01) */
  restSpeed: number;
}

export const MAX_DT_MS = 32;

/** Convenience: build a config from stiffness and a damping ratio (1 = critical, < 1 overshoots). */
export function springFromRatio(stiffness: number, ratio: number, mass = 1): Partial<SpringConfig> {
  return { stiffness, mass, damping: 2 * ratio * Math.sqrt(stiffness * mass) };
}

export class Spring {
  value: number;
  velocity = 0;
  target: number;
  settled = true;
  cfg: SpringConfig;

  constructor(value = 0, cfg: Partial<SpringConfig> = {}) {
    this.value = this.target = value;
    this.cfg = { stiffness: 300, damping: 30, mass: 1, restDelta: 0.0005, restSpeed: 0.01, ...cfg };
  }

  /** jump to a value (optionally with a velocity, units/s) and keep aiming at the current target */
  set(value: number, velocity = 0) {
    this.value = value;
    this.velocity = velocity;
    this.settled = false;
    this.check();
  }

  /** aim somewhere else without touching value or velocity */
  retarget(target: number, cfg?: Partial<SpringConfig>) {
    if (cfg) this.cfg = { ...this.cfg, ...cfg };
    this.target = target;
    this.settled = false;
    this.check();
  }

  /** stop right here */
  freeze() {
    this.target = this.value;
    this.velocity = 0;
    this.settled = true;
  }

  /** snap to the target */
  finish() {
    this.value = this.target;
    this.velocity = 0;
    this.settled = true;
  }

  private check() {
    const { restDelta, restSpeed } = this.cfg;
    if (Math.abs(this.value - this.target) <= restDelta && Math.abs(this.velocity) <= restSpeed) this.finish();
  }

  /** advance by dtMs (clamped). Returns the new value. */
  step(dtMs: number): number {
    if (this.settled) return this.value;
    const t = Math.min(Math.max(dtMs, 0), MAX_DT_MS) / 1000;
    if (t === 0) return this.value;
    const { stiffness: k, damping: c, mass: m } = this.cfg;
    const w0 = Math.sqrt(k / m);
    const z = c / (2 * Math.sqrt(k * m));
    const u0 = this.value - this.target;
    const v0 = this.velocity;
    let u: number;
    let v: number;
    if (z < 1 - 1e-4) {
      const wd = w0 * Math.sqrt(1 - z * z);
      const e = Math.exp(-z * w0 * t);
      const cs = Math.cos(wd * t);
      const sn = Math.sin(wd * t);
      const b = (v0 + z * w0 * u0) / wd;
      u = e * (u0 * cs + b * sn);
      v = e * (v0 * cs - (u0 * wd + z * w0 * b) * sn);
    } else if (z <= 1 + 1e-4) {
      const e = Math.exp(-w0 * t);
      const b = v0 + w0 * u0;
      u = e * (u0 + b * t);
      v = e * (b - w0 * (u0 + b * t));
    } else {
      const s = Math.sqrt(z * z - 1);
      const r1 = -w0 * (z - s);
      const r2 = -w0 * (z + s);
      const c2 = (v0 - r1 * u0) / (r2 - r1);
      const c1 = u0 - c2;
      const e1 = Math.exp(r1 * t);
      const e2 = Math.exp(r2 * t);
      u = c1 * e1 + c2 * e2;
      v = c1 * r1 * e1 + c2 * r2 * e2;
    }
    this.value = this.target + u;
    this.velocity = v;
    this.check();
    return this.value;
  }
}
