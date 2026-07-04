// Level sanity checker. Run from the repo root:
//   node scripts/validate-levels.ts
// Parses every level and verifies geometry, patrol reachability and that
// the cheese is actually winnable.

import { LEVELS } from '../src/levels.ts';
import {
  parseLevel, bfsPath, isBarrierChar, isFloorChar,
  WALL, VOID, FURN, HIDE,
  type ParsedLevel, type Vec,
} from '../src/engine.ts';

let failures = 0;

function fail(level: string, msg: string) {
  failures++;
  console.error(`  FAIL [${level}] ${msg}`);
}

function humanPassable(p: ParsedLevel) {
  const holeTiles = new Set([...p.holes.values()].map((h) => `${h.pos.x},${h.pos.y}`));
  return (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= p.w || y >= p.h) return false;
    const c = p.raw[y][x];
    if (c === WALL || c === VOID || c === FURN || c === HIDE) return false;
    if (holeTiles.has(`${x},${y}`)) return false;
    if (isBarrierChar(c)) {
      const b = p.barriers.find((bb) => bb.ch === c)!;
      return b.def.type === 'door'; // humans open doors, never windows
    }
    return true;
  };
}

// Mouse with every door unlocked / window open, following hole teleports.
function mouseCanReach(p: ParsedLevel, from: Vec, to: Vec): boolean {
  const passable = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= p.w || y >= p.h) return false;
    const c = p.raw[y][x];
    return c !== WALL && c !== VOID && c !== FURN;
  };
  const seen = new Set<string>();
  const holeAt = new Map<string, Vec>();
  for (const [ch, h] of p.holes) {
    holeAt.set(`${h.pos.x},${h.pos.y}`, p.holes.get(h.pair)!.pos);
    void ch;
  }
  const queue: Vec[] = [from];
  seen.add(`${from.x},${from.y}`);
  while (queue.length) {
    const t = queue.pop()!;
    if (t.x === to.x && t.y === to.y) return true;
    const neighbours: Vec[] = [
      { x: t.x + 1, y: t.y }, { x: t.x - 1, y: t.y },
      { x: t.x, y: t.y + 1 }, { x: t.x, y: t.y - 1 },
    ];
    const tp = holeAt.get(`${t.x},${t.y}`);
    if (tp) neighbours.push(tp);
    for (const n of neighbours) {
      const k = `${n.x},${n.y}`;
      if (seen.has(k) || !passable(n.x, n.y)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return false;
}

for (const def of LEVELS) {
  console.log(`Level: ${def.name}`);

  // Ragged rows are almost always an authoring typo.
  const lines = def.grid.replace(/^\n+|\n+$/g, '').split('\n');
  const widths = new Set(lines.map((l) => l.length));
  if (widths.size > 1) {
    lines.forEach((l, i) => {
      if (l.length !== lines[0].length) fail(def.name, `row ${i} is ${l.length} wide (row 0 is ${lines[0].length}): ${l}`);
    });
    continue;
  }

  let p: ParsedLevel;
  try {
    p = parseLevel(def);
  } catch (e) {
    fail(def.name, String(e));
    continue;
  }

  // Border must be sealed (wall or void) so nothing escapes the map.
  for (let x = 0; x < p.w; x++) {
    for (const y of [0, p.h - 1]) {
      const c = p.raw[y][x];
      if (c !== WALL && c !== VOID) fail(def.name, `border leak at ${x},${y} ('${c}')`);
    }
  }
  for (let y = 0; y < p.h; y++) {
    for (const x of [0, p.w - 1]) {
      const c = p.raw[y][x];
      if (c !== WALL && c !== VOID) fail(def.name, `border leak at ${x},${y} ('${c}')`);
    }
  }

  // Every patrol leg (including the loop-back) must be walkable.
  const pass = humanPassable(p);
  for (const [hi, hu] of def.humans.entries()) {
    const wps = hu.path.split('').map((ch) => p.waypoints.get(ch)!);
    for (const [wi, a] of wps.entries()) {
      if (!pass(a.x, a.y)) fail(def.name, `human ${hi} waypoint '${hu.path[wi]}' stands on impassable tile`);
      const b = wps[(wi + 1) % wps.length];
      if (a === b) continue;
      if (!bfsPath(p.w, p.h, pass, a, b)) {
        fail(def.name, `human ${hi} cannot walk leg '${hu.path[wi]}' -> '${hu.path[(wi + 1) % wps.length]}'`);
      }
    }
  }

  // Cheese, every item and the cat's post must be reachable by the mouse.
  if (!mouseCanReach(p, p.spawn, p.cheese)) fail(def.name, 'cheese unreachable from spawn');
  for (const it of p.items) {
    if (!mouseCanReach(p, p.spawn, it.pos)) fail(def.name, `item '${it.ch}' (${it.def.type}) unreachable`);
  }
  for (const [ch, h] of p.holes) {
    if (!mouseCanReach(p, p.spawn, h.pos)) fail(def.name, `hole '${ch}' unreachable`);
  }

  // Key chain: every door color needs at least one key of that color, and
  // spool windows need a spool somewhere in the level.
  const keyColors = new Set(p.items.filter((i) => i.def.type === 'key').map((i) => (i.def as { color: string }).color));
  for (const b of p.barriers) {
    if (b.def.type === 'door' && !keyColors.has(b.def.color)) {
      fail(def.name, `door '${b.ch}' (${b.def.color}) has no matching key`);
    }
    if (b.def.type === 'window' && b.def.mode === 'spool' && !p.items.some((i) => i.def.type === 'spool')) {
      fail(def.name, `spool window '${b.ch}' but no spool item`);
    }
    // Barrier tiles must sit between two passable sides (door in a wall).
    for (const t of b.tiles) {
      const open =
        (p.raw[t.y - 1]?.[t.x] !== WALL && p.raw[t.y + 1]?.[t.x] !== WALL) ||
        (p.raw[t.y]?.[t.x - 1] !== WALL && p.raw[t.y]?.[t.x + 1] !== WALL);
      if (!open) fail(def.name, `barrier '${b.ch}' tile at ${t.x},${t.y} is walled on both axes`);
    }
  }

  const catDef = Object.values(def.markers ?? {}).some((m) => m.type === 'cat');
  if (catDef && !p.catSpawn) fail(def.name, 'cat marker defined but not placed');

  console.log(
    `  ok: ${p.w}x${p.h}, ${p.roomCount} rooms, ${def.humans.length} human(s), ` +
    `${p.items.length} items, ${p.holes.size} holes${p.catSpawn ? ', cat' : ''}${p.darkRooms.size ? `, ${p.darkRooms.size} dark rooms` : ''}`,
  );
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll levels valid.');
