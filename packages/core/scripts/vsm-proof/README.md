# VirtualShadowNode render proof

A sphere over a plane under one directional light, rendered on a WebGPU adapter three ways:
the stock shadow, `VirtualShadowNode` with three clip levels, and a single 60 m level. The
runner reads the darkest block of the stock frame as the shadow, reads the same block in the
other arms, and reports the changed-pixel ratio between stock and virtual.

```sh
pnpm --filter @threenative/core exec tsup --config scripts/vsm-proof/tsup.config.ts
sh scripts/xvfb.sh pnpm exec tsx packages/core/scripts/vsm-proof/run.mjs   # from the repo root
```

Writes `out/results.json` and one PNG per arm. Headed Chromium with the playtest WebGPU flags;
`adapter` in the result names the device, and a SwiftShader adapter is not a proof.
