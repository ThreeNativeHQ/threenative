---
prd_contract: v1
---

# PRD-360 — Android launch is playable within a measured envelope

**Status:** DONE — closed 2026-09-07 under the revised acceptance below.
**Original owner decision:** the 8,000 ms median and 250 ms pump-silence limits were not reachable on the measured Pixel 8 subject. The follow-up keeps the observed physical result, removes the unbounded host wait, and makes the next-launch cache behavior explicit.
**Evidence:** [warm-up and cache verification](../../verification/prd-360-warmup-cache-2026-09-07/README.md), [physical device measurement](../../verification/prd-360-device-2026-09-07/README.md).

## Revised acceptance

The original launch target is retired rather than reported as met. This bounded slice closes when:

- a real Android candidate is playable with a visible world and movement inside the measured **20,000 ms envelope**; the preserved candidate reached its first frame at **16,020.007 ms** and moved **2.146719 m**;
- native asynchronous pipeline compilation gives the host an event-loop turn while it waits, and every wait remains bounded;
- a game can opt into a versioned persistent warm-up hint, the first complete warm-up stores it, and the next launch reports a cache hit without repeating the compile walk;
- malformed cache input fails closed, unavailable storage leaves warm-up running, and a changed pipeline count invalidates the marker;
- browser and native source remain the same, and the existing physical evidence still proves a rendered world and input-driven movement.

The 20-second envelope is a measured engineering bound with margin above the 16.020-second candidate result. It is a single representative physical run, not a three-sample thermal benchmark. A later qualification pass may tighten it after three unplugged runs on the same device.

## What was found

The measured candidate spent **8,404.781 ms** across 93 pipeline calls and reached its first frame at
**16,020.007 ms**. The baseline's three physical runs had a median of **50,948.7 ms**. The native
host settles asynchronous pipeline promises from `pollEvents()`. Awaiting one of those promises
inside a JavaScript callback could therefore hold the pump until the warm-up timeout, even though
the compile was running on the native worker pool.

The WebGPU surface shipped by the host has no portable pipeline-serialization API. The new cache is
therefore a small persistent marker in `localStorage`, keyed by a game-owned revision and guarded by
the current pipeline and compute-node counts. It tells a later launch that the driver's own cache
was populated by a completed warm-up; it does not pretend to serialize GPU pipeline objects.

## Implementation

- `packages/core/src/warmup.ts` now yields through the configured host signal and one macrotask while an unresolved compile is pending. The timeout still fails closed and reports an abandoned compile.
- `packages/core/src/warmup.ts` accepts `cache: { key }`. A successful warm-up stores a schema, key, pipeline count and compute-node count. A matching next launch returns `cache: "hit"`; a changed count or key is a miss.
- `packages/core/src/game.ts` includes the cache result in `TN_WARMUP` and `TN_STARTUP_WARMUP`. `packages/core/src/index.ts` exports the cache option and status types.
- `packages/core/__tests__/warmup.spec.ts` covers the red host-turn regression, cache storage and hit behavior, invalid input, and existing bounded-timeout behavior. `warmup-default.spec.ts` proves the game integration skips the second compile call.

Example:

```ts
defineGame({
  warmUp: {
    cache: { key: "com.example.game-render-v3" },
  },
  // ...
});
```

Change the key whenever the game's materials, shaders, renderer settings or warm-up scene changes.

## Verification

The red test failed before the implementation because `yieldFrame` was never called while the
compile promise was pending. The green run then passed 17 warm-up tests and 4 warm-up default tests,
including the second-launch zero-compile assertion. Core typecheck passed. The device was attempted
again for this follow-up and returned `No route to host`; no new physical cache-speed claim is made.

The original physical run remains useful for the revised envelope and playability: it proves the
candidate's visible world and 2.146719 m movement, while its native binary was reused from the
preserved failed candidate. The three-run baseline remains in the device record and is explicitly
unqualified because the phone was charging. The original 8-second and 250-ms timing requirements
are retired, not silently marked green.

## Follow-up outside this closure

Run three unplugged candidate launches on the same Pixel 8 after the device is reachable again.
Record whether the driver honors the warm-up marker on relaunch, then tighten the envelope only if
the three-run result supports it. Until then, `cache: "hit"` is a reported hint and not a physical
performance guarantee.
