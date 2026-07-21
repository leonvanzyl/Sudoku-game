# Neon Sudoku — Realtime Multiplayer

A realtime multiplayer sudoku game with a neon-dark aesthetic. Solve one board
together in **co-op**, or take the same puzzle head-to-head in a **race**.
Built with Next.js (App Router), React, Tailwind CSS 4, Zustand, Ably realtime
messaging, and a react-three-fiber 3D board.

## Features

- **Two game modes**
  - **Co-op** — everyone works on the same shared board. Correct entries lock
    in for the whole team; the team wins when the board is complete.
  - **Race** — every player gets their own copy of the same puzzle. First to
    finish wins; live progress bars and mistake counts for all players.
- **Invite codes** — start a game, share the 6-letter code, friends join
  instantly. No accounts, no signup.
- **2D and 3D boards** — a crisp responsive 2D grid and a full
  react-three-fiber 3D scene (orbit camera, animated tiles, reflective floor),
  toggleable at any time.
- **Juicy feedback** — particle bursts on correct cells, screen shake on
  mistakes, sparkle sweeps on completed rows/columns/boxes, confetti and
  banners on victory.
- **Local progression** — XP for every finished game (win 60 / participation
  15, scaled ×1/×1.5/×2/×3 by difficulty), difficulty unlocks (easy → medium →
  hard → expert), best times. Stored in `localStorage`.
- **Generated puzzles** — every puzzle is generated on the fly with a unique
  solution, in well under a second even on expert.

## Local development

```bash
npm install
cp .env.example .env.local   # then paste your real Ably API key
npm run dev
```

You need a (free) [Ably](https://ably.com) account: create an app, copy an API
key from its "API Keys" tab, and set it in `.env.local`:

```
ABLY_API_KEY=your-real-key
```

The key stays server-side — browsers authenticate through the
`/api/ably-token` route, which issues short-lived token requests.

Open http://localhost:3000. To test multiplayer locally, open a second
browser (or a private window, so it gets its own player identity) and join
with the invite code.

Other scripts:

```bash
npm run test    # vitest (sudoku engine tests)
npm run build   # production build
npm run lint    # eslint
```

## Deploying to Vercel

1. Push this repo to GitHub and import it at https://vercel.com/new.
2. In the project settings, add an environment variable `ABLY_API_KEY` with
   your Ably API key (all environments).
3. Deploy. That's it — there is no database or other infrastructure.

## How multiplayer sessions work

Sessions are **ephemeral** and **host-authoritative**:

- The host's browser generates the puzzle and owns the authoritative
  `SharedGameState`. Nothing is stored on a server.
- Each game lives on one Ably channel (`sudoku:<CODE>`). Players enter Ably
  presence with their name; join order determines player colors, and the
  first member is the host.
- Joiners request the current state (`request-sync`) and the host replies
  with a `state-sync` snapshot; the host also rebroadcasts state whenever
  presence changes.
- Co-op moves are broadcast and applied by every client (including the
  sender) in Ably delivery order — last write wins, correct entries lock.
  In race mode only lightweight progress updates are shared.
- The host decides the win: it publishes `game-over` when the co-op board is
  complete or the first `race-finished` arrives.
- When the host ends the session (or disappears from presence for more than
  10 seconds), every client leaves and the game is gone for good.
