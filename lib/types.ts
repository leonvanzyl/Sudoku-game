// ============================================================
// SHARED CONTRACTS — every module builds against these types.
// Do not fork or duplicate these definitions.
// ============================================================

export type Difficulty = "easy" | "medium" | "hard" | "expert";
export type GameMode = "coop" | "race";
export type GamePhase = "lobby" | "playing" | "finished";
export type ViewMode = "2d" | "3d";

/** 81-length array, row-major. 0 = empty, 1-9 = value. */
export type Grid = number[];

export interface PlayerInfo {
  id: string; // nanoid, persisted in localStorage
  name: string;
  color: string; // hex, assigned from PLAYER_COLORS by join order
  isHost: boolean;
}

/** One cell of the shared co-op board. */
export interface CellEntry {
  value: number; // 0 = empty
  /** playerId of whoever placed it; null for givens/empty. */
  byPlayer: string | null;
  /** Correct entries lock; wrong entries can be overwritten by anyone. */
  locked: boolean;
}

export interface RaceProgress {
  playerId: string;
  correctCount: number; // correctly filled non-given cells
  mistakes: number;
  finishedAtMs: number | null; // elapsed ms when finished, else null
}

/** Authoritative state owned by the host, broadcast via state-sync. */
export interface SharedGameState {
  code: string; // invite code, also channel suffix
  mode: GameMode;
  difficulty: Difficulty;
  phase: GamePhase;
  puzzle: Grid; // givens
  solution: Grid;
  players: PlayerInfo[];
  /** Only meaningful in co-op mode. */
  coopBoard: CellEntry[];
  /** Only meaningful in race mode. */
  raceProgress: RaceProgress[];
  startedAt: number | null; // epoch ms when phase -> playing
  winnerId: string | null;
}

// ---------------- Realtime protocol ----------------
// Ably channel name: `sudoku:${code}`. Message name = `type` field.
// Presence: each client enters with PlayerInfo as presence data.
// Host presence-leave (no rejoin within 10s) => session terminated.

export type GameMessage =
  | { type: "request-sync"; playerId: string }
  | { type: "state-sync"; state: SharedGameState }
  | { type: "start-game"; state: SharedGameState }
  | {
      // co-op: broadcast by the acting player, applied by ALL clients
      // (including sender) in Ably delivery order — last write wins.
      type: "move";
      playerId: string;
      cellIndex: number;
      value: number; // 0 = erase
    }
  | { type: "race-progress"; progress: RaceProgress }
  | { type: "race-finished"; playerId: string; elapsedMs: number }
  | { type: "game-over"; winnerId: string | null; reason: "completed" | "race-won" }
  | { type: "end-session" }; // host killed the game -> everyone leaves

// ---------------- FX event bus ----------------

export type FxEvent =
  | { type: "cell-correct"; cellIndex: number; color: string }
  | { type: "cell-wrong"; cellIndex: number }
  | { type: "unit-complete"; cells: number[]; color: string } // row/col/box finished
  | { type: "board-complete" } // co-op win / local race board done
  | { type: "victory"; winnerName: string | null } // game over celebration
  | { type: "defeat" }; // lost the race

export type FxListener = (e: FxEvent) => void;

// ---------------- Progression (localStorage) ----------------

export interface Progression {
  xp: number;
  wins: number;
  gamesPlayed: number;
  /** difficulties unlocked; easy always unlocked */
  unlocked: Difficulty[];
  bestTimesMs: Partial<Record<Difficulty, number>>;
}

// ---------------- Constants ----------------

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "expert"];

/** Givens count per difficulty (approximate targets for the generator). */
export const DIFFICULTY_GIVENS: Record<Difficulty, number> = {
  easy: 40,
  medium: 32,
  hard: 27,
  expert: 23,
};

/** XP required to unlock each difficulty. */
export const UNLOCK_XP: Record<Difficulty, number> = {
  easy: 0,
  medium: 100,
  hard: 300,
  expert: 700,
};

export const PLAYER_COLORS = [
  "#22d3ee", // cyan
  "#f472b6", // pink
  "#a3e635", // lime
  "#fb923c", // orange
  "#c084fc", // purple
  "#facc15", // yellow
  "#34d399", // emerald
  "#f87171", // red
] as const;

export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 6;

export const channelName = (code: string) => `sudoku:${code}`;

// ---------------- Store contract ----------------
// Implemented in lib/store/gameStore.ts as a zustand store:
//   export const useGameStore = create<GameStore>()(...)
// UI and realtime layers compile against this interface.

export interface GameStore {
  // --- identity ---
  localPlayer: PlayerInfo | null; // set after name entry
  setLocalPlayer: (name: string) => void; // creates/loads id, sets name

  // --- connection/session ---
  connectionStatus: "idle" | "connecting" | "connected" | "error";
  setConnectionStatus: (s: GameStore["connectionStatus"]) => void;
  /** Non-null while in a room (lobby or playing). */
  game: SharedGameState | null;
  isHost: boolean;

  /** Host: create a fresh game locally (generates code + puzzle). */
  createGame: (mode: GameMode, difficulty: Difficulty) => SharedGameState;
  /** Any client: replace full game state (from state-sync/start-game). */
  applyStateSync: (state: SharedGameState) => void;
  /** Presence changed: replace player list (host rebroadcasts state). */
  setPlayers: (players: PlayerInfo[]) => void;
  /** Leave/terminate locally: clear game back to null. */
  leaveGame: () => void;

  // --- gameplay (both modes) ---
  selectedCell: number | null;
  selectCell: (i: number | null) => void;
  /**
   * Local player inputs a number (0 = erase) into selectedCell.
   * Co-op: returns the move to publish (realtime layer publishes it),
   * or null if the move is illegal (given/locked cell, no selection).
   * Race: applies to localBoard, emits fx, updates own RaceProgress;
   * returns the race-progress/race-finished message to publish, or null.
   */
  inputNumber: (value: number) => GameMessage | null;
  /** Apply a co-op move from the channel (ALL clients, incl. sender). */
  applyMove: (playerId: string, cellIndex: number, value: number) => void;
  /** Race: apply another player's progress update. */
  applyRaceProgress: (p: RaceProgress) => void;
  /** Mark game over (any mode). */
  setGameOver: (winnerId: string | null) => void;

  /** Race mode: the local player's own board. */
  localBoard: CellEntry[];

  // --- view prefs (persisted) ---
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;

  // --- progression (persisted via lib/store/progression.ts) ---
  progression: Progression;
  /** Called on game end for the local player. */
  recordResult: (won: boolean, difficulty: Difficulty, elapsedMs: number | null) => void;
}
