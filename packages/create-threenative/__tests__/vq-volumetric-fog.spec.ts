import {
  Box3,
  BoxGeometry,
  Color,
  DepthTexture,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PointLight,
  RenderTarget,
  Scene,
  Vector3,
} from "three";
import { pass } from "three/tsl";
import { type Node, WGSLNodeBuilder } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import {
  type IVolumetricFogOptions,
  createVolumetricFog,
} from "../templates/starter/src/render/volumetricFog.js";

function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("Missing fixture value");
  return value;
}
function settings(): IVolumetricFogOptions {
  return {
    enabled: true,
    renderer: "webgpu",
    steps: 32,
    resolutionScale: 1,
    volumes: [
      {
        bounds: new Box3(new Vector3(-2, -1, -8), new Vector3(2, 3, -2)),
        density: 0.2,
        baseHeight: 0,
        heightFalloff: 0,
      },
    ],
    albedo: new Color(0.8, 0.8, 0.8),
    ambient: new Color(0.1, 0.1, 0.1),
    anisotropy: 0,
    environment: { aerialPerspective: false, godRays: false, sceneFog: false },
  };
}

describe("opt-in generated volumetric fog", () => {
  it.each(["disabled", "unsupported", "zero", "empty"])(
    "%s returns no controller before graph allocation",
    (reason) => {
      const options = settings();
      if (reason === "disabled") options.enabled = false;
      if (reason === "unsupported") options.renderer = "webgl2";
      if (reason === "zero") required(options.volumes[0]).density = 0;
      if (reason === "empty") options.volumes = [];
      expect(createVolumetricFog(new PerspectiveCamera(), options)).toBeUndefined();
    },
  );
  it.each([0, -1, 8.5, 129, Number.NaN])("rejects invalid steps %s", (steps) => {
    expect(() => createVolumetricFog(new PerspectiveCamera(), { ...settings(), steps })).toThrow(
      /steps/,
    );
  });
  it.each([0, 0.25, 2, Number.NaN])("rejects unsupported resolution %s", (resolutionScale) => {
    expect(() =>
      createVolumetricFog(new PerspectiveCamera(), { ...settings(), resolutionScale }),
    ).toThrow(/resolutionScale/);
  });
  it("refuses unqualified camera and depth encodings", () => {
    expect(() =>
      createVolumetricFog(new OrthographicCamera() as unknown as PerspectiveCamera, settings()),
    ).toThrow(/perspective/);
    expect(() =>
      createVolumetricFog(new PerspectiveCamera(), { ...settings(), logarithmicDepth: true }),
    ).toThrow(/depth/);
    expect(() =>
      createVolumetricFog(new PerspectiveCamera(), { ...settings(), reversedDepth: true }),
    ).toThrow(/depth/);
  });
  it("rejects double-counted atmosphere or shafts before allocation", () => {
    for (const name of ["aerialPerspective", "godRays", "sceneFog"] as const) {
      const options = settings();
      options.environment[name] = true;
      expect(() => createVolumetricFog(new PerspectiveCamera(), options)).toThrow(/same medium/);
    }
  });
  it("rejects invalid density, bounds, albedo and phase", () => {
    const options = settings();
    required(options.volumes[0]).density = -1;
    expect(() => createVolumetricFog(new PerspectiveCamera(), options)).toThrow(/density/);
    required(options.volumes[0]).density = 0.2;
    required(options.volumes[0]).bounds.makeEmpty();
    expect(() => createVolumetricFog(new PerspectiveCamera(), options)).toThrow(/bounds/);
    expect(() =>
      createVolumetricFog(new PerspectiveCamera(), { ...settings(), anisotropy: 1 }),
    ).toThrow(/anisotropy/);
    expect(() =>
      createVolumetricFog(new PerspectiveCamera(), { ...settings(), albedo: new Color(2, 0, 0) }),
    ).toThrow(/albedo/);
  });
  it("refuses missing directional maps and unsupported local-light shadows", () => {
    const sun = new DirectionalLight();
    sun.castShadow = true;
    expect(() => createVolumetricFog(new PerspectiveCamera(), { ...settings(), sun })).toThrow(
      /shadow map/,
    );
    const point = new PointLight();
    expect(() =>
      createVolumetricFog(new PerspectiveCamera(), { ...settings(), points: [point] }),
    ).toThrow(/finite-range/);
    point.distance = 5;
    point.castShadow = true;
    expect(() =>
      createVolumetricFog(new PerspectiveCamera(), { ...settings(), points: [point] }),
    ).toThrow(/unshadowed/);
  });
  it("owns no history and disposes its own target and material exactly once", () => {
    const camera = new PerspectiveCamera();
    const fog = required(createVolumetricFog(camera, settings()));
    const scenePass = pass(new Scene(), camera);
    expect(fog.compose(scenePass)).toBeDefined();
    expect(fog.diagnostics()).toMatchObject({
      steps: 32,
      resolutionScale: 1,
      history: false,
      volumes: 1,
      localLights: 0,
    });
    const targetDispose = vi.spyOn(required(fog.target), "dispose");
    const materialDispose = vi.spyOn(required(fog.material), "dispose");
    const depthDispose = vi.spyOn(required(scenePass.renderTarget.depthTexture), "dispose");
    fog.dispose();
    fog.dispose();
    expect(targetDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(depthDispose).not.toHaveBeenCalled();
    expect(() => fog.compose(scenePass)).toThrow(/disposed/);
    scenePass.dispose();
  });
});

it.each([false, true])("builds the actual depth-clipped transport WGSL (lights=%s)", (lights) => {
  const camera = new PerspectiveCamera();
  const options = settings();
  if (lights) {
    const sun = new DirectionalLight();
    sun.castShadow = true;
    sun.shadow.map = new RenderTarget(32, 32);
    sun.shadow.map.depthTexture = new DepthTexture(32, 32);
    options.sun = sun;
    options.points = [new PointLight(0xffffff, 1, 4)];
  }
  const fog = required(createVolumetricFog(camera, options));
  const scenePass = pass(new Scene(), camera);
  fog.compose(scenePass);
  const object = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  const renderer = {
    backend: {
      isWebGPUBackend: true,
      capabilities: { getUniformBufferLimit: () => 65_536 },
      utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
    },
    coordinateSystem: 2001,
    hasCompatibility: () => true,
    hasFeature: () => false,
    getRenderTarget: () => null,
    getOutputBufferType: () => 1016,
    samples: 0,
    getMRT: () => null,
    library: { fromMaterial: () => null },
    shadowMap: { enabled: true, type: 1 },
  };
  const builder = new WGSLNodeBuilder(object, renderer as never) as unknown as {
    camera: PerspectiveCamera;
    setShaderStage(stage: string): void;
    flowStagesNode(node: Node, output: string): { code: string };
  };
  builder.camera = camera;
  builder.setShaderStage("fragment");
  const flow = builder.flowStagesNode(required(fog.transport), "vec4");
  expect(flow.code).toContain("exp(");
  expect(flow.code).toContain("for (");
  expect(flow.code).toContain("32");
  if (lights) {
    expect(flow.code).toContain("textureSampleCompare");
    const sampled = /([A-Za-z_][A-Za-z_0-9]*) = textureSampleCompare/.exec(flow.code)?.[1];
    const visibility = new RegExp(`([A-Za-z_][A-Za-z_0-9]*) = ${sampled};`).exec(flow.code)?.[1];
    expect(visibility).toBeDefined();
    // Match the actual generated shader default, not a second JavaScript implementation.
    // Outside ordinary shadow coverage the directional source stays unshadowed, like Three.
    expect(flow.code).toContain(`${visibility} = 1.0;`);
  }
  fog.dispose();
  scenePass.dispose();
  options.sun?.shadow.map?.dispose();
});
