// Bakes this folder's world.json into baked.json. Run it once from your game project:
//   node src/terrain/forest/bake.mjs
// The game imports the baked JSON and never evaluates terrain at runtime.
import { readFile, writeFile } from "node:fs/promises";
import { Terrain, applyPlacementOverrides, bakeMesh } from "@threenative/terrain";

// Explicit sRGB surface colours, in material-ID order, copied from the terrain preview's palette.
const palette = [
  [0.38, 0.46, 0.26],
  [0.46, 0.36, 0.25],
  [0.47, 0.47, 0.44],
  [0.91, 0.94, 0.95],
  [0.73, 0.63, 0.46],
  [0.37, 0.32, 0.24],
  [0.48, 0.44, 0.36],
  [0.32, 0.4, 0.28],
];

// A placement is either an authored transform, or the scatter pose: yaw about +Y, uniform scale.
function pose(item) {
  if (item.transform)
    return {
      position: item.transform.position,
      quaternion: item.transform.quaternion,
      scale: item.transform.scale,
    };
  return {
    position: item.position,
    quaternion: [0, Math.sin(item.rotation / 2), 0, Math.cos(item.rotation / 2)],
    scale: [item.scale, item.scale, item.scale],
  };
}

const round = (value, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const roundAll = (values, digits) => Array.from(values, (value) => round(value, digits));

// Rounding a quaternion breaks unit length; re-normalise so consumers need no tolerance.
const unitQuaternion = (quaternion) => {
  const length = Math.hypot(...quaternion);
  return roundAll(
    quaternion.map((value) => value / length),
    6,
  );
};

const started = performance.now();
const doc = JSON.parse(await readFile(new URL("./world.json", import.meta.url), "utf8"));
const state = applyPlacementOverrides(
  Terrain.fromJSON(doc.recipe).evaluate(),
  doc.placementOverrides ?? {},
);
const mesh = bakeMesh(state, { palette });

const placements = state.instances.map((item) => {
  const { position, quaternion, scale } = pose(item);
  return {
    id: item.id,
    asset: item.asset,
    position: roundAll(position),
    quaternion: unitQuaternion(quaternion),
    scale: roundAll(scale),
  };
});

const baked = {
  size: state.size,
  resolution: state.resolution,
  heights: roundAll(state.height),
  colors: roundAll(mesh.colors),
  placements,
  lakes: state.waters
    .filter((water) => water.kind === "lake")
    .map(({ id, at, radius, level }) => ({ id, at, radius, level })),
  rivers: state.rivers,
  waterLevel: state.waters.find((water) => water.kind === "ocean")?.level ?? null,
};
const json = JSON.stringify(baked);
await writeFile(new URL("./baked.json", import.meta.url), json);

const perAsset = {};
for (const placement of placements)
  perAsset[placement.asset] = (perAsset[placement.asset] ?? 0) + 1;
console.log(
  `baked.json: ${placements.length} placements (${Object.entries(perAsset)
    .map(([asset, count]) => `${asset} ${count}`)
    .join(", ")}); ${Math.round(performance.now() - started)} ms; ${Buffer.byteLength(json)} bytes`,
);
