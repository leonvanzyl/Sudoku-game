"use client";

import { memo, useEffect, useMemo } from "react";
import { m } from "framer-motion";
import { getConflicts } from "@/lib/sudoku";
import { useGameStore } from "@/lib/store/gameStore";

export interface Board2DProps {
  /** Route input (1-9, 0 = erase) up so the shell can publish the move. */
  onInput: (value: number) => void;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

interface CellProps {
  index: number;
  value: number;
  isGiven: boolean;
  isSelected: boolean;
  isPeer: boolean;
  sameNumber: boolean;
  isConflict: boolean;
  placerName: string | null;
  placerColor: string | null;
  onSelect: (i: number) => void;
}

/**
 * One board cell. Memoized on primitive props so a selection change only
 * commits the handful of cells whose highlight actually changed, and an
 * opponent's message that changes nothing visible commits none.
 */
const Cell = memo(function Cell({
  index,
  value,
  isGiven,
  isSelected,
  isPeer,
  sameNumber,
  isConflict,
  placerName,
  placerColor,
  onSelect,
}: CellProps) {
  const row = Math.floor(index / 9);
  const col = index % 9;

  let bg = "bg-transparent";
  if (isSelected) bg = "bg-cyan-400/25";
  else if (isConflict) bg = "bg-red-500/20";
  else if (sameNumber) bg = "bg-violet-400/15";
  else if (isPeer) bg = "bg-white/[0.05]";

  return (
    <div
      data-cell-index={index}
      role="gridcell"
      aria-selected={isSelected}
      title={placerName ? `Placed by ${placerName}` : undefined}
      onPointerDown={() => onSelect(index)}
      className={[
        "relative flex cursor-pointer items-center justify-center",
        bg,
        "border-white/[0.07]",
        col > 0 ? (col % 3 === 0 ? "border-l-2 border-l-cyan-300/25" : "border-l") : "",
        row > 0 ? (row % 3 === 0 ? "border-t-2 border-t-cyan-300/25" : "border-t") : "",
        isSelected
          ? "ring-1 ring-inset ring-cyan-300/80"
          : isConflict
            ? "ring-1 ring-inset ring-red-500/70"
            : "",
      ].join(" ")}
    >
      {value !== 0 && (
        <m.span
          key={`${index}:${value}:${placerColor ?? "given"}`}
          initial={isGiven ? false : { scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 24 }}
          className={[
            "font-mono text-base font-bold tabular-nums sm:text-2xl",
            isGiven ? "text-white" : "font-semibold",
            isConflict && !isGiven ? "!text-red-400" : "",
          ].join(" ")}
          style={
            !isGiven
              ? {
                  color: isConflict ? undefined : (placerColor ?? "#7dd3fc"),
                  textShadow: placerColor
                    ? `0 0 12px ${placerColor}66`
                    : "0 0 12px rgba(125,211,252,0.35)",
                }
              : { textShadow: "0 0 6px rgba(255,255,255,0.25)" }
          }
        >
          {value}
        </m.span>
      )}
    </div>
  );
});

/**
 * The 2D sudoku board. Renders the co-op board in co-op mode and the local
 * board in race mode. Every cell carries `data-cell-index` for the FX layer.
 * Subscribes to narrow store slices so race-progress churn from opponents
 * (which never changes anything visible here) doesn't re-render the grid.
 */
export default function Board2D({ onInput }: Board2DProps) {
  const mode = useGameStore((s) => s.game?.mode ?? null);
  const puzzle = useGameStore((s) => s.game?.puzzle ?? null);
  const coopBoard = useGameStore((s) => s.game?.coopBoard ?? null);
  const players = useGameStore((s) => s.game?.players ?? null);
  const localBoard = useGameStore((s) => s.localBoard);
  const selectedCell = useGameStore((s) => s.selectedCell);
  const selectCell = useGameStore((s) => s.selectCell);

  const entries = mode === "race" ? localBoard : coopBoard;

  /** What each cell currently shows. */
  const visibleGrid = useMemo(() => {
    const grid: number[] = new Array(81).fill(0);
    if (!puzzle) return grid;
    for (let i = 0; i < 81; i++) {
      grid[i] = puzzle[i] !== 0 ? puzzle[i] : (entries?.[i]?.value ?? 0);
    }
    return grid;
  }, [puzzle, entries]);

  const conflicts = useMemo(() => getConflicts(visibleGrid), [visibleGrid]);

  const playerById = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const p of players ?? []) map.set(p.id, { name: p.name, color: p.color });
    return map;
  }, [players]);

  // Keyboard: 1-9 input, 0/backspace/delete erase, arrows move selection.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const sel = useGameStore.getState().selectedCell;
      if (e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        onInput(Number(e.key));
        return;
      }
      if (e.key === "0" || e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        onInput(0);
        return;
      }
      const arrows: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      const delta = arrows[e.key];
      if (delta) {
        e.preventDefault();
        const from = sel ?? 40; // start from center if nothing selected
        const row = Math.min(8, Math.max(0, Math.floor(from / 9) + delta[0]));
        const col = Math.min(8, Math.max(0, (from % 9) + delta[1]));
        selectCell(row * 9 + col);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onInput, selectCell]);

  if (!mode || !puzzle) return null;

  const selRow = selectedCell !== null ? Math.floor(selectedCell / 9) : -1;
  const selCol = selectedCell !== null ? selectedCell % 9 : -1;
  const selBox =
    selectedCell !== null ? Math.floor(selRow / 3) * 3 + Math.floor(selCol / 3) : -1;
  const selValue = selectedCell !== null ? visibleGrid[selectedCell] : 0;

  /* Attribution for the selected cell (tooltips don't exist on touch):
   * who placed this entry, shown in their color under the board. */
  const selEntry =
    selectedCell !== null && puzzle[selectedCell] === 0 ? entries?.[selectedCell] : undefined;
  const selPlacer =
    selEntry && selEntry.value !== 0 && selEntry.byPlayer
      ? playerById.get(selEntry.byPlayer)
      : undefined;
  const selIsGiven = selectedCell !== null && puzzle[selectedCell] !== 0;

  return (
    <div
      data-board-area=""
      className="glass-deep w-full max-w-[min(92vw,560px)] select-none rounded-2xl p-2 sm:p-3"
      role="grid"
      aria-label="Sudoku board"
    >
      <div className="grid aspect-square grid-cols-9 overflow-hidden rounded-lg border-2 border-cyan-400/30 shadow-[0_0_45px_-12px_rgba(34,211,238,0.45)]">
        {Array.from({ length: 81 }, (_, i) => {
          const row = Math.floor(i / 9);
          const col = i % 9;
          const box = Math.floor(row / 3) * 3 + Math.floor(col / 3);
          const value = visibleGrid[i];
          const isGiven = puzzle[i] !== 0;
          const entry = !isGiven ? entries?.[i] : undefined;
          const placer =
            entry && entry.value !== 0 && entry.byPlayer
              ? playerById.get(entry.byPlayer)
              : undefined;

          const isSelected = selectedCell === i;
          const isPeer =
            selectedCell !== null &&
            !isSelected &&
            (row === selRow || col === selCol || box === selBox);
          const sameNumber = !isSelected && selValue !== 0 && value === selValue;

          return (
            <Cell
              key={i}
              index={i}
              value={value}
              isGiven={isGiven}
              isSelected={isSelected}
              isPeer={isPeer}
              sameNumber={sameNumber}
              isConflict={conflicts.has(i)}
              placerName={placer?.name ?? null}
              placerColor={placer?.color ?? null}
              onSelect={selectCell}
            />
          );
        })}
      </div>
      {/* fixed-height caption strip — no layout jump when it toggles */}
      <div className="flex h-6 items-center justify-center">
        {selPlacer ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/45">
            <span
              className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
              style={{ backgroundColor: selPlacer.color, boxShadow: `0 0 6px ${selPlacer.color}` }}
            />
            placed by{" "}
            <span className="font-semibold" style={{ color: selPlacer.color }}>
              {selPlacer.name}
            </span>
            {selEntry?.locked ? " · correct" : ""}
          </p>
        ) : selIsGiven ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/30">
            given clue
          </p>
        ) : null}
      </div>
    </div>
  );
}
