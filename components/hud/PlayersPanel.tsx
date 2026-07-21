"use client";

import { motion } from "framer-motion";
import { useGameStore } from "@/lib/store/gameStore";
import type { RaceProgress } from "@/lib/types";

/**
 * Live players panel.
 * Co-op: cells filled per player. Race: per-player progress bars.
 * (Memoization is left to the React Compiler.)
 */
export default function PlayersPanel() {
  const game = useGameStore((s) => s.game);
  const localPlayer = useGameStore((s) => s.localPlayer);

  if (!game) return null;

  const coopCounts = new Map<string, number>();
  if (game.mode === "coop") {
    for (const cell of game.coopBoard) {
      if (cell.value !== 0 && cell.byPlayer) {
        coopCounts.set(cell.byPlayer, (coopCounts.get(cell.byPlayer) ?? 0) + 1);
      }
    }
  }

  const totalToFill = game.puzzle.reduce((acc, v) => acc + (v === 0 ? 1 : 0), 0);
  const progressById = new Map<string, RaceProgress>(
    game.raceProgress.map((p) => [p.playerId, p]),
  );

  return (
    <div className="glass w-full rounded-2xl p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/45">
        {game.mode === "race" ? "Race standings" : "Team"}
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {game.players.map((p) => {
          const isMe = p.id === localPlayer?.id;
          const rp = progressById.get(p.id);
          const correct = rp?.correctCount ?? 0;
          const pct = totalToFill > 0 ? Math.min(100, (correct / totalToFill) * 100) : 0;
          return (
            <li key={p.id}>
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: p.color, boxShadow: `0 0 8px ${p.color}` }}
                />
                <span className="truncate text-sm font-medium text-white/90">
                  {p.name}
                  {isMe && <span className="ml-1 text-[10px] text-white/40">(you)</span>}
                </span>
                {p.isHost && (
                  <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-amber-200">
                    Host
                  </span>
                )}
                <span className="ml-auto font-mono text-xs tabular-nums text-white/55">
                  {game.mode === "coop"
                    ? `${coopCounts.get(p.id) ?? 0} cells`
                    : rp?.finishedAtMs != null
                      ? "FINISHED"
                      : `${correct}/${totalToFill}`}
                </span>
              </div>
              {game.mode === "race" && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      backgroundColor: p.color,
                      boxShadow: `0 0 10px ${p.color}`,
                    }}
                    initial={false}
                    animate={{ width: `${rp?.finishedAtMs != null ? 100 : pct}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                  />
                </div>
              )}
              {game.mode === "race" && (rp?.mistakes ?? 0) > 0 && (
                <p className="mt-1 font-mono text-[10px] text-red-400/70">
                  {rp?.mistakes} mistake{(rp?.mistakes ?? 0) === 1 ? "" : "s"}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
