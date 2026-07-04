// Level parsing and grid algorithms (pathfinding, line of sight, rooms).
// This module is DOM-free so it can also run under plain Node for the
// level validator script.

export interface Vec {
  x: number;
  y: number;
}

export type DoorColor = 'red' | 'blue' | 'green' | 'gold';

export const DOOR_COLORS: Record<DoorColor, string> = {
  red: '#e05a4e',
  blue: '#4a90d9',
  green: '#57a05a',
  gold: '#d9a53a',
};

// Items and special objects placed via marker letters in the grid.
export type MarkerDef =
  | { type: 'key'; color: DoorColor }
  | { type: 'cork' }
  | { type: 'crumb' }
  | { type: 'spool' }
  | { type: 'cord' } // lamp cord: gnaw to permanently darken its room
  | { type: 'hole'; pair: string } // mouse hole, teleports to its pair
  | { type: 'cat' };

// Doors and windows placed via digit characters in the grid.
export type BarrierDef =
  | { type: 'door'; color: DoorColor }
  | { type: 'window'; mode: 'timer' | 'spool'; phase?: number };

export interface HumanDef {
  path: string; // waypoint letters in patrol order; single letter = stands still
  sentry?: boolean; // stands at first waypoint rotating the cone
  speed?: number;
}

export interface LevelDef {
  name: string;
  hint: string;
  grid: string;
  barriers?: Record<string, BarrierDef>;
  markers?: Record<string, MarkerDef>;
  humans: HumanDef[];
  // Marker/waypoint chars whose containing room starts dark (lights off).
  darkRooms?: string[];
}

// ---- Tile classification ------------------------------------------------

export const FLOOR_CHARS = new Set(['.', ',', '=', '~', '+', '"', '-', '_']);
export const WALL = '#';
export const VOID = ' ';
export const FURN = '['; // solid furniture
export const HIDE = ']'; // furniture the mouse can hide under

export function isFloorChar(c: string): boolean {
  return FLOOR_CHARS.has(c);
}
export function isBarrierChar(c: string): boolean {
  return c >= '0' && c <= '9';
}
export function isLetter(c: string): boolean {
  return /[a-zA-Z]/.test(c);
}

// ---- Parsed level -------------------------------------------------------

export interface BarrierTile {
  ch: string;
  def: BarrierDef;
  tiles: Vec[]; // a door/window may span multiple tiles sharing one char
}

export interface ItemSpawn {
  ch: string;
  def: MarkerDef;
  pos: Vec; // tile coords
}

export interface ParsedLevel {
  def: LevelDef;
  w: number;
  h: number;
  raw: string[][]; // original grid chars [y][x]
  floor: string[][]; // resolved floor char per tile (inferred under specials)
  rooms: number[][]; // room id per tile, -1 for walls/void/barriers
  roomCount: number;
  outdoorRooms: Set<number>;
  darkRooms: Set<number>;
  spawn: Vec;
  cheese: Vec;
  waypoints: Map<string, Vec>;
  barriers: BarrierTile[];
  holes: Map<string, { pos: Vec; pair: string }>;
  items: ItemSpawn[];
  catSpawn: Vec | null;
}

export function center(t: Vec): Vec {
  return { x: t.x + 0.5, y: t.y + 0.5 };
}

export function parseLevel(def: LevelDef): ParsedLevel {
  const lines = def.grid.replace(/^\n+|\n+$/g, '').split('\n');
  const w = Math.max(...lines.map((l) => l.length));
  const h = lines.length;
  const raw: string[][] = lines.map((l) => {
    const row = l.split('');
    while (row.length < w) row.push(VOID);
    return row;
  });

  const markers = def.markers ?? {};
  const barrierDefs = def.barriers ?? {};

  let spawn: Vec | null = null;
  let cheese: Vec | null = null;
  let catSpawn: Vec | null = null;
  const waypoints = new Map<string, Vec>();
  const holes = new Map<string, { pos: Vec; pair: string }>();
  const items: ItemSpawn[] = [];
  const barrierMap = new Map<string, BarrierTile>();

  const pathChars = new Set(def.humans.flatMap((hu) => hu.path.split('')));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = raw[y][x];
      if (isBarrierChar(c)) {
        const bdef = barrierDefs[c];
        if (!bdef) throw new Error(`${def.name}: barrier '${c}' at ${x},${y} has no definition`);
        let bt = barrierMap.get(c);
        if (!bt) {
          bt = { ch: c, def: bdef, tiles: [] };
          barrierMap.set(c, bt);
        }
        bt.tiles.push({ x, y });
      } else if (isLetter(c)) {
        if (c === 'S') {
          if (spawn) throw new Error(`${def.name}: duplicate spawn`);
          spawn = { x, y };
        } else if (c === 'C') {
          if (cheese) throw new Error(`${def.name}: duplicate cheese`);
          cheese = { x, y };
        } else if (markers[c]) {
          const m = markers[c];
          if (m.type === 'hole') {
            holes.set(c, { pos: { x, y }, pair: m.pair });
          } else if (m.type === 'cat') {
            catSpawn = { x, y };
          } else {
            items.push({ ch: c, def: m, pos: { x, y } });
          }
        } else if (pathChars.has(c)) {
          if (waypoints.has(c)) throw new Error(`${def.name}: duplicate waypoint '${c}'`);
          waypoints.set(c, { x, y });
        } else {
          throw new Error(`${def.name}: unknown letter '${c}' at ${x},${y}`);
        }
      } else if (c !== WALL && c !== VOID && c !== FURN && c !== HIDE && !isFloorChar(c)) {
        throw new Error(`${def.name}: unknown char '${c}' at ${x},${y}`);
      }
    }
  }

  if (!spawn) throw new Error(`${def.name}: missing spawn 'S'`);
  if (!cheese) throw new Error(`${def.name}: missing cheese 'C'`);
  for (const ch of pathChars) {
    if (!waypoints.has(ch)) throw new Error(`${def.name}: waypoint '${ch}' not in grid`);
  }
  for (const [ch, hole] of holes) {
    const pair = holes.get(hole.pair);
    if (!pair) throw new Error(`${def.name}: hole '${ch}' pairs to missing '${hole.pair}'`);
    if (pair.pair !== ch) throw new Error(`${def.name}: hole pair '${ch}'/'${hole.pair}' not symmetric`);
  }
  for (const ch of Object.keys(barrierDefs)) {
    if (!barrierMap.has(ch)) throw new Error(`${def.name}: barrier '${ch}' defined but not in grid`);
  }

  // Resolve the floor char under special tiles (markers, barriers,
  // furniture, spawn, cheese...) from the most common orthogonal
  // neighbour floor. Iterate so chains of specials resolve too.
  const floor: string[][] = raw.map((row) => row.map((c) => (isFloorChar(c) ? c : '')));
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = raw[y][x];
        if (floor[y][x] !== '' || c === WALL || c === VOID) continue;
        const counts = new Map<string, number>();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const f = floor[ny][nx];
          if (f !== '') counts.set(f, (counts.get(f) ?? 0) + 1);
        }
        let best = '';
        let bestN = 0;
        for (const [f, n] of counts) {
          if (n > bestN) {
            best = f;
            bestN = n;
          }
        }
        if (best !== '') {
          floor[y][x] = best;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (floor[y][x] === '' && raw[y][x] !== WALL && raw[y][x] !== VOID) floor[y][x] = '=';
    }
  }

  // Rooms: flood fill interior tiles; walls, void and barriers are
  // boundaries so each door/window separates rooms (used for fog).
  const rooms: number[][] = raw.map((row) => row.map(() => -1));
  const interior = (x: number, y: number) => {
    const c = raw[y][x];
    return c !== WALL && c !== VOID && !isBarrierChar(c);
  };
  let roomCount = 0;
  const outdoorRooms = new Set<number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!interior(x, y) || rooms[y][x] !== -1) continue;
      const id = roomCount++;
      const queue: Vec[] = [{ x, y }];
      rooms[y][x] = id;
      while (queue.length) {
        const t = queue.pop()!;
        if (raw[t.y][t.x] === '.' || raw[t.y][t.x] === ',') outdoorRooms.add(id);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = t.x + dx, ny = t.y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (!interior(nx, ny) || rooms[ny][nx] !== -1) continue;
          rooms[ny][nx] = id;
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }

  const darkRooms = new Set<number>();
  for (const ch of def.darkRooms ?? []) {
    const pos =
      waypoints.get(ch) ??
      holes.get(ch)?.pos ??
      items.find((i) => i.ch === ch)?.pos ??
      (ch === 'C' ? cheese : ch === 'S' ? spawn : null);
    if (!pos) throw new Error(`${def.name}: darkRooms char '${ch}' not found in grid`);
    const id = rooms[pos.y][pos.x];
    if (id < 0) throw new Error(`${def.name}: darkRooms char '${ch}' is not inside a room`);
    darkRooms.add(id);
  }

  return {
    def, w, h, raw, floor, rooms, roomCount, outdoorRooms, darkRooms,
    spawn, cheese, waypoints,
    barriers: [...barrierMap.values()],
    holes, items, catSpawn,
  };
}

// ---- Pathfinding --------------------------------------------------------

// BFS shortest path over tiles. Returns tile coords from start (exclusive)
// to goal (inclusive), or null if unreachable.
export function bfsPath(
  w: number,
  h: number,
  passable: (x: number, y: number) => boolean,
  from: Vec,
  to: Vec,
): Vec[] | null {
  const sx = Math.floor(from.x), sy = Math.floor(from.y);
  const gx = Math.floor(to.x), gy = Math.floor(to.y);
  if (sx === gx && sy === gy) return [];
  const prev = new Int32Array(w * h).fill(-2);
  prev[sy * w + sx] = -1;
  let queue = [sy * w + sx];
  while (queue.length) {
    const next: number[] = [];
    for (const idx of queue) {
      const x = idx % w, y = (idx - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nidx = ny * w + nx;
        if (prev[nidx] !== -2 || !passable(nx, ny)) continue;
        prev[nidx] = idx;
        if (nx === gx && ny === gy) {
          const path: Vec[] = [];
          let cur = nidx;
          while (cur !== sy * w + sx) {
            path.push({ x: cur % w, y: Math.floor(cur / w) });
            cur = prev[cur];
          }
          path.reverse();
          return path;
        }
        next.push(nidx);
      }
    }
    queue = next;
  }
  return null;
}

// ---- Line of sight ------------------------------------------------------

// Sample-based LOS between two world-space points.
export function hasLOS(
  a: Vec,
  b: Vec,
  blocksVision: (x: number, y: number) => boolean,
): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 0.15));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(a.x + dx * t);
    const y = Math.floor(a.y + dy * t);
    if (blocksVision(x, y)) return false;
  }
  return true;
}

// March a ray until it hits a vision-blocking tile or reaches maxDist.
// Returns the distance travelled.
export function castRay(
  from: Vec,
  angle: number,
  maxDist: number,
  blocksVision: (x: number, y: number) => boolean,
): number {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const step = 0.08;
  for (let d = step; d <= maxDist; d += step) {
    const x = Math.floor(from.x + dx * d);
    const y = Math.floor(from.y + dy * d);
    if (blocksVision(x, y)) return d;
  }
  return maxDist;
}

export function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
