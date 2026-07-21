"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import ColorPicker from "@/components/ColorPicker";
import HowToPlay from "@/components/HowToPlay";
import { loadPreferredColor } from "@/lib/store/localPlayer";
import {
  DIFFICULTIES,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  UNLOCK_XP,
  type Difficulty,
  type GameMode,
} from "@/lib/types";
import { useGameStore } from "@/lib/store/gameStore";

/* ---------------------------------------------------------------- */
/* Presentation metadata                                             */
/* ---------------------------------------------------------------- */

const MODE_META: Record<
  GameMode,
  { label: string; tagline: string; description: string }
> = {
  coop: {
    label: "Co-op",
    tagline: "One board, one team",
    description:
      "Everyone solves the same board together. Correct entries lock in for the whole team.",
  },
  race: {
    label: "Race",
    tagline: "Same puzzle, first to finish",
    description:
      "Each player gets their own copy of the puzzle. First to complete it wins the round.",
  },
};

const DIFFICULTY_META: Record<
  Difficulty,
  { label: string; accent: string; note: string; multiplier: string }
> = {
  easy: { label: "Easy", accent: "#a3e635", note: "Warm-up grids", multiplier: "×1 XP" },
  medium: { label: "Medium", accent: "#22d3ee", note: "A real think", multiplier: "×1.5 XP" },
  hard: { label: "Hard", accent: "#facc15", note: "Sparse clues", multiplier: "×2 XP" },
  expert: { label: "Expert", accent: "#f472b6", note: "For the fearless", multiplier: "×3 XP" },
};

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function sanitizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .split("")
    .filter((c) => INVITE_CODE_ALPHABET.includes(c))
    .join("")
    .slice(0, INVITE_CODE_LENGTH);
}

/* ---------------------------------------------------------------- */
/* Small inline icons (no icon deps)                                 */
/* ---------------------------------------------------------------- */

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
};

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
/* Page                                                              */
/* ---------------------------------------------------------------- */

export default function Home() {
  const router = useRouter();
  const localPlayer = useGameStore((s) => s.localPlayer);
  const setLocalPlayer = useGameStore((s) => s.setLocalPlayer);
  const setLocalPlayerColor = useGameStore((s) => s.setLocalPlayerColor);
  const progression = useGameStore((s) => s.progression);

  const mounted = useMounted();
  // null until the user types — falls back to the persisted name post-hydration.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [mode, setMode] = useState<GameMode>("coop");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [nameError, setNameError] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const [colorDraft, setColorDraft] = useState<string | null>(null);

  const name = nameDraft ?? (mounted ? (localPlayer?.name ?? "") : "");
  const trimmedName = name.trim();

  const commitName = (): boolean => {
    if (!trimmedName) {
      setNameError(true);
      return false;
    }
    setLocalPlayer(trimmedName);
    return true;
  };

  const handleCreate = () => {
    if (busy || !commitName()) return;
    const unlocked = progression.unlocked.includes(difficulty);
    if (!unlocked) return;
    setBusy("create");
    try {
      const state = useGameStore.getState().createGame(mode, difficulty);
      router.push(`/game/${state.code}`);
    } catch {
      setBusy(null);
    }
  };

  const handleJoin = () => {
    if (busy || joinCode.length !== INVITE_CODE_LENGTH || !commitName()) return;
    setBusy("join");
    router.push(`/game/${joinCode}`);
  };

  /** Offline practice: create + start locally, no realtime involved. */
  const handleSolo = () => {
    if (busy || !commitName()) return;
    if (!progression.unlocked.includes(difficulty)) return;
    setBusy("create");
    try {
      const s = useGameStore.getState();
      const state = s.createGame("coop", difficulty);
      s.applyStateSync({ ...state, phase: "playing", startedAt: Date.now() });
      router.push(`/game/${state.code}?solo=1`);
    } catch {
      setBusy(null);
    }
  };

  const bestTimes = useMemo(
    () =>
      DIFFICULTIES.filter((d) => progression.bestTimesMs[d] !== undefined).map(
        (d) => ({ d, ms: progression.bestTimesMs[d] as number }),
      ),
    [progression.bestTimesMs],
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-4 pb-16 pt-14 sm:px-6 md:pt-20">
      {/* -------- Hero -------- */}
      <motion.div
        {...fadeUp}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="text-center"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.5em] text-cyan-300/70">
          realtime multiplayer
        </p>
        <h1 className="neon-title mt-3 font-display text-[clamp(2rem,8.5vw,4.5rem)] font-extrabold tracking-[0.06em] sm:tracking-[0.08em]">
          NEON&nbsp;SUDOKU
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-white/60 sm:text-base">
          Solve one board together in <span className="text-cyan-300">co-op</span>, or take
          the same puzzle head-to-head in a <span className="text-pink-300">race</span>.
          Invite friends with a 6-letter code.
        </p>
        <button
          type="button"
          onClick={() => setShowHowTo(true)}
          className="btn-ghost mt-5 rounded-xl px-5 py-2.5 font-display text-[11px] font-bold tracking-[0.25em] text-cyan-200/90 transition hover:text-cyan-100"
        >
          ？ HOW TO PLAY
        </button>
      </motion.div>

      {/* -------- Name -------- */}
      <motion.div
        {...fadeUp}
        transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
        className="glass mt-10 w-full max-w-xl rounded-2xl p-5"
      >
        <label
          htmlFor="player-name"
          className="font-mono text-[10px] uppercase tracking-[0.35em] text-white/50"
        >
          Your callsign
        </label>
        <input
          id="player-name"
          value={name}
          maxLength={20}
          placeholder="Enter your name…"
          onChange={(e) => {
            setNameDraft(e.target.value);
            if (e.target.value.trim()) setNameError(false);
          }}
          onBlur={() => {
            if (trimmedName) setLocalPlayer(trimmedName);
          }}
          className={`mt-2 w-full rounded-xl border bg-black/30 px-4 py-3 font-display text-lg tracking-wider text-white outline-none transition placeholder:text-white/25 focus:border-cyan-400/60 focus:shadow-[0_0_24px_-8px_#22d3ee] ${
            nameError ? "border-red-500/70" : "border-white/10"
          }`}
        />
        {nameError && (
          <p className="mt-2 text-xs text-red-400">Enter a name first — your team needs to know who you are.</p>
        )}
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.35em] text-white/50">
          Your color
        </p>
        <ColorPicker
          className="mt-2"
          value={colorDraft ?? (mounted ? (localPlayer?.color ?? loadPreferredColor()) : null)}
          onChange={(c) => {
            setColorDraft(c);
            setLocalPlayerColor(c);
          }}
        />
      </motion.div>

      {/* -------- Panels -------- */}
      <div className="mt-8 grid w-full gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* Create */}
        <motion.section
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0.18, ease: "easeOut" }}
          className="glass rounded-3xl p-6 sm:p-8"
        >
          <h2 className="font-display text-xl font-bold tracking-widest text-white">
            CREATE GAME
          </h2>
          <p className="mt-1 text-sm text-white/50">Pick a mode and difficulty, then rally your crew.</p>

          {/* mode toggle */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {(Object.keys(MODE_META) as GameMode[]).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    active
                      ? "border-cyan-400/60 bg-cyan-400/10 shadow-[0_0_30px_-10px_#22d3ee]"
                      : "border-white/10 bg-white/[0.03] hover:border-white/25"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display text-sm font-bold tracking-widest text-white">
                      {MODE_META[m].label.toUpperCase()}
                    </span>
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        active ? "bg-cyan-300 animate-glow-pulse" : "bg-white/20"
                      }`}
                    />
                  </div>
                  <p className="mt-1 text-xs font-medium text-cyan-200/70">{MODE_META[m].tagline}</p>
                  <p className="mt-2 text-xs leading-relaxed text-white/50">
                    {MODE_META[m].description}
                  </p>
                </button>
              );
            })}
          </div>

          {/* difficulty */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DIFFICULTIES.map((d) => {
              const meta = DIFFICULTY_META[d];
              // Gate on `mounted` so SSR markup (default progression) matches
              // the first client render — real values appear after hydration.
              const unlocked = !mounted ? d === "easy" : progression.unlocked.includes(d);
              const active = difficulty === d;
              const xpNeeded = Math.max(0, UNLOCK_XP[d] - (mounted ? progression.xp : 0));
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!unlocked}
                  onClick={() => setDifficulty(d)}
                  className={`relative overflow-hidden rounded-2xl border p-4 text-left transition ${
                    active && unlocked
                      ? "bg-white/[0.07]"
                      : "bg-white/[0.02] hover:bg-white/[0.05]"
                  } ${unlocked ? "" : "cursor-not-allowed"}`}
                  style={{
                    borderColor: active && unlocked ? meta.accent : "rgba(255,255,255,0.1)",
                    boxShadow:
                      active && unlocked ? `0 0 28px -10px ${meta.accent}` : undefined,
                  }}
                >
                  <span
                    className="font-display text-sm font-bold tracking-wider"
                    style={{ color: unlocked ? meta.accent : "rgba(255,255,255,0.35)" }}
                  >
                    {meta.label}
                  </span>
                  <p className="mt-1 text-[11px] text-white/45">{meta.note}</p>
                  <p className="mt-2 font-mono text-[10px] tracking-wider text-white/35">
                    {meta.multiplier}
                  </p>
                  {!unlocked && (
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 backdrop-blur-[2px]">
                      <LockIcon className="h-4 w-4 text-white/60" />
                      <span className="font-mono text-[10px] tracking-wider text-white/70">
                        {UNLOCK_XP[d]} XP
                      </span>
                      <span className="font-mono text-[9px] text-white/40">
                        {xpNeeded} to go
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={busy !== null}
            className="btn-neon mt-7 w-full rounded-2xl px-6 py-4 font-display text-sm font-extrabold tracking-[0.25em]"
          >
            {busy === "create" ? "GENERATING PUZZLE…" : "LAUNCH GAME"}
          </button>
          <button
            type="button"
            onClick={handleSolo}
            disabled={busy !== null}
            className="btn-ghost mt-3 w-full rounded-2xl px-6 py-3 font-display text-xs font-bold tracking-[0.25em] text-white/70 transition hover:text-white"
          >
            PRACTICE SOLO — NO FRIENDS NEEDED
          </button>
        </motion.section>

        {/* Right column: join + profile */}
        <div className="flex flex-col gap-6">
          <motion.section
            {...fadeUp}
            transition={{ duration: 0.6, delay: 0.26, ease: "easeOut" }}
            className="glass rounded-3xl p-6 sm:p-8"
          >
            <h2 className="font-display text-xl font-bold tracking-widest text-white">
              JOIN GAME
            </h2>
            <p className="mt-1 text-sm text-white/50">Got a code? Punch it in.</p>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(sanitizeCode(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleJoin();
              }}
              placeholder="ABC234"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="code-glow mt-5 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center font-mono text-2xl font-bold uppercase tracking-[0.5em] text-cyan-200 outline-none transition placeholder:text-white/15 placeholder:[text-shadow:none] focus:border-cyan-400/60"
            />
            <button
              type="button"
              onClick={handleJoin}
              disabled={busy !== null || joinCode.length !== INVITE_CODE_LENGTH}
              className="btn-ghost mt-4 w-full rounded-2xl px-6 py-3.5 font-display text-sm font-bold tracking-[0.25em] text-white"
            >
              {busy === "join" ? "JOINING…" : "JOIN"}
            </button>
          </motion.section>

          <motion.section
            {...fadeUp}
            transition={{ duration: 0.6, delay: 0.34, ease: "easeOut" }}
            className="glass rounded-3xl p-6 sm:p-8"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold tracking-widest text-white/80">
                PILOT PROFILE
              </h2>
              {mounted && localPlayer?.name && (
                <span className="max-w-[10rem] truncate font-mono text-xs text-cyan-300/80">
                  {localPlayer.name}
                </span>
              )}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-white/[0.04] p-3">
                <p className="font-display text-xl font-bold text-cyan-300">
                  {mounted ? progression.xp : 0}
                </p>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-white/40">XP</p>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-3">
                <p className="font-display text-xl font-bold text-pink-300">
                  {mounted ? progression.wins : 0}
                </p>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-white/40">Wins</p>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-3">
                <p className="font-display text-xl font-bold text-violet-300">
                  {mounted ? progression.gamesPlayed : 0}
                </p>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-white/40">Games</p>
              </div>
            </div>
            <div className="mt-4">
              <p className="font-mono text-[9px] uppercase tracking-widest text-white/40">Best times</p>
              {mounted && bestTimes.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {bestTimes.map(({ d, ms }) => (
                    <span
                      key={d}
                      className="rounded-full border border-white/10 bg-black/30 px-3 py-1 font-mono text-[11px]"
                      style={{ color: DIFFICULTY_META[d].accent }}
                    >
                      {DIFFICULTY_META[d].label} · {formatMs(ms)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-white/35">No clears yet — go set one.</p>
              )}
            </div>
          </motion.section>
        </div>
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 1 }}
        className="mt-12 font-mono text-[10px] uppercase tracking-[0.4em] text-white/25"
      >
        host is authority · no accounts · session dies with the host
      </motion.p>

      <AnimatePresence>
        {showHowTo && <HowToPlay onClose={() => setShowHowTo(false)} />}
      </AnimatePresence>
    </main>
  );
}
