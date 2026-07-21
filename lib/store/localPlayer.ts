// Persistent local player identity — { id, name } in localStorage.
// SSR-safe: never touches localStorage on the server.

import { nanoid } from "nanoid";

const ID_KEY = "sudoku:player-id";
const NAME_KEY = "sudoku:player-name";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null; // storage disabled (private mode / permissions)
  }
}

/** Returns the persisted player id, creating (and persisting) one if absent. */
export function getOrCreateLocalPlayerId(): string {
  const ls = storage();
  if (!ls) return nanoid();
  let id = ls.getItem(ID_KEY);
  if (!id) {
    id = nanoid();
    ls.setItem(ID_KEY, id);
  }
  return id;
}

/** Last name the player entered, or null if never set / on the server. */
export function loadPlayerName(): string | null {
  return storage()?.getItem(NAME_KEY) ?? null;
}

/** Persist the player's display name. No-op on the server. */
export function savePlayerName(name: string): void {
  storage()?.setItem(NAME_KEY, name);
}

const COLOR_KEY = "sudoku:player-color";

/** The player's chosen color, or null if never picked / on the server. */
export function loadPreferredColor(): string | null {
  return storage()?.getItem(COLOR_KEY) ?? null;
}

/** Persist the player's chosen color. No-op on the server. */
export function savePreferredColor(color: string): void {
  storage()?.setItem(COLOR_KEY, color);
}
