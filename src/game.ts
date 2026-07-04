// Core simulation: the mouse, humans, the cat, items and win/capture logic.
// Rendering lives in render.ts; this module only mutates state.

import { CONFIG } from './config.ts';
import {
  parseLevel, bfsPath, hasLOS, angDiff, dist, center,
  isBarrierChar, WALL, VOID, FURN, HIDE,
  type LevelDef, type ParsedLevel, type Vec, type DoorColor, type BarrierTile,
} from './engine.ts';

export interface GameInput {
  moveX: number; // unit direction * magnitude 0..1
  moveY: number;
  sneak: boolean;
  actionHeld: boolean;
  actionPressed: boolean; // edge-triggered this frame
  selectedSlot: number;
}

export type ItemType = 'key' | 'cork' | 'crumb' | 'spool' | 'cord';

export interface ItemInstance {
  id: number;
  ch: string;
  type: ItemType;
  color?: DoorColor;
  state: 'world' | 'held' | 'placed' | 'gone';
  pos: Vec; // world coords when world/placed
  spawnPos: Vec;
}

export type HumanMode = 'patrol' | 'investigate' | 'scan' | 'suspicious' | 'chase';

export interface HumanState {
  idx: number;
  sentry: boolean;
  baseSpeed: number;
  waypoints: Vec[]; // world centers, patrol order
  wpIdx: number;
  pos: Vec;
  angle: number;
  targetAngle: number;
  mode: HumanMode;
  path: Vec[]; // remaining tile centers to walk
  target: Vec | null; // investigate/suspicious destination
  scanT: number;
  scanBase: number;
  pauseT: number;
  eye: number; // 0..EYE_CAPTURE_TIME
  outT: number; // time since mouse last in cone
  seesMouse: boolean;
  lastSeen: Vec | null;
  memoryT: number;
  repathT: number;
  flashT: number; // cone red flash
  stepPhase: number;
}

export type CatMode = 'wander' | 'chase' | 'lured' | 'eat';

export interface CatState {
  pos: Vec;
  angle: number;
  targetAngle: number;
  mode: CatMode;
  path: Vec[];
  target: Vec | null;
  wanderT: number;
  repathT: number;
  giveupT: number;
  eatT: number;
  followT: number; // pending hole-follow timer
  followTo: Vec | null;
  lureItem: ItemInstance | null;
  stepPhase: number;
}

export interface Popup { pos: Vec; text: string; t: number; color: string }
export interface Particle { pos: Vec; vel: Vec; t: number; life: number; color: string; size: number }
export interface NoiseEvent { pos: Vec; radius: number; t: number }

export interface ActionContext {
  label: string;
  kind: 'nibble' | 'unlock' | 'climb' | 'plug' | 'gnaw' | 'grab' | 'hide' | 'peek' | 'drop' | 'none';
  item?: ItemInstance;
  barrier?: BarrierTile;
  holeCh?: string;
}

export type Phase = 'hint' | 'play' | 'caught' | 'won';

export interface Stats { time: number; spotted: number; itemsUsed: number }

export class Game {
  level: ParsedLevel;
  levelIndex: number; // 0-based

  phase: Phase = 'hint';
  stats: Stats = { time: 0, spotted: 0, itemsUsed: 0 };

  // player
  pos: Vec;
  facing = -Math.PI / 2;
  moving = false;
  sneaking = false;
  hidden = false;
  nibbleT = 0;
  holeCooldown = 0;
  tail: Vec[] = [];
  squash = 0;
  lastAngle = 0;
  private lastTile: Vec;
  private noiseTimer = 0;

  items: ItemInstance[] = [];
  inventory: ItemInstance[] = [];
  selectedSlot = 0;

  humans: HumanState[] = [];
  cat: CatState | null = null;

  unlockedDoors = new Set<string>();
  climbedWindows = new Set<string>();
  pluggedHoles = new Set<string>();
  gnawedRooms = new Set<number>();
  visitedRooms = new Set<number>();

  time = 0; // world clock (drives window timers, bobbing)
  wipeT = -1; // capture wipe animation, -1 = inactive
  wonT = 0;

  popups: Popup[] = [];
  particles: Particle[] = [];
  noises: NoiseEvent[] = []; // recent, for debug rendering
  private pendingClatter: { pos: Vec; t: number }[] = [];

  camera: Vec;
  eyeMeter = 0; // 0..1 for HUD
  context: ActionContext = { label: '', kind: 'none' };

  constructor(def: LevelDef, levelIndex: number) {
    this.level = parseLevel(def);
    this.levelIndex = levelIndex;
    this.pos = center(this.level.spawn);
    this.lastTile = { ...this.level.spawn };
    this.camera = { ...this.pos };

    let id = 0;
    for (const it of this.level.items) {
      this.items.push({
        id: id++,
        ch: it.ch,
        type: it.def.type as ItemType,
        color: it.def.type === 'key' ? it.def.color : undefined,
        state: 'world',
        pos: center(it.pos),
        spawnPos: center(it.pos),
      });
    }

    for (const [i, hdef] of def.humans.entries()) {
      const wps = hdef.path.split('').map((ch) => center(this.level.waypoints.get(ch)!));
      this.humans.push({
        idx: i,
        sentry: !!hdef.sentry,
        baseSpeed: hdef.speed ?? CONFIG.HUMAN_SPEED,
        waypoints: wps,
        wpIdx: 0,
        pos: { ...wps[0] },
        angle: Math.PI / 2,
        targetAngle: Math.PI / 2,
        mode: 'patrol',
        path: [],
        target: null,
        scanT: 0,
        scanBase: 0,
        pauseT: 0,
        eye: 0,
        outT: 99,
        seesMouse: false,
        lastSeen: null,
        memoryT: 0,
        repathT: 0,
        flashT: 0,
        stepPhase: Math.random() * 10,
      });
    }

    if (this.level.catSpawn) {
      this.cat = {
        pos: center(this.level.catSpawn),
        angle: 0,
        targetAngle: 0,
        mode: 'wander',
        path: [],
        target: null,
        wanderT: 1,
        repathT: 0,
        giveupT: 0,
        eatT: 0,
        followT: -1,
        followTo: null,
        lureItem: null,
        stepPhase: 0,
      };
    }

    for (const r of this.level.outdoorRooms) this.visitedRooms.add(r);
    const spawnRoom = this.roomAt(this.level.spawn.x, this.level.spawn.y);
    if (spawnRoom >= 0) this.visitedRooms.add(spawnRoom);
  }

  // ---- tile queries ------------------------------------------------------

  rawAt(x: number, y: number): string {
    if (x < 0 || y < 0 || x >= this.level.w || y >= this.level.h) return VOID;
    return this.level.raw[y][x];
  }

  roomAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.level.w || y >= this.level.h) return -1;
    return this.level.rooms[y][x];
  }

  barrierByChar(ch: string): BarrierTile | undefined {
    return this.level.barriers.find((b) => b.ch === ch);
  }

  isWindowOpen(b: BarrierTile): boolean {
    if (b.def.type !== 'window') return false;
    if (this.climbedWindows.has(b.ch)) return true;
    if (b.def.mode === 'spool') return false;
    const cycle = CONFIG.WINDOW_OPEN_TIME + CONFIG.WINDOW_CLOSE_TIME;
    return (this.time + (b.def.phase ?? 0)) % cycle < CONFIG.WINDOW_OPEN_TIME;
  }

  isBarrierPassableForMouse(ch: string): boolean {
    const b = this.barrierByChar(ch)!;
    if (b.def.type === 'door') return this.unlockedDoors.has(ch);
    return this.isWindowOpen(b);
  }

  mousePassable = (x: number, y: number): boolean => {
    const c = this.rawAt(x, y);
    if (c === WALL || c === VOID || c === FURN) return false;
    if (isBarrierChar(c)) return this.isBarrierPassableForMouse(c);
    return true;
  };

  humanPassable = (x: number, y: number): boolean => {
    const c = this.rawAt(x, y);
    if (c === WALL || c === VOID || c === FURN || c === HIDE) return false;
    for (const h of this.level.holes.values()) {
      if (h.pos.x === x && h.pos.y === y) return false;
    }
    if (isBarrierChar(c)) return this.barrierByChar(c)!.def.type === 'door';
    return true;
  };

  catPassable = (x: number, y: number): boolean => {
    const c = this.rawAt(x, y);
    if (c === WALL || c === VOID || c === FURN || c === HIDE) return false;
    if (isBarrierChar(c)) {
      const b = this.barrierByChar(c)!;
      return b.def.type === 'door' && this.unlockedDoors.has(c);
    }
    return true;
  };

  blocksVision = (x: number, y: number): boolean => {
    const c = this.rawAt(x, y);
    if (c === WALL || c === VOID || c === FURN) return true;
    if (isBarrierChar(c)) {
      const b = this.barrierByChar(c)!;
      if (b.def.type === 'door') return !this.unlockedDoors.has(c); // closed doors block
      return false; // windows are glass
    }
    return false;
  };

  // Dark right now? Lit while a human is inside, unless the lamp cord in
  // that room has been gnawed.
  isRoomDarkNow(room: number): boolean {
    if (room < 0 || !this.level.darkRooms.has(room)) return false;
    if (this.gnawedRooms.has(room)) return true;
    for (const h of this.humans) {
      if (this.roomAt(Math.floor(h.pos.x), Math.floor(h.pos.y)) === room) return false;
    }
    return true;
  }

  visionRange(h: HumanState): number {
    const room = this.roomAt(Math.floor(h.pos.x), Math.floor(h.pos.y));
    return this.isRoomDarkNow(room) ? CONFIG.VISION_RANGE_DARK : CONFIG.VISION_RANGE;
  }

  // ---- main update ---------------------------------------------------------

  update(dt: number, input: GameInput) {
    this.time += dt;
    this.updateEffects(dt);

    if (this.phase === 'caught') {
      this.wipeT += dt;
      if (this.wipeT >= CONFIG.WIPE_TIME) {
        this.wipeT = -1;
        this.phase = 'play';
      }
      return;
    }
    if (this.phase === 'won') {
      this.wonT += dt;
      return;
    }
    if (this.phase !== 'play') return;

    this.stats.time += dt;
    this.selectedSlot = Math.min(input.selectedSlot, Math.max(0, this.inventory.length - 1));

    this.updatePlayer(dt, input);
    this.updateClatter(dt);
    for (const h of this.humans) this.updateHuman(h, dt);
    if (this.cat) this.updateCat(this.cat, dt);
    this.updateDetection(dt);

    this.context = this.computeContext();
    if (input.actionPressed) this.performAction(this.context);
    this.updateNibble(dt, input);
  }

  private updateEffects(dt: number) {
    this.popups = this.popups.filter((p) => (p.t += dt) < 1.4);
    for (const p of this.particles) {
      p.t += dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.vel.y += 6 * dt;
    }
    this.particles = this.particles.filter((p) => p.t < p.life);
    this.noises = this.noises.filter((n) => (n.t += dt) < 1.0);
  }

  // ---- player -------------------------------------------------------------

  private updatePlayer(dt: number, input: GameInput) {
    const mag = Math.hypot(input.moveX, input.moveY);
    this.moving = mag > 0.01;
    this.sneaking = input.sneak;
    this.holeCooldown = Math.max(0, this.holeCooldown - dt);

    if (this.moving) {
      if (this.hidden) this.hidden = false; // moving out of cover
      const speed = input.sneak ? CONFIG.SNEAK_SPEED : CONFIG.SCURRY_SPEED;
      const nx = input.moveX / mag, ny = input.moveY / mag;
      this.moveWithCollision(nx * speed * Math.min(1, mag) * dt, ny * speed * Math.min(1, mag) * dt);

      const targetAngle = Math.atan2(ny, nx);
      const turn = angDiff(targetAngle, this.facing);
      this.facing += turn * Math.min(1, dt * 12);
      this.squash = Math.min(0.35, Math.abs(turn) * 0.25);

      // tail history
      const last = this.tail[0];
      if (!last || dist(last, this.pos) > 0.12) {
        this.tail.unshift({ ...this.pos });
        if (this.tail.length > 24) this.tail.pop();
      }

      // noise from scurrying
      if (!input.sneak) {
        this.noiseTimer -= dt;
        if (this.noiseTimer <= 0) {
          this.noiseTimer = CONFIG.SCURRY_NOISE_INTERVAL;
          this.emitNoise(this.pos, CONFIG.SCURRY_NOISE_RADIUS);
        }
      } else {
        this.noiseTimer = 0;
      }
    } else {
      this.squash *= Math.max(0, 1 - dt * 8);
    }

    // creaky boards squeak at any speed when you step onto them
    const tx = Math.floor(this.pos.x), ty = Math.floor(this.pos.y);
    if (tx !== this.lastTile.x || ty !== this.lastTile.y) {
      this.lastTile = { x: tx, y: ty };
      if (this.level.floor[ty]?.[tx] === '~' && this.rawAt(tx, ty) !== WALL) {
        this.emitNoise(this.pos, CONFIG.CREAK_NOISE_RADIUS);
        this.popups.push({ pos: { x: this.pos.x, y: this.pos.y - 0.4 }, text: 'creak!', t: 0, color: '#c9a06a' });
      }
      const room = this.roomAt(tx, ty);
      if (room >= 0) this.visitedRooms.add(room);
    }

    // mouse holes teleport on contact
    if (this.holeCooldown <= 0) {
      for (const [ch, hole] of this.level.holes) {
        if (this.pluggedHoles.has(ch)) continue;
        const c = center(hole.pos);
        if (dist(this.pos, c) < 0.4) {
          const pair = this.level.holes.get(hole.pair)!;
          if (this.pluggedHoles.has(hole.pair)) continue; // exit stuffed
          const out = center(pair.pos);
          // cat may follow through
          if (this.cat && this.cat.mode === 'chase' && dist(this.cat.pos, c) < 3) {
            this.cat.followT = CONFIG.CAT_HOLE_FOLLOW_DELAY;
            this.cat.followTo = { ...out };
          }
          this.pos = { ...out };
          this.tail = [];
          this.holeCooldown = CONFIG.HOLE_COOLDOWN;
          const room = this.roomAt(pair.pos.x, pair.pos.y);
          if (room >= 0) this.visitedRooms.add(room);
          break;
        }
      }
    }
  }

  private moveWithCollision(dx: number, dy: number) {
    const r = CONFIG.MOUSE_RADIUS;
    const tryAxis = (nx: number, ny: number): boolean => {
      const minX = Math.floor(nx - r), maxX = Math.floor(nx + r);
      const minY = Math.floor(ny - r), maxY = Math.floor(ny + r);
      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          if (!this.mousePassable(tx, ty)) return false;
        }
      }
      return true;
    };
    if (tryAxis(this.pos.x + dx, this.pos.y)) this.pos.x += dx;
    if (tryAxis(this.pos.x, this.pos.y + dy)) this.pos.y += dy;
  }

  emitNoise(pos: Vec, radius: number) {
    this.noises.push({ pos: { ...pos }, radius, t: 0 });
    for (const h of this.humans) {
      if (h.sentry || h.mode === 'chase') continue;
      if (dist(h.pos, pos) <= radius) {
        h.mode = 'investigate';
        h.target = { ...pos };
        h.path = this.pathTo(h.pos, pos, this.humanPassable);
        h.repathT = 0;
        this.popups.push({ pos: { x: h.pos.x, y: h.pos.y - 1 }, text: '?', t: 0, color: '#f5d76e' });
      }
    }
  }

  private updateClatter(dt: number) {
    for (const c of this.pendingClatter) {
      c.t -= dt;
      if (c.t <= 0) this.emitNoise(c.pos, CONFIG.CORK_NOISE_RADIUS);
    }
    this.pendingClatter = this.pendingClatter.filter((c) => c.t > 0);
  }

  // ---- humans --------------------------------------------------------------

  private pathTo(from: Vec, to: Vec, passable: (x: number, y: number) => boolean): Vec[] {
    const tiles = bfsPath(this.level.w, this.level.h, passable, from, to);
    return tiles ? tiles.map(center) : [];
  }

  private walkPath(e: { pos: Vec; path: Vec[]; angle: number; targetAngle: number; stepPhase: number }, speed: number, dt: number): boolean {
    // returns true when the path is finished
    let remaining = speed * dt;
    while (remaining > 0 && e.path.length) {
      const next = e.path[0];
      const d = dist(e.pos, next);
      if (d < 1e-4) {
        e.path.shift();
        continue;
      }
      const step = Math.min(d, remaining);
      e.pos.x += ((next.x - e.pos.x) / d) * step;
      e.pos.y += ((next.y - e.pos.y) / d) * step;
      e.targetAngle = Math.atan2(next.y - e.pos.y + 1e-9, next.x - e.pos.x);
      remaining -= step;
      if (dist(e.pos, next) < 0.05) e.path.shift();
    }
    e.stepPhase += speed * dt * 2.2;
    return e.path.length === 0;
  }

  private updateHuman(h: HumanState, dt: number) {
    h.flashT = Math.max(0, h.flashT - dt);

    if (h.sentry) {
      h.angle += CONFIG.SENTRY_ROT_SPEED * dt;
      return;
    }

    const turnLerp = Math.min(1, dt * 6);

    switch (h.mode) {
      case 'patrol': {
        if (!h.path.length) {
          h.wpIdx = (h.wpIdx + 1) % h.waypoints.length;
          h.path = this.pathTo(h.pos, h.waypoints[h.wpIdx], this.humanPassable);
          if (!h.path.length && h.waypoints.length > 1) h.wpIdx = (h.wpIdx + 1) % h.waypoints.length;
        }
        this.walkPath(h, h.baseSpeed, dt);
        break;
      }
      case 'investigate': {
        const done = this.walkPath(h, h.baseSpeed * 1.15, dt);
        if (done) {
          h.mode = 'scan';
          h.scanT = CONFIG.SCAN_TIME;
          h.scanBase = h.angle;
        }
        break;
      }
      case 'scan': {
        h.scanT -= dt;
        h.targetAngle = h.scanBase + Math.sin((CONFIG.SCAN_TIME - h.scanT) * 3.2) * 1.1;
        if (h.scanT <= 0) this.resumePatrol(h);
        break;
      }
      case 'suspicious': {
        if (h.path.length) {
          this.walkPath(h, h.baseSpeed * 1.2, dt);
        } else {
          h.pauseT -= dt;
          if (h.target) h.targetAngle = Math.atan2(h.target.y - h.pos.y, h.target.x - h.pos.x);
          if (h.pauseT <= 0) this.resumePatrol(h);
        }
        break;
      }
      case 'chase': {
        h.repathT -= dt;
        const goal = this.hidden || !h.seesMouse ? h.lastSeen : this.pos;
        if (goal && h.repathT <= 0) {
          h.repathT = CONFIG.CHASE_REPATH;
          h.path = this.pathTo(h.pos, goal, this.humanPassable);
        }
        this.walkPath(h, h.baseSpeed * CONFIG.CHASE_SPEED_MULT, dt);
        if (h.seesMouse) {
          h.memoryT = 0;
          h.lastSeen = { ...this.pos };
          h.targetAngle = Math.atan2(this.pos.y - h.pos.y, this.pos.x - h.pos.x);
        } else {
          h.memoryT += dt;
          if (h.memoryT >= CONFIG.CHASE_MEMORY) this.resumePatrol(h);
        }
        break;
      }
    }

    h.angle += angDiff(h.targetAngle, h.angle) * turnLerp;
  }

  private resumePatrol(h: HumanState) {
    h.mode = 'patrol';
    h.target = null;
    h.memoryT = 0;
    h.path = this.pathTo(h.pos, h.waypoints[h.wpIdx], this.humanPassable);
  }

  // ---- cat -------------------------------------------------------------------

  private updateCat(cat: CatState, dt: number) {
    // pending teleport through a mouse hole
    if (cat.followT >= 0) {
      cat.followT -= dt;
      if (cat.followT < 0 && cat.followTo) {
        cat.pos = { ...cat.followTo };
        cat.followTo = null;
        cat.path = [];
      }
    }

    const dToMouse = dist(cat.pos, this.pos);

    // crumb lure beats everything except an active chase right on top of you
    if (cat.mode !== 'eat') {
      const crumb = this.items.find((i) => i.type === 'crumb' && i.state === 'placed');
      if (crumb && dist(cat.pos, crumb.pos) <= CONFIG.CAT_LURE_RADIUS && cat.mode !== 'lured') {
        cat.mode = 'lured';
        cat.lureItem = crumb;
        cat.path = this.pathTo(cat.pos, crumb.pos, this.catPassable);
      }
    }

    switch (cat.mode) {
      case 'wander': {
        if (!this.hidden && dToMouse <= CONFIG.CAT_DETECT_RADIUS) {
          cat.mode = 'chase';
          cat.giveupT = 0;
          this.popups.push({ pos: { x: cat.pos.x, y: cat.pos.y - 0.8 }, text: '!', t: 0, color: '#f08c3a' });
          break;
        }
        cat.wanderT -= dt;
        if (!cat.path.length && cat.wanderT <= 0) {
          cat.wanderT = 1.5 + Math.random() * 2.5;
          const tx = Math.floor(cat.pos.x) + Math.floor(Math.random() * 9) - 4;
          const ty = Math.floor(cat.pos.y) + Math.floor(Math.random() * 9) - 4;
          if (this.catPassable(tx, ty)) {
            cat.path = this.pathTo(cat.pos, { x: tx + 0.5, y: ty + 0.5 }, this.catPassable);
          }
        }
        this.walkPath(cat, CONFIG.CAT_SPEED, dt);
        break;
      }
      case 'chase': {
        cat.repathT -= dt;
        if (cat.repathT <= 0) {
          cat.repathT = CONFIG.CAT_REPATH;
          cat.path = this.pathTo(cat.pos, this.pos, this.catPassable);
        }
        this.walkPath(cat, CONFIG.CAT_CHASE_SPEED, dt);
        if (this.hidden || dToMouse > CONFIG.CAT_GIVEUP_DIST) {
          cat.giveupT += dt;
          if (cat.giveupT >= CONFIG.CAT_GIVEUP_TIME) {
            cat.mode = 'wander';
            cat.path = [];
          }
        } else {
          cat.giveupT = 0;
        }
        if (!this.hidden && dToMouse < CONFIG.CAT_CONTACT_R) this.capture('cat');
        break;
      }
      case 'lured': {
        const done = this.walkPath(cat, CONFIG.CAT_CHASE_SPEED * 0.8, dt);
        const crumb = cat.lureItem;
        if (!crumb || crumb.state !== 'placed') {
          cat.mode = 'wander';
          break;
        }
        if (done || dist(cat.pos, crumb.pos) < 0.6) {
          cat.mode = 'eat';
          cat.eatT = CONFIG.CAT_EAT_TIME;
        }
        break;
      }
      case 'eat': {
        cat.eatT -= dt;
        if (cat.eatT <= 0) {
          if (cat.lureItem) cat.lureItem.state = 'gone';
          cat.lureItem = null;
          cat.mode = 'wander';
        }
        break;
      }
    }

    cat.angle += angDiff(cat.targetAngle, cat.angle) * Math.min(1, dt * 6);
  }

  // ---- detection / capture ------------------------------------------------

  private mouseInCone(h: HumanState): boolean {
    if (this.hidden) return false;
    const d = dist(h.pos, this.pos);
    const range = this.visionRange(h);
    if (d > range) return false;
    const ang = Math.atan2(this.pos.y - h.pos.y, this.pos.x - h.pos.x);
    if (Math.abs(angDiff(ang, h.angle)) > CONFIG.VISION_ARC / 2) return false;
    return hasLOS(h.pos, this.pos, this.blocksVision);
  }

  private updateDetection(dt: number) {
    this.eyeMeter = 0;
    for (const h of this.humans) {
      const sees = this.mouseInCone(h);
      h.seesMouse = sees;
      if (sees) {
        h.outT = 0;
        h.eye += dt;
        h.lastSeen = { ...this.pos };
        if (h.mode !== 'chase' && !h.sentry) {
          h.mode = 'chase';
          h.memoryT = 0;
          h.repathT = 0;
          h.flashT = 0.6;
          this.stats.spotted++;
          this.popups.push({ pos: { x: h.pos.x, y: h.pos.y - 1.1 }, text: '!', t: 0, color: '#e05a4e' });
        } else if (h.sentry && h.eye > 0.01 && h.flashT <= 0) {
          h.flashT = 0.6;
          this.stats.spotted++;
          this.popups.push({ pos: { x: h.pos.x, y: h.pos.y - 1.1 }, text: '!', t: 0, color: '#e05a4e' });
        }
        if (h.eye >= CONFIG.EYE_CAPTURE_TIME) {
          this.capture('seen');
          return;
        }
      } else {
        h.outT += dt;
        if (h.outT > CONFIG.EYE_DECAY_GRACE) {
          h.eye = Math.max(0, h.eye - CONFIG.EYE_DECAY_RATE * dt);
        }
      }
      if (!this.hidden && !h.sentry && dist(h.pos, this.pos) < CONFIG.HUMAN_CONTACT_R) {
        this.capture('bumped');
        return;
      }
      this.eyeMeter = Math.max(this.eyeMeter, h.eye / CONFIG.EYE_CAPTURE_TIME);
    }
  }

  capture(_reason: 'seen' | 'bumped' | 'cat') {
    if (this.phase !== 'play') return;
    this.phase = 'caught';
    this.wipeT = 0;
    this.nibbleT = 0;
    this.hidden = false;

    // reset positions
    this.pos = center(this.level.spawn);
    this.tail = [];
    this.lastTile = { ...this.level.spawn };
    this.holeCooldown = 0;
    for (const h of this.humans) {
      h.pos = { ...h.waypoints[0] };
      h.wpIdx = 0;
      h.mode = 'patrol';
      h.path = [];
      h.eye = 0;
      h.outT = 99;
      h.seesMouse = false;
      h.memoryT = 0;
    }
    if (this.cat && this.level.catSpawn) {
      this.cat.pos = center(this.level.catSpawn);
      this.cat.mode = 'wander';
      this.cat.path = [];
      this.cat.followT = -1;
      this.cat.followTo = null;
    }

    // capture penalty: later levels lose carried/placed items
    if (this.levelIndex + 1 > CONFIG.KEEP_ITEMS_THROUGH_LEVEL) {
      for (const it of this.items) {
        if (it.state === 'held' || it.state === 'placed') {
          it.state = 'world';
          it.pos = { ...it.spawnPos };
        }
      }
      this.inventory = [];
      this.pluggedHoles.clear();
    }
  }

  // ---- actions --------------------------------------------------------------

  private computeContext(): ActionContext {
    const cheese = center(this.level.cheese);
    if (dist(this.pos, cheese) <= CONFIG.NIBBLE_RANGE) {
      return { label: 'Nibble', kind: 'nibble' };
    }

    // doors/windows within reach
    for (const b of this.level.barriers) {
      for (const t of b.tiles) {
        if (dist(this.pos, center(t)) > CONFIG.USE_RANGE) continue;
        if (b.def.type === 'door' && !this.unlockedDoors.has(b.ch)) {
          const color = b.def.color;
          const key = this.inventory.find((i) => i.type === 'key' && i.color === color);
          if (key) return { label: 'Unlock', kind: 'unlock', item: key, barrier: b };
        }
        if (b.def.type === 'window' && b.def.mode === 'spool' && !this.climbedWindows.has(b.ch)) {
          const spool = this.inventory.find((i) => i.type === 'spool');
          if (spool) return { label: 'Climb', kind: 'climb', item: spool, barrier: b };
        }
      }
    }

    // plug a hole with a cork
    const cork = this.inventory.find((i) => i.type === 'cork');
    if (cork) {
      for (const [ch, hole] of this.level.holes) {
        if (this.pluggedHoles.has(ch)) continue;
        const d = dist(this.pos, center(hole.pos));
        if (d <= CONFIG.USE_RANGE && d > 0.45) {
          return { label: 'Plug', kind: 'plug', item: cork, holeCh: ch };
        }
      }
    }

    // gnaw a lamp cord
    for (const it of this.items) {
      if (it.type === 'cord' && it.state === 'world' && dist(this.pos, it.pos) <= CONFIG.USE_RANGE) {
        return { label: 'Gnaw', kind: 'gnaw', item: it };
      }
    }

    // grab the nearest item
    let best: ItemInstance | undefined;
    let bestD = CONFIG.GRAB_RANGE;
    for (const it of this.items) {
      if (it.type === 'cord' || (it.state !== 'world' && it.state !== 'placed')) continue;
      const d = dist(this.pos, it.pos);
      if (d <= bestD) {
        bestD = d;
        best = it;
      }
    }
    if (best) return { label: 'Grab', kind: 'grab', item: best };

    // hide under furniture
    if (this.rawAt(Math.floor(this.pos.x), Math.floor(this.pos.y)) === HIDE) {
      return this.hidden ? { label: 'Peek', kind: 'peek' } : { label: 'Hide', kind: 'hide' };
    }

    // drop the selected cork/crumb
    const sel = this.inventory[this.selectedSlot];
    if (sel && (sel.type === 'cork' || sel.type === 'crumb')) {
      return { label: 'Drop', kind: 'drop', item: sel };
    }

    return { label: '···', kind: 'none' };
  }

  private removeFromInventory(item: ItemInstance) {
    this.inventory = this.inventory.filter((i) => i !== item);
  }

  private performAction(ctx: ActionContext) {
    switch (ctx.kind) {
      case 'unlock': {
        this.unlockedDoors.add(ctx.barrier!.ch);
        ctx.item!.state = 'gone';
        this.removeFromInventory(ctx.item!);
        this.stats.itemsUsed++;
        const t = ctx.barrier!.tiles[0];
        this.popups.push({ pos: { x: t.x + 0.5, y: t.y - 0.2 }, text: 'click!', t: 0, color: '#9fd89f' });
        break;
      }
      case 'climb': {
        const b = ctx.barrier!;
        this.climbedWindows.add(b.ch);
        ctx.item!.state = 'gone';
        this.removeFromInventory(ctx.item!);
        this.stats.itemsUsed++;
        // hop to the far side of the window
        const t = b.tiles[0];
        const c = center(t);
        const dx = Math.sign(c.x - this.pos.x), dy = Math.sign(c.y - this.pos.y);
        const far = { x: c.x + dx * 0.9, y: c.y + dy * 0.9 };
        if (this.mousePassable(Math.floor(far.x), Math.floor(far.y))) {
          this.pos = far;
          this.tail = [];
        }
        const room = this.roomAt(Math.floor(this.pos.x), Math.floor(this.pos.y));
        if (room >= 0) this.visitedRooms.add(room);
        break;
      }
      case 'plug': {
        this.pluggedHoles.add(ctx.holeCh!);
        ctx.item!.state = 'gone';
        this.removeFromInventory(ctx.item!);
        this.stats.itemsUsed++;
        break;
      }
      case 'gnaw': {
        const room = this.roomAt(Math.floor(ctx.item!.pos.x), Math.floor(ctx.item!.pos.y));
        if (room >= 0) this.gnawedRooms.add(room);
        ctx.item!.state = 'gone';
        this.stats.itemsUsed++;
        this.popups.push({ pos: { ...ctx.item!.pos }, text: 'lights out!', t: 0, color: '#b8a5e0' });
        break;
      }
      case 'grab': {
        const it = ctx.item!;
        it.state = 'held';
        this.inventory.push(it);
        if (this.inventory.length > CONFIG.INVENTORY_SIZE) {
          const oldest = this.inventory.shift()!;
          oldest.state = 'world';
          oldest.pos = { x: Math.floor(this.pos.x) + 0.5, y: Math.floor(this.pos.y) + 0.5 };
          this.popups.push({ pos: { ...oldest.pos }, text: 'swapped', t: 0, color: '#cccccc' });
        }
        break;
      }
      case 'hide':
        this.hidden = true;
        break;
      case 'peek':
        this.hidden = false;
        break;
      case 'drop': {
        const it = ctx.item!;
        it.state = 'placed';
        it.pos = { x: this.pos.x, y: this.pos.y };
        this.removeFromInventory(it);
        this.stats.itemsUsed++;
        if (it.type === 'cork') {
          this.pendingClatter.push({ pos: { ...it.pos }, t: CONFIG.CORK_CLATTER_DELAY });
        }
        break;
      }
      case 'nibble':
      case 'none':
        break;
    }
  }

  private updateNibble(dt: number, input: GameInput) {
    const chased = this.humans.some((h) => h.mode === 'chase');
    if (this.context.kind === 'nibble' && input.actionHeld && !chased) {
      this.nibbleT += dt;
      if (this.nibbleT >= CONFIG.NIBBLE_TIME) this.win();
    } else {
      this.nibbleT = 0;
    }
  }

  private win() {
    this.phase = 'won';
    this.wonT = 0;
    const c = center(this.level.cheese);
    const colors = ['#f5d76e', '#e05a4e', '#4a90d9', '#57a05a', '#e8875a', '#b8a5e0'];
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      this.particles.push({
        pos: { ...c },
        vel: { x: Math.cos(a) * sp, y: Math.sin(a) * sp - 3 },
        t: 0,
        life: 1.2 + Math.random() * 1.2,
        color: colors[i % colors.length],
        size: 0.08 + Math.random() * 0.1,
      });
    }
  }

  stars(): number {
    if (this.stats.spotted === 0) return 3;
    if (this.stats.spotted <= 2) return 2;
    return 1;
  }

  // camera follows with lookahead; clamped to the map given a viewport size
  updateCamera(dt: number, viewW: number, viewH: number) {
    const lookX = this.moving ? Math.cos(this.facing) * CONFIG.CAMERA_LOOKAHEAD : 0;
    const lookY = this.moving ? Math.sin(this.facing) * CONFIG.CAMERA_LOOKAHEAD : 0;
    const tx = this.pos.x + lookX;
    const ty = this.pos.y + lookY;
    const k = Math.min(1, dt * CONFIG.CAMERA_LERP);
    this.camera.x += (tx - this.camera.x) * k;
    this.camera.y += (ty - this.camera.y) * k;
    const hw = viewW / 2, hh = viewH / 2;
    if (viewW < this.level.w) {
      this.camera.x = Math.max(hw, Math.min(this.level.w - hw, this.camera.x));
    } else {
      this.camera.x = this.level.w / 2;
    }
    if (viewH < this.level.h) {
      this.camera.y = Math.max(hh, Math.min(this.level.h - hh, this.camera.y));
    } else {
      this.camera.y = this.level.h / 2;
    }
  }
}
