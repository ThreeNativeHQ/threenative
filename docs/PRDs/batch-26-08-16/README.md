# Batch — the phone and the instrument, 2026-08-16

**Status: PROPOSED, 2026-08-16. Nothing in this folder has run.** Three new PRDs, PRD-126 through
PRD-128, plus four existing PRDs this batch schedules for execution on hardware. No mobile,
iOS or performance claim is made anywhere in it — the point of the batch is to make three of
those claims *measurable*, not to assert them.

Two things changed today, and between them they decide what is worth building.

1. **A physical Pixel 8 is available to the operator** (`shiba`, arm64-v8a, Android 17,
   Mali-G715 — the same device PRD-066, PRD-070, PRD-117 and PRD-118 already measured on).
   Four PRDs are `PARTIAL` with a phone-shaped hole in them, and one is filed under
   `BLOCKED/requires-physical-device/`.
2. **Round 10 measured its own instrument and found it cannot resolve the changes it was
   making.** `action-rpg` was touched by nothing and moved a full point between two raters.
   Five of the round's seven deltas were inside that noise.

So this batch is two lanes that do not block each other: put the phone to work, and make the
visual loop's numbers mean something.

## What is new here

| PRD | What it closes | Blocks | Cost |
| --- | --- | --- | --- |
| [126](./PRD-126-the-visual-instrument-noise-floor.md) | The visual loop cannot tell a change from rater variance, and has already optimised noise once | every visual claim, round 11 | half a day to a day |
| [127](./PRD-127-device-measurement-preflight.md) | One of four device lanes checks the phone's condition; three check nothing. The gate that works reaches only the engine load test | PRD-117, PRD-074, PRD-066 | half a day |
| [128](./PRD-128-android-qualification-split.md) | PRD-056 is blocked on the *union* of four dependencies. The part a Pixel 8 can run today is held up by an Apple signing identity nobody has | the first non-emulator Android claim | half a day to split, then the runs |

## What this batch schedules rather than re-specifies

These four already have PRDs. They need hardware and a preflight, not more paperwork. Run them
in this order — each is cheaper than the one after it, and each de-risks the next.

| Existing PRD | State today | What the phone closes | Cost |
| --- | --- | --- | --- |
| [PRD-118](../PRD-118-android-js-engine.md) | `PARTIAL / PROVISIONAL` — V8 is **22× faster** than QuickJS on script time and beats the acceptance bar with room, but the run sat at 21–25% battery against a `≥50%` criterion | one charged retake turns a provisional 22× into an accepted one | **one run, no code** |
| [PRD-117](../PRD-117-engine-load-test-godot.md) | `PARTIAL` — web L2 and desktop L2 closed against Godot; phone arm and acceptance open | the third arm of the load test | half a day |
| [PRD-074](../native-performance-fixes/PRD-074-scene-collapse-regression-gate.md) | `IMPLEMENTED` browser-side; Pixel 8 leg open | the collapse regression gate covers the platform it was written for | half a day |
| [PRD-066](../native-performance-fixes/PRD-066-android-device-frame-rate.md) | `PARTIAL` — root cause measured on the device, Phase 1 landed, Phases 2–5 open. Its own words: *a device frame-rate gate that does not exist yet* | the gate | one to two days |

**PRD-118 first, and charge the phone tonight.** It is a single run behind a result the repository
already has in hand, it needs no code from anything in this folder, and it is the cheapest item in
the batch by an order of magnitude. Its provisional label is not a missing check —
`scripts/engine-load-test/run-android.ts:93` refused the run and `--allow-low-battery` overrode it,
which is the escape working as designed. Re-run without the flag.

## What this batch does not claim, and will not

- **Not mobile-ready.** One Android phone is not mobile. It licenses Android-on-this-device
  sentences and nothing about iOS, which has no physical evidence at all and no Apple hardware
  attached — the hosted `macos-15` simulator lane is the only Apple execution here.
- **PRD-056 is not unblocked by this batch.** PRD-128 splits an executable part out of it. The
  iOS part stays blocked on Apple hardware and a signing identity, neither of which exists here.
  The Android *signed* part stays blocked too — `android/app/build.gradle.kts:253` declares a
  `release` build type with no `signingConfig` and there is no keystore in the tree — but that one
  is an owner decision rather than a capability nobody can supply.
- **No human blind session.** PRD-126 sharpens a *model* instrument and says so. The human
  session `docs/product/VISUAL-BASELINE.md` requires is a separate ask.

## Deliberately left out

Three defects the last two rounds found in their own tooling, recorded so the next round does
not rediscover them and so their absence here is a decision rather than an oversight:

1. **`pnpm sweep:archive` reports success while deleting the builder's own directories.** Round
   9's 27 iteration screenshots, including its final hero shot, no longer exist anywhere
   (`scripts/sweep-archive.ts:96`, `copyAppShell`). Round 9 disposed this to a PRD number that
   another PRD took the same day, so it has had no owner since 2026-08-15.
2. **The test suite leaks its temp directories and then fails on the space they occupy.** 146
   leaked `/tmp/threenative-*` directories on round 9; 34 present as this was written. It has
   been misdiagnosed as machine contention twice.
3. **A scaffolded project's default gate asserts a starter internal.**
   `templates/starter/playtests/seed.playtest.json:13` asserts `levelX` equals
   `-0.6056551518850029`. The user's first level edit turns their own `pnpm test` red.

None blocks this batch. All three tax every future round, and (1) destroys evidence every time
a sweep runs, which is the one with a deadline attached.
