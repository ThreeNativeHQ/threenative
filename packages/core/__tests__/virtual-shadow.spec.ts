import {
  BoxGeometry,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
} from "three";
import { float, mix, vec4 } from "three/tsl";
import { type Node, type NodeBuilder, type NodeFrame, WGSLNodeBuilder } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { VIRTUAL_SHADOW_MOVER_LAYER as PUBLIC_VIRTUAL_SHADOW_MOVER_LAYER } from "../src/index.js";
import {
  VIRTUAL_SHADOW_MARKER,
  VIRTUAL_SHADOW_MOVER_LAYER,
  VirtualShadowNode,
  readVirtualShadowMarker,
} from "../src/render/virtual-shadow.js";

/**
 * The mechanism, without a GPU: level windows snap to their own texel grid, cached levels stay
 * stable while tracked casters render through mover maps, and the counters say so.
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

interface IShaderGraphBuilder extends NodeBuilder {
  setShaderStage(shaderStage: "fragment"): void;
  flowStagesNode(node: Node, output: "vec4"): { code: string };
}

function shadowGraphBuilder(): IShaderGraphBuilder {
  const object = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  const renderer = {
    backend: { isWebGPUBackend: true },
    hasCompatibility: () => true,
    library: { fromMaterial: () => null },
    shadowMap: { enabled: true, type: 1 },
  };
  const graphBuilder = new WGSLNodeBuilder(
    object,
    renderer as never,
  ) as unknown as IShaderGraphBuilder;
  graphBuilder.setShaderStage("fragment");
  return graphBuilder;
}

describe("VirtualShadowNode", () => {
  it("should expose the mover layer from the main core entry point", () => {
    expect(PUBLIC_VIRTUAL_SHADOW_MOVER_LAYER).toBe(VIRTUAL_SHADOW_MOVER_LAYER);
  });

  it("should reject a non-positive map size and a non-increasing clip list by name", () => {
    const { light } = world();
    expect(() => new VirtualShadowNode(light, { mapSize: 0 })).toThrow(
      /TN_VIRTUAL_SHADOW_INVALID/u,
    );
    expect(() => new VirtualShadowNode(light, { moverMapSize: 0 })).toThrow(/moverMapSize/u);
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

  it("should combine stock intensity-adjusted shadow factors by the darker result", () => {
    const { light } = world();
    light.shadow.intensity = 0.35;
    const node = new VirtualShadowNode(light, { clipExtents: [8, 32], marker: false });
    const graphBuilder = shadowGraphBuilder();
    const root = node.setup(graphBuilder);
    expect(root).not.toBeNull();

    // ShadowNode already turns a raw factor into mix(1, raw, shadow.intensity). If the same
    // intensity is applied again by this node, two identical adjusted factors multiply instead
    // of preserving the darker one. The mocked stock nodes keep this test on the graph contract
    // while leaving their renderer-owned setup out of the unit test.
    const rawFactors = [0.2, 0.6, 0.2, 0.6];
    [...node.levelNodes, ...node.moverNodes].forEach((shadowNode, index) => {
      const raw = rawFactors[index];
      if (raw === undefined) return;
      vi.spyOn(
        shadowNode as Node & { setup: (builder: NodeBuilder) => Node },
        "setup",
      ).mockImplementation(() => vec4(mix(1, float(raw), float(light.shadow.intensity))));
    });

    const flow = graphBuilder.flowStagesNode(root as Node, "vec4");
    const adjusted = rawFactors.map((raw) => 1 - (1 - raw) * light.shadow.intensity);
    expect(Math.min(adjusted[0] ?? 1, adjusted[1] ?? 1)).toBeCloseTo(0.72);
    expect(Math.min(adjusted[0] ?? 1, adjusted[1] ?? 1)).not.toBeCloseTo(0.72 * 0.86);
    expect(flow.code).toMatch(/min\(/u);
    expect(flow.code).not.toMatch(/vec4<f32>[^\n]*\*\s*vec4<f32>/u);
    expect(flow.code).toContain("0.35");
    expect(flow.code).toContain("vec4<f32>( 1.0, 1.0, 1.0, 1.0 )");
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

  it("should keep the mover contribution neutral and skip mover renders with no tracked casters", () => {
    const { camera, light } = world();
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64 });
    for (const levelNode of node.levelNodes) {
      vi.spyOn(
        levelNode as Node & { updateShadow(frame: NodeFrame): void },
        "updateShadow",
      ).mockImplementation(() => undefined);
    }
    const moverSpies = node.moverNodes.map((moverNode) =>
      vi
        .spyOn(moverNode as Node & { updateShadow(frame: NodeFrame): void }, "updateShadow")
        .mockImplementation(() => undefined),
    );

    node.updateBefore({ camera, renderer: {} } as unknown as NodeFrame);

    expect(node.stats).toMatchObject({ movers: 0, moverRenders: 0 });
    expect(moverSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it("should draw a tracked caster through the mover layer every frame and leave the cached levels alone", () => {
    const { camera, light, scene } = world();
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64 });
    const mover = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const hoof = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshBasicMaterial());
    mover.add(hoof);
    scene.add(mover);
    node.trackCaster(mover);
    expect(hoof.layers.isEnabled(VIRTUAL_SHADOW_MOVER_LAYER)).toBe(true);
    camera.position.set(0, 5, 0);
    node.updateBefore(frameFor(camera));
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ movers: 1, moverRenders: 2, rendered: 0 });
    // A step — and a breathing idle would do the same — is a mover-map render, never a level one.
    mover.position.set(2, 0, 2);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ cached: 2, moverRenders: 2, rendered: 0 });
    // Three frames: the first placed and rendered both levels, the other two served both.
    expect(node.stats.reuseRatio).toBeCloseTo(4 / 6);
    expect(node.untrackCaster(mover)).toBe(true);
    expect(hoof.layers.isEnabled(VIRTUAL_SHADOW_MOVER_LAYER)).toBe(false);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ movers: 0, rendered: 0 });
  });

  it("should restore a mover's pre-existing layer when it is untracked", () => {
    const { light } = world();
    const node = setupNode(light, { clipExtents: [8] });
    const mover = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mover.layers.enable(VIRTUAL_SHADOW_MOVER_LAYER);
    node.trackCaster(mover);
    expect(node.untrackCaster(mover)).toBe(true);
    expect(mover.layers.isEnabled(VIRTUAL_SHADOW_MOVER_LAYER)).toBe(true);
  });

  it("should keep explicit tracker invalidation working for existing callers", () => {
    const { camera, light } = world();
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64 });
    node.updateBefore(frameFor(camera));
    node.tracker.update("manual", {
      min: { x: 0.2, y: 0, z: -0.8 },
      max: { x: 0.8, y: 2, z: -0.2 },
    });
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ invalidated: 2, rendered: 2 });
  });

  it("should keep a tracked caster out of the cached level render and put it back afterwards", () => {
    const { camera, light, scene } = world();
    const node = setupNode(light, { clipExtents: [8], mapSize: 64 });
    const mover = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mover.castShadow = true;
    scene.add(mover);
    node.trackCaster(mover);
    const seen: boolean[] = [];
    const levelNode = node.levelNodes[0] as unknown as { updateShadow(frame: NodeFrame): void };
    const moverNode = node.moverNodes[0] as unknown as { updateShadow(frame: NodeFrame): void };
    vi.spyOn(levelNode, "updateShadow").mockImplementation(() => seen.push(mover.castShadow));
    const moverSpy = vi.spyOn(moverNode, "updateShadow").mockImplementation(() => undefined);
    camera.position.set(0, 5, 0);
    node.updateBefore({ camera, renderer: {} } as unknown as NodeFrame);
    // The first frame places the level and renders it once, without the mover in it.
    expect(seen).toEqual([false]);
    expect(mover.castShadow).toBe(true);
    expect(moverSpy).toHaveBeenCalledTimes(1);
  });

  it("should re-render every level once after invalidateAll and count it as invalidated", () => {
    const { camera, light } = world();
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64 });
    camera.position.set(0, 5, 0);
    node.updateBefore(frameFor(camera));
    node.updateBefore(frameFor(camera));
    node.invalidateAll();
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ invalidated: 2, rendered: 2 });
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
