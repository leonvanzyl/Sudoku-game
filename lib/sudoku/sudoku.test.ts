import { describe, expect, it } from "vitest";
import { DIFFICULTIES, DIFFICULTY_GIVENS, type Grid } from "../types";
import {
  generatePuzzle,
  getCompletedUnits,
  getConflicts,
  isComplete,
  isValidPlacement,
  solve,
} from "./index";
import { countSolutions } from "./solver";

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

const emptyGrid = (): Grid => new Array<number>(81).fill(0);

const countGivens = (g: Grid): number => g.filter((v) => v !== 0).length;

/** A known valid solved grid (canonical pattern). */
function solvedGrid(): Grid {
  const g: Grid = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      g.push(((Math.floor(r / 3) + (r % 3) * 3 + c) % 9) + 1);
    }
  }
  return g;
}

function assertValidSolvedGrid(g: Grid): void {
  expect(g).toHaveLength(81);
  expect(g.every((v) => v >= 1 && v <= 9)).toBe(true);
  expect(getConflicts(g).size).toBe(0);
}

// ---------------------------------------------------------------
// generatePuzzle
// ---------------------------------------------------------------

describe("generatePuzzle", () => {
  it.each(DIFFICULTIES)("%s: puzzle matches its solution and is uniquely solvable", (d) => {
    const { puzzle, solution } = generatePuzzle(d);

    expect(puzzle).toHaveLength(81);
    assertValidSolvedGrid(solution);

    // Every given agrees with the solution.
    for (let i = 0; i < 81; i++) {
      expect(puzzle[i] === 0 || puzzle[i] === solution[i]).toBe(true);
    }

    // Solver reproduces exactly the stored solution (uniqueness).
    expect(solve(puzzle)).toEqual(solution);
    expect(countSolutions(puzzle, 2)).toBe(1);
  });

  it.each(DIFFICULTIES)("%s: givens count is in range", (d) => {
    const target = DIFFICULTY_GIVENS[d];
    for (let n = 0; n < 3; n++) {
      const { puzzle } = generatePuzzle(d);
      const givens = countGivens(puzzle);
      // Removal stops exactly at target; may stall slightly above it
      // on sparse targets when uniqueness can't be preserved.
      expect(givens).toBeGreaterThanOrEqual(target);
      expect(givens).toBeLessThanOrEqual(target + 6);
    }
  });

  it("produces different puzzles across calls", () => {
    const a = generatePuzzle("easy");
    const b = generatePuzzle("easy");
    expect(a.solution).not.toEqual(b.solution);
  });

  it.each(DIFFICULTIES)("%s: generates in well under 1 second", (d) => {
    const start = performance.now();
    generatePuzzle(d);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------
// solve
// ---------------------------------------------------------------

describe("solve", () => {
  it("solves an empty grid to a valid full grid", () => {
    const result = solve(emptyGrid());
    expect(result).not.toBeNull();
    assertValidSolvedGrid(result as Grid);
  });

  it("returns the grid itself for an already-solved grid", () => {
    const g = solvedGrid();
    expect(solve(g)).toEqual(g);
  });

  it("does not mutate its input", () => {
    const g = emptyGrid();
    g[0] = 5;
    const copy = g.slice();
    solve(g);
    expect(g).toEqual(copy);
  });

  it("returns null for a grid with a direct conflict", () => {
    const g = emptyGrid();
    g[0] = 5;
    g[1] = 5; // same row
    expect(solve(g)).toBeNull();
  });

  it("returns null for a conflict-free but unsolvable grid", () => {
    // Box 0 contains {1,2,3,4,5,6,7,8} except cell 0; row 0 outside the box
    // uses 9 — cell 0 has no candidate. No direct duplicates anywhere.
    const g = emptyGrid();
    g[1] = 1;
    g[2] = 2;
    g[9] = 3;
    g[10] = 4;
    g[11] = 5;
    g[18] = 6;
    g[19] = 7;
    g[20] = 8;
    g[3] = 9; // row 0, outside box 0
    expect(solve(g)).toBeNull();
  });
});

// ---------------------------------------------------------------
// isValidPlacement
// ---------------------------------------------------------------

describe("isValidPlacement", () => {
  it("allows any digit on an empty grid", () => {
    const g = emptyGrid();
    for (let v = 1; v <= 9; v++) expect(isValidPlacement(g, 40, v)).toBe(true);
  });

  it("rejects a row duplicate", () => {
    const g = emptyGrid();
    g[0] = 7;
    expect(isValidPlacement(g, 8, 7)).toBe(false); // same row
    expect(isValidPlacement(g, 8, 6)).toBe(true);
  });

  it("rejects a column duplicate", () => {
    const g = emptyGrid();
    g[4] = 3;
    expect(isValidPlacement(g, 76, 3)).toBe(false); // same column (col 4)
    expect(isValidPlacement(g, 76, 4)).toBe(true);
  });

  it("rejects a box duplicate", () => {
    const g = emptyGrid();
    g[0] = 2;
    expect(isValidPlacement(g, 20, 2)).toBe(false); // same 3x3 box
    expect(isValidPlacement(g, 20, 1)).toBe(true);
  });

  it("ignores the cell's own current value", () => {
    const g = emptyGrid();
    g[40] = 5;
    expect(isValidPlacement(g, 40, 5)).toBe(true); // re-placing same value
    expect(isValidPlacement(g, 40, 6)).toBe(true); // overwriting
  });

  it("rejects out-of-range values and indexes", () => {
    const g = emptyGrid();
    expect(isValidPlacement(g, 0, 0)).toBe(false);
    expect(isValidPlacement(g, 0, 10)).toBe(false);
    expect(isValidPlacement(g, -1, 5)).toBe(false);
    expect(isValidPlacement(g, 81, 5)).toBe(false);
  });
});

// ---------------------------------------------------------------
// getConflicts
// ---------------------------------------------------------------

describe("getConflicts", () => {
  it("returns empty set for an empty grid and a solved grid", () => {
    expect(getConflicts(emptyGrid()).size).toBe(0);
    expect(getConflicts(solvedGrid()).size).toBe(0);
  });

  it("flags both cells of a row duplicate", () => {
    const g = emptyGrid();
    g[0] = 4;
    g[5] = 4;
    expect(getConflicts(g)).toEqual(new Set([0, 5]));
  });

  it("flags column and box duplicates", () => {
    const g = emptyGrid();
    g[2] = 9;
    g[74] = 9; // same column (col 2)
    const colConflicts = getConflicts(g);
    expect(colConflicts.has(2)).toBe(true);
    expect(colConflicts.has(74)).toBe(true);

    const h = emptyGrid();
    h[30] = 1; // row 3, col 3 — box 4
    h[40] = 1; // row 4, col 4 — box 4
    expect(getConflicts(h)).toEqual(new Set([30, 40]));
  });

  it("flags all cells of a triple duplicate", () => {
    const g = emptyGrid();
    g[0] = 8;
    g[4] = 8;
    g[8] = 8;
    expect(getConflicts(g)).toEqual(new Set([0, 4, 8]));
  });

  it("does not flag unrelated cells", () => {
    const g = emptyGrid();
    g[0] = 1;
    g[1] = 1;
    g[80] = 9;
    const conflicts = getConflicts(g);
    expect(conflicts).toEqual(new Set([0, 1]));
  });
});

// ---------------------------------------------------------------
// getCompletedUnits
// ---------------------------------------------------------------

describe("getCompletedUnits", () => {
  const solution = solvedGrid();

  it("returns [] for an empty grid", () => {
    expect(getCompletedUnits(emptyGrid(), solution)).toEqual([]);
  });

  it("returns all 27 units for a fully correct grid", () => {
    const units = getCompletedUnits(solution.slice(), solution);
    expect(units).toHaveLength(27);
    for (const unit of units) expect(unit).toHaveLength(9);
  });

  it("detects a single completed row", () => {
    const g = emptyGrid();
    for (let c = 0; c < 9; c++) g[c] = solution[c]; // row 0 correct
    const units = getCompletedUnits(g, solution);
    expect(units).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8]]);
  });

  it("detects a completed column and box", () => {
    const g = emptyGrid();
    for (let r = 0; r < 9; r++) g[r * 9] = solution[r * 9]; // col 0
    const boxCells = [0, 1, 2, 9, 10, 11, 18, 19, 20];
    for (const i of boxCells) g[i] = solution[i]; // box 0
    const units = getCompletedUnits(g, solution);
    expect(units).toContainEqual([0, 9, 18, 27, 36, 45, 54, 63, 72]);
    expect(units).toContainEqual(boxCells);
    expect(units).toHaveLength(2); // no full row completed
  });

  it("does not count a filled-but-wrong unit", () => {
    const g = emptyGrid();
    for (let c = 0; c < 9; c++) g[c] = solution[c];
    // Swap two cells: still a permutation of 1-9 but wrong vs solution.
    [g[0], g[1]] = [g[1], g[0]];
    expect(getCompletedUnits(g, solution)).toEqual([]);
  });
});

// ---------------------------------------------------------------
// isComplete
// ---------------------------------------------------------------

describe("isComplete", () => {
  const solution = solvedGrid();

  it("is true only for an exact full match", () => {
    expect(isComplete(solution.slice(), solution)).toBe(true);
  });

  it("is false for an empty or partial grid", () => {
    expect(isComplete(emptyGrid(), solution)).toBe(false);
    const partial = solution.slice();
    partial[80] = 0;
    expect(isComplete(partial, solution)).toBe(false);
  });

  it("is false when a cell is filled but wrong", () => {
    const g = solution.slice();
    [g[0], g[1]] = [g[1], g[0]];
    expect(isComplete(g, solution)).toBe(false);
  });

  it("is true for a generated puzzle filled in from its solution", () => {
    const { puzzle, solution: sol } = generatePuzzle("medium");
    const g = puzzle.slice();
    expect(isComplete(g, sol)).toBe(false);
    for (let i = 0; i < 81; i++) if (g[i] === 0) g[i] = sol[i];
    expect(isComplete(g, sol)).toBe(true);
  });
});
