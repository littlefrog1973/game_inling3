# PAC-INK

A Pacman tribute — a dependency-free browser game built with plain HTML + CSS + ES modules. No npm, no frameworks, no test suite.

**Status:** all files implemented. See `MEMORY.md` for the full build log.

## How to run

No build step. Any static file server works:

```bash
python -m http.server 8000
# or
npx serve .
```

then open the printed URL (e.g. http://127.0.0.1:8000). Keys work on desktop; touch swipes work on mobile.

## Controls

| Input | Action |
|-------|--------|
| `← ↑ ↓ →` / `W A S D` | HOLD to move — pacman moves only while a direction key is held; releasing every direction key stops it immediately and leaves it stopped (re-pressing turns it instantly) |
| `Space` | Start / new game (fresh maze each run) |
| `P` | Pause / resume |
| Swipe on canvas | Direction (mobile) |
| Tap overlay | Start |

## How it plays

Every run roams a **freshly generated maze** (seeded recursive backtracker, validated so every reachable cell is pacman-walkable). Eat pellets for 10 pts, the 4 corner power pellets for 50 pts (and a 6-second frightened window, during which a frightened ghost is worth 200 × 2^combo, capped at 1600). Lose all 3 lives and it's game over; clear every pellet and you win. High score persists in `localStorage` (`pacink_high`).

## Architecture

Five small modules plus the shell — no build step, all ES modules (`<script type="module">`):

| File | Responsibility |
|------|----------------|
| `index.html` | Shell: HUD (score / best / lives), canvas (`#game-canvas`, 456×552), overlay (`#overlay`), control hint bar |
| `style.css` | Neon/arcade theme — game shell, HUD, overlay blur, lives pips, kbd chips, mobile breakpoints |
| `js/config.js` | Single source of truth: grid geometry (`CELL=24`, `COLS=19`, `ROWS=23`, `TUNNEL_ROW=16`), speeds, radii, timings, colors |
| `js/maze.js` | Procedural maze generation + pellet placement + BFS validation (see below) |
| `js/entities.js` | `Pacman` + `Ghost`: continuous pixel movement, per-cell-center targeting, tunnel wrap, maze-aware roaming AI |
| `js/renderer.js` | All canvas drawing (background, walls, pellets, pacman, ghosts, frightened faces). DOM-free — ctx is passed in by main.js; reads `game.elapsed` so animations freeze while paused |
| `js/game.js` | Orchestrator: level, entities, score/lives/combo, state machine (menu → ready → playing → dying → dead/gameover/win), HUD sync. Guarded DOM access so it stays importable in Node for headless tests |
| `js/main.js` | Browser entry point: rAF loop (dt clamped to 50ms), keyboard/touch/overlay input, pause badge. Owns ALL DOM access |

Boundaries: game logic and entities never touch the DOM; all DOM/canvas access lives in `js/main.js` and `js/renderer.js` (plus `js/game.js`'s guarded `syncHUD()`).

## Maze generation (seeded)

`createLevel(seed)` in `js/maze.js`:

- **PRNG**: `mulberry32(seed)` — a given seed always yields the same maze.
- **Carving**: randomized recursive backtracker over odd cells (x ∈ 1..17, y ∈ 1..21), skipping the ghost-house footprint.
- **Ghost house**: shell cols 7–11 rows 9–13, interior cols 8–10 rows 10–12, door at (9,13), passage at (9,14). The house is forbidden from maze carving.
- **Tunnel row**: row 16 is forced straight-open so pacman and ghosts can wrap left↔right horizontally.
- **Validation**: BFS from the spawn point (9,19) across pacman-walkable cells (tunnel-wrap aware); any open cell the pacman can't reach becomes a wall.
- **Pellets**: every reachable pacman-walkable cell except the tunnel row, spawn cell, and house cells; power pellets at (1,1), (17,1), (1,21), (17,21).

## Entities

- **Pacman**: continuous pixel movement, cell-center targeting, queued intents (max 3), instant reversal, blocked → idle (then adopts fresh intents), stop-on-release (hold-to-move) → snap to cell center, tunnel speed-up on the tunnel row, animated mouth.
- **Ghosts** (red chase / pink ambush / blue ambush-ahead / green chase): house → exit → cruise → return → eaten lifecycle; scatter/chase phases alternate ~4.8s; frightened ghosts roam randomly at reduced speed and blink in the final 1.4s; frightened ghosts that are eaten pause 0.8s then re-enter the house. Speeds: ghost 86 px/s (56 frightened, 46 inside the house), pacman 108 px/s (140 in the tunnel).
- All movement clamps against walls and never enters house cells (pacman) or out-of-bounds cells; tunnel wrapping is handled in both movement and BFS.

## Development notes

- **No test suite, no dependencies.** Validation is done via Node dynamic-import smoke tests (the ES modules are plain JS). Note: `node --check` fails on ES modules — validate by importing, not by flag.
- `js/game.js` is Node-importable by construction (all DOM access is guarded: `typeof document`, `typeof localStorage`), which is what enables the headless tests.
- The game shell scales via CSS (`#game-canvas { width:100%; image-rendering: pixelated }`); the canvas stays fixed at 456×552 internally.
