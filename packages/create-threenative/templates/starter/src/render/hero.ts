// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The player character, built from the rounded primitives in `shapes.ts`. It lives in its own
// file because it is the one object here with a design rather than a shape: fifteen placed boxes
// in three materials, merged down per material so the whole character costs three draw calls.
import { type Material, Mesh } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { roundedBox } from "./shapes.js";

export interface IHeroMaterials {
  readonly accent: Material;
  readonly body: Material;
  readonly dark: Material;
}

/**
 * The player character.
 *
 * A `roundedBox(0.6, 1, 0.6)` in one cream colour is what stood here, and it is the first thing a
 * new project shows anyone: a featureless pill. The hero is the one object in a starter scene that
 * has to look deliberate, because everything else — the ledge, the crate, the flag — is obviously
 * scaffolding and reads fine as scaffolding.
 *
 * Authored **centred on y = 0** so `normaliseToMetres(model, { axis: "height", metres: 1.1 })`
 * scales it without moving the feet off the collision capsule.
 *
 * The returned value is a `Mesh`, not a `Group`, because `Player.visual` is one and both
 * `GroundSnap` and `preparePlayerConventions` are written against it. Children hang off it.
 */
export function hero(materials: IHeroMaterials): Mesh {
  const parts = new Map<Material, Mesh[]>();
  const add = (mesh: Mesh): Mesh => {
    const bucket = parts.get(mesh.material as Material);
    if (bucket === undefined) parts.set(mesh.material as Material, [mesh]);
    else bucket.push(mesh);
    return mesh;
  };

  const torso = add(new Mesh(roundedBox(0.44, 0.42, 0.32, 0.13, 2), materials.body));
  torso.position.y = 0.06;
  const head = add(new Mesh(roundedBox(0.36, 0.32, 0.32, 0.13, 2), materials.body));
  head.position.y = 0.42;
  const visor = add(new Mesh(roundedBox(0.28, 0.1, 0.06, 0.03, 1), materials.dark));
  visor.position.set(0, 0.37, -0.16);
  const brim = add(new Mesh(roundedBox(0.46, 0.05, 0.42, 0.02, 1), materials.accent));
  brim.position.y = 0.52;
  const crown = add(new Mesh(roundedBox(0.3, 0.16, 0.28, 0.08, 2), materials.accent));
  crown.position.y = 0.6;
  const scarf = add(new Mesh(roundedBox(0.42, 0.1, 0.34, 0.05, 1), materials.accent));
  scarf.position.y = 0.19;
  const tail = add(new Mesh(roundedBox(0.12, 0.26, 0.08, 0.04, 1), materials.accent));
  tail.position.set(0.02, 0.06, 0.19);
  tail.rotation.x = 0.5;
  const pack = add(new Mesh(roundedBox(0.28, 0.28, 0.16, 0.07, 2), materials.dark));
  pack.position.set(0, 0.06, 0.2);

  for (const side of [-1, 1]) {
    const arm = add(new Mesh(roundedBox(0.12, 0.3, 0.14, 0.055, 1), materials.body));
    arm.position.set(side * 0.28, 0.02, 0);
    arm.rotation.z = side * -0.16;
    const hand = add(new Mesh(roundedBox(0.12, 0.11, 0.13, 0.05, 1), materials.dark));
    hand.position.set(side * 0.31, -0.15, 0);
    const leg = add(new Mesh(roundedBox(0.15, 0.3, 0.16, 0.06, 1), materials.dark));
    leg.position.set(side * 0.12, -0.36, 0);
    const boot = add(new Mesh(roundedBox(0.17, 0.1, 0.22, 0.045, 1), materials.accent));
    boot.position.set(side * 0.12, -0.51, -0.02);
  }

  // Merged down to one mesh per material: fifteen little boxes is fifteen draw calls for one
  // character, and with the shadow pass that is thirty. The three materials stay separate, so the
  // hat, the pack and the body are still repainted from `materials.ts` alone.
  const meshes: Mesh[] = [];
  for (const [material, group] of parts) {
    const geometry = mergeGeometries(
      group.map((mesh) => {
        mesh.updateMatrix();
        const placed = mesh.geometry.clone().applyMatrix4(mesh.matrix);
        const cloned = placed.index === null ? placed : placed.toNonIndexed();
        for (const name of Object.keys(cloned.attributes)) {
          if (name !== "position") cloned.deleteAttribute(name);
        }
        return cloned;
      }),
      false,
    );
    if (geometry === null) throw new Error("mergeGeometries returned null building the hero.");
    geometry.computeVertexNormals();
    const merged = new Mesh(geometry, material);
    merged.castShadow = true;
    merged.receiveShadow = true;
    meshes.push(merged);
  }
  const root = meshes[0];
  if (root === undefined) throw new Error("The hero produced no geometry.");
  for (const extra of meshes.slice(1)) root.add(extra);
  return root;
}
