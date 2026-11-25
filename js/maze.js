// Procedural maze generation + pellet placement + BFS validation.
// Grid: ROWS x COLS, row 0 = top. Cells: '#' wall, '.' corridor.
import { COLS, ROWS, TUNNEL_ROW } from './config.js';

// Deterministic PRNG so a given seed always yields the same maze.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inBounds(x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

// Ghost-house footprint: cols 7..11, rows 9..14. Maze carving must avoid this.
function forbidden(x, y) {
  return x >= 7 && x <= 11 && y >= 9 && y <= 14;
}

function isHouseCell(x, y) {
  // Interior + door + passage — not walkable for pacman.
  if (x >= 8 && x <= 10 && y >= 10 && y <= 12) return true; // interior
  return (x === 9 && (y === 13 || y === 14)); // door + passage
}

export { isHouseCell };

// Randomized recursive-backtracker maze over odd-cell corridors.
function carveMaze(grid, rand) {
  const stack = [{ x: 1, y: 1 }];
  grid[1][1] = '.';
  while (stack.length) {
    const { x, y } = stack[stack.length - 1];
    const candidates = [];
    const dirs = [
      [0, -2],
      [0, 2],
      [-2, 0],
      [2, 0],
    ];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      const px = x + dx / 2;
      const py = y + dy / 2;
      if (nx > 0 && nx < COLS - 1 && ny > 0 && ny < ROWS - 1 && grid[ny][nx] === '#') {
        if (forbidden(nx, ny) || forbidden(px, py)) continue;
        candidates.push({ nx, ny, dx, dy });
      }
    }
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const pick = candidates[Math.floor(rand() * candidates.length)];
    grid[y + pick.dy / 2][x + pick.dx / 2] = '.';
    grid[pick.ny][pick.nx] = '.';
    stack.push({ x: pick.nx, y: pick.ny });
  }
}

// Ghost house: walls around cols 7..11 rows 9..13, interior (8..10, 10..12),
// door at (9,13), passage at (9,14).
function placeGhostHouse(grid) {
  for (let y = 9; y <= 13; y++) {
    for (let x = 7; x <= 11; x++) {
      grid[y][x] = '#';
    }
  }
  for (let y = 10; y <= 12; y++) {
    for (let x = 8; x <= 10; x++) {
      grid[y][x] = '.';
    }
  }
  grid[13][9] = '.'; // door
  grid[14][9] = '.'; // passage below the door
}

export function createLevel(seed = 1) {
  const rand = mulberry32(seed);
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill('#'));

  carveMaze(grid, rand);
  placeGhostHouse(grid);

  // Tunnel row: straight open corridor so pacman/ghosts can wrap horizontally.
  for (let x = 0; x < COLS; x++) {
    grid[TUNNEL_ROW][x] = '.';
  }

  // Spawn point: a guaranteed-carved corridor cell below the house.
  const spawn = { x: 9, y: 19 };
  if (grid[spawn.y][spawn.x] !== '.') {
    // Safety net — shouldn't happen, but never spawn inside a wall.
    grid[spawn.y][spawn.x] = '.';
  }

  const isPacmanWalkable = (x, y) =>
    inBounds(x, y) && grid[y][x] === '.' && !isHouseCell(x, y);

  // BFS from spawn across pacman-walkable cells; every such cell must be reachable.
  const visited = new Set();
  const queue = [spawn];
  visited.add(`${spawn.x},${spawn.y}`);
  while (queue.length) {
    const { x, y } = queue.shift();
    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    // Tunnel wrap (left edge <-> right edge)
    if (y === TUNNEL_ROW) {
      if (x === 0) neighbors.push([COLS - 1, y]);
      if (x === COLS - 1) neighbors.push([0, y]);
    }
    for (const [nx, ny] of neighbors) {
      if (!inBounds(nx, ny)) continue;
      if (!isPacmanWalkable(nx, ny)) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  // Any open cell the pacman can't reach (stray pieces) becomes a wall.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid[y][x] === '.' && !isHouseCell(x, y) && !visited.has(`${x},${y}`)) {
        grid[y][x] = '#';
      }
    }
  }

  // Pellets on every reachable pacman-walkable cell, with corners as power pellets.
  const cornerCells = [
    { x: 1, y: 1 },
    { x: COLS - 2, y: 1 },
    { x: 1, y: ROWS - 2 },
    { x: COLS - 2, y: ROWS - 2 },
  ];
  const cornerKeys = new Set(cornerCells.map((c) => `${c.x},${c.y}`));

  const pellets = new Map();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!isPacmanWalkable(x, y)) continue;
      if (y === TUNNEL_ROW) continue; // tunnel cells carry no pellets
      if (y === spawn.y && x === spawn.x) continue; // keep the spawn cell clear
      const key = `${x},${y}`;
      if (cornerKeys.has(key)) {
        if (visited.has(key)) pellets.set(key, { power: true });
        continue;
      }
      pellets.set(key, { power: false });
    }
  }

  const powerCount = [...pellets.values()].filter((p) => p.power).length;

  return {
    cols: COLS,
    rows: ROWS,
    grid,
    tunnelRow: TUNNEL_ROW,
    spawn,
    pellets,
    pelletCount: pellets.size,
    powerCount,
    isPacmanWalkable: (x, y) =>
      inBounds(x, y) && grid[y][x] === '.' && !isHouseCell(x, y),
    isGhostWalkable: (x, y) => inBounds(x, y) && grid[y][x] === '.',
  };
}
