# Batch — pay down the tech-debt scan, 2026-08-23

**Status:** PARTIAL — 197, 205 and 207 are done (archived to `docs/PRDs/done/`); the other nine
have not started. Twelve PRDs filed from
`docs/audits/tech-debt-scan-2026-08-23.md` (checkout `62fac4d5`, anchors re-verified at
HEAD `36831d96` before filing). Every numbered finding in the scan maps to exactly one
PRD; nothing is filed twice.

The scan found debt concentrated in three places: the native host (all 36 debt markers,
the only unlinted package, silent-success surfaces), the playtest schema layer (two
residual fail-open holes, three-times-declared schema), and template drift
(`loading.ts` × 6). Core, UI and engine-mcp came back clean and get no PRD beyond the
Tier-4 sweep.

## Scope and ownership

| PRD | Outcome | Scan items | Complexity | Depends on |
| --- | --- | --- | --- | --- |
| [197](../done/PRD-197-native-host-fails-loudly-at-creation.md) **(done)** | TLS verifies peers by default; bind groups/samplers throw at creation; no phantom timer stubs | #1, #7, #15 | 5 → MEDIUM | none |
| [198](./PRD-198-raytracing-surface-stays-dark-until-results-exist.md) | Raytracing is gated off instead of resolving success on a result nothing can read | #2 | 5 → MEDIUM | none |
| [199](./PRD-199-parity-scenario-validation-fails-closed.md) | Malformed parity animation/resources and wrong-typed viewports throw at load | #3, #16 | 3 → LOW | none |
| [200](./PRD-200-playtest-evaluator-plumbing-is-single-sourced.md) | Triviality guard has one definition; `buildReport` takes an options object; movement-evidence splits | #5, #6, #13 | 6 → MEDIUM | none |
| [201](./PRD-201-scaffolder-derives-what-it-ships.md) | Template list, package list, substitution loop, textures config and PNG parsing each have one definition | #4, #25, #26, #19, #24 | 5 → MEDIUM | none |
| [202](./PRD-202-runner-lanes-share-one-implementation.md) | Device and browser lanes run identical helper code; distance math cannot diverge; sampling splits | #8, #14 | 6 → MEDIUM | none |
| [203](./PRD-203-template-loading-screens-stop-drifting.md) | One canonical `loading.ts` is stamped at scaffold time; drift is a failing test | #9 | 5 → MEDIUM | none |
| [204](./PRD-204-assertion-validators-are-generated-from-the-registry.md) | Assertion validators are generated from the registry that already generates the docs | #11 | 6 → MEDIUM | none |
| [205](../done/PRD-205-webgpu-bindings-register-from-a-table-and-get-linted.md) **(done)** | Table-driven registration replaces 100 nested lambdas; Biome covers runtime-native | #10, #12 | 8 → HIGH | after 197 |
| [206](./PRD-206-shared-behaviours-have-one-definition.md) | Input, pointer math, error contract, reachability and teardown each collapse to one definition | #18, #20, #21, #22, #23 | 5 → MEDIUM | none |
| [207](../done/PRD-207-native-internals-shed-their-shortcuts.md) **(done)** | Build tools leave the runtime binary; embedded JS shrinks; handles own their lifetime; polls become fences | #17, #27, #28, #29 | 8 → HIGH | after 205 starts, coordinates |
| [208](./PRD-208-tier-four-hygiene-sweep.md) | Dead API deleted, stale anchors re-anchored, mirrored constants single-sourced | Tier 4 | 5 → MEDIUM | none |

## Order

1. Run the five small-honesty PRDs first — 197, 198, 199, 200 (phases 1–2) and 201 are
   the scan's Tier 1 plus its nearest neighbours; each is red-green in hours.
2. Run 202 next: it closes a live correctness bug (lane-divergent distance math) and
   must land before any further runner edits in 200 phase 3 or 205 touch reporting.
3. 205 is the multi-day structural pass; start it only after 197 phase 2 (same file,
   `webgpu/bindings.cpp`) is merged.
4. 203 and 204 each begin with an afternoon of design, then run mechanical.
5. 206 and 208 are independent sweeps; run them whenever a lane frees up.
6. 207 shares files with 205 — sequence it after 205's registration-table phases merge.

## Explicit exclusions

- The Vulkan/DXR/Metal RT backends are **not** duplication (scan verdict) — 205 must not
  consolidate them.
- Templates' `src/render/` stays dependency-free user source: 203 may stamp copies at
  scaffold time but never makes templates import a package.
- Implementing `serverCertificateHashes` is out of scope for 197; the deliverable is
  verify-by-default plus an explicit dev override.
- Playtest stays dependency-free: 204 is codegen from the existing registry, not a zod
  adoption.
- Any abstraction 205 adds is scored by `scripts/count-loc.ts`; if it costs more than
  the lambdas it removes, the kill switch deletes it.
- Appearance decisions (colours, curves, timing in `loading.ts`) stay byte-equivalent;
  203 normalizes structure and factory names, not look.

## Batch acceptance

- [ ] All twelve PRDs have dated records in `docs/verification/` with observed red
      controls pasted.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` exits 0.
- [ ] Runtime behaviour changes carry a playtest scenario or conformance case naming the
      target it executed on; unexecuted targets stay explicitly unverified.
- [ ] The specific TODO markers cited by the scan (`webtransport.cpp:790`, the raytracing
      copy-out TODOs) are gone with their defects, not deleted alone.
- [ ] Net package LOC goes down where the scan promised removable lines (#5, #10, #11);
      `pnpm quality` offender list shrinks for every file a PRD touched.
- [ ] The batch moves whole to `docs/PRDs/done/` only after every PRD completes.
