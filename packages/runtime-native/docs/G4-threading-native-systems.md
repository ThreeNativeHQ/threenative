# G4 — threading and native systems

**Milestones:** M7, M8, M9, M10, M11
**State:** NOT STARTED.

The runtime still owes its worker/thread model, JobSystem, native Rapier boundary, native
asset pipeline and realtime audio evidence. Android QuickJS has no WebAssembly; native
physics must use the coarse host-neutral bulk ABI under
`globalThis.__THREENATIVE_NATIVE__.physics`, never a per-object frame hot path.

Native navigation is separate debt. Rapier alone does not make the platformer starter
mobile-safe because it also imports Recast WebAssembly.
