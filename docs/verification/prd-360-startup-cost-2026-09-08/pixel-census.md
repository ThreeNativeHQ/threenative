# PRD-360 — Pixel 8 pipeline census, and why the launch has no warm-up

Step 3 of [the Opus handoff](README.md): instrument the actual Pixel build, group pipelines by
PMREM, shadow, main material and output conversion, count objects separately from unique pipelines,
and measure repeated descriptors rather than assuming duplication. It ran, and it moved the
diagnosis somewhere else entirely.

## How it was measured

The probe's own backend hooks (`artifacts/prd360-followup/compile-probe/src/instrument.js`) were
added to the real Bayview game as a temporary plugin at the head of its plugin list, so they install
before anything compiles. One debug APK, one cold launch on a physical Pixel 8 over USB, census
logged every 5 s. Counts do not depend on device temperature, so no thermal qualification window was
taken.

Instrumented APK `babd0001a8a4e388257613534ef274237b4db49c067b6d2e2b12374149f11923`. The
instrumentation was then removed from the sandbox source and the clean build reinstalled,
`612489275de59ebf4280364aa8c2bcad73215063c4c5b0494e0d0c34947b150e`.

## What it counted

```
TN_PRD360_CENSUS: pipelines 101 | sync 101 | async 0 | uniqueKeys 101 | syncMs 8513
  main    67 pipelines   7477 ms
  shadow  31 pipelines    963 ms
  pmrem    2 pipelines     50 ms
  output   1 pipeline      23 ms
```

| Question the handoff asked | Answer |
| --- | --- |
| Objects vs unique pipelines | 101 pipelines, **101 unique cache keys** |
| Repeated descriptors | **None.** There is nothing to deduplicate |
| Group split | main **67 / 7,477 ms**, shadow **31 / 963 ms**, PMREM 2 / 50 ms, output 1 / 23 ms |
| Async settlement | **Zero.** 101 of 101 built through the synchronous path |

The 8,513 ms agrees with the ledger's previously recorded 8,788 ms across 103 pipelines, so this is
the same cost measured a second way, now with its composition.

## The finding

**This launch runs no warm-up at all.** `packages/core/src/game.ts` starts the framework compile
only when `startupCoverActive()` is true, and that is `!startupReadiness.ready && canvasLayer.opaque`.
Bayview's loading surface is a React DOM overlay, so it never sets `ctx.canvasLayer.opaque`, which
defaults to `false` (`packages/core/src/canvas-layer.ts:9`). The gate therefore passes `undefined`
and nothing compiles ahead of the frame.

That is deliberate and already covered by
`packages/core/__tests__/game.spec.ts`'s "does not mistake a ready web HUD for an opaque startup
cover", which asserts `expect(compileRoots).toHaveLength(0)`. Without a cover the world draws on the
first frame anyway, so warming up beside it would compile everything twice. The reasoning is sound;
what was wrong is that **the skip was silent**. Every marker in the log looked ordinary, and finding
out cost a device session.

### Consequences for the lever already implemented

[First-use compile coverage](first-use-coverage.md) is correct and proven, and this census sizes it
honestly: shadow and output together are 32 of 101 pipelines but only **986 ms of 8,513 ms — 11.6 %**.
It is not where this launch's time goes. The 67 main-material pipelines are 88 %, and those are
exactly what an ordinary warm-up walk would reach — if one ran.

> **Superseded 2026-09-08 by [warm-up-rejected.md](warm-up-rejected.md).** The ranking below is an
> upper bound reasoned from the composition, and hardware contradicted its first row: turning the
> warm-up on costs 15-21 s rather than saving 8.5 s. Read the rejection for the corrected ranking.

So the ranked attribution for PRD-360's launch is:

1. **No warm-up runs** — 8,513 ms of synchronous pipeline creation on the launch path. Fixing this
   is worth up to the whole of it.
2. **Shadow and output first-use coverage** — 986 ms, already implemented, engaged only behind an
   opaque cover.
3. **Serial `compileAsync` scheduling** — untested here, and untestable until a warm-up runs at all.

## The change in this commit

The convention now reports itself. When the framework warm-up is skipped for want of a declared
cover, `game.ts` logs it on the same greppable marker the warm-up would have used:

```
TN_STARTUP_WARMUP:{"skipped":"no-startup-cover","opaque":false}
```

Red: `packages/core/__tests__/game.spec.ts` "says so when no startup cover was declared, instead of
skipping silently" fails with `expected 0 to be 1`. Green: 45 passed.

## Gates

```
pnpm typecheck   # clean
pnpm lint        # Found 653 warnings (exit 0; the same pre-existing count)
pnpm test        # core 45/45 in game.spec.ts; whole workspace green except one pre-existing flake
```

`packages/runtime-native/tests/webtransport/webtransport.test.ts` > "accepts the echo server
certificate only with the explicit development override" fails in the full workspace run and passes
in isolation (36/36). **Negative control:** reverting this commit's two files to `HEAD` and running
the runtime-native suite reproduces the same failure, so it is pre-existing and environmental, not
this diff. It also passed in a full run earlier the same session.

## What this does not establish

- **No candidate launch was measured.** This is a census of the existing build, not an A/B. PRD-360
  stays PARTIAL and no launch budget is claimed.
- **Phase attribution is partial.** Per-frame tagging was driven from `renderer.raw.render`, and
  every tagged frame showed a single pass, so the tagged frames are overlay draws and the census
  cannot say which frame the 101 landed in. The sync/async split and the group split do not depend
  on that tagging.
- **The fix for the finding is not in this commit.** Making Bayview declare its DOM loading surface,
  or giving the engine a way to be told about one, is the next change, and it needs a device A/B on
  the same APK identity to be worth anything.
