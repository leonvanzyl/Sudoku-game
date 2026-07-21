// ============================================================
// fx bus — tiny typed event emitter for game effects.
// SSR-safe (no window/document access), no React.
// Producers: lib/store/gameStore.ts (move outcomes).
// Consumers: components/fx/FxLayer.tsx, components/board3d/*.
// ============================================================

import type { FxEvent, FxListener } from "@/lib/types";

const listeners = new Set<FxListener>();

export const fxBus = {
  /** Broadcast an effect event to all current subscribers. */
  emit(e: FxEvent): void {
    // Copy so listeners that unsubscribe (or subscribe) during dispatch
    // don't mutate the set mid-iteration.
    for (const fn of Array.from(listeners)) {
      try {
        fn(e);
      } catch {
        // A broken listener must never take down the game loop.
      }
    }
  },

  /** Subscribe. Returns an unsubscribe function. */
  on(fn: FxListener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
