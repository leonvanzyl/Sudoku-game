"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ColorPicker from "@/components/ColorPicker";
import { useGameStore } from "@/lib/store/gameStore";
import type { GameStore } from "@/lib/types";

const MODE_LABEL = { coop: "Co-op — one shared board", race: "Race — first to finish wins" } as const;

const DIFFICULTY_ACCENT: Record<string, string> = {
  easy: "#a3e635",
  medium: "#22d3ee",
  hard: "#facc15",
  expert: "#f472b6",
};

export interface LobbyViewProps {
  onStart: () => void;
  starting: boolean;
  connectionStatus: GameStore["connectionStatus"];
  /** Change the local player's color (announced to the room). */
  onPickColor: (color: string) => void;
}

/** Pre-game lobby: invite code, roster, settings summary, start control. */
export default function LobbyView({
  onStart,
  starting,
  connectionStatus,
  onPickColor,
}: LobbyViewProps) {
  const game = useGameStore((s) => s.game);
  const isHost = useGameStore((s) => s.isHost);
  const localPlayer = useGameStore((s) => s.localPlayer);
  const [copied, setCopied] = useState(false);

  if (!game) return null;

  const takenColors = new Set(
    game.players.filter((p) => p.id !== localPlayer?.id).map((p) => p.color),
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(game.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable — the code is on screen anyway
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="mx-auto flex w-full max-w-lg flex-col items-center gap-6 px-4 py-10"
    >
      <div className="text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.45em] text-white/40">
          lobby
        </p>
        <h1 className="mt-1 font-display text-2xl font-extrabold tracking-[0.15em] text-white">
          MISSION BRIEFING
        </h1>
      </div>

      {/* Invite code */}
      <div className="glass w-full rounded-3xl p-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-white/45">
          invite code
        </p>
        <button
          type="button"
          onClick={copyCode}
          title="Copy invite code"
          className="group mt-3 inline-flex items-center gap-3 rounded-2xl border border-cyan-400/30 bg-black/40 px-6 py-4 transition hover:border-cyan-300/60"
        >
          <span className="code-glow animate-glow-pulse font-mono text-4xl font-extrabold tracking-[0.35em] text-cyan-200 sm:text-5xl">
            {game.code}
          </span>
          <span className="text-white/40 transition group-hover:text-cyan-200">
            <AnimatePresence mode="wait" initial={false}>
              {copied ? (
                <motion.svg
                  key="check"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#4ade80"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-6 w-6"
                >
                  <path d="M20 6 9 17l-5-5" />
                </motion.svg>
              ) : (
                <motion.svg
                  key="copy"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="h-6 w-6"
                >
                  <rect x="9" y="9" width="12" height="12" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </motion.svg>
              )}
            </AnimatePresence>
          </span>
        </button>
        <p className="mt-3 text-xs text-white/40">
          {copied ? "Copied!" : "Tap to copy — friends enter this code on the home screen."}
        </p>
      </div>

      {/* Settings summary */}
      <div className="glass flex w-full items-center justify-between rounded-2xl px-5 py-3.5">
        <span className="text-sm text-white/70">{MODE_LABEL[game.mode]}</span>
        <span
          className="rounded-full border px-3 py-1 font-display text-xs font-bold uppercase tracking-widest"
          style={{
            color: DIFFICULTY_ACCENT[game.difficulty],
            borderColor: `${DIFFICULTY_ACCENT[game.difficulty]}55`,
            boxShadow: `0 0 16px -6px ${DIFFICULTY_ACCENT[game.difficulty]}`,
          }}
        >
          {game.difficulty}
        </span>
      </div>

      {/* Players */}
      <div className="glass w-full rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-white/45">
            players · {game.players.length}
          </p>
          <span
            className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${
              connectionStatus === "connected"
                ? "text-emerald-300/80"
                : connectionStatus === "error"
                  ? "text-red-400"
                  : "text-amber-300/80"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {connectionStatus}
          </span>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {game.players.map((p) => (
              <motion.li
                key={p.id}
                layout
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 14 }}
                className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-4 py-2.5"
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: p.color, boxShadow: `0 0 10px ${p.color}` }}
                />
                <span className="truncate text-sm font-medium text-white/90">
                  {p.name}
                  {p.id === localPlayer?.id && (
                    <span className="ml-1.5 text-[10px] text-white/40">(you)</span>
                  )}
                </span>
                {p.isHost && (
                  <span className="ml-auto rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-amber-200">
                    Host
                  </span>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <div className="mt-4 border-t border-white/[0.07] pt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-white/45">
            your color
          </p>
          <ColorPicker
            className="mt-2.5"
            value={localPlayer?.color ?? null}
            taken={takenColors}
            onChange={onPickColor}
          />
        </div>
      </div>

      {isHost ? (
        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          className="btn-neon w-full rounded-2xl px-6 py-4 font-display text-sm font-extrabold tracking-[0.3em]"
        >
          {starting ? "STARTING…" : "START GAME"}
        </button>
      ) : (
        <p className="shimmer-text py-2 font-display text-sm font-bold tracking-[0.3em]">
          WAITING FOR HOST TO START…
        </p>
      )}
    </motion.div>
  );
}
