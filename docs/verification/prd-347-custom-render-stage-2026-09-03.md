# PRD-347 custom render stages — 2026-09-03

Source: `docs/PRDs/stylized-components/PRD-347-game-authored-post-stages-enter-the-measured-chain.md`.
The source PRD is outside this lane and was read but not edited.

Status: web implementation, clean-install starter smoke test, and the scaffolded browser template
matrix pass. Packed Linux desktop and native target evidence are `UNVERIFIED` because the published
`@threenative/runtime-native@0.3.0` prebuilt manifest returns HTTP 404 in this environment.

## Phase 0 red

The required red was recorded before opening the chain seam:

```sh
pnpm exec vitest run packages/core/__tests__/render-chain.spec.ts packages/create-threenative/__tests__/looks.spec.ts -t "authored|outline"
```

Result: exit `1`.

```text
Error: unknown render-chain stage 'outline'
```

The starter caller census also failed because `worldEnvironment.ts` did not yet name the authored
`outline` stage. This was the intended closed-name failure, not a blank-frame failure.

## Implemented seam

The phase `→impl` points resolve to these non-test callers:

| Contract | Implementation |
| --- | --- |
| Open id, anchor validation, dependency order and lifecycle | `packages/core/src/render/chain.ts:555` (`createStageDefinitions`) and `:607` (`resolveStageOrder`) |
| Public authored-stage id | `packages/core/src/index.ts:295` (`RenderChain` documentation/export block) |
| Starter live caller | `packages/create-threenative/templates/starter/src/render/worldEnvironment.ts:599` |
| Quality-owned request/drop policy | `packages/create-threenative/templates/starter/src/render/quality.ts:72` |
| Stage observation assertion | `packages/playtest/src/evaluators/render-chain.ts:31` |

`RenderChainStageId` keeps the fifteen built-in names as `RenderChainStageName` and adds an opaque
game-owned string id. Authored stages declare exactly one `before` or `after` anchor. Blank ids,
duplicates, missing anchors, both anchors, cycles, and requested ids without supplied definitions
throw before output installation. Explicit `requiresVelocity` remains the only custom velocity
opt-in. Active stage disposers run once on rebuild or final disposal; a failed install disposes
the graph it built.

The optional `worldPass` is an explicit scene-pass handoff for composed graphs. It keeps output
retargeting from traversing the already-composed TSL graph and does not change the native renderer.

## Focused green results

These commands were run after implementation:

```sh
pnpm exec vitest run packages/core/__tests__/render-chain.spec.ts packages/create-threenative/__tests__/looks.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts packages/playtest/__tests__/render-chain-assertion.spec.ts packages/playtest/__tests__/schema-boundaries.spec.ts
```

PASS, 5 files and 123 tests. The render-chain assertion now checks stage inclusion, exclusion,
ordered-subsequence observations, and graph-output contribution markers; it fails closed when
`TN_RENDER_CHAIN` or its contributions are absent. Workspace `pnpm typecheck`, `pnpm lint`, and
`pnpm budgets` also passed; lint reported 553 existing warnings.

## Clean-install web evidence

The disposable scaffold was created outside the repository:

```sh
pnpm sandbox --genre exploration --name prd-347-outline-final2 --template starter --out /tmp/threenative-stylized-components-sandbox-final2
```

Result: sandbox ready at
`/tmp/threenative-stylized-components-sandbox-final2/prd-347-outline-final2`.

From that scaffold:

```sh
pnpm typecheck && pnpm vite build
pnpm exec threenative-playtest --scenario playtests/look.playtest.json --browser-recipe webgpu --headed --allow-software --server-command 'pnpm dev --host 127.0.0.1 --port $PORT --strictPort'
```

Both build checks passed. The real web scenario passed with exit `0`, `frames: 741`, and no
console, network, or runtime diagnostics. It used WebGPU on an NVIDIA/Turing adapter at a
`1280×720` viewport, with `adapter.info` captured and no software fallback. The observed report
was:

```json
{
  "requested": ["ssgi", "ssr", "sharpen", "bloom", "outline", "kuwahara", "watercolor"],
  "stages": ["ssgi", "ssr", "sharpen", "bloom", "outline", "kuwahara", "watercolor"],
  "contributions": [
    { "name": "outline", "graphOutputChanged": true },
    { "name": "kuwahara", "graphOutputChanged": true },
    { "name": "watercolor", "graphOutputChanged": true }
  ],
  "dropped": [],
  "tier": "high",
  "source": "pinned"
}
```

The edge-region visual assertion passed: subject nonblank ratio `1`, subject dark-pixel ratio
`0.9894097222222222`, and before/after changed-pixel ratio `0.3593988715277778`. The captured image hashes
were:

```text
before.png  5687cd85145adb453d37eed96113415f432a228105655cf01ce45e61cd040ef0
after.png   f0d78c5d8d3cdd94ce69cbb85880398d347bc46f14ac91405322773036436010
```

The browser emitted Three.js timestamp-query pool warnings because the current runner does not
resolve per-pass queries. That is why this smoke run proves reachability and visible change but
does not claim a painterly GPU budget admission.

The scaffold source hashes matched the repository template exactly:

```text
outline.ts    b7dea8cee21a0225ca7bcb82bb0b0c35ec5a77178b510d861c4e9d3c593882fa
kuwahara.ts   de75de8beed98afcd522a280a28a59b6d0d5f621b2fa95a93e036ab2a39cbcfd
watercolor.ts cc642c21e98e2b0f3fc505ac00b54d05638863a1fb4fa42129b3de30c41fc39b
```

## Negative controls

Observed unit red controls are retained in `packages/core/__tests__/render-chain.spec.ts`:

- no supplied definition: `unknown render-chain stage 'outline': no supplied definition`;
- malformed graph: blank id, duplicate id, missing anchor, both anchors, and `ink → paint → ink`
  cycle all throw;
- each malformed construction leaves `setOutputNode` untouched;
- removing the `outline` observation makes the render-chain playtest assertion fail closed;
- returning the input node from a named stage produces `graphOutputChanged: false` and fails the
  contribution assertion;
- the starter test rejects a one-spoke Kuwahara regression by requiring 25 two-dimensional offsets
  per sector, or 200 colour samples across eight sectors at radius five.

The cycle guard was also temporarily removed with `apply_patch`; the malformed-graph test then
failed with `Maximum call stack size exceeded` instead of the required named cycle. Restoring the
guard returned the focused suite to green. The phase-2 visual mutation (zero outline strength) was
not run as a separate disposable capture; it is therefore not claimed as observed red. The web
capture above is the restored, non-zero implementation.

## Native and repository gates

The packed desktop attempt reached the web/native bundles, then stopped because the sandbox had no
runtime binary:

```sh
pnpm build:desktop
```

Result: exit `1`.

```text
Missing prebuilt runtime for 'linux-x64': .../@threenative/runtime-native/prebuilt/linux-x64/threenative-runtime
node exited with code 1.
```

`npx threenative doctor --text` identified the same HTTP 404 while fetching
`runtime-native-v0.3.0/prebuilt-lock.json`; Android is present but warns that the installed JDK
26 is outside the supported JDK 17 lane, and iOS is unavailable on Linux. No native source was
changed, and no native frame is claimed.

`pnpm test` built and passed the JavaScript workspace tests but exited `1` on six prebuilt
`packages/runtime-native` contract executables that are absent from `build/tn-linux` and
`build/tn-linux-quickjs`. The final counts were 96 test files, 692 passing tests, and 39 skipped;
the post-repair `pnpm test:templates` matrix exited `0` across all scaffolded browser templates.
`pnpm budgets` exited `0`; its completed checks reported the evidence budget as `ok` and
framework/native LOC as review triggers only. `pnpm tsx scripts/count-loc.ts` exited `0`.
