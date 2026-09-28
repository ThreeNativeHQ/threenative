# @threenative/metahuman

MetaHuman head expressions for ThreeNative games: a checksum-verified OpenRigLogic WASM
evaluator and the binding-metadata contract that keeps a prepared GLB honest about the rig
it claims to drive.

Phase 1 ships the two contracts and the evaluator. `loadMetaHuman()` and the Linux native
backend land in Phase 2.

```ts
import { RigEvaluator, validateMetaHumanAssets } from "@threenative/metahuman";

const evaluator = await RigEvaluator.create(dnaBytes);
evaluator.setLod(0);
evaluator.setGuiControls(new Float32Array(evaluator.counts().gui));
evaluator.evaluate(true);
const joints = evaluator.jointOutputs(); // deltas from neutral, 10 floats per joint
evaluator.dispose();
```

## What it does

- `RigEvaluator` loads `wasm/riglogic.mjs`, verifies the binary's SHA-256 against
  `wasm/checksums.json` before instantiating it, and returns copies of every output array.
  A stale or disposed evaluator throws instead of reading freed memory.
- `validateMetaHumanAssets(bindings, dna, glb, rig, gltf)` rejects a bindings sidecar whose
  hashes, joint names, node names, blend-shape channels, morph indices, LOD indices, control
  domains or aliases do not hold up. Failures carry a stable `code` on `MetaHumanAssetError`.
- `assertAssetPath` keeps a caller-supplied path inside the asset directory.

## Building the WASM

The binary is committed. Rebuild it only with the Emscripten toolchain:

```sh
source ~/.cache/emsdk/emsdk_env.sh
node packages/metahuman/scripts/build-wasm.mjs
```

`wasm/checksums.json` records the pinned OpenRigLogic commit, the `emcc` version and both
file hashes, so a rebuilt binary is never silently swapped in.

## Tests

`pnpm exec vitest run packages/metahuman` compares the WASM evaluator against the standalone
upstream evaluator on the committed synthetic DNA. Set `TN_METAHUMAN_SAMPLE_DIR` to add the
local `Sample.dna` lane; without it that lane is reported as skipped, never as passed.
