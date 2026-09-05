# Self-Verification Plan: automatic cook and Wildwood resolution

**Repository/Path:** PRD-349 worktree and sandbox Wildwood/Quarry
**Environment:** local installed tarballs, hardware WebGPU, available native targets
**Planned Test Run ID Format:** `qa_20260904_prd349_<case>`
**Final Report Path:** `docs/verification/PRD-349-the-cook.md`

## 1. Target Statement

Default asset cooking works without game opt-outs. Wildwood retains automatic resolution;
no fixed scale or texture resizing may substitute for diagnosing blur.

## 2. Acceptance Criteria

- Shared textures deduplicate; tiny images do not grow; explicit overrides remain measurable.
- Exclusions and budgets apply to actual emitted files across targets and templates.
- Quarry opens and walking changes observed state, with six textured props and no runtime errors.
- Wildwood renders correctly; measured resolution decisions distinguish evidence from assumptions.
- Report platform and gate failures honestly; never label missing observations passing.

## 3. System Discovery

Startup: each game's package scripts; Vite production preview for visual captures. Storage is
local source assets, compiler cache, public manifest and generated output. No DB/auth service.
Compiler workers and GPU timestamp queries are asynchronous. Existing Vitest suites and JSON
playtests provide regression checks. iOS execution requires a macOS lane not present locally.

## 4. Verification Matrix

| Area | Scenario | Method | Evidence | Expected | Priority |
| --- | --- | --- | --- | --- | --- |
| Cook | Defaults, overrides, cache hits, tiny files | Real compiler tests | logs, manifests, byte counts | expected outputs and reports | P0 |
| Negative | Invalid config, oversized uncooked input | loader and compiler | rejection and exit code | fail closed | P0 |
| Output | Excluded or superseded compiled assets | filesystem and receipt checks | owned output paths | no stale shipped files | P0 |
| Opening | Quarry/Wildwood load and movement | hardware playtest | adapter, screenshot, state, errors | nonblank, input works, no errors | P0 |
| Resolution | Blank presentation control then fixed workload | headed private display | refresh, focus, RAF, frame windows | valid lane before cost attribution | P0 |
| Platforms | web/desktop/Android/iOS | actual target builds/runs | logs per target | no substituted target claims | P0 |

## 5. Test Data Plan

Use isolated test-created directories and named capture files. Preserve existing game data and
other agents' edits. Keep invalid/oversized controls separate from the shipped game config.

## 6. Execution Steps

1. Run doctor and inspect display, adapter and competing workloads.
2. Reproduce defects, record red, fix in the owning layer, rerun the same check green.
3. Install content-hashed packages and exercise real opening and input.
4. Measure after warmup: at least 1,000 frames or 30 seconds, whichever is longer.
5. Run full gates, inspect artifacts, and update the evidence report.

## 7. Evidence Requirements

Keep commands, exit codes, red/green output, manifest/receipt bytes, adapter identity, screenshots,
console/network errors, input/state assertions and frame sample boundaries. A single late GPU
timestamp is not a window percentile and must not be presented as one.

## 8. Bug Handling

Locate the engine/game layer, freeze the failure, add its smallest regression, run red, implement
one fix, rerun green, then repeat the real scenario. Record remaining uncertainty.

## 9. Cleanup Plan

Stop only processes created by this run. Test fixtures clean up their own temporary directories.
Do not remove user assets or unrelated browser sessions. Preserve evidence and authored changes.

## 10. Final Report Template

Report scope, matrix results, commands, evidence, bugs, cleanup, residual gaps and conclusion:
PASS only when all critical criteria have executed successfully; otherwise FAIL or PARTIAL.
