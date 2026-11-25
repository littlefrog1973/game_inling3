# Pacman ("PAC-INK") — Project Status Memory

> Generated 2026-11-24 by the lead agent at the end of a build span.
> Updated 2026-11-25: `js/game.js` implemented & validated (headless); `js/renderer.js` now DONE & MATCHES SPEC (was stale "NOT WRITTEN").
> Read this first in a fresh session. It describes exact file state, known defects, and the remaining task list.

## User intent (verbatim)
"make a pacman game. write each file immediately after generated."

The game must be dependency-free: HTML + CSS + ES modules, no npm/frameworks, no test suite.
Hard requirement: **write each file the moment it is produced — never batch files at the end.**

## Environment
- Working dir: `/home/littlefrog/Projects/game_inling3` (all paths relative to it)
- Node v24.18.0, Python 3.15.2; no installs needed; DSH danger-full-access
- Canvas internally 456×552 px = 19 cols × 23 rows, CELL=24px; CSS-scaled
- No npm; ES modules (`<script type="module">`); browser APIs ONLY in `js/main.js` and `js/renderer.js`. `js/game.js` additionally touches `document`/`localStorage` in a guarded `syncHUD()` (Node-importable) — no imports of browser globals at module load time.
- `node --check` FAILS on ES-module `import` — validate with Node dynamic-import instead
- Maze/movement invariants: targets = odd cells (x∈1..17, y∈1..21); passages at even rows/cols; backtracker stack of odd cells; tunnel wrap in BFS and entity movement

## File inventory & status (as of this memory)
| File | Status | Notes |
|------|--------|-------|
| `index.html` | DONE (45 lines) | HUD: `#score`, `#high-score`, `#lives`; `.canvas-wrap` > `#game-canvas` (456×552) + `#overlay` > `#overlay-title` ("PAC-INK") + `#overlay-message`; footer hint; `<script type="module" src="js/main.js">` |
| `style.css` | DONE (219 lines) | Neon/arcade; `.game-shell` max-width 520px; `#game-canvas { width:100%; height:auto; image-rendering: pixelated }`; overlay blur + `blink` animation; `.lives` pip (polygon clip-path); kbd chips; mobile breakpoints |
| `js/config.js` | DONE (39 lines) | `CELL=24`, `COLS=19`, `ROWS=23`, `TUNNEL_ROW=16`; speeds `PACMAN=108`, `TUNNEL=140`, `GHOST=86`, `FRIGHT=56`, `GHOST_HOME=46`; radii `PACMAN=9`, `PELLET=2.6`, `POWER=6`; `FRIGHT_TIME=6.0`, `FRIGHT_BLINK_TIME=1.4`, `START_DELAY=1.0`, `DEATH_DELAY=1.35`; `COLORS` (bg `#05050e`, wall `#1d2a6e`, wallEdge `#3a4bd0`, pellet `#ffe9b0`, power `#ffb347`, pacman `#ffd23f`, ghost colors red/pink/blue/green); `SWAY={scatterMs:4800}` |
| `js/maze.js` | DONE & VALIDATED (182 lines) | See below |
| `js/entities.js` | DONE & VALIDATED (~510 lines; movement-smoke-tested 2026-11-25) | All known defects fixed — see below |
| `js/renderer.js` | DONE (254 lines, written 2026-11-25 06:04) | Matches spec; reads `game.elapsed` (frozen when paused); draws dead pacman skipped; double-checked against `#overlay hidden` flow |
| `js/game.js` | DONE & VALIDATED (330 lines) | See current-state section below |
| `js/main.js` | DONE (2026-11-25) | rAF loop (dt clamp 50ms) + input; DOM access only here. Headless DOM-stub smoke test passed |
| `README.md` | DONE (2026-11-25) | How to run + controls + architecture + maze-gen notes |

## js/maze.js — validated details
- `mulberry32(seed)` PRNG; `isHouseCell(x,y)` (export) = interior cols 8–10 rows 10–12 + door (9,13) + passage (9,14)
- `createLevel(seed)`:
  - `forbidden(x,y)` = x∈7..11 && y∈9..14 (keeps the house footprint out of the carving)
  - carveMaze: recursive backtracker over odd cells; skips corridor targets and passage midpoints in the forbidden region
  - placeGhostHouse: shell cols 7–11 rows 9–13 (`#`), interior rows 10–12 cols 8–10 (`.`), door (9,13) = `.`, passage (9,14) = `.`
  - tunnel row forced straight-open: `grid[16][x]='.'` for all x
  - spawn {x:9, y:19} with safety-net `.` fallback
  - BFS from spawn across pacman-walkable cells (tunnel wrap when y===16); unreachable `.` cells → `#`
  - pellets on reachable pacman-walkable cells, excluding house region, tunnel row 16 cells (all x), spawn cell, corner cells
  - power pellets at (1,1),(17,1),(1,21),(17,21)
  - returns `{cols, rows, grid, tunnelRow, spawn, pellets: Map("x,y"→{power}), pelletCount, powerCount, isPacmanWalkable, isGhostWalkable}`
- Validated seeds [1,7,42,1337,2024,99,777,31337]: ~171–177 pellets, 4 power pellets, 4 reachable-corner power cells, spawn ok
- `isPacmanWalkable` = inBounds && grid==='.' && !isHouseCell; `isGhostWalkable` = inBounds && grid==='.'

## js/entities.js — current state
Exports: `GRID_W=456`, `GRID_H=552`, `GHOST_HOUSE_SPAWNS=[{x:8,y:11},{x:9,y:11},{x:10,y:11},{x:9,y:10}]` (rows 10–12, cols 8–10), `cellCenter(x,y)`, `isTunnelRow(y)`, `GHOST_SPECS=[chase red (17,21), ambush pink (1,1), ambushLead blue (17,1), chase green (1,21)]`, `Pacman`, `Ghost`.
(No `resetGhosts` helper — game.js constructs ghosts directly from `GHOST_SPECS` + `GHOST_HOUSE_SPAWNS`, passing `houseSpawnPos` to `reset()`.)

### `moveWithWalls(px,py,dx,dy,step,isWalkable,tunnelWrap)` → `{px,py,cx,cy,blocked}`
- Tunnel row + horizontal move → wrap off either edge; vertical drift none; NO clamping; blocked=false
- Otherwise: target cell check; on wall → clamp at current-cell edge; blocked=true; safety revert returns blocked=true
- (Load-verified and exercised by the movement smoke test.)

### `Pacman`
- `reset(level)`: spawn from level (fallback (9,19)); px/py at center; dir/queue clean; mouthTimer=0; dead=false
- `setDesiredDirection(dx,dy)`: instant reversal from moving state (clears queue); dedupes last-queued; drops opposites of current dir from queue; queue cap 3
- `snapToCellCenter()`
- `update(dt, level, opts)`: adopt queue near center (distToCenter <= 6) or idle; lane-centering snap (perp axis pinned to current cell center every frame; horizontal dir → py; vertical dir → px; idle → both) so pacman never straddles two lanes; tunnel-wrap-aware destination check (corrupting intents dropped); move; `blocked` → revert px/py to current cell center + dir=idle (never park flush at the wall edge); speed TUNNEL_SPEED in tunnel else PACMAN_SPEED; `mouthTimer += dt`
- `isInTunnel()`, `biteProgress()` (0..1 via |sin(t*π)|, 0.3s cycle)
- Smoke-tested: instant reversal (dir flips + queue cleared), blocked → idle → adopts fresh intent, tunnel wrap fires.

### `Ghost` (states: house → exit → cruise → return → eaten; 'eaten' = no-op, game.js flips to 'return')
- `constructor(spec, spawnPos)`: stores personality/color/scatterTarget/spawnPos; dir=idle; state='house'; frightened=0; releaseTimer=0; releaseDelay=1.5 (overwritten by reset); `_lastPickCell` latch for one direction-pick per cell
- `reset(level, houseSpawnPos?)`: px/py at spawn center; state='house'; releaseTimer=0; frightened=0; eatenPause=0; releaseDelay = `_releaseDelayFor()` ([0.9, 2.6, 4.2, 5.6], verified per spec order); BFS caches seeded
- `_releaseDelayFor()` — delays array + `GHOST_SPECS.findIndex(s => s.personality===personality && s.color===this.color)` — red vs green chase disambiguated by color
- `_bfs(level, target)` — BFS distance from target (tunnel wrap), cached by target key
- `resolveTarget(pacman, opts)` — scatter (if opts.scatter or no pacman) → scatterTarget; ambush → 2 cells ahead (clamped); ambushLead → 4 cells ahead (vertical-dir → tx=pacman.cellX; clamped); chase → pacman cell
- `chooseRoamDirection(level, target, frightened)` — lowest-BFS-distance walkable neighbor; reverse skipped unless frightened; **dead-end fallback** (only-reverse allowed when it is the sole option — prevents infinite stall in corridor ends); frightened: uniform random pick from candidates (no jitter filter)
- `update(dt, level, opts)`:
  - house: releaseTimer += dt; once >= releaseDelay → state='exit'
  - exit: axis-separated steps (straighten onto door column 9, then walk down to the passage (9,14)); on passage → state='cruise', dir={0,1}, snap to passage center, BFS caches cleared, `_lastPickCell=null`
  - return: BFS toward interior (9,11); re-pick at junctions (`distToCenter <= 6` + `_lastPickCell` latch); move via moveWithWalls (tunnelWrap when cellY===16); on `isInsideHouse` → state='house', releaseTimer=0, releaseDelay=1.0 (short re-release after eating), caches cleared
  - cruise: frightened countdown; re-pick at junction (`distToCenter <= 6` + `_lastPickCell` latch, once per cell); move via moveWithWalls (tunnelWrap when cellY===16); speed FRIGHT/normal
- `isInsideHouse()`: cellY∈10..12 && cellX∈8..10 (level param removed)

## js/entities.js — known defects: ALL FIXED & SMOKE-TESTED (2026-11-25)
1. **Cruise junction threshold** — 1.5 → 6 (like Pacman), plus a `_lastPickCell` latch so ghosts re-pick once per cell (non-frightened deterministic; frightened single random pick — no per-frame jitter).
2. **Frightened jitter filter** — 25% `Math.random()` `continue` removed; uniform random pick from candidates remains.
3. **Ghost `return` state** — rewritten: BFS toward interior (9,11), move via `moveWithWalls` + tunnelWrap (same as cruise), `curDist <= 1` door-skip removed, re-pick with the same 6px + latch logic. Smoke-tested: teleported to corner → returns to house in ~8.5s.
4. **Ghost `exit` state** — axis-separated steps (straighten onto door column, then walk down), no more sqrt(2) diagonal step; dead `_waypoint`/`returnWaypoint` removed.
5. **Dead code** — `exportedIsHouseCell`, `clampInt`, `normalizeCx` (became dead after the return rewrite), unused `PACMAN_RADIUS` import, double blank line: all removed.
6. **Instant-reversal flush** — smoke-tested: dir flips immediately, queue cleared.
7. **Release delays** — smoke-tested per spec order: red 0.9 / pink 2.6 / blue 4.2 / green 5.6.
8. **Pacman blocked → idle** — smoke-tested: adopts fresh queued intents next frame; no infinite stall.
9. **`normalizeCx` ordering** — dead, removed.
Plus robustness: **dead-end corridor cells** (7–15 per seed) — `chooseRoamDirection` now allows reversing when it is the only option (previously: infinite stall). Smoke-tested.
10. **Tunnel-wrap edge cells inverted** (2026-11-25) — `moveWithWalls` reported `COLS-1` when the entity was past the LEFT edge (`nx<0`) and `0` when past the RIGHT edge (`nx>=GRID_W`), shifting the logical cell a full 18-cell grid away from the drawn position. This fed ghost AI (`chooseRoamDirection`/`resolveTarget` via `pacman.cellX`), same-cell collision in `game.js` (`ghost.cellX === pacman.cellX`), and tunnel intent adoption. Fixed: nearest in-bounds edge cell (`0` left, `COLS-1` right). Verified headless: pacman + ghosts transition `18→0→1` (right exit) and `0→18→17` (left exit), lethal + frightened tunnel-edge collisions now register, full 20s run: 0 non-finite ticks, 0 tunnel cell mismatches.

11. **Pacman lane offset / wall-edge parking** (2026-11-25) — the blocked-clamp parked pacman flush at the wall edge (12px off the corridor centerline) and mid-cell turns left the perpendicular axis unsnapped, so pacman visually straddled two lanes and missed pellets (PELLET_EAT_RADIUS=6px < 12px offset). Fixed: snap the perpendicular axis to the current cell center every frame (and both axes when idle) and revert to the cell center on wall block instead of parking at the edge. Ghosts untouched. Verified headless: max perpendicular offset 0.00px across 4 seeds x 60s simulated keyboard control, no idle parking, pellets eaten, tunnel wrap + turn-from-tunnel OK, full-game lifecycle unchanged.

---

## js/game.js — current state (DONE & VALIDATED 2026-11-25)
Exports: `Game` (only). `newGame(seed?)` / `begin()` / `update(dt)` / `syncHUD()` plus private helpers.

- Constants: `PELLET_EAT_RADIUS = 6`, `EATEN_RETURN_DELAY = 0.8s`, `POWER_POINTS = 50`, `PELLET_POINTS = 10`, `EATEN_GHOST_BASE = 200`.
- `newGame(seed?)` — fresh `Date.now() & 0x7fffffff` seed (fresh maze per run); `level` persists across deaths within the run; pacman + 4 ghosts constructed per-index from `GHOST_SPECS` + `GHOST_HOUSE_SPAWNS`; score=0; lives=3; combo=0; frightened=0; elapsed=0; state='menu'; highScore loaded.
- `begin()` — menu/gameover/win → fresh `newGame()` then `state='ready'`; ready → skip countdown to `playing`; playing/dying → no-op.
- `update(dt)` — rejects non-finite/<= 0 dt. ready: START_DELAY then `playing`. dying: DEATH_DELAY → lives-- → `_gameOver()` (lives <= 0) or `_respawn()` (pacman + ghosts reset, frightened=0, ready). playing: advances `elapsed` (frozen in menu/ready/dying/paused); scatter phase = `(elapsed*1000) % (2*scatterMs) < scatterMs` (alternating 4.8s segments from `SWAY.scatterMs`); pacman+ghost update (opts `{pacman, scatter}`); eaten ghosts pause 0.8s then flip to `return` (caches cleared); frightened window decrements and is mirrored onto house/exit/cruise ghosts, forced to 0 for eaten/return ghosts; pellet eating (~6px from cell center; +10 / +50 power + frightened=FRIGHT_TIME); **win checked before ghost collisions** ( pellets.size===0 → `win`, `pacman.dead=true`, high score saved); same-cell collisions — frightened: eaten (`score += 200 * 2^combo`, `combo = min(combo+1, 3)`, state='eaten', frightened=0) — lethal: `_die()` (state='dying', pacman.dead, combo=0, frightened reset) and break; otherwise nothing.
- Scatter/chase: `opts.scatter = scatterPhase` each playing frame.
- `syncHUD()` — guarded (`typeof document`), writes `#score`, `#high-score` (max of stored + current), `#lives` pips (rebuilt only on change), `#overlay` hidden while playing/dying, `#overlay-title` + `#overlay-message` (menu → "Press Space to start"; ready → "Get ready…"; gameover → "GAME OVER"; win → "YOU WIN!" + score) with `.blink`. Diff-checked (no redundant DOM writes).
- High score: `localStorage['pacink_high']` (string Int), loaded in `newGame()`, saved on gameover/win (and never below current score).
- DOM access is guarded inside `syncHUD()`/`_loadHighScore()`/`_saveHighScore()` — module imports cleanly in Node.

Deliberate deviations from the spec text (noted for completeness):
- **Lives rule**: `lives <= 0` at end of dying → gameover (3 lives → 3 deaths → gameover), not the spec's `lives < 0` (which would grant a 4th pacman for 3 displayed pips).
- **Win precedence**: win is checked right after pellet eating, before ghost collisions — the frame the last pellet is eaten declares `win` even if a ghost sits on the cell.
- **Seed policy**: every run (`begin()` from menu/gameover/win) gets a fresh random maze; the constructor's maze is discarded — matches main.js spec "fresh seed per game so each run differs".

Headless validation (2026-11-25): lifecycle menu→ready→playing (elapsed counts only playing time); forced lethal hit → dying → ready with lives 3→2 (pacman/ghosts respawned); power pellet → +50, frightened 0→6; frightened ghost eaten → +200, combo→1, eaten → return after 0.8s; pellet-clear → win (precedence even with lethal ghosts around); begin-after-win → fresh seed, lives 3; lives exhausted → gameover; 30s input-free run (all ghosts cruise, pacman caught twice, lives 1); degenerate dt (0/neg/NaN) rejected safely; **0 problems**.

---
## Spec for remaining files (all implemented as of 2026-11-25 — section kept as reference)
### `js/main.js` — rAF loop + input
- rAF loop with dt (clamp dt to avoid huge steps, e.g. 50ms); calls game.update(dt) + renderer.draw(game, ctx)
- Input: Arrow keys + WASD → `pacman.setDesiredDirection`; Space → start/new game (menu/gameover/win/ready → begin); P → pause toggle; touch swipe → direction (queue intent); click/tap on overlay → start
- `newGame()` on Space — fresh seed per game so each run differs
- Resize handling: fixed internal canvas, CSS scale — no re-layout needed
- DOM access ONLY here: `document.getElementById` for ids above; `canvas.getContext('2d')`

### `README.md`
How to run (`python -m http.server` or `npx serve .`), controls (arrows/WASD to move, Space to start, P to pause), architecture (config/maze/entities/renderer/game/main), maze-gen notes (seeded recursive backtracker, BFS validation, house geometry, tunnel row).

## Validation plan (fresh session, run before done)
1. ✅ Node dynamic-import smoke test — entities + maze import OK (2026-11-25)
2. ✅ Headless movement smoke test — seeded `createLevel(42)`; Pacman + 4 Ghosts; 600 ticks @ 1/60s: all entities in-bounds, cruise-state ghosts on ghost-walkable cells, pacman never in walls, house→exit→cruise progression for ALL 4 ghosts, tunnel wrap fires, instant reversal, blocked→idle→adopt, return-to-house (8.5s), frightened stays walkable → **0 problems** (2026-11-25)
3. ✅ Re-run maze validation — seeds [1,7,42,1337,2024,99,777,31337]: pellets 171–177, 4 power pellets each, spawn ok (2026-11-25)
4. ✅ Game lifecycle headless test — seeded `Game(42)`: menu→begin→ready→playing (elapsed counts only playing time); forced lethal hit → dying → ready with lives 3→2; power pellet → +50, frightened 0→6; frightened ghost eaten → +200, combo→1 (eaten → return after 0.8s); pellet-clear → win (precedence over collisions); begin-after-win → fresh seed, lives 3; lives exhausted → gameover; 30s input-free run (all ghosts cruise, pacman caught twice); degenerate dt (0/neg/NaN) rejected safely → **0 problems** (2026-11-25)
5. ⬜ Visual check — open `index.html` and spot-check (main.js now exists; headless DOM-stub smoke test passed 2026-11-25)
