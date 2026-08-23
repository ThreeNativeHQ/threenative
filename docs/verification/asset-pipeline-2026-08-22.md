# Verification — asset pipeline, 2026-08-22 (PRD-096 model pass)

Executor: `prd096-models` lane, worktree `.claude/worktrees/asset-pipeline`, branch
`lane/asset-pipeline`. Nothing below was taken from another run; every line quotes output
observed in this session.

## What executed

| Gate | Result | Evidence |
| --- | --- | --- |
| `npx vitest run packages/assets packages/core packages/create-threenative/__tests__/config.spec.ts` | **436 passed (42 files)** | includes the 10 new model-pass tests, 2 draco-input tests, 5 new core decoder tests, 5 new config tests |
| `npx tsc --noEmit -p tsconfig.json` (root) + all three touched packages | exit 0 | — |
| `npx biome check .` | exit 0 (249 warnings: the pre-existing repo-wide cognitive-complexity class) | package.json formatting fixed during this run |
| Scaffolded starter, `pnpm build`, models compression on | compile report below | tarball install via local packs |
| `playtests/models.playtest.json` on the scaffolded project (`--browser-recipe webgpu --headed`) | **pass: true** | assertion extract below |

## Compile report (scaffolded starter, compressed)

```
model native-proof.glb (EXT_meshopt_compression, KHR_mesh_quantization): 624 -> 1324 bytes (--112.2%), 1 triangle(s)
models total: 624 -> 1324 bytes (--112.2%)
```

The pennant is one triangle (624 bytes): codec headers and gltf-transform's mandatory
uncompressed fallback buffer exceed savings at that size. Scaling probe over the skinned
fixture's cloth grid shows where the pass pays off:

```
grid    3x2:     5484 ->     7540 bytes (-37.5%)   (toy scale)
grid   24x24:   51056 ->    16496 bytes (67.7%)
grid   64x64:  322752 ->    34316 bytes (89.4%)
grid  128x128: 1263308 ->   100472 bytes (92.0%)
```

## Playtest assertions (compressed run)

```json
"changedPixelRatio": 0.35851888020833333,
"id": "visual.0.frameDiff", "pass": true        // baseline captured with assets.models:"none"
"projectedPixels": 69533.28, "id": "visibility.goal", "pass": true
"consoleErrors": 0, "id": "diagnostics", "pass": true
"id": "movement.distance", "pass": true
"id": "resource.state.status", "pass": true      // status == "won"
"pass": true, "scenario": "starter-models"
```

Baseline capture run (models byte-identical) also passed before the compressed run.

## Negative controls observed red

- Prune dropping referenced geometry → `TN_ASSETS_MODEL_DRIFT: ... triangles 20 -> 12; vertices 18 -> 12; bounding box drifted 63.342%`
- Positions quantized to 4 bits → `TN_ASSETS_MODEL_DRIFT: ... bounding box drifted ...% (tolerance 0.1%)`
- Regression narrowing WEIGHTS to 8 bits → `TN_ASSETS_MODEL_JOINT_QUANTIZED: ... WEIGHTS (4 -> 1 bytes)`
- Decoder wiring removed → GLTFLoader's own `setMeshoptDecoder must be called before loading compressed files`
- Draco-declared input skips transform → file ships byte-identical (control twin of re-emission test)

## Caller census

```
packages/core/src/assets.ts:369: loader.setMeshoptDecoder(MeshoptDecoder);
packages/assets/src/compile.ts:392: ...(models !== undefined ? [modelPass(models)] : []),
packages/assets/src/index.ts:19: export { modelPass } from "./passes/model.js";
```

## Not executed here / open

- Full `pnpm test:templates` across every template and full-repo `pnpm test`: not run by
  this lane (coordinator runs the consolidated gate); scaffold failures inside
  `create-threenative/__tests__/scaffold.spec.ts` observed during this session belong to
  another lane's uncommitted template AGENTS.md edits referencing an uncommitted
  `agent-docs/assertion-reference.md`.
- Native decode path (cgltf cannot read EXT_meshopt_compression): PRD-097's subject; no
  native claim is made here.
