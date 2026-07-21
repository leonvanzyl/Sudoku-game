"use client";

// ============================================================
// FxLayer — fixed full-viewport, pointer-events-none overlay.
// Subscribes to fxBus and renders:
//   - canvas particle FX (bursts, sweeps, gold burst, confetti)
//   - red edge vignette + body shake on cell-wrong
//   - victory / defeat banners (framer-motion), auto-dismissed
// One rAF loop drives the canvas; events arriving between frames
// are queued and drained at the start of the next frame.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fxBus } from "@/lib/fx/bus";
import { PLAYER_COLORS, type FxEvent } from "@/lib/types";
import { FxEngine, GOLD_COLORS } from "./particles";

const CONFETTI_COLORS = [...PLAYER_COLORS, "#facc15", "#ffffff"] as const;
const SHAKE_CLASS = "fx-shake";
const SHAKE_MS = 400;
const VICTORY_CONFETTI_MS = 4500;
const VICTORY_BANNER_MS = 5500;
const DEFEAT_MS = 3200;

type Banner =
  | { kind: "victory"; winnerName: string | null }
  | { kind: "defeat" };

/**
 * Screen position (CSS px) for a cell. Prefers the 2D board's
 * [data-cell-index] element; in 3D mode falls back to the
 * center-bottom of the board area, then the viewport center.
 */
function cellPoint(index: number): { x: number; y: number } {
  if (typeof document === "undefined") return { x: 0, y: 0 };
  const el = document.querySelector(`[data-cell-index="${index}"]`);
  if (el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return boardFallbackPoint();
}

/** Center-bottom of the board area, else viewport center. */
function boardFallbackPoint(): { x: number; y: number } {
  const board =
    document.querySelector("[data-board-area]") ??
    // 3D mode: the R3F canvas (never our own — ours has data-fx-canvas).
    document.querySelector("canvas:not([data-fx-canvas])");
  if (board) {
    const r = board.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom - Math.min(40, r.height * 0.1) };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** Center of the board area, else viewport center. */
function boardCenterPoint(): { x: number; y: number } {
  const board =
    document.querySelector("[data-board-area]") ??
    document.querySelector("canvas:not([data-fx-canvas])");
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
  const [banner, setBanner] = useState<Banner | null>(null);

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
      }
    };

    const unsubscribe = fxBus.on((e) => {
      queue.push(e);
    });

    let raf = 0;
    let last = performance.now();
    let canvasDirty = false;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
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
        // After the engine goes idle, clear one final frame then stop
        // touching the canvas so idle frames cost nothing.
        canvasDirty = engine.active;
      }
    };
    raf = requestAnimationFrame(loop);

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

      {/* Desaturating dim (defeat) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(10, 10, 18, 0.45)",
          backdropFilter: "saturate(0.35) brightness(0.85)",
          WebkitBackdropFilter: "saturate(0.35) brightness(0.85)",
          opacity: dim ? 1 : 0,
          transition: "opacity 500ms ease",
        }}
      />

      {/* Particle canvas */}
      <canvas
        ref={canvasRef}
        data-fx-canvas=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />

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
            <motion.div
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
              <motion.div
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
              </motion.div>
              <div
                style={{
                  marginTop: "0.5rem",
                  fontSize: "1rem",
                  color: "rgba(255, 255, 255, 0.75)",
                }}
              >
                Puzzle complete
              </div>
            </motion.div>
          )}

          {banner?.kind === "defeat" && (
            <motion.div
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
