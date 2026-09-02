# @threenative/ueformat

A strict UEFormat v10 `.uemodel` parser and Three.js loader for assets exported from Unreal
packages by CUE4Parse/FModel.

```text
.uasset / .uexp / .ubulk / .pak / .utoc
                  ↓ CUE4Parse
              .uemodel
                  ↓ this package
     BufferGeometry / Mesh / LOD / Group
```

This package does **not** pretend that an isolated `.uasset` is a self-contained mesh. It handles
the stable interchange boundary: CUE4Parse extracts UE4/UE5 packages, then this loader validates
and constructs renderable Three.js objects.

## Supported

- UEFormat v10 `UEMODEL` headers and named attribute sets
- uncompressed, GZIP, and injected-decoder ZSTD bodies
- static and skeletal mesh LOD records
- positions, normals, tangents, indices, multiple UV/color channels
- material sections as `BufferGeometry.groups`
- sparse morph targets
- skin indices/weights and skeleton metadata parsing
- sockets, virtual bones, and convex collision geometry
- Unreal centimeters/Z-up/left-handed coordinates to Three.js meters/Y-up/right-handed coordinates
- automatic winding and tangent-sign repair
- browser `Loader.load`, synchronous `parse`, and `ueformat-inspect` CLI validation

## Not implemented

- **Automatic texture/material extraction** — `.uemodel` carries material *slots* (name, path,
  index range), not texture payloads. Resolve textures through your own pipeline (the asset MCP
  does this) and supply materials through `materialFactory`.
- **Skeletal binding** — parsed bones, sockets and skin weights are exposed on `userData` and as
  `skinIndex`/`skinWeight` attributes, but the package never constructs a `THREE.SkinnedMesh` or
  binds a skeleton. That is deliberately left to the game; nothing here invents it.
- ZSTD bodies require an injected `zstdDecoder` — the package never bundles a ZSTD implementation.

## The look is the game's

Every material comes from the game through `materialFactory`. The fallback matches three.js's own
`GLTFLoader`: a plain `MeshStandardMaterial` named after the slot. No colour, roughness, or
metalness is decided here.

## Provenance

Absorbed from the standalone `three-ueformat-loader` package (MIT, ThreeNative contributors, 2026)
into the engine. The parser is pure TypeScript with no browser or Node globals — the same code runs
in the browser, in Node, and on the native arm.
