// Zustand game store — implements the GameStore contract from lib/types.ts.
// Uses the sudoku engine for puzzles/validation and emits FxEvents on the
// fx bus at move outcomes. SSR-safe: browser APIs only behind guards that
// run lazily or return defaults on the server.

import { create } from "zustand";
import { customAlphabet } from "nanoid";
import {
  DISASTER_WIPE_COUNT,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  PLAYER_COLORS,
  type CellEntry,
  type GameStore,
  type Grid,
  type PlayerInfo,
  type RaceProgress,
  type SharedGameState,
} from "@/lib/types";
import { generatePuzzle, getCompletedUnits, isComplete } from "@/lib/sudoku";
import { fxBus } from "@/lib/fx/bus";
import {
  getOrCreateLocalPlayerId,
  loadPlayerName,
  loadPreferredColor,
  loadPreferredPet,
  savePlayerName,
  savePreferredColor,
  savePreferredPet,
} from "./localPlayer";
import {
  addXp,
  loadProgression,
  saveProgression,
  xpForResult,
} from "./progression";

const generateInviteCode = customAlphabet(INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH);

// ---------------- helpers ----------------

function boardFromPuzzle(puzzle: Grid): CellEntry[] {
  return puzzle.map((v) => ({ value: v, byPlayer: null, locked: v !== 0 }));
}

function gridOf(board: CellEntry[]): Grid {
  return board.map((c) => c.value);
}

/** Units fully correct in `after` that were not fully correct in `before`. */
function newlyCompletedUnits(before: Grid, after: Grid, solution: Grid): number[][] {
  const prev = new Set(getCompletedUnits(before, solution).map((u) => u.join(",")));
  return getCompletedUnits(after, solution).filter((u) => !prev.has(u.join(",")));
}

/**
 * Pick up to `count` distinct cells a disaster may wipe: locked entries only
 * (correct placements by players or pets). Wiping the wrong entry that
 * triggered the disaster would be mercy, not a penalty — and givens are
 * untouchable.
 */
function pickWipeCells(board: CellEntry[], puzzle: Grid, count: number): number[] {
  const candidates: number[] = [];
  for (let i = 0; i < 81; i++) {
    const cell = board[i];
    if (puzzle[i] === 0 && cell && cell.locked && cell.value !== 0) {
      candidates.push(i);
    }
  }
  // Partial Fisher-Yates: the first `count` slots end up uniformly random.
  const n = Math.min(count, candidates.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (candidates.length - i));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, n);
}

// Content-equality helpers used to keep existing object references when a
// host rebroadcast carries no actual change — an echo state-sync then leaves
// subscribers' selector results identical and React skips the re-render.

function sameCell(a: CellEntry, b: CellEntry): boolean {
  return a.value === b.value && a.byPlayer === b.byPlayer && a.locked === b.locked;
}

function sameProgress(a: RaceProgress, b: RaceProgress): boolean {
  return (
    a.playerId === b.playerId &&
    a.correctCount === b.correctCount &&
    a.mistakes === b.mistakes &&
    a.finishedAtMs === b.finishedAtMs
  );
}

function samePlayers(a: PlayerInfo[], b: PlayerInfo[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.color !== y.color ||
      x.isHost !== y.isHost ||
      x.petId !== y.petId
    ) {
      return false;
    }
  }
  return true;
}

function upsertProgress(list: RaceProgress[], p: RaceProgress): RaceProgress[] {
  const idx = list.findIndex((e) => e.playerId === p.playerId);
  if (idx === -1) return [...list, p];
  const next = list.slice();
  next[idx] = p;
  return next;
}

/**
 * Merge an incoming (host) race-progress list into the current one for a
 * mid-game state-sync. The local player's own entry is authoritative locally,
 * and for other players we never regress: a finished entry beats an
 * unfinished one, and a higher correctCount beats a stale lower one. Entries
 * only known locally are kept.
 */
function mergeRaceProgress(
  current: RaceProgress[],
  incoming: RaceProgress[],
  localPlayerId: string | null,
): RaceProgress[] {
  const currentById = new Map(current.map((p) => [p.playerId, p] as const));
  const merged = incoming.map((inc) => {
    const cur = currentById.get(inc.playerId);
    if (!cur) return inc;
    if (localPlayerId !== null && inc.playerId === localPlayerId) return cur;
    if (cur.finishedAtMs !== null && inc.finishedAtMs === null) return cur;
    if (inc.finishedAtMs === null && cur.correctCount > inc.correctCount) return cur;
    return sameProgress(cur, inc) ? cur : inc;
  });
  const incomingIds = new Set(incoming.map((p) => p.playerId));
  for (const cur of current) {
    if (!incomingIds.has(cur.playerId)) merged.push(cur);
  }
  // No entry changed (an echo snapshot): keep the current array reference.
  if (
    merged.length === current.length &&
    merged.every((p, i) => p === current[i])
  ) {
    return current;
  }
  return merged;
}

/**
 * Merge an incoming (host) co-op board into the current one for a mid-game
 * state-sync. The host composes its snapshot before its publish is
 * serialized, so a move ordered ahead of the snapshot (and already applied
 * locally in delivery order) may be missing from it — never let the snapshot
 * revert such moves. Incoming locked (correct) entries are always adopted;
 * otherwise locally-known values win over the snapshot.
 */
function mergeCoopBoard(current: CellEntry[], incoming: CellEntry[]): CellEntry[] {
  if (current.length !== incoming.length) return incoming;
  let changed = false;
  const merged = incoming.map((inc, i) => {
    const cur = current[i];
    let out: CellEntry;
    if (inc.locked) out = inc; // solution-correct — safe to adopt
    else if (cur.locked || cur.value !== inc.value) out = cur;
    else out = inc;
    // Adopting an entry with identical content: keep the current reference.
    if (out === inc && sameCell(cur, inc)) out = cur;
    if (out !== cur) changed = true;
    return out;
  });
  // No cell changed (an echo snapshot): keep the current array reference.
  return changed ? merged : current;
}

/**
 * Rehydrate the persisted { id, name } identity on the client so returning
 * players are not re-prompted for a name. Null on the server and for
 * first-time visitors (name entry then goes through setLocalPlayer).
 */
function initialLocalPlayer(): PlayerInfo | null {
  if (typeof window === "undefined") return null;
  const name = loadPlayerName();
  if (!name) return null;
  return {
    id: getOrCreateLocalPlayerId(),
    name,
    color: loadPreferredColor() ?? PLAYER_COLORS[0],
    isHost: false,
    petId: loadPreferredPet() ?? undefined,
  };
}

/**
 * Guard so recordResult runs exactly once per game for the local player,
 * even if setGameOver is invoked multiple times (duplicate game-over
 * messages, host + local detection, etc.). Module-level on purpose: it is
 * per-client bookkeeping, not part of the GameStore contract surface.
 */
let recordedGameCode: string | null = null;

// ---------------- store ----------------

export const useGameStore = create<GameStore>()((set, get) => ({
  // --- identity ---
  localPlayer: initialLocalPlayer(),
  setLocalPlayer: (name) => {
    const id = getOrCreateLocalPlayerId();
    savePlayerName(name);
    const prev = get().localPlayer;
    set({
      localPlayer: {
        id,
        name,
        color: prev?.color ?? loadPreferredColor() ?? PLAYER_COLORS[0],
        isHost: prev?.isHost ?? false,
        petId: prev?.petId ?? loadPreferredPet() ?? undefined,
      },
    });
  },

  setLocalPlayerColor: (color) => {
    savePreferredColor(color);
    const { localPlayer, game } = get();
    if (!localPlayer) return;
    const me = { ...localPlayer, color };
    set({
      localPlayer: me,
      // Update our own roster entry immediately (the realtime layer
      // separately announces the change via presence for other clients).
      ...(game
        ? {
            game: {
              ...game,
              players: game.players.map((p) => (p.id === me.id ? { ...p, color } : p)),
            },
          }
        : {}),
    });
  },

  setLocalPlayerPet: (petId) => {
    savePreferredPet(petId);
    const { localPlayer, game } = get();
    if (!localPlayer) return;
    const me = { ...localPlayer, petId };
    set({
      localPlayer: me,
      // Same shape as setLocalPlayerColor: local roster entry updates
      // immediately, presence announces it to the room.
      ...(game
        ? {
            game: {
              ...game,
              players: game.players.map((p) => (p.id === me.id ? { ...p, petId } : p)),
            },
          }
        : {}),
    });
  },

  // --- connection/session ---
  connectionStatus: "idle",
  setConnectionStatus: (s) => set({ connectionStatus: s }),

  game: null,
  isHost: false,

  createGame: (mode, difficulty) => {
    const local = get().localPlayer;
    if (!local) {
      throw new Error("createGame requires setLocalPlayer to have been called");
    }
    const { puzzle, solution } = generatePuzzle(difficulty);
    const host: PlayerInfo = { ...local, isHost: true };
    const state: SharedGameState = {
      code: generateInviteCode(),
      mode,
      difficulty,
      phase: "lobby",
      puzzle,
      solution,
      players: [host],
      coopBoard: boardFromPuzzle(puzzle),
      raceProgress: [],
      startedAt: null,
      winnerId: null,
      petsEnabled: true,
      eventsEnabled: true,
    };
    recordedGameCode = null;
    set({
      game: state,
      isHost: true,
      localPlayer: host,
      localBoard: boardFromPuzzle(puzzle),
      selectedCell: null,
    });
    return state;
  },

  applyStateSync: (state) => {
    // Snapshots from before the fun-extras flags existed default them on.
    state = {
      ...state,
      petsEnabled: state.petsEnabled ?? true,
      eventsEnabled: state.eventsEnabled ?? true,
    };
    const { game, localPlayer, isHost } = get();
    const isNewGame = !game || game.code !== state.code;
    // A finished game never reverts to a live one: a snapshot composed in the
    // window before the host's game-over echo would otherwise un-finish the
    // game locally with no recovery path.
    if (!isNewGame && game.phase === "finished" && state.phase !== "finished") {
      return;
    }
    const me = localPlayer
      ? state.players.find((p) => p.id === localPlayer.id) ?? null
      : null;
    // Mid-game rebroadcasts are merged, not applied wholesale: the snapshot
    // may predate moves/progress already applied locally in delivery order.
    // Sub-objects keep their current references when content is unchanged
    // (puzzle/solution never change mid-game), so components subscribed to
    // them skip re-rendering on echo snapshots.
    const next: SharedGameState = isNewGame
      ? state
      : {
          ...state,
          puzzle: game.puzzle,
          solution: game.solution,
          players: samePlayers(game.players, state.players)
            ? game.players
            : state.players,
          coopBoard:
            state.mode === "coop"
              ? mergeCoopBoard(game.coopBoard, state.coopBoard)
              : state.coopBoard,
          raceProgress:
            state.mode === "race"
              ? mergeRaceProgress(
                  game.raceProgress,
                  state.raceProgress,
                  localPlayer?.id ?? null,
                )
              : state.raceProgress,
        };
    // A snapshot that changes nothing keeps the whole game object identity.
    const unchanged =
      !isNewGame &&
      next.players === game.players &&
      next.coopBoard === game.coopBoard &&
      next.raceProgress === game.raceProgress &&
      next.phase === game.phase &&
      next.startedAt === game.startedAt &&
      next.winnerId === game.winnerId &&
      next.petsEnabled === game.petsEnabled &&
      next.eventsEnabled === game.eventsEnabled;
    const localChanged =
      me && localPlayer
        ? me.color !== localPlayer.color || me.isHost !== localPlayer.isHost
        : false;
    set({
      game: unchanged ? game : next,
      isHost: me ? me.isHost : isHost,
      localPlayer:
        me && localPlayer && localChanged
          ? { ...localPlayer, color: me.color, isHost: me.isHost }
          : localPlayer,
      // Race boards are local-only: initialize on entering a game, but never
      // wipe local entries when the host rebroadcasts state mid-game.
      ...(isNewGame
        ? { localBoard: boardFromPuzzle(state.puzzle), selectedCell: null }
        : {}),
    });
  },

  setPlayers: (players) => {
    const { game, localPlayer } = get();
    const me = localPlayer
      ? players.find((p) => p.id === localPlayer.id) ?? null
      : null;
    // Presence churn often re-resolves to an identical roster — keep the
    // existing references so nothing re-renders.
    const rosterChanged = !game || !samePlayers(game.players, players);
    const localChanged =
      me && localPlayer
        ? me.color !== localPlayer.color || me.isHost !== localPlayer.isHost
        : false;
    set({
      ...(game && rosterChanged ? { game: { ...game, players } } : {}),
      ...(me && localPlayer && localChanged
        ? { localPlayer: { ...localPlayer, color: me.color, isHost: me.isHost } }
        : {}),
      ...(me ? { isHost: me.isHost } : {}),
    });
  },

  leaveGame: () => {
    set({
      game: null,
      isHost: false,
      selectedCell: null,
      localBoard: [],
      connectionStatus: "idle",
    });
  },

  // --- gameplay ---
  selectedCell: null,
  selectCell: (i) => set({ selectedCell: i }),

  inputNumber: (value) => {
    const { game, localPlayer, selectedCell } = get();
    if (!game || !localPlayer || game.phase !== "playing") return null;
    if (selectedCell === null) return null;
    if (!Number.isInteger(value) || value < 0 || value > 9) return null;
    const i = selectedCell;
    if (game.puzzle[i] !== 0) return null; // givens are immutable

    if (game.mode === "coop") {
      const cell = game.coopBoard[i];
      if (cell.locked) return null; // correct entries lock
      // Never applied locally — every client (incl. sender) applies the echo
      // via applyMove in Ably delivery order.
      return { type: "move", playerId: localPlayer.id, cellIndex: i, value };
    }

    // --- race: apply to localBoard immediately ---
    const board = get().localBoard;
    const cell = board[i];
    if (!cell || cell.locked) return null;
    if (cell.value === value) return null; // no-op

    const before = gridOf(board);
    const correct = value !== 0 && game.solution[i] === value;
    const nextBoard = board.slice();
    nextBoard[i] =
      value === 0
        ? { value: 0, byPlayer: null, locked: false }
        : { value, byPlayer: localPlayer.id, locked: correct };
    const after = gridOf(nextBoard);

    if (value !== 0) {
      if (correct) {
        fxBus.emit({ type: "cell-correct", cellIndex: i, color: localPlayer.color });
        for (const cells of newlyCompletedUnits(before, after, game.solution)) {
          fxBus.emit({ type: "unit-complete", cells, color: localPlayer.color });
        }
      } else {
        fxBus.emit({ type: "cell-wrong", cellIndex: i });
      }
    }

    const prevProgress = game.raceProgress.find((p) => p.playerId === localPlayer.id);
    const mistakes =
      (prevProgress?.mistakes ?? 0) + (value !== 0 && !correct ? 1 : 0);
    const correctCount = after.reduce(
      (n, v, idx) =>
        n + (game.puzzle[idx] === 0 && v !== 0 && v === game.solution[idx] ? 1 : 0),
      0,
    );
    const finished = isComplete(after, game.solution);
    const elapsedMs = game.startedAt !== null ? Date.now() - game.startedAt : 0;
    const progress: RaceProgress = {
      playerId: localPlayer.id,
      correctCount,
      mistakes,
      finishedAtMs: finished ? elapsedMs : prevProgress?.finishedAtMs ?? null,
    };
    set({
      localBoard: nextBoard,
      game: { ...game, raceProgress: upsertProgress(game.raceProgress, progress) },
    });

    if (finished) {
      fxBus.emit({ type: "board-complete" });
      return { type: "race-finished", playerId: localPlayer.id, elapsedMs };
    }
    return { type: "race-progress", progress };
  },

  applyMove: (playerId, cellIndex, value) => {
    const { game, localPlayer } = get();
    if (!game || game.mode !== "coop" || game.phase !== "playing") return;
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 80) return;
    if (!Number.isInteger(value) || value < 0 || value > 9) return;
    if (game.puzzle[cellIndex] !== 0) return; // givens are immutable
    const cell = game.coopBoard[cellIndex];
    if (cell.locked) return; // locked entries cannot be overwritten or erased

    // Last write wins: applied unconditionally in Ably delivery order.
    const before = gridOf(game.coopBoard);
    const correct = value !== 0 && game.solution[cellIndex] === value;
    const nextBoard = game.coopBoard.slice();
    nextBoard[cellIndex] =
      value === 0
        ? { value: 0, byPlayer: null, locked: false }
        : { value, byPlayer: playerId, locked: correct };
    const after = gridOf(nextBoard);
    set({ game: { ...game, coopBoard: nextBoard } });

    const isLocal = localPlayer !== null && playerId === localPlayer.id;
    const color =
      game.players.find((p) => p.id === playerId)?.color ?? PLAYER_COLORS[0];
    if (value !== 0) {
      if (correct) {
        // cell-correct/cell-wrong only for the local player's own placements.
        if (isLocal) {
          fxBus.emit({ type: "cell-correct", cellIndex, color });
        }
        for (const cells of newlyCompletedUnits(before, after, game.solution)) {
          fxBus.emit({ type: "unit-complete", cells, color });
        }
        if (isComplete(after, game.solution)) {
          fxBus.emit({ type: "board-complete" });
        }
      } else if (isLocal) {
        fxBus.emit({ type: "cell-wrong", cellIndex });
      }
    }
  },

  applyRaceProgress: (p) => {
    const { game, localPlayer } = get();
    if (!game || game.mode !== "race") return;
    // Own progress is authoritative locally; ignore echoes of our messages.
    if (localPlayer && p.playerId === localPlayer.id) return;
    set({ game: { ...game, raceProgress: upsertProgress(game.raceProgress, p) } });
  },

  applyPetHelp: (playerId, cellIndex, value) => {
    const { game } = get();
    if (!game || game.mode !== "coop" || game.phase !== "playing") return;
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 80) return;
    if (game.puzzle[cellIndex] !== 0) return;
    const cell = game.coopBoard[cellIndex];
    // Pets only fill cells still empty on arrival (a player may have raced
    // the pet to it in delivery order) and never place a wrong value.
    if (!cell || cell.locked || cell.value !== 0) return;
    if (value !== game.solution[cellIndex]) return;

    const before = gridOf(game.coopBoard);
    const nextBoard = game.coopBoard.slice();
    nextBoard[cellIndex] = { value, byPlayer: playerId, locked: true };
    const after = gridOf(nextBoard);
    set({ game: { ...game, coopBoard: nextBoard } });

    const color =
      game.players.find((p) => p.id === playerId)?.color ?? PLAYER_COLORS[0];
    fxBus.emit({ type: "pet-help", cellIndex, ownerId: playerId, color });
    for (const cells of newlyCompletedUnits(before, after, game.solution)) {
      fxBus.emit({ type: "unit-complete", cells, color });
    }
    if (isComplete(after, game.solution)) {
      fxBus.emit({ type: "board-complete" });
    }
  },

  petAssistLocal: () => {
    const { game, localPlayer } = get();
    if (!game || !localPlayer || game.phase !== "playing") return null;
    const board = game.mode === "coop" ? game.coopBoard : get().localBoard;
    const empty: number[] = [];
    for (let i = 0; i < 81; i++) {
      const cell = board[i];
      if (game.puzzle[i] === 0 && cell && !cell.locked && cell.value === 0) {
        empty.push(i);
      }
    }
    // Pets never steal the endgame — leave the last few cells to the human.
    if (empty.length <= 3) return null;
    const i = empty[Math.floor(Math.random() * empty.length)];
    const value = game.solution[i];

    if (game.mode === "coop") {
      // Never applied locally — all clients (incl. sender) apply the echo
      // via applyPetHelp in Ably delivery order.
      return { type: "pet-help", playerId: localPlayer.id, cellIndex: i, value };
    }

    const before = gridOf(board);
    const nextBoard = board.slice();
    nextBoard[i] = { value, byPlayer: localPlayer.id, locked: true };
    const after = gridOf(nextBoard);

    fxBus.emit({
      type: "pet-help",
      cellIndex: i,
      ownerId: localPlayer.id,
      color: localPlayer.color,
    });
    for (const cells of newlyCompletedUnits(before, after, game.solution)) {
      fxBus.emit({ type: "unit-complete", cells, color: localPlayer.color });
    }

    const prev = game.raceProgress.find((p) => p.playerId === localPlayer.id);
    const correctCount = after.reduce(
      (n, v, idx) =>
        n + (game.puzzle[idx] === 0 && v !== 0 && v === game.solution[idx] ? 1 : 0),
      0,
    );
    const progress: RaceProgress = {
      playerId: localPlayer.id,
      correctCount,
      mistakes: prev?.mistakes ?? 0,
      finishedAtMs: prev?.finishedAtMs ?? null,
    };
    set({
      localBoard: nextBoard,
      game: { ...game, raceProgress: upsertProgress(game.raceProgress, progress) },
    });
    return { type: "race-progress", progress };
  },

  disasterLocal: (kind) => {
    const { game, localPlayer } = get();
    if (!game || !localPlayer || game.phase !== "playing") return [];
    const count = DISASTER_WIPE_COUNT[kind] ?? 1;

    if (game.mode === "coop") {
      const cells = pickWipeCells(game.coopBoard, game.puzzle, count);
      if (cells.length === 0) return [];
      // Never applied locally — all clients (incl. sender) wipe the echo
      // via applyDisaster in Ably delivery order.
      return [
        { type: "disaster", kind, playerId: localPlayer.id, cellIndexes: cells },
      ];
    }

    // --- race: wipe the local player's own board immediately ---
    const board = get().localBoard;
    const cells = pickWipeCells(board, game.puzzle, count);
    if (cells.length === 0) return [];
    const nextBoard = board.slice();
    for (const i of cells) {
      nextBoard[i] = { value: 0, byPlayer: null, locked: false };
    }
    const after = gridOf(nextBoard);

    const prev = game.raceProgress.find((p) => p.playerId === localPlayer.id);
    const correctCount = after.reduce(
      (n, v, idx) =>
        n + (game.puzzle[idx] === 0 && v !== 0 && v === game.solution[idx] ? 1 : 0),
      0,
    );
    const progress: RaceProgress = {
      playerId: localPlayer.id,
      correctCount,
      mistakes: prev?.mistakes ?? 0,
      finishedAtMs: prev?.finishedAtMs ?? null,
    };
    set({
      localBoard: nextBoard,
      game: { ...game, raceProgress: upsertProgress(game.raceProgress, progress) },
    });
    fxBus.emit({ type: "disaster", kind, cells, intense: true, byName: null });
    return [
      { type: "disaster", kind, playerId: localPlayer.id, cellIndexes: cells },
      { type: "race-progress", progress },
    ];
  },

  applyDisaster: (playerId, kind, cellIndexes) => {
    const { game, localPlayer } = get();
    if (!game || game.mode !== "coop" || game.phase !== "playing") return;
    if (!Array.isArray(cellIndexes)) return;
    const wiped: number[] = [];
    const nextBoard = game.coopBoard.slice();
    for (const i of cellIndexes) {
      if (!Number.isInteger(i) || i < 0 || i > 80) continue;
      if (game.puzzle[i] !== 0) continue; // givens survive anything
      if (!nextBoard[i] || nextBoard[i].value === 0) continue;
      nextBoard[i] = { value: 0, byPlayer: null, locked: false };
      wiped.push(i);
    }
    if (wiped.length > 0) {
      set({ game: { ...game, coopBoard: nextBoard } });
    }
    const byName =
      localPlayer !== null && playerId === localPlayer.id
        ? null
        : game.players.find((p) => p.id === playerId)?.name ?? null;
    fxBus.emit({ type: "disaster", kind, cells: wiped, intense: true, byName });
  },

  applyFunSettings: (petsEnabled, eventsEnabled) => {
    const { game } = get();
    if (!game) return;
    set({ game: { ...game, petsEnabled, eventsEnabled } });
  },

  setGameOver: (winnerId) => {
    const { game, localPlayer } = get();
    if (!game) return;
    const alreadyFinished = game.phase === "finished";
    set({ game: { ...game, phase: "finished", winnerId } });
    if (alreadyFinished) return;

    // Co-op: completing the board is a shared win for everyone.
    const won =
      game.mode === "coop" ? true : localPlayer !== null && winnerId === localPlayer.id;
    const winnerName =
      winnerId === null
        ? null
        : game.players.find((p) => p.id === winnerId)?.name ?? null;
    fxBus.emit(won ? { type: "victory", winnerName } : { type: "defeat" });

    // Record the result exactly once per game for the local player. In race
    // mode prefer the elapsed time captured when the local player actually
    // finished, not Date.now() at game-over delivery (publish round-trip).
    if (recordedGameCode !== game.code) {
      recordedGameCode = game.code;
      const own = localPlayer
        ? game.raceProgress.find((p) => p.playerId === localPlayer.id)
        : undefined;
      const elapsedMs =
        game.mode === "race" && own?.finishedAtMs != null
          ? own.finishedAtMs
          : game.startedAt !== null
            ? Date.now() - game.startedAt
            : null;
      get().recordResult(won, game.difficulty, elapsedMs);
    }
  },

  localBoard: [],

  // --- progression ---
  progression: loadProgression(),
  recordResult: (won, difficulty, elapsedMs) => {
    let next = addXp(get().progression, xpForResult(won, difficulty));
    next = {
      ...next,
      wins: next.wins + (won ? 1 : 0),
      gamesPlayed: next.gamesPlayed + 1,
    };
    if (won && elapsedMs !== null && elapsedMs > 0) {
      const best = next.bestTimesMs[difficulty];
      if (best === undefined || elapsedMs < best) {
        next = {
          ...next,
          bestTimesMs: { ...next.bestTimesMs, [difficulty]: elapsedMs },
        };
      }
    }
    saveProgression(next);
    set({ progression: next });
  },
}));
