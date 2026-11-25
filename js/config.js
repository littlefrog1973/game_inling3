// Shared game constants. Single source of truth for grid geometry and pacing.
export const CELL = 24; // px per grid cell
export const COLS = 19;
export const ROWS = 23;
export const TUNNEL_ROW = 16; // horizontal tunnel row index (0-based)

export const PACMAN_SPEED = 108; // px/s
export const TUNNEL_SPEED = 140; // px/s — pacman speeds up in tunnel
export const GHOST_SPEED = 86; // px/s — cruise speed
export const FRIGHT_SPEED = 56; // px/s — frightened speed
export const GHOST_HOME_SPEED = 46; // px/s — slow movement inside the house

export const PACMAN_RADIUS = 9;
export const PELLET_RADIUS = 2.6;
export const POWER_RADIUS = 6;

export const FRIGHT_TIME = 6.0; // seconds
export const FRIGHT_BLINK_TIME = 1.4; // blink in last second
export const START_DELAY = 1.0; // pause before pacman is released
export const DEATH_DELAY = 1.35; // pacman-dissolve animation duration

export const COLORS = {
  bg: '#05050e',
  wall: '#1d2a6e',
  wallEdge: '#3a4bd0',
  pellet: '#ffe9b0',
  power: '#ffb347',
  pacman: '#ffd23f',
  ghosts: [
    { name: 'red', color: '#ff4a4a', scatter: { x: 17, y: 21 }, target: 'chase' },
    { name: 'pink', color: '#ff8ad4', scatter: { x: 1, y: 1 }, target: 'ambush' },
    { name: 'blue', color: '#43e7e8', scatter: { x: 17, y: 1 }, target: 'ambushLead' },
    { name: 'green', color: '#39e75f', scatter: { x: 1, y: 21 }, target: 'chase' },
  ],
};

export const SWAY = {
  scatterMs: 4800, // time ghosts spend scattered
};
