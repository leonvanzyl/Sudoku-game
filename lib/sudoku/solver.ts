import type { Grid } from "../types";

// ---------------------------------------------------------------
// Unit definitions: 27 units (9 rows, 9 cols, 9 boxes), each an
// array of 9 cell indexes into the row-major 81-cell grid.
// ---------------------------------------------------------------

function buildUnits(): number[][] {
  const units: number[][] = [];
  for (let r = 0; r < 9; r++) {
    const row: number[] = [];
    for (let c = 0; c < 9; c++) row.push(r * 9 + c);
    units.push(row);
  }
  for (let c = 0; c < 9; c++) {
    const col: number[] = [];
    for (let r = 0; r < 9; r++) col.push(r * 9 + c);
    units.push(col);
  }
  for (let b = 0; b < 9; b++) {
    const box: number[] = [];
    const br = Math.floor(b / 3) * 3;
    const bc = (b % 3) * 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) box.push((br + r) * 9 + (bc + c));
    }
    units.push(box);
  }
  return units;
}

/** All 27 units: indexes 0-8 rows, 9-17 cols, 18-26 boxes. */
export const UNITS: readonly number[][] = buildUnits();

export const rowOf = (i: number): number => Math.floor(i / 9);
export const colOf = (i: number): number => i % 9;
export const boxOf = (i: number): number =>
  Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

// ---------------------------------------------------------------
// Bitmask helpers (bit v set = digit v present in that unit).
// ---------------------------------------------------------------

interface Masks {
  rows: number[];
  cols: number[];
  boxes: number[];
}

/** Build occupancy masks; returns null if the grid has a direct conflict. */
function buildMasks(grid: Grid): Masks | null {
  const rows = new Array<number>(9).fill(0);
  const cols = new Array<number>(9).fill(0);
  const boxes = new Array<number>(9).fill(0);
  for (let i = 0; i < 81; i++) {
    const v = grid[i];
    if (v === 0) continue;
    const bit = 1 << v;
    const r = rowOf(i);
    const c = colOf(i);
    const b = boxOf(i);
    if (rows[r] & bit || cols[c] & bit || boxes[b] & bit) return null;
    rows[r] |= bit;
    cols[c] |= bit;
    boxes[b] |= bit;
  }
  return { rows, cols, boxes };
}

const ALL_DIGITS = 0b1111111110; // bits 1..9 set

function popcount(x: number): number {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

/**
 * Backtracking search with MRV (most-constrained-cell-first).
 * Counts complete solutions up to `limit`. If `out` is provided, the
 * first solution found is stored in `out.solution`.
 */
function search(
  grid: Grid,
  masks: Masks,
  limit: number,
  out: { solution: Grid | null } | null,
): number {
  // Find the empty cell with the fewest candidates.
  let bestIdx = -1;
  let bestCands = 0;
  let bestCount = 10;
  for (let i = 0; i < 81; i++) {
    if (grid[i] !== 0) continue;
    const used = masks.rows[rowOf(i)] | masks.cols[colOf(i)] | masks.boxes[boxOf(i)];
    const cands = ALL_DIGITS & ~used;
    if (cands === 0) return 0; // dead end
    const n = popcount(cands);
    if (n < bestCount) {
      bestCount = n;
      bestIdx = i;
      bestCands = cands;
      if (n === 1) break;
    }
  }

  if (bestIdx === -1) {
    // No empty cells: found a complete solution.
    if (out && out.solution === null) out.solution = grid.slice();
    return 1;
  }

  const r = rowOf(bestIdx);
  const c = colOf(bestIdx);
  const b = boxOf(bestIdx);
  let found = 0;
  for (let v = 1; v <= 9; v++) {
    const bit = 1 << v;
    if (!(bestCands & bit)) continue;
    grid[bestIdx] = v;
    masks.rows[r] |= bit;
    masks.cols[c] |= bit;
    masks.boxes[b] |= bit;
    found += search(grid, masks, limit - found, out);
    grid[bestIdx] = 0;
    masks.rows[r] &= ~bit;
    masks.cols[c] &= ~bit;
    masks.boxes[b] &= ~bit;
    if (found >= limit) return found;
  }
  return found;
}

/**
 * Solve via backtracking. Returns a NEW solved grid, or null if the
 * grid is contradictory/unsolvable. Never mutates the input.
 */
export function solve(grid: Grid): Grid | null {
  const work = grid.slice();
  const masks = buildMasks(work);
  if (!masks) return null;
  const out: { solution: Grid | null } = { solution: null };
  search(work, masks, 1, out);
  return out.solution;
}

/**
 * Count solutions, stopping as soon as `limit` are found (default 2 —
 * enough to distinguish unique / not-unique). Never mutates the input.
 */
export function countSolutions(grid: Grid, limit = 2): number {
  const work = grid.slice();
  const masks = buildMasks(work);
  if (!masks) return 0;
  return search(work, masks, limit, null);
}

/**
 * Would placing `value` (1-9) at `index` violate a row/col/box constraint?
 * The cell's own current value is ignored (re-placing the same value is valid).
 * Returns false for out-of-range values or indexes.
 */
export function isValidPlacement(grid: Grid, index: number, value: number): boolean {
  if (index < 0 || index > 80 || !Number.isInteger(index)) return false;
  if (value < 1 || value > 9 || !Number.isInteger(value)) return false;
  const r = rowOf(index);
  const c = colOf(index);
  const b = boxOf(index);
  for (let i = 0; i < 81; i++) {
    if (i === index || grid[i] !== value) continue;
    if (rowOf(i) === r || colOf(i) === c || boxOf(i) === b) return false;
  }
  return true;
}

/**
 * Indexes of every cell participating in a duplicate within its
 * row, column, or box. Empty cells never conflict.
 */
export function getConflicts(grid: Grid): Set<number> {
  const conflicts = new Set<number>();
  for (const unit of UNITS) {
    // seen[v] = first index holding value v in this unit, or -1.
    const seen = new Array<number>(10).fill(-1);
    const flagged = new Array<boolean>(10).fill(false);
    for (const i of unit) {
      const v = grid[i];
      if (v === 0) continue;
      if (seen[v] === -1) {
        seen[v] = i;
      } else {
        conflicts.add(i);
        if (!flagged[v]) {
          conflicts.add(seen[v]);
          flagged[v] = true;
        }
      }
    }
  }
  return conflicts;
}

/**
 * Units (rows/cols/boxes) whose 9 cells all match the solution,
 * returned as arrays of cell indexes.
 */
export function getCompletedUnits(grid: Grid, solution: Grid): number[][] {
  const complete: number[][] = [];
  for (const unit of UNITS) {
    let ok = true;
    for (const i of unit) {
      if (grid[i] === 0 || grid[i] !== solution[i]) {
        ok = false;
        break;
      }
    }
    if (ok) complete.push([...unit]);
  }
  return complete;
}

/** True when every cell matches the solution (fully and correctly filled). */
export function isComplete(grid: Grid, solution: Grid): boolean {
  for (let i = 0; i < 81; i++) {
    if (grid[i] === 0 || grid[i] !== solution[i]) return false;
  }
  return true;
}
