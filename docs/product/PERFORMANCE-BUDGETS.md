# Performance budgets

**Status:** proposal, 2026-08-02. The public API stays small, visual choices stay in
generated user source, and budgets remain bounded.

## The problem

"300 draw calls" means nothing without a device, a scene and a shader cost. Most
developers cannot tell whether a number is fine, and neither can an agent that only sees
source files. Performance has to be translated into a verdict, not a readout.

## Where budgets live — not in `defineGame`

The strategy input proposed:

```ts
// ✗ rejected
export default defineGame({
  targets: { "mobile-mid": { fps: 60, maxDrawCalls: 180, maxTextureMemoryMB: 384 } },
});
```

Two reasons that is the wrong home. The public API is intentionally capped at one page, and
this adds a config tree to the surface every game must read. The ownership boundary's ceiling argument
applies as well: options in the framework are reached only through the options, and
everything unanticipated becomes unreachable.

Budgets are **test assertions**, and the repo already works this way — `scripts/check-budgets.ts`
reports LOC review triggers and hard native-runtime invariants in CI. Frame budgets are the
same idea pointed at the game:

```ts
// tests/perf.playtest.ts — proposed
export const perfScenario = {
  name: "level 1 holds 60fps on mobile-mid",
  target: "web",
  schemaVersion: 1,
  profile: "mobile-mid",
  steps: [{ kind: "input", press: "ArrowRight", holdFrames: 600, release: true }],
  assert: {
    diagnostics: { noConsoleErrors: true },
    performance: { p95FrameTimeMs: 16.7, maxDrawCalls: 180, maxTextureMemoryMB: 384 },
  },
} as const;
```

The budget travels with the scenario that exercises it. A game with no perf scenario has
no budget, and pays nothing for the feature.

## Suggested profiles

| Profile | fps | Draw calls | Texture memory | Download |
|---|---:|---:|---:|---:|
| `mobile-low` | 30 | 100 | 192 MB | 80 MB |
| `mobile-mid` | 60 | 180 | 384 MB | 150 MB |
| `mobile-high` | 60 | 300 | 512 MB | 200 MB |
| `web` | 60 | — | — | — |

**These are guesses.** They must be calibrated from a real device lab before they are
presented as anything else. Publishing hardcoded numbers as if they were measured is how
a budget stops meaning anything.

## The report

```
Performance score  82/100

CPU game thread     6.1 ms   ✓
GPU frame           9.4 ms   ✓
Draw calls          242      ✗ target 180
Texture memory      311 MB   ✓
Main-thread UI      4.3 ms   ✓
Startup             2.8 s    ✓
Download size       91 MB    ✓

Suggested fix: instance 114 identical rock meshes  (−113 draw calls)
```

The suggestion line is the point. Per
[../architecture/THREEJS-CONSTRAINTS.md](../architecture/THREEJS-CONSTRAINTS.md), we do
not instance the user's rocks — `InstancedMesh` is a Three.js primitive the model already
knows and wrapping it costs more code than using it. We find the 114 meshes and say so.

## Why an agent needs this more than a human does

A human notices a stuttering game. An agent editing a file sees nothing. Give it a budget
and a delta, and "did my change make this worse" becomes a question with an answer —
which is the difference between an agent that iterates and an agent that drifts.

## Order of work

1. Frame-time and draw-call sampling in the playtest bridge (small; the bridge already
   samples observations per frame).
2. A `performance` assertion block that **throws on malformed input**, never skips —
   the silently-inert-assertion hole.
3. Profiles as data in the scenario, calibrated later.
4. Device-lab calibration. **Blocked on the remaining physical-device evidence.**

Steps 1–3 are worth doing on web alone. Step 4 is where the numbers become honest.

**A device number without a condition block naming battery, charging, thermal status and screen
state is not evidence.**
