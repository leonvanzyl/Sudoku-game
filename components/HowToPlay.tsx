"use client";

// "How to play" modal: a quick VISUAL sudoku explainer. A mini board cycles
// through highlighting a row, a column, and a 3×3 box while the caption
// explains the rule; below it, quick notes on controls and the two modes.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/** A tiny (valid) sample grid — 0 = empty, shown as blanks. */
// prettier-ignore
const SAMPLE: number[] = [
  5, 3, 0, 0, 7, 0, 0, 0, 0,
  6, 0, 0, 1, 9, 5, 0, 0, 0,
  0, 9, 8, 0, 0, 0, 0, 6, 0,
  8, 0, 0, 0, 6, 0, 0, 0, 3,
  4, 0, 0, 8, 0, 3, 0, 0, 1,
  7, 0, 0, 0, 2, 0, 0, 0, 6,
  0, 6, 0, 0, 0, 0, 2, 8, 0,
  0, 0, 0, 4, 1, 9, 0, 0, 5,
  0, 0, 0, 0, 8, 0, 0, 7, 9,
];

type Step = {
  key: "row" | "col" | "box" | "fill";
  title: string;
  text: string;
  color: string;
  cells: (i: number) => boolean;
};

const STEPS: Step[] = [
  {
    key: "row",
    title: "EVERY ROW",
    text: "Each row must contain the numbers 1–9, with no repeats.",
    color: "#22d3ee",
    cells: (i) => Math.floor(i / 9) === 4,
  },
  {
    key: "col",
    title: "EVERY COLUMN",
    text: "Each column must contain 1–9 too — no number twice.",
    color: "#f472b6",
    cells: (i) => i % 9 === 4,
  },
  {
    key: "box",
    title: "EVERY 3×3 BOX",
    text: "And every 3×3 box must also contain all of 1–9.",
    color: "#a3e635",
    cells: (i) => Math.floor(i / 27) === 1 && Math.floor((i % 9) / 3) === 1,
  },
  {
    key: "fill",
    title: "FILL THE BLANKS",
    text: "Tap an empty cell, then tap a number. Correct entries lock in with a glow — wrong ones flash red.",
    color: "#facc15",
    cells: (i) => SAMPLE[i] === 0,
  },
];

function MiniBoard({ step }: { step: Step }) {
  return (
    <div
      className="mx-auto grid aspect-square w-full max-w-[290px] grid-cols-9 overflow-hidden rounded-xl border border-white/15 bg-black/40"
      role="img"
      aria-label="Animated sudoku rules diagram"
    >
      {SAMPLE.map((v, i) => {
        const r = Math.floor(i / 9);
        const c = i % 9;
        const active = step.cells(i);
        const thickL = c % 3 === 0 && c !== 0;
        const thickT = r % 3 === 0 && r !== 0;
        return (
          <div
            key={i}
            className="flex items-center justify-center border-white/[0.07] font-mono text-[11px] transition-colors duration-500 sm:text-sm"
            style={{
              borderLeftWidth: c === 0 ? 0 : thickL ? 2 : 1,
              borderTopWidth: r === 0 ? 0 : thickT ? 2 : 1,
              borderLeftColor: thickL ? "rgba(255,255,255,0.25)" : undefined,
              borderTopColor: thickT ? "rgba(255,255,255,0.25)" : undefined,
              backgroundColor: active ? `${step.color}2e` : "transparent",
              color: active ? step.color : "rgba(255,255,255,0.75)",
              textShadow: active ? `0 0 10px ${step.color}88` : undefined,
            }}
          >
            {v !== 0 ? v : active && step.key === "fill" ? "·" : ""}
          </div>
        );
      })}
    </div>
  );
}

export default function HowToPlay({ onClose }: { onClose: () => void }) {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  useEffect(() => {
    const id = window.setInterval(() => {
      setStepIdx((i) => (i + 1) % STEPS.length);
    }, 3400);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/70 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 16 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className="glass-deep my-auto w-full max-w-md rounded-3xl p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-cyan-300/70">
              how to play
            </p>
            <h2 className="mt-1 font-display text-2xl font-extrabold tracking-[0.12em] text-white">
              SUDOKU 101
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost rounded-xl px-3 py-1.5 font-display text-xs font-bold tracking-widest text-white/70"
          >
            ✕
          </button>
        </div>

        <div className="mt-5">
          <MiniBoard step={step} />
        </div>

        {/* step caption */}
        <div className="mt-4 min-h-[72px] text-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={step.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <p
                className="font-display text-sm font-extrabold tracking-[0.25em]"
                style={{ color: step.color, textShadow: `0 0 14px ${step.color}66` }}
              >
                {step.title}
              </p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-white/65">
                {step.text}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* step dots */}
        <div className="mt-1 flex justify-center gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-label={s.title}
              onClick={() => setStepIdx(i)}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: i === stepIdx ? 20 : 6,
                backgroundColor: i === stepIdx ? s.color : "rgba(255,255,255,0.2)",
              }}
            />
          ))}
        </div>

        {/* multiplayer notes */}
        <div className="mt-6 grid grid-cols-2 gap-3 text-left">
          <div className="rounded-xl bg-white/[0.05] p-3">
            <p className="font-display text-[11px] font-bold tracking-widest text-cyan-300">
              CO-OP
            </p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">
              One shared board. Everyone&apos;s entries show in their color — clear it together.
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.05] p-3">
            <p className="font-display text-[11px] font-bold tracking-widest text-pink-300">
              RACE
            </p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">
              Same puzzle, separate boards. First player to finish takes the round.
            </p>
          </div>
        </div>

        <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-white/35">
          win games → earn xp → unlock harder difficulties
        </p>

        <button
          type="button"
          onClick={onClose}
          className="btn-neon mt-5 w-full rounded-xl px-5 py-3 font-display text-xs font-extrabold tracking-[0.25em]"
        >
          GOT IT — LET&apos;S PLAY
        </button>
      </motion.div>
    </motion.div>
  );
}
