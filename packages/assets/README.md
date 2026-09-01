# @threenative/assets

The asset compile step for ThreeNative games. Walks a game's `assets/` source
directory, applies ordered passes over each input, and writes content-addressed
outputs into `public/` alongside an `assets.manifest.json` describing every
managed file.

Node-only. Carries the encoder dependencies the runtime must never inherit.

## The delete-test, and the receipt that makes it possible

Every baking pass in here obeys one rule: **delete the entire baked output and the game runs
identically, just slower.** That is what separates a baking pass from a compiler of game meaning —
the thing this project has already tried once and deleted. A pass that cannot pass the delete-test
does not ship.

Each compile therefore writes `public/bake.receipt.json` beside the manifest, listing every file
the run produced — compiled outputs, auxiliary outputs like the lightmap atlas, and the Basis
transcoder — with the producer and the source each came from. The producer writes it because only
the producer knows: a consumer that reconstructed the list by globbing `public/` would either miss
an output or delete a source asset, and both mistakes look like a passing test.

Two consequences worth knowing before you add a pass:

- **A pass that writes a file it does not declare fails the build**, by name
  (`TN_ASSETS_UNDECLARED_OUTPUT`). Declare auxiliary outputs through `auxiliaryOutputs`.
- **Nothing in the shipped runtime reads the receipt.** `@threenative/core` falls back to the
  source path when the manifest is absent, and deleting the receipt is part of the test.

`pnpm bake:delete-test --template starter` runs it: build, switch the dev server's asset watcher
off so it cannot re-bake what is about to be deleted, run the scenario, delete every file the
receipt names plus the manifest and the receipt, run the same scenario again, and compare. The
comparison is against a same-code band measured in the same run — captures are not
bit-deterministic — not against an assumed zero.

It went in **red**, and the red was the finding: the loader's no-manifest fallback resolved
`<basePath>/<logical path>`, which in a compiled project points at nothing, because the sources live
in `assets/` and the outputs are content-addressed. A logical path now resolves against an ordered
candidate list — verbatim first, then the source directory — and the gate is green. It runs as part
of `pnpm test:templates`, not in CI: the delete-test compares captured frames, and the CI job that
scaffolds templates deliberately runs only non-visual scenarios because its runner has no GPU. A run
there reports `frames: 0`, which is the runner, not the game. The account is in
`docs/verification/bake-delete-test-2026-08-31.md` and `delete-test-passes-2026-09-01.md`.

## Embedded model textures

The images inside a `.glb` go through the pipeline too, on by default. A prop carrying three
2048x2048 JPEGs is a small file and about 64 MiB of VRAM once the driver decodes it, so each
embedded image is transcoded to KTX2/Basis (UASTC for normal maps, ETC1S for colour and
metallic-roughness) and capped to a maximum resolution. The compiled model declares
`KHR_texture_basisu`; `ctx.assets.model()` wires three's shared, support-detected `KTX2Loader`
for exactly those files, and the Basis transcoder is copied next to the compiled assets even in
a project that has no standalone texture at all.

```ts
assets: {
  models: {
    // Defaults: every image compressed, longest edge capped at 2048.
    textures: { maxSize: 1024, quality: 150, overrides: [{ slot: "normalTexture", codec: "uastc" }] },
    // Off unless declared: the one stage that removes triangles on purpose.
    simplify: { ratio: 0.5, error: 0.001 },
  },
}
```

`models: { textures: "none" }` ships every image exactly as authored. Measured on an 11.2 MB
sandbox prop with three 2048x2048 JPEGs:

| Setting | File | Embedded images | Estimated GPU bytes |
| --- | --- | --- | --- |
| geometry only (`textures: "none"`) | 10.74 -> 7.74 MiB | untouched | 64.00 MiB |
| default (`maxSize: 2048`) | 10.74 -> 6.13 MiB | 6.93 -> 5.33 MiB | 10.67 MiB |
| `maxSize: 1024` | 10.74 -> 2.30 MiB | 6.93 -> 1.49 MiB | 2.67 MiB |

The pass verifies its own output: every embedded image is re-read from the written `.glb` and
compared against what went in for the material slot and UV set it is bound to, so a texture the
encoder or the writer dropped fails the build instead of shipping.

## LOD simplification

Off unless `models.simplify` is declared: it is the one stage that removes triangles on purpose,
so it trades the pass's exact triangle guarantee for a bounded one — joints and clips still
compared exactly, triangles required to fall but stay above a floor derived from the ratio, and
the bounding box held to 1% instead of 0.1%.

**How far can a ratio go before the silhouette changes?** Measured, not guessed: a 99,482-triangle
candelabrum rendered at the condition it is played at — scaled to 3 m tall, camera 3 m from its
centre, the framework's default 60° vertical fov, 1920x1080, twelve azimuths — with the coverage
mask compared against the unsimplified baseline by exact Euclidean distance transform.

| ratio | triangles | worst IoU | mean outline shift | p99 | max |
| --- | --- | --- | --- | --- | --- |
| 0.75 | 74,608 | 0.998 | 0.03 px | 1.0 px | 1.0 px |
| 0.50 | 49,738 | 0.997 | 0.05 px | 1.0 px | 1.0 px |
| 0.35 | 34,818 | 0.995 | 0.11 px | 1.0 px | 1.4 px |
| **0.25** | **24,870** | **0.992** | **0.17 px** | **1.0 px** | **3.2 px** |
| 0.15 | 15,126 | 0.985 | 0.35 px | 3.2 px | 16.0 px |
| 0.10 | 15,152 | 0.984 | 0.36 px | 5.1 px | 21.0 px |

**0.25 is the floor for a hero prop at that distance.** Down to it the outline moves at most one
pixel over 99% of its length — a quarter of the triangles for a silhouette that cannot be told
apart. Below it the simplifier starts removing whole features (the 16–21 px maxima are candle
wicks and tracery openings disappearing), and that is visible without an A/B. A seven-branch bar
of 42,904 triangles behaves the same way: 0.25 costs 1.0 px, 0.15 costs 4.0 px.

`error` is the quality guard, not the target — it is the largest a vertex may move as a fraction
of mesh extent (default 0.001, so 3 mm on a 3 m prop). It is what holds candela at 15.2% when the
config asks for 5%; reaching a true 10% needs `error: 0.005`, and no value looser than that
reduces further. Because that gap is silent by nature, the compile step prints both numbers:

```
simplified candela.glb: 99482 -> 15104 triangles (15.2% kept, requested 5.0%) — the error tolerance 0.001 stopped it short
```

Mobile native targets still refuse compressed assets — Android QuickJS and iOS JSC have no
WebAssembly and therefore no Basis transcoder — so an Android or iOS build needs
`assets.models: "none"`, exactly as it already did for compressed geometry.

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
