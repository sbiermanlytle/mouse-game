// All drawing. World rendering happens inside a camera transform (1 unit =
// 1 tile); HUD and text render in screen space.

import { CONFIG } from './config.ts';
import {
  DOOR_COLORS, WALL, VOID, FURN, HIDE, castRay, isBarrierChar,
  type Vec,
} from './engine.ts';
import type { Game, HumanState, CatState } from './game.ts';
import type { HudLayout, InputManager } from './input.ts';

export interface View {
  w: number; // canvas CSS px
  h: number;
  ts: number; // tile size in px after scaling
}

export function computeView(w: number, h: number): View {
  const scale = Math.min(w / (CONFIG.VIEW_TILES_X * CONFIG.TILE), h / (CONFIG.VIEW_TILES_Y * CONFIG.TILE));
  return { w, h, ts: CONFIG.TILE * scale };
}

const PAL = {
  bg: '#1c1a20',
  wall: '#3b3230',
  wallEdge: '#57493f',
  grass: '#8aa86b',
  grassDot: '#7a985c',
  path: '#c9b490',
  pathDot: '#b8a37e',
  wood: '#c09a6a',
  woodLine: '#ab875a',
  crack: '#7d5c36',
  kitchenA: '#e8e0cc',
  kitchenB: '#cfc5a8',
  rug: '#b0614d',
  rugIn: '#c07a5f',
  bedroom: '#a08fb5',
  bedroomIn: '#ab9cbe',
  stone: '#b7b3ac',
  stoneLine: '#a19d95',
  furn: '#8a6a4a',
  furnTop: '#9d7c58',
  couch: '#7a5a3f',
  couchCushion: '#8d6c4e',
  holeDark: '#241d18',
  mouse: '#9a9aa5',
  mouseDark: '#7e7e8a',
  earPink: '#d9a8a8',
  humanShirt: ['#5b7ea3', '#8a5b7e'],
  skin: '#e8c39a',
  hair: ['#4a3b2d', '#6e5138'],
  shoe: '#3b3230',
  cat: '#d98e4a',
  catDark: '#b8722f',
  cheese: '#f2c94c',
  cheeseHole: '#d9a83a',
  glass: '#a8cfe0',
  frame: '#e8e2d5',
  fog: 'rgba(22,18,28,0.90)',
  dark: 'rgba(14,14,38,0.52)',
};

function floorColors(c: string): [string, string] {
  switch (c) {
    case '.': return [PAL.grass, PAL.grassDot];
    case ',': return [PAL.path, PAL.pathDot];
    case '~':
    case '=': return [PAL.wood, PAL.woodLine];
    case '+': return [PAL.kitchenA, PAL.kitchenB];
    case '"': return [PAL.rug, PAL.rugIn];
    case '-': return [PAL.bedroom, PAL.bedroomIn];
    case '_': return [PAL.stone, PAL.stoneLine];
    default: return [PAL.wood, PAL.woodLine];
  }
}

function hash2(x: number, y: number): number {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

// ---- world ---------------------------------------------------------------

export function drawWorld(ctx: CanvasRenderingContext2D, game: Game, view: View, debug: boolean) {
  const { w, h, ts } = view;
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(ts, ts);
  ctx.translate(-game.camera.x, -game.camera.y);

  const x0 = Math.floor(game.camera.x - w / 2 / ts) - 1;
  const x1 = Math.ceil(game.camera.x + w / 2 / ts) + 1;
  const y0 = Math.floor(game.camera.y - h / 2 / ts) - 1;
  const y1 = Math.ceil(game.camera.y + h / 2 / ts) + 1;

  drawTiles(ctx, game, x0, y0, x1, y1);
  drawItems(ctx, game);
  drawCheese(ctx, game);
  for (const hu of game.humans) drawCone(ctx, game, hu);
  if (game.cat) drawCat(ctx, game.cat, game);
  for (const hu of game.humans) drawHuman(ctx, hu, game);
  drawMouse(ctx, game);
  drawHideFurniture(ctx, game, x0, y0, x1, y1);
  drawFog(ctx, game, x0, y0, x1, y1);
  drawParticles(ctx, game);
  if (debug) drawDebug(ctx, game);
  ctx.restore();

  drawPopups(ctx, game, view);
}

function drawTiles(ctx: CanvasRenderingContext2D, game: Game, x0: number, y0: number, x1: number, y1: number) {
  const lv = game.level;
  for (let y = Math.max(0, y0); y <= Math.min(lv.h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(lv.w - 1, x1); x++) {
      const c = lv.raw[y][x];
      if (c === VOID) continue;
      if (c === WALL) {
        ctx.fillStyle = PAL.wall;
        ctx.fillRect(x, y, 1, 1);
        // soft top edge where floor sits above
        if (y > 0 && lv.raw[y - 1][x] !== WALL && lv.raw[y - 1][x] !== VOID) {
          ctx.fillStyle = PAL.wallEdge;
          ctx.fillRect(x, y, 1, 0.14);
        }
        continue;
      }

      drawFloor(ctx, game, x, y);

      if (c === FURN) drawSolidFurniture(ctx, lv.raw, x, y);
      else if (isBarrierChar(c)) drawBarrier(ctx, game, c, x, y);
    }
  }
  // mouse holes sit on top of their floor tile
  for (const [ch, hole] of lv.holes) {
    ctx.fillStyle = PAL.holeDark;
    ctx.beginPath();
    ctx.ellipse(hole.pos.x + 0.5, hole.pos.y + 0.5, 0.3, 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PAL.wall;
    ctx.lineWidth = 0.06;
    ctx.stroke();
    if (game.pluggedHoles.has(ch)) {
      ctx.fillStyle = '#a4713f';
      ctx.beginPath();
      ctx.ellipse(hole.pos.x + 0.5, hole.pos.y + 0.5, 0.2, 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawFloor(ctx: CanvasRenderingContext2D, game: Game, x: number, y: number) {
  const f = game.level.floor[y][x];
  const [base, accent] = floorColors(f);
  ctx.fillStyle = base;
  ctx.fillRect(x, y, 1, 1);
  switch (f) {
    case '.':
      ctx.fillStyle = accent;
      if (hash2(x, y) > 0.5) ctx.fillRect(x + hash2(x, y * 3) * 0.7 + 0.1, y + hash2(x * 7, y) * 0.7 + 0.1, 0.12, 0.12);
      break;
    case ',':
      ctx.fillStyle = accent;
      ctx.fillRect(x + 0.15 + hash2(x, y) * 0.4, y + 0.2 + hash2(y, x) * 0.4, 0.16, 0.12);
      break;
    case '=':
    case '~':
      ctx.fillStyle = accent;
      ctx.fillRect(x, y + 0.94, 1, 0.06);
      if ((x + (y % 2)) % 2 === 0) ctx.fillRect(x + 0.94, y, 0.06, 1);
      if (f === '~') {
        ctx.strokeStyle = PAL.crack;
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.moveTo(x + 0.2, y + 0.3);
        ctx.lineTo(x + 0.55, y + 0.5);
        ctx.lineTo(x + 0.4, y + 0.75);
        ctx.moveTo(x + 0.6, y + 0.25);
        ctx.lineTo(x + 0.8, y + 0.6);
        ctx.stroke();
      }
      break;
    case '+':
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = accent;
        ctx.fillRect(x, y, 1, 1);
      }
      break;
    case '"':
      ctx.fillStyle = accent;
      ctx.fillRect(x + 0.08, y + 0.08, 0.84, 0.84);
      break;
    case '-':
      ctx.fillStyle = accent;
      if ((x + y) % 2 === 0) ctx.fillRect(x + 0.3, y + 0.3, 0.4, 0.4);
      break;
    case '_':
      ctx.strokeStyle = accent;
      ctx.lineWidth = 0.04;
      ctx.strokeRect(x + 0.04, y + 0.04, 0.92, 0.92);
      break;
  }
}

function drawSolidFurniture(ctx: CanvasRenderingContext2D, raw: string[][], x: number, y: number) {
  // merge adjacent furniture visually by skipping inner edges
  ctx.fillStyle = PAL.furn;
  ctx.fillRect(x + 0.06, y + 0.06, 0.88, 0.88);
  ctx.fillStyle = PAL.furnTop;
  ctx.fillRect(x + 0.14, y + 0.14, 0.72, 0.72);
  void raw;
}

function drawHideFurniture(ctx: CanvasRenderingContext2D, game: Game, x0: number, y0: number, x1: number, y1: number) {
  const lv = game.level;
  for (let y = Math.max(0, y0); y <= Math.min(lv.h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(lv.w - 1, x1); x++) {
      if (lv.raw[y][x] !== HIDE) continue;
      // shadow under the couch, then the couch body on top of the mouse
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x + 0.04, y + 0.55, 0.92, 0.42);
      ctx.fillStyle = PAL.couch;
      ctx.fillRect(x + 0.02, y + 0.02, 0.96, 0.6);
      ctx.fillStyle = PAL.couchCushion;
      ctx.fillRect(x + 0.1, y + 0.1, 0.36, 0.44);
      ctx.fillRect(x + 0.54, y + 0.1, 0.36, 0.44);
      // peeking eyes when the mouse hides here
      const mx = Math.floor(game.pos.x), my = Math.floor(game.pos.y);
      if (game.hidden && mx === x && my === y) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x + 0.42, y + 0.78, 0.05, 0, Math.PI * 2);
        ctx.arc(x + 0.58, y + 0.78, 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawBarrier(ctx: CanvasRenderingContext2D, game: Game, ch: string, x: number, y: number) {
  const b = game.barrierByChar(ch)!;
  const horizontal = game.rawAt(x - 1, y) === WALL || game.rawAt(x + 1, y) === WALL || isBarrierChar(game.rawAt(x - 1, y)) || isBarrierChar(game.rawAt(x + 1, y));
  if (b.def.type === 'door') {
    const open = game.unlockedDoors.has(ch);
    const col = DOOR_COLORS[b.def.color];
    if (open) {
      // open door: thin swung panel at the edge
      ctx.fillStyle = col;
      if (horizontal) ctx.fillRect(x, y + 0.05, 0.18, 0.9);
      else ctx.fillRect(x + 0.05, y, 0.9, 0.18);
    } else {
      ctx.fillStyle = col;
      if (horizontal) ctx.fillRect(x + 0.02, y + 0.16, 0.96, 0.68);
      else ctx.fillRect(x + 0.16, y + 0.02, 0.68, 0.96);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(x + 0.5, y + 0.5, 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x + 0.46, y + 0.5, 0.08, 0.18);
    }
  } else {
    const open = game.isWindowOpen(b);
    ctx.fillStyle = PAL.frame;
    if (horizontal) ctx.fillRect(x, y + 0.18, 1, 0.64);
    else ctx.fillRect(x + 0.18, y, 0.64, 1);
    if (open) {
      ctx.fillStyle = PAL.holeDark;
      if (horizontal) ctx.fillRect(x + 0.08, y + 0.3, 0.84, 0.4);
      else ctx.fillRect(x + 0.3, y + 0.08, 0.4, 0.84);
    } else {
      ctx.fillStyle = PAL.glass;
      if (horizontal) {
        ctx.fillRect(x + 0.08, y + 0.28, 0.38, 0.44);
        ctx.fillRect(x + 0.54, y + 0.28, 0.38, 0.44);
      } else {
        ctx.fillRect(x + 0.28, y + 0.08, 0.44, 0.38);
        ctx.fillRect(x + 0.28, y + 0.54, 0.44, 0.38);
      }
      if (b.def.mode === 'spool') {
        // hint: needs the spool
        ctx.strokeStyle = '#c95f6e';
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.arc(x + 0.5, y + 0.5, 0.16, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

// ---- items / cheese --------------------------------------------------------

export function drawItemIcon(ctx: CanvasRenderingContext2D, type: string, color: string | undefined, x: number, y: number, s: number) {
  // draws centered at x,y with radius ~s (works in world or screen units)
  switch (type) {
    case 'key': {
      ctx.strokeStyle = color ?? '#ccc';
      ctx.fillStyle = color ?? '#ccc';
      ctx.lineWidth = s * 0.28;
      ctx.beginPath();
      ctx.arc(x - s * 0.35, y, s * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.02, y);
      ctx.lineTo(x + s * 0.85, y);
      ctx.stroke();
      ctx.fillRect(x + s * 0.45, y, s * 0.16, s * 0.4);
      ctx.fillRect(x + s * 0.72, y, s * 0.16, s * 0.34);
      break;
    }
    case 'cork':
      ctx.fillStyle = '#a4713f';
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.55, s * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7d5430';
      ctx.lineWidth = s * 0.12;
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.35, s * 0.5, s * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'crumb':
      ctx.fillStyle = PAL.cheese;
      ctx.beginPath();
      ctx.arc(x - s * 0.2, y, s * 0.35, 0, Math.PI * 2);
      ctx.arc(x + s * 0.3, y + s * 0.2, s * 0.22, 0, Math.PI * 2);
      ctx.arc(x + s * 0.15, y - s * 0.3, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'spool':
      ctx.fillStyle = '#c95f6e';
      ctx.fillRect(x - s * 0.4, y - s * 0.5, s * 0.8, s);
      ctx.fillStyle = '#e8e2d5';
      ctx.fillRect(x - s * 0.55, y - s * 0.68, s * 1.1, s * 0.2);
      ctx.fillRect(x - s * 0.55, y + s * 0.48, s * 1.1, s * 0.2);
      ctx.strokeStyle = '#a84a58';
      ctx.lineWidth = s * 0.1;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(x - s * 0.4, y + i * s * 0.22);
        ctx.lineTo(x + s * 0.4, y + i * s * 0.22);
        ctx.stroke();
      }
      break;
    case 'cord':
      ctx.strokeStyle = '#888';
      ctx.lineWidth = s * 0.18;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.7, y + s * 0.5);
      ctx.quadraticCurveTo(x - s * 0.1, y - s * 0.6, x + s * 0.3, y);
      ctx.quadraticCurveTo(x + s * 0.6, y + s * 0.4, x + s * 0.8, y - s * 0.3);
      ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.fillRect(x - s * 0.95, y + s * 0.3, s * 0.4, s * 0.4);
      break;
  }
}

function drawItems(ctx: CanvasRenderingContext2D, game: Game) {
  for (const it of game.items) {
    if (it.state !== 'world' && it.state !== 'placed') continue;
    const room = game.roomAt(Math.floor(it.pos.x), Math.floor(it.pos.y));
    if (room >= 0 && !game.visitedRooms.has(room)) continue; // hidden by fog anyway
    const bob = Math.sin(game.time * 3 + it.id * 1.7) * 0.06;
    const pulse = 0.55 + Math.sin(game.time * 2.4 + it.id) * 0.2;
    ctx.save();
    ctx.globalAlpha = pulse * 0.45;
    ctx.fillStyle = '#fff8d0';
    ctx.beginPath();
    ctx.arc(it.pos.x, it.pos.y + bob, 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawItemIcon(ctx, it.type, it.color ? DOOR_COLORS[it.color] : undefined, it.pos.x, it.pos.y + bob, 0.26);
  }
}

function drawCheese(ctx: CanvasRenderingContext2D, game: Game) {
  if (game.phase === 'won') return;
  const c = { x: game.level.cheese.x + 0.5, y: game.level.cheese.y + 0.5 };
  const bob = Math.sin(game.time * 2.2) * 0.05;
  const pulse = 0.5 + Math.sin(game.time * 2) * 0.25;
  ctx.save();
  ctx.globalAlpha = pulse * 0.5;
  ctx.fillStyle = '#fff3b0';
  ctx.beginPath();
  ctx.arc(c.x, c.y + bob, 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(c.x, c.y + bob);
  ctx.fillStyle = PAL.cheese;
  ctx.beginPath();
  ctx.moveTo(-0.38, 0.26);
  ctx.lineTo(0.38, 0.26);
  ctx.lineTo(0.3, -0.14);
  ctx.quadraticCurveTo(0, -0.34, -0.32, -0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PAL.cheeseHole;
  ctx.beginPath();
  ctx.arc(-0.1, 0.06, 0.07, 0, Math.PI * 2);
  ctx.arc(0.14, 0.12, 0.05, 0, Math.PI * 2);
  ctx.arc(0.02, -0.12, 0.04, 0, Math.PI * 2);
  ctx.fill();
  // nibble progress ring
  if (game.nibbleT > 0) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.arc(0, 0, 0.55, -Math.PI / 2, -Math.PI / 2 + (game.nibbleT / CONFIG.NIBBLE_TIME) * Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- characters -------------------------------------------------------------

function drawCone(ctx: CanvasRenderingContext2D, game: Game, h: HumanState) {
  const range = game.visionRange(h);
  const n = CONFIG.VISION_RAYS;
  const chase = h.mode === 'chase' || h.flashT > 0;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(h.pos.x, h.pos.y);
  for (let i = 0; i <= n; i++) {
    const a = h.angle - CONFIG.VISION_ARC / 2 + (CONFIG.VISION_ARC * i) / n;
    const d = castRay(h.pos, a, range, game.blocksVision);
    ctx.lineTo(h.pos.x + Math.cos(a) * d, h.pos.y + Math.sin(a) * d);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(h.pos.x, h.pos.y, 0.2, h.pos.x, h.pos.y, range);
  if (chase) {
    g.addColorStop(0, 'rgba(235,90,70,0.4)');
    g.addColorStop(1, 'rgba(235,90,70,0.08)');
  } else {
    g.addColorStop(0, 'rgba(255,222,110,0.34)');
    g.addColorStop(1, 'rgba(255,222,110,0.06)');
  }
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

function drawHuman(ctx: CanvasRenderingContext2D, h: HumanState, game: Game) {
  ctx.save();
  ctx.translate(h.pos.x, h.pos.y);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0.06, 0.1, 0.42, 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(h.angle);
  const step = Math.sin(h.stepPhase) * 0.16;
  ctx.fillStyle = PAL.shoe;
  ctx.beginPath();
  ctx.ellipse(0.28 + step, -0.16, 0.16, 0.1, 0, 0, Math.PI * 2);
  ctx.ellipse(0.28 - step, 0.16, 0.16, 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.humanShirt[h.idx % PAL.humanShirt.length];
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.42, 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.skin;
  ctx.beginPath();
  ctx.arc(0.1, 0, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.hair[h.idx % PAL.hair.length];
  ctx.beginPath();
  ctx.arc(0.02, 0, 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  void game;
}

function drawCat(ctx: CanvasRenderingContext2D, cat: CatState, game: Game) {
  const room = game.roomAt(Math.floor(cat.pos.x), Math.floor(cat.pos.y));
  if (room >= 0 && !game.visitedRooms.has(room)) return;
  ctx.save();
  ctx.translate(cat.pos.x, cat.pos.y);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(0.04, 0.08, 0.32, 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(cat.angle);
  // tail
  ctx.strokeStyle = PAL.cat;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(-0.3, 0);
  const wag = Math.sin(game.time * (cat.mode === 'chase' ? 14 : 4)) * 0.2;
  ctx.quadraticCurveTo(-0.55, wag, -0.68, wag - 0.14);
  ctx.stroke();
  ctx.fillStyle = PAL.cat;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.32, 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.catDark;
  ctx.fillRect(-0.14, -0.16, 0.08, 0.32);
  ctx.fillRect(0.02, -0.18, 0.08, 0.36);
  // head + ears
  ctx.fillStyle = PAL.cat;
  ctx.beginPath();
  ctx.arc(0.3, 0, 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.36, -0.14);
  ctx.lineTo(0.48, -0.26);
  ctx.lineTo(0.44, -0.08);
  ctx.moveTo(0.36, 0.14);
  ctx.lineTo(0.48, 0.26);
  ctx.lineTo(0.44, 0.08);
  ctx.fill();
  // eyes
  ctx.fillStyle = cat.mode === 'chase' ? '#ffec8a' : '#7fc46b';
  ctx.beginPath();
  ctx.arc(0.38, -0.06, 0.035, 0, Math.PI * 2);
  ctx.arc(0.38, 0.06, 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (cat.mode === 'eat') {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(cat.pos.x + 0.4, cat.pos.y - 0.5, 0.05 + (game.time % 0.6) * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMouse(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.save();
  if (game.hidden) ctx.globalAlpha = 0.4;

  // tail from position history
  ctx.strokeStyle = PAL.mouseDark;
  ctx.lineCap = 'round';
  const pts = [game.pos, game.tail[5], game.tail[11], game.tail[17]].filter(Boolean) as Vec[];
  for (let i = 1; i < pts.length; i++) {
    ctx.lineWidth = 0.09 - i * 0.02;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  ctx.translate(game.pos.x, game.pos.y);
  ctx.rotate(game.facing);
  const sq = game.squash;
  ctx.scale(1 - sq * 0.4, 1 + sq * 0.5);
  // body
  ctx.fillStyle = PAL.mouse;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.28, 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // ears
  ctx.fillStyle = PAL.mouse;
  ctx.beginPath();
  ctx.arc(0.1, -0.16, 0.1, 0, Math.PI * 2);
  ctx.arc(0.1, 0.16, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.earPink;
  ctx.beginPath();
  ctx.arc(0.1, -0.16, 0.05, 0, Math.PI * 2);
  ctx.arc(0.1, 0.16, 0.05, 0, Math.PI * 2);
  ctx.fill();
  // nose + eyes
  ctx.fillStyle = '#4a4a52';
  ctx.beginPath();
  ctx.arc(0.3, 0, 0.045, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#26262c';
  ctx.beginPath();
  ctx.arc(0.18, -0.07, 0.035, 0, Math.PI * 2);
  ctx.arc(0.18, 0.07, 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // eye meter (detection grace period)
  if (game.eyeMeter > 0.02 && game.phase === 'play') {
    const p = game.eyeMeter;
    ctx.save();
    ctx.translate(game.pos.x, game.pos.y - 0.65);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.arc(0, 0, 0.24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = p > 0.66 ? '#e05a4e' : '#f5d76e';
    ctx.beginPath();
    ctx.arc(0, 0, 0.24, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ---- fog / particles / popups ------------------------------------------------

function drawFog(ctx: CanvasRenderingContext2D, game: Game, x0: number, y0: number, x1: number, y1: number) {
  const lv = game.level;
  for (let y = Math.max(0, y0); y <= Math.min(lv.h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(lv.w - 1, x1); x++) {
      const room = lv.rooms[y][x];
      if (room >= 0) {
        if (!game.visitedRooms.has(room)) {
          ctx.fillStyle = PAL.fog;
          ctx.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
        } else if (game.isRoomDarkNow(room)) {
          ctx.fillStyle = PAL.dark;
          ctx.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
        }
      } else if (isBarrierChar(lv.raw[y][x])) {
        // barrier tiles: fogged unless a neighbouring room is explored
        const explored = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const r = lv.rooms[y + dy!]?.[x + dx!];
          return r !== undefined && r >= 0 && game.visitedRooms.has(r);
        });
        if (!explored) {
          ctx.fillStyle = PAL.fog;
          ctx.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
        }
      }
    }
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, game: Game) {
  for (const p of game.particles) {
    ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.pos.x - p.size / 2, p.pos.y - p.size / 2, p.size, p.size * 1.6);
  }
  ctx.globalAlpha = 1;
}

function drawPopups(ctx: CanvasRenderingContext2D, game: Game, view: View) {
  for (const p of game.popups) {
    const sx = (p.pos.x - game.camera.x) * view.ts + view.w / 2;
    const sy = (p.pos.y - game.camera.y - p.t * 0.6) * view.ts + view.h / 2;
    ctx.globalAlpha = Math.max(0, 1 - p.t / 1.4);
    ctx.font = `bold ${Math.round(view.ts * 0.5)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeText(p.text, sx, sy);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, sx, sy);
  }
  ctx.globalAlpha = 1;
}

function drawDebug(ctx: CanvasRenderingContext2D, game: Game) {
  // patrol waypoints + current paths
  ctx.font = '0.5px system-ui, sans-serif';
  for (const [ch, wp] of game.level.waypoints) {
    ctx.fillStyle = 'rgba(120,220,255,0.8)';
    ctx.beginPath();
    ctx.arc(wp.x + 0.5, wp.y + 0.5, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(ch, wp.x + 0.62, wp.y + 0.4);
  }
  for (const h of game.humans) {
    if (h.path.length) {
      ctx.strokeStyle = 'rgba(120,220,255,0.5)';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(h.pos.x, h.pos.y);
      for (const p of h.path) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    // LOS ray to mouse
    ctx.strokeStyle = h.seesMouse ? 'rgba(255,80,60,0.9)' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.moveTo(h.pos.x, h.pos.y);
    ctx.lineTo(game.pos.x, game.pos.y);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(h.mode, h.pos.x - 0.5, h.pos.y - 0.7);
  }
  // noise radii
  for (const n of game.noises) {
    ctx.strokeStyle = `rgba(255,200,80,${0.7 * (1 - n.t)})`;
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.arc(n.pos.x, n.pos.y, n.radius * Math.min(1, n.t * 3 + 0.2), 0, Math.PI * 2);
    ctx.stroke();
  }
  if (game.cat) {
    ctx.strokeStyle = 'rgba(240,140,60,0.6)';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(game.cat.pos.x, game.cat.pos.y, CONFIG.CAT_DETECT_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ---- HUD -----------------------------------------------------------------------

export function drawHud(ctx: CanvasRenderingContext2D, game: Game, view: View, layout: HudLayout, input: InputManager, levelName: string, totalCheese: number) {
  const { w } = view;

  // top bar: level name, time, spotted count
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 3;
  const t = game.stats.time;
  const timeStr = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const label = `${levelName}   ${timeStr}   👁 ${game.stats.spotted}   🧀 ${totalCheese}`;
  ctx.strokeText(label, w / 2, 24);
  ctx.fillText(label, w / 2, 24);

  // inventory slots
  for (const [i, s] of layout.slots.entries()) {
    const item = game.inventory[i];
    const selected = i === game.selectedSlot && !!item;
    ctx.fillStyle = 'rgba(20,18,26,0.7)';
    roundRect(ctx, s.x, s.y, s.w, s.h, 10);
    ctx.fill();
    ctx.strokeStyle = selected ? '#f5d76e' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = selected ? 3 : 1.5;
    roundRect(ctx, s.x, s.y, s.w, s.h, 10);
    ctx.stroke();
    if (item) {
      drawItemIcon(ctx, item.type, item.color ? DOOR_COLORS[item.color] : undefined, s.x + s.w / 2, s.y + s.h / 2, s.w * 0.28);
    }
  }

  // pause button
  const p = layout.pause;
  ctx.fillStyle = 'rgba(20,18,26,0.7)';
  roundRect(ctx, p.x, p.y, p.w, p.h, 10);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(p.x + p.w * 0.3, p.y + p.h * 0.25, p.w * 0.12, p.h * 0.5);
  ctx.fillRect(p.x + p.w * 0.58, p.y + p.h * 0.25, p.w * 0.12, p.h * 0.5);

  // action button
  const a = layout.action;
  const active = game.context.kind !== 'none';
  ctx.beginPath();
  ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
  ctx.fillStyle = active ? 'rgba(245,215,110,0.92)' : 'rgba(60,56,70,0.6)';
  ctx.fill();
  if (input.actionHeld && active) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  if (game.context.kind === 'nibble' && game.nibbleT > 0) {
    ctx.strokeStyle = '#e05a4e';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.r + 5, -Math.PI / 2, -Math.PI / 2 + (game.nibbleT / CONFIG.NIBBLE_TIME) * Math.PI * 2);
    ctx.stroke();
  }
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillStyle = active ? '#332c1a' : 'rgba(255,255,255,0.45)';
  ctx.fillText(game.context.label, a.x, a.y);

  // joystick
  if (input.joyPointer !== -1) {
    const o = input.joyOrigin;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(o.x, o.y, CONFIG.JOY_FULL, 0, Math.PI * 2);
    ctx.stroke();
    // sneak zone boundary
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.arc(o.x, o.y, CONFIG.JOY_FULL * CONFIG.JOY_SNEAK_FRAC, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const len = Math.hypot(input.joyVec.x, input.joyVec.y);
    const k = len > CONFIG.JOY_FULL ? CONFIG.JOY_FULL / len : 1;
    ctx.fillStyle = game.sneaking ? 'rgba(180,220,255,0.55)' : 'rgba(255,235,150,0.6)';
    ctx.beginPath();
    ctx.arc(o.x + input.joyVec.x * k, o.y + input.joyVec.y * k, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(game.sneaking ? 'sneak' : 'SCURRY!', o.x, o.y - CONFIG.JOY_FULL - 12);
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// capture screen wipe: black panel slides across, world resets underneath
export function drawWipe(ctx: CanvasRenderingContext2D, view: View, t: number) {
  const p = Math.min(1, Math.max(0, t / CONFIG.WIPE_TIME));
  const ease = (v: number) => v * v * (3 - 2 * v);
  const x = p < 0.5 ? -view.w + ease(p * 2) * view.w : ease((p - 0.5) * 2) * view.w;
  ctx.fillStyle = '#14121a';
  ctx.fillRect(x, 0, view.w, view.h);
  if (p > 0.2 && p < 0.8) {
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e05a4e';
    ctx.fillText('CAUGHT!', x + view.w / 2, view.h / 2);
    ctx.font = '500 14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('...tossed back outside', x + view.w / 2, view.h / 2 + 26);
  }
}
