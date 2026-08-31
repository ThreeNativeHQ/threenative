---
prd_contract: v1
---

# PRD-236 repair round 1 — 2026-08-31

Base under repair: `c14c8571`.

Scope: the five review defects in the sailing starter kit continuation. The browser lane and
Linux desktop native lane were executed; Android and iOS were not claimed.

## Repairs and contracts

| Defect | Repair | Contract |
| --- | --- | --- |
| WaveField TSL was only checked with `isNode` | The core and native conformance checks inspect the actual TSL shader function and require parameter reads for amplitude, wave number, and steepness plus vertex displacement. | A flat-displacement graph mutation fails the focused test. |
| Buoyancy aggregated all force at the body center | Each hull point is sampled in world space and applied at its own world position through the web/native force-at-point seam. | An asymmetric hull point produces angular motion. |
| `amplitude + steepness` ignored steepness | CPU sampling and the TSL graph both read the packed steepness slot and add its wavelength-scaled contribution. | The combined configuration changes CPU height and graph source. |
| Sailing advertised the asset-only starter verifier | `test:native` now builds the desktop runtime and runs `native-playtests/survives.playtest.json`, which asserts sailing movement. | A freshly generated sailing kit passes the native command with the local runtime binary. |
| Sailing guidance had an unclosed shell fence | The source `AGENTS.md` fence was closed and `pnpm sync:agents` regenerated the mirror. | `pnpm sync:agents --check` and the generated-doc test pass. |

## Observed-red mutation evidence

Each mutation was applied temporarily, the focused check was run, and the implementation was
restored before the green run.

| Mutation | Observed failure |
| --- | --- |
| Replace the TSL wave displacement with `height.addAssign(float(0))`. | WaveField focused test exited 1: 1 failed, 3 skipped; the generated source no longer matched the required `height.addAssign` displacement contract. |
| Make the CPU sampler use only packed amplitude when steepness is present. | Combined amplitude/steepness regression exited 1: expected delta `0.3183098861837907`, received `0`. |
| Make the TSL graph use only packed amplitude and ignore slot `+6`. | Combined graph regression exited 1 because the shader source no longer read the steepness slot. |
| Route buoyancy calls back through center-only `applyForce`. | Asymmetric-hull regression exited 1: expected `quaternion.z > 1e-6`, received `0`. |
| Restore sailing `test:native` to `verify-starter`. | Generated-route regression exited 1 because the command did not reference the sailing native scenario. |
| Remove the repaired Markdown closing fence. | `pnpm check:docs` exited 1: `Malformed Markdown in packages/create-threenative/templates/sailing/AGENTS.md: unclosed fenced code block`. |

## Focused green evidence

```text
pnpm exec vitest run packages/core/__tests__/wave-field.spec.ts packages/physics/__tests__/buoyancy.spec.ts packages/physics/__tests__/native-contract.spec.ts packages/create-threenative/__tests__/playtest.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts -t "(WaveField|Buoyancy3D|native physics contract|route sailing native proof|byte-stable)"
5 files, 30 passed | 80 skipped, exit 0, 1.98s

cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --lib --test actuation -- --nocapture
13 unit tests + 8 actuation tests passed, exit 0
```

## Required repository gates

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Exit 0; all 20/21 workspace projects completed. |
| `pnpm lint` | Exit 0; Biome reported 492 pre-existing warnings and no errors. |
| `pnpm budgets` | Exit 0; 8 framework packages, 12 example workspaces, 73 PRD files, and all capability/conformance checks passed. Non-fatal LOC reports were emitted for framework/native runtime thresholds. |
| `pnpm quality` | Exit 0; report: 95 findings (17 new, 23 grew, 54 inherited, 1 waived). |
| `pnpm test` | Exit 0; 298 test files passed, 1 skipped; 2,958 tests passed, 3 skipped; duration 61.80s. |
| `pnpm sync:agents --check` | Exit 0; 17 `CLAUDE.md` mirrors in sync. |
| `pnpm check:docs` | Exit 0; 1,191 relative documentation links checked across 832 Markdown files. |
| `pnpm native:build` | Exit 0; Linux runtime built, including `libthreenative_native_physics.a` at 39,757,782 bytes and the desktop host/tools links. |

## Generated sailing browser proof

```text
TN_TEMPLATE_ONLY=sailing pnpm test:templates
exit 0 — sailing: scaffolded playtests passed.
capsize-is-a-loss: pass=true, firstTick=74, frames=11, lastTick=86
production-performance: pass=true, firstTick=388, frames=660, lastTick=1059
survives: pass=true, firstTick=77, frames=70, lastTick=175
round-four-course-buoys: pass=true, firstTick=76, frames=260, lastTick=337
```

## Generated sailing native proof

The generated kit was run with the source checkout's Linux runtime override because no release
prebuilt exists for this local lane:

```text
sh scripts/xvfb.sh env THREENATIVE_RUNTIME_BINARY=packages/runtime-native/build/tn-linux/mystral pnpm test:native
exit 0
runtime=native, target=desktop, scenario=native-sailing-smoke, pass=true, frames=70
before position=[0,0.40024489164352417,7], tick=43
after position=[0,-0.1145116463303566,3.390169143676758], tick=114
distance=3.6463479132757266, expectMoved=true
diagnostics: 0 console errors, 0 runtime errors
```

The host also emitted `TN_NATIVE_SMOKE_READY:webgpu`, `TN_NATIVE_SMOKE_FIRST_FRAME`, and
`TN_NATIVE_SMOKE_300_FRAMES:300`; a 1280×720 screenshot was saved. Existing three-mesh-bvh
bundle warnings did not affect the exit-0 proof.

## Bounded wave-field conformance

Only `78-wave-field` was selected; every other row was deliberately left unselected.

```text
pnpm parity -- --target web --only-tests 78-wave-field --out .runtime/prd236-wave-web
exit 2: pass=1, fail=0, blocked=87, planned=0, validated=0

THREENATIVE_RUNTIME_BINARY=packages/runtime-native/build/tn-linux/mystral pnpm parity -- --target desktop --only-tests 78-wave-field --reference .runtime/prd236-wave-web --out .runtime/prd236-wave-desktop
exit 0: pass=1, fail=0, blocked=87, planned=0, validated=0
```

All 87 blocked rows have the exact bounded-run reason `Not selected by this bounded execution
run.` The selected native row completed with exit code 0, 1280×720 output, GPU validation errors
`[]`, pixel mismatch ratio `0.00001953125`, and perceptual delta E `0.0009961128034719333`.

## Regenerated native evidence

The native source changes were followed by the required generated evidence refresh:

- `native-coverage-2026-08-28.md` source digest: `sha256:7577a961dbe1fa2caefae66de9764659d0e349305ee2869d25823c3d1c590db5`.
- `native-runtime-census-2026-08-16.md`: source 47,169 LOC; conformance 8,131 LOC; include 5,058 LOC; native 5,607 LOC; total 114,361 LOC.
