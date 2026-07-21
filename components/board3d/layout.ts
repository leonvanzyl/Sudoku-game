// Pure layout math for the 3D board. No React, no three.js imports needed —
// safe to use from any board3d file.

export const CELL_SPACING = 1;
export const BOX_GAP = 0.2;
export const TILE_SIZE = 0.92;
export const TILE_HEIGHT = 0.28;

export const rowOf = (i: number): number => Math.floor(i / 9);
export const colOf = (i: number): number => i % 9;

/** World-axis offset for a row/col index (0-8), centered on 0. */
export function axisOffset(rc: number): number {
  return (rc - 4) * CELL_SPACING + (Math.floor(rc / 3) - 1) * BOX_GAP;
}

/** [x, z] world position of a cell's center. */
export function cellPosition(i: number): [number, number] {
  return [axisOffset(colOf(i)), axisOffset(rowOf(i))];
}

/** Edge-to-edge span of the tile field (including outer tile halves). */
export const BOARD_SPAN = 2 * axisOffset(8) + TILE_SIZE;

/** Midlines of the two gaps between 3x3 boxes (same for x and z axes). */
export const GAP_CENTERS: readonly [number, number] = [
  (axisOffset(2) + axisOffset(3)) / 2,
  (axisOffset(5) + axisOffset(6)) / 2,
];

/** Row/col/box peers of a cell (excluding the cell itself). */
export function peersOf(sel: number | null): Set<number> {
  const s = new Set<number>();
  if (sel === null) return s;
  const r = rowOf(sel);
  const c = colOf(sel);
  for (let k = 0; k < 9; k++) {
    s.add(r * 9 + k);
    s.add(k * 9 + c);
  }
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) s.add((br + dr) * 9 + bc + dc);
  }
  s.delete(sel);
  return s;
}

/** Chebyshev distance between two cells on the 9x9 grid (0-8). */
export function gridDistance(a: number, b: number): number {
  return Math.max(Math.abs(rowOf(a) - rowOf(b)), Math.abs(colOf(a) - colOf(b)));
}
