# PRD-283 AC5 — the cold-agent install of virtual geometry

Date: 2026-08-30. Subject: a game built outside this repository, against packed tarballs, in a
project with no workspace and no `AGENTS.md` chain. Phase 3 of the
[virtual geometry batch](../PRDs/done/nanite-like/README.md), and the criterion its own file recorded
as **not done**.

**Verdict: AC5 passes, and it found an engine defect no in-repo test could have found.** A
524,288-triangle body authored by a script that has never heard of cluster DAGs bakes through
`threenative build`, the loader returns a `ClusteredMesh`, and the frame submits **2.95% of what
the body holds** at the far mark. The install is the part that had never been proven, and the
first thing it proved was broken.

## The defect the install found

`assets.models.virtual` is the one key a game sets to move or opt out of the bake. It is
documented in `packages/core/src/index.ts` next to `ClusteredMesh`, in the batch README, and in
every template's instructions. It did not work.

- `create-threenative`'s `loadConfig` validated it, range-checked `simplifyRatio`, rejected
  misspelled sub-keys, and resolved the object. Five tests covered it and all five were green.
- `compileAssets` — the only consumer, the function `threenative build` hands that object to —
  listed `lightmap`, `passes`, `quantize`, `simplify` and `textures`, and not `virtual`. A project
  that wrote the documented override died at `TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.models.virtual
  is not recognised.` before one asset compiled.
- `IThreeNativeModelsConfig`, the type a `threenative.config.ts` is written against, had no
  `virtual` field either, so a TypeScript project could not get as far as the runtime error:
  `error TS2353: Object literal may only specify known properties, and 'virtual' does not exist in
  type 'IThreeNativeModelsConfig'.`

Both sides were tested and neither test crossed the seam. Fixed in `7a44b18c` with three tests on
the assets side, the field on the core type, and one test that takes a resolved config from
`loadConfig` and hands it to `compileAssets` — the seam itself.

Nothing in this run needed the fix: the sandbox game leaves `assets.models` at its default, which
is how virtual geometry is meant to be reached. The defect is what a game hits the moment it wants
the payload smaller or gone.

## What was executed

Sandbox: `pnpm sandbox --genre exploration --name virtual-quarry --out ../sandbox --template
starter`, which packs all eight packages, scaffolds outside the monorepo and installs from the
tarballs.

```
sandbox ready (framework arm): /home/joao/projects/threenative/sandbox
  game folder: /home/joao/projects/threenative/sandbox/virtual-quarry
  framework source readable: 0 lines — dist is types plus bundled js
  CHARTER.md, docs/, PRDs, budgets, LOC classifier: not present
  AGENTS.md in scope: 1 (the generated one)
  sealed proof SHA-256: ad1a3f4bc098352de7490256abd5936582b4ac83f28ffdc0525995f10633626e
```

The body, written by `scripts/make-mesh.mjs` with `three` and `@gltf-transform/core` and no
knowledge of clustering:

```
assets/face.glb  524,288 triangles  12.6 MB
```

The bake, through `pnpm build:web`, which is `threenative build --target web`:

```
model face.glb (EXT_meshopt_compression, KHR_mesh_quantization, TN_virtual_geometry):
  12614656 -> 7567556 bytes (-40.0%), 524288 triangle(s)
models total: 12615280 -> 7568880 bytes (-40.0%)
```

The `TN_virtual_geometry` extension is in a `.glb` that is 40% *smaller* than its source, because
the cluster payload rides alongside meshopt compression and quantization the same pass applies.

## The frame

`playtests/virtual.playtest.json`, three marks along a dolly, run by the template's own
`pnpm test` — `vite build && threenative-playtest --browser-recipe webgpu --headed`.

| | |
| --- | --- |
| adapter | `nvidia` / `turing`, under the runner's private Xvfb — not SwiftShader |
| what the loader returned | `ClusteredMesh` (`clustered: true`) |
| submitted at the near mark, 2.4 m | **70,513 triangles** — 13.4% of the body |
| submitted at the far mark, 40 m | **15,471 triangles** — 2.95% of the body |
| non-blank pixels | ratio 1 of the 1280x720 region |
| console errors, network errors, runtime diagnostics | 0, 0, 0 |

Both frames are crack-free by eye and shaded by the game's own `MeshStandardMaterial`; no
framework shader participates. Screenshots are in the sandbox repository at
`virtual-quarry/artifacts/playtest/`.

## What the first run failed on, and why that is the harness working

The first run failed four assertions and the failure was correct. `loaded`, `clustered` and both
`triangles` bounds held *before* the steps ran as well as after, so the runner marked them trivial
— an assertion that would pass whether or not the walk happened proves nothing about the walk.
PRD-265's rule, doing its job on a scenario written carelessly.

The repair is not a looser runner. `triangles lte 60000` is false at the near mark (70,513) and
true at the far one (15,471), so it now measures the thing the phase claims: the cut shrinks as
the camera retreats. `loaded` and `clustered` are constant by construction — what the loader
returned is decided once, at load — and each carries an `allowTrivial` reason saying so. Two
opt-outs, both named in the report (`trivialityOptOutCount: 2`).

## What this does not prove

- **Android and iOS remain UNVERIFIED**, exactly as PRD-283's Status says. Every number here is
  desktop browser.
- **No native target was built from the sandbox.** AC4 already proved native from the in-repo
  quarry; this run proves the install, not a second platform.
- **Nothing here re-measures the native regression** PRD-283 leaves open — 89 draws and an arrival
  that is not spread over frames. That is still the batch's open item.
