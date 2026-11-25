// Pacman + Ghost entities: continuous pixel movement, per-cell-center targeting,
// tunnel wrap, maze-aware roaming AI. No DOM access here.
import {
  CELL,
  COLS,
  ROWS,
  TUNNEL_ROW,
  PACMAN_SPEED,
  TUNNEL_SPEED,
  GHOST_SPEED,
  FRIGHT_SPEED,
  GHOST_HOME_SPEED,
} from './config.js';

export const GRID_W = COLS * CELL;
export const GRID_H = ROWS * CELL;
export const GHOST_HOUSE_SPAWNS = [
  { x: 8, y: 11 },
  { x: 9, y: 11 },
  { x: 10, y: 11 },
  { x: 9, y: 10 },
];

export function cellCenter(x, y) {
  return { px: x * CELL + CELL / 2, py: y * CELL + CELL / 2 };
}

function cellKey(x, y) {
  return `${x},${y}`;
}

// Move along the given axis (dx, dy) and never enter a wall cell.
// Tunnel rows wrap horizontally. Returns { px, py, cx, cy, blocked }.
//   blocked=true  → the cell beyond is not walkable and the entity got clamped.
function moveWithWalls(px, py, dx, dy, step, isWalkable, tunnelWrap) {
  const horiz = dx !== 0;
  // Tunnel row + horizontal move → wrap off either edge, no clamping.
  // The tunnel row is entirely open; no wall check needed on the horizontal axis.
  if (tunnelWrap && horiz) {
    let nx = px + dx * step;
    if (nx < -CELL / 2) nx = GRID_W + CELL / 2;
    if (nx > GRID_W + CELL / 2) nx = -CELL / 2;
    const ny = py; // no vertical drift
    let cx = 0;
    if (nx < 0) cx = 0; // just past the left edge → nearest in-bounds cell
    else if (nx >= GRID_W) cx = COLS - 1; // just past the right edge → nearest in-bounds cell
    else cx = Math.floor(nx / CELL);
    return { px: nx, py: ny, cx, cy: Math.floor(ny / CELL), blocked: false };
  }

  let nx = px + dx * step;
  let ny = py + dy * step;

  // Target cell.
  let cx = Math.floor(nx / CELL);
  let cy = Math.floor(ny / CELL);

  if (!isWalkable(cx, cy)) {
    // Clamp to the edge of the current cell along the movement axis.
    const cellX = Math.floor(px / CELL);
    const cellY = Math.floor(py / CELL);
    if (dx > 0) nx = (cellX + 1) * CELL - 0.001;
    else if (dx < 0) nx = cellX * CELL + 0.001;
    else if (dy > 0) ny = (cellY + 1) * CELL - 0.001;
    else if (dy < 0) ny = cellY * CELL + 0.001;
    // After clamping, re-derive the cell (must be walkable).
    cx = Math.floor(nx / CELL);
    cy = Math.floor(ny / CELL);
    if (!isWalkable(cx, cy)) {
      // Safety: revert fully.
      nx = px;
      ny = py;
      cx = Math.floor(nx / CELL);
      cy = Math.floor(ny / CELL);
      return { px: nx, py: ny, cx, cy, blocked: true };
    }
    return { px: nx, py: ny, cx, cy, blocked: true };
  }
  return { px: nx, py: ny, cx, cy, blocked: false };
}

export function isTunnelRow(y) {
  return y === TUNNEL_ROW;
}

// Ghost personality targets: scatter corners.
export const GHOST_SPECS = [
  { personality: 'chase', color: '#ff4a4a', scatter: { x: 17, y: 21 } },
  { personality: 'ambush', color: '#ff8ad4', scatter: { x: 1, y: 1 } },
  { personality: 'ambushLead', color: '#43e7e8', scatter: { x: 17, y: 1 } },
  { personality: 'chase', color: '#39e75f', scatter: { x: 1, y: 21 } },
];

// ---------------------------------------------------------------------------
// Pacman
// ---------------------------------------------------------------------------
export class Pacman {
  constructor() {
    this.reset(null);
  }

  reset(level) {
    const spawn = level ? level.spawn : { x: Math.floor(COLS / 2), y: 19 };
    const { px, py } = cellCenter(spawn.x, spawn.y);
    this.px = px;
    this.py = py;
    this.cellX = spawn.x;
    this.cellY = spawn.y;
    this.dir = { x: 0, y: 0 };
    this.queue = []; // queued intents (max 3), newest last
    this.mouthTimer = 0;
    this.dead = false;
  }

  setDesiredDirection(dx, dy) {
    if (dx === 0 && dy === 0) return;
    const cur = this.dir;
    // Instant reversal from a moving state.
    if (cur.x !== 0 || cur.y !== 0) {
      if (dx === -cur.x && dy === -cur.y) {
        this.dir = { x: dx, y: dy };
        this.queue.length = 0;
        return;
      }
    }
    // Same as last queued — skip.
    const last = this.queue[this.queue.length - 1];
    if (last && last.x === dx && last.y === dy) {
      // Even if it queued already and the queue has stale entries, just keep it.
      return;
    }
    // Drop the opposite of the current dir from the queue (it would reverse later).
    if (cur.x !== 0 || cur.y !== 0) {
      this.queue = this.queue.filter(
        (d) => !(d.x === -cur.x && d.y === -cur.y)
      );
    }
    this.queue.push({ x: dx, y: dy });
    if (this.queue.length > 3) this.queue.shift();
  }

  snapToCellCenter() {
    const center = cellCenter(this.cellX, this.cellY);
    this.px = center.px;
    this.py = center.py;
  }

  update(dt, level, opts = {}) {
    if (this.dead) return;
    const inTunnel = this.cellY === TUNNEL_ROW;
    const speed = inTunnel ? TUNNEL_SPEED : PACMAN_SPEED;
    const step = speed * dt;

    const center = cellCenter(this.cellX, this.cellY);
    const distToCenter = Math.hypot(this.px - center.px, this.py - center.py);

    // Adopt queued directions once near a cell center (or idle).
    if (distToCenter <= 6 || (this.dir.x === 0 && this.dir.y === 0)) {
      while (this.queue.length) {
        const want = this.queue[0];
        const same = want.x === this.dir.x && want.y === this.dir.y;
        const idle = this.dir.x === 0 && this.dir.y === 0;
        // Destination cell (tunnel-wrap aware).
        let nextX = this.cellX + want.x;
        const nextY = this.cellY + want.y;
        if (nextY === TUNNEL_ROW) {
          if (nextX < 0) nextX = COLS - 1;
          if (nextX >= COLS) nextX = 0;
        }
        const canGo =
          (!level || (nextY >= 0 && nextY < ROWS && level.isPacmanWalkable(nextX, nextY)));
        if (same || idle || canGo) {
          this.dir = { x: want.x, y: want.y };
          this.queue.shift();
          continue;
        }
        // Blocked destination — intent is dead, drop it.
        this.queue.shift();
      }
    }

    // Keep pacman centered in its lane — snap the axis PERPENDICULAR to the
    // current direction to the current cell's center. The corridor is one cell
    // wide, so this guarantees the player never straddles two lanes and can
    // always sit within reach of the pellet at the cell center. Without this,
    // a mid-cell turn (or a parked wall-edge position) offsets pacman by up to
    // 12px, letting it visually straddle the adjacent lane and miss pellets.
    const centerLine = cellCenter(this.cellX, this.cellY);
    if (this.dir.x !== 0) {
      this.py = centerLine.py;
    } else if (this.dir.y !== 0) {
      this.px = centerLine.px;
    } else {
      // Idle — be exactly centered too.
      this.px = centerLine.px;
      this.py = centerLine.py;
    }

    if (this.dir.x === 0 && this.dir.y === 0) {
      this.mouthTimer += dt;
      return;
    }

    const isWalkable = (cx, cy) =>
      level ? level.isPacmanWalkable(cx, cy) : true;

    const { px, py, cx, cy, blocked } = moveWithWalls(
      this.px, this.py, this.dir.x, this.dir.y, step, isWalkable, inTunnel
    );

    if (blocked) {
      // Hit a wall — snap straight back to the center of the current cell
      // instead of parking flush at the wall edge (which leaves pacman 12px
      // off-center, straddling the adjacent lane and missing pellets).
      // cellX/cellY stay on the current cell, which is still correct.
      this.px = centerLine.px;
      this.py = centerLine.py;
      // Go idle so fresh intents can be adopted on the next frame.
      this.dir = { x: 0, y: 0 };
      this.mouthTimer += dt;
      return;
    }

    this.px = px;
    this.py = py;
    this.cellX = cx;
    this.cellY = cy;

    this.mouthTimer += dt;
  }

  isInTunnel() {
    return this.cellY === TUNNEL_ROW;
  }

  biteProgress() {
    // 0..1, animated mouth (0 = closed, 1 = open)
    const t = (this.mouthTimer % 0.3) / 0.3;
    return Math.abs(Math.sin(t * Math.PI));
  }
}

// Ghost
// ---------------------------------------------------------------------------
export class Ghost {
  constructor(spec, spawnPos) {
    this.personality = spec.personality;
    this.color = spec.color;
    this.scatterTarget = spec.scatter;
    this.spawnPos = spawnPos;
    this.px = 0;
    this.py = 0;
    this.cellX = 0;
    this.cellY = 0;
    this.dir = { x: 0, y: 0 };
    this.state = 'house';
    this.frightened = 0;
    this.releaseTimer = 0;
    this.releaseDelay = 1.5;
    this.eatenPause = 0; // seconds of "paused after being eaten", owned by game.js
    this._lastPickCell = null; // cell whose center we last picked a direction for
    this._bfsCache = null;
    this._bfsCacheKey = null;
  }

  reset(level, houseSpawnPos) {
    const pos = houseSpawnPos ?? this.spawnPos;
    const { px, py } = cellCenter(pos.x, pos.y);
    this.px = px;
    this.py = py;
    this.cellX = pos.x;
    this.cellY = pos.y;
    this.dir = { x: 0, y: 0 };
    this.state = 'house';
    this.frightened = 0;
    this.releaseTimer = 0;
    this.releaseDelay = this._releaseDelayFor();
    this.eatenPause = 0;
    this._lastPickCell = null;
    this._bfsCache = null;
    this._bfsCacheKey = null;
  }

  // Staggered initial releases: red (0.9s), pink (2.6s), blue (4.2s), green (5.6s).
  // The two chase ghosts (red & green) are disambiguated by color.
  _releaseDelayFor() {
    const delays = [0.9, 2.6, 4.2, 5.6];
    const idx = GHOST_SPECS.findIndex(
      (s) => s.personality === this.personality && s.color === this.color
    );
    return delays[idx] ?? 2.5;
  }

  // BFS distance map from a target cell over ghost-walkable cells (tunnel wrap).
  _bfs(level, target) {
    const key = cellKey(target.x, target.y);
    if (this._bfsCacheKey === key && this._bfsCache) return this._bfsCache;
    const dist = new Map();
    const q = [{ x: target.x, y: target.y, d: 0 }];
    dist.set(key, 0);
    while (q.length) {
      const { x, y, d } = q.shift();
      const neighbors = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      if (y === TUNNEL_ROW) {
        if (x === 0) neighbors.push([COLS - 1, y]);
        if (x === COLS - 1) neighbors.push([0, y]);
      }
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        if (!level.isGhostWalkable(nx, ny)) continue;
        const nk = cellKey(nx, ny);
        if (dist.has(nk)) continue;
        dist.set(nk, d + 1);
        q.push({ x: nx, y: ny, d: d + 1 });
      }
    }
    this._bfsCache = dist;
    this._bfsCacheKey = key;
    return dist;
  }

  resolveTarget(pacman, opts) {
    const isScatter = opts.scatter;
    if (isScatter) return { x: this.scatterTarget.x, y: this.scatterTarget.y };
    if (!pacman) return { x: this.scatterTarget.x, y: this.scatterTarget.y };

    if (this.personality === 'ambush') {
      // Target 2 cells ahead of pacman.
      return {
        x: pacman.cellX + pacman.dir.x * 2,
        y: pacman.cellY + pacman.dir.y * 2,
      };
    }
    if (this.personality === 'ambushLead') {
      // Target 4 cells ahead (classic blue ghost behavior).
      let tx = pacman.cellX + pacman.dir.x * 4;
      let ty = pacman.cellY + pacman.dir.y * 4;
      if (pacman.dir.y !== 0) {
        // Vertical lead — target pacman's x, classic 4-cells-ahead vertical.
        tx = pacman.cellX;
      }
      // Clamp to bounds.
      tx = Math.max(0, Math.min(COLS - 1, tx));
      ty = Math.max(0, Math.min(ROWS - 1, ty));
      return { x: tx, y: ty };
    }
    // Chase (default): target pacman's cell.
    return { x: pacman.cellX, y: pacman.cellY };
  }

  // Roaming direction at the current cell — choose the walkable neighbor that
  // decreases the BFS distance to the target (no reverse when roaming).
  chooseRoamDirection(level, target, frightened) {
    const dist = this._bfs(level, target);

    const candidates = [];
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    for (const dir of dirs) {
      let nx = this.cellX + dir.x;
      const ny = this.cellY + dir.y;
      if (ny === TUNNEL_ROW) {
        if (nx < 0) nx = COLS - 1;
        if (nx >= COLS) nx = 0;
      }
      if (ny < 0 || ny >= ROWS) continue;
      if (!level.isGhostWalkable(nx, ny)) continue;
      // No reverse while roaming (frightened ghosts may reverse).
      const reverse = this.dir.x === -dir.x && this.dir.y === -dir.y && (this.dir.x !== 0 || this.dir.y !== 0);
      if (!frightened && reverse) continue;
      const d2 = dist.get(cellKey(nx, ny));
      if (d2 === undefined) continue;
      candidates.push({ dir, d2 });
    }
    if (!candidates.length) {
      // Dead end (or only-reverse) — fall back to the reversal. A ghost must
      // never stall against a wall.
      const rev = { x: -this.dir.x, y: -this.dir.y };
      if (rev.x !== 0 || rev.y !== 0) {
        let nx = this.cellX + rev.x;
        const ny = this.cellY + rev.y;
        if (ny === TUNNEL_ROW) {
          if (nx < 0) nx = COLS - 1;
          if (nx >= COLS) nx = 0;
        }
        if (ny >= 0 && ny < ROWS && level.isGhostWalkable(nx, ny)) {
          return { ...rev };
        }
      }
      return null;
    }

    if (frightened) {
      // Uniform random pick — the plain frightened behavior.
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return { x: pick.dir.x, y: pick.dir.y };
    }
    let best = null;
    let bestD = Infinity;
    for (const c of candidates) {
      if (c.d2 < bestD) {
        bestD = c.d2;
        best = c.dir;
      }
    }
    return { x: best.x, y: best.y };
  }

  update(dt, level, opts = {}) {
    if (this.state === 'eaten') {
      // Eaten ghosts are hidden; the game flips them to 'return' shortly after.
      return;
    }

    if (this.state === 'house') {
      this.releaseTimer += dt;
      if (this.releaseTimer >= this.releaseDelay) {
        this.state = 'exit';
      }
      return;
    }

    if (this.state === 'exit') {
      // Axis-separated steps (no diagonal √2 speed): straighten onto the door
      // column (9), then walk down into the passage (9,14).
      const step = GHOST_HOME_SPEED * dt;
      const doorX = 9 * CELL + CELL / 2;
      if (Math.abs(this.px - doorX) > 2) {
        this.px += Math.sign(doorX - this.px) * step;
      } else {
        this.py += step;
      }
      this.cellX = Math.floor(this.px / CELL);
      this.cellY = Math.floor(this.py / CELL);
      if (this.cellY >= 14) {
        // Reached the passage — snap to it and resume roaming.
        const passage = cellCenter(9, 14);
        this.px = passage.px;
        this.py = passage.py;
        this.cellX = 9;
        this.cellY = 14;
        this.dir = { x: 0, y: 1 };
        this._lastPickCell = null;
        this.state = 'cruise';
        this._bfsCache = null;
        this._bfsCacheKey = null;
      }
      return;
    }

    // 'return' state: BFS back to the house interior (9,11).
    if (this.state === 'return') {
      const center = cellCenter(this.cellX, this.cellY);
      const distToCenter = Math.hypot(this.px - center.px, this.py - center.py);
      const key = cellKey(this.cellX, this.cellY);
      if (distToCenter <= 6 && this._lastPickCell !== key) {
        this._lastPickCell = key;
        const dir = this.chooseRoamDirection(level, { x: 9, y: 11 }, false);
        if (dir) this.dir = dir;
      }
      const tunnelWrap = this.cellY === TUNNEL_ROW;
      const isWalkable = (cx, cy) => (level ? level.isGhostWalkable(cx, cy) : true);
      const { px, py, cx, cy } = moveWithWalls(
        this.px, this.py, this.dir.x, this.dir.y, GHOST_HOME_SPEED * dt, isWalkable, tunnelWrap
      );
      this.px = px;
      this.py = py;
      this.cellX = cx;
      this.cellY = cy;
      if (this.isInsideHouse()) {
        this.state = 'house';
        this.releaseTimer = 0;
        this.releaseDelay = 1.0; // short re-release after being eaten
        this.eatenPause = 0;
        this.dir = { x: 0, y: 0 };
        this._lastPickCell = null;
        this._bfsCache = null;
        this._bfsCacheKey = null;
      }
      return;
    }

    // 'cruise' state (default)
    if (this.frightened > 0) {
      this.frightened -= dt;
      if (this.frightened < 0) this.frightened = 0;
    }

    const target = this.resolveTarget(opts.pacman, opts);

    const center = cellCenter(this.cellX, this.cellY);
    const distToCenter = Math.hypot(this.px - center.px, this.py - center.py);
    const key = cellKey(this.cellX, this.cellY);
    // At a junction, re-pick direction once per cell — deterministic when
    // roaming, single random pick when frightened (no per-frame jitter).
    if (distToCenter <= 6 && this._lastPickCell !== key) {
      this._lastPickCell = key;
      const dir = this.chooseRoamDirection(level, target, this.frightened > 0);
      if (dir) this.dir = dir;
    }

    const speed = this.frightened > 0 ? FRIGHT_SPEED : GHOST_SPEED;
    const tunnelWrap = this.cellY === TUNNEL_ROW;
    const isWalkable = (cx, cy) => (level ? level.isGhostWalkable(cx, cy) : true);
    const { px, py, cx, cy } = moveWithWalls(
      this.px, this.py, this.dir.x, this.dir.y, speed * dt, isWalkable, tunnelWrap
    );
    this.px = px;
    this.py = py;
    this.cellX = cx;
    this.cellY = cy;
  }

  isInsideHouse() {
    // Ghost should be inside the house when back to the interior (rows 10..12, cols 8..10).
    return this.cellY >= 10 && this.cellY <= 12 && this.cellX >= 8 && this.cellX <= 10;
  }
}
