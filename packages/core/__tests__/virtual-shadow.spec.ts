import {
  BoxGeometry,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
} from "three";
import type { NodeBuilder, NodeFrame } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import {
  VIRTUAL_SHADOW_MARKER,
  VirtualShadowNode,
  readVirtualShadowMarker,
} from "../src/render/virtual-shadow.js";

/**
 * The mechanism, without a GPU: level windows snap to their own texel grid, a level re-renders
 * only when its window moves or a tracked caster changes inside it, and the counters say so.
 */

function world(): { light: DirectionalLight; scene: Scene; camera: PerspectiveCamera } {
  const scene = new Scene();
  const light = new DirectionalLight(0xffffff, 1);
  light.position.set(0, 100, 0);
  light.target.position.set(0, 0, 0);
  light.castShadow = true;
  light.shadow.mapSize.set(64, 64);
  scene.add(light);
  scene.add(light.target);
  const camera = new PerspectiveCamera(60, 1, 0.1, 500);
  scene.add(camera);
  return { camera, light, scene };
}

/** The builder `setup` needs: a shadow-enabled renderer and an empty material context. */
const builder = {
  context: {},
  material: {},
  renderer: { shadowMap: { enabled: true } },
} as unknown as NodeBuilder;

function frameFor(camera: PerspectiveCamera): NodeFrame {
  return { camera } as unknown as NodeFrame;
}

function setupNode(light: DirectionalLight, options = {}): VirtualShadowNode {
  const node = new VirtualShadowNode(light, { marker: false, ...options });
  node.setup(builder);
  return node;
}

describe("VirtualShadowNode", () => {
  it("should reject a non-positive map size and a non-increasing clip list by name", () => {
    const { light } = world();
    expect(() => new VirtualShadowNode(light, { mapSize: 0 })).toThrow(
      /TN_VIRTUAL_SHADOW_INVALID/u,
    );
    expect(() => new VirtualShadowNode(light, { clipExtents: [40, 10] })).toThrow(/increase/u);
    expect(() => new VirtualShadowNode(light, { lightDistance: -1 })).toThrow(/lightDistance/u);
  });

  it("should build one cached level per clip extent and add its lights beside the source light", () => {
    const { camera, light, scene } = world();
    const node = setupNode(light, { clipExtents: [8, 32, 128] });
    expect(node.levelLights).toHaveLength(3);
    node.updateBefore(frameFor(camera));
    for (const level of node.levelLights) expect(level.parent).toBe(scene);
    // Every level renders on its first frame, none was cached.
    expect(node.stats).toMatchObject({ cached: 0, levels: 3, rendered: 3 });
    node.dispose();
    expect(
      scene.children.filter((child) => child.name.startsWith("VirtualShadowLevel")),
    ).toHaveLength(0);
  });

  it("should serve every level from cache while the camera stays inside its texel", () => {
    const { camera, light } = world();
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64 });
    camera.position.set(0.02, 5, 0.02);
    node.updateBefore(frameFor(camera));
    const targets = node.levelLights.map((level) =>
      (level as unknown as { target: { position: { clone(): unknown } } }).target.position.clone(),
    );
    // A texel of the finest level is 2 * 8 / 64 = 0.25 world units; 0.1 stays inside it.
    camera.position.set(0.12, 5, 0.12);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ cached: 2, moved: 0, rendered: 0 });
    node.levelLights.forEach((level, index) => {
      expect((level as unknown as { target: { position: unknown } }).target.position).toEqual(
        targets[index],
      );
    });
  });

  it("should re-render only the level whose window moved by a whole texel", () => {
    const { camera, light } = world();
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64 });
    camera.position.set(0, 5, 0);
    node.updateBefore(frameFor(camera));
    // 0.3 crosses the finest texel (0.25) but not the coarse one (1.0).
    camera.position.set(0.3, 5, 0);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ cached: 1, moved: 1, rendered: 1 });
    // Negative control: a level that never moves is never re-rendered.
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ cached: 2, rendered: 0 });
  });

  it("should re-render the level a tracked caster moves inside, and nothing untracked", () => {
    const { camera, light, scene } = world();
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64 });
    const mover = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    scene.add(mover);
    node.trackCaster(mover);
    camera.position.set(0, 5, 0);
    node.updateBefore(frameFor(camera));
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ invalidated: 0, rendered: 0 });
    mover.position.set(2, 0, 2);
    node.updateBefore(frameFor(camera));
    expect(node.stats.invalidated).toBeGreaterThanOrEqual(1);
    expect(node.stats.rendered).toBe(node.stats.invalidated);
    // Untracking clears the caster's last footprint once (its shadow must go), and from then
    // on the same move refreshes nothing.
    expect(node.untrackCaster(mover)).toBe(true);
    node.updateBefore(frameFor(camera));
    expect(node.stats.invalidated).toBeGreaterThanOrEqual(1);
    mover.position.set(4, 0, 4);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ invalidated: 0, rendered: 0 });
  });

  it("should print the marker on the first frame and parse it back", () => {
    const { camera, light } = world();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const node = new VirtualShadowNode(light, { clipExtents: [8], marker: 2 });
      node.setup(builder);
      node.updateBefore(frameFor(camera));
      node.updateBefore(frameFor(camera));
      const lines = info.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith(VIRTUAL_SHADOW_MARKER));
      expect(lines).toHaveLength(2);
      expect(readVirtualShadowMarker(lines[1] ?? "")).toMatchObject({
        frame: 2,
        levels: 1,
        rendered: 0,
      });
      expect(readVirtualShadowMarker("TN_FRAME_BUDGET:{}")).toBeUndefined();
    } finally {
      info.mockRestore();
    }
  });

  it("should keep the measurement when the marker is silenced", () => {
    const { camera, light } = world();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const node = setupNode(light, { clipExtents: [8] });
      node.updateBefore(frameFor(camera));
      expect(info).not.toHaveBeenCalled();
      expect(node.stats.frame).toBe(1);
    } finally {
      info.mockRestore();
    }
  });
});
