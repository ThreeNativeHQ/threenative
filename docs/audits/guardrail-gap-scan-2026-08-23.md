# Guardrail gap scan — 2026-08-23

Source document for PRD-215. Method: four parallel read-only scans over the tracked tree
(guardrail inventory; PRD-convention extraction; incident archaeology across
docs/bugs*, docs/verification/, docs/PRDs/; live drift-vector sweep), followed by manual
spot-checks of the load-bearing claims. No source file was modified during the scan.

## 1. What is already guarded

The repo runs ~40 distinct machine-enforced mechanisms (root gate scripts, repo-rule vitest
specs, workflow assertions). Highlights, by enforcement shape:

| Shape | Count | Examples |
| --- | --- | --- |
| Fatal, wired locally + CI | ~20 | capability-docs gate, capability-duplicate detector (`examples --strict`), manifest staleness, ctx-surface/reference `--check`, mirror sync `--check`, census verdict gate, publish preflight, visual gate, golden path, conformance exit rules |
| Fatal, CI-only (no local runner) | 2 | entity-registry boundary (`.github/workflows/ci.yml:310-312`), scaffold-hygiene greps (ci.yml golden-path job) |
| Report-only by documented decision | 2 | LOC caps (`budgetTriggers()`), census Lines-column drift (`nativeCensusDrift()`) |
| Report-only, no threshold logic at all | 1 | `pnpm quality` (`scripts/check-quality.ts` prints, always exits 0 unless baseline missing/malformed) |
| Fatal but wired nowhere | 2 | `parity:ledger` (`scripts/check-parity-ledger.ts`), `test:templates` full matrix (local-only; CI proves starter + platformer only) |
| Manual-only lanes | — | `publish:check` (release lane), registry-install proof |

Named enforcement gaps from the inventory: (1) `pnpm quality` never fails, so the
suppression/length baseline has no teeth; (2) the entity-registry boundary exists only as
inline CI shell, invisible to a fully green local run; (3) no git hooks anywhere — local
gates run only because the working agent chooses to; (4) census Lines drift warns forever;
(5) the seven-template playtest matrix never runs in CI; (6) `parity:ledger` is unwired;
(7) nothing between releases notices a missed version bump; (8) LOC trigger crossings
obligate nothing machine-checkable; (9) the golden-path MCP probe is duplicated between
ci.yml inline Node and `verify-golden-path.ts`.

## 2. Live divergence observed on the day of the scan

Three hand-maintained package enumerations have already diverged on main:

| Site | Entries | Difference |
| --- | --- | --- |
| `scripts/visual-gate.ts:35-44` (`LOCAL_FRAMEWORK_PACKAGES`) | playtest, core, **assets**, physics, runtime-native, ui, create-threenative, **engine-mcp** | 8 entries |
| `scripts/profile-starter.ts:107-114` | core, physics, playtest, runtime-native, ui, create-threenative | 6 entries — no assets, no engine-mcp |
| `packages/runtime-native/scripts/profile-production.mjs:249-255` | core, physics, playtest, runtime-native, ui, **studio**, create-threenative | assumes `packages/studio`, which does not exist in this repository (behind an `inRepositoryCheckout` flag) |

The same class already produced a recorded failure: adding `packages/assets` crossed the
framework LOC trigger through an enumeration nobody updated alongside
(`docs/verification/budgets-decommission-2026-08-22.md`; `docs/audits/tech-debt-scan-2026-08-23.md`
findings #4/#25). The derive-from-source pattern already exists in-tree
(`scripts/check-publish-state.ts:53-58`, `make-sandbox.ts` walk `packages/`).

Other live counts from the sweep: ~112 hand-pinned dependency versions across the seven
templates with zero `catalog:` usage (checked for cross-template consistency only inside the
release lane); the runtime-native version carried twice (`package.json` vs `CMakeLists.txt`)
with no cross-check on main; ~19 suppressions repo-wide (healthy, uncapped); ten TS files
past 700 lines led by `physics/src/simulation.ts` (1244); 39 TODO/FIXME markers concentrated
in runtime-native input/canvas stubs; core TS touches bare browser globals at 13 sites while
runtime.cpp installs the shims, with the allowed-set contract living as prose only.

## 3. Recorded incidents, grouped by debt class

Twenty-one recorded incidents reduce to five recurring classes. Sources are in-tree.

| Class | Incidents | Example records |
| --- | --- | --- |
| C1 — One fact maintained by hand in many places | 7 | package-list LOC miss (budgets-decommission-2026-08-22); census row retyped 9 468 vs measured 9 516 reded main and the fail-fast cascade hid the parity gate behind it (tech-debt-audit-2026-08-20 §1-2); optimizeModels vs asset pipeline (c2c86cf3); catalog: leaked into packed tarballs (mobile-stability bug 7); webp preflight refusing a capability the build had (mobile-stability bug 10); NodeIO config divergence vetoing builds (mobile-stability bug 1); binary 0.1.13 shipped under a 0.1.14 label — version written twice, nothing cross-checked (PRD-078) |
| C2 — Evidence recorded beyond what executed | 5 | visionOS posing as iOS evidence (PRD-065); zero surviving releases across ten tags (PRD-078); published install falling back to a release that never existed (mobile-stability bug 6); shadows "refuted" by comparing a build to itself (mobile-stability bug 3 correction, 03eb1f8b); APK size measured from dirty incremental output (PRD-130 phase 1) |
| C3 — Validation that fails open | 2+ | malformed assertions dropped silently (fixed c4f3bdd1); blank captures scoring pass:true until ruled fail-closed (4c0e2ede); parity comparisons quietly shrinking; residual fail-open validators (tech-debt-scan #1-#3, #16) |
| C4 — Guards built but unwired or blind to their target | 4 | the capability-duplicate detector sat orphaned while the 446-line reinvention recurred (PRD-157); iOS path filters excluded the very packages the app bundles (PRD-065); fail-fast cascade swallowing later gates (tech-debt-audit §2); advisory health report accidentally holding veto power (mobile-stability bug 1) |
| C5 — Environment-sensitive measurement | 3 | GPU speed flipping playtest verdicts (playtest-results-depend-on-render-speed-2026-08-15); SwiftShader impersonating hardware WebGPU across three sweeps; xvfb-run stealing the real exit status |

## 4. Candidate guardrails derived from the scan

Each candidate closes one class at one enforcement point, using patterns the repo already
trusts (derive from source, `--check` in `pnpm budgets`, fail-closed schemas):

| # | Invariant | Enforcement point | Closes |
| --- | --- | --- | --- |
| L1 | Package enumerations are derived from `packages/`, never retyped | shared helper + `pnpm budgets` check | C1 (live divergence above) |
| L2 | Template pins equal workspace versions; third-party pins uniform across templates; runtime-native version single-sourced | new check in `pnpm budgets` | C1 (0.1.13-under-0.1.14; 112 unchecked pins) |
| L3 | New/growing suppressions and lint-coverage holes fail; lengths stay report-only | `pnpm quality` gains fatal semantics | C3 (quality baseline toothless) |
| L4 | The entity-registry boundary and scaffold hygiene run locally, from one implementation | script invoked by `pnpm budgets`; ci.yml calls it | C4 (CI-only guard invisible locally; MCP-probe duplication) |
| L5 | Every bare browser global used by framework TS is installed by a native shim or allowlisted with a reason | shim manifest + checker | C1/C4 (prose-only shim contract) |
| L6 | Parity ledger transcription checked in CI; census Lines drift fatal past a small tolerance | native-platforms.yml + `nativeCensusDrift()` | C4/C1 (unwired verifier, eternal warning) |

Unknowns left open at scan time: whether `profile-production.mjs`'s `studio` entry is
intentional cross-repo behaviour (it sits behind `inRepositoryCheckout`); the exact set of
bare globals framework TS relies on (needs the L5 investigation); what tolerance keeps the
census bound from fighting legitimate regeneration.
