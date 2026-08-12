# Night batch — 2026-08-12

Five PRDs, ordered by **what a user of ThreeNative gets out of it**. Assembled against the
tree at commit `5a5604e`. PRDs 081–083 completed on 2026-08-12; the remaining queue is unexecuted.

**Four are executable defects. The fifth ([PRD-084](PRD-084-threenative-studio.md), ThreeNative
Studio) is a decision document** — it adds a package and reopens a question the charter closed,
so only its Phase 0 spike may run tonight and its later phases need an owner's signature.

Every item here is a defect a user meets, not a gate the project owes itself. Ledger
reconciliation ([PRD-076](../PRD-076-tier-1-parity-reconciliation.md)), the Phase 2 exit-gate
rewrite ([PRD-079](../PRD-079-phase-2-exit-criteria.md) Phases 2–3) and the stranger test
([PRD-080](../PRD-080-five-minute-stranger-test.md), which needs an external person) were
considered and left out of the night for that reason.

## The order, and why

| # | PRD | The user's sentence | Runnable locally tonight? | Estimate |
|---|---|---|---|---|
| 1 | [PRD-081 — physics assertions a user can write](../done/PRD-081-physics-assertions-a-user-can-write.md) | *"I built a physics game and my `settled` assertion errors."* | **Complete — 2026-08-12** | done |
| 2 | [PRD-082 — `input.vector()` axis contract](../done/PRD-082-input-vector-axis-contract.md) | *"I pressed W and walked backwards."* | **Complete — 2026-08-12** | done |
| 3 | [PRD-083 — the scaffold's default tax](../done/PRD-083-scaffold-default-tax.md) | *"My new project came with 1,073 lines I have to read before writing one."* | **Complete — 2026-08-12** | done |
| 4 | [PRD-078 — toolchain-free consumer proof](PRD-078-toolchain-free-consumer-proof.md) | *"There is nothing for me to download."* | **Partly.** See the night scope below | 2 h of the local half |
| 5 | [PRD-084 — ThreeNative Studio](PRD-084-threenative-studio.md) | *"I want to describe a change and watch the game change, without losing where I was standing."* | **Phase 0 spike only.** Phases 1–3 blocked | 2–3 h for the spike |

Start at 1. It is the largest user-visible defect in the batch: the framework's 0→1
capability (physics) and its highest-scored capability (assertions) do not compose, and round
4 measured both benchmark arms failing on exactly that error without either builder realising
it was a framework bug.

## Night scope for PRD-078 — read before touching it

PRD-078 as written is blocked on a missing Vulkan ICD on a GitHub runner. **Do not push a
release tag and do not trigger `native-release.yml` tonight.** CI minutes are scarce on this
plan and a red run costs 21 minutes to learn nothing new.

Two of the three defects that PRD names are local, CI-free, and worth the night:

1. **The version mismatch.** The binary printed `Version: 0.1.13` while the tag under test was
   `runtime-native-v0.1.14`. If that reproduces, **a user who downloads `v0.1.14` gets
   `0.1.13` binaries** — a packaging defect, diagnosable from the workflow and the build
   scripts without running the workflow. Root-cause it; do not guess at it.
2. **The invisible failure.** The consumer-proof step redirects the game's output to a file
   and only greps it, so ten red runs produced a diagnostic nobody saw without downloading an
   artifact. Echo the log on failure. One edit, no run needed to justify it.

The Vulkan ICD fix itself may be **written** tonight and must not be **claimed** — it is
unverified until a runner executes it, and the PRD says so.

## Night scope for PRD-084 — read before touching it

Run **Phase 0 only**: a throwaway spike in `docs/spikes/`, using a scaffolded project and the
agent binary already on this machine. It produces three numbers — did play state survive an
agent's edit, how many seconds from sentence to visible change, how many lines of glue it took.

**Do not create `packages/studio/`, add a dependency, or edit `pnpm-workspace.yaml` tonight.**
The package needs an owner decision because it reopens the charter's closed "an editor"
question, and the gate in [CONFLICTS.md](../../strategy/CONFLICTS.md) row 1 is that Studio
starts only after a stranger has played a game for five minutes — which has not happened.

`git status` after Phase 0 should show changes under `docs/spikes/` and nowhere else.
**"Do not build this" is a valid Phase 0 conclusion** and costs one spike to reach.

## Stop rules

- **Never claim a gate you did not run.** Paste the failure. "Unverified" is an acceptable
  night result; "verified" without a run is not.
- **A negative control that was not observed red does not count.** Every PRD here names its
  controls; a phase whose control was skipped is not done.
- **WebGPU on this host needs `xvfb-run -a -s '-screen 0 1600x900x24'`.** Headless Chromium
  renders the canvas blank and the page still loads, so a blank screenshot reads as a styling
  bug rather than a GPU failure. A run that never reached its assertions exits `2` and is
  recorded as **unmeasured**, never as a pass and never as a red.
- **Name the layer before the fix.** Engine bug → `packages/`. Game bug → the example or the
  template. Every item in this batch was filed as an engine bug; if one turns out to be a game
  bug, say so and stop rather than patching around it.
- **Each PRD stops at its own phase boundary.** PRD-082 Phase 2 and PRD-083 Phase 1 are both
  conditional on a Phase 0 number. No number, no phase.

## Do not, overnight

- Run a fifth genre sweep or rerun either benchmark arm. The kill switch is recorded in
  [round-4-2026-08-10.md](../../verification/round-4-2026-08-10.md) and holds.
- Edit `ROADMAP.md` Phase 2, the beta bar, or any gate wording. That needs an owner decision
  and is deliberately not in this batch.
- Edit any file under `packages/create-threenative/templates/` for PRD-083. The subject is
  which template a user gets, not what is in one. **PRD-083 carries a binding no-regression
  constraint** — nothing may behave differently except which template a no-flag scaffold
  produces. Re-run its caller census before the one-line edit; an implicit caller stops the
  phase and the change downgrades to printing the choice instead.
- Touch `examples/abyss-vanilla/`. It is the frozen benchmark control.
- Push tags, publish to any registry, or trigger a GitHub workflow.

## Done means

For each PRD that lands: `pnpm typecheck && pnpm lint && pnpm test` green, the phase's
playtest or template gate green, every negative control observed red with its command, a dated
file in `docs/verification/`, and the PRD's status line updated with what was executed and
what was not. A PRD finished end to end gets `git mv`'d to `docs/PRDs/done/` in the same
commit that finishes it.

A morning report that says *"PRD-081 shipped, PRD-082 Phase 0 unmeasured because the WebGPU
run exited 2, PRDs 083 and 078 untouched"* is a good night. A report that says four PRDs are
done without four verification files is not.
