"use client";

// ============================================================
// FxLayer — fixed full-viewport, pointer-events-none overlay.
// Subscribes to fxBus and renders:
//   - canvas particle FX (bursts, sweeps, gold burst, confetti)
//   - red edge vignette + body shake on cell-wrong
//   - victory / defeat banners (framer-motion), auto-dismissed
// One rAF loop drives the canvas; events arriving between frames
// are queued and drained at the start of the next frame. The loop
// only runs while there is something to animate — an idle overlay
// costs zero CPU.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { fxBus } from "@/lib/fx/bus";
import { PLAYER_COLORS, type DisasterKind, type FxEvent } from "@/lib/types";
import { FxEngine, GOLD_COLORS } from "./particles";

const CONFETTI_COLORS = [...PLAYER_COLORS, "#facc15", "#ffffff"] as const;
const BLIZZARD_COLORS = ["#ffffff", "#e0f2fe", "#bae6fd", "#93c5fd"] as const;
const SHAKE_CLASS = "fx-shake";
const SHAKE_MS = 400;
const VICTORY_CONFETTI_MS = 4500;
const VICTORY_BANNER_MS = 5500;
const DEFEAT_MS = 3200;
const DISASTER_TOAST_MS = 4200;

const DISASTER_META: Record<DisasterKind, { emoji: string; label: string }> = {
  earthquake: { emoji: "🌋", label: "Earthquake!" },
  "meteor-shower": { emoji: "☄️", label: "Meteor shower!" },
  blizzard: { emoji: "❄️", label: "Blizzard!" },
  tornado: { emoji: "🌪️", label: "Tornado!" },
  lightning: { emoji: "⚡", label: "Lightning storm!" },
};

interface DisasterToast {
  kind: DisasterKind;
  wiped: number;
  intense: boolean;
  byName: string | null;
}

function disasterSubtitle(d: DisasterToast): string {
  const nums = d.wiped === 1 ? "1 number" : `${d.wiped} numbers`;
  if (!d.intense) return `${d.byName ?? "A rival"} lost ${nums}!`;
  if (d.wiped === 0) return "It fizzled — nothing was lost";
  return d.byName
    ? `${d.byName}'s mistake wiped ${nums}!`
    : `Your mistake wiped ${nums}!`;
}

type Banner =
  | { kind: "victory"; winnerName: string | null }
  | { kind: "defeat" };

/**
 * Screen position (CSS px) for a cell: the board's [data-cell-index]
 * element, falling back to the board center, then the viewport center.
 */
function cellPoint(index: number): { x: number; y: number } {
  if (typeof document === "undefined") return { x: 0, y: 0 };
  const el = document.querySelector(`[data-cell-index="${index}"]`);
  if (el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return boardCenterPoint();
}

/** Center of the board area ([data-board-area]), else viewport center. */
function boardCenterPoint(): { x: number; y: number } {
  const board = document.querySelector("[data-board-area]");
  if (board) {
    const r = board.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

export default function FxLayer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [vignette, setVignette] = useState(false);
  const [dim, setDim] = useState(false);
  const [flash, setFlash] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [disaster, setDisaster] = useState<DisasterToast | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const engine = new FxEngine();
    const queue: FxEvent[] = [];
    const timeouts = new Set<ReturnType<typeof setTimeout>>();
    const later = (ms: number, fn: () => void) => {
      const id = setTimeout(() => {
        timeouts.delete(id);
        fn();
      }, ms);
      timeouts.add(id);
    };

    let w = window.innerWidth;
    let h = window.innerHeight;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const shake = () => {
      const body = document.body;
      body.classList.remove(SHAKE_CLASS);
      // Force a reflow so re-adding the class restarts the animation.
      void body.offsetWidth;
      body.classList.add(SHAKE_CLASS);
      later(SHAKE_MS, () => body.classList.remove(SHAKE_CLASS));
    };

    const handle = (e: FxEvent) => {
      switch (e.type) {
        case "cell-correct": {
          const p = cellPoint(e.cellIndex);
          engine.burst(p.x, p.y, e.color, 20);
          break;
        }
        case "cell-wrong": {
          const p = cellPoint(e.cellIndex);
          engine.puff(p.x, p.y, "#f87171");
          setVignette(true);
          later(SHAKE_MS, () => setVignette(false));
          shake();
          break;
        }
        case "unit-complete": {
          // Sequential sparkle sweep across the unit's cells.
          e.cells.forEach((cellIndex, i) => {
            engine.schedule(i * 45, () => {
              const p = cellPoint(cellIndex);
              engine.sparkle(p.x, p.y, e.color);
            });
          });
          break;
        }
        case "board-complete": {
          const p = boardCenterPoint();
          engine.goldBurst(p.x, p.y);
          break;
        }
        case "victory": {
          engine.confetti(VICTORY_CONFETTI_MS, CONFETTI_COLORS);
          const p = boardCenterPoint();
          engine.goldBurst(p.x, p.y);
          setBanner({ kind: "victory", winnerName: e.winnerName });
          later(VICTORY_BANNER_MS, () =>
            setBanner((b) => (b?.kind === "victory" ? null : b)),
          );
          break;
        }
        case "defeat": {
          setDim(true);
          setBanner({ kind: "defeat" });
          later(DEFEAT_MS, () => {
            setDim(false);
            setBanner((b) => (b?.kind === "defeat" ? null : b));
          });
          break;
        }
        case "pet-help": {
          // The pet itself (PetLayer) dashes over; here just the sparkle.
          const p = cellPoint(e.cellIndex);
          engine.sparkle(p.x, p.y, e.color, 10);
          engine.schedule(220, () => engine.burst(p.x, p.y, e.color, 14, 170));
          break;
        }
        case "disaster": {
          if (!DISASTER_META[e.kind]) break; // unknown kind from the wire
          const toast: DisasterToast = {
            kind: e.kind,
            wiped: e.cells.length,
            intense: e.intense,
            byName: e.byName,
          };
          setDisaster(toast);
          later(DISASTER_TOAST_MS, () =>
            setDisaster((d) => (d === toast ? null : d)),
          );
          // Not our board (another racer got hit): the toast is the story.
          if (!e.intense) break;

          const center = boardCenterPoint();
          /** Screen positions of the wiped cells — every kind strikes them. */
          const targets = e.cells.map(cellPoint);
          /** The "you lost this" accent fired at each struck cell. */
          const wipeHit = (p: { x: number; y: number }, color: string) => {
            engine.burst(p.x, p.y, color, 26, 300);
            engine.sparkle(p.x, p.y, "#f87171", 6);
          };

          switch (e.kind) {
            case "earthquake": {
              // Three shakes, dusty puffs across the board, and the wiped
              // cells crumble one after another.
              for (let k = 0; k < 3; k++) later(k * 450, shake);
              for (let k = 0; k < 12; k++) {
                engine.schedule(k * 120, () => {
                  const p = cellPoint(Math.floor(Math.random() * 81));
                  engine.puff(p.x, p.y, "#a8a29e");
                });
              }
              targets.forEach((p, k) => {
                engine.schedule(300 + k * 380, () => {
                  wipeHit(p, "#d6bda5");
                  engine.puff(p.x, p.y, "#a8a29e");
                });
              });
              break;
            }
            case "meteor-shower": {
              // Ambient meteors streak past while aimed strikes slam into
              // each wiped cell and detonate on impact.
              for (let k = 0; k < 10; k++) {
                engine.schedule(k * 200 + Math.random() * 90, () => {
                  const x = Math.random() * (window.innerWidth + 300);
                  engine.meteor(x, -20);
                });
              }
              targets.forEach((p, k) => {
                engine.schedule(250 + k * 300, () => {
                  const flightMs = engine.meteorStrike(p.x, p.y);
                  engine.schedule(flightMs, () => {
                    wipeHit(p, "#fb923c");
                    engine.sparkle(p.x, p.y, "#fde68a", 10);
                  });
                  if (k === 0) later(250 + flightMs, shake);
                });
              });
              break;
            }
            case "blizzard": {
              // Snowfall, then the wiped cells flash-freeze and shatter.
              engine.confetti(4200, BLIZZARD_COLORS);
              targets.forEach((p, k) => {
                engine.schedule(400 + k * 320, () => {
                  wipeHit(p, "#bae6fd");
                  engine.sparkle(p.x, p.y, "#e0f2fe", 12);
                });
              });
              break;
            }
            case "tornado": {
              // Sparkle spiral winding outward from the board center, then
              // the funnel rips the wiped numbers off the board.
              for (let k = 0; k < 36; k++) {
                engine.schedule(k * 65, () => {
                  const a = k * 0.55;
                  const rad = 16 + k * 5;
                  engine.sparkle(
                    center.x + Math.cos(a) * rad,
                    center.y + Math.sin(a) * rad * 0.7,
                    "#a5f3fc",
                    3,
                  );
                });
              }
              later(500, shake);
              targets.forEach((p, k) => {
                engine.schedule(600 + k * 300, () => {
                  wipeHit(p, "#a5f3fc");
                  engine.puff(p.x, p.y, "#67e8f9");
                });
              });
              break;
            }
            case "lightning": {
              // White flashes, then a bolt stabs down onto each wiped cell.
              setFlash(true);
              later(90, () => setFlash(false));
              later(260, () => setFlash(true));
              later(380, () => setFlash(false));
              targets.forEach((p, k) => {
                engine.schedule(200 + k * 260, () => {
                  // Bolt: sparkles strobed down the column above the cell.
                  const steps = 6;
                  for (let j = 0; j <= steps; j++) {
                    engine.schedule(j * 28, () => {
                      const y = p.y * (j / steps);
                      engine.sparkle(p.x + (Math.random() - 0.5) * 14, y, "#fef9c3", 4);
                    });
                  }
                  engine.schedule(steps * 28, () => {
                    wipeHit(p, "#fde047");
                    engine.sparkle(p.x, p.y, "#ffffff", 8);
                  });
                });
              });
              if (targets.length > 0) later(370, shake);
              break;
            }
          }
          break;
        }
      }
    };

    let raf = 0;
    let running = false;
    let last = 0;
    let canvasDirty = false;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Drain events queued since the previous frame.
      if (queue.length > 0) {
        const batch = queue.splice(0, queue.length);
        for (const e of batch) handle(e);
      }

      if (engine.active || canvasDirty) {
        engine.update(dt, w, h);
        ctx.clearRect(0, 0, w, h);
        engine.draw(ctx);
        // After the engine goes idle, clear one final frame before stopping.
        canvasDirty = engine.active;
      }

      // Nothing left to animate: park the loop until the next fx event.
      if (!engine.active && !canvasDirty && queue.length === 0) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    const wakeLoop = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };

    const unsubscribe = fxBus.on((e) => {
      queue.push(e);
      wakeLoop();
    });

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      window.removeEventListener("resize", resize);
      for (const id of timeouts) clearTimeout(id);
      document.body.classList.remove(SHAKE_CLASS);
    };
  }, []);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 60,
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes fx-shake-kf {
          0%, 100% { transform: translate(0, 0); }
          15% { transform: translate(-7px, 3px); }
          30% { transform: translate(6px, -4px); }
          45% { transform: translate(-5px, 2px); }
          60% { transform: translate(4px, -2px); }
          75% { transform: translate(-3px, 1px); }
          90% { transform: translate(2px, -1px); }
        }
        body.${SHAKE_CLASS} { animation: fx-shake-kf ${SHAKE_MS}ms ease-in-out; }
      `}</style>

      {/* Red edge vignette (cell-wrong) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow: "inset 0 0 120px 24px rgba(239, 68, 68, 0.55)",
          opacity: vignette ? 1 : 0,
          transition: vignette ? "opacity 60ms ease-out" : "opacity 320ms ease-in",
        }}
      />

      {/* White flash (lightning disaster) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(245, 250, 255, 0.9)",
          opacity: flash ? 1 : 0,
          transition: flash ? "opacity 30ms ease-out" : "opacity 180ms ease-in",
        }}
      />

      {/* Desaturating dim (defeat) — mounted only while active: an
       * always-present backdrop-filter layer pays its full-screen backdrop
       * pass every frame even at opacity 0. */}
      <AnimatePresence>
        {dim && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(10, 10, 18, 0.45)",
              backdropFilter: "saturate(0.35) brightness(0.85)",
              WebkitBackdropFilter: "saturate(0.35) brightness(0.85)",
            }}
          />
        )}
      </AnimatePresence>

      {/* Particle canvas */}
      <canvas
        ref={canvasRef}
        data-fx-canvas=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />

      {/* Disaster toast */}
      <div
        style={{
          position: "absolute",
          insetInline: 0,
          top: "max(4.5rem, calc(env(safe-area-inset-top) + 3.5rem))",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <AnimatePresence>
          {disaster && (
            <m.div
              key={`${disaster.kind}-${disaster.wiped}-${disaster.byName ?? ""}`}
              initial={{ opacity: 0, y: -18, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 340, damping: 24 }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                padding: "0.55rem 1.1rem",
                borderRadius: "0.9rem",
                background: "rgba(15, 15, 30, 0.8)",
                border: "1px solid rgba(165, 243, 252, 0.35)",
                boxShadow: "0 0 30px rgba(165, 243, 252, 0.15), 0 6px 30px rgba(0,0,0,0.5)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
              }}
            >
              <span style={{ fontSize: "1.4rem", lineHeight: 1 }}>
                {DISASTER_META[disaster.kind].emoji}
              </span>
              <span>
                <span
                  style={{
                    display: "block",
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "rgba(224, 242, 254, 0.95)",
                  }}
                >
                  {DISASTER_META[disaster.kind].label}
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: "0.1rem",
                    fontSize: "0.72rem",
                    color:
                      disaster.intense && disaster.wiped > 0
                        ? "rgba(252, 165, 165, 0.95)"
                        : "rgba(186, 230, 253, 0.75)",
                  }}
                >
                  {disasterSubtitle(disaster)}
                </span>
              </span>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      {/* Banners */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <AnimatePresence>
          {banner?.kind === "victory" && (
            <m.div
              key="victory-banner"
              initial={{ opacity: 0, scale: 0.6, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -16 }}
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
              style={{
                textAlign: "center",
                padding: "1.5rem 3rem",
                borderRadius: "1.25rem",
                background: "rgba(15, 15, 30, 0.75)",
                border: "1px solid rgba(250, 204, 21, 0.45)",
                boxShadow:
                  "0 0 60px rgba(250, 204, 21, 0.25), 0 8px 40px rgba(0,0,0,0.5)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
              }}
            >
              <m.div
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  fontSize: "clamp(2rem, 6vw, 3.5rem)",
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  background: `linear-gradient(120deg, ${GOLD_COLORS[1]}, ${GOLD_COLORS[2]}, ${GOLD_COLORS[0]})`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {banner.winnerName ? `${banner.winnerName} wins!` : "Victory!"}
              </m.div>
              <div
                style={{
                  marginTop: "0.5rem",
                  fontSize: "1rem",
                  color: "rgba(255, 255, 255, 0.75)",
                }}
              >
                Puzzle complete
              </div>
            </m.div>
          )}

          {banner?.kind === "defeat" && (
            <m.div
              key="defeat-banner"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              style={{
                textAlign: "center",
                padding: "1.25rem 2.5rem",
                borderRadius: "1rem",
                background: "rgba(12, 12, 20, 0.8)",
                border: "1px solid rgba(148, 163, 184, 0.25)",
                boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
              }}
            >
              <div
                style={{
                  fontSize: "clamp(1.5rem, 4vw, 2.25rem)",
                  fontWeight: 700,
                  color: "rgba(203, 213, 225, 0.9)",
                }}
              >
                Defeat
              </div>
              <div
                style={{
                  marginTop: "0.4rem",
                  fontSize: "0.95rem",
                  color: "rgba(148, 163, 184, 0.8)",
                }}
              >
                Better luck next round
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
