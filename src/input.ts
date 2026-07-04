// Touch-first input: floating virtual joystick (drag distance = sneak vs
// scurry), a context action button, HUD taps, plus a keyboard fallback
// (WASD/arrows + E + Shift) for desktop testing.

import { CONFIG } from './config.ts';
import type { GameInput } from './game.ts';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Circle { x: number; y: number; r: number }

export interface HudLayout {
  action: Circle;
  slots: Rect[];
  pause: Rect;
}

export function hudLayout(w: number, h: number): HudLayout {
  const slot = Math.min(54, w * 0.13);
  return {
    action: { x: w - 64, y: h - 72, r: 44 },
    slots: [
      { x: 12, y: 12, w: slot, h: slot },
      { x: 12 + slot + 8, y: 12, w: slot, h: slot },
    ],
    pause: { x: w - 52, y: 12, w: 40, h: 40 },
  };
}

export function inRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}
export function inCircle(px: number, py: number, c: Circle): boolean {
  return Math.hypot(px - c.x, py - c.y) <= c.r;
}

export class InputManager {
  mode: 'menu' | 'game' = 'menu';
  layout: HudLayout = hudLayout(320, 568);

  taps: { x: number; y: number }[] = [];

  joyPointer = -1;
  joyOrigin = { x: 0, y: 0 };
  joyVec = { x: 0, y: 0 }; // px offset from origin

  private actionPointer = -1;
  actionHeld = false;
  private actionEdge = false;

  private keys = new Set<string>();
  private keyEdges = new Set<string>();

  attach(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const { offsetX: x, offsetY: y } = e;
      if (this.mode === 'game') {
        if (inCircle(x, y, this.layout.action)) {
          this.actionPointer = e.pointerId;
          this.actionHeld = true;
          this.actionEdge = true;
          return;
        }
        const onHud = this.layout.slots.some((s) => inRect(x, y, s)) || inRect(x, y, this.layout.pause);
        if (!onHud && y > canvas.clientHeight * 0.35) {
          this.joyPointer = e.pointerId;
          this.joyOrigin = { x, y };
          this.joyVec = { x: 0, y: 0 };
          return;
        }
      }
      this.taps.push({ x, y });
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyPointer) {
        this.joyVec = { x: e.offsetX - this.joyOrigin.x, y: e.offsetY - this.joyOrigin.y };
        const len = Math.hypot(this.joyVec.x, this.joyVec.y);
        // let the origin trail behind long drags so direction changes stay snappy
        if (len > CONFIG.JOY_FULL * 1.6) {
          const k = (len - CONFIG.JOY_FULL * 1.6) / len;
          this.joyOrigin.x += this.joyVec.x * k;
          this.joyOrigin.y += this.joyVec.y * k;
          this.joyVec.x = e.offsetX - this.joyOrigin.x;
          this.joyVec.y = e.offsetY - this.joyOrigin.y;
        }
      }
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId === this.joyPointer) {
        this.joyPointer = -1;
        this.joyVec = { x: 0, y: 0 };
      }
      if (e.pointerId === this.actionPointer) {
        this.actionPointer = -1;
        this.actionHeld = false;
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.keyEdges.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'KeyE' && !this.actionHeld) this.actionEdge = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.joyPointer = -1;
      this.joyVec = { x: 0, y: 0 };
      this.actionHeld = false;
      this.actionPointer = -1;
    });
  }

  keyPressed(code: string): boolean {
    if (this.keyEdges.has(code)) {
      this.keyEdges.delete(code);
      return true;
    }
    return false;
  }

  readGameInput(selectedSlot: number): GameInput {
    let mx = 0, my = 0, sneak = false;

    const len = Math.hypot(this.joyVec.x, this.joyVec.y);
    if (this.joyPointer !== -1 && len > CONFIG.JOY_DEADZONE) {
      const mag = Math.min(1, (len - CONFIG.JOY_DEADZONE) / (CONFIG.JOY_FULL - CONFIG.JOY_DEADZONE));
      mx = (this.joyVec.x / len) * mag;
      my = (this.joyVec.y / len) * mag;
      sneak = mag < CONFIG.JOY_SNEAK_FRAC;
    } else {
      const k = this.keys;
      mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      my = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
      const l = Math.hypot(mx, my);
      if (l > 0) {
        mx /= l;
        my /= l;
      }
      sneak = k.has('ShiftLeft') || k.has('ShiftRight');
    }

    const input: GameInput = {
      moveX: mx,
      moveY: my,
      sneak,
      actionHeld: this.actionHeld || this.keys.has('KeyE'),
      actionPressed: this.actionEdge,
      selectedSlot,
    };
    this.actionEdge = false;
    return input;
  }

  endFrame() {
    this.taps.length = 0;
    this.keyEdges.clear();
  }
}
