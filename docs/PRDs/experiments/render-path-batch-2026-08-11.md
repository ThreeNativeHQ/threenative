# Render-path PRD batch — 2026-08-11

Ordered from evidence to adoption:

1. [`PRD-EXP-002-renderer-stage-attribution.md`](./PRD-EXP-002-renderer-stage-attribution.md) — distinguish traversal/list/sort, render-object preparation, material/pipeline/binding work and backend encoding without forking Three.js.
2. [`PRD-074-scene-collapse-regression-gate.md`](../native-performance-fixes/PRD-074-scene-collapse-regression-gate.md) — make the already-proven draw folding measurable and regression-gated on real WebGPU and Pixel 8.
3. Continue existing [`PRD-069-per-draw-cost.md`](../native-performance-fixes/PRD-069-per-draw-cost.md) — localize the physical-device draw knee and test `BundleGroup` only for static reliably visible sets.
4. [`PRD-075-render-workload-advisor.md`](../native-performance-fixes/PRD-075-render-workload-advisor.md) — turn live counts into opt-in, generated-source recommendations without auto-rewriting scenes.
5. Reconcile existing [`PRD-071-cheap-bundle.md`](../native-performance-fixes/PRD-071-cheap-bundle.md) — retain truthful `renderer.info` ownership, remove/update the stale `compileAsync` premise, and avoid duplicating shipped work.

Explicitly rejected for this batch:

- Rust/native scene mirror;
- native transform or culling kernel;
- framework auto-instancer/auto-batcher;
- a second static geometry merger;
- a second HUD or generic sprite batcher;
- automatic material/pass rewriting.

Evidence: [`render-work-reduction-2026-08-11.md`](../../verification/render-work-reduction-2026-08-11.md).
