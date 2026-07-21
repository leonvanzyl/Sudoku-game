"use client";

import { motion } from "framer-motion";
import { PLAYER_COLORS } from "@/lib/types";

export interface ColorPickerProps {
  value: string | null;
  onChange: (color: string) => void;
  /** Colors already claimed by OTHER players — rendered disabled. */
  taken?: ReadonlySet<string>;
  className?: string;
}

/** Row of player-color swatches. */
export default function ColorPicker({ value, onChange, taken, className }: ColorPickerProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      {PLAYER_COLORS.map((c) => {
        const isSelected = value === c;
        const isTaken = !isSelected && (taken?.has(c) ?? false);
        return (
          <motion.button
            key={c}
            type="button"
            whileTap={isTaken ? undefined : { scale: 0.85 }}
            disabled={isTaken}
            onClick={() => onChange(c)}
            aria-label={`Pick color ${c}`}
            title={isTaken ? "Taken by another player" : undefined}
            className="relative flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed"
            style={{
              backgroundColor: `${c}22`,
              boxShadow: isSelected ? `0 0 14px ${c}aa, inset 0 0 0 2px ${c}` : undefined,
              opacity: isTaken ? 0.35 : 1,
            }}
          >
            <span
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: c, boxShadow: `0 0 8px ${c}` }}
            />
            {isTaken && (
              <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-white/70">
                ✕
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
