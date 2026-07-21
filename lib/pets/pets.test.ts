import { describe, expect, it } from "vitest";
import {
  assignPetSpecies,
  petHash,
  petName,
  PET_SPECIES,
  PET_SPRITE_SIZE,
} from "./catalog";
import type { PlayerInfo } from "@/lib/types";

const roster = (ids: string[]): PlayerInfo[] =>
  ids.map((id, i) => ({
    id,
    name: `P${i}`,
    color: "#22d3ee",
    isHost: i === 0,
  }));

describe("pet catalog", () => {
  it("sprite frames are all well-formed 10x10 grids of known palette chars", () => {
    for (const sp of PET_SPECIES) {
      expect(sp.frames).toHaveLength(2);
      for (const frame of sp.frames) {
        expect(frame).toHaveLength(PET_SPRITE_SIZE);
        for (const row of frame) {
          expect(row).toHaveLength(PET_SPRITE_SIZE);
          expect(row).toMatch(/^[.BDWPSA]+$/);
        }
      }
      expect(sp.names.length).toBeGreaterThan(0);
    }
  });

  it("assigns every player a species, unique while species remain", () => {
    const players = roster(["aaa", "bbb", "ccc", "ddd", "eee", "fff", "ggg", "hhh"]);
    const assigned = assignPetSpecies(players);
    expect(assigned.size).toBe(players.length);
    const ids = [...assigned.values()].map((s) => s.id);
    expect(new Set(ids).size).toBe(players.length);
  });

  it("assignment is deterministic for the same roster on every client", () => {
    const players = roster(["p1", "p2", "p3"]);
    const a = assignPetSpecies(players);
    const b = assignPetSpecies(players);
    for (const p of players) {
      expect(a.get(p.id)?.id).toBe(b.get(p.id)?.id);
    }
  });

  it("a player keeps their species when someone joins after them", () => {
    const before = assignPetSpecies(roster(["p1", "p2"]));
    const after = assignPetSpecies(roster(["p1", "p2", "p3"]));
    expect(after.get("p1")?.id).toBe(before.get("p1")?.id);
    expect(after.get("p2")?.id).toBe(before.get("p2")?.id);
  });

  it("pet names are stable per owner", () => {
    const sp = PET_SPECIES[0];
    expect(petName(sp, "owner-1")).toBe(petName(sp, "owner-1"));
    expect(sp.names).toContain(petName(sp, "owner-1"));
  });

  it("honors a player's requested species when it is free", () => {
    const players = roster(["p1", "p2"]);
    players[1].petId = "turtle";
    const assigned = assignPetSpecies(players);
    expect(assigned.get("p2")?.id).toBe("turtle");
  });

  it("resolves duplicate requests by join order — earlier player wins", () => {
    const players = roster(["p1", "p2"]);
    players[0].petId = "fox";
    players[1].petId = "fox";
    const assigned = assignPetSpecies(players);
    expect(assigned.get("p1")?.id).toBe("fox");
    expect(assigned.get("p2")?.id).not.toBe("fox");
    expect(assigned.get("p2")?.id).toBeDefined();
  });

  it("ignores unknown species requests and falls back to the hash default", () => {
    const plain = assignPetSpecies(roster(["p1"]));
    const bogus = roster(["p1"]);
    bogus[0].petId = "dragon";
    expect(assignPetSpecies(bogus).get("p1")?.id).toBe(plain.get("p1")?.id);
  });

  it("hash is non-negative for arbitrary ids", () => {
    for (const s of ["", "a", "🐸", "some-nanoid-Xy123"]) {
      expect(petHash(s)).toBeGreaterThanOrEqual(0);
    }
  });
});
