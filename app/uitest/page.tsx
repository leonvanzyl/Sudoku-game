"use client";

// TEMPORARY review-only harness page. Seeds the store with a local race game
// so the playing-phase UI can be exercised without a live Ably connection.
// DELETE AFTER REVIEW.

import { useEffect, useState } from "react";
import { useGameStore } from "@/lib/store/gameStore";
import GameShell from "@/components/GameShell";

export default function UITestPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const s = useGameStore.getState();
    s.setLocalPlayer("Tester");
    const state = s.createGame("race", "easy");
    s.applyStateSync({ ...state, phase: "playing", startedAt: Date.now() - 65_000 });
    (window as unknown as Record<string, unknown>).__store = useGameStore;
    setReady(true);
  }, []);
  if (!ready) return null;
  return <GameShell code={useGameStore.getState().game?.code ?? "UITEST"} />;
}
