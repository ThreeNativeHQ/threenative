---
prd_contract: v1
---

# PRD-158 — The harness tells the agent how to switch its own guard off

**Status:** DONE, 2026-08-19. The baseline counts in §1 were measured on 2026-08-18; the
reasoned waiver schema, report accounting, all-waived failure, registry audit, live migration,
and template gate are complete. Executed evidence:
[prd-158-triviality-opt-out-2026-08-19.md](../../verification/prd-158-triviality-opt-out-2026-08-19.md).

**Outcome:** a scenario can still hold an invariant that is true from frame zero, but it can no
longer do so silently, for free, or on the harness's own suggestion — the opt-out carries a written
reason, the report counts it, and a scenario whose every assertion is opted out fails instead of
passing.

**Depends on:** nothing. `TN_PLAYTEST_ASSERTION_TRIVIAL` and the `allowTrivial` key already exist
and already work.

**Blocks:** nothing. Pairs with [PRD-156](../batch-26-08-18/PRD-156-engine-ships-conventions-by-default.md), whose
incident section names this failure but repairs it only inside one game.

**Complexity: 5 → MEDIUM mode.** One schema field change with a migration across 40 live call
sites, one report field, one new failure condition, one registry audit across 21 entries.

**Blast radius: ~60 files.** `packages/playtest/src/{scenario.ts,assertions.ts,report.ts}`,
`packages/playtest/__tests__/*.spec.ts`, every `playtests/*.json` under
`packages/create-threenative/templates/` and `examples/`, and the templates' `AGENTS.md`.

---

## 1. The defect

This repository's stated first rule of verification is **fail closed**: "a check that reports
green while asserting nothing" is named as the most dangerous failure here, and v1 died of it.
The harness implements that rule, and then ships a one-word switch that turns it off.

### 1.1 The guard works. The escape hatch is free.

When an assertion is already satisfied before the scenario runs, `assertions.ts` raises
`TN_PLAYTEST_ASSERTION_TRIVIAL` and fails the row. The diagnostic reads:

> Drive the asserted value from a failing initial state, assert `changed:true`, or set
> `allowTrivial:true` with a documented held-invariant reason.
> — `packages/playtest/src/assertions.ts:2041`

Three options, and the third costs one line. **The failure message is a working set of
instructions for defeating the check that produced it.** An agent that hits this diagnostic
mid-build does not weigh three options; it takes the one that turns the red row green.

The phrase "with a documented held-invariant reason" describes a discipline the schema does not
implement. `allowTrivial` is `boolean | undefined` (`scenario.ts:101`). There is nowhere to put the
reason, nothing checks that one exists, and no report shows that one is missing.

### 1.2 It is not a corner case. It is how the gates are written.

| Where | `allowTrivial: true` occurrences | Documented reasons |
|---|---:|---:|
| `packages/create-threenative/templates/*/playtests/` and `examples/*/playtests/` | **40** | **0** — the field cannot hold one |
| `~/projects/threenative/sandbox/fps-framework/playtests/`, 8 of 15 scenarios | **18** | **0** |

The templates are the gates every scaffolded project inherits and the examples an authoring agent
copies from. The pattern it learns from reading them is that `allowTrivial: true` is ordinary.

### 1.3 The measured consequence

`fps-framework/playtests/death-no-snap.playtest.json` — the scenario written to protect the death
animation — asserts six components, and sets `allowTrivial: true` on **all six**:
`deathObserved`, `deathAnkleDelta`, `deathClipFrames`, `deathClip`, `deathFallDot`,
`lastHitMultiplier`.

When `Enemy.update()` stopped calling `#animation.update(dt)` while dead, the corpse froze. The
gate stayed green: a body that never moves satisfies `deathAnkleDelta <= 0.02` perfectly, and the
guard that exists to catch exactly that had been waived in the same file. **The gate went green by
deleting the feature it was written to protect**, and nothing in the run said so.

### 1.4 The opt-out is recorded and then thrown away

When a row passes on the waiver, the result gains `trivialityOptOut: true`
(`assertions.ts:884`, `assertions.ts:1959`). Grep the package: those are the only two occurrences.
Nothing reads it. It reaches no summary line, no report field, no exit code and no CI signal. A run
where every assertion was waived is byte-indistinguishable, at the level anyone looks, from a run
where none was.

### 1.5 And the guard only covers 3 of 21 assertion kinds

`PLAYTEST_ASSERTION_REGISTRY` carries a `triviality` field per kind. Counted on the tree:

| `triviality` | Count | Kinds |
|---|---:|---|
| `reject-initial-value` | **3** | `components`, `resources`, `hud` |
| `not-applicable` | **18** | `framebufferCoverage`, `reachability`, `aerodynamics`, `visual`, `movement`, `camera`, `tags`, `signals`, `states`, `overlayNodes`, `diagnostics`, `performance`, `visibility`, `world`, `contacts`, `settled`, `occluded`, `animation` |

Several of those 18 are genuinely not applicable — `framebufferCoverage` samples a window, and
`performance` reads an aggregate. Several plainly are applicable and are labelled otherwise:

- `states: [{ equals: "completed" }]` passes when the entity was already `completed` at step 0.
- `animation: [{ clip: "run", entered: true }]` passes when `run` was the clip already playing.
- `visibility: [{ present: true }]` passes for anything that existed before the scenario started.
- `settled`, `occluded` and `tags` are held invariants by construction.

Nothing in the codebase justifies any individual `not-applicable`. It is a value in a literal, and
`not-applicable` is what a new entry gets by copying the entry above it.

### 1.6 Name the layer

**This is an engine bug in the harness**, not a game bug in any scenario that used the key. The
scenarios did what the tool's own error message told them to do. Fixing this inside
`death-no-snap.playtest.json` buys one green run and leaves every other game with the same switch
and the same instructions for finding it.

---

## 2. The fix

Four changes. None adds an assertion, a comparator, or a capability.

### 2.1 The waiver carries its reason

`allowTrivial?: boolean` becomes `allowTrivial?: string` — the held-invariant reason, required
non-empty, minimum length enforced by the schema so `"x"` does not pass for prose.

```json
{ "entity": "enemy", "component": "deathAnkleDelta", "lte": 0.02,
  "allowTrivial": "the ankle is measured against its pre-death position; a delta of 0 is the pass condition, not the initial state" }
```

`allowTrivial: true` becomes a scenario error naming the new shape. Fail closed on the migration
too: a boolean is not silently coerced.

### 2.2 The failure message stops advertising the switch

`trivialAssertionDiagnostic`'s `suggestion` leads with the two repairs and states the waiver last,
as what it is:

> Drive the asserted value from a failing initial state, or assert `changed: true`. If the value is
> genuinely a held invariant, `allowTrivial` takes the reason it is held — it is recorded in the
> report and counted against the run.

### 2.3 The report counts waivers, and an all-waived scenario fails

- `IPlaytestReport` gains `trivialityOptOuts: { id: string; reason: string }[]`, populated from the
  `trivialityOptOut` flag that is already computed and discarded.
- The CLI prints the count on every run, including passing ones.
- **New failure, `TN_PLAYTEST_SCENARIO_ASSERTS_NOTHING`:** a scenario whose triviality-eligible
  assertions are *all* waived exits non-zero. `death-no-snap` is that scenario, exactly.

### 2.4 Every registry entry justifies its `triviality`

`IPlaytestAssertionSchemaEntry.triviality` gains a required sibling, `trivialityRationale: string`,
so the value cannot be inherited by copy-paste. The 21 entries are then audited one at a time and
each `not-applicable` either keeps the label with a written reason or becomes
`reject-initial-value`. `states`, `animation`, `visibility`, `settled`, `occluded` and `tags` are
the ones this PRD expects to move; the audit decides, and its result is recorded in §3.

---

## 3. Execution phases

Checkpoint after each. A later phase does not start on an unrun earlier one.

**Phase 0 — reproduce.** Restore the frozen-corpse defect in a scratch copy of the sandbox game,
run `death-no-snap` unmodified, and record the green result and its exit code. Without this, the
rest is a refactor with no failing test behind it.

**Phase 1 — the reason string.** §2.1 plus §2.2. Migrate all 40 in-repo call sites, writing a real
reason for each; any site where no honest reason can be written loses the waiver and the assertion
is repaired instead. Report how many of the 40 fell into each bucket — that number is the finding.

**Phase 2 — the report and the new failure.** §2.3. Phase 0's scenario must now exit non-zero, and
the recorded output is the proof.

**Phase 3 — the registry audit.** §2.4. One row per kind, with its rationale, in this PRD.
Re-run every template gate; each newly-guarded kind that turns a template red is a real trivial
assertion in a shipped template and is repaired, never re-waived.

**Phase 4 — the templates teach the rule.** The `AGENTS.md` line covering playtests states that a
waiver needs a reason and that an all-waived scenario fails. Coordinate with
[PRD-151](./PRD-151-shared-template-agent-docs.md) if its shared-fragment directory has landed;
otherwise seven edits.

### Audit table — 2026-08-19

The lane baseline contained 39 live boolean waiver entries under `packages/` and `examples/`
(the §1 prose count of 40 was one higher than the tree). All 39 were converted to reason strings;
no waiver was retained without an honest reason. The registry audit added guards to six kinds, and
the newly guarded lane rows were migrated with 18 additional reason strings. The integrated tree
also includes three platformer playtests already present on the current main branch; its newly
guarded web visibility row received one additional written reason during integration. The final
integrated census is 90 playtest files, 58 waiver entries, 0 booleans, 0 short reasons, and 0
invalid reasons. Archived `docs/benchmark/sweeps/` files were not migrated.

| Kind | Triviality | Rationale |
| --- | --- | --- |
| `framebufferCoverage` | not-applicable | Samples a window-wide framebuffer over a labeled interval; a static initial value cannot satisfy the temporal pixel-evidence contract. |
| `reachability` | not-applicable | Compares authored platform geometry with a measured movement envelope; no runtime initial value is asserted. |
| `aerodynamics` | not-applicable | Requires force telemetry and signed control delivery across samples; no held initial scalar can satisfy the proof. |
| `visual` | not-applicable | Requires screenshot evidence from a capture; the initial scene alone cannot satisfy its frame-difference or region contract. |
| `movement` | not-applicable | Measures transform displacement under scenario input; an initial pose cannot itself prove movement. |
| `camera` | not-applicable | Checks a camera-to-target relationship from runtime observations; the registry keeps this relationship outside the held-value guard. |
| `components` | reject-initial-value | A component comparator can pass on its initial snapshot, so initial satisfaction must be rejected unless a written held-invariant reason is recorded. |
| `resources` | reject-initial-value | A resource comparator can pass on its initial snapshot, so initial satisfaction must be rejected unless a written held-invariant reason is recorded. |
| `tags` | reject-initial-value | A tag count can already equal its expected initial count; the scenario must prove a transition or document why that count is intentionally held. |
| `signals` | not-applicable | Requires an emitted signal event; an initial state contains no matching event evidence to satisfy the assertion. |
| `states` | reject-initial-value | An entity can already be in the expected state at step zero; the scenario must prove a transition or document why the state is held. |
| `hud` | reject-initial-value | A HUD value can satisfy its comparator before input, so initial satisfaction must be rejected unless a written held-invariant reason is recorded. |
| `overlayNodes` | not-applicable | Reads a declared overlay DOM snapshot; browser overlay setup state is not treated as a gameplay held invariant. |
| `diagnostics` | not-applicable | Evaluates captured error and readiness channels across the run; no initial scalar value can satisfy those diagnostics by itself. |
| `performance` | not-applicable | Reads aggregate render samples such as frame time and draw calls; an initial value cannot stand in for the measured series. |
| `visibility` | reject-initial-value | An entity can be present and in-frame before input; the scenario must prove visibility after setup or document why that presence is held. |
| `world` | not-applicable | Checks configured world identity and runtime fingerprint data; those environment facts are not a mutable assertion value. |
| `contacts` | not-applicable | Requires retained contact evidence from the run; a pre-existing value cannot manufacture an emitted contact event. |
| `settled` | reject-initial-value | A body can begin asleep and already satisfy the settled bounds; the scenario must prove settling or document why the rest state is held. |
| `occluded` | reject-initial-value | A static scene can already produce the requested occlusion; the scenario must prove the ray result or document why the occlusion is held. |
| `animation` | reject-initial-value | A clip can already be playing at the first sample; an entered assertion must prove a transition or document why the clip is held. |

Phase 0 and the negative controls produced this observed-red output:

```text
TN_PLAYTEST_SCENARIO_ASSERTS_NOTHING
Scenario 'death-no-snap' waived every triviality-eligible assertion, so it asserts nothing independently of its initial state.
"pass": false
ACTUAL_CLI_EXIT=1
```

The final manager gate was `pnpm typecheck && pnpm lint && pnpm test && pnpm test:templates`.
It exited `0`: 148 test files / 1,400 tests passed, and all seven scaffolded template suites
passed. Integration also exposed a startup race where the browser bridge appeared before an
async scene load had started its fixed-step loop; the runner now retries only that exact error for
a bounded number of browser frames and still fails closed if the loop does not start. Lint
retained 229 existing warn-level cognitive-complexity diagnostics and no errors.
The complete command output and focused negative controls are in the linked verification record.

---

## 4. Acceptance criteria

1. `allowTrivial: true` is a scenario error; `allowTrivial: "<reason>"` is accepted and the reason
   appears in the report. Unit tests for both.
2. Phase 0's frozen-corpse scenario exits non-zero under `TN_PLAYTEST_SCENARIO_ASSERTS_NOTHING`,
   with the run output pasted into this PRD.
3. Zero `allowTrivial: true` booleans remain under `packages/` and `examples/`; every surviving
   waiver has a reason a reader can check.
4. All 21 registry entries carry a `trivialityRationale`; the audit table is in §3 with the
   reclassifications named.
5. `pnpm typecheck && pnpm lint && pnpm test` green, and `pnpm test:templates` green, each pasted.

Archived benchmark sweeps under `docs/benchmark/sweeps/` are **not** migrated. They record the API
as it was on the day the evidence was taken and are not live scenarios.

---

## 5. What this does not claim

- No mobile, iOS, Android or physical-device claim. Every gate above runs on this machine.
- It does not add, remove or rename an assertion kind, comparator or capability.
- It does not assert that the 18 unguarded kinds are all wrong — only that none of them has ever
  had to say why it is right, and that the audit is the work.
- It does not repair `fps-framework`. Phase 0 uses a scratch copy; the game-side repair is
  PRD-156's Phase 5.
