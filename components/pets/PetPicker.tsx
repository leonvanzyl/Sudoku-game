"use client";

import { PET_SPECIES, renderPetFrame } from "@/lib/pets/catalog";

export interface PetPickerProps {
  /** Effective species id of the local player's pet. */
  value: string | null;
  onChange: (petId: string) => void;
  /** Species ids already claimed by OTHER players — rendered disabled. */
  taken?: ReadonlySet<string>;
  /** Accent color for the sprite previews (the player's color). */
  accent: string;
  className?: string;
}

/** Row of pixel-pet swatches, mirroring ColorPicker. */
export default function PetPicker({
  value,
  onChange,
  taken,
  accent,
  className,
}: PetPickerProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      {PET_SPECIES.map((sp) => {
        const isSelected = value === sp.id;
        const isTaken = !isSelected && (taken?.has(sp.id) ?? false);
        return (
          <button
            key={sp.id}
            type="button"
            disabled={isTaken}
            onClick={() => onChange(sp.id)}
            aria-label={`Pick pet: ${sp.label}`}
            title={isTaken ? "Taken by another player" : sp.label}
            className="tap-scale relative flex h-10 w-10 items-center justify-center rounded-xl border disabled:cursor-not-allowed"
            style={{
              backgroundColor: isSelected ? `${accent}1e` : "rgba(0,0,0,0.3)",
              borderColor: isSelected ? accent : "rgba(255,255,255,0.1)",
              boxShadow: isSelected ? `0 0 14px -4px ${accent}` : undefined,
              opacity: isTaken ? 0.35 : 1,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny generated data-URL sprite */}
            <img
              src={renderPetFrame(sp, 0, accent)}
              alt=""
              width={26}
              height={26}
              style={{
                imageRendering: "pixelated",
                filter: isTaken ? "grayscale(1)" : undefined,
              }}
            />
            {isTaken && (
              <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-white/70">
                ✕
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
