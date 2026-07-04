// Headless simulation smoke test. Run from the repo root:
//   node scripts/sim-test.ts
// Boots every level and checks the core loops: patrols advance, detection
// spots the mouse, holes teleport, and nibbling the cheese wins.

import { LEVELS } from '../src/levels.ts';
import { Game, type GameInput } from '../src/game.ts';
import { center, dist, bfsPath } from '../src/engine.ts';

let failures = 0;
function check(level: string, name: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++;
    console.error(`  FAIL [${level}] ${name} ${detail}`);
  }
}

const IDLE: GameInput = { moveX: 0, moveY: 0, sneak: false, actionHeld: false, actionPressed: false, selectedSlot: 0 };
const HOLD: GameInput = { ...IDLE, actionHeld: true };

function fresh(i: number): Game {
  const g = new Game(LEVELS[i], i);
  g.phase = 'play';
  return g;
}

const DT = 1 / 60;

for (const [i, def] of LEVELS.entries()) {
  console.log(`Level ${i + 1}: ${def.name}`);

  // A) idle world simulation: patrols move, nothing crashes or NaNs
  {
    const g = fresh(i);
    const starts = g.humans.map((h) => ({ ...h.pos }));
    let travelled = g.humans.map(() => 0);
    let prev = g.humans.map((h) => ({ ...h.pos }));
    for (let t = 0; t < 90; t += DT) {
      g.update(DT, IDLE);
      g.humans.forEach((h, hi) => {
        travelled[hi] += dist(prev[hi], h.pos);
        prev[hi] = { ...h.pos };
      });
    }
    check(def.name, 'no capture while idle at spawn', g.phase === 'play', `phase=${g.phase} spotted=${g.stats.spotted}`);
    g.humans.forEach((h, hi) => {
      check(def.name, `human ${hi} position finite`, Number.isFinite(h.pos.x) && Number.isFinite(h.pos.y));
      if (!h.sentry) {
        check(def.name, `human ${hi} patrols (travelled ${travelled[hi].toFixed(1)} tiles)`, travelled[hi] > 10);
      }
    });
    if (g.cat) check(def.name, 'cat position finite', Number.isFinite(g.cat.pos.x) && Number.isFinite(g.cat.pos.y));
    void starts;
  }

  // B) detection: stand right in front of a human's nose -> spotted/caught
  {
    const g = fresh(i);
    const h = g.humans[0];
    // face the human toward a walkable neighbour and put the mouse there
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const p = { x: h.pos.x + Math.cos(a) * 1.2, y: h.pos.y + Math.sin(a) * 1.2 };
      if (g.mousePassable(Math.floor(p.x), Math.floor(p.y))) {
        g.pos = p;
        h.angle = a;
        h.targetAngle = a;
        break;
      }
    }
    for (let t = 0; t < 3 && g.phase === 'play'; t += DT) g.update(DT, IDLE);
    check(def.name, 'standing in the cone gets you spotted', g.stats.spotted >= 1 || g.phase === 'caught', `spotted=${g.stats.spotted} phase=${g.phase}`);
  }

  // C) nibbling the cheese wins (cat removed — it guards the cheese by design)
  {
    const g = fresh(i);
    g.cat = null;
    g.pos = center(g.level.cheese);
    for (let t = 0; t < 2 && g.phase !== 'won'; t += DT) g.update(DT, HOLD);
    check(def.name, 'nibble wins', g.phase === 'won', `phase=${g.phase} nibbleT=${g.nibbleT.toFixed(2)}`);
    if (g.phase === 'won') check(def.name, 'confetti burst', g.particles.length > 0);
  }

  // D) mouse holes teleport to their pair
  for (const [ch, hole] of fresh(i).level.holes) {
    const g = fresh(i);
    const pair = g.level.holes.get(hole.pair)!;
    g.pos = center(hole.pos);
    g.update(DT, IDLE);
    check(def.name, `hole '${ch}' teleports`, dist(g.pos, center(pair.pos)) < 0.1, `pos=${g.pos.x.toFixed(1)},${g.pos.y.toFixed(1)}`);
  }

  // E) timer windows actually cycle
  for (const b of fresh(i).level.barriers) {
    if (b.def.type !== 'window' || b.def.mode !== 'timer') continue;
    const g = fresh(i);
    let opened = false, closed = false;
    for (let t = 0; t < 12; t += 0.25) {
      g.time = t;
      if (g.isWindowOpen(b)) opened = true;
      else closed = true;
    }
    check(def.name, `timer window '${b.ch}' cycles`, opened && closed);
  }

  // F) capture resets to spawn and (on later levels) drops inventory
  {
    const g = fresh(i);
    const item = g.items.find((it) => it.type === 'key');
    if (item) {
      item.state = 'held';
      g.inventory.push(item);
    }
    g.capture('seen');
    check(def.name, 'capture returns mouse to spawn', dist(g.pos, center(g.level.spawn)) < 0.01);
    if (item) {
      const shouldKeep = i + 1 <= 3;
      check(def.name, `capture ${shouldKeep ? 'keeps' : 'drops'} items`, shouldKeep ? g.inventory.length === 1 : g.inventory.length === 0);
    }
    // wipe finishes and play resumes
    for (let t = 0; t < 2 && g.phase !== 'play'; t += DT) g.update(DT, IDLE);
    check(def.name, 'play resumes after wipe', g.phase === 'play');
  }
}

// ---- scripted end-to-end solves (humans removed; stealth tested above) ----

function goto(g: Game, target: { x: number; y: number }, timeout = 40): boolean {
  let t = 0;
  while (dist(g.pos, center(target)) > 0.3 && t < timeout) {
    const tiles = bfsPath(g.level.w, g.level.h, g.mousePassable, g.pos, target);
    if (tiles === null) return false;
    const next = tiles.length ? center(tiles[0]) : center(target);
    const dx = next.x - g.pos.x, dy = next.y - g.pos.y;
    const l = Math.hypot(dx, dy) || 1;
    g.update(DT, { ...IDLE, moveX: dx / l, moveY: dy / l });
    t += DT;
  }
  return dist(g.pos, center(target)) <= 0.3;
}
const press = (g: Game) => g.update(DT, { ...IDLE, actionPressed: true });
const tileOf = (p: { x: number; y: number }) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });

function adjacentFloor(g: Game, t: { x: number; y: number }): { x: number; y: number } {
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    if (g.mousePassable(t.x + dx, t.y + dy)) return { x: t.x + dx, y: t.y + dy };
  }
  throw new Error('no adjacent floor');
}

// H) level 1 full solve: grab key -> unlock door -> nibble
{
  const g = fresh(0);
  g.humans = [];
  const key = g.items.find((it) => it.type === 'key')!;
  check('solve L1', 'walk to key', goto(g, tileOf(key.pos)));
  press(g);
  check('solve L1', 'key picked up', g.inventory.includes(key));
  const door = g.level.barriers[0];
  check('solve L1', 'walk to door', goto(g, adjacentFloor(g, door.tiles[0])));
  press(g);
  check('solve L1', 'door unlocked', g.unlockedDoors.has(door.ch));
  check('solve L1', 'walk to cheese', goto(g, g.level.cheese));
  for (let t = 0; t < 2 && g.phase !== 'won'; t += DT) g.update(DT, HOLD);
  check('solve L1', 'level won', g.phase === 'won');
}

// H2) level 2 full solve: wait for the timer window, enter, key, door, cheese
{
  const g = fresh(1);
  g.humans = [];
  const win = g.level.barriers.find((b) => b.def.type === 'window')!;
  const outside = adjacentFloor(g, { x: win.tiles[0].x, y: win.tiles[0].y + 1 });
  check('solve L2', 'reach the window', goto(g, outside));
  for (let t = 0; t < 12 && !g.isWindowOpen(win); t += DT) g.update(DT, IDLE);
  check('solve L2', 'window opened', g.isWindowOpen(win));
  check('solve L2', 'slip inside', goto(g, { x: win.tiles[0].x, y: win.tiles[0].y - 1 }, 8));
  const key = g.items.find((it) => it.type === 'key')!;
  check('solve L2', 'grab key', goto(g, tileOf(key.pos)));
  press(g);
  const door = g.level.barriers.find((b) => b.def.type === 'door')!;
  check('solve L2', 'reach door', goto(g, adjacentFloor(g, door.tiles[0])));
  press(g);
  check('solve L2', 'door unlocked', g.unlockedDoors.has(door.ch));
  check('solve L2', 'reach cheese', goto(g, g.level.cheese));
  for (let t = 0; t < 2 && g.phase !== 'won'; t += DT) g.update(DT, HOLD);
  check('solve L2', 'level won', g.phase === 'won');
}

// I) spool window climb (level 8 vault)
{
  const idx = LEVELS.findIndex((l) => Object.values(l.barriers ?? {}).some((b) => b.type === 'window' && b.mode === 'spool'));
  const g = fresh(idx);
  g.humans = [];
  g.cat = null;
  const win = g.level.barriers.find((b) => b.def.type === 'window' && b.def.mode === 'spool')!;
  const spool = g.items.find((it) => it.type === 'spool')!;
  spool.state = 'held';
  g.inventory.push(spool);
  g.pos = { x: win.tiles[0].x + 1.5, y: win.tiles[0].y + 0.5 }; // pantry side
  g.update(DT, IDLE);
  check('spool climb', 'climb is the context action', g.context.kind === 'climb', `kind=${g.context.kind}`);
  press(g);
  check('spool climb', 'window climbed', g.climbedWindows.has(win.ch));
  check('spool climb', 'mouse crossed into the vault', g.pos.x < win.tiles[0].x + 0.5, `x=${g.pos.x.toFixed(2)}`);
}

// G) cat chase: drop the mouse next to the cat and make sure it reacts
{
  const idx = LEVELS.findIndex((l) => Object.values(l.markers ?? {}).some((m) => m.type === 'cat'));
  const g = fresh(idx);
  g.pos = { x: g.cat!.pos.x + 1, y: g.cat!.pos.y };
  for (let t = 0; t < 4 && g.phase === 'play'; t += DT) g.update(DT, IDLE);
  check(LEVELS[idx].name, 'cat notices and catches an adjacent mouse', g.cat!.mode === 'chase' || g.phase === 'caught', `mode=${g.cat!.mode} phase=${g.phase}`);
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll simulation checks passed.');
