// Progression persistence + XP rules.
// XP: win = 60, loss/participation = 15, scaled x1 / x1.5 / x2 / x3 by
// difficulty. Unlocks are derived from total XP via UNLOCK_XP.
// SSR-safe: never touches localStorage on the server.

import {
  DIFFICULTIES,
  UNLOCK_XP,
  type Difficulty,
  type Progression,
} from "@/lib/types";

const STORAGE_KEY = "sudoku:progression";

export const XP_WIN = 60;
export const XP_LOSS = 15;

export const XP_DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  easy: 1,
  medium: 1.5,
  hard: 2,
  expert: 3,
};

/** XP awarded for one finished game. */
export function xpForResult(won: boolean, difficulty: Difficulty): number {
  return Math.round((won ? XP_WIN : XP_LOSS) * XP_DIFFICULTY_MULTIPLIER[difficulty]);
}

/** Difficulties unlocked at a given XP total (easy is always unlocked). */
export function unlockedForXp(xp: number): Difficulty[] {
  return DIFFICULTIES.filter((d) => xp >= UNLOCK_XP[d]);
}

export function defaultProgression(): Progression {
  return {
    xp: 0,
    wins: 0,
    gamesPlayed: 0,
    unlocked: unlockedForXp(0),
    bestTimesMs: {},
  };
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Load persisted progression; returns defaults on the server or bad data. */
export function loadProgression(): Progression {
  const ls = storage();
  if (!ls) return defaultProgression();
  const raw = ls.getItem(STORAGE_KEY);
  if (!raw) return defaultProgression();
  try {
    const parsed = JSON.parse(raw) as Partial<Progression>;
    const xp = typeof parsed.xp === "number" && parsed.xp >= 0 ? parsed.xp : 0;
    const bestTimesMs: Partial<Record<Difficulty, number>> = {};
    if (parsed.bestTimesMs && typeof parsed.bestTimesMs === "object") {
      for (const d of DIFFICULTIES) {
        const t = parsed.bestTimesMs[d];
        if (typeof t === "number" && t > 0) bestTimesMs[d] = t;
      }
    }
    return {
      xp,
      wins: typeof parsed.wins === "number" && parsed.wins >= 0 ? parsed.wins : 0,
      gamesPlayed:
        typeof parsed.gamesPlayed === "number" && parsed.gamesPlayed >= 0
          ? parsed.gamesPlayed
          : 0,
      unlocked: unlockedForXp(xp), // always derived, never trusted from disk
      bestTimesMs,
    };
  } catch {
    return defaultProgression();
  }
}

/** Persist progression. No-op on the server. */
export function saveProgression(p: Progression): void {
  storage()?.setItem(STORAGE_KEY, JSON.stringify(p));
}

/** Pure: add XP and recompute unlocks. Caller persists via saveProgression. */
export function addXp(p: Progression, amount: number): Progression {
  const xp = p.xp + Math.max(0, amount);
  return { ...p, xp, unlocked: unlockedForXp(xp) };
}
