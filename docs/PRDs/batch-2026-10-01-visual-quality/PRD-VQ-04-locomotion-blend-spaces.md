---
prd_contract: v1
---

# PRD-VQ-04 — Locomotion blends by speed and direction without restarting its gait

**Status:** PARTIAL — 2026-10-02. The existing crossfade interruption defect is repaired and unit-tested; continuous blend spaces and platform qualification remain open.
**Batch:** [Visual quality execution batch](https://github.com/ThreeNativeHQ/threenative/blob/docs/visual-quality-batch-2026-10-01/docs/PRDs/batch-2026-10-01-visual-quality/README.md). **Wave:** 1 / character motion.
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

All proof paths below are **planned implementation targets**, not existing passing tests. Reuse an existing equivalent test or scenario after inspecting current code, and update the canonical proof path rather than adding a duplicate. Follow [EXECUTE.md](https://github.com/ThreeNativeHQ/threenative/blob/docs/visual-quality-batch-2026-10-01/docs/PRDs/batch-2026-10-01-visual-quality/EXECUTE.md) for fixture setup, variables, review and repository gates.

### Phase 1 — Continuous weights with explicit boundaries

- [ ] Implement and test deterministic 1D and 2D weight evaluation, including degenerate and out-of-domain inputs. proof: `pnpm exec vitest run packages/core/__tests__/vq-locomotion-blend-spaces.spec.ts`.
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

A license-clear multi-clip rig is required. Use repository-owned fixtures where possible; downloading commercial animations is not assumed.

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
