# Current native runtime census — 2026-08-16

This is the current evidence record for the native runtime LOC census. It is separate from the
historical PRD-116 verification record. `scripts/check-budgets.ts` and the physics evidence test
consume this table and fail closed when the measured total, area rows, or gate summaries drift.

## Native LOC kill switch

The budgeted native source walk uses the same extensions and exclusions as
`scripts/check-budgets.ts`. Each row names its owner, live proof or caller, the plain alternative
considered, and a KEEP/DELETE verdict.

| Counted area | Lines | Owner | Live proof or caller | Alternative considered | Verdict |
| --- | ---: | --- | --- | --- | --- |
| `src/` | 38,095 | PRD-045, PRD-047, PRD-048, PRD-050, PRD-053, PRD-116 | `src/physics/native_bindings.cpp:586`; desktop V8 and native runtime commands | Move host shims into each game or delete the native host | **KEEP** — this is the owned native host and its physics boundary. |
| `conformance/` | 6,273 | PRD-053, PRD-054, PRD-055, PRD-076 | `conformance/run-conformance.mjs`; root `pnpm parity` | Replace cross-target registry/proofs with untested per-game scripts | **KEEP** — shared executable conformance evidence. |
| `tests/` | 9,055 | PRD-045, PRD-046, PRD-048, PRD-049, PRD-050, PRD-053, PRD-054, PRD-055, PRD-076, PRD-116, PRD-127 | `tests/physics_actuation_bindings_test.cpp:141`; runtime-native Vitest and native tests | Delete fail-closed tests to reduce the trigger | **KEEP** — removal would conceal regressions. |
| `scripts/` | 11,641 | PRD-045, PRD-048, PRD-049, PRD-050, PRD-053, PRD-054, PRD-116, PRD-127 | `scripts/verify-desktop-physics.mjs:206-228`; build, platform, and device-condition verifiers | Make every game own packaging, device, and verifier orchestration | **KEEP** — no smaller shared alternative preserves the proof. |
| `include/` | 3,760 | PRD-046, PRD-047, PRD-053, PRD-116 | `include/threenative/physics_native.h:131`; C ABI consumed at `src/physics/native_bindings.cpp:586` | Add per-game native headers or remove the C boundary | **KEEP** — the coarse host ABI is the shared boundary. |
| `android/` | 1,941 | PRD-045, PRD-048, PRD-050, PRD-053, PRD-054 | Android host sources and `scripts/verify-android-physics-parity.mjs` | Require each game to rebuild Android lifecycle and transport | **KEEP** — required Android packaging and execution plumbing. |
| `native/` | 2,914 | PRD-046, PRD-049, PRD-116 | `native/physics/src/lib.rs:463`; `native/physics/tests/actuation.rs:324` | Use the web WASM/Rapier backend on native or move physics into games | **KEEP** — this is the native Rust implementation behind the shared API. |
| Root `CMakeLists.txt` | 1,673 | PRD-047, PRD-048, PRD-050 | `pnpm native:build`; explicit binding target build | Make every game own native dependency discovery and linking | **KEEP** — opt-in host build configuration. |
| `cmake/` | 280 | PRD-047, PRD-048, PRD-050 | Root CMake configuration includes these platform modules | Duplicate compiler/platform rules in each game | **KEEP** — shared build modules. |
| `CMakePresets.json` | 140 | PRD-047, PRD-048, PRD-050 | `tn-linux` preset used by the native build and binding target | Remove declared presets and use undocumented local flags | **KEEP** — reproducible host presets. |
| `ios/` | 104 | PRD-045, PRD-048, PRD-049, PRD-050 | `scripts/verify-ios-simulator.mjs` and iOS host sources | Make each game own iOS packaging and simulator lifecycle | **KEEP** — shared iOS packaging boundary; this lane made no iOS execution claim. |
| `package.json` | 60 | PRD-048, PRD-050, PRD-054, PRD-116 | `native:build`, `native:physics:parity`, and `native:verify:desktop` scripts | Hide opt-in native commands in per-game manifests | **KEEP** — package-level command contract. |
| `vitest.config.ts` | 10 | PRD-048, PRD-050 | Runtime-native Vitest command and parity producer | Drop native package test collection | **KEEP** — declares the native package test boundary. |
| `tools/` | 145 | PRD-077 | `conformance/desktop-touch.mjs` → `threenative-uinput-touch`, built by the `CMakeLists.txt` target of the same name | Write the injector in Node, or take an npm addon, or shell out to `python3` | **KEEP, and it cannot be smaller.** Creating a `uinput` device is a sequence of ioctls and Node exposes none, so the alternatives are a new native harness dependency rebuilt per Node version, or a Python toolchain this repository does not otherwise have. This owns only the ioctls and the device's lifetime — every event is encoded in JavaScript where a test can assert two `ABS_MT_SLOT` groups precede one `SYN_REPORT`. Linux-only by construction. |
| **Total** | **76,091** |  | `pnpm budgets` current measurement |  | **No area rejected.** |

The 2026-08-16 device-preflight and Android report-condition repairs account for the current
`tests/` and `scripts/` rows. The native review trigger remains visible at 72,857 / 50,000; no
native source was removed. Physical
Android, iOS, and hardware evidence remains unverified.

## Current gate summaries

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm budgets` | PASS, exit `0` | 6 framework packages, 5 example workspaces, 10,610/15,000 framework LOC, 76,091/50,000 native runtime LOC, 11 PRD files, largest template 1,997 LOC; the native review trigger remains visible. |

- Root Vitest: 156 files, 1,371 passed, 35 skipped.
- Runtime-native Vitest: 46 files, 276 passed, 39 skipped.
- The focused device-preflight, Android JS-engine, and physics-parity fixture tests are current
  evidence; no physical-device result is claimed.
