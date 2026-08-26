# Plan: Add entry-point comment to src/main.ts

## Context
The task is to add a single comment line at the top of `src/main.ts` identifying it as the game entry point. The file currently opens with a two-line descriptive comment (lines 1–2); the new line will be prepended before those.

## Change

**File:** `src/main.ts`

Insert as the new line 1:

```ts
// Game entry point.
```

The existing two-line comment stays in place below it.

## Verification
- Read `src/main.ts` after the edit and confirm line 1 is `// Game entry point.`
- No runtime behavior changes; no tests needed.
