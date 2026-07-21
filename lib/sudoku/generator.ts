import type { Difficulty, Grid } from "../types";
import { DIFFICULTY_GIVENS } from "../types";
import { countSolutions, boxOf, colOf, rowOf } from "./solver";

/** Fisher-Yates shuffle (in place), returns the array for convenience. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Generate a fully solved grid via randomized backtracking. */
export function generateSolvedGrid(): Grid {
  const grid: Grid = new Array<number>(81).fill(0);
  const rows = new Array<number>(9).fill(0);
  const cols = new Array<number>(9).fill(0);
  const boxes = new Array<number>(9).fill(0);

  const fill = (i: number): boolean => {
    if (i === 81) return true;
    const r = rowOf(i);
    const c = colOf(i);
    const b = boxOf(i);
    const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const v of digits) {
      const bit = 1 << v;
      if (rows[r] & bit || cols[c] & bit || boxes[b] & bit) continue;
      grid[i] = v;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
      if (fill(i + 1)) return true;
      grid[i] = 0;
      rows[r] &= ~bit;
      cols[c] &= ~bit;
      boxes[b] &= ~bit;
    }
    return false;
  };

  // A randomized fill from an empty grid always succeeds.
  fill(0);
  return grid;
}

/**
 * Generate a puzzle for the given difficulty:
 * 1. Build a full random solution (randomized backtracking).
 * 2. Remove clues in random order toward DIFFICULTY_GIVENS[difficulty],
 *    keeping a removal only if the puzzle still has exactly one solution
 *    (bounded uniqueness check: solution counting stops at 2).
 *
 * The givens count never drops below the target; on hard/expert it may
 * land slightly above it when no further clue can be removed uniquely.
 */
export function generatePuzzle(difficulty: Difficulty): { puzzle: Grid; solution: Grid } {
  const target = DIFFICULTY_GIVENS[difficulty];
  const solution = generateSolvedGrid();
  const puzzle = solution.slice();
  let givens = 81;

  const order = shuffle(Array.from({ length: 81 }, (_, i) => i));
  for (const i of order) {
    if (givens <= target) break;
    const saved = puzzle[i];
    puzzle[i] = 0;
    if (countSolutions(puzzle, 2) === 1) {
      givens--;
    } else {
      puzzle[i] = saved; // removal breaks uniqueness — put it back
    }
  }

  return { puzzle, solution };
}
