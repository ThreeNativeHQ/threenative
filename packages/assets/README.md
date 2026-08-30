# @threenative/assets

The asset compile step for ThreeNative games. Walks a game's `assets/` source
directory, applies ordered passes over each input, and writes content-addressed
outputs into `public/` alongside an `assets.manifest.json` describing every
managed file.

Node-only. Carries the encoder dependencies the runtime must never inherit.

## Static lightmaps

Opt a project's existing model pipeline into deterministic UV2 generation and offline static-light
baking through `threenative.config.ts`:

```ts
assets: {
  models: { lightmap: { atlasSize: 1024, padding: 4 } },
}
```

Games still load the logical `.glb` with `ctx.assets.model()`. The compiler writes standard
`TEXCOORD_1` data and a content-addressed KTX2; the runtime attaches it through Three.js
`material.lightMap`. Removing the `lightmap` config removes the pass. Android and iOS builds still
fail closed on KTX2 because those native hosts do not yet carry a decoder.

| Proof | Result |
| --- | --- |
| Deterministic compile | Independent fresh directories produced byte-identical GLB, KTX2, and manifest hashes. |
| Ordinary consumer | Stock `GLTFLoader` + `KTX2Loader` loaded the compiled binary paths without `@threenative/core`. |
| Web gameplay | Packed-tarball sandbox required `material.lightMap` before reaching the goal could win. |
| Negative control | Setting `material.lightMap = null` made `staticLightReady` and the win assertion fail. |
| Native status | Linux desktop rendered the packed GLB/KTX2 with a clean playtest; Android/iOS still fail closed because their hosts have no KTX2 decoder. |
