# `godot-lights-meshes` — canonical fixture for `benchmark_box_1000`

The scene in `benchmark_box_1000.json` was built by the pinned upstream Godot benchmark script, not
by anything in this repository. `export_benchmark_box_1000.gd` loads
`res://benchmarks/rendering/lights_and_meshes.gd` out of the pinned `godot-benchmarks` checkout and
calls its own `benchmark_box_1000()`; the only thing the exporter adds is a disclosed seed, then it
serialises the tree Godot constructed. Re-deriving the scene — or upstream's `randf()` sequence — in
TypeScript is exactly what this file exists to avoid.

## Generate

```sh
GODOT=/home/joao/.local/bin/godot            # 4.7.1.stable.official.a13da4feb
PINNED=artifacts/engine-load-test/prd-449/godot-benchmarks/src
OUT=benchmark/engine-load-test/godot-lights-meshes/benchmark_box_1000.json

"$GODOT" --headless --path "$PINNED" \
  --script "$PWD/benchmark/engine-load-test/godot-lights-meshes/export_benchmark_box_1000.gd" \
  -- --out "$PWD/$OUT"
```

Writes the fixture plus `benchmark_box_1000.json.sha256` (`sha256sum -c` compatible), prints the
actual census, and exits non-zero without writing anything if a count, a hierarchy, a property or a
value does not hold. Two runs on the same machine produce the same bytes: seed `20260927`, fixture
SHA-256 `13c302b69d450ecd28100c188900cac9d8538a91c28d72620a7463a9617212a4`.

`--path` must be the pinned checkout — the exporter runs the upstream file in place, so the scene is
whatever the pinned bytes build. The pinned source's identity is in
`benchmark/engine-load-test/sources.lock.json` (commit `b059e38a…`, blob
`e9ded113e727529965fcc172d23062e0e13948a7`); the exporter refuses mismatched source bytes,
and the fixture repeats that source SHA-256 for the test to check against the tracked lock.

## What is in it

2,082 nodes, 2.9 MB, pretty-printed: stable child-index ids (`1/0/10/0`) and parents, local and
world transforms, the shared `BoxMesh` with its vertex, normal, tangent, UV and index buffers as
base64 little-endian float32/int32 plus a SHA-256 each, the unassigned-material binding, the
camera's projection, the nine spot lights' settings with the source-set values separated from the
engine defaults, the Lighter phases, both grid rotater speeds, the per-frame rules and the upstream
frame schedule. Reals are `"%.17f"` strings, not JSON numbers, because Godot's JSON writer keeps
about six significant digits; `encoding` in the fixture states the precision, the byte order and the
id scheme in full.

**Requested is not actual.** Upstream asks `create_scattered` for 1,000 objects and 10 lights;
`round(sqrt(count))^2` cells means the scene really holds 1,024 `MeshInstance3D` and 9
`SpotLight3D`. Both numbers are in `counts`, and any chart of this family must be labelled with the
actual one.

## Verify

```sh
pnpm exec vitest run scripts/__tests__/godot-lights-meshes-fixture.spec.ts
```

Six cases: the bytes are the canonical JSON of their own content, the recorded SHA-256 is the
identity, the recorded source SHA-256 matches the tracked pin, precision and byte order are declared,
the validator refuses an unknown field / a wrong count / a real that lost its digits, and a change
to object 10 is rejected by the full-fixture hash while remaining invisible to a first-eight
placement hash.

## Not claimed

No cross-engine equivalence — no ThreeNative or plain-Three arm has been compared to this yet. No
speed, FPS, frame-time or GPU result: Godot ran headless on the dummy renderer, so this is scene
construction only. No baked animation: the fixture holds initial state, per-frame inputs and speeds,
and no post-frame transform, energy or visibility, so a timed arm still has to do the rotation and
pulse work itself. Only `benchmark_box_1000` is exported; the source's other 13 variants are not.
`shadow_enabled` and the environment switches are the values the engine constructed, not inferences
about the source. Freezing the family's fixture revision in
`scripts/engine-load-test/experiment-matrix.ts` is still the freezer's job, and it is still a draft
placeholder there.
