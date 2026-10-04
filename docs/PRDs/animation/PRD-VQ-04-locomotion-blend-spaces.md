---
prd_contract: v1
---

# PRD-VQ-04 — Locomotion blends by speed and direction without restarting its gait

**Status:** PARTIAL — 2026-10-04. Game-owned numerical 1D/2D evaluation and weighted playback have CPU proof; actual two-consumer locomotion and platform qualification remain open.
**Batch:** Visual quality execution batch. **Wave:** 1 / character motion.
**Dependencies:** Uses existing AnimationPlayer, SkeletalMesh3D and stride synchronization. Coordinate its action ownership with VQ-05.

## Grounding and intended outcome

[packages/core/src/animation.ts](https://github.com/ThreeNativeHQ/threenative/blob/d72778382b134ef8763f58825cb4d4fd8cc0f6e3/packages/core/src/animation.ts) already implements clip playback and crossfades. This PRD does not rebuild those. The remaining product outcome is continuously weighted, phase-coherent locomotion across speed and direction. Historical animation-state-machine restrictions remain in force: this is not a graph editor or serialized animation IR.

**Outcome:** A licensed rig moves smoothly from idle through walking to running and strafes in a 2D direction space. Changing direction or speed does not repeatedly restart clips or introduce a one-frame pose pop.

## Design and ownership

Use ordinary Three AnimationActions with one authoritative updater. Put locomotion states, clip selection, thresholds and transitions in editable game TypeScript. Admit shared numerical weight/phase helpers only after two consumers demonstrate less total code. Use sorted intervals for 1D and a deterministic declared interpolation domain for 2D; handle points outside that domain explicitly. Preserve normalized phase for compatible gait clips, with an explicit opt-out for incompatible authored cycles. Do not confuse stride rate with root-motion extraction.

Idle/walk/run and four-direction locomotion only. No motion matching, full Animator graph, visual editor, new asset format or automatic semantic inference from clip filenames.

## Required behavior

- Weights remain finite and nonnegative and sum to 1 within 1e-6; duplicate samples and degenerate 2D domains fail or use an explicitly documented fallback.
- Identical input replay is deterministic, and no independent mixer loop is created.
- A speed sweep preserves gait phase across compatible clips; a large instantaneous intent change has a bounded authored transition.
- Test rapid idle/walk/run/idle reversal and returning to a still-contributing action, not just a fresh third clip.

## Execution phases

All proof paths below are **planned implementation targets**, not existing passing tests. Reuse an existing equivalent test or scenario after inspecting current code, and update the canonical proof path rather than adding a duplicate. Follow [original execution instructions](https://github.com/ThreeNativeHQ/threenative/blob/f95b4ffab0b842dc9a851ab10c719345ec67a6d6/docs/PRDs/batch-2026-10-01-visual-quality/EXECUTE.md) for fixture setup, variables, review and repository gates.

### Phase 1 — Continuous weights with explicit boundaries

- [x] Implement and test deterministic 1D and 2D weight evaluation, including degenerate and out-of-domain inputs. proof: `pnpm exec vitest run --maxWorkers=1 packages/core/__tests__/vq-locomotion-blend-spaces.spec.ts`: 11 CPU tests pass, exit 0 (2026-10-04). Evaluators are editable game source; compatible directional gait assets and actual consumers remain separate open gates.
- [ ] Integrate weighted action ownership and phase synchronization without breaking existing play/once/stride behavior. proof: `pnpm exec vitest run packages/core/__tests__/vq-locomotion-blend-spaces.spec.ts`.
  - Bounded prerequisite verified on 2026-10-02: returning to a still-contributing loop keeps its weight and playback phase; rapid requests before a frame advances no longer manufacture a full-weight outgoing action. `node node_modules/vitest/vitest.mjs run packages/core/__tests__/animation.spec.ts`: 51 tests passed. Continuous 1D/2D weighting and cross-clip gait phase synchronization are not implemented, so this box remains open.

### Phase 2 — Two real locomotion consumers

- [ ] Drive a first-person-visible body and a third-person rig through the same weight/phase mechanism with game-owned settings. proof: `pnpm exec vitest run packages/core/__tests__/vq-locomotion-blend-spaces.spec.ts`.
- [ ] Expose selected clips, weights and phase in existing gameplay observations and verify rapid reversals against sampled poses. proof: `pnpm exec vitest run packages/core/__tests__/vq-locomotion-blend-spaces.spec.ts`.

### Phase 3 — Qualify the visible result

- [ ] The real-rig speed/strafe sweep passes weight, phase and pose-continuity assertions on browser WebGPU. proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/vq-locomotion-blend-spaces.playtest.json --url ${VQ_URL:?} --browser-recipe webgpu`.
- [ ] The identical input trace passes on Linux native; inspect the transition sequence rather than a single still frame. proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/vq-locomotion-blend-spaces.playtest.json --target desktop --executable ${VQ_NATIVE_EXECUTABLE:?}`.

## Acceptance criteria

- [ ] Continuous speed/direction changes require no game-specific replacement mixer, and a same-rig trace produces matching clip weights across the two qualified runtimes. proof: the completed Phase 3 scenario outputs, with the named fixture, package/cohort and adapter recorded inline here.
- [ ] The feature preserves its documented inactive/fallback path and releases owned resources after repeated lifecycle transitions. proof: `pnpm exec vitest run packages/core/__tests__/vq-locomotion-blend-spaces.spec.ts` plus the Phase 3 lifecycle scenario.

## Performance and promotion

Count active actions and allocations. Keep nonparticipants at the existing AnimationPlayer cost and document any extra per-rig work. Numerical targets are proposed acceptance targets, not benchmark results. Pin the fixture, metrics and thresholds before changing the implementation; never relax a failing threshold just to mark this PRD complete. Shared abstractions must pass the repository's reuse/LOC admission rule. Appearance remains editable source.

## Blocked on

The repository-owned Quaternius CC0 mannequin provides Idle/Walk/Jog/Sprint loops and is now reused for the bounded reversal fixture. Compatible directional clips and two actual game consumers remain open for the full 2D blend-space scope; downloading commercial animations is not assumed.

## Completion record

### Bounded interruption repair — 2026-10-02

- Engine layer: reuse `AnimationPlayer` and its existing Three mixer; no public API, state machine, clip choices, second updater, dependency or shared blend-space helper was added. Capability search and details resolved `AnimationPlayer`/`SkeletalMesh3D`; the installed Three pin is 0.185.1.
- Red/green: 44 pre-existing animation tests passed. Two new regressions failed first (returning idle weight fell from 0.5 to 0; a zero-frame idle/walk/run sequence summed to 2). The repaired suite passes 51 tests, including sampled real Three bone poses, deterministic repeated reversals, one-shot/mode replay, immediate cuts, fresh/restarted fades and disposal.
- Fresh/fully faded-out clips and zero-duration cuts still restart. Returning loops retain time only while contributing to a requested fade; explicit one-shots and mode changes still restart.
- Opt-in synthetic fixture: `examples/abyss-framework/?animation-reversal`, scenario `examples/abyss-framework/playtests/animation-reversal.playtest.json`. It records nine requests, weight-sum error, zero-time sampled-bone pose/phase jumps and actual mixer disposal counts. It is a regression fixture, not a licensed real-rig locomotion or aesthetic qualification.
- Browser command (attempted, exit 2: no usable X display/Xvfb, so the runner refused to render): `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/animation-reversal.playtest.json --url 'http://127.0.0.1:5184/?animation-reversal' --server-command 'pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5184 --strictPort' --browser-recipe webgpu`. The portable game entry is `examples/abyss-framework/src/render/animation-reversal-game.ts`; the native bundler produced `dist/animation-reversal-native.js` successfully (96 modules). This proves bundle compatibility only; Linux-native execution is unverified.
- Verification: core build (including declarations, bundled MCP and publint), core/example TypeScript, full repository Biome lint (warnings retained), documentation links (2,395), capability manifest (378 entries) and public API surface (352 symbols) passed. `pnpm test` was attempted with pinned pnpm 10.25.0 and stopped at the lifecycle preflight with `tsx` Unix-socket `EPERM`, before its phases. A separate broad Vitest attempt exposed environment/build-prerequisite failures and is not a passing aggregate gate.
- Runtime screenshot evidence is required before readiness. The scenario names transition-frame captures, but no screenshots were produced in this environment; generated images or test logs are not visual proof.
- All original phase and acceptance boxes remain open. Full blend spaces still need the two-consumer/less-code admission and a license-clear real rig; GPU/native proof and human visual review have not been supplied by these CPU tests.

Update the phase boxes and this PRD only after the named proof runs. Record actual results inline, including any remaining exclusions. A merged planning or implementation PR alone is not proof that every acceptance criterion passed. Archive according to the parent PRD filing rules when the work is genuinely complete.

### Actual mannequin capture preparation — 2026-10-02

- Replaced the synthetic proxy capture with the repository's CC0 `mannequin.glb`, through the real `SkeletalMesh3D`/`AnimationPlayer`. The trace measures all 65 bones across nine Idle/Walk/Jog requests and seven returns to contributing actions. It begins on scenario input and freezes at the requested fixed tick, independent of startup/warmup duration.
- `node node_modules/vitest/vitest.mjs run --maxWorkers=1 packages/core/__tests__/animation-reversal-fixture.spec.ts packages/core/__tests__/animation.spec.ts`: 52 passed. Restoring the pre-fix engine source makes the real-rig check fail (weight error 1). Float32 quaternions are normalized only in diagnostic copies before angular comparison; raw self-angle was 0.000523 radians, not actual pose movement.
- `node --import tsx scripts/verify-animation-reversal.ts --build-only`: the real-rig capture site builds. `tsc --noEmit -p examples/abyss-framework/tsconfig.json` passes. Quality scanning adds no double casts or suppressions.
- Hosted proof target: `Integration animation reversal` runs the maintained public runner on headed WebGPU and records exact source SHA, adapter, per-frame screenshot SHA-256 and measured weights/phases. It rejects errors, missing/non-WebGPU adapters, blank frames and device-loss warnings. Runtime screenshots are pending this job, not claimed by local CPU/build checks. Full blend-space and platform acceptance remains open.

- First real runtime frame: [diagnostic tick 24](../../verification/vq04/diagnostic-tick24.png), [report](../../verification/vq04/diagnostic-report.json), [source/run/adapter/digests](../../verification/vq04/diagnostic-provenance.json). Source `691e917ebb870445415417c5566025f47c81e6a1`, hosted run `36995945428`, SwiftShader WebGPU. Visually inspected the actual full mannequin and gait; the strict run **failed** on one asset-manifest 404 console error. This is diagnostic progress, not qualified proof. The capture build now writes its actual emitted mannequin manifest, and a silhouette-region brightness bound was added; no 404 is suppressed.

### Verified real-rig browser screenshots — 2026-10-02

- Hosted [run 36996637583](https://github.com/ThreeNativeHQ/threenative/actions/runs/36996637583) **passed** at source `a53db062fec7b1b3ae99268470dfa06d15ee3494`, including 53 animation/fixture tests and the strict headed-WebGPU capture verifier. Adapter: Google SwiftShader; this is rendered correctness, not hardware performance or Linux-native execution.
- Actual immutable PNGs: [tick 24](../../verification/vq04/tick-24.png), [tick 25: return to live idle](../../verification/vq04/tick-25.png), [tick 26](../../verification/vq04/tick-26.png), [tick 48](../../verification/vq04/tick-48.png), [tick 108: settled idle](../../verification/vq04/tick-108.png). Each was visually inspected and copied byte-for-byte from the Actions artifact. All five reports pass with zero diagnostics; the bright mannequin silhouette is bounded separately from the floor/background.
- [Runtime measurements and adapter](../../verification/vq04/runtime-summary.json); [source/run/artifact and per-image SHA-256 provenance](../../verification/vq04/provenance.json). Artifact `11222156451`, ZIP SHA-256 `ba1e0cff8e340330f98096695bd9e84840a3e0c15f5659a00e70a08475c91e08` verified on download. Across 65 bones/nine requests/seven returning actions: maximum weight-sum error `2.220446049250313e-16`; phase and local-position jumps `0`; normalized-quaternion jump `4.2146848510894035e-8` radians. Final weights `[1, 0, 0]`, one active action.
- This closes the bounded reversal screenshot milestone only. Continuous 1D/2D blend spaces, two actual game consumers, compatible-gait cross-clip phase synchronization and native qualification remain open. No original phase or acceptance checkbox is ticked from this narrower proof.

### Bounded weighted playback prerequisite — 2026-10-04

- Preserved the unpublished owner source byte-for-byte before integration (SHA-256 `94527e882fc8f636f28329bc1265225b8f2eae349e89c5726cb60d4370d7d907`); the original owner checkout remains unchanged. Added `AnimationPlayer.playWeighted` to the existing authoritative mixer. Games supply clip weights, transition duration and phase-sync opt-out; no clip selection, numerical evaluator, state graph or extra updater entered core.
- Eighteen focused weighted CPU regressions cover finite normalized weights, malformed input without ownership mutation, overflow, outgoing action cleanup, full-duration ramps, per-frame repeated requests, cold starts, contributing gait phase, zero-duration phase transfer, single-clip handoff, one-shot reactivation and stride synchronization when idle is dominant. Reproductions failed before their repairs. Animation plus real mannequin fixture checks pass **71/71**; no new browser or Linux-native result is claimed for the weighted API.
- Exact published `10823978f2d72635b3dd3b08eb5a01e0e0b65d73`, with unchanged tracked source, the same locked dependency topology and its own fresh core build, reproduces inherited root typecheck failures: missing fixture-local Vite URL types and a core/playtest source-versus-dist type identity mismatch. A local Vite type reference and the explicit public `@threenative/core/playtest` source mapping (already used by develop) repair these. Two resolution tests require the source cohort while preserving the private core export boundary; no wildcard alias or package export change was added.
- `pnpm typecheck` passes the root and recursive package/example checks. Core build/declarations/MCP bundles/publint pass. `pnpm exec vitest run --maxWorkers=1 packages/core/__tests__/animation-weighted.spec.ts packages/core/__tests__/animation.spec.ts packages/core/__tests__/animation-reversal-fixture.spec.ts scripts/__tests__/tsconfig-resolution.spec.ts packages/core/__tests__/constraints.spec.ts packages/core/__tests__/build.spec.ts`: **80/80 CPU tests pass**. `pnpm --filter threenative-native-smoke test`: four tests and the one-file/import-free JS bundle contract pass; this runs no native executable. Independent review accepts the bounded code/config delta and separately reran 73 focused tests.
- All six original phase and two acceptance criteria remain open. Numerical 1D/2D evaluation, two actual consumers, real weighted speed/direction pose qualification and identical browser/native input traces remain outstanding. The earlier screenshots qualify only the earlier interruption repair. This PR remains draft. Current develop integration is held for conflicts in the integration workflow and relocated canonical PRD; neither conflict was overwritten.

### Game-owned numerical evaluator slice — 2026-10-04

- `examples/abyss-framework/src/render/locomotion-weights.ts` supplies authored sorted 1D intervals with endpoint clamping and a declared non-overlapping triangular 2D domain with barycentric weights and nearest-edge projection outside it. Boundary ties follow declaration order; authored samples are snapshotted. Duplicate clip names/coordinates, malformed tuples, unused vertices, unsorted intervals, overlapping/degenerate domains and unrepresentable numerical inputs fail explicitly. Domain epsilon is 1e-12 after scaling coordinates by the largest authored absolute coordinate. This is game policy, not a new core export or shared engine numerical abstraction.
- Tests were written before implementation; the endpoint-only baseline failed all nine original cases. A contained-domain regression failed before symmetric validation; independent review exposed malformed tuples, which now fail at construction. The corrected extra-index regression demonstrably fails when only the exact triangle-length guard is reverted. Final canonical suite passes **11/11**; expanded existing animation, weighted, mannequin, core export/boundary and resolution checks pass **91/91 CPU tests**. Focused lint passes without warnings; independent fresh review accepted the bounded evaluator/test delta and reran 11/11.
- The actual CC0 GLB has seven clips: Idle_Loop, Walk_Loop, Jog_Fwd_Loop, Sprint_Loop, Jump_Start, Jump_Loop and Jump_Land. Eleven-test CPU proof includes actual 65-bone Idle/Walk/Jog requests, unchanged request-time sampled poses/contributing action times, repeated per-frame evaluator input, normalized live weights, bounded action counts and disposal through the existing authoritative player. Numerical 2D labels are synthetic domain samples, not evidence of directional animation assets. No forward clip is relabeled as a strafe.
- A first-person-visible body and a third-person locomotion consumer are still absent; existing FPS Range is a synthetic patroller and abyss capture remains a reversal fixture. Compatible licensed left/right/backward gait clips remain unavailable in this GLB. Shared numerical helpers still require actual two-consumer/less-code admission. Browser/native identical speed/strafe traces, allocations/performance qualification and repeated visible lifecycle evidence remain open. No new GPU or native execution occurred; only the first numerical phase checkbox is complete.

- Progress calculator discrepancy: actual counts are 1/6 phase items (16.7%) and 0/2 acceptance, or 1/8 total items (12.5%); no full phase is complete. The existing `scripts/prd-progress.ts` ignores acceptance until readiness and maps any positive phase ratio below 0.5 to the coarse `prd:25%` bucket. Its printed label is not an exact completion percentage. The existing PR percentage label remains unchanged pending the coordinator’s policy correction; no manual percentage was rounded or applied.


## Develop conflict reconciliation — 2026-10-04

- Merged develop `15adf350da53addfa33675c2b3f0e2722e086e37` into published `f95b4ffab0b842dc9a851ab10c719345ec67a6d6`. Accepted the canonical animation PRD location while retaining the original checklist, partial status and historical evidence. The removed batch execution instructions remain linked at their immutable published commit.
- Integration coverage retains every develop lane and the original animation capture job, with weighted playback and authored evaluator CPU suites added. Animation routing uses the current exact-base/head selector; new routing regressions failed twice with develop alone and pass after the union. Focused routing/workflow/animation/mannequin verification: **347/347 CPU tests pass**. This base update adds no consumer or platform acceptance and runs no GPU/native executable.
