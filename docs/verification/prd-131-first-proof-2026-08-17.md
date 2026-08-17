# PRD-131 — the last open criterion, executed on the Pixel 8 — 2026-08-17

PRD-131 closed on 2026-08-16 with one unchecked box, and it was unchecked for the right reason:

> `examples/native-smoke` still reaches `TN_NATIVE_SMOKE_FIRST_FRAME` on the Pixel 8 without a
> signal 6. **Not run** — no C++ was touched, so nothing could have moved it, but that is an
> argument rather than an observation.

It is now an observation.

## The run

```
node packages/runtime-native/scripts/verify-android-first-proof.mjs \
  --device 37251FDJH0037Z --expect-engine v8
```

```
BUILD SUCCESSFUL in 2s
2/4 Targeting Android device 37251FDJH0037Z...
3/4 Launching the first proof and waiting for its exact ready marker...
4/4 PASS: 300 frames, clean logs, screenshot captured, and process 21098 remained alive for 3000 ms.
```

Exit `0`. Device `37251FDJH0037Z` (Pixel 8 `shiba`), physical, USB-attached.

## What it observed

| Item | Value |
| --- | --- |
| Markers, in order | `TN_NATIVE_SMOKE_THREE:0.185.1` → `TN_NATIVE_SMOKE_READY:webgpu` → **`TN_NATIVE_SMOKE_FIRST_FRAME`** → `TN_NATIVE_SMOKE_300_FRAMES:300` |
| Engine, read from the process | `MystralRuntime: JS engine created: V8` (`first-proof-logcat.txt`, 14:54:14.570) |
| Frames | 300 |
| Survival after success | process 21098 alive 3,000 ms |
| **`signal 6` / `SIGABRT` in the captured logcat** | **0 occurrences** |
| Screenshot | 1080×2400, 265,125 B, sha256 `68eb322dd1262ce398e56bb043f0f70c5882565f29289d4cc655cafce7b7cd72` |

The signal-6 count is the point. PRD-131 §3 dropped a `webgpu_->resizeSurface(...)` hunk from the
recovered branch precisely because `main` records that change killing a Pixel 8 with signal 6.
This run is the observation that dropping it left the phone healthy, rather than the argument
that it must have.

## Device condition, stated because it was not met

Battery **33%**, **USB powered**, thermal status **0 (NONE)**, screen awake. The 50%-and-
discharging bar PRD-127 declares is for **timing** lanes; this gate takes no timing measurement —
it asserts marker order, frame count, process survival and a non-blank screenshot. No performance
number is produced by this run and none should be read out of it.

## What this does not claim

Not mobile-readiness — one Android phone is not mobile. Not iOS, which has no physical evidence at
all. Not qualification: `pnpm native:qualify:physical` still refuses at
`TN_QUALIFY_SIGNING_REQUIRED`, which is PRD-128's scope and remains open.
