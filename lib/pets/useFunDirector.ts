"use client";

// ============================================================
// useFunDirector — turns the local player's move outcomes into
// the "fun extras", using the same publish path as normal
// gameplay (so it works over Ably and through GameShell's solo
// loopback alike):
//   - pet help: after one of YOUR correct placements there is a
//     small chance your pet places a bonus correct number too
//     (`petAssistLocal` builds the message for either mode).
//   - disasters: one of YOUR wrong placements can trigger a
//     natural disaster that wipes 1-3 correct numbers — from the
//     shared board in co-op, from your own board in a race
//     (`disasterLocal` builds the messages).
// Both listen to the fx bus: cell-correct / cell-wrong events are
// only ever emitted for the local player's own placements, so
// exactly one client rolls the dice per move.
// ============================================================

import { useEffect } from "react";
import { DISASTER_KINDS, type GameMessage } from "@/lib/types";
import { fxBus } from "@/lib/fx/bus";
import { useGameStore } from "@/lib/store/gameStore";

/** Chance a correct placement summons your pet's bonus number. */
const PET_HELP_CHANCE = 0.05;
/** Chance a wrong placement triggers a disaster. */
const DISASTER_CHANCE = 0.15;

// Reactions are delayed a beat so they read as consequences of the move —
// and so the store mutation never happens re-entrantly inside the fx
// dispatch of the move being applied.
const PET_HELP_DELAY_MS = 650;
const DISASTER_DELAY_MS = 500;

export function useFunDirector(publish: (msg: GameMessage) => Promise<void>) {
  const phase = useGameStore((s) => s.game?.phase ?? null);

  useEffect(() => {
    if (phase !== "playing") return;
    const timeouts = new Set<number>();
    const later = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        timeouts.delete(id);
        fn();
      }, ms);
      timeouts.add(id);
    };

    const unsubscribe = fxBus.on((e) => {
      if (e.type === "cell-correct") {
        if (Math.random() >= PET_HELP_CHANCE) return;
        later(PET_HELP_DELAY_MS, () => {
          const s = useGameStore.getState();
          if (s.game?.phase !== "playing" || !s.game.petsEnabled) return;
          const msg = s.petAssistLocal();
          if (msg) void publish(msg);
        });
      } else if (e.type === "cell-wrong") {
        if (Math.random() >= DISASTER_CHANCE) return;
        const kind =
          DISASTER_KINDS[Math.floor(Math.random() * DISASTER_KINDS.length)];
        later(DISASTER_DELAY_MS, () => {
          const s = useGameStore.getState();
          if (s.game?.phase !== "playing" || !s.game.eventsEnabled) return;
          for (const msg of s.disasterLocal(kind)) void publish(msg);
        });
      }
    });

    return () => {
      unsubscribe();
      for (const id of timeouts) window.clearTimeout(id);
    };
  }, [phase, publish]);
}
