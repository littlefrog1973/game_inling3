// Browser entry point — rAF loop + input. Owns ALL DOM access
// (document.getElementById, canvas.getContext('2d'), listeners).
// Game logic lives in game.js; rendering lives in renderer.js.
import { Game } from './game.js';
import { draw } from './renderer.js';

const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('overlay');
const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;

if (canvas && ctx) {
  boot(canvas, overlay, ctx);
}

function boot(canvas, overlay, ctx) {
  const game = new Game();
  let paused = false;
  let last = null;

  // ------------------------------------------------------------------
  // Keyboard — arrows/WASD queue a direction, Space starts/restarts, P pauses.
  // ------------------------------------------------------------------
  const DIRS = {
    ArrowUp: [0, -1], KeyW: [0, -1],
    ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0],
    ArrowRight: [1, 0], KeyD: [1, 0],
  };

  // Held-direction stack (most recent last) driving hold-to-move: pacman
  // moves while ANY direction key is held, and stops the instant the last
  // one is released.
  const heldDirs = [];

  function mostRecentHeldDir() {
    for (let i = heldDirs.length - 1; i >= 0; i--) {
      if (DIRS[heldDirs[i]]) return DIRS[heldDirs[i]];
    }
    return null;
  }

  // Ensure the most recently held direction is queued. Cheap no-op when the
  // intent is already being followed (guard before queueing).
  function reapplyHeldDirection(clearQueue = false) {
    const dir = mostRecentHeldDir();
    if (!dir) return;
    const p = game.pacman;
    if (!p || p.dead) return;
    if (clearQueue) p.queue.length = 0;
    const same = p.dir.x === dir[0] && p.dir.y === dir[1];
    const queued = p.queue.some((d) => d.x === dir[0] && d.y === dir[1]);
    if (same || queued) return;
    p.setDesiredDirection(dir[0], dir[1]);
  }

  // Drop every held direction and halt pacman immediately.
  function stopPacman() {
    heldDirs.length = 0;
    if (game.pacman) game.pacman.stop();
  }

  window.addEventListener('keydown', (e) => {
    const dir = DIRS[e.code];
    if (dir) {
      e.preventDefault();
      if (e.repeat) return; // already held — keyup handles release
      if (!heldDirs.includes(e.code)) heldDirs.push(e.code);
      game.pacman.setDesiredDirection(dir[0], dir[1]);
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) {
        game.begin();
        reapplyHeldDirection(); // begin() may reset pacman — queue was wiped
      }
      return;
    }
    if (e.code === 'KeyP') {
      e.preventDefault();
      if (!e.repeat) togglePause();
    }
  });

  window.addEventListener('keyup', (e) => {
    const dir = DIRS[e.code];
    if (!dir) return;
    const idx = heldDirs.indexOf(e.code);
    if (idx !== -1) heldDirs.splice(idx, 1);
    if (heldDirs.length === 0) {
      stopPacman(); // last direction key released — halt at once
      return;
    }
    // A key was released but another is still held: drop the released
    // intent and fall back to the most recently held direction.
    reapplyHeldDirection(true);
  });

  // Losing focus can leave a key "held" forever — stop pacman conservatively.
  window.addEventListener('blur', () => stopPacman());

  function togglePause() {
    // Pausing is only meaningful while a run is in flight.
    if (game.state === 'menu' || game.state === 'gameover' || game.state === 'win') return;
    paused = !paused;
    last = null; // re-sync the frame clock so resume doesn't see a stale big dt
  }

  // ------------------------------------------------------------------
  // Touch — swipe on the canvas queues a direction. preventDefault keeps
  // the page from scrolling/zooming while swiping.
  // ------------------------------------------------------------------
  let touchStart = null;
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches && e.changedTouches[0];
    if (t) touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    const start = touchStart;
    touchStart = null;
    if (!start) return;
    e.preventDefault();
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (Math.max(adx, ady) < 24) return; // below the swipe threshold — ignore
    if (adx > ady) game.pacman.setDesiredDirection(dx > 0 ? 1 : -1, 0);
    else game.pacman.setDesiredDirection(0, dy > 0 ? 1 : -1);
  });

  // Click/tap on the overlay → start (the overlay hides with
  // pointer-events:none during play, so this only fires pre-start).
  if (overlay) {
    overlay.addEventListener('click', () => game.begin());
  }

  // ------------------------------------------------------------------
  // Render pause badge — drawn over the scene so no DOM is touched.
  // ------------------------------------------------------------------
  function drawPaused() {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.save();
    ctx.fillStyle = 'rgba(5,5,16,0.62)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd23f';
    ctx.font = '900 30px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText('PAUSED', w / 2, h / 2 - 6);
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = '#e8e8ff';
    ctx.fillText('Press P to resume', w / 2, h / 2 + 24);
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // rAF loop — dt is clamped so a background-tab jump can't teleport entities.
  // game.update is skipped while paused; rendering continues.
  // ------------------------------------------------------------------
  function frame(ts) {
    if (last === null) last = ts;
    const dt = Math.min((ts - last) / 1000, 0.05);
    last = ts;
    if (!paused && dt > 0) game.update(dt);
    reapplyHeldDirection(); // keep the held intent alive across resets (Space/death)
    draw(game, ctx);
    if (paused) drawPaused();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
