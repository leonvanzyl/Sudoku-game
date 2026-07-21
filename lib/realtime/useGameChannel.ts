"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectionStateChange,
  InboundMessage,
  RealtimeChannel,
} from "ably";
import {
  channelName,
  PLAYER_COLORS,
  type GameMessage,
  type GameStore,
  type PlayerInfo,
  type RaceProgress,
} from "@/lib/types";
import { useGameStore } from "@/lib/store/gameStore";
import { getAblyClient } from "@/lib/realtime/ablyClient";

/** Host absent from presence for longer than this => session is over. */
const HOST_LEFT_GRACE_MS = 10_000;

type ConnectionStatus = GameStore["connectionStatus"];

function mapConnectionState(state: string): ConnectionStatus {
  switch (state) {
    case "connected":
      return "connected";
    case "failed":
      return "error";
    case "closing":
    case "closed":
      return "idle";
    // initialized / connecting / disconnected / suspended => retrying
    default:
      return "connecting";
  }
}

export interface UseGameChannelResult {
  /** Publish a GameMessage to the room channel (message name = msg.type). */
  publish: (msg: GameMessage) => Promise<void>;
  /** Host only: broadcast end-session, then leave the room locally. */
  endSession: () => Promise<void>;
  connectionStatus: ConnectionStatus;
  /** True once the session was terminated (host left / end-session). */
  sessionEnded: boolean;
}

/**
 * The multiplayer wiring for one game room. Attaches to `sudoku:<code>`,
 * enters presence with the local PlayerInfo, dispatches every incoming
 * GameMessage to the matching useGameStore action, keeps the player list in
 * sync with presence (join order = color order, first member = host), and
 * implements the host's authority duties (answer request-sync, rebroadcast
 * state on presence changes, publish game-over on win) plus the client-side
 * host-left watchdog.
 */
export function useGameChannel(code: string): UseGameChannelResult {
  const [sessionEnded, setSessionEnded] = useState(false);
  const sessionEndedRef = useRef(false);

  // Stable across strict-mode remounts:
  const joinOrderRef = useRef<Map<string, number>>(new Map());
  const hostClientIdRef = useRef<string | null>(null);
  const gameOverSentRef = useRef(false);
  const watchdogRef = useRef<number | null>(null);

  const localPlayerId = useGameStore((s) => s.localPlayer?.id ?? null);
  const connectionStatus = useGameStore((s) => s.connectionStatus);

  const endSessionLocally = useCallback(() => {
    if (sessionEndedRef.current) return;
    sessionEndedRef.current = true;
    setSessionEnded(true);
    useGameStore.getState().leaveGame();
  }, []);

  const publish = useCallback(
    async (msg: GameMessage): Promise<void> => {
      if (typeof window === "undefined" || !code) return;
      const lp = useGameStore.getState().localPlayer;
      if (!lp) return;
      const channel = getAblyClient(lp.id).channels.get(channelName(code));
      await channel.publish(msg.type, msg);
    },
    [code],
  );

  const endSession = useCallback(async (): Promise<void> => {
    const store = useGameStore.getState();
    if (!store.isHost) return;
    try {
      await publish({ type: "end-session" });
    } catch {
      // best effort — still tear down locally
    }
    const lp = store.localPlayer;
    if (lp && typeof window !== "undefined" && code) {
      try {
        await getAblyClient(lp.id)
          .channels.get(channelName(code))
          .presence.leave();
      } catch {
        // ignore
      }
    }
    useGameStore.getState().leaveGame();
  }, [code, publish]);

  useEffect(() => {
    if (typeof window === "undefined" || !code) return;
    const localPlayer = useGameStore.getState().localPlayer;
    if (!localPlayer) return;

    let disposed = false;
    const client = getAblyClient(localPlayer.id);
    const channel: RealtimeChannel = client.channels.get(channelName(code));

    const clearWatchdog = () => {
      if (watchdogRef.current !== null) {
        window.clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
    };

    const startWatchdog = () => {
      if (watchdogRef.current !== null || sessionEndedRef.current) return;
      watchdogRef.current = window.setTimeout(async () => {
        watchdogRef.current = null;
        if (disposed || sessionEndedRef.current) return;
        // Re-check presence: the host may have rejoined within the grace
        // period (e.g. page refresh / transient disconnect).
        let hostPresent = false;
        try {
          const members = await channel.presence.get();
          hostPresent = members.some(
            (m) => m.clientId === hostClientIdRef.current,
          );
        } catch {
          hostPresent = false;
        }
        if (disposed || sessionEndedRef.current || hostPresent) return;
        endSessionLocally();
      }, HOST_LEFT_GRACE_MS);
    };

    const hostPublishGameOver = (
      winnerId: string | null,
      reason: "completed" | "race-won",
    ) => {
      if (gameOverSentRef.current) return;
      gameOverSentRef.current = true;
      publish({ type: "game-over", winnerId, reason }).catch(() => {
        gameOverSentRef.current = false;
      });
    };

    /** Host: after any co-op move, publish game-over if the board is done. */
    const checkCoopWin = () => {
      const s = useGameStore.getState();
      const g = s.game;
      if (!s.isHost || !g) return;
      if (g.mode !== "coop" || g.phase !== "playing" || g.winnerId !== null)
        return;
      for (let i = 0; i < 81; i++) {
        const value = g.coopBoard[i]?.value || g.puzzle[i];
        if (value !== g.solution[i]) return;
      }
      hostPublishGameOver(null, "completed");
    };

    const handleMessage = (msg: InboundMessage) => {
      const data = msg.data as GameMessage | undefined;
      if (!data || typeof data !== "object" || typeof data.type !== "string")
        return;
      const store = useGameStore.getState();
      switch (data.type) {
        case "request-sync": {
          if (store.isHost && store.game) {
            publish({ type: "state-sync", state: store.game }).catch(() => {});
          }
          break;
        }
        case "state-sync": {
          // The host is the authority — it never applies its own snapshots.
          if (!store.isHost) store.applyStateSync(data.state);
          break;
        }
        case "start-game": {
          store.applyStateSync(data.state);
          break;
        }
        case "move": {
          // ALL clients (including the sender) apply moves in delivery order.
          store.applyMove(data.playerId, data.cellIndex, data.value);
          checkCoopWin();
          break;
        }
        case "race-progress": {
          if (data.progress.playerId !== store.localPlayer?.id) {
            store.applyRaceProgress(data.progress);
          }
          break;
        }
        case "race-finished": {
          if (data.playerId !== store.localPlayer?.id) {
            const existing = store.game?.raceProgress.find(
              (p) => p.playerId === data.playerId,
            );
            const finished: RaceProgress = existing
              ? { ...existing, finishedAtMs: data.elapsedMs }
              : {
                  playerId: data.playerId,
                  correctCount: 0,
                  mistakes: 0,
                  finishedAtMs: data.elapsedMs,
                };
            store.applyRaceProgress(finished);
          }
          // Host: first race-finished in delivery order wins the race.
          const s = useGameStore.getState();
          if (
            s.isHost &&
            s.game &&
            s.game.mode === "race" &&
            s.game.phase === "playing" &&
            s.game.winnerId === null
          ) {
            hostPublishGameOver(data.playerId, "race-won");
          }
          break;
        }
        case "game-over": {
          store.setGameOver(data.winnerId);
          break;
        }
        case "end-session": {
          if (!store.isHost) {
            clearWatchdog();
            endSessionLocally();
          }
          break;
        }
      }
    };

    /**
     * Rebuild the player list from presence, ordered by join time
     * (presence timestamp; ties broken by first-seen order which is kept
     * stable across rebuilds). First-ever member = host; colors assigned
     * by join order from PLAYER_COLORS.
     */
    const rebuildPlayers = async () => {
      let members;
      try {
        members = await channel.presence.get();
      } catch {
        return;
      }
      if (disposed) return;

      const sorted = [...members].sort((a, b) => a.timestamp - b.timestamp);
      const seen = new Set<string>();
      const unique = sorted.filter((m) => {
        if (!m.clientId || seen.has(m.clientId)) return false;
        seen.add(m.clientId);
        return true;
      });

      const joinOrder = joinOrderRef.current;
      for (const m of unique) {
        if (!joinOrder.has(m.clientId)) joinOrder.set(m.clientId, joinOrder.size);
      }
      if (hostClientIdRef.current === null && unique.length > 0) {
        hostClientIdRef.current = unique[0].clientId;
      }

      const ordered = [...unique].sort(
        (a, b) =>
          (joinOrder.get(a.clientId) ?? 0) - (joinOrder.get(b.clientId) ?? 0),
      );
      const players: PlayerInfo[] = ordered.map((m) => {
        const d = (m.data ?? {}) as Partial<PlayerInfo>;
        const idx = joinOrder.get(m.clientId) ?? 0;
        return {
          id: typeof d.id === "string" ? d.id : m.clientId,
          name: typeof d.name === "string" ? d.name : "Player",
          color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
          isHost: m.clientId === hostClientIdRef.current,
        };
      });

      useGameStore.getState().setPlayers(players);

      // Host rebroadcasts authoritative state on every presence change.
      const after = useGameStore.getState();
      if (after.isHost && after.game) {
        publish({ type: "state-sync", state: after.game }).catch(() => {});
      }

      // Host-left watchdog (clients only).
      const hostId = hostClientIdRef.current;
      const selfIsHost =
        after.isHost || (hostId !== null && localPlayer.id === hostId);
      const hostPresent =
        hostId !== null && unique.some((m) => m.clientId === hostId);
      if (!selfIsHost && hostId !== null && !hostPresent) {
        startWatchdog();
      } else if (hostPresent) {
        clearWatchdog();
      }
    };

    const handlePresence = () => {
      void rebuildPlayers();
    };

    const handleConnection = (change: ConnectionStateChange) => {
      useGameStore
        .getState()
        .setConnectionStatus(mapConnectionState(change.current));
    };

    const setup = async () => {
      useGameStore
        .getState()
        .setConnectionStatus(mapConnectionState(client.connection.state));
      client.connection.on(handleConnection);
      // subscribe() implicitly attaches; all of these are idempotent, so a
      // strict-mode double mount is safe.
      await channel.subscribe(handleMessage);
      await channel.presence.subscribe(handlePresence);
      if (disposed) return;
      await channel.presence.enter(localPlayer);
      if (disposed) return;
      await rebuildPlayers();
      if (disposed || sessionEndedRef.current) return;
      // Joiner asks the host for the current state.
      if (!useGameStore.getState().isHost) {
        await publish({ type: "request-sync", playerId: localPlayer.id });
      }
    };

    setup().catch(() => {
      if (!disposed) useGameStore.getState().setConnectionStatus("error");
    });

    return () => {
      disposed = true;
      clearWatchdog();
      client.connection.off(handleConnection);
      channel.unsubscribe(handleMessage);
      channel.presence.unsubscribe(handlePresence);
      channel.presence.leave().catch(() => {});
    };
  }, [code, localPlayerId, publish, endSessionLocally]);

  return { publish, endSession, connectionStatus, sessionEnded };
}
