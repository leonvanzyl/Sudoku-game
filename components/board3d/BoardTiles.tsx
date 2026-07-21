"use client";

// The 81 tiles + the single useFrame animation loop that drives them.
// Reads the same useGameStore state as the 2D board: coopBoard in co-op,
// localBoard in race, selection via selectedCell/selectCell. Listens to the
// fx bus for correct/wrong/unit-complete/victory choreography, and tracks
// previous cell values with a ref to pop tiles on placement.

import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGameStore } from "@/lib/store/gameStore";
import { fxBus } from "@/lib/fx/bus";
import { PLAYER_COLORS, type CellEntry, type FxEvent } from "@/lib/types";
import Tile, { type TileHandle } from "./Tile";
import { CellFxManager, type PulseSample } from "./cellFx";
import { colOf, gridDistance, peersOf, rowOf } from "./layout";

const GIVEN_TEXT = "#f8fafc";
const FALLBACK_ENTRY = "#7dd3fc";
const CORRECT_GREEN = "#34d399";
const WRONG_RED = "#f87171";
const PEER_EMISSIVE = new THREE.Color("#60a5fa");
const IDLE_EMISSIVE = "#334155";

interface FrameData {
  selected: number | null;
  peers: Set<number>;
  hasValue: boolean[];
  /** Per-cell resting emissive tint (player color for entries, slate otherwise). */
  ownColor: THREE.Color[];
  /** Selection glow color (local player's color). */
  selColor: THREE.Color;
}

export default function BoardTiles() {
  const board = useGameStore((s) =>
    s.game ? (s.game.mode === "coop" ? s.game.coopBoard : s.localBoard) : null
  );
  const players = useGameStore((s) => (s.game ? s.game.players : null));
  const selected = useGameStore((s) => s.selectedCell);
  const localId = useGameStore((s) => s.localPlayer?.id ?? null);

  const colorByPlayer = useMemo(() => {
    const map = new Map<string, string>();
    players?.forEach((p) => map.set(p.id, p.color));
    return map;
  }, [players]);

  // --- imperative animation state ---
  const handles = useRef<(TileHandle | null)[]>(new Array(81).fill(null));
  const register = useCallback((i: number, h: TileHandle | null) => {
    handles.current[i] = h;
  }, []);

  const fx = useMemo(() => new CellFxManager(81), []);

  const frameData = useRef<FrameData>({
    selected: null,
    peers: new Set(),
    hasValue: new Array(81).fill(false),
    ownColor: Array.from({ length: 81 }, () => new THREE.Color(IDLE_EMISSIVE)),
    selColor: new THREE.Color("#22d3ee"),
  });

  // Keep frame-loop inputs in sync with store state (no per-frame reads of
  // React state; the loop only touches this ref).
  useEffect(() => {
    const fd = frameData.current;
    fd.selected = selected;
    fd.peers = peersOf(selected);
    fd.selColor.set((localId && colorByPlayer.get(localId)) || "#22d3ee");
    for (let i = 0; i < 81; i++) {
      const entry: CellEntry | undefined = board?.[i];
      fd.hasValue[i] = !!entry && entry.value !== 0;
      const playerColor = entry?.byPlayer ? colorByPlayer.get(entry.byPlayer) : undefined;
      fd.ownColor[i].set(playerColor ?? IDLE_EMISSIVE);
    }
  }, [board, selected, colorByPlayer, localId]);

  // Placement pop: diff current values against the previous render's values.
  const prevValues = useRef<number[] | null>(null);
  useEffect(() => {
    if (!board) {
      prevValues.current = null;
      return;
    }
    const values = board.map((c) => c.value);
    const prev = prevValues.current;
    if (prev && prev.length === 81) {
      for (let i = 0; i < 81; i++) {
        if (values[i] === prev[i]) continue;
        if (values[i] !== 0) {
          const color =
            (board[i].byPlayer && colorByPlayer.get(board[i].byPlayer as string)) || "#e2e8f0";
          fx.schedule(i, 0, { flash: 0.5, lift: 0.14, scale: 0.16, color, duration: 0.5 });
        } else {
          // Erase: small deflate blink.
          fx.schedule(i, 0, { flash: 0.15, lift: 0.05, scale: 0.08, color: "#94a3b8", duration: 0.35 });
        }
      }
    }
    prevValues.current = values;
  }, [board, colorByPlayer, fx]);

  // FX bus choreography.
  useEffect(() => {
    return fxBus.on((e: FxEvent) => {
      switch (e.type) {
        case "cell-correct": {
          const origin = e.cellIndex;
          fx.schedule(origin, 0, { flash: 1, lift: 0.24, scale: 0.2, color: e.color, duration: 0.7 });
          for (let j = 0; j < 81; j++) {
            if (j === origin) continue;
            const d = gridDistance(origin, j);
            const strength = 0.45 * Math.max(0, 1 - d / 7);
            if (strength > 0.03) {
              fx.schedule(j, d * 45, {
                flash: strength,
                lift: 0.07 * strength * 2,
                color: CORRECT_GREEN,
                duration: 0.5,
              });
            }
          }
          break;
        }
        case "cell-wrong":
          fx.schedule(e.cellIndex, 0, {
            flash: 1.1,
            scale: 0.1,
            color: WRONG_RED,
            duration: 0.65,
          });
          break;
        case "unit-complete":
          e.cells.forEach((c: number, k: number) =>
            fx.schedule(c, k * 55, { flash: 0.85, lift: 0.2, scale: 0.12, color: e.color, duration: 0.6 })
          );
          break;
        case "board-complete":
          for (let j = 0; j < 81; j++) {
            fx.schedule(j, gridDistance(40, j) * 60, {
              flash: 0.7,
              lift: 0.16,
              scale: 0.08,
              color: CORRECT_GREEN,
              duration: 0.7,
            });
          }
          break;
        case "victory":
          for (let j = 0; j < 81; j++) {
            const wave = rowOf(j) + colOf(j);
            fx.schedule(j, wave * 70, {
              flash: 0.95,
              lift: 0.42,
              scale: 0.2,
              color: PLAYER_COLORS[wave % PLAYER_COLORS.length],
              duration: 0.9,
            });
          }
          break;
        default:
          break; // defeat handled by the 2D FxLayer overlay
      }
    });
  }, [fx]);

  // Scratch objects reused every frame — zero allocations in the loop.
  const scratch = useRef({
    sample: { flash: 0, lift: 0, scale: 0 } as PulseSample,
    pulseColor: new THREE.Color(),
    emissive: new THREE.Color(),
  });

  useFrame((_, delta) => {
    const now =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const dt = Math.min(delta, 0.1);
    const fd = frameData.current;
    const { sample, pulseColor, emissive } = scratch.current;
    for (let i = 0; i < 81; i++) {
      const h = handles.current[i];
      if (!h || !h.group || !h.mat) continue;
      fx.sample(i, now, sample, pulseColor);
      const isSel = fd.selected === i;
      const isPeer = !isSel && fd.peers.has(i);

      // Lift with damping (selected raised, hovered slightly, plus fx bumps).
      const targetY = (isSel ? 0.3 : h.hovered ? 0.13 : 0) + sample.lift;
      h.group.position.y = THREE.MathUtils.damp(h.group.position.y, targetY, 10, dt);

      // Pop scale.
      const s = THREE.MathUtils.damp(h.group.scale.x, 1 + sample.scale, 14, dt);
      h.group.scale.setScalar(s);

      // Emissive: selected pulses, peers brighten subtly, filled cells simmer.
      let base: number;
      if (isSel) base = 0.55 + Math.sin(now * 5) * 0.22;
      else if (isPeer) base = 0.22;
      else base = fd.hasValue[i] ? 0.12 : 0.05;

      emissive.copy(isSel ? fd.selColor : isPeer ? PEER_EMISSIVE : fd.ownColor[i]);
      const f = Math.min(1, sample.flash);
      if (f > 0.001) emissive.lerp(pulseColor, f);
      h.mat.emissive.copy(emissive);
      h.mat.emissiveIntensity = THREE.MathUtils.damp(
        h.mat.emissiveIntensity,
        base + sample.flash * 1.8,
        14,
        dt
      );
    }
  });

  if (!board || board.length !== 81) return null;

  return (
    <group>
      {board.map((entry, i) => {
        const given = entry.value !== 0 && entry.byPlayer === null;
        const textColor = given
          ? GIVEN_TEXT
          : (entry.byPlayer && colorByPlayer.get(entry.byPlayer)) || FALLBACK_ENTRY;
        return (
          <Tile
            key={i}
            index={i}
            value={entry.value}
            given={given}
            textColor={textColor}
            register={register}
          />
        );
      })}
    </group>
  );
}
