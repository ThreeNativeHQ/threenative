# PRD-140 scene-collapse picking verification

Date: 2026-08-17

**Layer: engine.** `SceneCollapse` removed authored meshes from the live graph, so the
framework—not a game—owned the broken picking contract.

## Pre-fix reproduction

The §2 fixture created 250 static `THREE.Mesh` objects, put
`{ target: "picked" }` on one, ran `SceneCollapse` past its 200-mesh floor, and raycast the
same target before and after the pass.

Command, run before the fix: `pnpm exec tsx -e '...'` with the fixture above.

```text
{"report":{"status":"applied","collapsed":true,"sourceMeshes":250,"mergedMeshes":1},"before":{"object":"target","userData":{"target":"picked"}},"after":{"object":"","userData":{}},"target":{"parent":null,"userData":{"target":"picked"}},"graphMeshes":1,"reachableTarget":false,"reachableUserDataMeshes":0}
```

Pre-fix behavior: collapse applied, removed the target from the scene graph, and returned an
anonymous merged mesh with empty `userData`; the held target reference became an orphan.

## Change

Meshes with non-empty `userData` are now preserved by the existing eligibility walk and counted
under `diagnostics.skipped.userData`. Unannotated meshes remain eligible for the merge.

## Gate evidence

| Gate | Result |
| --- | --- |
| `pnpm vitest run packages/core/__tests__/collapse-picking.spec.ts` | PASS — 3 tests; 250 meshes with 5 annotated: 5 live/raycastable with target metadata, 245 baked into 1 merged mesh; 250 unannotated meshes still collapse into 1 merged mesh; annotated camera-parented mesh remains raycastable |
| `pnpm --filter @threenative/core test` | PASS — package build, declarations, and publint |
| `pnpm --filter prd140-picking test` | PASS — committed fixture production build |
| Browser picking playtest, hardware WebGPU | PASS — committed `examples/prd140-picking` fixture; 250-mesh game reports `meshCount:250` and changes `pickedTarget:0` to `1`; adapter `turing / nvidia` |
| `--target desktop` | BLOCKED before execution — current playtest CLI rejects the target with `Unknown target 'desktop'. Expected 'browser', 'android', or 'ios'.`; the PRD-scoped files do not include the runner |
| `pnpm typecheck` | PASS — all 12 workspace projects |
| `pnpm lint` | PASS — full repository check; 202 existing warning-level complexity diagnostics, no errors |
| `pnpm sync:agents --check` | PASS |
| `pnpm test` | BLOCKED — 133 files passed / 1 failed and 1,215 tests passed / 1 failed; pre-existing `packages/physics/__tests__/actuation.spec.ts` expects `src/` 38,082 lines while the committed record/measured tree is 38,095; no native file is in this lane |

Browser command (committed fixture, hardware WebGPU):

    pnpm --filter @threenative/core build
    pnpm --filter @threenative/playtest build
    pnpm --filter prd140-picking build

    DISPLAY=:0 XAUTHORITY=/run/user/1000/xauth_chvqoR node packages/playtest/dist/runner/cli.js playtests/picking.playtest.json --project examples/prd140-picking --url http://127.0.0.1:4176 --server-command 'pnpm dev --host 127.0.0.1 --port 4176 --strictPort' --browser-recipe webgpu --headed --timeout 30000

Result: exit 0, `pass: true`; `pickedTarget` changed from 0 to 1 and the adapter was `turing / nvidia`.

Desktop command:

    node packages/playtest/dist/runner/cli.js playtests/picking.playtest.json --project examples/prd140-picking --target desktop --url http://127.0.0.1:4176

Result: exit 2 before a server or runtime launch, with `TN_PLAYTEST_CLI_USAGE` because the
current runner accepts only `browser`, `android`, or `ios`.

## Repair round 2 evidence

The engine fix isolates an authored camera-parented mesh that shares an overlay material before
the camera overlay merge adds its `tnOwnerId` position path. The preserved mesh keeps its original
material sharing after restore, while the merged overlay retains the optimized material and
geometry path. The regression covers the material/geometry seam and confirms the preserved target
still raycasts.

The committed fixture now has `src/game.ts` as its default portable game export. `src/main.ts`
starts that game for the browser, preserving the browser mount path; the fixture test also builds
the desktop native bundle from `src/game.ts`.

| Gate | Result |
| --- | --- |
| `pnpm --filter prd140-picking typecheck` | PASS |
| `pnpm --filter prd140-picking test` | PASS — Vite browser build and desktop native bundle build |
| `pnpm typecheck` | PASS — all 12 workspace projects |
| `pnpm lint` | PASS — 203 warning-level complexity diagnostics, no errors |
| `pnpm sync:agents --check` | PASS |
| Browser picking playtest | PASS — exit 0; `meshCount:250`, `pickedTarget:0` to `1`, clean diagnostics |
| Desktop project-mode native conformance | PASS — web reference and desktop comparison; 1 pass, 0 failures, 0 blocked; 300 frames, NVIDIA Vulkan/V8, no GPU validation errors |
| `pnpm test` | BLOCKED — 133 files passed / 1 failed and 1,215 tests passed / 1 failed; stale native LOC census in `packages/physics/__tests__/actuation.spec.ts:262` expects `src/` 38,082 but measures 38,095 |

Desktop native commands:

    node packages/runtime-native/conformance/run-conformance.mjs --project examples/prd140-picking --target web --out .runtime/prd140-picking-web-reference
    node packages/runtime-native/conformance/run-conformance.mjs --project examples/prd140-picking --target desktop --reference /home/joao/projects/threenative/threenative-engine/.worktrees/prd-140-scene-collapse-breaks-picking/packages/runtime-native/.runtime/prd140-picking-web-reference --out .runtime/prd140-picking-native-compare-absolute

Result: both commands exit 0; the desktop report records `pass:1 fail:0 blocked:0`.

## Resolved file set

- `packages/core/src/collapse.ts`
- `packages/core/__tests__/collapse-picking.spec.ts`
- `examples/prd140-picking/`
- `packages/create-threenative/templates/starter/AGENTS.md`
- `packages/create-threenative/templates/starter/CLAUDE.md` (generated mirror)
- `docs/verification/prd-140-scene-collapse-breaks-picking-2026-08-17.md`
