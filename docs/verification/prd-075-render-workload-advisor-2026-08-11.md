# PRD-075 render workload advisor verification — 2026-08-11

## Percentage-first verdict

**PASS for PRD-075 advisory tooling.** This PRD implements/protects **0% runtime optimization gain** because it is intentionally advisory-only and disabled by default; it identifies a **projected draw-call opportunity of ~99.98%** on the 4,000 compatible-mesh fixture (4,001 live draw calls to 1 compatible group if the game author applies `InstancedMesh`/static merging safely). Physical Pixel 8 / mobile performance remains open and is not claimed here.

The fresh checked-in evidence summary is `docs/verification/data/prd-075-render-workload-advisor-2026-08-11.json`. It is primary; raw bulky `artifacts/` JSON files remain ignored and are referenced only by SHA256 below. The measured source was **dirty** on branch `experiment/native-cpu-profiling` at `e83a0fa1b680ca618db6389f3d3b96aa98280ed2` because this PRD-075 implementation and evidence were still uncommitted during the live run.

## Scorecard

| Gate | Result |
|---|---:|
| Intentionally expensive compatible warning recall | 100% |
| Optimized/incompatible suppression | 100% |
| False-positive-free optimized/incompatible classes | 100% |
| Live renderer counter agreement | 100% |
| Deterministic report content hash across groups | 100% |
| Presentation pass rate | 100% |
| Zero browser/page errors | 100% |
| Mutation/privacy unit gates | 100% |
| Privacy leaks in checked-in summary/live reports | 0 |
| Disabled steady-state advisor calls | 0 |
| Snapshot elapsed median / p95 | 1.1 ms / 14.3 ms |

## Fresh live correlation matrix

Commands ran on Node v20.19.6, headed Chromium under Xvfb, adapter classified as hardware in every run. Each matrix row used 60 warmup frames, 120 recorded samples, 3 repeats, `--verify-presentation --headed --render-advisor`; the fox row used the canonical `--visual-evidence fox-scale` path. Presentation before/after and browser-error gates passed for all repeats.

| Fixture | Repeats | Median render ms | Draws | Triangles | Advisor median / p95 ms | Recommendation codes | Report hash |
|---|---:|---:|---:|---:|---:|---|---:|
| 4k independent shared material, 1 pass | 3 | 7.800 | 4001 | 48001 | 9.900 / 11.000 | `TN_RENDER_ADVISE_INSTANCE_COMPATIBLE` | stable |
| 4k independent shared material, explicit equivalent 2 pass | 3 | 14.200 | 8002 | 96002 | 9.100 / 9.700 | `TN_RENDER_ADVISE_INSTANCE_COMPATIBLE`, `TN_RENDER_ADVISE_REPEATED_PASS` | stable |
| 4k distinct equal-looking materials | 3 | 11.900 | 4001 | 48001 | 14.300 / 15.000 | none | stable |
| 4k already instanced | 3 | 0.200 | 2 | 48001 | 1.100 / 1.200 | none | stable |
| 4k already merged | 3 | 0.200 | 2 | 48001 | 1.000 / 1.000 | none | stable |
| Matrix SceneCollapse current graph | 3 | 0.100 | 3 | 48001 | 1.000 / 1.000 | none | stable |
| Fox-scale SceneCollapse current graph | 3 | 0.100 | 5 | 36101 | 1.000 / 1.000 | none | stable |

The “draws” column is live `renderer.info.render.drawCalls` median and matched the advisor's sanitized `observed.renderer.drawCalls` in every repeat. Snapshot `visibleFlagRenderableCount` is a scene snapshot count, not a renderer-observed frustum result.

## Evidence sources

Primary checked-in summary:

- `docs/verification/data/prd-075-render-workload-advisor-2026-08-11.json`

Ignored raw artifacts, referenced by hash only:

- `artifacts/prd-075-render-advisor-fresh/matrix-1pass/profile-1786517175608.json` — SHA256 `ae612993bde4f8fdca0ef1d62ba8cebda5ca24b1960f1af78d5990cc5e7a0e34`; source `experiment/native-cpu-profiling` `e83a0fa1b680` dirty=true; recorded `2026-08-12T06:46:15.608Z`.
- `artifacts/prd-075-render-advisor-fresh/matrix-2pass/profile-1786517201897.json` — SHA256 `68a6bde2c7137343306fcb969ce29b296b86769f8a97182dae0047c90e94311e`; source `experiment/native-cpu-profiling` `e83a0fa1b680` dirty=true; recorded `2026-08-12T06:46:41.897Z`.
- `artifacts/prd-075-render-advisor-fresh/fox/profile-1786517229485.json` — SHA256 `d873a87dbd13f02a1180a88f34d48bb184717a76d3517449d4a70163f51fda07`; source `experiment/native-cpu-profiling` `e83a0fa1b680` dirty=true; recorded `2026-08-12T06:47:09.485Z`.

Commands summarized into the checked-in data:

- `xvfb-run -a -s '-screen 0 1600x900x24' pnpm profile:native-cpu -- --headed --verify-presentation --render-advisor --objects 4000 --render-mode independent,distinct-materials,instanced,merged,scene-collapse --passes 1 --hierarchy flat --dirty 10 --visibility all-visible --repeats 3 --samples 120 --warmup-frames 60 --warmup-ms 0 --output-dir artifacts/prd-075-render-advisor-fresh/matrix-1pass`
- `xvfb-run -a -s '-screen 0 1600x900x24' pnpm profile:native-cpu -- --headed --verify-presentation --render-advisor --objects 4000 --render-mode independent --passes 2 --hierarchy flat --dirty 10 --visibility all-visible --repeats 3 --samples 120 --warmup-frames 60 --warmup-ms 0 --output-dir artifacts/prd-075-render-advisor-fresh/matrix-2pass`
- `xvfb-run -a -s '-screen 0 1600x900x24' pnpm profile:native-cpu -- --visual-evidence fox-scale --allow-software --render-advisor --render-mode scene-collapse --output-dir artifacts/prd-075-render-advisor-fresh/fox`

## Projected opportunity, not implemented gain

The advisor is opt-in development tooling. With `renderAdvisor=0`, there are **0 advisor calls** in the profiling page and no per-frame traversal. With `renderAdvisor=1`, the 4k compatible independent fixture reported 4,000 visible-flag renderables and `expectedReducedCount=1`, so the projected draw opportunity is approximately `(4001 - 1) / 4001 = 99.98%`. This is **not** a shipped performance gain; it is a generated-source remediation opportunity for the author.

## Safety, privacy, and semantics fixes

- Reports serialize aggregate counts and stable reason codes only. Observed pass tokens are validated then reduced to `{ recorded, truncated }`; raw scene/camera/target/equivalence tokens are not serialized.
- Observed renderer counters are allowlisted to finite nonnegative public counters (`drawCalls`, `triangles`); arbitrary caller keys such as private paths are omitted.
- Example paths are an exact repo-relative allowlist and are tested to exist.
- SceneCollapse `status` and `reasonCode` are sanitized to stable known values before report output.
- Unit coverage proves names, private-looking paths, URLs, UUID-like strings, object/material/geometry refs, geometry/material identities, matrices, visibility, layers, render order, parents and hooks are not mutated or leaked.
- Static merge advice requires `transformSafety: "caller-declared-static"`; ordinary one-snapshot 4k meshes receive instancing advice plus a static-merge caveat, not static merge advice.
- ShaderMaterial, RawShaderMaterial, node-material-like public `type`, mapped/textured materials, transparent, skinned, morphed, layer, render-order and hook-driven fixtures emit explicit constraints and suppress unsafe repeated-object/material-sharing advice.
- HUD sprite advice requires an explicit caller-declared camera-overlay workload. A single `Points` object remains silent because it is already batched; GPU particle advice is limited to many independent point-like objects with caller-declared compatibility.

## Tests and gates

Focused tests now cover **13 render advisor tests + 15 profiler tests**:

- `pnpm exec vitest run packages/playtest/__tests__/render-workload-advisor.spec.ts scripts/__tests__/profile-native-cpu.spec.ts --reporter=verbose` — 28/28 passed (13 advisor + 15 profiler) in the latest focused run.
- `pnpm exec tsc --noEmit --pretty false -p packages/playtest/tsconfig.json` — passed.
- `pnpm --filter threenative-native-cpu-load-test build` — passed.
- Targeted Biome on touched source/test/analyzer/report files — passed with accepted pre-existing complexity warnings and no errors after analyzer formatting.
- `pnpm budgets` — passed with the existing native-runtime LOC review-trigger warning.
- `git diff --check` — passed before final staging.

Full root `pnpm lint` is **not** claimed here: the repository has generated-artifact lint noise outside PRD-075's touched acceptance surface. Acceptance relies on the targeted Biome gate above plus full typecheck/build/test gates recorded at closure.

## Limitations

- Advisor elapsed time is measured outside the timed render loop and excluded from deterministic report content hashes.
- The live harness only models the positive same-scene/same-camera/same-target equivalent pass case. Different target/depth/purpose negative coverage is unit-tested.
- Material sharing remains conservative: distinct equal-looking materials are not advised in live correlation unless caller declares mutation safety and material semantics are compatible.
- Raw artifacts live under ignored `artifacts/`; this document records hashes and uses the sanitized checked-in data summary as the auditable evidence artifact.
- Physical Pixel 8 evidence remains open; no phone/mobile performance claim is made.
