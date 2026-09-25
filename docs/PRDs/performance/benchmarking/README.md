# Cross-engine benchmarking

[PRD-449: Reproducible cross-engine benchmarks and an auditable HTML report](PRD-449-cross-engine-benchmarks-and-html-report.md) specifies the next benchmark campaign on `develop`.

It extends the existing engine-load-test harness with six workload families: Bevy many-cubes, independent Three.js meshes, Bevy many-foxes, Godot culling, Godot lights/meshes, and Bevy City. Its final deliverable is an offline HTML comparison report backed by actual per-experiment measurements and a reproducible raw-data bundle.

**Current state:** specification only. Implementation, calibration and the measured HTML report are not complete. Track progress in the PRD's phase checklists.

The [earlier research note](benchmark-research.md) records candidate sources and historical context; it is not a current results report. Existing runtime/core performance findings remain in [the single performance state record](../../../verification/runtime-perf-state.md).
