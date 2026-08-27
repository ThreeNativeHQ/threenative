# Night batch — 2026-08-27 → 2026-08-28

**Purpose:** the queued work for tonight's overnight agents. Filed 2026-08-27 ~07:50 at the close
of [last night's batch](../../verification/night-batch-2026-08-26-close-2026-08-27.md), verified
against `main` (`c8bd2a6a`) that every item is genuinely unaddressed: loop-log next actions
grepped against the tree, unmerged branches enumerated (`git branch --no-merged main`), F6
unfiled in `docs/bugs/`, F13's ordered sub-items unstarted, PRD-224 phase 1 unrun.

This folder is an **execution manifest**; it files no new PRDs — Lane B's work product is the
F6 filing. Referenced PRDs stay where they live.

## Step 0 — before any lane starts

1. Two lanes are unmerged on sibling branches — merge or explicitly park them before touching
   their scope:
   `prd-223-runtime-native-complexity-reduction` (22 commits ahead, its own final verification
   recorded — looks merge-complete), and
   `linchpin/loading-screen-dismissed-before-scene-ready` (5 commits, **110 behind** — it
   predates the overnight loading re-stamp `6f709f06` and will collide; reconcile against that
   commit before anyone touches loading scope again).
2. Check mtimes of `.claude/worktrees/agent-*` and the primary checkout's `git status` before
   attributing any red gate — other agents share this tree. Commit as you go.
3. `pnpm typecheck && pnpm lint && pnpm test` green on HEAD before branching. (Proven green at
   the close-out ~07:45; re-run if any lane has landed since.)

## Lanes

| Lane | Device | Queue | Why tonight |
| --- | --- | --- | --- |
| A — PRD-224 phase 1, the pricing gate | none (host, quiet machine) | [PRD-224](../PRD-224-webgpu-binding-tables-install-once-per-class.md) phase 1, plus its phase-2 checkbox "extend gpubench.js to price `beginRenderPass`" | The two landed conversions' predicted ≥2 ms/frame win is unmeasured; Phase 1 is the decision gate for phases 3–4 — the PRD says **stop** if render.p50 does not move materially below 22.2 ms. 37 per-call sites and the device arm wait on this answer |
| B — file F6 | none (host) | File the direct-path readback defect (F6: `writeBuffer` → `mapAsync(READ)` returns zeros then one-submit-stale data on wgpu-native) as a PRD in `docs/bugs/`, with the staging-pair probe as evidence | ~15-minute filing lane. The defect is named in the loop log but no PRD carries it, so a cold agent can rediscover it the hard way; Three.js never reads back, which is why nothing caught it |
| C — Pixel 8 tails, one session | `192.168.1.192:5555`, only when online | In thermal order: (1) physics stability guard rerun — retires F5 (loop log #1); (2) Android loading-gate capture, one pair (#4); (3) Tier-1 cool-phone staging-v3 rerun (#2). One `adb connect` attempt first, record the outcome either way | Device refused connection twice on record; all three items are single-session captures once it answers. The guard and loading-gate items are short and run first while the phone is coolest; the staging arms need the cool-phone preflight |
| D — F13 step 1 only | none (host) | Drop the per-call `Isolate`/`Context` scopes and hoist the cached `ExternalReference` (loop log #5, first sub-item) — red-green with the desktop frame pair | The seam owns the frame (F8: bridge dispatch 37.5% incl.). Step 1 is the cheapest stand-alone cut and lives in the JS-engine layer, not `webgpu/bindings.cpp`, so it cannot collide with Lane A's measurement work. Steps 2+ wait for Phase 1's re-pricing |

## Traps to carry into tonight

- **Quiet machine for Lane A's frame pair**: display contention on `:0` moved measurements more
  than any lever under test; Xvfb and `:0` are different meters — never compare across lanes.
- **No whole-run averages**: the startup block swings 3× between sessions on identical binaries.
  Frames 226–899 differenced only; browser numbers state their warm-up (~25 s for Bayview).
- **Stale build artifacts lie**: core playtest code arrives via core's `dist`; rebuild it before
  native/playtest gates. Contract executables link only in `build/tn-linux`.
- **Any runtime-native change takes `pnpm census` in the same commit** — the tolerance drift
  gate fails otherwise (it did overnight).
- **Any new `add_executable(threenative-*-test)` needs both** the native-contract-lane count
  bump **and** an `executionContracts` row with the executable's real pass line (both bit
  overnight; the canary is doing its job).
- Gradle lanes export JDK 17 (`JAVA_HOME=/usr/lib/jvm/java-17-openjdk`) + `ANDROID_HOME`; bare
  `26.0.2` means JDK 26 was selected.

## Explicitly not tonight

- PRD-224 phases 3–4: gated on Lane A's answer; phase 4 needs the device anyway.
- F13 steps 2+ (`Reflect.set` → `CreateDataProperty`, fixed-shape wrappers): re-price after
  step 1 lands — the ordered list exists so each cut is priced alone.
- Charter-performance PRDs 189–195 and tech-debt structural passes: unchanged from last night's
  deferral — sequenced after the unmerged lanes land.
- PRD-078 release tag push and PRD-077 `input` group; OPPORTUNITY-AREAS.md re-score: owner
  actions.

## Batch acceptance

- [ ] Each closed PRD carries a dated record in `docs/verification/`, reds pasted, whole-run
      averages absent from every number.
- [ ] Platform claims name their lane (physical Pixel 8 / emulator / desktop host).
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` exit 0 after each PRD.
- [ ] Finished PRDs `git mv` to `done/` in the closing commit; this folder is deleted once every
      row above is closed, blocked-with-a-name, or parked by recorded decision.
