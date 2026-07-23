import { beforeEach, describe, expect, it } from "vitest";
import {
  DISASTER_WIPE_COUNT,
  type CellEntry,
  type GameMode,
  type Grid,
  type PlayerInfo,
  type SharedGameState,
} from "../types";
import { useGameStore } from "./gameStore";

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

/** A valid solved grid: value = ((row*3 + row/3 + col) % 9) + 1. */
const SOLUTION: Grid = Array.from({ length: 81 }, (_, i) => {
  const r = Math.floor(i / 9);
  const c = i % 9;
  return ((r * 3 + Math.floor(r / 3) + c) % 9) + 1;
});

const ME: PlayerInfo = { id: "me", name: "Me", color: "#22d3ee", isHost: true };
const PAL: PlayerInfo = { id: "pal", name: "Pal", color: "#a78bfa", isHost: false };

const boardOf = (puzzle: Grid): CellEntry[] =>
  puzzle.map((v) => ({ value: v, byPlayer: null, locked: v !== 0 }));

/**
 * Puts the store into a playing game where every third cell is a blank
 * (27 blanks) and both the co-op and race boards start as bare givens.
 */
function setupGame(mode: GameMode): SharedGameState {
  const puzzle = SOLUTION.map((v, i) => (i % 3 === 0 ? 0 : v));
  const game: SharedGameState = {
    code: "TEST01",
    mode,
    difficulty: "easy",
    phase: "playing",
    puzzle,
    solution: SOLUTION,
    players: [ME, PAL],
    coopBoard: boardOf(puzzle),
    raceProgress: [],
    startedAt: Date.now(),
    winnerId: null,
    petsEnabled: true,
    eventsEnabled: true,
  };
  useGameStore.setState({
    localPlayer: ME,
    isHost: true,
    game,
    localBoard: boardOf(puzzle),
    selectedCell: null,
  });
  return game;
}

/** Marks `indexes` as correct (locked) player entries on the given board. */
function fillCorrect(board: CellEntry[], indexes: number[], byPlayer = "me"): void {
  for (const i of indexes) {
    board[i] = { value: SOLUTION[i], byPlayer, locked: true };
  }
}

const blanks = (puzzle: Grid): number[] =>
  puzzle.flatMap((v, i) => (v === 0 ? [i] : []));

beforeEach(() => {
  useGameStore.setState({ game: null, localBoard: [], localPlayer: null });
});

// ---------------------------------------------------------------
// petAssistLocal
// ---------------------------------------------------------------

describe("petAssistLocal", () => {
  it("co-op: returns a pet-help message for an empty cell without touching the board", () => {
    const game = setupGame("coop");
    const before = useGameStore.getState().game!.coopBoard;
    const msg = useGameStore.getState().petAssistLocal();
    expect(msg).not.toBeNull();
    if (msg?.type !== "pet-help") throw new Error(`expected pet-help, got ${msg?.type}`);
    expect(msg.playerId).toBe("me");
    expect(game.puzzle[msg.cellIndex]).toBe(0);
    expect(msg.value).toBe(SOLUTION[msg.cellIndex]);
    // Nothing applied locally — the echo does that for everyone at once.
    expect(useGameStore.getState().game!.coopBoard).toBe(before);
  });

  it("race: fills a cell on the local board and returns race-progress", () => {
    const game = setupGame("race");
    const msg = useGameStore.getState().petAssistLocal();
    if (msg?.type !== "race-progress") {
      throw new Error(`expected race-progress, got ${msg?.type}`);
    }
    expect(msg.progress.playerId).toBe("me");
    expect(msg.progress.correctCount).toBe(1);
    const board = useGameStore.getState().localBoard;
    const filled = blanks(game.puzzle).filter((i) => board[i].value !== 0);
    expect(filled).toHaveLength(1);
    expect(board[filled[0]].value).toBe(SOLUTION[filled[0]]);
    expect(board[filled[0]].locked).toBe(true);
  });

  it("never steals the endgame (3 or fewer empty cells left)", () => {
    const game = setupGame("race");
    const empty = blanks(game.puzzle);
    const board = boardOf(game.puzzle);
    fillCorrect(board, empty.slice(0, empty.length - 3));
    useGameStore.setState({ localBoard: board });
    expect(useGameStore.getState().petAssistLocal()).toBeNull();
  });
});

// ---------------------------------------------------------------
// disasterLocal
// ---------------------------------------------------------------

describe("disasterLocal", () => {
  it("co-op: proposes locked cells to wipe without touching the board", () => {
    const game = setupGame("coop");
    const empty = blanks(game.puzzle);
    const board = boardOf(game.puzzle);
    fillCorrect(board, empty.slice(0, 10));
    useGameStore.setState({ game: { ...game, coopBoard: board } });
    const before = useGameStore.getState().game!.coopBoard;

    const msgs = useGameStore.getState().disasterLocal("earthquake");
    expect(msgs).toHaveLength(1);
    const msg = msgs[0];
    if (msg.type !== "disaster") throw new Error(`expected disaster, got ${msg.type}`);
    expect(msg.kind).toBe("earthquake");
    expect(msg.playerId).toBe("me");
    expect(msg.cellIndexes).toHaveLength(DISASTER_WIPE_COUNT.earthquake);
    expect(new Set(msg.cellIndexes).size).toBe(msg.cellIndexes.length);
    for (const i of msg.cellIndexes) {
      expect(before[i].locked).toBe(true);
      expect(game.puzzle[i]).toBe(0);
    }
    expect(useGameStore.getState().game!.coopBoard).toBe(before);
  });

  it("returns nothing when there are no correct entries to wipe", () => {
    setupGame("coop");
    expect(useGameStore.getState().disasterLocal("tornado")).toHaveLength(0);
  });

  it("race: wipes its own board, recounts progress, and returns both messages", () => {
    const game = setupGame("race");
    const empty = blanks(game.puzzle);
    const board = boardOf(game.puzzle);
    fillCorrect(board, empty.slice(0, 5));
    useGameStore.setState({ localBoard: board });

    const msgs = useGameStore.getState().disasterLocal("tornado");
    expect(msgs.map((m) => m.type)).toEqual(["disaster", "race-progress"]);
    const disaster = msgs[0];
    const progress = msgs[1];
    if (disaster.type !== "disaster" || progress.type !== "race-progress") {
      throw new Error("unexpected message shapes");
    }
    expect(disaster.cellIndexes).toHaveLength(DISASTER_WIPE_COUNT.tornado);
    const after = useGameStore.getState().localBoard;
    for (const i of disaster.cellIndexes) {
      expect(after[i]).toEqual({ value: 0, byPlayer: null, locked: false });
    }
    expect(progress.progress.correctCount).toBe(5 - DISASTER_WIPE_COUNT.tornado);
  });

  it("wipes at most what is on the board", () => {
    const game = setupGame("race");
    const board = boardOf(game.puzzle);
    fillCorrect(board, blanks(game.puzzle).slice(0, 1));
    useGameStore.setState({ localBoard: board });
    const msgs = useGameStore.getState().disasterLocal("earthquake");
    const disaster = msgs[0];
    if (disaster.type !== "disaster") throw new Error("expected disaster");
    expect(disaster.cellIndexes).toHaveLength(1);
  });

  it("each kind wipes its configured count", () => {
    expect(DISASTER_WIPE_COUNT.lightning).toBe(1);
    expect(DISASTER_WIPE_COUNT.blizzard).toBe(1);
    expect(DISASTER_WIPE_COUNT.tornado).toBe(2);
    expect(DISASTER_WIPE_COUNT["meteor-shower"]).toBe(2);
    expect(DISASTER_WIPE_COUNT.earthquake).toBe(3);
  });
});

// ---------------------------------------------------------------
// applyDisaster
// ---------------------------------------------------------------

describe("applyDisaster", () => {
  it("wipes locked entries but never givens or empties", () => {
    const game = setupGame("coop");
    const empty = blanks(game.puzzle);
    const board = boardOf(game.puzzle);
    fillCorrect(board, empty.slice(0, 4), "pal");
    useGameStore.setState({ game: { ...game, coopBoard: board } });

    const givenIndex = game.puzzle.findIndex((v) => v !== 0);
    const emptyIndex = empty[10];
    const wipedIndexes = empty.slice(0, 2);
    useGameStore
      .getState()
      .applyDisaster("pal", "lightning", [...wipedIndexes, givenIndex, emptyIndex, 999]);

    const after = useGameStore.getState().game!.coopBoard;
    for (const i of wipedIndexes) {
      expect(after[i]).toEqual({ value: 0, byPlayer: null, locked: false });
    }
    expect(after[givenIndex].value).toBe(game.puzzle[givenIndex]);
    expect(after[empty[2]].locked).toBe(true); // untouched entries survive
  });

  it("is a no-op outside a playing co-op game", () => {
    const game = setupGame("race");
    const before = useGameStore.getState().game!.coopBoard;
    useGameStore.getState().applyDisaster("me", "tornado", [0, 3, 6]);
    expect(useGameStore.getState().game!.coopBoard).toBe(before);
    useGameStore.setState({ game: { ...game, mode: "coop", phase: "finished" } });
    useGameStore.getState().applyDisaster("me", "tornado", [0, 3, 6]);
    expect(useGameStore.getState().game!.coopBoard).toBe(before);
  });
});
