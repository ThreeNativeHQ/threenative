# PRD-251 native and capability verification

Date: 2026-08-31

Baseline SHA: `2293138591c04797aea53661cd295d590ab0a276`

Worktree: `/home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-251-r3-20260831`

Status: the capability contract is verified; native desktop, Android/Pixel 8, iOS, and visual
evidence are unverified in this repair lane. This record makes no cross-platform or mobile claim.

## Capability contract

Command:

```sh
pnpm exec vitest run packages/core/__tests__/world-capabilities.spec.ts
```
Exit code: `0`: `1` file and `4` tests passed. Complete explicit limits with an available adapter
remain `cpu-fallback` because canonical GPU world-field readback is unsupported; low limits also
select the declared reduced CPU fallback, and missing compute with no fallback selects
`unsupported`. No test selects `gpu`.

The browser consumer reports `generation: "cpu-fallback"` with four iterations. It does not label
an adapter-limit report as an active GPU generation path because the canonical field is still CPU
owned. No Pixel 8 measurement exists, and no iOS simulator or device measurement exists; mobile
is therefore unverified, not a fabricated pass.

## Native build and runtime gates — UNVERIFIED

```sh
pnpm native:build
```

Not run in this repair lane. No native desktop build or world execution is claimed.

```sh
pnpm --filter @threenative/runtime-native test
```

Not run in this repair lane. No native runtime unit result is carried forward as world evidence.

```sh
pnpm native:verify:desktop
```

Not run in this repair lane. The desktop terrain playtest and native frame gate remain unverified.

## World conformance and desktop playtest — UNVERIFIED

Dry-run registry check:

```sh
node packages/runtime-native/conformance/run-conformance.mjs \
  --target desktop --dry-run --only-tests 100-world-field-hash
```

Not run in this repair lane; no conformance execution is claimed.

Execution:

```sh
node packages/runtime-native/conformance/run-conformance.mjs \
  --target desktop --only-tests 100-world-field-hash
```

Not run in this repair lane; no desktop conformance result is claimed.

The required desktop playtest was not run in this repair lane:

```sh
node packages/playtest/dist/runner/cli.js \
  playtests/terrain.playtest.json \
  --project examples/abyss-framework --target desktop \
  --executable packages/runtime-native/build/tn-linux/mystral --timeout 30000
```

No movement, native field hash, or desktop capture was recorded.

## Checkpoint record

- Exact baseline SHA: `2293138591c04797aea53661cd295d590ab0a276`
- Seeded red: the capability suite's low-limit and missing-fallback cases are covered; the
  cross-platform one-constant field-hash mutation was not executed in this repair lane.
- Headed evidence class: no native headed capture is claimed; the required visual side-by-side
  set remains unverified.
- Mobile evidence class: unverified; no Pixel 8, Android emulator, iOS simulator, or iOS device
  run was executed here.

Changed files for this phase:

```text
packages/runtime-native/conformance/registry.json
packages/core/src/world-capabilities.ts
packages/core/src/world.ts
docs/verification/PRD-251-native.md
```
