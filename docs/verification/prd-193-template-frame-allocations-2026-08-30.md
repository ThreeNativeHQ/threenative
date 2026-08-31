# PRD-193 template frame allocations — 2026-08-30

Lane: `lane-193`

## Scope

This repair closes the two ordinary-frame allocation paths found in review. The deterministic
runtime probe warms each workload for 30 frames and measures exactly 600 frames. Its component
checks cover all seven templates: minimal HUD, starter `Player`, platformer `Character` and touch
controls, racing ranking/lap/sector, shooter `Projectile`, action-RPG `Enemy`, and defense
`Attacker`. Its scene checks now execute minimal `Play`, platformer `Level`, shooter `Play`,
action-RPG `Play`, and defense `Defense` for 600 frames. Racing `Race` has a focused scene
invocation that guards the indexed player scan. The starter `Play` scene is not claimed as a
600-frame scene fixture; its `Player` component remains covered.

The generated-source changes are:

- minimal `Play` reuses its numeric solar-position input, solar result, and state patch;
- core `solarPosition` accepts a mutable result target and avoids the numeric-input helper object;
- platformer `Level` reuses its state patch;
- the earlier platformer dash, racing ranking/lap/scene, and shooter mouse-look repairs remain
  covered; and
- the probe observes vector construction, iterator pipelines, solar input/result identity,
  state-patch identity, scene execution, and ranking tie order.

## Red controls

Each temporary control was restored immediately after its red run. The reported expected value is
the allocation-free result. The racing scene red run restored the old `for...of` scan; the existing
suite stayed green because it did not invoke that scene path.

Before the repair, the runtime-cost command exited 0 with one file and two tests despite those
scene paths being absent. Temporary sentinels then made the cited defects red: minimal produced
600 distinct solar inputs/results and 630 state-patch identities, platformer produced 630
state-patch identities, and the restored racing scan produced one iterator call.

| Workload | Restored construct | Observed red result |
| --- | --- | --- |
| Starter `Player` | `this.#previousPosition.copy(this.mesh.position.clone())` | `clones: 600`, expected `0` |
| Platformer dash | fallback `new Vector3(...)` | `constructors: 18`, expected `0` |
| Racing ranking/lap | `racers.entries()` | `630` `entries()` calls, expected `0` |
| Minimal `Play` solar input | fresh numeric solar input object | `600` distinct measured inputs, expected `1` |
| Minimal `Play` solar result | fresh `solarPosition` result object | `600` distinct measured results, expected `1` |
| Minimal `Play` state | fresh state patch literal | `630` patch identities, expected `1` |
| Platformer `Level` state | fresh state patch literal | `630` patch identities, expected `1` |
| Racing `Race` player scan | `for...of` over ranked racers | `1` iterator call, expected `0` |
| Shooter look state | fresh `{ yawDegrees: ... }` patch | patch high-water `634`, expected `34` |
| Defense counters | two spread/reduce expressions | `1200` `reduce()` calls, expected `0` |

These controls cover the four negative-control groups declared by the PRD: starter/platformer,
racing, shooter/action-RPG, and defense. The red scene run for racing also proves that the focused
regression is sensitive to restoring the old iterator.

## Green evidence

```text
pnpm exec vitest run --config vitest.config.ts \
  packages/core/__tests__/atmosphere.spec.ts \
  packages/create-threenative/__tests__/template-runtime-cost.spec.ts \
  packages/create-threenative/__tests__/platformer.spec.ts \
  packages/create-threenative/__tests__/racing.spec.ts \
  packages/create-threenative/__tests__/shooter-per-item.spec.ts \
  packages/create-threenative/__tests__/action-rpg.spec.ts \
  packages/create-threenative/__tests__/defense.spec.ts \
  packages/create-threenative/__tests__/touch-controls.spec.ts
exit 0 — 8 files, 55 tests passed

pnpm test:playtest
exit 0 — framework-movement, framework-camera, abyss-framework-movement-axis,
abyss-framework-zoom-input, and navigation-routes-around-blocker passed
```

The runtime probe's component checks passed for all seven templates. The 600-frame scene checks
passed for minimal and platformer as well as the existing shooter, action-RPG, and defense paths.
Minimal made 631 total solar calls (initialization plus 30 warmup plus 600 measured frames), with
one input identity and one result identity across the measured frames. Minimal and platformer
each held one state-patch identity. The focused racing scene invocation used the indexed player
scan, produced the expected `P2` state, and observed zero array-iterator calls. The probe also
kept the racing ranking buffer at its racer high-water length and preserved touch-control input
identity.

Pool/high-water evidence is deliberately limited to the ranking buffer and the scene state-patch
fixtures above. The focused fixture does not expose or drive enough lifecycle churn to measure the
shooter projectile pool or defense attacker pool returning to a bounded high-water mark, so no
pass is claimed for those pools.

The browser playtest smoke used WebGPU with this adapter provenance:

```text
architecture: turing
vendor: nvidia
browserArgs: --ozone-platform=x11 --enable-unsafe-webgpu --disable-gpu-sandbox
             --ignore-gpu-blocklist --enable-features=Vulkan
```

`pnpm test:templates` executed 73 scenarios under the repository Xvfb wrapper. The six templates
below completed every scenario:

| Template | Scenarios | Result |
| --- | ---: | --- |
| action-rpg | 7 | passed |
| defense | 7 | passed |
| minimal | 3 | passed |
| platformer | 21 | passed |
| racing | 8 | passed |
| shooter | 6 | passed |
| starter | 21 | blocked by capture guard |

The starter run reached 8 passing scenarios and 13 `TN_CAPTURE_BLANK` results. The failure is
`bright pixel ratio 0.04807` against the existing `0.05` capture threshold. Its `console.json`
files contain no page errors, network errors, or runtime diagnostics, and the adapter is still
NVIDIA/Turing. A supplemental host-display starter run passed 16/21 scenarios and reproduced five
capture failures (`starter-forward`, `starter-look`, `starter-models`, `play`, and `survives`). No
starter source file is changed by this lane, so this remains an unrelated template-render gate
blocker.

The runner attempted before/after screenshots for the template scenarios. No render source,
material, lighting, or camera file was changed in this lane. These are not a controlled before/after
pair for this repair, so no separate pixel-diff or visual-parity result is claimed.

## Repository gates

```text
pnpm typecheck
exit 0

pnpm lint
exit 0 — 1484 files checked, 491 warnings, no errors

pnpm budgets
exit 0 — hard budgets passed; framework/native LOC review triggers were reported

pnpm quality
exit 0 — 95 findings (17 new, 23 grew, 54 inherited, 1 waived); no finding is in this lane's
changed source

pnpm test
exit 1 — documentation-link validation stopped before the unit suite on eight unrelated missing
batch/roadmap links:
docs/PRDs/done/PRD-261-the-release-instruments-report-again.md -> ../batch-2026-08-29/README.md;
docs/PRDs/done/PRD-264-doctor-answers-all-three-questions-a-game-author-has.md ->
../batch-2026-08-29/README.md;
docs/PRDs/mobile/PRD-262-the-runtime-native-prebuilt-release-exists.md ->
../batch-2026-08-29/README.md;
docs/PRDs/mobile/PRD-262-the-runtime-native-prebuilt-release-exists.md ->
../batch-2026-08-29/PRD-263-version-0-3-0-is-installable-by-a-stranger.md (duplicated);
docs/strategy/ROADMAP.md -> ../PRDs/alpha-readiness/README.md;
docs/strategy/ROADMAP.md -> ../PRDs/batch-2026-08-29/FOLLOW-UP-2026-08-30.md; and
docs/verification/prd-229-phase5-crash-policy-conversion-2026-08-29.md ->
../PRDs/batch-2026-08-29/README.md.
```

The focused scaffold checks also found no generated-path change requiring a scaffold assertion
update. Existing unrelated failures remain in the stale scaffold hash and seed-shape assertions;
`scaffold.spec.ts` was intentionally left untouched as required by the PRD.

## Scope checks

```text
git diff --check
exit 0
```

The capability manifests and generated reference were regenerated and pass their sync checks.
The lane is code-complete for the declared allocation controls. The full template gate remains
blocked only by the pre-existing starter capture failure described above; the unmeasured pool and
controlled before/after evidence are recorded rather than treated as passes.
