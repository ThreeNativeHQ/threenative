# PRD-EXP-002 verification — WebGPU renderer-stage attribution

Date: 2026-08-11
Source base: `c024a0326eab7f7fdfdc6a28720e8bc29e56007b` plus this PRD-EXP-002 commit worktree
Node: `v20.19.6`
Evidence class: browser WebGPU hardware, headed Xvfb presentation verified. Android physical gate remains open.

## Verdict

Browser implementation is complete for PRD-EXP-002. Safe renderer-stage hooks pass the overhead gate: **0.00% median render overhead** and **-2.10% median frame delta** on fresh fox A/B. The negative frame delta is reported as run noise, not a claimed speedup. Exact public counters were unchanged: draws, triangles, logical objects, visible count all had **0.00% delta**.

Android/physical criterion is still unchecked: `adb devices -l` could not run because `adb` is not installed on this host. Status is therefore **IMPLEMENTED — browser complete, Android gate open**.

## FOX A/B overhead table

Control: `artifacts/native-cpu-profile/prd-exp-002-ab/control/profile-1786511079594.json`
Instrumented safe mode: `artifacts/native-cpu-profile/prd-exp-002-ab/instrumented-safe2/profile-1786511170618.json`
Both: fox-scale, 3 repeats, 120 measured samples, 60 warmup frames, same seed/counts, presentation before+after pass.

| Metric | Control median | Instrumented median | Δ median | Control p95 | Instrumented p95 | Δ p95 |
|---|---:|---:|---:|---:|---:|---:|
| renderMs | 3.500 | 3.500 | 0.00% | 5.400 | 6.000 | 11.11% |
| frameMs | 3.900 | 3.818 | -2.10% | 5.964 | 6.409 | 7.47% |
| matrixWorldMs | 0.200 | 0.200 | 0.00% | 0.300 | 0.400 | 33.33% |
| drawCalls | 1851.000 | 1851.000 | 0.00% | 1851.000 | 1851.000 | 0.00% |
| triangles | 36101.000 | 36101.000 | 0.00% | 36101.000 | 36101.000 | 0.00% |
| logicalObjects | 1850.000 | 1850.000 | 0.00% | 1850.000 | 1850.000 | 0.00% |
| visibleCount | 1850.000 | 1850.000 | 0.00% | 1850.000 | 1850.000 | 0.00% |

## FOX stage share, normalized per measured frame

Stage timings are inclusive and overlap. Percentages are relative to outer `renderer.renderScene` inclusive time. They must not be summed as total attribution.

| Stage | calls/frame | ms/frame | % outer renderScene |
|---|---:|---:|---:|
| backend.beginRender | 2.00 | 0.0333 | 0.84% |
| backend.finishRender | 2.00 | 0.0258 | 0.65% |
| renderList.sort | 2.00 | 0.3533 | 8.89% |
| renderLists.get | 2.00 | 0.0025 | 0.06% |
| renderer.renderObjects | 2.00 | 3.0308 | 76.23% |
| renderer.renderScene | 2.00 | 3.9758 | 100.00% |
| textures.updateRenderTarget | 1.00 | 0.0075 | 0.19% |

Retained safe hooks are useful and bounded: outer render scene, render-object submission, list get/sort, render target texture update, backend begin/finish. Dropped in safe mode to hold overhead under 3%: `renderer.projectObject`, node update methods, geometry/binding/pipeline per-render hooks, render-object get/create, and backend draw. Full mode remains available for short probes/tests only.

## Controlled matrix, instrumented safe mode

Command covered 1k/4k, independent shared, distinct-materials, instanced, merged, and 1-/2-pass controls with 3 repeats, 120 measured samples, 60 warmup frames. Evidence: `artifacts/native-cpu-profile/prd-exp-002-matrix/profile-1786511317079.json`.

| Objects | Mode | Passes | render ms | frame ms | matrix ms | draws | triangles | materials |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1000 | distinct-materials | 1 | 1.900 | 2.055 | 0.100 | 1001 | 12001 | 1000 |
| 1000 | distinct-materials | 2 | 3.400 | 3.560 | 0.100 | 2002 | 24002 | 1000 |
| 1000 | independent | 1 | 1.500 | 1.650 | 0.100 | 1001 | 12001 | 1 |
| 1000 | independent | 2 | 2.600 | 2.760 | 0.100 | 2002 | 24002 | 1 |
| 1000 | instanced | 1 | 0.200 | 0.235 | 0.000 | 2 | 12001 | 1 |
| 1000 | instanced | 2 | 0.300 | 0.340 | 0.000 | 4 | 24002 | 1 |
| 1000 | merged | 1 | 0.200 | 0.245 | 0.000 | 2 | 12001 | 1 |
| 1000 | merged | 2 | 0.300 | 0.340 | 0.000 | 4 | 24002 | 1 |
| 4000 | distinct-materials | 1 | 12.600 | 13.720 | 0.500 | 4001 | 48001 | 4000 |
| 4000 | distinct-materials | 2 | 22.900 | 23.820 | 0.600 | 8002 | 96002 | 4000 |
| 4000 | independent | 1 | 8.200 | 9.000 | 0.400 | 4001 | 48001 | 1 |
| 4000 | independent | 2 | 13.600 | 14.400 | 0.400 | 8002 | 96002 | 1 |
| 4000 | instanced | 1 | 0.200 | 0.400 | 0.000 | 2 | 48001 | 1 |
| 4000 | instanced | 2 | 0.300 | 0.520 | 0.000 | 4 | 96002 | 1 |
| 4000 | merged | 1 | 0.200 | 0.420 | 0.000 | 2 | 48001 | 1 |
| 4000 | merged | 2 | 0.300 | 0.520 | 0.000 | 4 | 96002 | 1 |

### Headline deltas vs independent shared pass=1

| Objects | Comparison | render Δ | frame Δ | draws Δ |
|---:|---|---:|---:|---:|
| 1000 | distinct-materials vs independent shared | 26.67% | 24.55% | 0.00% |
| 1000 | instanced vs independent shared | -86.67% | -85.76% | -99.80% |
| 1000 | merged vs independent shared | -86.67% | -85.15% | -99.80% |
| 1000 | independent 2-pass vs 1-pass | 73.33% | 67.27% | 100.00% |
| 4000 | distinct-materials vs independent shared | 53.66% | 52.44% | 0.00% |
| 4000 | instanced vs independent shared | -97.56% | -95.56% | -99.95% |
| 4000 | merged vs independent shared | -97.56% | -95.33% | -99.95% |
| 4000 | independent 2-pass vs 1-pass | 65.85% | 60.00% | 100.00% |

## Counter and visual correctness

- Draw counts are sourced from `renderer.info.render.drawCalls`; the playtest bridge no longer falls back to `render.calls`.
- Final `renderer.info` counters are one-frame public counters because `renderer.info.reset()` is called every measured frame. Stage counts/times aggregate only the measured window after warmup reset and include `measuredFrameCount` plus per-frame normalized summaries.
- Presentation verification passed before and after profiling for control, instrumented, and matrix runs. Candidate first-run canvas hashes: before `04f64633933f16d918579216104604bee13f5404be2be6140aa42ba003811cbb`, after `9d4aedfe8fc7bdbf768240873c70a13854f7f9e21d22459d824e9370c7751932`.

## Async and lifecycle audit

- Three.js `0.185.1` inspected from installed source. Hooked safe-mode methods in `Renderer.js`, `RenderList.js`, `Textures.js`, `WebGPUBackend.js`, and common backend are synchronous on this render path; async methods found nearby are unrelated setup/readback APIs such as `init`, `clearAsync`, readback, and pipeline utility promises.
- Wrappers are now promise-aware anyway, so any future promise-returning hook records after settlement.
- `dispose()` restores manager methods and lazily wrapped render-list `sort` identities.
- `reset()` is called after warmup so stage attribution excludes warmup frames.

## Android status

Open. Read-only check attempted: `adb devices -l` returned `adb: command not found`. No device was inspected, installed to, or modified.
