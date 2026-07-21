"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { useGameChannel } from "@/lib/realtime/useGameChannel";
import { useGameStore } from "@/lib/store/gameStore";
import type { Difficulty, RaceProgress, SharedGameState } from "@/lib/types";
import Board2D from "@/components/board2d/Board2D";
import LobbyView from "@/components/lobby/LobbyView";
import Timer from "@/components/hud/Timer";
import NumberPad from "@/components/hud/NumberPad";
import PlayersPanel from "@/components/hud/PlayersPanel";
import FxLayer from "@/components/fx/FxLayer";

const Board3D = dynamic(() => import("@/components/board3d/Board3D"), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-square w-full max-w-[min(92vw,560px)] items-center justify-center rounded-2xl border border-white/10 bg-black/30">
      <Spinner label="Loading 3D board…" />
    </div>
  ),
});

/* ---------------------------------------------------------------- */
/* helpers                                                           */
/* ---------------------------------------------------------------- */

const DIFFICULTY_ACCENT: Record<Difficulty, string> = {
  easy: "#a3e635",
  medium: "#22d3ee",
  hard: "#facc15",
  expert: "#f472b6",
};

const XP_MULT: Record<Difficulty, number> = { easy: 1, medium: 1.5, hard: 2, expert: 3 };

/** Mirrors the progression rules (win 60 / participation 15, × difficulty). */
function xpGained(won: boolean, difficulty: Difficulty): number {
  return Math.round((won ? 60 : 15) * XP_MULT[difficulty]);
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/10 border-t-cyan-300" />
      {label && (
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/45">{label}</p>
      )}
    </div>
  );
}

function FullScreenNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      {children}
    </div>
  );
}

/** True after hydration; false during SSR + the hydration render. */
const emptySubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/* ---------------------------------------------------------------- */
/* GameShell                                                         */
/* ---------------------------------------------------------------- */

export default function GameShell({ code }: { code: string }) {
  const router = useRouter();
  const { publish, endSession, connectionStatus, sessionEnded } = useGameChannel(code);

  const game = useGameStore((s) => s.game);
  const isHost = useGameStore((s) => s.isHost);
  const localPlayer = useGameStore((s) => s.localPlayer);
  const setLocalPlayer = useGameStore((s) => s.setLocalPlayer);
  const viewMode = useGameStore((s) => s.viewMode);
  const setViewMode = useGameStore((s) => s.setViewMode);

  const mounted = useMounted();
  const [nameDraft, setNameDraft] = useState("");
  const [starting, setStarting] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [finalElapsedMs, setFinalElapsedMs] = useState<number | null>(null);

  const recordedRef = useRef(false);

  const phase = game?.phase ?? null;
  /** Show the spinner-y start button only while we're still in the lobby. */
  const startPending = starting && phase === "lobby";

  /* ---- input plumbing: store decides, we publish what it returns ---- */
  const handleInput = useCallback(
    (value: number) => {
      const s = useGameStore.getState();
      if (s.game?.phase !== "playing") return;
      const msg = s.inputNumber(value);
      if (msg) void publish(msg);
    },
    [publish],
  );

  /* ---- keyboard fallback while the 3D board is shown ---- */
  useEffect(() => {
    if (viewMode !== "3d" || phase !== "playing") return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key >= "1" && e.key <= "9") handleInput(Number(e.key));
      else if (e.key === "0" || e.key === "Backspace" || e.key === "Delete") handleInput(0);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode, phase, handleInput]);

  /* ---- host: start the game ---- */
  const handleStart = useCallback(() => {
    const s = useGameStore.getState();
    if (!s.isHost || !s.game || s.game.phase !== "lobby") return;
    setStarting(true);
    const zeroProgress: RaceProgress[] = s.game.players.map((p) => ({
      playerId: p.id,
      correctCount: 0,
      mistakes: 0,
      finishedAtMs: null,
    }));
    const started: SharedGameState = {
      ...s.game,
      phase: "playing",
      startedAt: Date.now(),
      raceProgress: s.game.mode === "race" ? zeroProgress : s.game.raceProgress,
    };
    publish({ type: "start-game", state: started })
      .catch(() => setStarting(false));
  }, [publish]);

  /* ---- session ended by host: park on a modal, then go home ---- */
  useEffect(() => {
    if (!sessionEnded) return;
    const id = window.setTimeout(() => router.push("/"), 3200);
    return () => window.clearTimeout(id);
  }, [sessionEnded, router]);

  /* ---- game over: capture the final time for the overlay ----
   * NOTE: progression (recordResult) is handled inside the store's
   * setGameOver — do not record here or XP would double-count. */
  useEffect(() => {
    if (phase !== "finished") return;
    // Deferred so the capture happens outside the effect's synchronous body.
    const id = window.setTimeout(() => {
      if (recordedRef.current) return;
      const s = useGameStore.getState();
      const g = s.game;
      if (!g || !s.localPlayer) return;
      recordedRef.current = true;

      const own = g.raceProgress.find((p) => p.playerId === s.localPlayer?.id);
      const elapsed =
        g.mode === "race" && own?.finishedAtMs != null
          ? own.finishedAtMs
          : g.startedAt != null
            ? Date.now() - g.startedAt
            : null;
      setFinalElapsedMs(elapsed);
    }, 0);
    return () => window.clearTimeout(id);
  }, [phase]);

  /* ---- leave / end ---- */
  const goHome = useCallback(() => {
    setLeaving(true);
    router.push("/");
    useGameStore.getState().leaveGame();
  }, [router]);

  const handleEndSession = useCallback(async () => {
    setConfirmEnd(false);
    setLeaving(true);
    await endSession();
    router.push("/");
  }, [endSession, router]);

  /* ================================================================ */
  /* Render states                                                     */
  /* ================================================================ */

  if (!mounted) {
    return (
      <FullScreenNotice>
        <Spinner />
      </FullScreenNotice>
    );
  }

  if (sessionEnded) {
    return (
      <FullScreenNotice>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-deep w-full max-w-sm rounded-3xl p-8"
        >
          <p className="font-display text-lg font-bold tracking-widest text-white">
            SESSION TERMINATED
          </p>
          <p className="mt-2 text-sm text-white/55">
            The host ended the session. Taking you home…
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="btn-neon mt-6 w-full rounded-xl px-5 py-3 font-display text-xs font-extrabold tracking-[0.25em]"
          >
            BACK TO HOME
          </button>
        </motion.div>
      </FullScreenNotice>
    );
  }

  if (leaving) {
    return (
      <FullScreenNotice>
        <Spinner label="Leaving…" />
      </FullScreenNotice>
    );
  }

  /* Joiner arriving without a saved name: ask before connecting. */
  if (!localPlayer) {
    return (
      <FullScreenNotice>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass w-full max-w-sm rounded-3xl p-8 text-left"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-cyan-300/70">
            joining {code}
          </p>
          <h1 className="mt-2 font-display text-xl font-extrabold tracking-widest text-white">
            WHO ARE YOU?
          </h1>
          <input
            autoFocus
            value={nameDraft}
            maxLength={20}
            placeholder="Enter your name…"
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nameDraft.trim()) setLocalPlayer(nameDraft.trim());
            }}
            className="mt-5 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-display text-lg tracking-wider text-white outline-none placeholder:text-white/25 focus:border-cyan-400/60"
          />
          <button
            type="button"
            disabled={!nameDraft.trim()}
            onClick={() => setLocalPlayer(nameDraft.trim())}
            className="btn-neon mt-4 w-full rounded-xl px-5 py-3 font-display text-xs font-extrabold tracking-[0.25em]"
          >
            ENTER LOBBY
          </button>
        </motion.div>
      </FullScreenNotice>
    );
  }

  /* Waiting for the host's state-sync. */
  if (!game) {
    return (
      <FullScreenNotice>
        <Spinner label={`Joining ${code}…`} />
        <p className="max-w-xs text-xs text-white/40">
          Requesting game state from the host. If nothing happens, the game may no longer exist.
        </p>
        <button
          type="button"
          onClick={goHome}
          className="btn-ghost rounded-xl px-5 py-2.5 font-display text-xs font-bold tracking-[0.25em] text-white"
        >
          BACK TO HOME
        </button>
      </FullScreenNotice>
    );
  }

  if (game.phase === "lobby") {
    return (
      <>
        <LobbyView onStart={handleStart} starting={startPending} connectionStatus={connectionStatus} />
        <FxLayer />
      </>
    );
  }

  /* ================================================================ */
  /* Playing / finished                                                */
  /* ================================================================ */

  const accent = DIFFICULTY_ACCENT[game.difficulty];
  const winner = game.winnerId ? (game.players.find((p) => p.id === game.winnerId) ?? null) : null;
  const localWon = game.mode === "coop" ? true : game.winnerId === localPlayer.id;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* ---------- top HUD bar ---------- */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-black/40 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="neon-title hidden font-display text-sm font-extrabold tracking-[0.2em] sm:block">
            NEON SUDOKU
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-xs tracking-[0.3em] text-cyan-200">
            {game.code}
          </span>
          <span
            className="rounded-full border px-3 py-1 font-display text-[10px] font-bold uppercase tracking-widest"
            style={{ color: accent, borderColor: `${accent}55` }}
          >
            {game.difficulty}
          </span>
          <Timer startedAt={game.startedAt} running={game.phase === "playing"} />
          <span
            title={`Connection: ${connectionStatus}`}
            className={`h-2 w-2 rounded-full ${
              connectionStatus === "connected"
                ? "bg-emerald-400"
                : connectionStatus === "error"
                  ? "bg-red-500"
                  : "bg-amber-400 animate-pulse"
            }`}
          />

          <div className="ml-auto flex items-center gap-2">
            {/* 2D / 3D toggle */}
            <div className="flex overflow-hidden rounded-xl border border-white/10">
              {(["2d", "3d"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setViewMode(v)}
                  className={`px-3 py-1.5 font-display text-[11px] font-bold tracking-widest transition ${
                    viewMode === v
                      ? "bg-cyan-400/20 text-cyan-200 shadow-[inset_0_0_14px_-6px_#22d3ee]"
                      : "bg-transparent text-white/45 hover:text-white/80"
                  }`}
                >
                  {v.toUpperCase()}
                </button>
              ))}
            </div>
            {isHost ? (
              <button
                type="button"
                onClick={() => setConfirmEnd(true)}
                className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-1.5 font-display text-[11px] font-bold tracking-widest text-red-300 transition hover:bg-red-500/20"
              >
                END
              </button>
            ) : (
              <button
                type="button"
                onClick={goHome}
                className="btn-ghost rounded-xl px-3 py-1.5 font-display text-[11px] font-bold tracking-widest text-white/70"
              >
                LEAVE
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ---------- main area ---------- */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-6 px-4 py-6 lg:flex-row lg:items-start lg:justify-center">
        <div className="flex w-full flex-col items-center gap-5 lg:flex-1">
          <motion.div
            key={viewMode}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="flex w-full justify-center"
          >
            {viewMode === "3d" ? (
              <div
                data-board-area=""
                className="aspect-square w-full max-w-[min(92vw,560px)] overflow-hidden rounded-2xl border border-white/10 bg-black/30"
              >
                <Board3D />
              </div>
            ) : (
              <Board2D onInput={handleInput} />
            )}
          </motion.div>
          <NumberPad onInput={handleInput} disabled={game.phase !== "playing"} />
        </div>

        <aside className="w-full max-w-[min(92vw,560px)] lg:w-80 lg:max-w-none">
          <PlayersPanel />
        </aside>
      </main>

      <FxLayer />

      {/* ---------- confirm end session ---------- */}
      <AnimatePresence>
        {confirmEnd && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.92, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 12 }}
              className="glass-deep w-full max-w-sm rounded-3xl p-7"
            >
              <p className="font-display text-base font-bold tracking-widest text-white">
                END SESSION?
              </p>
              <p className="mt-2 text-sm text-white/55">
                This kills the game for everyone — there is no persistence, the board is gone for good.
              </p>
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmEnd(false)}
                  className="btn-ghost flex-1 rounded-xl px-4 py-2.5 font-display text-xs font-bold tracking-widest text-white"
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  onClick={handleEndSession}
                  className="flex-1 rounded-xl border border-red-400/40 bg-red-500/20 px-4 py-2.5 font-display text-xs font-bold tracking-widest text-red-200 transition hover:bg-red-500/30"
                >
                  END FOR ALL
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- game over overlay ---------- */}
      <AnimatePresence>
        {game.phase === "finished" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-6 backdrop-blur-[3px]"
          >
            <motion.div
              initial={{ scale: 0.85, y: 24, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 22, delay: 0.7 }}
              className="glass-deep w-full max-w-md rounded-3xl p-8 text-center"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.45em] text-white/45">
                {game.mode === "race" ? "race complete" : "board complete"}
              </p>
              <h2
                className={`mt-2 font-display text-4xl font-extrabold tracking-[0.12em] ${
                  localWon ? "neon-title" : "text-white/70"
                }`}
              >
                {game.mode === "coop" ? "TEAM CLEAR" : localWon ? "VICTORY" : "DEFEAT"}
              </h2>
              {game.mode === "race" && (
                <p className="mt-3 text-sm text-white/70">
                  {winner ? (
                    <>
                      <span
                        className="font-semibold"
                        style={{ color: winner.color, textShadow: `0 0 12px ${winner.color}88` }}
                      >
                        {winner.name}
                      </span>{" "}
                      takes the round.
                    </>
                  ) : (
                    "Round over."
                  )}
                </p>
              )}
              <div className="mt-6 flex items-center justify-center gap-3">
                <div className="rounded-xl bg-white/[0.05] px-5 py-3">
                  <p className="font-display text-2xl font-bold text-cyan-300">
                    +{xpGained(localWon, game.difficulty)}
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-white/40">
                    XP earned
                  </p>
                </div>
                {finalElapsedMs !== null && (
                  <div className="rounded-xl bg-white/[0.05] px-5 py-3">
                    <p className="font-display text-2xl font-bold text-violet-300">
                      {formatMs(finalElapsedMs)}
                    </p>
                    <p className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-white/40">
                      Time
                    </p>
                  </div>
                )}
              </div>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={goHome}
                  className="btn-ghost flex-1 rounded-xl px-5 py-3 font-display text-xs font-bold tracking-[0.2em] text-white"
                >
                  BACK TO HOME
                </button>
                {isHost && (
                  <button
                    type="button"
                    onClick={handleEndSession}
                    className="btn-neon flex-1 rounded-xl px-5 py-3 font-display text-xs font-extrabold tracking-[0.2em]"
                  >
                    NEW GAME
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
