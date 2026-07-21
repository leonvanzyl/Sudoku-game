// Imperative, allocation-light animation state for the 81 tiles.
// Pulses are scheduled (optionally with a delay, for ripples/waves) and
// sampled once per frame from a single useFrame loop — no per-frame setState.

import * as THREE from "three";

export interface PulseSpec {
  /** Peak emissive flash strength (0-1+). */
  flash?: number;
  /** Peak extra lift in world units. */
  lift?: number;
  /** Peak extra uniform scale (0.15 => up to 1.15x). */
  scale?: number;
  /** Envelope duration in seconds (default 0.6). */
  duration?: number;
  color?: THREE.ColorRepresentation;
}

export interface PulseSample {
  flash: number;
  lift: number;
  scale: number;
}

interface Pulse {
  /** Scheduled start time; reused as actual start once promoted. */
  at: number;
  flash: number;
  lift: number;
  scale: number;
  duration: number;
  color: THREE.Color;
}

export const nowSeconds = (): number =>
  (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

export class CellFxManager {
  private pending: Pulse[][];
  private active: (Pulse | null)[];
  private readonly count: number;

  constructor(count = 81) {
    this.count = count;
    this.pending = Array.from({ length: count }, () => []);
    this.active = new Array<Pulse | null>(count).fill(null);
  }

  schedule(index: number, delayMs: number, spec: PulseSpec): void {
    if (index < 0 || index >= this.count) return;
    this.pending[index].push({
      at: nowSeconds() + delayMs / 1000,
      flash: spec.flash ?? 0,
      lift: spec.lift ?? 0,
      scale: spec.scale ?? 0,
      duration: spec.duration ?? 0.6,
      color: new THREE.Color(spec.color ?? "#ffffff"),
    });
  }

  /**
   * Sample cell `index` at time `now` (seconds). Mutates `out` and `color`
   * in place to avoid per-frame allocations. Promotes due pending pulses.
   */
  sample(index: number, now: number, out: PulseSample, color: THREE.Color): void {
    out.flash = 0;
    out.lift = 0;
    out.scale = 0;
    const queue = this.pending[index];
    for (let k = queue.length - 1; k >= 0; k--) {
      if (queue[k].at <= now) {
        const p = queue[k];
        queue.splice(k, 1);
        const cur = this.active[index];
        // Stronger pulse wins; otherwise keep the current one running.
        if (!cur || p.flash >= cur.flash) {
          p.at = now;
          this.active[index] = p;
        }
      }
    }
    const a = this.active[index];
    if (!a) return;
    const t = (now - a.at) / a.duration;
    if (t >= 1) {
      this.active[index] = null;
      return;
    }
    const fade = 1 - t;
    out.flash = a.flash * fade * fade;
    const bump = Math.sin(Math.PI * Math.min(t * 1.25, 1));
    out.lift = a.lift * bump;
    out.scale = a.scale * bump;
    color.copy(a.color);
  }
}

/** Decaying positional shake for the whole board (cell-wrong). */
export class ShakeManager {
  private start = -1;
  private mag = 0;

  trigger(mag = 0.4): void {
    this.start = nowSeconds();
    this.mag = Math.max(this.mag * 0.5, mag);
  }

  sample(now: number, out: { x: number; z: number }): void {
    out.x = 0;
    out.z = 0;
    if (this.start < 0) return;
    const age = now - this.start;
    if (age >= 0.6) {
      this.start = -1;
      this.mag = 0;
      return;
    }
    const env = this.mag * Math.exp(-5.5 * age) * 0.35;
    out.x = Math.sin(age * 58) * env;
    out.z = Math.cos(age * 47) * env;
  }
}
