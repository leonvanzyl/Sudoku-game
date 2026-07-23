"use client";

// ============================================================
// PetLayer — fixed, pointer-events-none overlay that brings each
// player's pixel pet to life on the board.
//
// Pets are cosmetic and purely client-side: every client animates
// all pets locally (positions differ between clients and that's
// fine). The gameplay-relevant part — a pet filling a cell — comes
// in over the fx bus as a `pet-help` event (a lucky-chance reward
// for its owner's correct placement), which sends the owner's pet
// dashing to that cell to celebrate.
//
// Also on the fx bus: an intense `disaster` (this board got hit)
// makes every pet panic-scatter.
// Pets that wander close to each other stop and interact (hearts,
// duets, naps) — local flavor, no networking.
//
// One rAF loop mutates DOM transforms directly; React only renders
// the static per-pet structure when the roster changes.
// ============================================================

import { useEffect, useMemo, useRef } from "react";
import { useGameStore } from "@/lib/store/gameStore";
import { fxBus } from "@/lib/fx/bus";
import {
  assignPetSpecies,
  petName,
  renderPetFrame,
  type PetSpecies,
} from "@/lib/pets/catalog";

const PET_PX = 30; // rendered sprite size (10px art × 3)
const WANDER_SPEED = 45;
const DASH_SPEED = 300;
const PANIC_SPEED = 210;
const INTERACT_DIST = 38;
const INTERACT_MS = 2800;
const INTERACT_COOLDOWN_MS = 25_000;
const PANIC_MS = 3200;
const CELEBRATE_MS = 1700;

const EMOTE_PAIRS: readonly [string, string][] = [
  ["💕", "💕"],
  ["🎶", "🎶"],
  ["💤", "💤"],
  ["✨", "✨"],
  ["😺", "😊"],
];

interface PetMeta {
  ownerId: string;
  ownerName: string;
  color: string;
  species: PetSpecies;
  name: string;
  frameUrls: [string, string];
}

interface PetState {
  x: number;
  y: number;
  tx: number;
  ty: number;
  mode: "wander" | "sit" | "dash" | "interact" | "panic";
  /** performance.now() when the current sit/interact/panic ends. */
  modeUntil: number;
  /** Cell the pet is dashing to (pet-help), else null. */
  dashCell: number | null;
  facing: 1 | -1;
  frame: 0 | 1;
  frameAt: number;
  emote: string | null;
  emoteUntil: number;
  bobPhase: number;
  /** Last time this pet re-picked a panic target. */
  panicRepickAt: number;
}

type BoardRect = { left: number; top: number; right: number; bottom: number };

function measureBoardRect(): BoardRect | null {
  const first = document.querySelector('[data-cell-index="0"]');
  const last = document.querySelector('[data-cell-index="80"]');
  if (!first || !last) return null;
  const a = first.getBoundingClientRect();
  const b = last.getBoundingClientRect();
  if (a.width === 0 || b.width === 0) return null;
  return { left: a.left, top: a.top, right: b.right, bottom: b.bottom };
}

/** How long a measured board rect stays fresh without an invalidating event. */
const BOARD_RECT_TTL_MS = 300;

function cellCenter(index: number): { x: number; y: number } | null {
  const el = document.querySelector(`[data-cell-index="${index}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export default function PetLayer() {
  const players = useGameStore((s) => s.game?.players ?? null);
  const phase = useGameStore((s) => s.game?.phase ?? null);
  const petsEnabled = useGameStore((s) => s.game?.petsEnabled ?? true);

  const active = phase === "playing" && petsEnabled;

  const pets: PetMeta[] = useMemo(() => {
    if (!players || !active) return [];
    const species = assignPetSpecies(players);
    return players.map((p) => {
      const sp = species.get(p.id)!;
      return {
        ownerId: p.id,
        ownerName: p.name,
        color: p.color,
        species: sp,
        name: petName(sp, p.id),
        frameUrls: [
          renderPetFrame(sp, 0, p.color),
          renderPetFrame(sp, 1, p.color),
        ] as [string, string],
      };
    });
  }, [players, active]);

  /** Persist positions across roster re-renders so pets don't teleport. */
  const statesRef = useRef<Map<string, PetState>>(new Map());
  const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const petsRef = useRef<PetMeta[]>([]);
  useEffect(() => {
    petsRef.current = pets;
  }, [pets]);

  const petsKey = pets.map((p) => `${p.ownerId}:${p.color}`).join("|");

  useEffect(() => {
    if (!active || petsRef.current.length === 0) return;

    const states = statesRef.current;
    // Pair-interaction cooldowns, keyed "idA|idB" (sorted).
    const cooldowns = new Map<string, number>();

    /* getBoundingClientRect forces a synchronous layout flush, so the board
     * rect is cached and re-measured only on resize/scroll or after a short
     * TTL — not on all four gBCR reads every frame. */
    let cachedRect: BoardRect | null = null;
    let rectMeasuredAt = -Infinity;
    const invalidateRect = () => {
      rectMeasuredAt = -Infinity;
    };
    const boardRect = (now: number): BoardRect | null => {
      if (now - rectMeasuredAt > BOARD_RECT_TTL_MS) {
        cachedRect = measureBoardRect();
        rectMeasuredAt = now;
      }
      return cachedRect;
    };
    window.addEventListener("resize", invalidateRect);
    window.addEventListener("scroll", invalidateRect, { passive: true, capture: true });

    /* The emote/img children are static per pet — resolve them once per
     * container node instead of querySelector-ing every pet every frame. */
    const partsCache = new WeakMap<
      HTMLDivElement,
      { img: HTMLImageElement | null; emote: HTMLElement | null }
    >();
    const partsOf = (node: HTMLDivElement) => {
      let parts = partsCache.get(node);
      if (!parts) {
        parts = {
          img: node.querySelector<HTMLImageElement>("[data-pet-img]"),
          emote: node.querySelector<HTMLElement>("[data-pet-emote]"),
        };
        partsCache.set(node, parts);
      }
      return parts;
    };

    const spawn = (): PetState => {
      const r = boardRect(performance.now());
      const cx = r ? rand(r.left, r.right) : window.innerWidth / 2;
      const cy = r ? rand(r.top, r.bottom) : window.innerHeight / 2;
      return {
        x: cx,
        y: cy,
        tx: cx,
        ty: cy,
        mode: "sit",
        modeUntil: performance.now() + rand(400, 1600),
        dashCell: null,
        facing: 1,
        frame: 0,
        frameAt: 0,
        emote: null,
        emoteUntil: 0,
        bobPhase: rand(0, Math.PI * 2),
        panicRepickAt: 0,
      };
    };

    const unsubscribe = fxBus.on((e) => {
      if (e.type === "pet-help") {
        const s = states.get(e.ownerId);
        const target = cellCenter(e.cellIndex);
        if (!s || !target) return;
        s.mode = "dash";
        s.dashCell = e.cellIndex;
        s.tx = target.x;
        s.ty = target.y - PET_PX * 0.4; // perch just above the digit
        s.emote = "❕";
        s.emoteUntil = performance.now() + 900;
      } else if (e.type === "disaster" && e.intense) {
        // Only when THIS board is hit — a rival's disaster is their problem.
        const now = performance.now();
        for (const s of states.values()) {
          s.mode = "panic";
          s.modeUntil = now + PANIC_MS + rand(0, 600);
          s.dashCell = null;
          s.emote = "❗";
          s.emoteUntil = now + 1400;
          s.panicRepickAt = 0;
        }
      }
    });

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const r = boardRect(now);
      const metas = petsRef.current;

      for (const meta of metas) {
        let s = states.get(meta.ownerId);
        if (!s) {
          s = spawn();
          states.set(meta.ownerId, s);
        }
        const node = nodesRef.current.get(meta.ownerId);
        if (!node) continue;
        if (!r) {
          node.style.display = "none";
          continue;
        }
        node.style.display = "";

        const pad = PET_PX / 2;
        const pickWanderTarget = () => {
          s!.tx = rand(r.left + pad, r.right - pad);
          s!.ty = rand(r.top + pad, r.bottom - pad);
        };

        // ---- mode transitions ----
        switch (s.mode) {
          case "sit":
          case "interact":
            if (now >= s.modeUntil) {
              s.mode = "wander";
              pickWanderTarget();
            }
            break;
          case "panic":
            if (now >= s.modeUntil) {
              s.mode = "sit";
              s.modeUntil = now + rand(800, 2000);
            } else if (now - s.panicRepickAt > 320) {
              s.panicRepickAt = now;
              pickWanderTarget();
            }
            break;
          case "wander":
            break;
          case "dash":
            // Retarget each frame — the page may scroll under the pet.
            if (s.dashCell !== null) {
              const c = cellCenter(s.dashCell);
              if (c) {
                s.tx = c.x;
                s.ty = c.y - PET_PX * 0.4;
              }
            }
            break;
        }

        // ---- movement ----
        const speed =
          s.mode === "dash" ? DASH_SPEED : s.mode === "panic" ? PANIC_SPEED : WANDER_SPEED;
        const dx = s.tx - s.x;
        const dy = s.ty - s.y;
        const dist = Math.hypot(dx, dy);
        const moving = s.mode === "wander" || s.mode === "dash" || s.mode === "panic";
        if (moving && dist > 3) {
          const step = Math.min(dist, speed * dt);
          s.x += (dx / dist) * step;
          s.y += (dy / dist) * step;
          if (Math.abs(dx) > 2) s.facing = dx >= 0 ? 1 : -1;
        } else if (moving) {
          // Arrived.
          if (s.mode === "dash") {
            s.mode = "sit";
            s.modeUntil = now + CELEBRATE_MS;
            s.dashCell = null;
            s.emote = "✨";
            s.emoteUntil = now + CELEBRATE_MS;
          } else if (s.mode === "wander") {
            s.mode = "sit";
            s.modeUntil = now + rand(1000, 4200);
          }
        }

        const { img, emote: bubble } = partsOf(node);

        // ---- sprite frame ----
        const frameMs = moving && dist > 3 ? 170 : 430;
        if (now - s.frameAt > frameMs) {
          s.frameAt = now;
          s.frame = s.frame === 0 ? 1 : 0;
          if (img) img.src = meta.frameUrls[s.frame];
        }

        // ---- emote bubble ----
        if (bubble) {
          const show = s.emote !== null && now < s.emoteUntil;
          bubble.style.opacity = show ? "1" : "0";
          if (show && bubble.textContent !== s.emote) bubble.textContent = s.emote;
          if (!show) s.emote = null;
        }

        // ---- apply transform ----
        const bob =
          s.mode === "interact"
            ? Math.abs(Math.sin(now / 130 + s.bobPhase)) * -5
            : moving && dist > 3
              ? Math.abs(Math.sin(now / 110 + s.bobPhase)) * -2.5
              : 0;
        node.style.transform = `translate3d(${s.x - PET_PX / 2}px, ${
          s.y - PET_PX / 2 + bob
        }px, 0)`;
        if (img) img.style.transform = `scaleX(${s.facing})`;
      }

      // ---- adorable pet-pet interactions ----
      for (let i = 0; i < metas.length; i++) {
        for (let j = i + 1; j < metas.length; j++) {
          const a = states.get(metas[i].ownerId);
          const b = states.get(metas[j].ownerId);
          if (!a || !b) continue;
          const idle = (p: PetState) => p.mode === "wander" || p.mode === "sit";
          if (!idle(a) || !idle(b)) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) > INTERACT_DIST) continue;
          const key = [metas[i].ownerId, metas[j].ownerId].sort().join("|");
          if (now - (cooldowns.get(key) ?? -Infinity) < INTERACT_COOLDOWN_MS) continue;
          cooldowns.set(key, now);
          const [ea, eb] = EMOTE_PAIRS[Math.floor(Math.random() * EMOTE_PAIRS.length)];
          for (const [p, other, emote] of [
            [a, b, ea],
            [b, a, eb],
          ] as const) {
            p.mode = "interact";
            p.modeUntil = now + INTERACT_MS;
            p.tx = p.x;
            p.ty = p.y;
            p.facing = other.x >= p.x ? 1 : -1;
            p.emote = emote;
            p.emoteUntil = now + INTERACT_MS;
          }
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      window.removeEventListener("resize", invalidateRect);
      window.removeEventListener("scroll", invalidateRect, { capture: true });
    };
    // petsKey covers roster/color changes; `active` gates the whole loop.
  }, [active, petsKey]);

  if (!active || pets.length === 0) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 40,
        overflow: "hidden",
      }}
    >
      {pets.map((pet) => (
        <div
          key={pet.ownerId}
          ref={(el) => {
            const map = nodesRef.current;
            if (el) map.set(pet.ownerId, el);
            else map.delete(pet.ownerId);
          }}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: PET_PX,
            willChange: "transform",
            display: "none",
          }}
        >
          <span
            data-pet-emote
            style={{
              position: "absolute",
              left: "50%",
              top: -18,
              transform: "translateX(-50%)",
              fontSize: 12,
              lineHeight: "16px",
              padding: "0 3px",
              borderRadius: 6,
              background: "rgba(8, 10, 20, 0.7)",
              opacity: 0,
              transition: "opacity 160ms ease",
              whiteSpace: "nowrap",
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny generated data-URL sprite */}
          <img
            data-pet-img
            src={pet.frameUrls[0]}
            alt=""
            width={PET_PX}
            height={PET_PX}
            style={{
              display: "block",
              imageRendering: "pixelated",
              filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.5))",
            }}
          />
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: PET_PX + 1,
              transform: "translateX(-50%)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 8,
              letterSpacing: "0.08em",
              color: pet.color,
              opacity: 0.85,
              textShadow: "0 1px 2px rgba(0,0,0,0.8)",
              whiteSpace: "nowrap",
            }}
          >
            {pet.name}
          </span>
        </div>
      ))}
    </div>
  );
}
