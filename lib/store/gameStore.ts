// Zustand game store — implements the GameStore contract from lib/types.ts.
// Uses the sudoku engine for puzzles/validation and emits FxEvents on the
// fx bus at move outcomes. SSR-safe: browser APIs only behind guards that
// run lazily or return defaults on the server.

import { create } from "zustand";
import { customAlphabet } from "nanoid";
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  PLAYER_COLORS,
  type CellEntry,
  type GameStore,
  type Grid,
  type PlayerInfo,
  type RaceProgress,
  type SharedGameState,
  type ViewMode,
} from "@/lib/types";
import { generatePuzzle, getCompletedUnits, isComplete } from "@/lib/sudoku";
import { fxBus } from "@/lib/fx/bus";
import {
  getOrCreateLocalPlayerId,
  loadPlayerName,
  savePlayerName,
} from "./localPlayer";
import {
  addXp,
  loadProgression,
  saveProgression,
  xpForResult,
} from "./progression";

const VIEW_MODE_KEY = "sudoku:view-mode";

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

function upsertProgress(list: RaceProgress[], p: RaceProgress): RaceProgress[] {
  const idx = list.findIndex((e) => e.playerId === p.playerId);
  if (idx === -1) return [...list, p];
  const next = list.slice();
  next[idx] = p;
  return next;
}

function initialViewMode(): ViewMode {
  if (typeof window === "undefined") return "2d";
  try {
    const saved = window.localStorage.getItem(VIEW_MODE_KEY);
    if (saved === "2d" || saved === "3d") return saved;
  } catch {
    // storage unavailable — fall through to media query default
  }
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(min-width: 768px)").matches
    ? "3d"
    : "2d";
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
    color: PLAYER_COLORS[0],
    isHost: false,
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
        color: prev?.color ?? PLAYER_COLORS[0],
        isHost: prev?.isHost ?? false,
      },
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
    const host: PlayerInfo = { ...local, color: PLAYER_COLORS[0], isHost: true };
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
    const { game, localPlayer, isHost } = get();
    const isNewGame = !game || game.code !== state.code;
    const me = localPlayer
      ? state.players.find((p) => p.id === localPlayer.id) ?? null
      : null;
    set({
      game: state,
      isHost: me ? me.isHost : isHost,
      localPlayer:
        me && localPlayer
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
    set({
      ...(game ? { game: { ...game, players } } : {}),
      ...(me && localPlayer
        ? {
            localPlayer: { ...localPlayer, color: me.color, isHost: me.isHost },
            isHost: me.isHost,
          }
        : {}),
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

    // Record the result exactly once per game for the local player.
    if (recordedGameCode !== game.code) {
      recordedGameCode = game.code;
      const elapsedMs = game.startedAt !== null ? Date.now() - game.startedAt : null;
      get().recordResult(won, game.difficulty, elapsedMs);
    }
  },

  localBoard: [],

  // --- view prefs ---
  viewMode: initialViewMode(),
  setViewMode: (v) => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(VIEW_MODE_KEY, v);
      } catch {
        // storage unavailable — keep in-memory only
      }
    }
    set({ viewMode: v });
  },

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
