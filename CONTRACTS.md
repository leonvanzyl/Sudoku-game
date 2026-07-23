# Architecture Contracts

Multiplayer Sudoku — Next.js 16 (App Router) + React 19 + Tailwind 4 + Ably +
zustand. Deployed to Vercel. No server persistence: the
**host client is the authority**; the game dies when the host ends the session.

All shared types live in `lib/types.ts`. **Never redefine them.**

## How a game works

1. Host enters name → picks mode (coop/race) + difficulty → `createGame()`
   generates an invite code + puzzle locally → navigates to `/game/[code]`,
   attaches to Ably channel `sudoku:<CODE>`, enters presence.
2. Joiner enters name + code → navigates to `/game/[code]` → enters presence →
   publishes `request-sync` → host replies `state-sync`.
3. Lobby shows players; host clicks Start → publishes `start-game`.
4. Co-op: every input publishes `move`; ALL clients (incl. sender) apply moves
   in Ably delivery order (last-write-wins; correct entries lock).
   Race: input applies to `localBoard` only; publish `race-progress` /
   `race-finished`. Host publishes `game-over` when a win condition is met
   (host observes coop board completion / first race-finished).
5. Host "End session" → `end-session` → all clients `leaveGame()` + navigate
   home. Clients also treat host presence-leave (>10s, no rejoin) as ended.

## Module ownership (each agent owns ONLY its files)

| Module   | Files |
|----------|-------|
| engine   | `lib/sudoku/*` (generator.ts, solver.ts, index.ts), `lib/sudoku/sudoku.test.ts` |
| realtime | `app/api/ably-token/route.ts`, `lib/realtime/*` (ablyClient.ts, useGameChannel.ts) |
| store    | `lib/store/*` (gameStore.ts, progression.ts, localPlayer.ts) |
| ui-2d    | `app/layout.tsx`, `app/page.tsx`, `app/game/[code]/page.tsx`, `app/globals.css`, `components/board2d/*`, `components/lobby/*`, `components/hud/*`, `components/GameShell.tsx` |
| fx       | `lib/fx/*` (bus.ts), `components/fx/*` |
| pets     | `lib/pets/*` (catalog.ts, useFunDirector.ts, pets.test.ts), `components/pets/*` |

## Module APIs

### engine — `lib/sudoku/index.ts` re-exports:
```ts
generatePuzzle(difficulty: Difficulty): { puzzle: Grid; solution: Grid }
solve(grid: Grid): Grid | null                 // backtracking solver
isValidPlacement(grid: Grid, index: number, value: number): boolean
getConflicts(grid: Grid): Set<number>          // indexes violating row/col/box
getCompletedUnits(grid: Grid, solution: Grid): number[][] // fully-correct rows/cols/boxes as index arrays
isComplete(grid: Grid, solution: Grid): boolean
```
Generator: full solved grid via randomized backtracking, then remove clues
down to ~`DIFFICULTY_GIVENS[d]` while a solution still exists (uniqueness
check best-effort with a bounded second-solution search). Must run <1s.
Pure functions, no React. Vitest tests colocated (`lib/sudoku/sudoku.test.ts`).

### realtime
- `app/api/ably-token/route.ts`: GET, uses `process.env.ABLY_API_KEY`
  (Ably REST `auth.createTokenRequest`), `clientId` from query param.
  Returns 500 with clear JSON error if the env var is missing.
- `lib/realtime/ablyClient.ts`: lazy singleton `getAblyClient(clientId)`
  → `Ably.Realtime` with `authUrl: "/api/ably-token?clientId=..."`.
- `lib/realtime/useGameChannel.ts`: `useGameChannel(code: string)` hook.
  Wires channel ⇄ `useGameStore`: subscribes to all `GameMessage`s and calls
  the matching store actions; watches presence → `setPlayers` (join order =
  color order; first presence member = host); publishes messages returned by
  `inputNumber` (the hook exposes `publish(msg: GameMessage)` and
  `endSession()`; components call these). Host responsibilities implemented
  here: answer `request-sync`, rebroadcast `state-sync` on presence change,
  detect win conditions from store state, publish `game-over`, and the
  host-left watchdog. Returns `{ publish, endSession, connectionStatus }`.

### store — implements `GameStore` from `lib/types.ts` exactly
- `lib/store/localPlayer.ts`: persistent `{ id, name }` in localStorage.
- `lib/store/progression.ts`: load/save `Progression`, `addXp` — XP: win=60,
  loss/participation=15, scaled ×1/×1.5/×2/×3 by difficulty; unlocks per
  `UNLOCK_XP`.
- `gameStore.ts` calls the engine for puzzles/validation and **emits FxEvents
  via `lib/fx/bus.ts`** on move outcomes (cell-correct, cell-wrong,
  unit-complete, board-complete, victory, defeat).

### ui-2d
- `app/page.tsx`: landing — name entry, Create Game panel (mode + difficulty
  w/ locked difficulties shown w/ lock + XP needed), Join panel (code input).
  Impressive dark aesthetic (glassmorphism, gradient glow, animated bg).
- `app/game/[code]/page.tsx`: renders `GameShell` (client component).
- `GameShell.tsx`: calls `useGameChannel(code)`; renders lobby (phase=lobby:
  player list w/ colors, big invite-code display w/ copy button, host start
  button) or game screen: board area (`Board2D`), HUD (players + live race
  progress bars w/ names, timer, difficulty badge, number pad
  1-9 + erase, host End Session button), and mounts `components/fx/FxLayer`.
- Board2D: 9×9 grid, givens bold, player entries tinted with that player's
  color (name tooltip on hover), selection + peer highlight, conflicts marked.
  Keyboard input (1-9, arrows, backspace) + number pad. Mobile responsive.

### fx
- `lib/fx/bus.ts`: tiny typed event bus — `fxBus.emit(e: FxEvent)`,
  `fxBus.on(fn: FxListener): () => void`.
- `components/fx/FxLayer.tsx` (default export, no props): full-screen
  pointer-events-none overlay subscribing to the bus: particle bursts at the
  completed cells (DOM/canvas confetti, no external deps), unit-complete
  sweep, screen-edge red flash + shake class on `cell-wrong`, full victory
  confetti + winner banner data (banner itself rendered here), defeat dim.
  Needs cell → screen position: board cells carry `data-cell-index`
  attributes — FxLayer queries `[data-cell-index="i"]` for coords, falling
  back to the board center.

### pets — fun extras (pixel pets + random events)
- `lib/pets/catalog.ts`: pixel sprite data (10×10, 2 frames, player-color
  accent pixels), deterministic room-unique species assignment by player id,
  stable pet names. Pure; canvas rendering client-guarded.
- `lib/pets/useFunDirector.ts`: `useFunDirector(publish)` — mounted by
  GameShell; schedules `pet-help` (host in co-op; each client locally via
  `petAssistLocal` in race) and `disaster` messages (host). Respects the
  host-toggleable `petsEnabled` / `eventsEnabled` flags in SharedGameState
  (toggled live via the `fun-settings` message; both default true).
- Players pick their pet in the lobby (`components/pets/PetPicker.tsx`,
  mirroring ColorPicker): the choice persists locally (`PlayerInfo.petId`),
  is announced via presence, and conflicts resolve deterministically by
  join order in `assignPetSpecies` (unrequested players keep their
  id-hash default).
- `components/pets/PetLayer.tsx` (default export, no props): fixed overlay
  animating one pixel pet per player — wandering, dashing to
  helped cells (`pet-help` fx), panicking on `disaster` fx, and playing
  proximity interactions (hearts/duets/naps; purely local flavor).
- Pet help fills only empty cells with the correct value, attributed to the
  pet's owner, and never touches the last 3 empty cells.

## Conventions
- All interactive components: `"use client"`.
- Imports via `@/` alias. TypeScript strict. No new runtime deps beyond
  what's in package.json (ably, zustand, framer-motion, nanoid).
- `npm run build` and `npx vitest run` must pass.
- Env: `ABLY_API_KEY` (server-only). `.env.example` documents it.
