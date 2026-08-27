# Night batch — 2026-08-26 → 2026-08-27

**Purpose:** the queued work for tonight's overnight agents. Selected 2026-08-26 ~23:00, after
verifying against `main` (`ca419748`) that every item below is genuinely unaddressed — statuses
grepped across open PRDs, and `git log --all` checked so no lane is re-doing landed work.

This folder is an **execution manifest plus two new PRDs** ([PRD-224](./PRD-224-webgpu-binding-tables-install-once-per-class.md),
[PRD-225](./PRD-225-physics-callback-crashes-named-or-fixed.md)). Referenced existing PRDs stay in
their owning batches; nothing moves into this folder.

## Step 0 — before any lane starts

1. Three earlier lanes are unmerged on sibling branches — merge or explicitly park them before
   touching their scope: `linchpin/prd-203-template-loading-screens-stop-drifting` (3 commits,
   templates loading source), `linchpin/prd-219-android-proof-menu-flow` (5 commits — if it
   contains real device evidence, reconcile [PRD-219](../done/PRD-219-android-proof-of-the-menu-flow-starter.md)'s
   NOT STARTED status first), `linchpin/prd-202-runner-lanes-share-one-implementation` (2 commits).
2. Check mtimes of `.claude/worktrees/agent-*` and the primary checkout's `git status` before
   attributing any red gate — other agents share this tree. Commit as you go.
3. `pnpm typecheck && pnpm lint && pnpm test` green on HEAD before branching.

## Lanes

| Lane | Device | Queue | Why tonight |
| --- | --- | --- | --- |
| A — binding tables widen | none (host) | [PRD-224](./PRD-224-webgpu-binding-tables-install-once-per-class.md) phases 1–3 (+ 4 only if a Pixel shows up) | The proven root cause of the parity defect; step 1 measured 70×→~4× per call and widening is exactly what remains. Highest predicted win: bridge 8.16 ms/frame vs ≈1.4 ms at Chrome rates — crosses the ≥2 ms resume ticket with the caller path already named |
| B — menu flow proof on Android | `emulator-5554` | [PRD-219](../done/PRD-219-android-proof-of-the-menu-flow-starter.md), still `NOT STARTED` after last night's lane went unmerged; check its branch content first (step 0.1) | Today's headline convention proved web-only; the house rule says web-only is unfinished. Read the 00:40 IME steering note in the previous batch README before writing any BLOCKED verdict |
| C — physics stability probe | host analysis; emulator for launches | [PRD-225](./PRD-225-physics-callback-crashes-named-or-fixed.md) phase 0 → 1 or 1' | Two records disagree (5-of-9 deaths vs zero deaths); the loop log ranks it next action #1 because crashes multiply every capture cost ×2–4. Probe decides before anyone touches code |
| D — Pixel 8 tails, one session | `192.168.1.192:5555`, only when online | (1) **Android loading-gate measurement owed** — the loading-screen bug is fixed and desktop-proven at `b6d3a9bf`/`ca419748`, but its own caveat says Android wgpu-native has never been proven cheap; one capture closes it. (2) Tier-1 cool-phone rerun of upload staging v3 (loop-log action #2; current +21% figure is matched-warm development-grade only). (3) PRD-224 phase 4 device confirm, last | Lane was down (`Connection refused`) at filing time — attempt `adb connect` once, record the outcome either way |

## Traps to carry into tonight

- **Quiet machine for Lane A's frame pair**: display contention on `:0` moved measurements more
  than any lever under test; Xvfb and `:0` are different meters — never compare across lanes.
- **No whole-run averages**: the startup block swings 3× between sessions on identical binaries.
  Frames 226–899 differenced only; browser numbers state their warm-up (~25 s for Bayview).
- **Stale build artifacts lie**: core playtest code arrives via core's `dist`; rebuild it before
  native/playtest gates. Verify scripts that don't rebuild have been caught proving stale
  binaries twice this week (verify-desktop-core correction, loading-gate reruns).
- Gradle lanes export JDK 17 (`JAVA_HOME=/usr/lib/jvm/java-17-openjdk`) + `ANDROID_HOME`; bare
  `26.0.2` means JDK 26 was selected.

## Explicitly not tonight

- Charter-performance PRDs 189–195 and tech-debt structural passes (202 fresh work, 204–208):
  their old lanes exist but the batches were deliberately sequenced after the merges land;
  squeezing them next to the binding refactor risks file collisions in `packages/core`.
- PRD-214 Phases 1–2 levers: subsumed as queue items by PRD-222 records; revisit after PRD-224
  re-prices the frame.
- PRD-078 release tag push and PRD-077 `input` group: owner actions.
- OPPORTUNITY-AREAS.md re-score: owner working session.

## Batch acceptance

- [ ] Each closed PRD carries a dated record in `docs/verification/`, reds pasted, whole-run
      averages absent from every number.
- [ ] Platform claims name their lane (physical Pixel 8 / emulator / desktop host).
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` exit 0 after each PRD.
- [ ] Finished PRDs `git mv` to `done/` in the closing commit; this folder is deleted once every
      row above is closed, blocked-with-a-name, or parked by recorded decision.
