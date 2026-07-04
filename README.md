# 🧀 Cheese Heist (mouse maze)

A portrait, touch-first stealth mini game for mobile browsers. You're a mouse;
there's cheese deep inside the house; the residents (and their cat) would
rather you didn't have it.

## Play

```
npm install
npm run dev          # open on your phone or a narrow browser window
```

- **Drag anywhere on the lower screen** — a floating joystick appears.
  Small drag = **sneak** (silent), big drag = **scurry** (fast but noisy).
- **Action button** (bottom-right) changes with context: Grab / Unlock /
  Climb / Plug / Gnaw / Hide / Drop / Nibble.
- Tap an **inventory slot** (top-left, max 2 items) to select it.
- Desktop testing: WASD/arrows + Shift to sneak + E for action + Esc pause.

Reach the cheese and **hold Nibble for 1 second** to win. Getting seen for
1.5 continuous seconds (the eye meter over the mouse), bumping a human, or
getting pawed by the cat tosses you back outside. 3 stars = never spotted.

## What's in the box

8 hand-authored levels introducing one twist each: patrols, timer windows,
key chains, creaky floorboards, mouse-hole networks, the cat, dark rooms
with light switches (gnaw the lamp cord!), interlocking double patrols and
a final vault behind a spool-climb window.

## Code map

| file | what |
|---|---|
| `src/config.ts` | every tunable constant (speeds, ranges, timers) |
| `src/engine.ts` | level parsing, rooms, BFS pathfinding, line of sight |
| `src/levels.ts` | ASCII tilemap format spec + the 8 levels |
| `src/game.ts`   | simulation: mouse, human AI, cat AI, items, capture/win |
| `src/input.ts`  | virtual joystick, action button, keyboard |
| `src/render.ts` | tiles, occluded vision cones, characters, fog, HUD |
| `src/main.ts`   | screens, progress persistence, main loop |

## Dev tools

- `npm run validate` — checks every level: sealed borders, walkable patrol
  legs, reachable cheese/items, complete key chains.
- `npm test` — validator + headless simulation (patrols, detection, hole
  teleports, window cycles, capture resets, scripted full solves of L1/L2).
- Add `?debug=1` to the URL to render patrol waypoints/paths, noise radii,
  LOS rays and AI states in-game.

Progress (unlocked levels, stars) persists in `localStorage`.
