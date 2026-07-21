// ============================================================
// FxEngine — hand-rolled canvas particle system for FxLayer.
// Pure TypeScript, no React, no external deps. One instance is
// driven by FxLayer's single rAF loop.
// ============================================================

type Shape = "dot" | "spark" | "rect" | "tri";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds of life remaining. */
  life: number;
  maxLife: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  shape: Shape;
  gravity: number;
  drag: number;
  /** shadowBlur px; 0 = no glow (cheaper). */
  glow: number;
  /** Phase offset for confetti flutter. */
  phase: number;
}

const MAX_PARTICLES = 900;
const TWO_PI = Math.PI * 2;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T,>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

export const GOLD_COLORS = [
  "#facc15",
  "#fde047",
  "#f59e0b",
  "#fbbf24",
  "#fff7d1",
] as const;

export class FxEngine {
  private ps: Particle[] = [];
  private timers: { at: number; fn: () => void }[] = [];
  private confettiUntil = 0;
  private confettiColors: readonly string[] = GOLD_COLORS;
  /** Engine clock in seconds. */
  private t = 0;

  /** True while anything still needs animating/drawing. */
  get active(): boolean {
    return (
      this.ps.length > 0 || this.timers.length > 0 || this.t < this.confettiUntil
    );
  }

  /** Run `fn` after `delayMs` on the engine clock (drained in update()). */
  schedule(delayMs: number, fn: () => void): void {
    this.timers.push({ at: this.t + delayMs / 1000, fn });
  }

  private push(p: Particle): void {
    if (this.ps.length >= MAX_PARTICLES) {
      // Overwrite the oldest slot instead of growing (cheap cap).
      this.ps.shift();
    }
    this.ps.push(p);
  }

  /** Glowing radial burst (cell-correct). */
  burst(x: number, y: number, color: string, count = 20, speed = 240): void {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TWO_PI);
      const v = rand(speed * 0.25, speed);
      this.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - rand(20, 80),
        life: rand(0.45, 0.9),
        maxLife: 0.9,
        size: rand(1.6, 3.6),
        rot: 0,
        vr: 0,
        color,
        shape: "dot",
        gravity: 340,
        drag: 1.6,
        glow: 8,
        phase: 0,
      });
    }
  }

  /** Twinkling star sparkles (unit-complete sweep). */
  sparkle(x: number, y: number, color: string, count = 7): void {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TWO_PI);
      const v = rand(20, 110);
      this.push({
        x: x + rand(-6, 6),
        y: y + rand(-6, 6),
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - rand(30, 70),
        life: rand(0.5, 1),
        maxLife: 1,
        size: rand(3, 6.5),
        rot: rand(0, TWO_PI),
        vr: rand(-4, 4),
        color,
        shape: "spark",
        gravity: 120,
        drag: 1.2,
        glow: 6,
        phase: 0,
      });
    }
  }

  /** Big radial gold burst (board-complete). */
  goldBurst(x: number, y: number): void {
    for (let i = 0; i < 110; i++) {
      const a = (i / 110) * TWO_PI + rand(-0.1, 0.1);
      const v = rand(120, 460);
      const spark = i % 4 === 0;
      this.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: rand(0.6, 1.4),
        maxLife: 1.4,
        size: spark ? rand(4, 8) : rand(1.8, 3.8),
        rot: rand(0, TWO_PI),
        vr: rand(-5, 5),
        color: pick(GOLD_COLORS),
        shape: spark ? "spark" : "dot",
        gravity: 260,
        drag: 1.5,
        glow: spark ? 8 : 5,
        phase: 0,
      });
    }
  }

  /** Small subdued puff (cell-wrong feedback at the cell). */
  puff(x: number, y: number, color: string): void {
    this.burst(x, y, color, 8, 110);
  }

  /** Start a confetti rain for `durationMs` (victory). */
  confetti(durationMs: number, colors: readonly string[]): void {
    this.confettiUntil = this.t + durationMs / 1000;
    this.confettiColors = colors;
  }

  private spawnConfettiRow(w: number): void {
    // A few pieces per frame keeps a dense rain without a huge burst.
    const n = Math.min(5, MAX_PARTICLES - this.ps.length);
    for (let i = 0; i < n; i++) {
      const tri = Math.random() < 0.35;
      this.push({
        x: rand(-20, w + 20),
        y: rand(-40, -10),
        vx: rand(-50, 50),
        vy: rand(60, 160),
        life: rand(2.6, 4),
        maxLife: 4,
        size: rand(5, 10),
        rot: rand(0, TWO_PI),
        vr: rand(-7, 7),
        color: pick(this.confettiColors),
        shape: tri ? "tri" : "rect",
        gravity: 170,
        drag: 0.7,
        glow: 0,
        phase: rand(0, TWO_PI),
      });
    }
  }

  /** Advance the simulation. `w`/`h` are CSS-pixel viewport size. */
  update(dt: number, w: number, h: number): void {
    this.t += dt;

    // Timed spawns (unit-complete sweep, etc.).
    if (this.timers.length > 0) {
      const due = this.timers.filter((tm) => tm.at <= this.t);
      if (due.length > 0) {
        this.timers = this.timers.filter((tm) => tm.at > this.t);
        for (const tm of due) tm.fn();
      }
    }

    if (this.t < this.confettiUntil) this.spawnConfettiRow(w);

    const alive: Particle[] = [];
    for (const p of this.ps) {
      p.life -= dt;
      if (p.life <= 0 || p.y > h + 60) continue;
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * dt;
      if (p.shape === "rect" || p.shape === "tri") {
        // Confetti flutter.
        p.vx += Math.sin(this.t * 3 + p.phase) * 26 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      alive.push(p);
    }
    this.ps = alive;
  }

  /** Draw all particles. Assumes ctx is scaled to CSS pixels. */
  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.ps) {
      // Full brightness, then fade over the last 40% of life.
      const alpha = Math.min(1, p.life / (p.maxLife * 0.4));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.glow > 0) {
        ctx.shadowBlur = p.glow;
        ctx.shadowColor = p.color;
      } else {
        ctx.shadowBlur = 0;
      }

      switch (p.shape) {
        case "dot":
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, TWO_PI);
          ctx.fill();
          break;
        case "spark": {
          // 4-point star: two thin crossing bars.
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          const s = p.size;
          const t = Math.max(1, s * 0.28);
          ctx.fillRect(-s, -t / 2, s * 2, t);
          ctx.fillRect(-t / 2, -s, t, s * 2);
          ctx.restore();
          break;
        }
        case "rect":
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          // Fake 3D tumble by squashing on a sine of rotation.
          ctx.scale(1, Math.max(0.15, Math.abs(Math.sin(p.rot * 1.7))));
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
          ctx.restore();
          break;
        case "tri":
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.max(0.2, Math.abs(Math.sin(p.rot * 1.3))));
          ctx.beginPath();
          ctx.moveTo(0, -p.size * 0.6);
          ctx.lineTo(p.size * 0.55, p.size * 0.45);
          ctx.lineTo(-p.size * 0.55, p.size * 0.45);
          ctx.closePath();
          ctx.fill();
          break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}
