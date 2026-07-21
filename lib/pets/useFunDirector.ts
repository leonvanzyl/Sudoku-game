"use client";

// ============================================================
// useFunDirector — schedules the "fun extras" while a game is
// playing, using the same publish path as normal gameplay (so it
// works over Ably and through GameShell's solo loopback alike):
//   - co-op pet help: HOST picks a random player's pet + a random
//     empty cell and publishes `pet-help` (all clients apply it in
//     delivery order, so everyone agrees).
//   - race pet help: EVERY client's own pet occasionally fills a
//     cell on its own local board via the store, publishing the
//     resulting race-progress.
//   - disasters: HOST publishes a random cosmetic `disaster`.
// ============================================================

import { useEffect } from "react";
import { DISASTER_KINDS, type GameMessage } from "@/lib/types";
import { useGameStore } from "@/lib/store/gameStore";

const COOP_PET_HELP_MS: [number, number] = [30_000, 65_000];
const RACE_PET_HELP_MS: [number, number] = [40_000, 75_000];
const DISASTER_MS: [number, number] = [45_000, 90_000];

const randDelay = ([min, max]: [number, number]) =>
  min + Math.random() * (max - min);

/**
 * Repeating randomized timer that survives across ticks; `fn` runs only
 * while the effect is live. Returns the cleanup for useEffect.
 */
function everyRandom(range: [number, number], fn: () => void): () => void {
  let cancelled = false;
  let id = 0;
  const arm = () => {
    id = window.setTimeout(() => {
      if (cancelled) return;
      fn();
      arm();
    }, randDelay(range));
  };
  arm();
  return () => {
    cancelled = true;
    window.clearTimeout(id);
  };
}

export function useFunDirector(publish: (msg: GameMessage) => Promise<void>) {
  const phase = useGameStore((s) => s.game?.phase ?? null);
  const mode = useGameStore((s) => s.game?.mode ?? null);
  const isHost = useGameStore((s) => s.isHost);
  const petsEnabled = useGameStore((s) => s.game?.petsEnabled ?? true);
  const eventsEnabled = useGameStore((s) => s.game?.eventsEnabled ?? true);

  /* ---- co-op pet help (host only) ---- */
  useEffect(() => {
    if (phase !== "playing" || mode !== "coop" || !isHost || !petsEnabled) return;
    return everyRandom(COOP_PET_HELP_MS, () => {
      const g = useGameStore.getState().game;
      if (!g || g.phase !== "playing" || !g.petsEnabled || g.players.length === 0)
        return;
      const empty: number[] = [];
      for (let i = 0; i < 81; i++) {
        const cell = g.coopBoard[i];
        if (g.puzzle[i] === 0 && cell && !cell.locked && cell.value === 0) {
          empty.push(i);
        }
      }
      // Pets never steal the endgame — leave the last cells to the humans.
      if (empty.length <= 3) return;
      const owner = g.players[Math.floor(Math.random() * g.players.length)];
      const cellIndex = empty[Math.floor(Math.random() * empty.length)];
      void publish({
        type: "pet-help",
        playerId: owner.id,
        cellIndex,
        value: g.solution[cellIndex],
      });
    });
  }, [phase, mode, isHost, petsEnabled, publish]);

  /* ---- race pet help (every client, own board) ---- */
  useEffect(() => {
    if (phase !== "playing" || mode !== "race" || !petsEnabled) return;
    return everyRandom(RACE_PET_HELP_MS, () => {
      const s = useGameStore.getState();
      if (s.game?.phase !== "playing" || !s.game.petsEnabled) return;
      const msg = s.petAssistLocal();
      if (msg) void publish(msg);
    });
  }, [phase, mode, petsEnabled, publish]);

  /* ---- random disasters (host only) ---- */
  useEffect(() => {
    if (phase !== "playing" || !isHost || !eventsEnabled) return;
    return everyRandom(DISASTER_MS, () => {
      const g = useGameStore.getState().game;
      if (!g || g.phase !== "playing" || !g.eventsEnabled) return;
      const kind = DISASTER_KINDS[Math.floor(Math.random() * DISASTER_KINDS.length)];
      void publish({ type: "disaster", kind });
    });
  }, [phase, isHost, eventsEnabled, publish]);
}
