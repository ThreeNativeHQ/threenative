# Asset pipeline — still deferred, with a trigger

**Status:** build-time pipeline deferred 2026-08-02, re-checked 2026-08-09 — **still
deferred, neither trigger fired.** Nothing in `packages/` or `scripts/` implements a
build-time asset pipeline, and that is the intended state. Asset discovery is retained by
product-owner decision after its 2026-08-09 live-agent gate failed. **Charter authority:**
`CHARTER.md` §10 (15k LOC review trigger), §11.1, §11.5 (a package exists only when it
carries a dependency the others must not inherit).


## Discovery is retained with an evidence gap; the pipeline did not ship

Asset **discovery** — finding a licensed model, texture, HDRI or sound and recording its
attribution — is separate from the build-time pipeline below. Its scaffold integration
exists and still ships: all three templates pin `threenative-asset-mcp@0.4.0` and generate a
`.mcp.json`. PRD-032's 2026-08-09 live-agent gate ran against real providers, but the no-MCP
control produced the better frame (`4/5` overall versus `3/5`). That is a failed visual
improvement result, not a pass. The product owner intentionally retained the external
process, its generated-project wiring and its recorded 32-tool surface rather than applying
the destructive kill-switch deletion. **It must not be described as proved.** The exact
commands, screenshots, hashes and blind scores remain in
[the dated evidence record](../verification/PRD-032-asset-proof/README.md).

Retention is an owner decision, not evidence that MCP improves the consumer's frame. The
bounded `game-assets` profile remains unpublished, so generated projects currently pin
`threenative-asset-mcp@0.4.0` and expose 32 tools; the recommended eight-tool loop is
documentation, not a filtered server surface.


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

`packages/core/src/assets.ts` today is 77 lines: a cached loader with `model`, `texture`,
`audio`, and injectable per-kind loaders. That is the whole framework-side surface, and it
is the right size for the current phase.

A real pipeline is a build-time tool of a completely different scale — glTF Transform,
Meshopt/Draco, KTX2/Basis, texture resizing, LOD generation, collider generation,
animation validation. Starting it now would spend the 15,000-LOC review trigger against
device work that is still open, and it would do so before a single game has shipped to
physical hardware to prove which optimizations actually matter.

## The trigger to start

Both must be true:

1. `CHARTER.md` §12 criterion **4** is met — a stranger has played a ThreeNative game for
   five minutes, with a transcript.
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
`CHARTER.md` §8 (published, MIT, its own lane, 32 tools recorded). Reuse that lane. Package
count is governed by §11.5's dependency-boundary rule and not by a number — six framework
packages today — so "there is room for one more" is never the argument.

## The longer-term reason to care

Certified, optimized, license-clean ThreeNative assets are worth more than arbitrary GLB
downloads, and that is what makes a curated marketplace defensible later
([../strategy/BUSINESS-MODEL.md](../strategy/BUSINESS-MODEL.md) stream 5). But the
marketplace is downstream of the pipeline, which is downstream of a shipped game. In that
order, or not at all.
