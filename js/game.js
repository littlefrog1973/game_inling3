// Game orchestrator — owns the level, entities, score/lives/combo, state
// machine and HUD sync. DOM access is guarded (syncHUD) so this module stays
// importable in Node for headless tests.
import { createLevel } from './maze.js';
import {
  CELL,
  FRIGHT_TIME,
  START_DELAY,
  DEATH_DELAY,
  SWAY,
} from './config.js';
import {
  GHOST_HOUSE_SPAWNS,
  GHOST_SPECS,
  Pacman,
  Ghost,
} from './entities.js';

// Pacman eats a pellet when within this many px of the pellet's cell center.
const PELLET_EAT_RADIUS = 6;
// Seconds a frightened ghost pauses after being eaten before re-entering the house.
const EATEN_RETURN_DELAY = 0.8;
// Corner power pellets worth 50 pts; normal pellets 10; first frightened
// ghost 200, doubling per combo step (200/400/800/1600).
const POWER_POINTS = 50;
const PELLET_POINTS = 10;
const EATEN_GHOST_BASE = 200;

function cellCenter(x, y) {
  return { px: x * CELL + CELL / 2, py: y * CELL + CELL / 2 };
}

export class Game {
  constructor(seed) {
    this.newGame(seed);
  }

  // (Re)create the whole game from a fresh seed. The seed defaults to a fresh
  // random value so every run roams a different maze. The level persists
  // across deaths within a run (a plain constructor arg, not per-death).
  newGame(seed) {
    this.seed = seed ?? (Date.now() & 0x7fffffff);
    this.level = createLevel(this.seed);

    this.pacman = new Pacman();
    this.pacman.reset(this.level);

    this.ghosts = GHOST_SPECS.map((spec, i) => new Ghost(spec, GHOST_HOUSE_SPAWNS[i]));
    this.ghosts.forEach((ghost, i) => ghost.reset(this.level, GHOST_HOUSE_SPAWNS[i]));

    this.score = 0;
    this.lives = 3;
    this.combo = 0; // frightened-ghost combo step, reset on death
    this.frightened = 0; // authoritative frightened window, mirrored onto ghosts
    this.elapsed = 0; // seconds of PLAYING time (frozen in menu/ready/dying/pause)
    this.readyTimer = 0;
    this.dyingTimer = 0;
    this.state = 'menu'; // menu | ready | playing | dying | gameover | win
    this.highScore = this._loadHighScore();

    this._pipsDrawn = -1;
    this.syncHUD();
  }

  // Begin a run (Space). Fresh run in menu/gameover/win; skip the ready
  // countdown while already ready; ignore input while playing/dying.
  begin() {
    if (this.state === 'menu' || this.state === 'gameover' || this.state === 'win') {
      this.newGame(); // fresh maze + entities each run
      this.state = 'ready';
      this.readyTimer = 0;
    } else if (this.state === 'ready') {
      this.state = 'playing';
    }
    this.syncHUD();
  }

  // ------------------------------------------------------------------
  // Per-frame update. Pause is handled by the caller skipping update().
  // ------------------------------------------------------------------
  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;

    if (this.state === 'ready') {
      this.readyTimer += dt;
      if (this.readyTimer >= START_DELAY) this.state = 'playing';
      this.syncHUD();
      return;
    }

    if (this.state === 'dying') {
      this.dyingTimer += dt;
      if (this.dyingTimer >= DEATH_DELAY) {
        this.lives--;
        if (this.lives <= 0) {
          this._gameOver();
        } else {
          this._respawn();
        }
      }
      this.syncHUD();
      return;
    }

    if (this.state !== 'playing') {
      this.syncHUD();
      return;
    }

    this.elapsed += dt;

    // Scatter/chase phase from playing time (alternating 4.8s segments).
    const scatterMs = SWAY.scatterMs;
    const scatterPhase = (this.elapsed * 1000) % (2 * scatterMs) < scatterMs;

    // Movement.
    this.pacman.update(dt, this.level);
    for (const ghost of this.ghosts) {
      ghost.update(dt, this.level, { pacman: this.pacman, scatter: scatterPhase });
    }

    // Eaten ghosts pause briefly, then re-enter the house.
    for (const ghost of this.ghosts) {
      if (ghost.state !== 'eaten') continue;
      ghost.eatenPause += dt;
      if (ghost.eatenPause >= EATEN_RETURN_DELAY) {
        ghost.state = 'return';
        ghost.eatenPause = 0;
        ghost._lastPickCell = null;
        ghost._bfsCache = null;
        ghost._bfsCacheKey = null;
      }
    }

    // Frightened window (shared); mirror onto every non-eaten ghost except
    // returning ones — eaten-ghosts go home unafraid.
    if (this.frightened > 0) {
      this.frightened = Math.max(0, this.frightened - dt);
    }
    for (const ghost of this.ghosts) {
      if (ghost.state === 'eaten' || ghost.state === 'return') {
        ghost.frightened = 0;
      } else {
        ghost.frightened = this.frightened;
      }
    }

    // Pellet eating.
    this._eatPellets();

    // Win check — taking precedence means the frame the last pellet is
    // eaten the run is complete (even if a ghost happens to be on the cell).
    if (this.level.pellets.size === 0 && this.state === 'playing') {
      this.state = 'win';
      this.pacman.dead = true;
      this.frightened = 0;
      this._saveHighScore();
      this.syncHUD();
      return;
    }

    // Ghost collisions.
    if (!this.pacman.dead && this.state === 'playing') {
      for (const ghost of this.ghosts) {
        if (ghost.state === 'eaten') continue;
        if (ghost.state === 'house' || ghost.state === 'exit') continue; // pacman cannot reach
        if (ghost.cellX === this.pacman.cellX && ghost.cellY === this.pacman.cellY) {
          if (ghost.frightened > 0) {
            this.score += EATEN_GHOST_BASE * 2 ** this.combo;
            this.combo = Math.min(this.combo + 1, 3);
            ghost.state = 'eaten';
            ghost.frightened = 0;
            ghost.eatenPause = 0;
          } else {
            this._die();
            break;
          }
        }
      }
    }

    this.syncHUD();
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------
  _eatPellets() {
    const pac = this.pacman;
    const pellets = this.level.pellets;
    if (!pellets || pellets.size === 0) return;

    for (const [key, pellet] of pellets) {
      const [sx, sy] = key.split(',');
      const x = Number(sx);
      const y = Number(sy);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const { px, py } = cellCenter(x, y);
      if (Math.hypot(pac.px - px, pac.py - py) > PELLET_EAT_RADIUS) continue;
      pellets.delete(key);
      if (pellet && pellet.power) {
        this.score += POWER_POINTS;
        this.frightened = FRIGHT_TIME; // shared scare window
      } else {
        this.score += PELLET_POINTS;
      }
    }
  }

  _die() {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.dyingTimer = 0;
    this.pacman.dead = true;
    this.combo = 0;
    this.frightened = 0;
    for (const ghost of this.ghosts) {
      if (ghost.state !== 'eaten') ghost.frightened = 0;
    }
  }

  _respawn() {
    this.pacman.dead = false;
    this.pacman.reset(this.level);
    for (const ghost of this.ghosts) {
      const i = this.ghosts.indexOf(ghost);
      ghost.reset(this.level, GHOST_HOUSE_SPAWNS[i]);
    }
    this.frightened = 0;
    this.readyTimer = 0;
    this.state = 'ready';
  }

  _gameOver() {
    // Lives exhausted — terminal state.
    this.state = 'gameover';
    this.pacman.dead = true;
    this.frightened = 0;
    this._saveHighScore();
  }

  _loadHighScore() {
    try {
      if (typeof localStorage === 'undefined') return 0;
      const v = Number(localStorage.getItem('pacink_high'));
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch {
      return 0;
    }
  }

  _saveHighScore() {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('pacink_high', String(this.highScore));
        }
      } catch {
        // storage unavailable — keep in memory only
      }
    }
  }

  // ------------------------------------------------------------------
  // HUD sync. Writes the DOM pieces of the shell (score / best / lives /
  // overlay). Guarded so the module is importable without a DOM.
  // ------------------------------------------------------------------
  syncHUD() {
    if (typeof document === 'undefined') return;
    const $ = (id) => document.getElementById(id);

    const score = Math.max(0, Math.floor(this.score));
    const high = Math.max(this.highScore, score);

    const scoreEl = $('score');
    if (scoreEl && scoreEl.textContent !== String(score)) scoreEl.textContent = String(score);
    const highEl = $('high-score');
    if (highEl && highEl.textContent !== String(high)) highEl.textContent = String(high);

    // Lives pips — rebuild only when the count changes.
    const livesShown = Math.max(0, this.lives);
    if (this._pipsDrawn !== livesShown) {
      this._pipsDrawn = livesShown;
      const livesEl = $('lives');
      if (livesEl) {
        livesEl.innerHTML = '';
        for (let i = 0; i < livesShown; i++) {
          const pip = document.createElement('span');
          pip.className = 'pip';
          livesEl.appendChild(pip);
        }
      }
    }

    const overlay = $('overlay');
    const title = $('overlay-title');
    const message = $('overlay-message');
    const hidden = this.state === 'playing' || this.state === 'dying';
    if (overlay) overlay.classList.toggle('hidden', hidden);

    let titleText;
    let msgHtml;
    let blink = false;
    if (this.state === 'ready') {
      titleText = 'PAC-INK';
      msgHtml = 'Get ready…';
      blink = true;
    } else if (this.state === 'gameover') {
      titleText = 'GAME OVER';
      msgHtml = 'Press <kbd>Space</kbd> to play again';
      blink = true;
    } else if (this.state === 'win') {
      titleText = 'YOU WIN!';
      msgHtml = 'Score <b>' + score + '</b> · Press <kbd>Space</kbd> to play again';
      blink = true;
    } else {
      // menu (or any other pre-play state)
      titleText = 'PAC-INK';
      msgHtml = 'Press <kbd>Space</kbd> to start';
      blink = true;
    }
    if (title && title.textContent !== titleText) title.textContent = titleText;
    if (message) {
      if (message.innerHTML !== msgHtml) message.innerHTML = msgHtml;
      message.classList.toggle('blink', blink);
    }
  }
}

