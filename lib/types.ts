// ============================================================
// SHARED CONTRACTS — every module builds against these types.
// Do not fork or duplicate these definitions.
// ============================================================

export type Difficulty = "easy" | "medium" | "hard" | "expert";
export type GameMode = "coop" | "race";
export type GamePhase = "lobby" | "playing" | "finished";

/** Cosmetic random events broadcast by the host mid-game. */
export type DisasterKind =
  | "earthquake"
  | "meteor-shower"
  | "blizzard"
  | "tornado"
  | "lightning";

export const DISASTER_KINDS: DisasterKind[] = [
  "earthquake",
  "meteor-shower",
  "blizzard",
  "tornado",
  "lightning",
];

/** 81-length array, row-major. 0 = empty, 1-9 = value. */
export type Grid = number[];

export interface PlayerInfo {
  id: string; // nanoid, persisted in localStorage
  name: string;
  color: string; // hex, assigned from PLAYER_COLORS by join order
  isHost: boolean;
  /**
   * Requested pet species id (lib/pets/catalog). Optional; conflicts are
   * resolved deterministically by join order in assignPetSpecies, so two
   * players never end up with the same pet.
   */
  petId?: string;
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
  /** Host-toggleable: pixel pets that wander the board and help out. */
  petsEnabled: boolean;
  /** Host-toggleable: random cosmetic disaster events. */
  eventsEnabled: boolean;
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
  | {
      // co-op: host-published — a player's pet fills one empty cell with the
      // correct value (value always equals solution[cellIndex]).
      type: "pet-help";
      playerId: string; // the pet's owner; the entry is attributed to them
      cellIndex: number;
      value: number;
    }
  | { type: "disaster"; kind: DisasterKind } // host-published cosmetic event
  | {
      // host-published when toggling the fun extras mid-game
      type: "fun-settings";
      petsEnabled: boolean;
      eventsEnabled: boolean;
    }
  | { type: "end-session" }; // host killed the game -> everyone leaves

// ---------------- FX event bus ----------------

export type FxEvent =
  | { type: "cell-correct"; cellIndex: number; color: string }
  | { type: "cell-wrong"; cellIndex: number }
  | { type: "unit-complete"; cells: number[]; color: string } // row/col/box finished
  | { type: "board-complete" } // co-op win / local race board done
  | { type: "victory"; winnerName: string | null } // game over celebration
  | { type: "defeat" } // lost the race
  | { type: "pet-help"; cellIndex: number; ownerId: string; color: string } // a pet filled a cell
  | { type: "disaster"; kind: DisasterKind }; // random event visuals

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

// NOTE: deliberately no reds/pinks — those read as "error" on the board.
export const PLAYER_COLORS = [
  "#22d3ee", // cyan
  "#a78bfa", // violet
  "#a3e635", // lime
  "#fbbf24", // amber
  "#60a5fa", // blue
  "#34d399", // emerald
  "#fb923c", // orange
  "#e879f9", // fuchsia
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
  /** Persist + apply the player's chosen color (from PLAYER_COLORS). */
  setLocalPlayerColor: (color: string) => void;
  /** Persist + apply the player's chosen pet species (from PET_SPECIES). */
  setLocalPlayerPet: (petId: string) => void;

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
  /** Co-op: apply a host-published pet-help (ALL clients, incl. host). */
  applyPetHelp: (playerId: string, cellIndex: number, value: number) => void;
  /**
   * Race: the local player's pet fills one random empty cell with the
   * correct value. Returns the race-progress message to publish, or null
   * (not in a race, board nearly done — pets never steal the endgame).
   */
  petAssistLocal: () => GameMessage | null;
  /** Apply the host's fun-settings toggle (pets / random events). */
  applyFunSettings: (petsEnabled: boolean, eventsEnabled: boolean) => void;
  /** Mark game over (any mode). */
  setGameOver: (winnerId: string | null) => void;

  /** Race mode: the local player's own board. */
  localBoard: CellEntry[];

  // --- progression (persisted via lib/store/progression.ts) ---
  progression: Progression;
  /** Called on game end for the local player. */
  recordResult: (won: boolean, difficulty: Difficulty, elapsedMs: number | null) => void;
}
