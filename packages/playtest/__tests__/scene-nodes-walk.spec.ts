import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Texture,
} from "three";
import { describe, expect, test } from "vitest";

import { observeSceneNodes } from "../src/three/scene-nodes.js";

/**
 * The producer half: what the walk actually reads off a real Three.js scene.
 *
 * The evaluator's fail-closed behaviour is pinned in `scene-nodes.spec.ts` against hand-written
 * observations. These pin that the observations themselves are true — that a hidden parent is
 * reported, that a texture with no image is reported as unloaded, that a node behind the camera
 * is reported outside the frustum. An evaluator that fails closed on a lying observation is
 * still a lie.
 */

function loadedTexture(): Texture {
  const texture = new Texture();
  texture.image = { height: 4, width: 4 };
  return texture;
}

function sceneWithCrate(): { camera: PerspectiveCamera; crate: Mesh; scene: Scene; vault: Group } {
  const scene = new Scene();
  const vault = new Group();
  vault.name = "vault";
  const crate = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ map: loadedTexture() }));
  crate.name = "crate";
  crate.position.set(0, 1, 0);
  vault.add(crate);
  scene.add(vault);
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 2, 8);
  camera.lookAt(0, 1, 0);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  return { camera, crate, scene, vault };
}

describe("the scene-node walk reports what the renderer will act on", () => {
  test("a selector reports the node's world position, path, bounds and frustum membership", () => {
    const { camera, scene } = sceneWithCrate();
    const [observed] = observeSceneNodes(scene, camera, [{ nameContains: "crate" }]);
    expect(observed?.matched).toBe(1);
    const node = observed?.nodes[0];
    expect(node?.path).toBe("Scene/vault/crate");
    expect(node?.position).toEqual([0, 1, 0]);
    expect(node?.type).toBe("Mesh");
    expect(node?.inFrustum).toBe(true);
    expect(node?.bounds?.min[1]).toBeCloseTo(0.5, 5);
    expect(node?.geometry?.triangles).toBe(12);
    expect(node?.geometry?.attributes).toContain("uv");
  });

  test("a hidden parent makes a visible mesh invisible, and the walk says so", () => {
    const { camera, scene, vault } = sceneWithCrate();
    vault.visible = false;
    const [observed] = observeSceneNodes(scene, camera, [{ name: "crate" }]);
    // The mesh's own flag is untouched — this is exactly the pair that makes the failure silent.
    expect(observed?.nodes[0]?.visible).toBe(true);
    expect(observed?.nodes[0]?.visibleInTree).toBe(false);
  });

  test("a node behind the camera is reported outside the frustum", () => {
    const { camera, crate, scene } = sceneWithCrate();
    crate.position.set(0, 1, 40);
    scene.updateMatrixWorld(true);
    const [observed] = observeSceneNodes(scene, camera, [{ name: "crate" }]);
    expect(observed?.nodes[0]?.inFrustum).toBe(false);
  });

  test("a bound texture with no image is reported unloaded rather than absent", () => {
    const { camera, crate, scene } = sceneWithCrate();
    (crate.material as MeshStandardMaterial).normalMap = new Texture();
    const [observed] = observeSceneNodes(scene, camera, [{ name: "crate" }]);
    const material = observed?.nodes[0]?.materials?.[0];
    expect(material?.maps).toEqual(["map", "normalMap"]);
    expect(material?.mapsUnloaded).toEqual(["normalMap"]);
    expect(material?.lit).toBe(true);
  });

  test("an unlit material is reported unlit, so a lit-material check does not condemn it", () => {
    const { camera, crate, scene } = sceneWithCrate();
    crate.material = new MeshBasicMaterial();
    const [observed] = observeSceneNodes(scene, camera, [{ name: "crate" }]);
    expect(observed?.nodes[0]?.materials?.[0]?.lit).toBe(false);
  });

  test("a selector past its limit still counts every match and says the list is cut", () => {
    const { camera, scene, vault } = sceneWithCrate();
    for (let index = 0; index < 5; index += 1) {
      const extra = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
      extra.name = `crate-${index}`;
      vault.add(extra);
    }
    scene.updateMatrixWorld(true);
    const [observed] = observeSceneNodes(scene, camera, [{ limit: 2, nameContains: "crate" }]);
    expect(observed?.matched).toBe(6);
    expect(observed?.nodes).toHaveLength(2);
    expect(observed?.truncated).toBe(true);
  });

  test("selectors are answered positionally, so each assertion reads its own observation", () => {
    const { camera, scene } = sceneWithCrate();
    const observed = observeSceneNodes(scene, camera, [{ name: "crate" }, { name: "nothing-here" }, { type: "Group" }]);
    expect(observed.map(({ matched }) => matched)).toEqual([1, 0, 1]);
    expect(observed[1]?.nodes).toEqual([]);
  });

  test("more selectors than the protocol allows throws rather than being trimmed", () => {
    const { camera, scene } = sceneWithCrate();
    const selectors = Array.from({ length: 17 }, (_unused, index) => ({ name: `n${index}` }));
    expect(() => observeSceneNodes(scene, camera, selectors)).toThrow(/protocol allows/u);
  });
});
