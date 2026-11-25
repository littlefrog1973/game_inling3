// Canvas renderer. All ctx drawing lives here (+ main.js).
// No DOM access at module import time — ctx is passed in by main.js.
import { CELL, COLS, ROWS, TUNNEL_ROW, COLORS } from './config.js';

const TAU = Math.PI * 2;

// The time source is read from the game when present (frozen when paused),
// falling back to wall-clock so the renderer still works standalone.
function timeOf(game) {
  const t = game && typeof game.elapsed === 'number' && Number.isFinite(game.elapsed)
    ? game.elapsed
    : null;
  if (t !== null) return t;
  if (typeof performance !== 'undefined' && Number.isFinite(performance.now())) {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
}

function cellCenter(x, y) {
  return { px: x * CELL + CELL / 2, py: y * CELL + CELL / 2 };
}

// Path helper — rounded rect (works everywhere, no reliance on ctx.roundRect).
function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// 1. Background — full canvas fill.
function drawBackground(ctx) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
}

// 2. Walls — rounded rect per wall cell, inset 1px, bordered.
function drawWalls(ctx, level) {
  const grid = level && level.grid;
  if (!Array.isArray(grid)) return;
  for (let y = 0; y < ROWS; y++) {
    const row = grid[y];
    if (!Array.isArray(row)) continue;
    for (let x = 0; x < COLS; x++) {
      if (row[x] !== '#') continue;
      const px = x * CELL + 1;
      const py = y * CELL + 1;
      const w = CELL - 2;
      ctx.fillStyle = COLORS.wall;
      roundedRect(ctx, px, py, w, w, 5);
      ctx.fill();
      ctx.strokeStyle = COLORS.wallEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// 3. Pellets — small dots; power pellets pulse with time.
function drawPellets(ctx, level, t) {
  const pellets = level && level.pellets;
  if (!pellets || typeof pellets.forEach !== 'function') return;
  const pulse = 1 + 0.18 * Math.sin(t * 5);
  for (const key of pellets.keys()) {
    const [sx, sy] = key.split(',');
    const x = Number(sx);
    const y = Number(sy);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const { px, py } = cellCenter(x, y);
    const pellet = pellets.get(key);
    if (pellet && pellet.power) {
      const r = 6 * pulse;
      ctx.save();
      ctx.shadowColor = COLORS.power;
      ctx.shadowBlur = 10;
      ctx.fillStyle = COLORS.power;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = COLORS.pellet;
      ctx.beginPath();
      ctx.arc(px, py, 2.6, 0, TAU);
      ctx.fill();
    }
  }
}

// 4. Pacman — animated mouth rotated toward facing direction.
function drawPacman(ctx, pacman) {
  if (!pacman || pacman.dead) return;
  const px = pacman.px;
  const py = pacman.py;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;

  const dir = pacman.dir || { x: 0, y: 0 };
  const dx = Number.isFinite(dir.x) ? dir.x : 0;
  const dy = Number.isFinite(dir.y) ? dir.y : 0;
  const moving = dx !== 0 || dy !== 0;
  const angle = moving ? Math.atan2(dy, dx) : 0;

  // Mouth half-angle: closed (~0) .. fully open (~0.55π).
  const bite = typeof pacman.biteProgress === 'function' ? pacman.biteProgress() : 0.5;
  const open = Math.max(0, Math.min(1, bite));
  const half = open * 0.9; // radians; 0 = closed
  const r = 9;

  const inTunnel = pacman.isInTunnel ? pacman.isInTunnel() : pacman.cellY === TUNNEL_ROW;

  ctx.save();
  if (inTunnel) ctx.globalAlpha = 0.55; // classic tunnel fade
  ctx.shadowColor = COLORS.pacman;
  ctx.shadowBlur = 12;
  ctx.fillStyle = COLORS.pacman;

  if (half < 0.05) {
    // Closed mouth — plain circle.
    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(px, py);
    // Long way around: the body (disk) with the mouth wedge removed.
    ctx.arc(px, py, r, angle + half, angle - half + TAU, false);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// 5. Ghost — dome + wavy bottom, eyes + pupils toward dir.
//    Frightened: blue body + scared white face (blinking in the final second).
function drawGhost(ctx, ghost, t) {
  if (!ghost || ghost.state === 'eaten') return;
  const px = ghost.px;
  const py = ghost.py;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;

  const r = 10;
  const bottom = py + r * 0.85;

  const frightened = ghost.frightened > 0;

  // Blink phase in the last second before frightened expires.
  const blink = frightened && ghost.frightened < 1.4;
  const blinkOn = blink ? Math.floor(t * 6) % 2 === 0 : false;

  let bodyColor = ghost.color || '#ff4a4a';
  let faceColor = '#ffffff';
  if (frightened && blink) {
    bodyColor = blinkOn ? '#43a5ff' : '#f0f6ff';
    faceColor = blinkOn ? '#ffffff' : '#1c2f6e';
  } else if (frightened) {
    bodyColor = '#43a5ff';
    faceColor = '#ffffff';
  }

  // Wavy bottom edge — animated with time so ghosts wiggle.
  const wavePhase = t * 9;
  const waves = 3;
  const waveW = (2 * r) / waves;

  ctx.save();
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(px - r, bottom);
  ctx.lineTo(px - r, py);
  ctx.arc(px, py, r, Math.PI, 0, false); // dome: left → top → right
  ctx.lineTo(px + r, bottom);
  for (let i = 0; i < waves; i++) {
    const x1 = px + r - i * waveW;
    const x0 = px + r - (i + 1) * waveW;
    const midX = (x1 + x0) / 2;
    const dip = 3 + 1.6 * Math.sin(wavePhase + i * 2.1);
    ctx.quadraticCurveTo(midX, bottom + dip, x0, bottom);
  }
  ctx.closePath();
  ctx.fill();

  // Eyes + pupils.
  const dir = ghost.dir || { x: 0, y: 0 };
  const ddx = Number.isFinite(dir.x) ? dir.x : 0;
  const ddy = Number.isFinite(dir.y) ? dir.y : 0;
  const eyeSpacing = 3.6;
  const eyeY = py - r * 0.22;
  const pupilOffset = { x: ddx * 1.5, y: ddy * 1.5 };

  if (frightened) {
    // Scared face: two round eyes + zigzag mouth, no pupils.
    ctx.fillStyle = faceColor;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(px + side * eyeSpacing, eyeY, 2.5, 0, TAU);
      ctx.fill();
    }
    // Mouth zigzag.
    ctx.strokeStyle = faceColor;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const mx = px - 5;
    const my = py + r * 0.42;
    const segs = 4;
    const segW = (10 / segs);
    ctx.moveTo(mx, my);
    for (let i = 0; i < segs; i++) {
      const nx = mx + (i + 1) * segW;
      const ny = my + (i % 2 === 0 ? -2.4 : 2.4);
      ctx.lineTo(nx, ny);
    }
    ctx.stroke();
  } else {
    // Classic eyes: white sclera + blue pupil shifted toward dir.
    for (const side of [-1, 1]) {
      const ex = px + side * eyeSpacing;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex, eyeY, 3.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#2b3a8f';
      ctx.beginPath();
      ctx.arc(ex + pupilOffset.x, eyeY + pupilOffset.y, 1.8, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Main entry — draw the full frame. Game is optional/defensive.
export function draw(game, ctx) {
  if (!ctx) return;
  const t = timeOf(game);
  const level = game && game.level;

  drawBackground(ctx);
  drawWalls(ctx, level);
  drawPellets(ctx, level, t);
  drawPacman(ctx, game && game.pacman);

  if (game && Array.isArray(game.ghosts)) {
    for (const ghost of game.ghosts) drawGhost(ctx, ghost, t);
  }
}
