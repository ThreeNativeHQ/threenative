# PRD-292 — a fast body does not pass through a wall

Verification date: 2026-08-31

## Result

The continuous-collision option is implemented with `true` as its default for dynamic bodies.
The option is carried through the web Rapier adapter and the native C ABI/Rust host. The
effective value is observable as `RigidBody3D.continuousCollision` on both backends.

| Criterion | Status | Evidence |
| --- | --- | --- |
| AC0 | PASS | Both direct Rapier backends measured first tunnel speed and CCD timing cost. |
| AC1 | PASS | Public option, web adapter, native C ABI/C++ parser, and Rust host are covered. |
| AC2 | PASS | Default `true` is justified by the 67 units/s tunnel and measured absolute deltas. |
| AC3 | PASS | Per-body effective setting is reported and mutation-tested. |
| AC4 | PASS | The projectile-wall scenario passes on WebGPU and native desktop; red control recorded. |
| AC5 | PASS | All reported template performance proofs passed; the measured non-zero delta is recorded below. |
| AC6 | PASS | Manifest, capability reference, and all eight template instruction mirrors contain the situation. |
| AC7 | PASS | This dated record names the measurements, targets, commands, and gate outcomes. |

The broader repository gates also exposed unrelated environment/fixture failures; they are named
in the command record and do not change the AC4 proof or the physics performance results.

## AC0, AC2, and AC5 — measurement and chosen default

Commands:

```sh
node packages/runtime-native/scripts/measure-continuous-collision.mjs
cargo run --quiet --release --manifest-path packages/runtime-native/native/physics/Cargo.toml \
  --example measure_continuous_collision
```

The JavaScript command measures the web Rapier backend and invokes the second command for the
native numbers. The native command is a standalone Rust Cargo example on the host target
`x86_64-unknown-linux-gnu`; it does not run the desktop V8/Dawn/Vulkan host. Both commands use one
`0.1 m` thick fixed wall, a `0.05 m` radius projectile, a `1/60 s` step, 128 dynamic bodies,
120 warmup steps, 600 measured steps, and five samples. The timing scene places the wall at
`x=0` and spreads body starts from `x=-479` to `x=-81`; after warmup the measured path spans
`x=-1` through `x=1`, crossing the wall's collision range `[-0.1, 0.1]`. The no-wall rows are
the unobstructed comparison; the wall rows exercise the collision candidate. Both executables
fail closed when that path no longer crosses the wall, and the JavaScript wrapper rejects native
geometry metadata that disagrees with its input.

| Backend | Rapier | First baseline tunnel | First continuous tunnel |
| --- | --- | ---: | ---: |
| Web | 0.19.3 | 67 units/s | none through 300 units/s |
| Native | 0.30.0 | 67 units/s | none through 300 units/s |

| Backend | No wall / CCD off | No wall / CCD on | Wall / CCD off | Wall / CCD on | Wall delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Web | 0.039743970 ms | 0.058764705 ms | 0.045586920 ms | 0.079659988 ms | +0.034073068 ms |
| Native | 0.024278 ms | 0.040716 ms | 0.027419 ms | 0.048556 ms | +0.021137 ms |

The default is `true`: the first tunnel occurs at 67 units/s on both backends, while the measured
wall-scene CCD delta at 128 bodies is +0.034073068 ms per step on web and +0.021137 ms per step
on the standalone native Rust runner. The no-wall CCD deltas were +0.019020735 ms and +0.016438
ms respectively, so the price record does not assume zero overhead.

## AC1 and AC3 — contract and observability

- `IRigidBody3DOptions.continuousCollision?: boolean` is the public option. Omitted values
  resolve to `true`; non-boolean values fail closed.
- The web simulation calls Rapier `setCcdEnabled` for dynamic bodies.
- The native `TnPhysicsBodyOptions` ABI carries `continuous_collision`; the C++ binding parses and
  validates it, and Rust applies it to dynamic bodies.
- `RigidBody3D.continuousCollision` reports the effective setting, including the default. The
  explicit `false` test reports `false` while the projectile tunnels.
- Focused web/native contract tests passed: 22 Vitest tests, 14 Rust unit tests, and the native
  C++ binding test.

The dynamic-only application preserves the existing kinematic bulk-transform contract: a
kinematic transform remains a driven transform rather than becoming a CCD sweep.

## AC4 — browser and native game proof

Scenario files:

- `examples/native-smoke/playtests/continuous-collision.playtest.json`
- `examples/native-smoke/playtests/continuous-collision-desktop.playtest.json`

Green browser command:

```sh
sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js \
  --scenario playtests/continuous-collision.playtest.json \
  --project examples/native-smoke --url http://127.0.0.1:5184 \
  --server-command "THREENATIVE_CONTINUOUS_COLLISION_PROOF=enabled pnpm exec vite --host 127.0.0.1 --port 5184 --strictPort" \
  --browser-recipe webgpu --headed --no-screenshots
```

Result: `pass: true`, runtime `web`, `continuousCollision.effectiveSetting: true`,
`continuousCollision.hit: true`, projectile x `-0.05665740743279457`. The adapter was the NVIDIA
Turing WebGPU adapter, not SwiftShader.

The equivalent desktop command ran the desktop scenario against a compiled `mystral` executable
from the `x86_64-unknown-linux-gnu` native host. Result: `pass: true`, runtime `native`,
Rapier `0.30.0`, `continuousCollision.effectiveSetting: true`, `hit: true`, and projectile x
`-0.05665740743279457`. The native host reported V8, NVIDIA GeForce RTX 2080, and Vulkan.

The final desktop proof was built and run with:

```sh
# cwd: examples/native-smoke
THREENATIVE_CONTINUOUS_COLLISION_PROOF=enabled THREENATIVE_NATIVE_BACKEND=enabled \
  THREENATIVE_PLAYTEST_BRIDGE=enabled pnpm exec vite build

# cwd: repository root
native_proof_dir=$(mktemp -d /tmp/tn292-native-proof.XXXXXX)
packages/runtime-native/build/tn-linux/mystral compile examples/native-smoke/dist/native-smoke.js \
  --root examples/native-smoke --include examples/native-smoke \
  --out "$native_proof_dir/continuous-collision"
node packages/playtest/dist/runner/cli.js \
  --scenario playtests/continuous-collision-desktop.playtest.json \
  --project examples/native-smoke --executable "$native_proof_dir/continuous-collision" \
  --target desktop --artifacts /tmp/tn292-continuous-collision-desktop --no-screenshots
```

Red first (controlled pre-feature mutation): `packages/physics/src/RigidBody3D.ts` was temporarily
changed at `DEFAULT_CONTINUOUS_COLLISION` from `true` to `false`, then the package distribution was
rebuilt so the browser bundle used the mutation:

```sh
pnpm --filter @threenative/physics build
sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js \
  --scenario playtests/continuous-collision.playtest.json \
  --project examples/native-smoke --url http://127.0.0.1:5184 \
  --server-command "THREENATIVE_CONTINUOUS_COLLISION_PROOF=enabled pnpm exec vite --host 127.0.0.1 --port 5184 --strictPort" \
  --browser-recipe webgpu --headed --no-screenshots
```

The build exited 0; the playtest exited 1 with
`TN_PLAYTEST_RESOURCE_ASSERTION_FAILED` for the exact assertion
`GameState.continuousCollision.hit equals true changed true`. The observed state stayed
`effectiveSetting: false`, `hit: false`, and the projectile reached
`[3, -0.09605628997087479, 0]`, proving it crossed the wall. The default was restored to `true`
and the package was rebuilt before the green run. This is the source-equivalent pre-feature
control; the worktree already carried the PRD implementation when validation began, so this
record does not claim a pristine checkout of an earlier commit.

The two passthrough/reporting mutation controls were also red:

| Mutation | Observed red |
| --- | --- |
| Report `RigidBody3D.continuousCollision` as the default instead of the supplied value | The explicit opt-out test expected projectile x `> 0.1`, then failed at `-0.07495129108428955`; the property assertion was not reached. |
| Replace native `ccd_enabled(options.continuous_collision)` with `ccd_enabled(false)` | Rust conformance failed with `continuous body crossed the wall at 1`. |

Both mutations were restored before the final green runs.

## AC6 — capability manifest and template instructions

`pnpm build` generated a 210-entry capability manifest. The situation line
`a bullet passes through a wall` is present in the capability manifest, capability reference,
framework-block instructions, and all eight shipped template `AGENTS.md`/`CLAUDE.md` mirrors.
`pnpm sync:agents` passed with `17 mirrors, 0 written`.

## AC7 — command record

The focused pre-repair geometry/evidence check was red: the original scripts placed the wall at
`x=10000` and bodies at `x=-1000`, the executable radius was `0.05 m` while the record said
`0.1 m`, and the record called the standalone Cargo run a desktop V8/Dawn/Vulkan measurement.
The controlled AC4 red result and its exact command/assertion are recorded in AC4 above.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS; existing complexity diagnostics remain warnings |
| `pnpm build` | PASS; 210 capability entries |
| `pnpm sync:agents` | PASS; 17 mirrors, 0 written |
| `pnpm --filter @threenative/physics build` during the controlled default-off red run, then again after restoring the default | PASS; both package builds completed and the source default is restored to `true` |
| `pnpm exec vitest run packages/physics/__tests__/continuous-collision.spec.ts packages/physics/__tests__/native-contract.spec.ts` | PASS; 22 tests |
| `cwd packages/runtime-native: pnpm exec vitest run --config vitest.config.ts tests/continuous-collision-benchmark.test.mjs` | PASS; 2 focused benchmark geometry/report tests |
| `pnpm exec vitest run packages/physics/__tests__` | PASS; 172 tests |
| `cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --lib` | PASS; 14 tests |
| `cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --test parity` | PASS; 2 tests |
| `rustfmt --edition 2024 --check packages/runtime-native/native/physics/examples/measure_continuous_collision.rs` | PASS; changed Rust example is formatted |
| native integration cargo tests (`actuation`, `joints`, `parity`) | PASS; 13 tests |
| native C++ actuation binding test | PASS; `native physics actuation bindings passed` |
| `pnpm native:build` | PASS; desktop V8/Dawn/Vulkan host built |
| `cargo run --quiet --release --manifest-path packages/runtime-native/native/physics/Cargo.toml --example measure_continuous_collision` | PASS; standalone Rust runner emitted `0.05 m` radius, wall-at-`x=0`, crossing-path metadata and the native timing rows above |
| `node packages/runtime-native/scripts/measure-continuous-collision.mjs` | PASS; measurements above |
| green WebGPU AC4 playtest command in AC4 | PASS; effective CCD and wall hit were both `true` |
| `cwd examples/native-smoke: THREENATIVE_CONTINUOUS_COLLISION_PROOF=enabled THREENATIVE_NATIVE_BACKEND=enabled THREENATIVE_PLAYTEST_BRIDGE=enabled pnpm exec vite build` | PASS; native-smoke bundle built |
| `mystral compile` command in AC4 | PASS; desktop executable compiled |
| desktop AC4 playtest command in AC4 | PASS; native runtime reported effective CCD and wall hit as `true` |
| controlled default-off AC4 playtest command in AC4 | RED as required; exit 1 on `GameState.continuousCollision.hit equals true changed true`, with effective CCD and hit both `false`; source default was restored and rebuilt before green runs |
| `pnpm budgets` | PASS; 40,222 framework LOC and 115,789 native LOC |
| `pnpm census` | PASS; census updated to 115,789 lines and names PRD-292 on affected rows |
| `pnpm check:docs` | PASS; 1197 links and 848 Markdown files checked |
| `pnpm test` | 304 files passed / 2 failed out of 306; 3027 tests passed, 1 skipped. The failures were Android and iOS `device-smoke` visibility assertions at `expect(result.pass).toBe(true)` |
| `pnpm test:playtest` | Existing failure: `movement-axis.playtest.json` reports `TN_PLAYTEST_BRIDGE_MISSING` |
| `pnpm test:templates` | 7/8 template projects passed; existing defense `defense-survive-ten-waves` failed with 4 leaks. The same filtered defense scenario with the CCD default disabled also failed (1 leak), so the fixture failure is not caused by PRD-292. All production-performance scenarios passed. |

The repository-wide unit gate required a local QuickJS setup because its pinned render test
executables were absent; configuring `build/tn-linux-quickjs` with the repository's CMake
toolchain and building `threenative-rg11b10-renderable-test` and
`threenative-timestamp-query-test` resolved that setup issue. The remaining two `pnpm test`
failures are the device-smoke assertions named above.

The setup commands were:

```sh
packages/runtime-native/.runtime/tools-venv/bin/cmake -S packages/runtime-native \
  -B packages/runtime-native/build/tn-linux-quickjs -DCMAKE_BUILD_TYPE=Release \
  -DMYSTRAL_USE_V8=OFF -DMYSTRAL_USE_QUICKJS=ON -DMYSTRAL_USE_JSC=OFF \
  -DMYSTRAL_USE_DAWN=ON -DMYSTRAL_USE_WGPU=OFF -DTN_ENABLE_NATIVE_PHYSICS=OFF
packages/runtime-native/.runtime/tools-venv/bin/cmake \
  --build packages/runtime-native/build/tn-linux-quickjs \
  --target threenative-rg11b10-renderable-test threenative-timestamp-query-test --parallel
```

## Recovery verification — 2026-09-02

The recovered physics implementation was rebuilt and rerun on both backends. The focused contract
checks stayed green:

```text
pnpm exec vitest run packages/physics/__tests__/continuous-collision.spec.ts \
  packages/physics/__tests__/native-contract.spec.ts --reporter=dot
PASS, exit 0; 2 files and 22 tests passed.

pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts \
  tests/continuous-collision-benchmark.test.mjs --reporter=dot
PASS, exit 0; 1 file and 2 tests passed.

cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --lib -- --nocapture
PASS, exit 0; 14 tests passed.
```

The refreshed measurement command reported the same geometric proof on both backends: wall at
`x=0`, radius `0.05 m`, `dt=1/60`, 128 bodies, 600 measured steps after 120 warmup steps, and
five samples. The fastest tunnelling speed was `67` in both runs; continuous collision reported
no first tunnel. The measured continuous-minus-baseline step cost was `0.027006933333333337 ms`
on WebGPU/Rapier `0.19.3` and `0.019935 ms` on native Rapier `0.30.0`.

```text
node packages/runtime-native/scripts/measure-continuous-collision.mjs
PASS, exit 0; web continuousFirstTunnelSpeed=null, native continuousFirstTunnelSpeed=null.

sh scripts/xvfb.sh packages/runtime-native/build/tn-linux/threenative-physics-actuation-bindings-test
PASS, exit 0; native physics actuation bindings passed.
```

The browser proof used the NVIDIA/Turing WebGPU adapter and reported
`continuousCollision.effectiveSetting=true` and `hit=true`, with no runtime or network
diagnostics. The native desktop proof compiled with `mystral` and ran through the repository Xvfb
wrapper; it reported Rapier `0.30.0`, `effectiveSetting=true`, `hit=true`, projectile x
`-0.05665740743279457`, and no diagnostics. A first native invocation without the Xvfb wrapper
failed at SDL window creation (`SDL_Init failed: No available video device`), so the successful
native command explicitly includes the wrapper.

## Recovery repository gates — 2026-09-02

The required repository gates were rerun after all four recovery groups were integrated:

| Command | Result |
| --- | --- |
| `pnpm sync:agents` and `pnpm sync:agents --check` | PASS; generated mirrors were refreshed, then all 17 `CLAUDE.md` mirrors were in sync. |
| `pnpm typecheck && pnpm lint && pnpm test` | PASS; typecheck and lint passed (522 warnings only); 340 test files passed, 1 skipped; 3406 tests passed, 2 skipped. |
| `pnpm budgets` | PASS; all budget and freshness checks passed. The informational LOC triggers reported 51,192 framework lines and 117,105 native-runtime lines. |
| `pnpm test:playtest` | PASS; movement, camera, movement-axis, zoom-input, and navigation scenarios passed on NVIDIA/Turing WebGPU with no diagnostics. |
| `PLAYWRIGHT_BROWSERS_PATH=<isolated /home cache> pnpm test:templates` | PASS; 87 scenarios across all 8 templates passed. The first bare invocation waited on an unrelated global Playwright install; the isolated-cache invocation ran the same repository script successfully. |
| `pnpm check:docs` | PASS; 1277 relative links across 944 Markdown files. |

The physics proof remains green on both backends. The generated native census and coverage records
were refreshed after the recovery: the census reports 117,105 native-runtime lines, and the
coverage digest is `sha256:6514113644293758f595aa5d147110ae902d58c3fb97342db96814cc5011453d`.
