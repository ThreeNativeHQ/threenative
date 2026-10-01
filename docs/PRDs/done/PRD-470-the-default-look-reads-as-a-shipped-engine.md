# PRD-470 — the default look reads as a shipped engine

**Status: DONE — all 3 phases landed and verified on the merged base `b35afc8b5`** · filed 2026-09-28 against `3788ce79e` · owner goal: "make it look like
Unreal by default — AAA, 'wow, this looks polished'; baseline assets allowed if the library does not
grow much."

## Why

Measured at `3788ce79e` (headed WebGPU, RTX 2080, 1280×720, scaffolded from local tarballs):

- `minimal`: a floating slab in a grey-blue void, a faceted dim sky, black box "mountains". No
  image-based light, no ambient occlusion, no antialiasing.
- `starter`: washed-out pastel painterly pass (kuwahara + watercolor + outline) over flat colours.
- Every template: the post chain renders `pass(scene, camera)` **single-sampled**, so as soon as any
  stage runs, the renderer's MSAA no longer reaches the frame — every edge is aliased. No template
  sets `scene.environment`, so every `MeshStandardMaterial` has no specular environment at all and
  reads as matte plastic. Every sky is a hand-rolled vertex-colour dome.

What makes the Unreal first frame read as "polished" is a short list, all of it available in
`three@0.185.1` and none of it an asset: a physical sky with a sun disk, the same sky as the image
light on every surface, soft sun shadows with contact occlusion, clean antialiased edges, a filmic
tone curve with bloom, and distance fading into the sky rather than into a void.

## Where it goes

All of it decides how things look, so it ships as generated source in `templates/*/src/render/`
(rule 1b). The one shared file, `worldEnvironment.ts`, gains an antialiasing stage so every template
gets clean edges from the same code. No new package, no new dependency, no new asset bytes.

## Phases

### Phase 1 — `minimal` becomes the reference frame, and every chain antialiases

- [x] A photo sky (Poly Haven, CC0, 4k JPEG 282 KB) is the background, the environment light and the fog colour; the sun is aimed at the photographed sun. proof: `sky` scenario pass (tt-minimal2, 2026-09-28); capture `minimal-08-ground-bounce.png`
- [x] A UE-style test arena: light/dark metre-grid materials with world-metre UVs, bevelled walls/deck/ramp/pillar, blue crates, trimesh colliders via `buildStaticColliders`; Quaternius mannequin (CC0, 665 KB) with a follow camera; camera-centred `VirtualShadowNode` on WebGPU. proof: captures `minimal-06..08`; `TN_VIRTUAL_SHADOW` reuse 0.997
- [x] `worldEnvironment.ts` antialiases (SMAA, Godot `screen_space_aa`) whenever a chain is installed and reports it; GTAO is denoised; shared-source specs updated. proof: `pnpm exec vitest run packages/create-threenative` 777/777 (2026-09-28)
- [x] `minimal` playtests green. proof: `TN_TEMPLATE_ONLY=minimal pnpm test:templates` → exit 0, 4/4 scenarios `pass: true` (`play` 660 frames, `sky` 120, `survives`, `minimal-touch-controls`), 0 diagnostics — 2026-09-30, log `/tmp/pr376-main-minimal-done.log`. `play` measures 50–81 draws and 17,536–36,850 triangles, inside the raised 128 / 80,000 budget.

### Phase 2 — `starter`, the default template, gets the same light

- [x] Starter is a testing scene like `minimal` (grid arena, photo sky, mannequin) keeping its course, pickups, flag, lives and HUD; island, ocean and painterly stages deleted. proof: fresh 1280×720 capture `/tmp/pr376-after/starter.png` (2026-09-30, luminance σ 0.154, 21,174 distinct colours) against the exact pre-PRD baseline `/tmp/pr376-before/starter-baseline-3788ce79e.png` — both handed to the independent judge at the PR
- [x] `starter` playtests green. proof: `TN_GOLDEN_PATH_TEMPLATES=starter pnpm verify:golden-path` → exit 0, 2026-09-30, log `/tmp/pr376-main-starter-golden.log`: the starter's 23 scenarios all `pass: true` (`starter-look`, `starter-assets`, `starter-cloth-flag`, `starter-goal`, `starter-production-readiness`, …) and the alternate-arm negative control (broken dependency) failed as designed.

### Phase 3 — the other templates inherit the recipe

- [x] `shooter` rebuilt from the sandbox `fps-framework` game: its hands kept, every other asset replaced by the shared mannequin, arena and sky. proof: `TN_TEMPLATE_ONLY=shooter pnpm test:templates` → exit 0, 34/34 scenarios `pass: true` (`aim-alignment`, `crouch-lowers-the-eye`, `enemy-rifle-grip`, `enemy-material-is-not-shared`, `headshot-hits-head`, `survives`, …), 0 diagnostics — 2026-09-30, log `/tmp/pr376-main-shooter.log`; fresh capture `/tmp/pr376-after/shooter.png` against baseline `/tmp/pr376-before/shooter-baseline-3788ce79e.png`
- [x] The remaining templates take the environment light and AO; all template playtests green. Every template already ships the shared `worldEnvironment.ts` recipe (photo sky as `scene.environment` and fog colour, one sun, SMAA/AO stage) — `puzzle` is the one documented opt-out. proof: every scaffolded kit green on the merged base `b35afc8b5`, one kit at a time so the GPU lease stays releasable — `TN_TEMPLATE_ONLY=<kit> pnpm test:templates` for `racing` 9, `rts` 7, `runner` 3, `sailing` 8, `shooter` 34, `tower-defense` 11 scenarios, 72 pass / 0 fail, every command exit 0 with its exact `<kit>: scaffolded playtests passed.` marker (2026-09-30, logs `/tmp/pr376-kit-<kit>.log`), plus `action-rpg`, `minimal` and `puzzle` from the single all-templates run on the same base, whose markers are in `/tmp/pr376-main-completed-kits.txt` and whose log `/tmp/pr376-main-alltemplates-merged.log` the owner stopped during `racing` to release the GPU lease — a cancellation, not a failure. That is 9/9 of `TEMPLATE_PLAYTEST_NAMES`; `platformer` and `starter` are the two the suite skips by design (`ALREADY_BOOTED_TEMPLATES`) and keep their golden-path proof above; both re-run on this same base for the same reason — `TN_GOLDEN_PATH_TEMPLATES=starter,platformer pnpm verify:golden-path` exit 0, 39 scenarios pass / 0 fail (`starter-*` 19, `platformer-*` 12, plus the shared boot and performance scenarios) with the alternate-arm negative control failing as designed, log `/tmp/pr376-main-golden-merged.log`. The earlier per-kit receipts were re-run rather than reused because they predate this merge, which changed `packages/playtest/src/runner/*` and `packages/core/src/playtest.ts` — the harness that drives the scenarios, not the template sources, which are unchanged.
- [x] `platformer` becomes the sandbox fox run: the procedural route, fox, walkers and pickups, on the photo sky and one sun, with `buildStaticColliders` for collision and `mergeByMaterial` over the static scenery. proof: 14/14 scaffolded scenarios green, measured 562 draws / 186,016 triangles at 1920x1080 with a 0.5 ms p95 (2026-09-28); `pnpm exec vitest run packages/create-threenative` 796/798 (the two failures are the byte-stable hash the owner recomputes, and `build.spec.ts`'s 60 s default timeout on this machine, which passes at 84 s)

A fresh judge subagent compares blind before/after captures per phase; its verdicts go in the PR
body, not here (R2).

### Acceptance criteria

- [x] A1 — `minimal` reads as the Unreal third-person reference frame: photo sky as background, environment light and fog, one sun, metre-grid arena, trimesh colliders, rigged mannequin, and an antialiasing stage in every chain. proof: phase 1 receipts — 4/4 `minimal` scenarios green, the `sky` and `play` captures, `TN_VIRTUAL_SHADOW` reuse 0.997, `worldEnvironment.ts` covered by the shared-source specs
- [x] A2 — `starter` reaches the same bar without losing its course, HUD or rules. proof: phase 2 receipts — the 1280x720 after-capture against the exact pre-PRD baseline, and 23/23 golden-path scenarios green with the alternate-arm negative control failing as designed
- [x] A3 — the other kits inherit the environment light and AO and stay green. proof: phase 3 receipts — 9/9 of `TEMPLATE_PLAYTEST_NAMES` plus `action-rpg`, `minimal` and `puzzle`, 72 pass / 0 fail across the per-kit logs, and `platformer`/`starter` through the golden-path lane
- [x] A4 — a fresh blind judge graded every before/after pair before the claim was made. proof: its verdicts and scores live in the PR body per R2 and are deliberately not duplicated here; each phase box above names the capture pair handed to it
- [x] A5 — the engine defect this work exposed is fixed in the engine, not worked around in a template. proof: `CollisionShape3D.fromMesh` compared an unscaled geometry centre against scaled dimensions, so it accepted 0.1 m of collider drift at scale 100 and rejected a physically centred 1 µm offset at scale 1e-6; each centre component is now scaled by its own axis, pinned in both directions plus an anisotropic case (`packages/physics/__tests__/character.spec.ts`, 21/21 green)

## Decisions

- Photo sky from Poly Haven instead of the procedural atmosphere: "skybox should be from polyhaven" — owner, 2026-09-28.
- `minimal` is the Unreal third-person test map (grid arena, mannequin, follow camera), and the SCORE/TIME HUD is removed — owner, 2026-09-28.
- The mannequin is Quaternius' Universal Animation Library, recoloured white — owner, 2026-09-28.
- `shooter` is rebuilt from `sandbox/fps-framework`, keeping only its hands — owner, 2026-09-28.
- The AstraCraft RTS template (PRD-471) and racing's vehicle physics (PRD-472) are their own PRDs but ship in this PR: "keep everything in a single PR for simplicity sake" — owner, 2026-09-28 (overrides one-PR-per-PRD for this work).
- Engine fix found on the way: `CollisionShape3D.fromMesh` centres its box on the mesh origin, so off-centre geometry silently gets a displaced collider (it floated the mannequin 0.4 m). The template now uses `buildStaticColliders`; the engine guard is tracked as its own change.
- `puzzle` keeps the warden-vault's own look instead of the default one: "for this one you could have used the same look as on the sandbox, it looks better" — owner, 2026-09-28. So it ships the dark lantern-lit room (three wall lanterns, plaster band, flagstone seams, three crate tints, cyan phase ward and seal, bloom over a 0.85 threshold) instead of the photo sky, the metre grid and the one sun. It is the one template that opts out of this PRD's floor; `lit.playtest.json`'s second region's `maxDarkPixelRatio` moved 0.35 → 0.5 with it, because the reference frame itself measures 0.4432 there.
- 2026-09-30: an independently maintained game port is excluded from this PR entirely — owner decision. Only the shared engine fix it drove (`ae4ce5ce3`, virtual geometry no longer bakes skinned primitives) stays; this batch contains the four remaining PRDs.

- [x] Native desktop proof of the environment light. proof: the scaffolded `rts` and `tower-defense` templates both set `scene.environment` from the photo sky (`src/render/sky.ts`) and both ran green on the real desktop host — `rts-native-orders` `pass: true` (log `/tmp/pr376-main-rts-native.log`) and the tower-defense native lane `runtime: native`, kills 6, 901 frames, non-blank `after.png` (PRD-474 phase 3) — 2026-09-30. Note: `scene.environment` is the equirectangular sky three prefilters itself (PMREM) on WebGPU/native; no template-specific conformance row for a standalone PMREM node exists.
