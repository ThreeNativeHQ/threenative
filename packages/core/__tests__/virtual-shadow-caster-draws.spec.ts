import {
  BoxGeometry,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
} from "three";
import type { NodeBuilder, NodeFrame } from "three/webgpu";
import { afterEach, describe, expect, it } from "vitest";
import {
  VIRTUAL_SHADOW_CASTER_LAYER,
  VIRTUAL_SHADOW_SMALL_CASTER_LAYER,
  VIRTUAL_SHADOW_WIDE_CASTER_LAYER,
  VirtualShadowNode,
} from "../src/render/virtual-shadow.js";

/**
 * PRD-473 step 0: a level's caster bill is reported, split by the kind of mesh that submitted it.
 *
 * The numbers are read straight off the node's own stats row, so a level that chooses the cluster
 * half reports the cluster-layer casters and none of the wide ones, the finest level adds its small
 * casters, and the merged per-chunk proxies and layer 0's own casters are counted as their own
 * kinds rather than folded into the batches they stand in for.
 */

const builder = {
  context: {},
  material: {},
  renderer: { shadowMap: { enabled: true } },
} as unknown as NodeBuilder;

let clock = 0;
function frameFor(camera: PerspectiveCamera): NodeFrame {
  clock += 1;
  return { camera, renderer: {}, time: clock } as unknown as NodeFrame;
}

/** One casting box on `layer` (0 for the main layer), with the name it draws under. */
function caster(scene: Scene, layer: number, name: string): Mesh {
  const mesh = new Mesh(new BoxGeometry(8, 8, 8), new MeshBasicMaterial());
  mesh.name = name;
  mesh.position.set(0, 4, 0);
  mesh.castShadow = true;
  mesh.layers.set(layer);
  scene.add(mesh);
  return mesh;
}

function shadowWorld(): { camera: PerspectiveCamera; light: DirectionalLight; scene: Scene } {
  const scene = new Scene();
  const light = new DirectionalLight(0xffffff, 1);
  // Off vertical: a sun exactly overhead leaves the level camera's own placement degenerate.
  light.position.set(60, 200, -40);
  light.target.position.set(0, 0, 0);
  light.castShadow = true;
  scene.add(light, light.target);
  const camera = new PerspectiveCamera(60, 1, 0.1, 900);
  camera.position.set(0, 10, 0);
  camera.updateMatrixWorld(true);
  scene.add(camera);
  return { camera, light, scene };
}

function nodeFor(light: DirectionalLight): VirtualShadowNode {
  const node = new VirtualShadowNode(light, {
    clipExtents: [24, 96],
    mapSize: 1024,
    marker: false,
  });
  node.setup(builder);
  // The real draw belongs to three's renderer; this test is about what the level reports.
  for (const levelNode of [...node.levelNodes, ...node.moverNodes])
    (levelNode as unknown as { updateShadow(frame: NodeFrame): void }).updateShadow = () =>
      undefined;
  return node;
}

afterEach(() => {
  clock = 0;
});

describe("a level's reported caster draws", () => {
  it("reports the chosen cluster half, its small casters, its chunk proxies and layer 0", () => {
    const { camera, light, scene } = shadowWorld();
    // One cluster square the window covers, and three key-wide meshes waiting on the wide layer:
    // 1 < 3, so the level takes the cluster half. A merged chunk proxy rides the cluster layer too,
    // and the small and layer-0 casters take no part in the choice but are still drawn.
    caster(scene, VIRTUAL_SHADOW_CASTER_LAYER, "cluster");
    caster(scene, VIRTUAL_SHADOW_CASTER_LAYER, "world-chunk-shadow");
    caster(scene, VIRTUAL_SHADOW_WIDE_CASTER_LAYER, "wide");
    caster(scene, VIRTUAL_SHADOW_WIDE_CASTER_LAYER, "wide");
    caster(scene, VIRTUAL_SHADOW_WIDE_CASTER_LAYER, "wide");
    caster(scene, VIRTUAL_SHADOW_SMALL_CASTER_LAYER, "small");
    caster(scene, 0, "terrain");
    scene.updateMatrixWorld(true);

    const node = nodeFor(light);
    node.updateBefore(frameFor(camera));

    // The finest level takes the frame's single render, so its row is the one with a bill.
    const fine = node.stats.perLevel[0];
    const by = fine?.drawsBy;
    expect(by).toBeDefined();
    if (by === undefined || fine === undefined) return;
    expect(by.cluster).toBe(1);
    expect(by.chunkProxy).toBe(1);
    expect(by.small).toBe(1);
    expect(by.layer0).toBe(1);
    expect(by.wide).toBe(0);
    expect(by.cluster + by.wide + by.small + by.chunkProxy + by.layer0).toBe(fine.draws);
    expect(fine.draws).toBe(4);
    node.dispose();
  });

  it("reports none of the wide half when the cluster half is chosen, and none of the small layer past the finest level", () => {
    const { camera, light, scene } = shadowWorld();
    caster(scene, VIRTUAL_SHADOW_CASTER_LAYER, "cluster");
    caster(scene, VIRTUAL_SHADOW_CASTER_LAYER, "world-chunk-shadow");
    caster(scene, VIRTUAL_SHADOW_WIDE_CASTER_LAYER, "wide");
    caster(scene, VIRTUAL_SHADOW_WIDE_CASTER_LAYER, "wide");
    caster(scene, VIRTUAL_SHADOW_WIDE_CASTER_LAYER, "wide");
    caster(scene, VIRTUAL_SHADOW_SMALL_CASTER_LAYER, "small");
    caster(scene, 0, "terrain");
    scene.updateMatrixWorld(true);

    const node = nodeFor(light);
    // The finest level renders first and defers the coarse one, which takes the next frame.
    node.updateBefore(frameFor(camera));
    node.updateBefore(frameFor(camera));

    const coarse = node.stats.perLevel[1];
    const by = coarse?.drawsBy;
    expect(by).toBeDefined();
    if (by === undefined || coarse === undefined) return;
    expect(by.small).toBe(0);
    expect(by.cluster).toBe(1);
    expect(by.chunkProxy).toBe(1);
    expect(by.layer0).toBe(1);
    expect(by.wide).toBe(0);
    expect(coarse.draws).toBe(3);
    node.dispose();
  });
});
