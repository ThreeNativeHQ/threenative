# Asset pipeline — deferred, with a trigger

**Status:** deferred, 2026-08-02. **Charter authority:** `CHARTER.md` §10 (15k LOC cap),
§11.1, §11.5 (a package exists only when it carries a dependency the others must not
inherit).

## Discovery shipped; the pipeline did not

Asset **discovery** — finding a licensed model, texture, HDRI or sound and recording its
attribution — is a separate problem from the build-time pipeline below, and it shipped in
PRD-032. It runs beside the agent as an external MCP process (`threenative-asset-mcp`,
pinned in every template's `package.json` and launched by the generated `.mcp.json`), so it
costs 0 framework LOC and 0 package slots; `pnpm budgets` fails if it is ever vendored.

The deferral below still binds discovery in one direction: `smithsonian_*` returns
scan-resolution photogrammetry that this project has no way to decimate, so the generated
`AGENTS.md` tells the agent not to route through it. **That tool is what the pipeline's
arrival unlocks.** Nothing else here is affected — discovery does not start the pipeline,
and shipping it does not fire either trigger.

## Why it is on the list at all

AI-generated games fail less often on gameplay code than on assets: inconsistent art
style, oversized textures, broken rigs, wrong animation clips, missing colliders, too many
materials, unclear licensing, and assets that look fine on desktop and die on a phone.

None of that is fixed by a better prompt.

## Why it is deferred

`packages/core/src/assets.ts` today is ~90 lines: a cached loader with `model`, `texture`,
`audio`, and injectable per-kind loaders. That is the whole framework-side surface, and it
is the right size for the current phase.

A real pipeline is a build-time tool of a completely different scale — glTF Transform,
Meshopt/Draco, KTX2/Basis, texture resizing, LOD generation, collider generation,
animation validation. Starting it now would consume the 15,000 LOC cap that Phase 1's
device work has not yet spent, and it would do so before a single game has shipped to a
device to prove which optimizations actually matter.

## The trigger to start

Both must be true:

1. `CHARTER.md` §12 criterion 3 is met — a stranger has played a ThreeNative game for five
   minutes.
2. A reference game fails a device performance budget **for asset reasons**, measured, not
   assumed.

Until then, the answer to "my textures are too big" is `gltf-transform` on the command
line. It exists, it is better than anything we would write this quarter, and pointing at
it costs nothing.

## What it looks like when it does start

A source artifact compiles to platform variants:

```
dragon-source.glb
   ├── web-high.glb
   ├── mobile-high.glb
   ├── mobile-mid.glb
   └── mobile-low.glb
```

Operations: optimize geometry · deduplicate materials · resize and compress textures ·
generate LODs · join compatible meshes · detect repeats for instancing · generate
simplified colliders · validate bones and clips · thumbnails · preserve source and license
metadata.

And an asset health report, which is the part with value on day one:

```
Knight.glb

License        CC0             ✓
Triangles      81,000          !  mobile target 25,000
Materials      14              !
Textures       8 × 4096 px     ✗
Animations     23              ✓
Root motion    detected        ✓
Collider       missing         !
```

## Where it must not live

Not in `@threenative/core`. It is build-time, it carries heavy Node-only dependencies, and
§11.5 makes that a separate release lane — the shape `asset-mcp` already has in
`CHARTER.md` §8 (published, MIT, its own lane, 32 tools verified). Reuse that lane rather
than opening a new package against a cap that is already at 7 of 8.

## The longer-term reason to care

Certified, optimized, license-clean ThreeNative assets are worth more than arbitrary GLB
downloads, and that is what makes a curated marketplace defensible later
([../strategy/BUSINESS-MODEL.md](../strategy/BUSINESS-MODEL.md) stream 5). But the
marketplace is downstream of the pipeline, which is downstream of a shipped game. In that
order, or not at all.
