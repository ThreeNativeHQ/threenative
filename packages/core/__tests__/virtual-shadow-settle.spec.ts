import {
  BoxGeometry,
  DirectionalLight,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  Scene,
} from "three";
// @ts-expect-error Three's private texture manager has no public declarations.
import Textures from "three/src/renderers/common/Textures.js";
import { float, lights, vec4 } from "three/tsl";
import {
  DepthTexture,
  type Node,
  type NodeBuilder,
  RenderTarget,
  WGSLNodeBuilder,
  WebGPURenderer,
} from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { VirtualShadowNode } from "../src/render/virtual-shadow.js";

/**
 * The wiring half of `shadow-target-settle.spec.ts`: `VirtualShadowNode` registers its level targets
 * through `settleShadowTarget`, not through the bare `updateRenderTarget`. three's own texture manager
 * runs over a counting backend, and the first look at a level's target creates its depth texture first,
 * which is what a material's bind groups did before the registration on the native host.
 */
describe("VirtualShadowNode registering its level targets", () => {
  it("creates each depth texture once and destroys none", () => {
    const events: string[] = [];
    const backend = {
      createTexture: (texture: { isDepthTexture?: boolean }) => {
        if (texture.isDepthTexture === true) events.push("create");
      },
      delete: () => undefined,
      destroyTexture: (texture: { isDepthTexture?: boolean }) => {
        if (texture.isDepthTexture === true) events.push("destroy");
      },
      generateMipmaps: () => undefined,
      get: () => ({}),
      updateSampler: () => undefined,
    };
    const info = {
      createTexture: () => undefined,
      destroyTexture: () => undefined,
      memory: { renderTargets: 0, textures: 0 },
    };
    const textures = new Textures(
      { getRenderTarget: () => null } as never,
      backend as never,
      info as never,
    );
    // The first time anything looks a level's target up, its depth texture is created first: the
    // material's bind groups got there before the registration did.
    const realGet = textures.get.bind(textures);
    const seen = new WeakSet<object>();
    textures.get = ((object: { depthTexture?: object | null; isRenderTarget?: boolean }) => {
      if (object.isRenderTarget === true && object.depthTexture && !seen.has(object)) {
        seen.add(object);
        textures.updateTexture(object.depthTexture as never);
      }
      return realGet(object as never);
    }) as typeof textures.get;

    const light = new DirectionalLight(0xffffff, 1);
    light.position.set(0, 100, 0);
    light.castShadow = true;
    const scene = new Scene();
    scene.add(light, light.target);
    const camera = new PerspectiveCamera(60, 1, 0.1, 500);
    scene.add(camera);
    const node = new VirtualShadowNode(light, {
      clipExtents: [8, 32],
      mapSize: 256,
      marker: false,
    });
    node.setup({
      context: {},
      material: {},
      renderer: { shadowMap: { enabled: true } },
    } as unknown as NodeBuilder);
    light.shadow.shadowNode = node;

    const renderer = new WebGPURenderer({ canvas: new EventTarget() as HTMLCanvasElement });
    renderer.shadowMap.enabled = true;
    vi.spyOn(renderer, "hasFeature").mockReturnValue(false);
    vi.spyOn(renderer, "hasCompatibility").mockReturnValue(true);
    vi.spyOn(
      Reflect.get(renderer.backend, "capabilities"),
      "getUniformBufferLimit",
    ).mockReturnValue(65_536);
    (renderer as unknown as { _textures: unknown })._textures = textures;

    // The stock level nodes create their targets and sample them while a material builds. Neither
    // needs a GPU to be true here: each level gets the target and depth texture the stock setup
    // makes, and its sampling is replaced by a constant, so what is left to build is the node's own
    // graph, which is where the registration lives.
    const stocks = [...node.levelNodes, ...node.moverNodes] as Array<
      Node & { setup: (builder: NodeBuilder) => Node; shadowMap: RenderTarget }
    >;
    for (const stock of stocks) {
      stock.shadowMap = new RenderTarget(256, 256, {
        depthBuffer: true,
        depthTexture: new DepthTexture(256, 256),
      });
      vi.spyOn(stock, "setup").mockImplementation(() => vec4(float(0.6) as never));
    }
    const built: string[] = [];
    try {
      const material = new MeshPhysicalMaterial();
      const mesh = new Mesh(new BoxGeometry(), material);
      mesh.receiveShadow = true;
      const materialBuilder = new WGSLNodeBuilder(mesh, renderer) as unknown as {
        build(): void;
        camera: PerspectiveCamera;
        lightsNode: Node;
        scene: Scene;
      };
      materialBuilder.camera = camera;
      materialBuilder.scene = scene;
      materialBuilder.lightsNode = lights([light]);
      materialBuilder.build();
      built.push(...events);
      material.dispose();
    } finally {
      node.dispose();
    }

    expect(stocks.length).toBeGreaterThan(0);
    expect(built.filter((event) => event === "destroy")).toEqual([]);
    expect(built.filter((event) => event === "create")).toHaveLength(stocks.length);
  });
});
