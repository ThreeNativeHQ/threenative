# High-complexity lane — the phone, and the three judgement calls

Complexity, as each PRD rates itself: **PRD-126 is 5, PRD-128 is 6, PRD-129 §5–§7 is 7.** The
four hardware runs are unrated because their cost is the phone, not the code.

Everything in this lane either needs hardware attached to the operator's machine or turns on
a judgement that is wrong in a way a passing test does not catch. **None of it is delegable
to a cheap model.** The rest of the batch is indexed in
[`README-LOW-COMPLEXITY.md`](./README-LOW-COMPLEXITY.md); it does not overlap with anything here.

## Hardware runs — in this order, cheapest first

A physical Pixel 8 is available (`shiba`, arm64-v8a, Android 17, Mali-G715 — the same device
PRD-066, PRD-070, PRD-117 and PRD-118 already measured on). These four PRDs already exist and
need runs, not paperwork.

| PRD | State today | What the phone closes | Cost |
| --- | --- | --- | --- |
| [PRD-118](../done/PRD-118-android-js-engine.md) | ~~`PARTIAL / PROVISIONAL`~~ → **`ACCEPTED` 2026-08-16, archived to `done/`.** The retake ran at 72%: L3 @ 16 384 reads **8.32 ms** against 8.33 ms provisional. [Record](../../verification/prd-118-charged-retake-2026-08-16.md) | done — and it settled PRD-127 §9's first kill switch: the QuickJS arm, which was free to move, read 20.03 ms charged against 20.02 ms provisional | **done** |
| [PRD-117](../PRD-117-engine-load-test-godot.md) | `PARTIAL` — web L2 and desktop L2 closed against Godot; phone arm and acceptance open | the third arm of the load test | half a day |
| [PRD-074](../native-performance-fixes/PRD-074-scene-collapse-regression-gate.md) | `IMPLEMENTED` browser-side; Pixel 8 leg open | the collapse regression gate covers the platform it was written for | half a day |
| [PRD-066](../native-performance-fixes/PRD-066-android-device-frame-rate.md) | `PARTIAL` — root cause measured on the device, Phase 1 landed, Phases 2–5 open. Its own words: *a device frame-rate gate that does not exist yet* | the gate | one to two days |

**PRD-118 ran first and is done.** It was a single run behind a result the repository already had in
hand, it needed no code from anything in this folder, and it was the cheapest item in the batch by an
order of magnitude. Its provisional label was not a missing check —
`scripts/engine-load-test/run-android.ts:93` refused the run and `--allow-low-battery` overrode it,
which is the escape working as designed. Re-run without the flag at 72%, it read 8.32 ms.

**Its side effect is worth more than the acceptance.** Both arms were retaken, and the QuickJS arm —
the one at 20 ms, nowhere near the 8.33 ms frame interval, and therefore free to move — read 20.03 ms
charged against 20.02 ms provisional. On this device the 50% bar changed nothing measurable. That is
PRD-127 §9's first kill switch firing on evidence. It does not delete the gate; it says the useful
thing is recording the observed charge with every number, not refusing everything under a threshold.

**PRD-127 lands before PRD-117, PRD-074 and PRD-066 run.** The low-complexity lane writes its code;
this lane is what verifies it, because only this machine has the phone. Until then, one of
four device lanes checks the phone's condition and three check nothing.

**Status 2026-08-16: still true, and the three runs did not happen.** PRD-127 is implemented —
`packages/runtime-native/scripts/device-preflight.mjs` exports `assertDeviceReady` and
`measure-android-js-engine.mjs` calls it — but only on `linchpin/batch-26-08-16-low-complexity-20260816`,
which is unmerged and still receiving commits. Running the three lanes from `main` today would
produce exactly what PRD-127 exists to prevent: device numbers with no condition block. The phone is
attached, charged and cool; the blocker is a merge, not hardware.

## The three that need judgement

All three were taken on 2026-08-16. Two are done; one stopped where its own kill switch told it to.

| PRD | Why a cheap model gets this wrong | Complexity | Outcome |
| --- | --- | --- | --- |
| [126](./PRD-126-the-visual-instrument-noise-floor.md) | The visual loop cannot tell a change from rater variance, and **has already optimised noise once**. Getting this wrong makes the instrument confidently wrong instead of visibly noisy — which is strictly worse, because nothing reports it | 5 | **PARTIAL.** Instrument built, `pnpm visuals:ab` wired, eight controls red, round 10 re-classified. **Phase 0's measurement refused** — the only rater available had read round 10's scores first and would have published `mde = 0`, which is the confidently-wrong outcome. [Record](../../verification/prd-126-visual-instrument-2026-08-16.md) |
| [128](./PRD-128-android-qualification-split.md) | Splitting a `BLOCKED` PRD is exactly where the temptation is to rewrite a criterion to fit what this machine can run. A PRD moves to `done/` when its evidence is met, never by narrowing what it asked for | 6 | **Phase 0 executed, no folder moved.** A fifth blocker: the orchestrator was built and never landed. Recovery scoped as [PRD-131](./PRD-131-recover-the-qualification-orchestrator.md). [Record](../../verification/prd-128-phase-0-2026-08-16.md) |
| [129 §5–§7](./PRD-129-licensing-and-the-studio-split.md) | Moves `packages/studio/` and `hosting/` to a private repository, unwires 13 named files, and edits the publish list a version tag reads. **A licence grant cannot be withdrawn from a published version** | 7 | **§5 done and proved from a clean clone. §6 blocked** by a finding §5 turned up; §7 not started. [Record](../../verification/prd-129-phase-3-2026-08-16.md) |

### PRD-129 §5–§7 — the order that matters

The low-complexity lane stops at the end of §4, so §3 (the engine's MIT licence) may already be
committed when you pick this up. Check before starting. **On 2026-08-16 it was not** — §3 and §4 sit
on the same unmerged lane branch as PRD-127, and `main` still has no `LICENSE`.

1. **§5 first, and prove it.** The private repository is not seeded until
   `pnpm install && pnpm build` succeeds in a clean clone of it, with `create-threenative`
   resolved from the registry rather than the workspace. §5.4.
   **Done.** `jonit-dev/threenative-studio`, private, 127 files, clean clone green on install,
   build, typecheck, lint and 190 tests, with `create-threenative` resolving to
   `.pnpm/create-threenative@0.2.2`.
2. **§6 only after §5 is green.** The public repository must not lose the code before the
   private one can build it. **This rule earned its place.** §5 found that
   `@threenative/playtest@0.2.0` exports neither `WEBGPU_BROWSER_ARGS` nor the capture module, both
   of which `scripts/studio-probe.ts` reaches by workspace-relative deep import. §6.1 deletes that
   file from here, and it is currently the only copy that builds — so **fix the engine's export map
   and republish before running §6**, or the Studio judging harness is stranded in both repositories
   at once.
3. **§6.3 is a decision, not a deletion** — read what `STUDIO_ASSET_ROOT` actually gates
   before removing it, and record which way it went in the commit message.
   **Decided: the gate stays, and only that branch goes.** `STUDIO_ASSET_ROOT` is write-only —
   `persistTemplateCapture` writes a second copy of each template frame into
   `packages/studio/assets` and nothing reads it. It is the template gate with a Studio-shaped side
   effect, not Studio's gate.
4. **No `git filter-repo`.** §1.3 of that PRD prices it: 197 commit SHAs are cited across
   `docs/`, and the 0.2.0 bundle is already public on npm, so a rewrite pays real citations
   for obscurity the licence already makes unnecessary. **Honoured** — the private repository was
   seeded by copying the working tree, with no history import and no force-push.

## What this lane does not claim, and will not

- **Not mobile-ready.** One Android phone is not mobile. It licenses Android-on-this-device
  sentences and nothing about iOS, which has no physical evidence at all and no Apple hardware
  attached — the hosted `macos-15` simulator lane is the only Apple execution here.
- **PRD-056 is not unblocked by this batch.** PRD-128 splits an executable part out of it. The
  iOS part stays blocked on Apple hardware and a signing identity, neither of which exists here.
  The Android *signed* part stays blocked too — `android/app/build.gradle.kts:253` declares a
  `release` build type with no `signingConfig` and there is no keystore in the tree — but that
  one is an owner decision rather than a capability nobody can supply.
- **No human blind session.** PRD-126 sharpens a *model* instrument and says so. The human
  session `docs/product/VISUAL-BASELINE.md` requires is a separate ask.
- **No visual-quality result.** PRD-126 built the instrument and declined to take its own
  measurement, because the rater available was anchored. An `mde` of 0 would have licensed every
  one-point move as a result — round 10's failure with a certificate attached.
- **Nothing qualified on the phone beyond PRD-118.** PRD-128 ran three invocations that all refused
  before reading a property from the device. That is the harness being right, not a qualification.
- **Nothing removed from this repository and nothing published.** §5 added a private repository and
  two `LICENSE` files. `packages/studio/` and `hosting/` are still here, and
  `@threenative/studio@0.2.0` is untouched on npm.
