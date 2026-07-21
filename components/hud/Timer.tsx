"use client";

import { useEffect, useState } from "react";

function format(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = m.toString().padStart(h > 0 ? 2 : 1, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface TimerProps {
  /** Epoch ms when the game started; null before start. */
  startedAt: number | null;
  /** While true the timer ticks; when false it freezes at its last value. */
  running: boolean;
}

/** Live match timer driven by SharedGameState.startedAt. */
export default function Timer({ startedAt, running }: TimerProps) {
  // "now" only advances while running, so the display freezes on game over.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null || !running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [startedAt, running]);

  const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt);

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-1.5">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          running ? "bg-cyan-300 animate-glow-pulse" : "bg-white/30"
        }`}
      />
      <span className="font-mono text-sm font-semibold tabular-nums tracking-widest text-cyan-100">
        {format(elapsed)}
      </span>
    </div>
  );
}
