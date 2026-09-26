// Vendors the `bevy_city` example's asset pack so the city arm runs offline and reproducibly.
//
// Upstream loads these from `https://github.com/bevyengine/bevy_asset_files/raw/main/kenney` at
// runtime. A benchmark whose inputs arrive over the network on every run is not reproducible and
// cannot have its bytes hashed, so the pack is fetched once into the pinned Bevy checkout's own
// `assets/` folder and the adapter loads it from there. Every fetched file's SHA-256 is written to
// `city-assets.lock.json`, which the arm records in the fixture beside the asset ids it read.
//
// The Kenney packs are CC0-1.0; the attribution travels with the bytes, not with the code license.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://github.com/bevyengine/bevy_asset_files/raw/main/kenney";
/** The exact relative paths `examples/large_scenes/bevy_city/src/assets.rs` loads at `c6f634ca…`. */
const PATHS = [
  "car-kit/Textures/colormap.png",
  "car-kit/hatchback-sports.glb",
  "car-kit/suv.glb",
  "car-kit/suv-luxury.glb",
  "car-kit/sedan.glb",
  "car-kit/sedan-sports.glb",
  "car-kit/truck.glb",
  "car-kit/truck-flat.glb",
  "car-kit/van.glb",
  "car-kit/delivery.glb",
  "car-kit/delivery-flat.glb",
  "car-kit/taxi.glb",
  "car-kit/garbage-truck.glb",
  "car-kit/ambulance.glb",
  "car-kit/police.glb",
  "car-kit/firetruck.glb",
  "city-kit-roads/road-crossroad-path.glb",
  "city-kit-roads/road-straight.glb",
  "city-kit-roads/tile-low.glb",
  // Not named in `assets.rs`: `tile-low.glb`'s own default material references it relatively, and a
  // missing one leaves an untyped asset un-loaded forever, so the scene's loading gate never opens.
  "city-kit-roads/Textures/colormap.png",
  "city-kit-commercial/Textures/colormap.png",
  "city-kit-commercial/Textures/variation-a.png",
  "city-kit-commercial/Textures/variation-b.png",
  "city-kit-commercial/building-skyscraper-a.glb",
  "city-kit-commercial/building-skyscraper-b.glb",
  "city-kit-commercial/building-skyscraper-c.glb",
  "city-kit-commercial/building-skyscraper-d.glb",
  "city-kit-commercial/building-skyscraper-e.glb",
  "city-kit-commercial/building-m.glb",
  "city-kit-commercial/building-l.glb",
  "city-kit-commercial/building-a.glb",
  "city-kit-commercial/building-b.glb",
  "city-kit-commercial/building-c.glb",
  "city-kit-commercial/building-d.glb",
  "city-kit-commercial/building-f.glb",
  "city-kit-commercial/building-g.glb",
  "city-kit-commercial/building-h.glb",
  "city-kit-suburban/Textures/colormap.png",
  "city-kit-suburban/Textures/variation-a.png",
  "city-kit-suburban/Textures/variation-b.png",
  "city-kit-suburban/Textures/variation-c.png",
  "city-kit-suburban/building-type-b.glb",
  "city-kit-suburban/building-type-c.glb",
  "city-kit-suburban/building-type-d.glb",
  "city-kit-suburban/building-type-e.glb",
  "city-kit-suburban/building-type-f.glb",
  "city-kit-suburban/building-type-g.glb",
  "city-kit-suburban/building-type-h.glb",
  "city-kit-suburban/building-type-i.glb",
  "city-kit-suburban/building-type-k.glb",
  "city-kit-suburban/building-type-l.glb",
  "city-kit-suburban/building-type-o.glb",
  "city-kit-suburban/building-type-u.glb",
  "city-kit-suburban/tree-small.glb",
  "city-kit-suburban/tree-large.glb",
  "city-kit-suburban/path-stones-long.glb",
  "city-kit-suburban/fence.glb",
];

const root = path.resolve(
  process.argv[2] ?? "artifacts/engine-load-test/sources/bevy/assets/kenney",
);
/** @type {Record<string, string>} */
const lock = {};
for (const relative of PATHS) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  const response = await fetch(`${BASE}/${relative}`);
  if (!response.ok) throw new Error(`TN_BENCH_CITY_ASSET_FETCH:${relative}:${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error(`TN_BENCH_CITY_ASSET_EMPTY:${relative}`);
  await writeFile(target, bytes);
  lock[relative] = createHash("sha256").update(bytes).digest("hex");
}
const bytes = Object.keys(lock).length;
await writeFile(
  path.join(root, "city-assets.lock.json"),
  `${JSON.stringify(
    {
      license:
        "Kenney asset packs (car-kit, city-kit-roads, city-kit-commercial, city-kit-suburban) are CC0-1.0",
      paths: lock,
      source: BASE,
    },
    null,
    2,
  )}\n`,
);
// Re-read one file so a write that silently produced nothing is a failure here, not a GPU mystery.
await readFile(path.join(root, "city-kit-suburban/fence.glb"));
process.stdout.write(`vendored ${bytes} city assets into ${root}\n`);
