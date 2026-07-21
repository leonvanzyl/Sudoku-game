"use client";

import { useEffect, useRef, useState } from "react";

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
  const [elapsed, setElapsed] = useState(0);
  const frozenRef = useRef(0);

  useEffect(() => {
    if (startedAt === null) {
      setElapsed(0);
      frozenRef.current = 0;
      return;
    }
    if (!running) return; // keep last shown value frozen
    const tick = () => {
      const e = Date.now() - startedAt;
      frozenRef.current = e;
      setElapsed(e);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [startedAt, running]);

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-1.5">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          running ? "bg-cyan-300 animate-glow-pulse" : "bg-white/30"
        }`}
      />
      <span className="font-mono text-sm font-semibold tabular-nums tracking-widest text-cyan-100">
        {format(running ? elapsed : frozenRef.current || elapsed)}
      </span>
    </div>
  );
}
