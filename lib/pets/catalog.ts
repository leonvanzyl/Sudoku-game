// ============================================================
// Pixel pet catalog — sprite data, per-player species assignment
// and canvas rendering. Pure data + pure functions; the only DOM
// use is renderPetFrame (client-only, guarded).
//
// Every player in a room gets a species unique within that room,
// chosen deterministically from their player id, so every client
// (and every session) derives the same pet for the same player.
// Sprites are 10×10, two animation frames, and include accent
// pixels ("A") tinted with the owner's player color.
// ============================================================

import type { PlayerInfo } from "@/lib/types";

export interface PetSpecies {
  id: string;
  /** Species label, e.g. "cat". */
  label: string;
  /** Cute name pool; a pet's name is picked by owner-id hash. */
  names: readonly string[];
  /** Base body color. */
  body: string;
  /** Secondary color (muzzle/belly/wing). */
  detail: string;
  /**
   * Two 10×10 frames. Chars: "." transparent, "B" body, "D" dark
   * (outline/eyes), "W" white, "P" pink, "S" detail, "A" player accent.
   */
  frames: readonly [readonly string[], readonly string[]];
}

// Frame 2 of each sprite shifts legs/ears/tail for a tiny walk cycle.
export const PET_SPECIES: readonly PetSpecies[] = [
  {
    id: "cat",
    label: "cat",
    names: ["Mochi", "Miso", "Pixel", "Beans"],
    body: "#cbd5e1",
    detail: "#94a3b8",
    frames: [
      [
        "..B.....B.",
        "..BB...BB.",
        "..BBBBBBB.",
        "..BDBBBDB.",
        "..BBBPBBB.",
        "..AAAAAAA.",
        ".BBBBBBBB.",
        "BBBBBBBBB.",
        ".BB.BB.BB.",
        ".DD.DD.DD.",
      ],
      [
        "..B.....B.",
        "..BB...BB.",
        "..BBBBBBB.",
        "..BDBBBDB.",
        "..BBBPBBB.",
        "..AAAAAAA.",
        ".BBBBBBBBB",
        "BBBBBBBBB.",
        "..BB.BB...",
        "..DD.DD...",
      ],
    ],
  },
  {
    id: "pup",
    label: "puppy",
    names: ["Biscuit", "Waffle", "Bolt", "Nori"],
    body: "#d9a066",
    detail: "#b07b48",
    frames: [
      [
        ".SS.....SS",
        ".SSB...BSS",
        "..BBBBBBB.",
        "..BDBBBDB.",
        "..BBBDBBB.",
        "..BBBPBBB.",
        "..AAAAAAA.",
        ".BBBBBBBB.",
        ".BB.BB.BB.",
        ".DD.DD.DD.",
      ],
      [
        ".SS.....SS",
        ".SSB...BSS",
        "..BBBBBBB.",
        "..BDBBBDB.",
        "..BBBDBBB.",
        "..BBBPBBB.",
        "..AAAAAAA.",
        ".BBBBBBBB.",
        "..BB.BB...",
        "..DD.DD...",
      ],
    ],
  },
  {
    id: "bunny",
    label: "bunny",
    names: ["Clover", "Thistle", "Pudding", "Hops"],
    body: "#f1f5f9",
    detail: "#e2e8f0",
    frames: [
      [
        "..BP..PB..",
        "..BP..PB..",
        "..BB..BB..",
        "..BBBBBB..",
        "..BDBBDB..",
        "..BBPPBB..",
        "..AAAAAA..",
        ".BBBBBBBB.",
        ".BB.BB.BB.",
        ".SS.SS.SS.",
      ],
      [
        ".BP..PB...",
        ".BP..PB...",
        ".BB..BB...",
        "..BBBBBB..",
        "..BDBBDB..",
        "..BBPPBB..",
        "..AAAAAA..",
        ".BBBBBBBB.",
        "..BB.BB...",
        "..SS.SS...",
      ],
    ],
  },
  {
    id: "chick",
    label: "chick",
    names: ["Nugget", "Sunny", "Pip", "Custard"],
    body: "#fde047",
    detail: "#facc15",
    frames: [
      [
        "....BB....",
        "...BBBB...",
        "..BBBBBB..",
        "..BDBBDB..",
        "..BBPPBB..",
        ".ABBBBBBA.",
        ".ABBBBBBA.",
        "..BBBBBB..",
        "...B..B...",
        "...D..D...",
      ],
      [
        "....BB....",
        "...BBBB...",
        "..BBBBBB..",
        "..BDBBDB..",
        "..BBPPBB..",
        "A.BBBBBB.A",
        "A.BBBBBB.A",
        "..BBBBBB..",
        "....BB....",
        "....DD....",
      ],
    ],
  },
  {
    id: "frog",
    label: "frog",
    names: ["Lily", "Kero", "Tadpole", "Moss"],
    body: "#86efac",
    detail: "#4ade80",
    frames: [
      [
        ".BB....BB.",
        ".BDB..BDB.",
        ".BBBBBBBB.",
        ".BBBBBBBB.",
        ".BWWWWWWB.",
        ".AAAAAAAA.",
        ".SBBBBBBS.",
        "SSBBBBBBSS",
        ".SS....SS.",
        "..........",
      ],
      [
        ".BB....BB.",
        ".BDB..BDB.",
        ".BBBBBBBB.",
        ".BBBBBBBB.",
        ".BWWWWWWB.",
        ".AAAAAAAA.",
        ".SBBBBBBS.",
        ".SBBBBBBS.",
        ".SS....SS.",
        "S........S",
      ],
    ],
  },
  {
    id: "fox",
    label: "fox",
    names: ["Ember", "Rusty", "Maple", "Kit"],
    body: "#fb923c",
    detail: "#fdba74",
    frames: [
      [
        ".BB....BB.",
        ".BWB..BWB.",
        ".BBBBBBBB.",
        ".BDBBBBDB.",
        ".BWWBBWWB.",
        ".BWWDBWWB.",
        "..AAAAAA..",
        ".BBBBBBBB.",
        ".WW.BB.BB.",
        ".DD.DD.DD.",
      ],
      [
        ".BB....BB.",
        ".BWB..BWB.",
        ".BBBBBBBB.",
        ".BDBBBBDB.",
        ".BWWBBWWB.",
        ".BWWDBWWB.",
        "..AAAAAA..",
        ".BBBBBBBB.",
        "..WW.BB...",
        "..DD.DD...",
      ],
    ],
  },
  {
    id: "turtle",
    label: "turtle",
    names: ["Sheldon", "Pebble", "Tank", "Kame"],
    body: "#4ade80",
    detail: "#22c55e",
    frames: [
      [
        "....AAAA..",
        "...AAAAAA.",
        "..AASAASA.",
        "BB.AAAAAA.",
        "BDB.AAAA..",
        "BBB.......",
        ".BBBBBBBB.",
        "..B..B..B.",
        "..S..S..S.",
        "..........",
      ],
      [
        "....AAAA..",
        "...AAAAAA.",
        "..AASAASA.",
        "BB.AAAAAA.",
        "BDB.AAAA..",
        "BBB.......",
        ".BBBBBBBB.",
        ".B..B..B..",
        ".S..S..S..",
        "..........",
      ],
    ],
  },
  {
    id: "slime",
    label: "slime",
    names: ["Goober", "Jelly", "Blorp", "Dew"],
    body: "#a5b4fc",
    detail: "#818cf8",
    frames: [
      [
        "..........",
        "...BBBB...",
        "..BBBBBB..",
        ".BBWBBBBB.",
        ".BBBBBBBB.",
        ".BDBBBBDB.",
        ".BBBAABBB.",
        "BBBBAABBBB",
        "BBBBBBBBBB",
        ".SSSSSSSS.",
      ],
      [
        "...BBBB...",
        "..BBBBBB..",
        ".BBWBBBBB.",
        ".BBBBBBBB.",
        ".BDBBBBDB.",
        ".BBBAABBB.",
        ".BBBAABBB.",
        ".BBBBBBBB.",
        "..BBBBBB..",
        "..SSSSSS..",
      ],
    ],
  },
];

export const PET_SPRITE_SIZE = 10;

/** Small stable string hash (FNV-1a-ish), always >= 0. */
export function petHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** True when `id` names a species in the catalog. */
export function isPetSpeciesId(id: unknown): id is string {
  return typeof id === "string" && PET_SPECIES.some((s) => s.id === id);
}

/**
 * Deterministic, room-unique species assignment: walk the roster in join
 * order (the order is host-synced, so identical on every client) and give
 * each player their requested species (PlayerInfo.petId) when free, else
 * the species their id hashes to, probing forward past species already
 * taken. Falls back to reuse only with more players than species.
 */
export function assignPetSpecies(
  players: readonly PlayerInfo[],
): Map<string, PetSpecies> {
  const taken = new Set<number>();
  const out = new Map<string, PetSpecies>();
  for (const p of players) {
    const wanted = isPetSpeciesId(p.petId)
      ? PET_SPECIES.findIndex((s) => s.id === p.petId)
      : -1;
    const start =
      wanted >= 0 && !taken.has(wanted) ? wanted : petHash(p.id) % PET_SPECIES.length;
    let idx = start;
    for (let step = 0; step < PET_SPECIES.length; step++) {
      const candidate = (start + step) % PET_SPECIES.length;
      if (!taken.has(candidate)) {
        idx = candidate;
        break;
      }
    }
    taken.add(idx);
    out.set(p.id, PET_SPECIES[idx]);
  }
  return out;
}

/** A pet's given name — stable per owner. */
export function petName(species: PetSpecies, ownerId: string): string {
  return species.names[petHash(`${ownerId}:name`) % species.names.length];
}

const spriteCache = new Map<string, string>();

/**
 * Render one sprite frame to a data-URL (10×10 px — scale it up in CSS
 * with image-rendering: pixelated). Client-only; returns "" during SSR.
 */
export function renderPetFrame(
  species: PetSpecies,
  frame: 0 | 1,
  accent: string,
): string {
  if (typeof document === "undefined") return "";
  const key = `${species.id}:${frame}:${accent}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;

  const palette: Record<string, string> = {
    B: species.body,
    D: "#1e293b",
    W: "#ffffff",
    P: "#f9a8d4",
    S: species.detail,
    A: accent,
  };
  const canvas = document.createElement("canvas");
  canvas.width = PET_SPRITE_SIZE;
  canvas.height = PET_SPRITE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const rows = species.frames[frame];
  for (let y = 0; y < PET_SPRITE_SIZE; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < PET_SPRITE_SIZE; x++) {
      const color = palette[row[x] ?? "."];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const url = canvas.toDataURL();
  spriteCache.set(key, url);
  return url;
}
