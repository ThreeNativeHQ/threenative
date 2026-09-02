# PRD-292 — a fast body does not pass through a wall

Verification date: 2026-09-01

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
| Web | 0.047922337 ms | 0.061664363 ms | 0.045509970 ms | 0.079181731 ms | +0.033671762 ms |
| Native | 0.031582 ms | 0.048802 ms | 0.037092 ms | 0.060537 ms | +0.023444 ms |

The default is `true`: the first tunnel occurs at 67 units/s on both backends, while the measured
wall-scene CCD delta at 128 bodies is +0.033671762 ms per step on web and +0.023444 ms per step
on the standalone native Rust runner. The no-wall CCD deltas were +0.013742026 ms and +0.017220
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

`pnpm build` generated a 254-entry capability manifest. The situation line
`a bullet passes through a wall` is present in the capability manifest, capability reference,
and all eight shipped template `AGENTS.md`/`CLAUDE.md` mirrors. `pnpm sync:agents` passed with
`17 mirrors, 8 written` while integrating the compressed template guidance.

## AC7 — command record

The controlled AC4 red result and its exact command/assertion are recorded in AC4 above. The
following results were observed while integrating the four recovery PRDs against the current main
tree on 2026-09-01.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | FAIL; `packages/core/__tests__/game-pixel-ratio.spec.ts(62,24): error TS2322: Type 'void' is not assignable to type 'Promise<void>'`. This is outside the recovery file set. |
| `pnpm lint` | PASS, exit 0; 518 warnings, including existing complexity warnings and four warnings in `examples/native-smoke/src/physics.ts`. |
| `pnpm build` | PASS; full workspace build completed and generated a fresh 254-entry capability manifest. |
| `pnpm sync:agents` | PASS; 17 mirrors were checked and 8 template mirrors were written during the repair. |
| `pnpm --filter @threenative/physics build` during the controlled default-off red run, then again after restoring the default | PASS; both package builds completed and the source default is restored to `true` |
| `pnpm exec vitest run packages/create-threenative/__tests__/template.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts packages/playtest/__tests__/native-smoke-scenarios.spec.ts --reporter=dot` | PASS; 3 files and 86 tests. |
| `pnpm exec vitest run packages/runtime-native/tests/continuous-collision-benchmark.test.mjs packages/physics/__tests__/continuous-collision.spec.ts packages/physics/__tests__/native-contract.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts --reporter=dot` | PASS; 3 files and 71 tests. |
| `pnpm exec vitest run packages/physics/__tests__/parity.spec.ts --reporter=dot` plus native parity cargo test | PASS; 28 browser parity tests and 2 native parity tests. |
| `cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --lib` | PASS; 14 tests |
| `cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --test parity` | PASS; 2 tests |
| `rustfmt --edition 2024 --check packages/runtime-native/native/physics/examples/measure_continuous_collision.rs` | PASS; changed Rust example is formatted. |
| native C++ actuation binding test and `pnpm native:build` | PASS; the binding target and desktop V8/Dawn/Vulkan host built. |
| `cargo run --quiet --release --manifest-path packages/runtime-native/native/physics/Cargo.toml --example measure_continuous_collision` | PASS; standalone Rust runner emitted `0.05 m` radius, wall-at-`x=0`, crossing-path metadata, and the native timing rows above. |
| `node packages/runtime-native/scripts/measure-continuous-collision.mjs` | PASS; measurements above |
| green browser and desktop AC4 commands in AC4 | PASS; WebGPU and native desktop both reported effective CCD and wall hit as `true`. |
| controlled default-off AC4 playtest command in AC4 | RED as required; exit 1 on `GameState.continuousCollision.hit equals true changed true`, with effective CCD and hit both `false`; source default was restored and rebuilt before green runs |
| `pnpm budgets` | PASS; 50,525 framework LOC, 117,105 native runtime LOC, 92 PRD files, and fresh manifest/reference checks. |
| `pnpm census` | PASS; census updated to 117,105 lines and names PRD-292 on affected rows. |
| `pnpm check:docs` | FAIL only on two existing missing PRD-249 image assets: `assets/prd-249-fluid-field/smoke.png` and `assets/prd-249-fluid-field/fire.png`. |
| `pnpm test:playtest` | PASS; all five abyss-framework scenarios passed on the NVIDIA Turing WebGPU adapter. |
| `pnpm test:templates` | FAIL only on the existing `defense-survive-ten-waves` `resource.state.leaks` assertion; the full matrix passed every other template scenario, and `TN_TEMPLATE_ONLY=defense pnpm test:templates` reproduced the same failure. No defense file changed. |
| `pnpm exec vitest run --reporter=dot` | 334 test files passed and 1 failed; 3,387 tests passed and 1 skipped. The sole failure is `scripts/__tests__/quality-json.spec.ts`, reporting two existing unknown-cast suppressions in `packages/core/src/render/virtual-shadow.ts`. |
| `pnpm typecheck && pnpm lint && pnpm test` | FAIL at typecheck on the same out-of-scope `game-pixel-ratio.spec.ts(62,24)` error, so the chained test phase did not run. |

Native coverage was regenerated by `pnpm --filter @threenative/runtime-native native:coverage`:
19,587 lines instrumented, 7,683 covered, 39.22%, digest
`sha256:6514113644293758f595aa5d147110ae902d58c3fb97342db96814cc5011453d`.

The integration closeout also includes the four PRD status updates and their archived locations.
The source resume PRD remains unchanged. `git diff --check` and the final explicit staged diff
check both passed before commit.

## Review repair — 2026-09-02

CCD is now normalized by body type at the shared seam: dynamic bodies retain the default `true`
and named `false` opt-out, while fixed, kinematic, and character bodies report and forward
`false`. The web adapter creates fixed and kinematic Rapier bodies with CCD disabled; the native
adapter sends the same effective value to the C ABI, whose Rust host already applies CCD only to
dynamic bodies.

The fixed/kinematic public-and-Rapier test and native forwarding assertions were red before the
normalization (`true` was observed where `false` was required). The focused repair suite then
passed 4 files and 75 tests, including the dynamic default and opt-out controls.
