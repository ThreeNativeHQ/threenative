import {
  BoxGeometry,
  DirectionalLight,
  FloatType,
  HalfFloatType,
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
  // A renderer, because a level only re-renders and only settles its window on a frame that can
  // draw: a frame with none never holds a window, and a node asked twice renders twice.
  return { camera, renderer: {} } as unknown as NodeFrame;
}

function setupNode(light: DirectionalLight, options = {}): VirtualShadowNode {
  const node = new VirtualShadowNode(light, { marker: false, ...options });
  node.setup(builder);
  // The real render belongs to three's renderer: a level render is what a frame with a renderer
  // asks for, and this is the draw that is not the node's business under test. The tests that
  // watch the draw spy on these.
  stubLevelRenders(node);
  return node;
}

/** The real render belongs to three's renderer; the draw itself is not what these tests measure. */
function stubLevelRenders(node: VirtualShadowNode): void {
  for (const levelNode of [...node.levelNodes, ...node.moverNodes]) {
    (levelNode as unknown as { updateShadow(frame: NodeFrame): void }).updateShadow = () =>
      undefined;
  }
}

/**
 * Run frames until no level is waiting for the frame's single render.
 *
 * The node renders at most one level per frame, finest first, so a fresh node needs one frame per
 * level before every map holds something. A test about what a steady walk costs starts here; a
 * test about the scheduling itself counts the frames instead.
 */
function settle(node: VirtualShadowNode, camera: PerspectiveCamera): number {
  let frames = 0;
  do {
    node.updateBefore(frameFor(camera));
    frames += 1;
  } while (node.stats.deferred > 0 && frames < 16);
  return frames;
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
    // One level per frame, finest first: the first frame renders the finest and defers the rest.
    expect(node.stats).toMatchObject({ cached: 2, levels: 3, rendered: 1, deferred: 2 });
    // The finest is the one whose map a fragment under the camera samples, so it is never the one
    // held back: the two coarse levels follow, one frame each, until nothing is deferred.
    expect(settle(node, camera)).toBe(2);
    expect(node.stats).toMatchObject({ levels: 3, rendered: 1, deferred: 0 });
    node.dispose();
    expect(
      scene.children.filter((child) => child.name.startsWith("VirtualShadowLevel")),
    ).toHaveLength(0);
  });

  it("should serve every level from cache while the camera stays inside its texel", () => {
    const { camera, light } = world();
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64 });
    settle(node, camera);
    camera.position.set(0.02, 5, 0.02);
    node.updateBefore(frameFor(camera));
    camera.position.set(0.12, 5, 0.12);
    node.updateBefore(frameFor(camera));
    // The second frame spent its render on the coarse level the first one deferred; the third has
    // nothing left to do, which is the state this test is about.
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ cached: 2, moved: 0, rendered: 0 });
    const targets = node.levelLights.map((level) =>
      (level as unknown as { target: { position: { clone(): unknown } } }).target.position.clone(),
    );
    camera.position.set(0.2, 5, 0.2);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ cached: 2, moved: 0, rendered: 0 });
    node.levelLights.forEach((level, index) => {
      expect((level as unknown as { target: { position: unknown } }).target.position).toEqual(
        targets[index],
      );
    });
  });

  it("should invalidate cached levels when a caster is tracked or untracked", () => {
    const { camera, light, scene } = world();
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64 });
    settle(node, camera);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ cached: 2, rendered: 0 });

    const caster = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    scene.add(caster);
    node.trackCaster(caster);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({
      cached: 1,
      invalidated: 2,
      movers: 1,
      moverRenders: 2,
      rendered: 1,
      deferred: 1,
    });
    settle(node, camera);

    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ cached: 2, rendered: 0 });

    expect(node.untrackCaster(caster)).toBe(true);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({
      cached: 1,
      invalidated: 2,
      movers: 0,
      moverRenders: 0,
      rendered: 1,
      deferred: 1,
    });
    expect(settle(node, camera)).toBe(1);
  });

  it("should copy source shadow settings to cached and mover shadow nodes", () => {
    const { camera, light } = world();
    const filterNode = vi.fn();
    light.shadow.bias = -0.003;
    light.shadow.normalBias = 0.17;
    light.shadow.intensity = 0.35;
    light.shadow.radius = 3;
    light.shadow.blurSamples = 5;
    light.shadow.mapType = HalfFloatType;
    light.shadow.biasNode = float(0.01);
    (light.shadow as unknown as { filterNode: unknown }).filterNode = filterNode;
    const node = setupNode(light, { clipExtents: [8], mapSize: 64 });

    const shadowNodes = [...node.levelNodes, ...node.moverNodes];
    for (const shadowNode of shadowNodes) {
      const shadow = (shadowNode as unknown as { shadow: DirectionalLight["shadow"] }).shadow;
      expect(shadow).toMatchObject({
        bias: -0.003,
        blurSamples: 5,
        intensity: 0.35,
        mapType: HalfFloatType,
        normalBias: 0.17,
        radius: 3,
      });
      expect(shadow.biasNode).toBe(light.shadow.biasNode);
      expect((shadow as unknown as { filterNode: unknown }).filterNode).toBe(filterNode);
    }

    light.shadow.bias = 0.004;
    light.shadow.normalBias = 0.23;
    light.shadow.intensity = 0.62;
    light.shadow.radius = 6;
    light.shadow.blurSamples = 11;
    light.shadow.mapType = FloatType;
    const updatedFilterNode = vi.fn();
    light.shadow.biasNode = float(0.02);
    (light.shadow as unknown as { filterNode: unknown }).filterNode = updatedFilterNode;
    node.updateBefore(frameFor(camera));

    for (const shadowNode of shadowNodes) {
      const shadow = (shadowNode as unknown as { shadow: DirectionalLight["shadow"] }).shadow;
      expect(shadow).toMatchObject({
        bias: 0.004,
        blurSamples: 11,
        intensity: 0.62,
        mapType: FloatType,
        normalBias: 0.23,
        radius: 6,
      });
      expect(shadow.biasNode).toBe(light.shadow.biasNode);
      expect((shadow as unknown as { filterNode: unknown }).filterNode).toBe(updatedFilterNode);
    }
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
    // `refreshStep: 0` keeps the one-texel step this measures; the default holds the window still
    // until the centre has moved a fraction of the extent, which the test below covers.
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64, refreshStep: 0 });
    camera.position.set(0, 5, 0);
    settle(node, camera);
    // 0.3 crosses the finest texel (0.25) but not the coarse one (1.0).
    camera.position.set(0.3, 5, 0);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ cached: 1, deferred: 0, moved: 1, rendered: 1 });
    // Negative control: a level that never moves is never re-rendered.
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ cached: 2, rendered: 0 });
  });

  it("should hold a window still until the centre has moved `refreshStep` of its extent", () => {
    const { camera, light } = world();
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64 });
    camera.position.set(0, 5, 0);
    settle(node, camera);
    // The finest extent is 8 m and the default step is an eighth of it, so 0.5 m is a fifth of a
    // step: the window holds and the level is served from cache.
    camera.position.set(0.5, 5, 0);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ moved: 0, rendered: 0, cached: 2 });
    // Past the step it re-renders, on the fixed world grid the step is a whole number of texels of.
    camera.position.set(1.5, 5, 0);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ moved: 1, rendered: 1 });
  });

  it("should refuse a refreshStep that would cost the selection guard its trailing edge", () => {
    const { light } = world();
    expect(() => setupNode(light, { clipExtents: [8, 32], refreshStep: 0.9 })).toThrow(RangeError);
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

  it("should spend one level render per presented frame, not per render call", () => {
    const { camera, light } = world();
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64 });
    // Three calls `updateBefore` once per `render()`, and a level render *is* a render, so the draw
    // the budget grants re-enters this method with a new render id. Every level is due on the first
    // frame of a fresh node, which is the case that spent three level renders in one presented frame
    // on `?scene=map-walk`.
    let reentered = 0;
    for (const levelNode of [...node.levelNodes, ...node.moverNodes]) {
      (levelNode as unknown as { updateShadow(frame: NodeFrame): void }).updateShadow = () => {
        if (reentered < 4) {
          reentered += 1;
          node.updateBefore(frameFor(camera));
        }
      };
    }
    node.updateBefore(frameFor(camera));
    expect(reentered).toBeGreaterThan(0);
    expect(node.stats).toMatchObject({ deferred: 1, levels: 2, rendered: 1 });
    // Per level, finest first: the one that took the render, and the one held behind it.
    expect(node.stats.perLevel).toEqual([
      { deferred: 0, extent: 8, invalidated: 0, moved: 1, rendered: 1 },
      { deferred: 1, extent: 32, invalidated: 0, moved: 1, rendered: 0 },
    ]);
    // The next presented frame spends its single render on the level the first one deferred, and
    // the frame after that has nothing left to do.
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ deferred: 0, rendered: 1 });
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ cached: 2, deferred: 0, rendered: 0 });
    expect(node.stats.perLevel.every((level) => level.rendered === 0)).toBe(true);
    node.dispose();
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
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ movers: 1, moverRenders: 2, rendered: 0, deferred: 0 });
    // A step — and a breathing idle would do the same — is a mover-map render, never a level one.
    mover.position.set(2, 0, 2);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ cached: 2, moverRenders: 2, rendered: 0 });
    // Three frames, two level renders — the second one the frame after the first, because the node
    // renders one level per frame — and six level serves.
    expect(node.stats.reuseRatio).toBeCloseTo(6 / 8);
    expect(node.untrackCaster(mover)).toBe(true);
    expect(hoof.layers.isEnabled(VIRTUAL_SHADOW_MOVER_LAYER)).toBe(false);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({
      cached: 1,
      invalidated: 2,
      moverRenders: 0,
      movers: 0,
      rendered: 1,
      deferred: 1,
    });
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
    settle(node, camera);
    node.tracker.update("manual", {
      min: { x: 0.2, y: 0, z: -0.8 },
      max: { x: 0.8, y: 2, z: -0.2 },
    });
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ invalidated: 2, rendered: 1, deferred: 1 });
    // The level the budget skipped stays due on the next frame: the reason it was due is cleared,
    // and only a sticky flag keeps it in the queue.
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ invalidated: 0, rendered: 1, deferred: 0 });
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
    settle(node, camera);
    node.invalidateAll();
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ invalidated: 2, rendered: 1, deferred: 1 });
    expect(settle(node, camera)).toBe(1);
    expect(node.stats).toMatchObject({ invalidated: 0, rendered: 1, deferred: 0 });
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ invalidated: 0, rendered: 0 });
  });

  it("should print the marker on the first frame and parse it back", () => {
    const { camera, light } = world();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const node = new VirtualShadowNode(light, { clipExtents: [8], marker: 2 });
      node.setup(builder);
      stubLevelRenders(node);
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
      expect(readVirtualShadowMarker(`${VIRTUAL_SHADOW_MARKER}:{bad`)).toBeUndefined();
      expect(readVirtualShadowMarker(`${VIRTUAL_SHADOW_MARKER}:null`)).toBeUndefined();
      expect(readVirtualShadowMarker(`${VIRTUAL_SHADOW_MARKER}:{}`)).toBeUndefined();
      expect(
        readVirtualShadowMarker(
          `${VIRTUAL_SHADOW_MARKER}:${JSON.stringify({
            cached: 0,
            deferred: 0,
            frame: "2",
            invalidated: 0,
            levels: 1,
            moved: 1,
            moverRenders: 1,
            movers: 1,
            rendered: 1,
            reuseRatio: 0,
          })}`,
        ),
      ).toBeUndefined();
      expect(
        readVirtualShadowMarker(
          `${VIRTUAL_SHADOW_MARKER}:${JSON.stringify({
            cached: 0,
            deferred: 0,
            frame: 2,
            invalidated: 0,
            levels: 1,
            moved: 1,
            moverRenders: 1,
            movers: 1,
            rendered: 1,
          })}`,
        ),
      ).toBeUndefined();
      // `deferred` is part of the shape, so a marker from a node that does not report it — an
      // older log read by a newer harness, or one sliced in half — parses as nothing.
      expect(
        readVirtualShadowMarker(
          `${VIRTUAL_SHADOW_MARKER}:${JSON.stringify({
            cached: 0,
            frame: 2,
            invalidated: 0,
            levels: 1,
            moved: 1,
            moverRenders: 1,
            movers: 1,
            rendered: 1,
            reuseRatio: 0,
          })}`,
        ),
      ).toBeUndefined();
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
