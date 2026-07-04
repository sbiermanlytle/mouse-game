// Bootstrap, screens (menu / play / pause / level complete), progress
// persistence and the main loop.

import { CONFIG } from './config.ts';
import { LEVELS } from './levels.ts';
import { Game } from './game.ts';
import { InputManager, hudLayout, inRect, type Rect } from './input.ts';
import { computeView, drawWorld, drawHud, drawWipe, roundRect } from './render.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';

const input = new InputManager();
input.attach(canvas);

interface Progress { unlocked: number; stars: number[] }
const SAVE_KEY = 'cheese-heist-progress-v1';

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Progress;
      if (typeof p.unlocked === 'number' && Array.isArray(p.stars)) return p;
    }
  } catch { /* corrupted save -> start fresh */ }
  return { unlocked: 1, stars: [] };
}
function saveProgress(p: Progress) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(p));
  } catch { /* private mode etc. */ }
}

const progress = loadProgress();
let screen: 'menu' | 'game' = 'menu';
let overlay: 'none' | 'paused' | 'complete' = 'none';
let game: Game | null = null;
let levelIdx = 0;
let selectedSlot = 0;
let savedThisWin = false;

let cssW = 0, cssH = 0;
function resize() {
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  cssW = window.innerWidth;
  cssH = window.innerHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function startLevel(i: number) {
  levelIdx = i;
  game = new Game(LEVELS[i], i);
  screen = 'game';
  overlay = 'none';
  selectedSlot = 0;
  savedThisWin = false;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'game' && game?.phase === 'play') overlay = 'paused';
});

// ---- UI helpers -----------------------------------------------------------

interface Button extends Rect { id: string; label: string; sub?: string; disabled?: boolean }
let buttons: Button[] = [];

function drawButton(b: Button, accent = false) {
  ctx.fillStyle = b.disabled ? 'rgba(60,56,70,0.4)' : accent ? 'rgba(245,215,110,0.92)' : 'rgba(46,42,58,0.92)';
  roundRect(ctx, b.x, b.y, b.w, b.h, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, b.x, b.y, b.w, b.h, 12);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 16px system-ui, sans-serif';
  ctx.fillStyle = b.disabled ? 'rgba(255,255,255,0.35)' : accent ? '#332c1a' : '#f2eee6';
  ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 - (b.sub ? 8 : 0));
  if (b.sub) {
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillStyle = b.disabled ? 'rgba(255,255,255,0.25)' : accent ? 'rgba(51,44,26,0.7)' : 'rgba(255,255,255,0.55)';
    ctx.fillText(b.sub, b.x + b.w / 2, b.y + b.h / 2 + 12);
  }
}

function starsStr(n: number): string {
  return n > 0 ? '★'.repeat(n) + '☆'.repeat(3 - n) : '';
}

function wrapText(text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function panel(x: number, y: number, w: number, h: number) {
  ctx.fillStyle = 'rgba(26,23,34,0.95)';
  roundRect(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,215,110,0.4)';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 16);
  ctx.stroke();
}

// ---- screens ----------------------------------------------------------------

function drawMenu() {
  buttons = [];
  ctx.fillStyle = '#1c1a20';
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `800 ${Math.min(44, cssW * 0.1)}px system-ui, sans-serif`;
  ctx.fillStyle = '#f2c94c';
  ctx.fillText('🧀 Cheese Heist', cssW / 2, 64);
  ctx.font = '500 14px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('a sneaky mouse adventure', cssW / 2, 94);

  const bw = Math.min(340, cssW - 32);
  const bh = 52;
  const x = cssW / 2 - bw / 2;
  let y = 128;
  for (const [i, lv] of LEVELS.entries()) {
    const locked = i + 1 > progress.unlocked;
    const b: Button = {
      id: `level-${i}`,
      label: locked ? '🔒' : `${i + 1}. ${lv.name}`,
      sub: locked ? undefined : starsStr(progress.stars[i] ?? 0) || 'not cleared',
      x, y, w: bw, h: bh,
      disabled: locked,
    };
    buttons.push(b);
    drawButton(b);
    y += bh + 10;
  }
  ctx.font = '500 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('drag = move · small drag = sneak · big drag = scurry', cssW / 2, y + 14);
}

function drawHintOverlay() {
  ctx.fillStyle = 'rgba(14,12,20,0.72)';
  ctx.fillRect(0, 0, cssW, cssH);
  const w = Math.min(360, cssW - 28);
  ctx.font = '500 15px system-ui, sans-serif';
  const lines = wrapText(LEVELS[levelIdx].hint, w - 44);
  const h = 118 + lines.length * 21;
  const x = cssW / 2 - w / 2, y = cssH / 2 - h / 2;
  panel(x, y, w, h);
  ctx.textAlign = 'center';
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.fillStyle = '#f2c94c';
  ctx.fillText(`${levelIdx + 1}. ${LEVELS[levelIdx].name}`, cssW / 2, y + 36);
  ctx.font = '500 15px system-ui, sans-serif';
  ctx.fillStyle = '#e8e4da';
  lines.forEach((l, i) => ctx.fillText(l, cssW / 2, y + 70 + i * 21));
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(245,215,110,0.9)';
  ctx.fillText('▶ tap to start', cssW / 2, y + h - 28);
}

function drawPausedOverlay() {
  buttons = [];
  ctx.fillStyle = 'rgba(14,12,20,0.72)';
  ctx.fillRect(0, 0, cssW, cssH);
  const w = Math.min(300, cssW - 40), bh = 48;
  const x = cssW / 2 - w / 2;
  const h = 60 + 3 * (bh + 10) + 14;
  const y = cssH / 2 - h / 2;
  panel(x, y, w, h);
  ctx.textAlign = 'center';
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.fillStyle = '#f2eee6';
  ctx.fillText('Paused', cssW / 2, y + 34);
  const defs: [string, string][] = [['resume', 'Resume'], ['restart', 'Restart level'], ['menu', 'Back to menu']];
  defs.forEach(([id, label], i) => {
    const b: Button = { id, label, x: x + 20, y: y + 60 + i * (bh + 10), w: w - 40, h: bh };
    buttons.push(b);
    drawButton(b, id === 'resume');
  });
}

function drawCompleteOverlay(g: Game) {
  buttons = [];
  ctx.fillStyle = 'rgba(14,12,20,0.72)';
  ctx.fillRect(0, 0, cssW, cssH);
  const w = Math.min(320, cssW - 32), bh = 46;
  const hasNext = levelIdx + 1 < LEVELS.length;
  const h = 210 + (hasNext ? 3 : 2) * (bh + 10) + 10;
  const x = cssW / 2 - w / 2, y = cssH / 2 - h / 2;
  panel(x, y, w, h);
  ctx.textAlign = 'center';
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.fillStyle = '#f2c94c';
  ctx.fillText('Cheese secured!', cssW / 2, y + 38);
  ctx.font = '400 34px system-ui, sans-serif';
  ctx.fillStyle = '#f5d76e';
  ctx.fillText(starsStr(g.stars()), cssW / 2, y + 78);
  ctx.font = '500 15px system-ui, sans-serif';
  ctx.fillStyle = '#e8e4da';
  const t = g.stats.time;
  const timeStr = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  ctx.fillText(`time  ${timeStr}`, cssW / 2, y + 116);
  ctx.fillText(`spotted  ${g.stats.spotted} time${g.stats.spotted === 1 ? '' : 's'}`, cssW / 2, y + 140);
  ctx.fillText(`items used  ${g.stats.itemsUsed}`, cssW / 2, y + 164);
  if (g.stats.spotted > 0) {
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('3★ = never spotted', cssW / 2, y + 186);
  }
  let by = y + 204;
  if (hasNext) {
    buttons.push({ id: 'next', label: 'Next level', x: x + 20, y: by, w: w - 40, h: bh });
    by += bh + 10;
  }
  buttons.push({ id: 'restart', label: 'Replay', x: x + 20, y: by, w: w - 40, h: bh });
  by += bh + 10;
  buttons.push({ id: 'menu', label: 'Back to menu', x: x + 20, y: by, w: w - 40, h: bh });
  for (const b of buttons) drawButton(b, b.id === 'next');
}

// ---- input routing --------------------------------------------------------------

function handleTaps() {
  for (const tap of input.taps) {
    if (screen === 'menu') {
      for (const b of buttons) {
        if (!b.disabled && inRect(tap.x, tap.y, b) && b.id.startsWith('level-')) {
          startLevel(parseInt(b.id.split('-')[1], 10));
        }
      }
      continue;
    }
    if (!game) continue;
    if (game.phase === 'hint') {
      game.phase = 'play';
      continue;
    }
    if (overlay === 'paused' || overlay === 'complete') {
      for (const b of buttons) {
        if (b.disabled || !inRect(tap.x, tap.y, b)) continue;
        if (b.id === 'resume') overlay = 'none';
        else if (b.id === 'restart') startLevel(levelIdx);
        else if (b.id === 'next') startLevel(levelIdx + 1);
        else if (b.id === 'menu') {
          screen = 'menu';
          overlay = 'none';
          game = null;
        }
      }
      continue;
    }
    // in-game HUD taps
    if (inRect(tap.x, tap.y, input.layout.pause)) {
      overlay = 'paused';
      continue;
    }
    for (const [i, s] of input.layout.slots.entries()) {
      if (inRect(tap.x, tap.y, s) && game.inventory[i]) selectedSlot = i;
    }
  }
}

// ---- main loop ----------------------------------------------------------------------

let lastT = performance.now();

function frame(now: number) {
  const dt = Math.min(1 / 20, (now - lastT) / 1000);
  lastT = now;

  input.mode = screen === 'game' && overlay === 'none' && game?.phase === 'play' ? 'game' : 'menu';
  input.layout = hudLayout(cssW, cssH);

  if (input.keyPressed('Escape') || input.keyPressed('KeyP')) {
    if (screen === 'game' && game && overlay === 'none' && game.phase === 'play') overlay = 'paused';
    else if (overlay === 'paused') overlay = 'none';
  }

  handleTaps();

  const view = computeView(cssW, cssH);

  if (screen === 'menu') {
    drawMenu();
  } else if (game) {
    const gi = input.readGameInput(selectedSlot);
    if (overlay === 'none') {
      game.update(dt, gi);
      selectedSlot = game.selectedSlot;
    }
    game.updateCamera(dt, view.w / view.ts, view.h / view.ts);

    drawWorld(ctx, game, view, DEBUG);
    if (game.phase === 'play' && overlay === 'none') {
      drawHud(ctx, game, view, input.layout, input, LEVELS[levelIdx].name);
    }
    if (game.wipeT >= 0) drawWipe(ctx, view, game.wipeT);
    if (game.phase === 'hint') drawHintOverlay();
    if (overlay === 'paused') drawPausedOverlay();

    if (game.phase === 'won') {
      if (!savedThisWin) {
        savedThisWin = true;
        progress.stars[levelIdx] = Math.max(progress.stars[levelIdx] ?? 0, game.stars());
        progress.unlocked = Math.max(progress.unlocked, Math.min(LEVELS.length, levelIdx + 2));
        saveProgress(progress);
      }
      if (game.wonT > 1.1) overlay = 'complete';
    }
    if (overlay === 'complete') drawCompleteOverlay(game);
  }

  input.endFrame();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// referenced for tuning visibility in dev tools
void CONFIG;
