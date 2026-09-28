import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  FloatType,
  HalfFloatType,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  type OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Sphere,
  SphereGeometry,
  Vector3,
} from "three";
import { float, mix, vec4 } from "three/tsl";
import { type Node, type NodeBuilder, type NodeFrame, WGSLNodeBuilder } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { VIRTUAL_SHADOW_MOVER_LAYER as PUBLIC_VIRTUAL_SHADOW_MOVER_LAYER } from "../src/index.js";
import {
  DISCRETE_LOD_SCHEMA_VERSION,
  DiscreteLodPlugin,
  TN_DISCRETE_LOD,
  lodChainOf,
} from "../src/model-lod.js";
import {
  VIRTUAL_SHADOW_CASTER_LAYER,
  VIRTUAL_SHADOW_MARKER,
  VIRTUAL_SHADOW_MOVER_LAYER,
  VIRTUAL_SHADOW_WIDE_CASTER_LAYER,
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

/**
 * The engine frame clock this harness hands the node, in seconds. It advances a second per frame so
 * that every `invalidationDelay` is behind us from the second frame on — which is the behaviour the
 * node had before the delay existed, and so what the tests written against it mean. A test that is
 * *about* the delay passes its own times instead.
 */
let clock = 0;

function frameFor(camera: PerspectiveCamera, time?: number): NodeFrame {
  // A renderer, because a level only re-renders and only settles its window on a frame that can
  // draw: a frame with none never holds a window, and a node asked twice renders twice.
  clock += 1;
  return { camera, renderer: {}, time: time ?? clock } as unknown as NodeFrame;
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

  it("should print the marker every 60 frames while ?tnShadowStats=1 is on the URL", () => {
    const { camera, light } = world();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubGlobal("location", { search: "?scene=map-walk&tnShadowStats=1" });
    try {
      // The URL switch has to work on a launch that silenced the marker, or walking a world with
      // `marker: false` — which is what the harness passes — could not be measured at all.
      const node = new VirtualShadowNode(light, { clipExtents: [8], marker: false });
      node.setup(builder);
      stubLevelRenders(node);
      for (let frame = 0; frame < 180; frame += 1) node.updateBefore(frameFor(camera));
      const lines = info.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith(VIRTUAL_SHADOW_MARKER));
      // 180 frames at one line per 60 is three, and the last one is the frame itself.
      expect(lines).toHaveLength(3);
      expect(readVirtualShadowMarker(lines[2] ?? "")).toMatchObject({
        byInvalidation: 0,
        byMove: 1,
        coalesced: 0,
        frame: 180,
        held: 0,
        rendersTotal: 1,
      });
    } finally {
      vi.unstubAllGlobals();
      info.mockRestore();
    }
  });
});

/**
 * Invalidation coalescing: a streamed world asks its shadows for a redraw every residency update, and
 * a cell admitted at the ring edge lands in the coarsest window — the one level render that pays for
 * the whole ring's wide casters. So a dirty level waits out an `invalidationDelay` scaled by its own
 * extent before it redraws for an ask, and the cumulative counters say what that cost.
 */
describe("VirtualShadowNode invalidation coalescing", () => {
  /** The cascade the measurement used: delays of 0.25 s, 1 s and 3.33 s. */
  const CASCADE = { clipExtents: [24, 96, 320], mapSize: 64 };

  /**
   * One level render per frame, counted per level, so a test can say *which* level redrew. Call it
   * after the levels have settled: it replaces the draw for every frame from there on.
   */
  function countRenders(node: VirtualShadowNode): number[] {
    const counts = node.levelNodes.map(() => 0);
    node.levelNodes.forEach((levelNode, index) => {
      (levelNode as unknown as { updateShadow(frame: NodeFrame): void }).updateShadow = () => {
        counts[index] = (counts[index] as number) + 1;
      };
    });
    return counts;
  }

  /**
   * Every level settled on a tight clock, one frame each 0.1 s apart, and the clock left at 0.4 s.
   * The harness clock steps a second per frame, which is past every delay; the delay is what these
   * tests are about, so they drive the engine's own `time` themselves.
   */
  function settleOnClock(node: VirtualShadowNode, camera: PerspectiveCamera): number {
    let time = 0;
    for (let frame = 0; frame < node.levelLights.length + 1; frame += 1) {
      time += 0.1;
      node.updateBefore(frameFor(camera, time));
    }
    return time;
  }

  /**
   * A region 250 m out, as `WorldCells` hands one over when a cell is admitted: inside the 640 m
   * window, outside the 192 m one. Whichever way the clipmap's axes fall, it is over 96 m out on
   * both, so only the coarse level is ever asked.
   */
  const RING_EDGE = { min: { x: 246, y: 0, z: -4 }, max: { x: 254, y: 8, z: 4 } };

  it("should turn 30 streamed invalidations of the coarse level in half a second into one render", () => {
    const { camera, light } = world();
    const node = setupNode(light, CASCADE);
    camera.position.set(0, 5, 0);
    let time = settleOnClock(node, camera);
    const renders = countRenders(node);
    const before = { ...node.stats };
    // A cell streaming in once a frame, half a second's worth.
    for (let ask = 0; ask < 30; ask += 1) {
      time += 1 / 60;
      node.invalidateRegion(RING_EDGE);
      node.updateBefore(frameFor(camera, time));
      expect(node.stats).toMatchObject({ held: 1, invalidated: 1, rendered: 0 });
    }
    expect(renders[2]).toBe(0);
    // Its own 3.33 s are what the level waits out, from its last render — so the first frame past
    // that redraws once, for all thirty asks.
    for (let step = 0; step < 40 && renders[2] === 0; step += 1) {
      time += 0.1;
      node.updateBefore(frameFor(camera, time));
    }
    expect(renders).toEqual([0, 0, 1]);
    expect(node.stats.rendersTotal - before.rendersTotal).toBe(1);
    expect(node.stats.byInvalidation - before.byInvalidation).toBe(1);
    // Twenty-nine asks merged into the one already waiting; the thirtieth is the render.
    expect(node.stats.coalesced - before.coalesced).toBe(29);
    expect(node.stats.byMove - before.byMove).toBe(0);
  });

  it("should still render the finest level within a quarter second of an invalidation", () => {
    const { camera, light } = world();
    const node = setupNode(light, CASCADE);
    camera.position.set(0, 5, 0);
    let time = settleOnClock(node, camera);
    const renders = countRenders(node);
    // The finest level rendered at 0.1 s, so its delay runs out at 0.35 s and the first frame at or
    // after that is its render. The coarse two are 1.2 s and 3.63 s away from their own.
    const asked = time;
    let finestAt: number | undefined;
    for (let step = 0; step < 20; step += 1) {
      time += 0.05;
      node.invalidateAll();
      node.updateBefore(frameFor(camera, time));
      if (finestAt === undefined && (renders[0] as number) > 0) finestAt = time;
    }
    expect(finestAt).toBeDefined();
    expect((finestAt as number) - asked).toBeLessThan(0.3);
    // It keeps answering rather than answering once, and the level the measurement is about — the
    // 3.33 s one, a whole second past the end of this run — has not rendered at all.
    expect(renders[0]).toBeGreaterThan(1);
    expect(renders[2]).toBe(0);
  });

  it("should not delay a render whose window moved", () => {
    const { camera, light } = world();
    const node = setupNode(light, { clipExtents: [8, 32], mapSize: 64, refreshStep: 0 });
    camera.position.set(0, 5, 0);
    settle(node, camera);
    const renders = countRenders(node);
    const before = { ...node.stats };
    // 0.3 crosses the finest texel (0.25) but not the coarse one (1.0): no invalidation anywhere.
    camera.position.set(0.3, 5, 0);
    node.updateBefore(frameFor(camera));
    expect(node.stats).toMatchObject({ moved: 1, rendered: 1 });
    expect(renders).toEqual([1, 0]);
    expect(node.stats.rendersTotal - before.rendersTotal).toBe(1);
    expect(node.stats.byMove - before.byMove).toBe(1);
    // An ask arriving on the frame a window moves is answered by that render rather than queued
    // behind the level's delay: the map it draws is already the new window's.
    node.invalidateAll();
    camera.position.set(0.6, 5, 0);
    node.updateBefore(frameFor(camera));
    expect(renders).toEqual([2, 0]);
    expect(node.stats.byMove - before.byMove).toBe(2);
    expect(node.stats.coalesced - before.coalesced).toBe(1);
    // And the ask is spent, so the level does not redraw a frame later for the same casters.
    node.updateBefore(frameFor(camera));
    expect(renders).toEqual([2, 1]);
    expect(node.stats.rendersTotal - before.rendersTotal).toBe(3);
    expect(node.stats.byInvalidation - before.byInvalidation).toBe(1);
  });

  it("should reproduce today's counts with invalidationDelay 0 and hold the level without it", () => {
    const { camera, light } = world();
    camera.position.set(0, 5, 0);
    // The same cascade twice, one switch off. Both nodes are on the same light: each owns its own
    // levels, so what the two of them do is comparable frame for frame.
    const off = setupNode(light, { clipExtents: [8, 32], mapSize: 64, invalidationDelay: 0 });
    const on = setupNode(light, { clipExtents: [8, 32], mapSize: 64 });
    expect(on.options.invalidationDelay).toEqual([0.25, 1]);
    expect(off.options.invalidationDelay).toEqual([0, 0]);
    for (const node of [off, on]) {
      for (let frame = 1; frame <= 4; frame += 1) node.updateBefore(frameFor(camera, frame * 0.1));
    }
    const offRenders = countRenders(off);
    const onRenders = countRenders(on);
    const offBefore = { ...off.stats };
    const onBefore = { ...on.stats };
    for (const node of [off, on]) node.invalidateAll();
    off.updateBefore(frameFor(camera, 0.5));
    on.updateBefore(frameFor(camera, 0.5));
    // The same asks and the same per-frame counters; the difference is entirely the coarse level's
    // 1 s delay, which holds it rather than deferring it behind the frame's budget.
    expect(off.stats).toMatchObject({ invalidated: 2, rendered: 1, deferred: 1, held: 0 });
    expect(on.stats).toMatchObject({ invalidated: 2, rendered: 1, deferred: 0, held: 1 });
    off.updateBefore(frameFor(camera, 0.6));
    on.updateBefore(frameFor(camera, 0.6));
    expect(offRenders).toEqual([1, 1]);
    expect(onRenders).toEqual([1, 0]);
    expect(off.stats.rendersTotal - offBefore.rendersTotal).toBe(2);
    expect(on.stats.rendersTotal - onBefore.rendersTotal).toBe(1);
  });

  it("should add up: every render is a move or an invalidation, every ask is answered or merged", () => {
    const { camera, light } = world();
    const node = setupNode(light, CASCADE);
    camera.position.set(0, 5, 0);
    let time = settleOnClock(node, camera);
    // A walk with a streaming world behind it: the windows keep moving and the levels keep being
    // asked, so both reasons and both halves of the invalidation accounting are exercised.
    let asks = 0;
    for (let step = 0; step < 200; step += 1) {
      time += 0.05;
      camera.position.set(step * 0.4, 5, 0);
      if (step % 3 === 0) node.invalidateAll();
      node.updateBefore(frameFor(camera, time));
      asks += node.stats.perLevel.filter((level) => level.invalidated === 1).length;
    }
    // Every ask has to be accounted for, so the run has to end with nothing still waiting: a level
    // still dirty at the end is an ask that has not been answered or merged yet, and the identity
    // below is only about asks that have been.
    for (let step = 0; step < 30; step += 1) {
      time += 0.5;
      node.updateBefore(frameFor(camera, time));
    }
    const { byInvalidation, byMove, coalesced, rendersTotal } = node.stats;
    expect(rendersTotal).toBe(byMove + byInvalidation);
    expect(byInvalidation + coalesced).toBe(asks);
    // Both halves really happened, or the identity above would pass on a node that did nothing.
    expect(byMove).toBeGreaterThan(0);
    expect(byInvalidation).toBeGreaterThan(0);
    expect(coalesced).toBeGreaterThan(0);
  });
});

/**
 * The two automatic fixes a level render makes for itself: a light-space depth derived from what can
 * actually shadow the window, and a caster size gate in texels of that level. Neither takes a game
 * value, so the world under them is the only thing that decides.
 */
describe("VirtualShadowNode derived depth and caster size gate", () => {
  /** A sun 38 degrees up, over the +z horizon: shadows fall to -z. */
  const SUN = new Vector3(0, 0.6157, 0.788);

  interface ITestWorld {
    readonly camera: PerspectiveCamera;
    readonly casters: readonly Mesh[];
    readonly light: DirectionalLight;
    readonly scene: Scene;
    readonly mass: Mesh;
    readonly small: Mesh;
    readonly tall: Mesh;
    /** A tower just beyond the window's up-sun edge, whose shadow lands back inside it. */
    readonly upSun: Mesh;
  }

  /** The bounding-sphere radius of the `4 x 4 x n` boxes standing on the ground. */
  const TOWER_RADIUS = Math.hypot(2, 2, 2);
  const TALL_RADIUS = Math.hypot(2, 10, 2);

  /**
   * A floor of casting tiles, one 500 m floor slab under it, a 4 m caster, a 20 m tower and a
   * second tower beyond the window's up-sun edge. Every caster is inside the finest window's u/v
   * box, so the span the level must cover is the union of their own extents and nothing else.
   */
  function shadowWorld(): ITestWorld {
    const { camera, light, scene } = world();
    camera.position.set(0, 10, 0);
    light.position.copy(SUN).multiplyScalar(200);
    light.target.position.set(0, 0, 0);
    light.target.updateMatrixWorld(true);
    light.updateMatrixWorld(true);
    const solid = new MeshStandardMaterial();
    // One slab the whole world could be: it is how a terrain tile that dwarfs the window reaches
    // the level, and its own span along the light is 500 m of depth nobody asked for.
    const mass = new Mesh(new BoxGeometry(500, 2, 500), solid);
    mass.position.set(0, -1, 0);
    mass.castShadow = true;
    scene.add(mass);
    const tiles: Mesh[] = [];
    for (let x = -1; x <= 1; x += 1) {
      for (let z = -1; z <= 1; z += 1) {
        const tile = new Mesh(new BoxGeometry(8, 2, 8), solid);
        tile.position.set(x * 8, -1, z * 8);
        tile.castShadow = true;
        scene.add(tile);
        tiles.push(tile);
      }
    }
    const small = new Mesh(new BoxGeometry(4, 4, 4), solid);
    small.position.set(-10, 2, 0);
    small.castShadow = true;
    scene.add(small);
    const tall = new Mesh(new BoxGeometry(4, 20, 4), solid);
    tall.position.set(10, 10, 0);
    tall.castShadow = true;
    scene.add(tall);
    const upSun = new Mesh(new BoxGeometry(4, 20, 4), solid);
    upSun.position.set(0, 10, 24 * Math.SQRT2);
    upSun.castShadow = true;
    scene.add(upSun);
    scene.updateMatrixWorld(true);
    return {
      camera,
      casters: [mass, ...tiles, small, tall, upSun],
      light,
      scene,
      mass,
      small,
      tall,
      upSun,
    };
  }

  /** The level's own placeholder light, which is where its shadow camera is placed and aimed. */
  function levelLight(node: VirtualShadowNode, level: number): Object3D {
    const light = node.levelLights[level];
    if (light === undefined) throw new Error(`no level ${String(level)}`);
    return light;
  }

  function levelCamera(node: VirtualShadowNode, level: number): OrthographicCamera {
    return (levelLight(node, level) as unknown as { shadow: DirectionalLight["shadow"] }).shadow
      .camera;
  }

  /**
   * Whether a level's frustum holds a world point, through its own projection and the view the
   * renderer builds for a directional shadow camera: its light's position, aimed at its target.
   * That aiming is the renderer's to do, and this harness has no renderer.
   */
  function holds(node: VirtualShadowNode, level: number, point: Vector3): boolean {
    const light = levelLight(node, level) as unknown as DirectionalLight;
    _aim.position.copy(light.position);
    _aim.up.set(0, 1, 0);
    _aim.lookAt(light.target.position);
    _aim.updateMatrixWorld(true);
    const p = _projected
      .copy(point)
      .applyMatrix4(_view.copy(_aim.matrixWorld).invert())
      .applyMatrix4(levelCamera(node, level).projectionMatrix);
    return Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z >= -1 && p.z <= 1;
  }
  const _aim = new PerspectiveCamera();
  const _view = new Matrix4();
  const _projected = new Vector3();

  /** One level render per frame, recording which of the world's casters were visible for each. */
  function watchCasters(node: VirtualShadowNode, small: Mesh, tall: Mesh): string[] {
    const seen: string[] = [];
    stubLevelRenders(node);
    node.levelNodes.forEach((levelNode, index) => {
      (levelNode as unknown as { updateShadow(frame: NodeFrame): void }).updateShadow = () => {
        seen.push(`${String(index)}:${small.visible ? "s" : "-"}${tall.visible ? "t" : "-"}`);
      };
    });
    return seen;
  }

  it("should bracket every caster that can reach the window, and no more of the column", () => {
    const { camera, casters, light, mass, tall } = shadowWorld();
    const node = setupNode(light, { clipExtents: [24, 96, 320], mapSize: 64 });
    settle(node, camera);
    // The span the level must cover, derived here from the world's own numbers: the 500 m slab the
    // window is cut out of, which is only its 2 m of height, and every other caster's own extent.
    const centre = (node.levelLights[0] as unknown as { target: { position: Vector3 } }).target
      .position;
    const side = 24 * Math.SQRT2;
    const along = (point: Vector3): number => point.clone().sub(centre).dot(SUN);
    const spans = casters
      .filter((mesh) => mesh !== mass)
      .map((mesh) => {
        const radius = (mesh.geometry.boundingSphere as Sphere).radius;
        return [along(mesh.position) - radius, along(mesh.position) + radius] as const;
      });
    const low = Math.min(
      (mass.position.y - 1 - centre.y) * 0.6157 - side * 0.788,
      ...spans.map(([from]) => from),
    );
    const high = Math.max(
      (mass.position.y + 1 - centre.y) * 0.6157 + side * 0.788,
      ...spans.map(([, to]) => to),
    );
    expect(levelCamera(node, 0).far - levelCamera(node, 0).near).toBeCloseTo(high - low, 1);
    // Everything that can shadow the window is inside it: the ground the window is cut out of, the
    // tower standing in it, and the tower whose shadow lands in it from beyond the up-sun edge.
    expect(holds(node, 0, new Vector3(0, 0, 0))).toBe(true);
    expect(holds(node, 0, new Vector3(10, 10 + TALL_RADIUS, 0))).toBe(true);
    expect(holds(node, 0, new Vector3(0, 10 + TALL_RADIUS, side))).toBe(true);
    // And the column stops where the last caster that could reach it does: 20 m of ground below the
    // window's own, which the fixed 400 m range covered and nothing ever casts into.
    expect(holds(node, 0, new Vector3(0, -20, -25.6))).toBe(false);
    node.dispose();
  });

  it("should widen a level's depth for a caster standing beyond its up-sun edge", () => {
    const { camera, light, upSun } = shadowWorld();
    const node = setupNode(light, { clipExtents: [24, 96, 320], mapSize: 64 });
    settle(node, camera);
    const withTower = levelCamera(node, 0).far - levelCamera(node, 0).near;
    // The same window with the tower just outside its up-sun edge taken away: its shadow lands
    // inside the window, so the depth that covers the ground alone would drop it.
    upSun.removeFromParent();
    node.invalidateAll();
    settle(node, camera);
    const withoutTower = levelCamera(node, 0).far - levelCamera(node, 0).near;
    expect(withTower).toBeGreaterThan(withoutTower);
    expect(holds(node, 0, new Vector3(0, 10 + TALL_RADIUS, 24 * Math.SQRT2))).toBe(false);
    node.dispose();
  });

  it("should drop a sub-texel caster from a coarse level and keep it in the fine one", () => {
    const { camera, light, small, tall } = shadowWorld();
    const node = setupNode(light, { clipExtents: [24, 96, 320], mapSize: 64 });
    const seen = watchCasters(node, small, tall);
    settle(node, camera);
    // Finest first, one render each: the 4 m caster is 6.9 m across, which is more than 1.5 texels
    // of the 48 m window and less than 1.5 of the 640 m one. The 20 m tower is in every level.
    expect(seen).toEqual(["0:st", "1:st", "2:-t"]);
    // Hidden for the level render, put back for the next camera.
    expect(small.visible && tall.visible).toBe(true);
    node.dispose();
  });

  it("should gate a world cluster on its part's radius, not the grid square it spans (PRD-458)", () => {
    const { camera, light, scene } = shadowWorld();
    const node = setupNode(light, { clipExtents: [24, 96, 320], mapSize: 64 });
    // What a `WorldCells` cluster is: one `InstancedMesh` covering a whole grid square, so its own
    // sphere is 24 m of square. A fern inside it is 0.3 m, and the published scale says so.
    const fern = new InstancedMesh(new SphereGeometry(0.15, 6, 4), new MeshStandardMaterial(), 64);
    fern.boundingSphere = new Sphere(new Vector3(0, 1, 0), 24);
    fern.boundingBox = new Box3(new Vector3(-12, 0, -12), new Vector3(12, 2, 12));
    fern.castShadow = true;
    // A 0.15 m part placed at scale 10: 3 m of ground cover under a 48 m grid square.
    (fern as InstancedMesh & { casterInstanceScale?: number }).casterInstanceScale = 10;
    fern.position.set(-6, 0, 0);
    scene.add(fern);
    scene.updateMatrixWorld(true);

    const seen: string[] = [];
    stubLevelRenders(node);
    node.levelNodes.forEach((levelNode, index) => {
      (levelNode as unknown as { updateShadow(frame: NodeFrame): void }).updateShadow = () => {
        seen.push(`${String(index)}:${fern.visible ? "f" : "-"}`);
      };
    });
    settle(node, camera);
    // 3 m across is over 1.5 texels of the 48 m window and under 1.5 of the 192 m and 640 m ones, so
    // it leaves the two coarse levels and stays in the fine one. Gated on its cluster's 48 m sphere
    // it was kept by all three and submitted a fern draw to two levels that could not resolve a
    // fragment of it — the whole gate, dropping nothing at all.
    expect(seen).toEqual(["0:f", "1:-", "2:-"]);
    expect(fern.visible).toBe(true);
    node.dispose();
  });

  it("should take each level's cheaper caster granularity, not a fraction of the ring (PRD-458)", () => {
    const { camera, light, scene } = shadowWorld();
    const node = setupNode(light, { clipExtents: [24, 96, 320], mapSize: 2048 });
    const solid = new MeshStandardMaterial();
    // One world holding both halves of three keys, as `WorldCells` writes them: 25 cluster squares
    // of 128 m under the player, and two keys outside the ring, each with two squares and one
    // key-wide mesh covering its own. A cluster stands in for a square, so its sphere is the
    // square's centre — the same centre the level's window is measured from.
    const squares: { x: number; z: number }[] = [];
    const cluster = (x: number, z: number): void => {
      const mesh = new Mesh(new BoxGeometry(8, 8, 8), solid);
      mesh.position.set(x, 4, z);
      mesh.castShadow = true;
      mesh.layers.set(VIRTUAL_SHADOW_CASTER_LAYER);
      scene.add(mesh);
      squares.push({ x, z });
    };
    let wides = 0;
    const wide = (x: number, z: number): void => {
      const mesh = new Mesh(new BoxGeometry(200, 8, 200), solid);
      mesh.position.set(x, 4, z);
      mesh.castShadow = true;
      mesh.layers.set(VIRTUAL_SHADOW_WIDE_CASTER_LAYER);
      scene.add(mesh);
      wides += 1;
    };
    for (let x = -2; x <= 2; x += 1) for (let z = -2; z <= 2; z += 1) cluster(x * 128, z * 128);
    for (const at of [768, -768]) {
      cluster(at, 0);
      cluster(at, 128);
      wide(at, 64);
    }
    scene.updateMatrixWorld(true);
    settle(node, camera);

    // What each level would submit either way: the cluster squares its window covers, against the
    // key-wide meshes waiting for it. A square inside the window is within a half-diagonal of the
    // centre whichever way the light is turned, so `extent * sqrt(2)` is the bound that holds.
    for (const [level, extent] of [24, 96, 320].entries()) {
      const inWindow = squares.filter(
        (square) => Math.hypot(square.x, square.z) <= extent * Math.SQRT2,
      ).length;
      const cheaper =
        inWindow < wides ? VIRTUAL_SHADOW_CASTER_LAYER : VIRTUAL_SHADOW_WIDE_CASTER_LAYER;
      const mask = levelCamera(node, level).layers.mask;
      const both = (1 << VIRTUAL_SHADOW_CASTER_LAYER) | (1 << VIRTUAL_SHADOW_WIDE_CASTER_LAYER);
      // The 48 m window: 1 square against 3 key-wide meshes, so clusters. The 192 m: 5 against 3,
      // and the 640 m: 25 against 3, so one mesh per key. The fraction-of-the-ring rule read all
      // three as 36% of a 768 m ring and clustered even the coarsest, at 29 draws where 3 do.
      expect(mask & both, `level ${String(level)} took the wrong granularity`).toBe(1 << cheaper);
    }
    node.dispose();
  });

  it("should keep every level's depth off a fixed range when the game pins one", () => {
    const { camera, light } = shadowWorld();
    const node = setupNode(light, {
      clipExtents: [24, 96, 320],
      lightDistance: 200,
      depthRange: 400,
    });
    settle(node, camera);
    for (const level of [0, 1, 2]) {
      const cameraForLevel = levelCamera(node, level);
      expect(cameraForLevel.near).toBe(1);
      expect(cameraForLevel.far).toBe(600);
    }
    node.dispose();
  });
});

describe("VirtualShadowNode shadow LOD bias and alpha-caster range", () => {
  interface IDraw {
    /** The level index whose render submitted this draw. */
    readonly level: number;
    readonly material: Material;
    readonly object: Mesh;
    /**
     * What three would actually draw: the cached render object is keyed on the object and re-reads
     * `object.geometry` itself, so the geometry argument is not what reaches the GPU.
     */
    readonly submitted: BufferGeometry;
  }

  type DrawGate = (
    object: Object3D,
    scene: Object3D,
    camera: unknown,
    geometry: BufferGeometry,
    material: Material,
  ) => void;

  /**
   * A renderer carrying three's own per-draw seam and nothing else, plus a shadow pass that does
   * what `updateShadow` does: install the draw gate, submit the casters, put back what it found.
   */
  function drawHost(
    camera: PerspectiveCamera,
    casters: readonly Mesh[],
  ): {
    readonly draws: IDraw[];
    readonly host: object;
  } {
    const draws: IDraw[] = [];
    let current: DrawGate | null = null;
    return {
      draws,
      host: {
        getRenderObjectFunction: () => current,
        setRenderObjectFunction: (fn: DrawGate | null) => {
          current = fn;
        },
      },
    };
  }

  /** Wire each level node to the host, recording the geometry every draw would submit. */
  function watchDraws(
    node: VirtualShadowNode,
    host: object,
    camera: PerspectiveCamera,
    casters: readonly Mesh[],
    draws: IDraw[],
  ): void {
    const levels = [...node.levelNodes];
    for (const levelNode of levels) {
      (levelNode as unknown as { updateShadow(frame: NodeFrame): void }).updateShadow = (frame) => {
        const seam = frame.renderer as unknown as {
          getRenderObjectFunction(): DrawGate | null;
          setRenderObjectFunction(fn: DrawGate | null): void;
        };
        const gate: DrawGate = (object, _scene, _camera, _geometry, material) => {
          draws.push({
            level: levels.indexOf(levelNode),
            material,
            object: object as Mesh,
            submitted: (object as Mesh).geometry,
          });
        };
        const found = seam.getRenderObjectFunction();
        seam.setRenderObjectFunction(gate);
        // Three draws through the gate the renderer now holds, not the one it was handed, so this
        // is what proves the node's own wrapper is the thing in the way.
        const installed = seam.getRenderObjectFunction();
        if (installed === null) throw new Error("the shadow pass installed no draw gate.");
        for (const mesh of casters)
          installed(
            mesh,
            camera as unknown as Object3D,
            null,
            mesh.geometry,
            mesh.material as Material,
          );
        seam.setRenderObjectFunction(found);
      };
    }
  }

  /** A frame with the draw seam on it, which is the only frame a level renders on. */
  function drawFrame(camera: PerspectiveCamera, host: object): NodeFrame {
    return { camera, renderer: host, time: 0 } as unknown as NodeFrame;
  }

  /**
   * A grid over its own baked three-level chain, registered by the real plugin: the parser is the
   * only fake part, exactly as the chunk-merge fixture builds one.
   */
  async function chained(triangles = 8): Promise<Mesh> {
    const positions: number[] = [];
    for (let vertex = 0; vertex < triangles + 1; vertex += 1)
      positions.push(vertex / triangles, 0, 0, vertex / triangles, 1, 0);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(Float32Array.from(positions), 3));
    const indices = (count: number): Uint32Array => {
      const at = new Uint32Array(count * 3);
      for (let quad = 0; quad < count / 2; quad += 1) {
        const offset = quad * 6;
        at[offset] = quad * 2;
        at[offset + 1] = quad * 2 + 1;
        at[offset + 2] = quad * 2 + 2;
        at[offset + 3] = quad * 2 + 1;
        at[offset + 4] = quad * 2 + 3;
        at[offset + 5] = quad * 2 + 2;
      }
      return at;
    };
    geometry.setIndex(new BufferAttribute(indices(triangles), 1));
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const plugin = new DiscreteLodPlugin();
    plugin.setParser({
      associations: new Map<object, { meshes: number; primitives: number }>([
        [mesh, { meshes: 0, primitives: 0 }],
      ]),
      getDependency: async (_type: string, index: number) => ({
        array: index === 0 ? indices(triangles / 2) : indices(triangles / 4),
      }),
      json: {
        meshes: [
          {
            primitives: [
              {
                extensions: {
                  [TN_DISCRETE_LOD]: {
                    absoluteErrors: [0.05, 0.2],
                    counts: [triangles / 2, triangles / 4],
                    errors: [0.05, 0.2],
                    indices: [0, 1],
                    lod0Triangles: triangles,
                    schemaVersion: DISCRETE_LOD_SCHEMA_VERSION,
                  },
                },
              },
            ],
          },
        ],
      },
    });
    await plugin.afterRoot({});
    plugin.attach(mesh, { hysteresis: 0.15, maxPixelError: 1 });
    return mesh;
  }

  /** Three levels, one render each: the finest first, so level `n` is drawn on frame `n`. */
  function renderAllLevels(node: VirtualShadowNode, camera: PerspectiveCamera, host: object): void {
    for (let frame = 0; frame < node.levelNodes.length; frame += 1)
      node.updateBefore(drawFrame(camera, host));
  }

  it("should draw a chained caster with its coarsest chain geometry on the coarse levels only", async () => {
    const { camera, light, scene } = world();
    const mesh = await chained();
    mesh.castShadow = true;
    scene.add(mesh);
    const chain = lodChainOf(mesh.geometry);
    if (chain === undefined) throw new Error("the plugin registered no chain.");
    const coarsest = chain.levels[chain.levels.length - 1] as BufferGeometry;
    expect(chain.levels).toHaveLength(3);
    const node = setupNode(light, { clipExtents: [24, 96, 320] });
    const { draws, host } = drawHost(camera, [mesh]);
    watchDraws(node, host, camera, [mesh], draws);
    renderAllLevels(node, camera, host);

    // Level 0 draws what the main pass draws; 96 m and 320 m windows cannot resolve LOD0, so they
    // draw the coarsest rung — the 2-triangle level, one draw over the mesh's own.
    expect(draws.map((draw) => draw.level)).toEqual([0, 1, 2]);
    expect(draws.map((draw) => draw.submitted)).toEqual([mesh.geometry, coarsest, coarsest]);
    // The mesh was never left on the coarse geometry: the swap lives inside one draw.
    expect(mesh.geometry).toBe(chain.levels[0]);
    node.dispose();
  });

  it("should put every level back on full detail with shadowLodBias off", async () => {
    const { camera, light, scene } = world();
    const mesh = await chained();
    mesh.castShadow = true;
    scene.add(mesh);
    const node = setupNode(light, { clipExtents: [24, 96, 320], shadowLodBias: false });
    const { draws, host } = drawHost(camera, [mesh]);
    watchDraws(node, host, camera, [mesh], draws);
    renderAllLevels(node, camera, host);

    expect(draws.map((draw) => draw.submitted)).toEqual([
      mesh.geometry,
      mesh.geometry,
      mesh.geometry,
    ]);
    node.dispose();
  });

  it("should cast an alpha-tested mesh into the finest level only, and every level an opaque one", () => {
    const { camera, light, scene } = world();
    // The two shapes `buildChunkShadowProxies` leaves behind: a cutout that keeps casting itself,
    // and the position-only proxy that stands in for a chunk's opaque half.
    const cutout = new Mesh(new BoxGeometry(4, 4, 4), new MeshBasicMaterial({ alphaTest: 0.5 }));
    cutout.position.set(-8, 2, 0);
    cutout.castShadow = true;
    const proxy = new Mesh(new BoxGeometry(64, 2, 64), new MeshBasicMaterial());
    proxy.position.set(0, -1, 0);
    proxy.castShadow = true;
    scene.add(cutout, proxy);
    const node = setupNode(light, { clipExtents: [24, 96, 320] });
    const { draws, host } = drawHost(camera, [cutout, proxy]);
    watchDraws(node, host, camera, [cutout, proxy], draws);
    renderAllLevels(node, camera, host);

    // The trade, stated once: a fence's or a foliage card's shadow ends where the finest level's
    // window ends, like Unreal's per-primitive shadow cull distance. The opaque proxy is drawn by
    // every level, so a chunk's own shadow does not end with it.
    const levelsFor = (object: Mesh): number[] =>
      draws.filter((draw) => draw.object === object).map((draw) => draw.level);
    expect(levelsFor(cutout)).toEqual([0]);
    expect(levelsFor(proxy)).toEqual([0, 1, 2]);
    node.dispose();
  });
});
