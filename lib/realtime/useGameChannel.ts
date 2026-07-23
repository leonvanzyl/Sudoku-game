"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectionStateChange,
  InboundMessage,
  Realtime,
  RealtimeChannel,
} from "ably";
import {
  channelName,
  PLAYER_COLORS,
  type CellEntry,
  type GameMessage,
  type GameStore,
  type PlayerInfo,
  type RaceProgress,
  type SharedGameState,
} from "@/lib/types";
import { useGameStore } from "@/lib/store/gameStore";
import { getAblyClient } from "@/lib/realtime/ablyClient";
import { fxBus } from "@/lib/fx/bus";
import { isPetSpeciesId } from "@/lib/pets/catalog";

/** Host absent from presence for longer than this => session is over. */
const HOST_LEFT_GRACE_MS = 10_000;

/**
 * Per-tab snapshot of the host's authoritative state, keyed by invite code.
 * There is no server persistence, so an accidental page refresh would
 * otherwise wipe the only copy of the game and strand every client: the
 * refreshed host would come back with game=null / isHost=false, nobody could
 * answer request-sync, and no client could ever publish game-over.
 * sessionStorage survives a refresh but not a closed tab, which matches the
 * "host client is the authority" contract.
 */
const hostSnapshotKey = (code: string) => `sudoku:host-state:${code}`;

interface HostSnapshot {
  state: SharedGameState;
  localBoard: CellEntry[];
}

function saveHostSnapshot(code: string): void {
  const s = useGameStore.getState();
  if (!s.isHost || !s.game || s.game.code !== code) return;
  try {
    const snap: HostSnapshot = { state: s.game, localBoard: s.localBoard };
    window.sessionStorage.setItem(hostSnapshotKey(code), JSON.stringify(snap));
  } catch {
    // storage unavailable/full — refresh recovery just won't be possible
  }
}

function clearHostSnapshot(code: string): void {
  try {
    window.sessionStorage.removeItem(hostSnapshotKey(code));
  } catch {
    // ignore
  }
}

/**
 * If this tab was the host of `code` and lost its in-memory state (page
 * refresh), restore the authoritative game (and race board) before entering
 * presence, so the host re-enters flagged as host and can answer
 * request-sync again.
 */
function restoreHostSnapshot(code: string): void {
  const store = useGameStore.getState();
  if (store.game || !store.localPlayer) return;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(hostSnapshotKey(code));
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const snap = JSON.parse(raw) as Partial<HostSnapshot>;
    const state = snap?.state;
    if (!state || state.code !== code || !Array.isArray(state.players)) return;
    // Only the original host may restore authority from its own snapshot.
    const me = state.players.find((p) => p.id === store.localPlayer?.id);
    if (!me?.isHost) return;
    store.applyStateSync(state);
    if (Array.isArray(snap.localBoard) && snap.localBoard.length === 81) {
      useGameStore.setState({ localBoard: snap.localBoard });
    }
  } catch {
    // corrupt snapshot — ignore
  }
}

/**
 * Live mounts per channel name — lets the effect cleanup detach/release the
 * Ably channel only when no other mount (e.g. a strict-mode remount) is
 * still using it.
 */
const channelMounts = new Map<string, number>();

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
  /**
   * Change the local player's color: applies locally + persists, then
   * announces via presence so the host re-resolves and rebroadcasts.
   */
  setPlayerColor: (color: string) => Promise<void>;
  /** Change the local player's pet species — same flow as setPlayerColor. */
  setPlayerPet: (petId: string) => Promise<void>;
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
 *
 * Pass `enabled: false` (solo practice) to skip all realtime wiring — the
 * hook then never touches Ably and publish/endSession become no-ops; the
 * caller is expected to loop messages back into the store itself.
 */
export function useGameChannel(
  code: string,
  opts?: { enabled?: boolean },
): UseGameChannelResult {
  const enabled = opts?.enabled ?? true;
  const [sessionEnded, setSessionEnded] = useState(false);
  const sessionEndedRef = useRef(false);

  // Stable across strict-mode remounts:
  const joinOrderRef = useRef<Map<string, number>>(new Map());
  const hostClientIdRef = useRef<string | null>(null);
  const gameOverSentRef = useRef(false);
  const watchdogRef = useRef<number | null>(null);

  const localPlayerId = useGameStore(
    (s: GameStore) => s.localPlayer?.id ?? null,
  );
  const connectionStatus = useGameStore(
    (s: GameStore) => s.connectionStatus,
  );

  const endSessionLocally = useCallback(() => {
    if (sessionEndedRef.current) return;
    sessionEndedRef.current = true;
    setSessionEnded(true);
    if (code) clearHostSnapshot(code);
    useGameStore.getState().leaveGame();
  }, [code]);

  const publish = useCallback(
    async (msg: GameMessage): Promise<void> => {
      if (!enabled || typeof window === "undefined" || !code) return;
      const lp = useGameStore.getState().localPlayer;
      if (!lp) return;
      const client = await getAblyClient(lp.id);
      const channel = client.channels.get(channelName(code));
      await channel.publish(msg.type, msg);
    },
    [code, enabled],
  );

  const setPlayerColor = useCallback(
    async (color: string): Promise<void> => {
      const store = useGameStore.getState();
      store.setLocalPlayerColor(color);
      if (!enabled || typeof window === "undefined" || !code) return;
      const me = useGameStore.getState().localPlayer;
      if (!me) return;
      try {
        const client = await getAblyClient(me.id);
        await client.channels.get(channelName(code)).presence.update(me);
      } catch {
        // presence not entered yet / offline — the local update stands and
        // the next presence enter carries the persisted color anyway
      }
    },
    [code, enabled],
  );

  const setPlayerPet = useCallback(
    async (petId: string): Promise<void> => {
      const store = useGameStore.getState();
      store.setLocalPlayerPet(petId);
      if (!enabled || typeof window === "undefined" || !code) return;
      const me = useGameStore.getState().localPlayer;
      if (!me) return;
      try {
        const client = await getAblyClient(me.id);
        await client.channels.get(channelName(code)).presence.update(me);
      } catch {
        // presence not entered yet / offline — the local update stands and
        // the next presence enter carries the persisted pet anyway
      }
    },
    [code, enabled],
  );

  const endSession = useCallback(async (): Promise<void> => {
    if (!enabled) return;
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
        const client = await getAblyClient(lp.id);
        await client.channels.get(channelName(code)).presence.leave();
      } catch {
        // ignore
      }
    }
    if (code) clearHostSnapshot(code);
    useGameStore.getState().leaveGame();
  }, [code, publish, enabled]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !code) return;
    // Host refresh recovery: restore this tab's authoritative state (if any)
    // BEFORE reading localPlayer / entering presence, so the host re-enters
    // presence flagged as host.
    restoreHostSnapshot(code);
    const localPlayer = useGameStore.getState().localPlayer;
    if (!localPlayer) return;
    if (useGameStore.getState().isHost) {
      hostClientIdRef.current = localPlayer.id;
    }

    let disposed = false;
    // Acquired asynchronously in setup() — the Ably SDK is lazy-loaded so
    // the game UI paints before (and, in solo mode, without) the SDK.
    let client: Realtime | null = null;
    let channel: RealtimeChannel | null = null;
    const chanName = channelName(code);
    channelMounts.set(chanName, (channelMounts.get(chanName) ?? 0) + 1);

    // Keep the per-tab host snapshot current so a page refresh can restore
    // it. Serializing the full game state is not free, so writes only happen
    // when the snapshot's inputs (game / localBoard) actually changed, and
    // bursts collapse into one debounced write (flushed on pagehide, which
    // fires on refresh — the only navigation the snapshot must survive).
    saveHostSnapshot(code);
    let snapshotTimer: number | null = null;
    const scheduleSnapshot = () => {
      if (snapshotTimer !== null) return;
      snapshotTimer = window.setTimeout(() => {
        snapshotTimer = null;
        saveHostSnapshot(code);
      }, 400);
    };
    const flushSnapshot = () => {
      if (snapshotTimer !== null) {
        window.clearTimeout(snapshotTimer);
        snapshotTimer = null;
      }
      saveHostSnapshot(code);
    };
    const unsubscribePersist = useGameStore.subscribe((s, prev) => {
      if (s.game === prev.game && s.localBoard === prev.localBoard) return;
      scheduleSnapshot();
    });
    window.addEventListener("pagehide", flushSnapshot);

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
        if (disposed || sessionEndedRef.current || !channel) return;
        // Re-check presence: the host may have rejoined within the grace
        // period (e.g. page refresh / transient disconnect).
        let hostPresent = false;
        let checked = false;
        try {
          const members = await channel.presence.get();
          hostPresent = members.some(
            (m) => m.clientId === hostClientIdRef.current,
          );
          checked = true;
        } catch {
          // presence.get() failing means OUR connection is flaky, not that
          // the host is gone — never terminate on an unverified check.
        }
        if (disposed || sessionEndedRef.current) return;
        if (!checked) {
          // Re-arm and try again once our channel recovers.
          startWatchdog();
          return;
        }
        if (hostPresent) return;
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
              (p: RaceProgress) => p.playerId === data.playerId,
            );
            // A finished board has every non-given cell correct, so the
            // finisher's correctCount is exactly the number of blanks —
            // don't leave it at the last (stale) race-progress value.
            const totalBlanks =
              store.game?.puzzle.reduce((n, v) => n + (v === 0 ? 1 : 0), 0) ??
              0;
            const finished: RaceProgress = {
              playerId: data.playerId,
              correctCount: totalBlanks || (existing?.correctCount ?? 0),
              mistakes: existing?.mistakes ?? 0,
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
        case "pet-help": {
          // Applied like a move, in delivery order; may complete the board.
          store.applyPetHelp(data.playerId, data.cellIndex, data.value);
          checkCoopWin();
          break;
        }
        case "disaster": {
          const g = store.game;
          if (!g) break;
          if (g.mode === "coop") {
            // Wipes the shared board — ALL clients (incl. the sender) apply
            // in delivery order; applyDisaster also emits the fx.
            store.applyDisaster(
              data.playerId,
              data.kind,
              Array.isArray(data.cellIndexes) ? data.cellIndexes : [],
            );
          } else if (data.playerId !== store.localPlayer?.id) {
            // Race: the sender already wiped (and dramatized) its own board;
            // everyone else just sees what happened to them.
            const byName =
              g.players.find((p) => p.id === data.playerId)?.name ?? null;
            fxBus.emit({
              type: "disaster",
              kind: data.kind,
              cells: Array.isArray(data.cellIndexes) ? data.cellIndexes : [],
              intense: false,
              byName,
            });
          }
          break;
        }
        case "fun-settings": {
          store.applyFunSettings(data.petsEnabled, data.eventsEnabled);
          break;
        }
        case "game-over": {
          store.setGameOver(data.winnerId);
          break;
        }
        case "end-session": {
          // Ignore our own echo: the ending host has already torn down via
          // endSession() (isHost is false again by the time the echo lands).
          if (msg.clientId === localPlayer.id) break;
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
      if (!channel) return;
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
      // Host identity: prefer the member whose presence data is flagged as
      // host (the creator — or the creator re-entering after a page refresh
      // with restored state). Timestamp order alone would elect the
      // longest-present JOINER after a host refresh, stranding the session.
      const flagged = unique.find(
        (m) => (m.data as Partial<PlayerInfo> | null | undefined)?.isHost === true,
      );
      if (flagged) {
        hostClientIdRef.current = flagged.clientId;
      } else if (hostClientIdRef.current === null && unique.length > 0) {
        hostClientIdRef.current = unique[0].clientId;
      }

      const ordered = [...unique].sort(
        (a, b) =>
          (joinOrder.get(a.clientId) ?? 0) - (joinOrder.get(b.clientId) ?? 0),
      );
      // Colors: a player's presence-declared choice wins when free; ties go
      // to join order (earlier player keeps the color, later one falls back
      // to their previous color or the first unused). This keeps colors
      // stable across churn while letting players change theirs live.
      const existingColors = new Map<string, string>(
        (useGameStore.getState().game?.players ?? []).map((p) => [p.id, p.color]),
      );
      const palette = PLAYER_COLORS as readonly string[];
      const taken = new Set<string>();
      const players: PlayerInfo[] = ordered.map((m) => {
        const d = (m.data ?? {}) as Partial<PlayerInfo>;
        const idx = joinOrder.get(m.clientId) ?? 0;
        const wanted =
          typeof d.color === "string" && palette.includes(d.color) ? d.color : undefined;
        const previous = existingColors.get(m.clientId);
        let color: string | undefined;
        for (const candidate of [wanted, previous]) {
          if (candidate && !taken.has(candidate)) {
            color = candidate;
            break;
          }
        }
        if (!color) {
          color =
            palette.find((c) => !taken.has(c)) ?? palette[idx % palette.length];
        }
        taken.add(color);
        return {
          id: typeof d.id === "string" ? d.id : m.clientId,
          name: typeof d.name === "string" ? d.name : "Player",
          color,
          isHost: m.clientId === hostClientIdRef.current,
          // Requested pet rides along; uniqueness is resolved at render
          // time by assignPetSpecies (deterministic by join order).
          ...(isPetSpeciesId(d.petId) ? { petId: d.petId } : {}),
        };
      });

      // The host is authoritative for the player list (and thus colors):
      // once a game exists, non-hosts take players from the host's
      // state-sync instead of their own presence view, whose private
      // join-order map diverges after presence churn (leave + rejoin).
      const st = useGameStore.getState();
      if (st.isHost || !st.game || st.game.players.length === 0) {
        st.setPlayers(players);
      }

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
      const c = await getAblyClient(localPlayer.id);
      // Re-check `disposed` after every await: registering a handler after
      // this mount's cleanup already ran would leak it forever.
      if (disposed) return;
      client = c;
      channel = c.channels.get(chanName);
      useGameStore
        .getState()
        .setConnectionStatus(mapConnectionState(c.connection.state));
      c.connection.on(handleConnection);
      // subscribe() implicitly attaches; all of these are idempotent, so a
      // strict-mode double mount is safe.
      await channel.subscribe(handleMessage);
      if (disposed) return;
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
      unsubscribePersist();
      window.removeEventListener("pagehide", flushSnapshot);
      if (snapshotTimer !== null) {
        window.clearTimeout(snapshotTimer);
        snapshotTimer = null;
        // A pending write means the last store change was never persisted.
        saveHostSnapshot(code);
      }
      // Leaving via the UI (leaveGame ran, store cleared) means this tab no
      // longer hosts the game — drop the snapshot. On a hard refresh this
      // cleanup never runs, which is exactly when the snapshot must survive.
      if (!useGameStore.getState().game) clearHostSnapshot(code);
      channelMounts.set(chanName, Math.max(0, (channelMounts.get(chanName) ?? 1) - 1));
      // If setup() is still awaiting the SDK, there is nothing to tear down:
      // its post-await disposed checks prevent any late registration.
      const c = client;
      const ch = channel;
      if (!c || !ch) return;
      c.connection.off(handleConnection);
      ch.unsubscribe(handleMessage);
      ch.presence.unsubscribe(handlePresence);
      ch.presence
        .leave()
        .catch(() => {})
        .finally(() => {
          // Fully detach + release the channel once no mount uses it, so a
          // tab that left the game stops receiving the room's traffic. A
          // strict-mode remount bumps the count synchronously and skips this.
          if ((channelMounts.get(chanName) ?? 0) > 0) return;
          ch
            .detach()
            .catch(() => {})
            .finally(() => {
              if ((channelMounts.get(chanName) ?? 0) === 0) {
                try {
                  c.channels.release(chanName);
                } catch {
                  // ignore — releasing a non-detached channel can throw
                }
              }
            });
        });
    };
  }, [code, localPlayerId, publish, endSessionLocally, enabled]);

  return {
    publish,
    endSession,
    setPlayerColor,
    setPlayerPet,
    connectionStatus,
    sessionEnded,
  };
}
