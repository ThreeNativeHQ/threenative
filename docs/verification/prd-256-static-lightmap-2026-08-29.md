# PRD-256 static-light verification

Run date: 2026-08-29–30. Worktree: `feature-mining-prd256-final-20260829`, based on
`8d0daa3a3b4fe7ab9fa285ba850f4986b4c2de3c` before final integration.

## Phase 0 gates

| Gate | Executed evidence | Verdict |
| --- | --- | --- |
| Licences | Fresh npm tarballs: `xatlas-three@0.2.1` SHA-256 `adaeb731713eabf9413c7636f2a336bf0d30f2b0c0580dd3e2c6f027ff6f7565`; `xatlasjs@0.2.0` SHA-256 `09fa2625afeedcb6beb32d4f2eb809d7d612704eab06aa21cda6ba651f3ab1ad`. Both contain MIT licence files. | pass; only `xatlasjs` is installed in the Node-only assets package |
| No-copy | Official repository inspection still found no repository-level licence for `lucas-jones/three-lightmap-baker`. No source, shaders, constants, or API were copied. | pass |
| Determinism | Two fresh directories compiled the same GLB and PNG. Manifest SHA-256 `0d9fac43bb274b1097b110e2e923003ea67bbeb61aeb217596b833b9072e79ca`, UV2 GLB `7968691a596741ecd6e2b2e43c8615cab18c54744ef3436f56305c97a0787d57`, and KTX2 `26c8b2d42eefee05d32bf61c08dfb48c37ad11e27b0537d05a1d61a017eb2a81` matched. | pass for the admitted UV2 and encoder path; final baked texels need their own Phase 2 red control |
| Mobile blocker | `packages/create-threenative/__tests__/native-ktx2.spec.ts`: 8 tests passed, including Android KTX2 refusal. | mobile remains blocked by `TN_NATIVE_KTX2_UNSUPPORTED`; no mobile-ready claim |
| Plain consumer | A scratch browser page imported `three`, stock `GLTFLoader`, and stock `KTX2Loader`; it read manifest paths, loaded the UV2 GLB and KTX2, assigned `material.lightMap`, imported no `@threenative/core`, and reported `loaded:1` with zero console errors. | pass |

## Direct-light baseline

The required sandbox was created outside the repository at
`/home/joao/projects/threenative/worktrees/sandbox/prd256-static-light` from packed local tarballs.
`static-light-baseline.playtest.json` exited 0 with an NVIDIA Turing WebGPU adapter. The named
`direct-lit-baseline.png` capture was inspected: it is non-blank, in-round, and shows direct-lit
platforms, objects, shadows, and the goal pennant.

| Measurement | Baseline |
| --- | ---: |
| Rendered scene triangles | 1,301 |
| Source proof texture | 150 bytes, 16x16 |
| Compiled KTX2 proof texture | 542 bytes, 5 mip levels |
| Production build wall time | 5.39 seconds |
| Vite bundle phase | 1.47 seconds |
| Runtime frame p95 in settled gameplay windows | 2.4 ms or lower |
| Runtime draw calls in gameplay | 7 |

The scenario initially went red because a global endpoint movement assertion compared the same
post-restart position even though the odometer recorded 10.59 metres. Removing that assertion fixed
the scenario: this baseline proves visual/runtime state, while the later feature scenario owns the
baked-light gameplay rule.

## Phase 1 red-green record

| Control | Red | Green |
| --- | --- | --- |
| Lightmap pass exists | test suite failed to import `passes/lightmap.js` | pass implemented and exported |
| Built-in compiler wiring | first assertion assumed a fixed 128x128 packed extent; actual deterministic extent was 174x153 | manifest asserts positive measured width/height and padding; compiler test passes |
| Standard GLB inspection | `NodeIO` refused the later Meshopt-required GLB without a decoder | test inspects the standard GLB JSON chunk and finds `TEXCOORD_1` |
| Non-indexed primitive | `TN_ASSETS_LIGHTMAP_GEOMETRY_UNSUPPORTED` at `lightmap.ts:117` | deterministic sequential indexing preserves position, normal, UV0, and writes UV2 |

Focused result: `lightmap-pass.spec.ts` has 5 passing tests. It proves UV2 writeback with UV0
preservation, byte determinism across independent pass instances, named animation refusal, and
non-indexed conversion. The fifth regression test proves model pruning retains generated
`TEXCOORD_1` even when no source texture references UVs. The compiler registry test also passes.

## Phase 2 and Phase 3 red-green record

The offline baker rasterizes world position and normal from UV2, evaluates source
`KHR_lights_punctual` lights, queries a build-time `three-mesh-bvh`, dilates chart borders, and
encodes linear ETC1S KTX2 with mipmaps. It uses no wall clock, frame loop, GPU race, or random input.

| Control | Red | Green |
| --- | --- | --- |
| Auxiliary artifact | the pass contract could return only the model buffer | compiler writes `level.lightmap.<content-hash>.ktx2` and records its path/bytes under `lightmaps[]` |
| Occlusion | replacing the blocker query with flat fill makes the left receiver texel equal the lit right texel | BVH blocker test observes left `0`, right `255`, and positive occluded-texel count |
| Dilation | an untouched empty border leaves alpha zero | two deterministic dilation steps populate exactly `validTexels + dilatedTexels` pixels |
| Mip chain | encoder output is parsed, not inferred from its extension | `ktx-parse` reports more than one level |
| Runtime attachment | material `lightMap` remained `null` before manifest consumption | shared KTX2 loader assigns the texture with channel 1 and one support probe |
| Missing UV2 | model load previously resolved | `TN_ASSETS_LIGHTMAP_UV2_MISSING` rejects and attaches nothing |
| Missing KTX2 | model load rejected with an unstructured `404` | `TN_ASSETS_LIGHTMAP_MISSING` names the content-addressed path |
| Disposal | release traverses ordinary material texture fields | the attached lightmap's dispose spy fires exactly once on model release |

Focused green results: `lightmap-bake.spec.ts` 2/2, `lightmap-pass.spec.ts` 5/5, and the three
runtime lightmap tests 3/3. Full package and repository gates are recorded only after Phase 4.

## Packed sandbox consumer proof

The original sandbox was moved to `/tmp/tn-prd256-sandbox-phase0-20260829`; a clean sandbox was
then recreated from packed local tarballs at
`/home/joao/projects/threenative/worktrees/sandbox/prd256-static-light`. Its game loads
`static-light.glb` through ordinary `ctx.assets.model()`, removes the source blocker and source
light, and allows the goal to set `status: "won"` only when the receiver material has a non-null
`lightMap`.

| Check | Executed result |
| --- | --- |
| Production build | exit 0; generated `static-light.026c78cf.glb` and `static-light.lightmap.fd7df334.ktx2` |
| GLB inspection | receiver and blocker both expose `TEXCOORD_1:u16_norm` |
| WebGPU scenario | `static-lightmap.playtest.json` exit 0, 440 scenario frames, 1,301 triangles, 7 draw calls, clean diagnostics |
| Named capture | `artifacts/playtest/static-light-baked.png.png` inspected at 1280x720; non-blank scene and baked darker receiver patch visible |
| Rule state | browser console reports `TN_STATIC_LIGHT_READY:true`; goal state becomes `won` |
| Mutation red | sandbox set receiver `material.lightMap = null`; scenario exited 1 because `staticLightReady` and `status` assertions failed |
| Restoration | mutation removed; identical scenario returned exit 0 |

The sandbox exposed and the branch fixed three integration defects before green: the dev watcher
discarded `assets.models.lightmap`, model pruning removed unreferenced UV2, and a 75x65 ETC1S atlas
was invalid for WebGPU block compression. The fixed path passes config into every template watcher,
preserves generated lightmap UVs, and emits block-aligned 76x68 KTX2 dimensions. Packed CLI imports
`@threenative/assets` as a peer so a local tarball install cannot silently execute a nested stale
compiler.

## Standard consumer and native staging

The Phase 0 plain Three.js page used stock `GLTFLoader` and `KTX2Loader`, imported no
`@threenative/core`, loaded one compiled model/lightmap pair and reported `loaded:1` with no console
errors. The final manifest retains the same standard GLB/KTX2 contract.

Desktop packaging completed against the locally built Linux host. The packager's real
`stageDesktopFiles()` produced two distinct staging paths with equal hashes:

| Artifact | Web SHA-256 | Native-staged SHA-256 |
| --- | --- | --- |
| `static-light.026c78cf.glb` | `6557395d56b29d7aa76188e955f040a30cd4deef558f363367ce89d07c9023d0` | `6557395d56b29d7aa76188e955f040a30cd4deef558f363367ce89d07c9023d0` |
| `static-light.lightmap.fd7df334.ktx2` | `fd7df33412b7817d9539389d711464e61460e00922aa7890891497a356f71b7b` | `fd7df33412b7817d9539389d711464e61460e00922aa7890891497a356f71b7b` |

The parity probe exits 2 on missing or self-comparing paths. Its first attempt did exit 2 when it
incorrectly assumed the final single-file executable retained an external `assets/` directory;
the corrected probe calls the packager's staging function before native embedding.

Linux desktop rendering is **PASS**. The timeout isolated three host gaps in the real KTX2 path:
the worker wire did not carry ArrayBuffers/typed arrays or nested `undefined`, the V8 worker slept
without pumping asynchronous WebAssembly tasks, and the WebGPU binding mapped BC7 to BGRA8. Focused
red-green contracts now cover all three. The rebuilt host loaded both KTX2 lightmaps, emitted
`TN_STATIC_LIGHT_READY:true`, moved the player for 30 driven ticks, and finished with zero console,
network, or runtime diagnostics. The inspected 1280x720 capture
`artifacts/playtest/after.png` has SHA-256
`a7668f6d18591500732c890fc0f9a774b5c1d199fbe0b64c075d9b7039af301c` and visibly contains the
baked darker receiver patch. Android/iOS remain **UNVERIFIED/unsupported** and fail closed through
`TN_NATIVE_KTX2_UNSUPPORTED`; no mobile-ready claim is made.

The sandbox also proved the gameplay rule's mutation sensitivity: changing the receiver check from
`material.lightMap !== null` to `material.lightMap === null` made the browser scenario exit 1 on
`staticLightReady`; restoring that line returned exit 0. The report formatter's own red was an
absent lightmap row; it now prints atlas dimensions, valid/dilated/occluded texels, KTX2 byte delta,
and bake milliseconds. `watchAssets()` retains the previous manifest until all content-addressed
model and auxiliary outputs are written, and its existing failure test preserves the previous good
output.

## Repository gates

| Gate | Executed result |
| --- | --- |
| `pnpm typecheck` | exit 0; all 18 workspace projects passed |
| `pnpm lint` | exit 0; 1,361 files checked; 455 advisory warnings and no errors |
| `pnpm test` | exit 0; 262 Vitest files passed and 1 skipped, with 2,627 tests passed and 3 skipped; package build and publint lanes also passed |
| Native package tests | exit 0; 88 Vitest files and 626 tests passed with 34 skipped, physics passed 28 tests, and Rust passed 15 tests |
| `pnpm --silent quality --json` | exit 0; no fatal suppression or file-quality finding |
| `pnpm budgets` | exit 0; all hard invariants passed; existing framework and native LOC review triggers were reported |
| `pnpm sync:agents --check` | exit 0; all 16 generated `CLAUDE.md` mirrors are in sync |

The feature is **COMPLETE**: deterministic packed output, ordinary Three.js consumption, web and
Linux desktop rendering, mutation sensitivity, artifact parity, reporting, rollback, and repository
gates are proven. Mobile remains honestly refused by the pre-existing decoder guard.
