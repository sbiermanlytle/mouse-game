**Plan summary:**

The score counter will be a cumulative `totalCheese` count persisted in the existing localStorage save file. Changes touch only two files:

- **`src/main.ts`**: extend the `Progress` type, increment on win (guarded by the existing `savedThisWin` flag so it only fires once per completion), pass the count to `drawHud`, and render it on the complete screen.
- **`src/render.ts`**: accept the count as an extra parameter and append `🧀 N` to the existing HUD top bar label.