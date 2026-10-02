import {
  type Color,
  DepthTexture,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  PointLight,
  RenderTarget,
  Scene,
} from "three";
import { describe, expect, it } from "vitest";
import { FogProbe } from "../../../examples/abyss-framework/vq-fog/src/game.js";
import { Registry } from "../../core/src/entities.js";
import { createGameStore } from "../../core/src/state.js";

type Ctx = Parameters<FogProbe["enter"]>[0];
function fixture() {
  const probe = new FogProbe();
  const scene = new Scene();
  const state = createGameStore({ ...FogProbe.initialState });
  let action = "";
  // No GPU is available in a unit test. Use real scene/state/TSL ownership objects;
  // only the input edge and renderer installation boundary are replaced.
  const ctx = {
    scene,
    state,
    camera: new PerspectiveCamera(52, 1.6, 0.1, 80),
    entities: new Registry(),
    add: <T extends Object3D>(object: T): T => {
      scene.add(object);
      return object;
    },
    input: { justPressed: (name: string) => name === action },
    renderer: {
      kind: "webgpu",
      raw: { shadowMap: { enabled: false } },
      setOutputNode: () => {},
      clearOutputNode: () => {},
    },
  } as unknown as Ctx;
  probe.enter(ctx);
  const sun = scene.children.find(
    (object): object is DirectionalLight => object instanceof DirectionalLight,
  );
  if (sun === undefined) throw new Error("Missing authored directional light");
  sun.shadow.map = new RenderTarget(16, 16);
  sun.shadow.map.depthTexture = new DepthTexture(16, 16);
  return {
    probe,
    scene,
    state,
    sun,
    select(mode: string) {
      action = mode;
      probe.update(ctx);
      action = "";
    },
  };
}

describe("fog qualification fixture", () => {
  it("isolates scattering with black unlit surfaces while retaining geometry and shadow casters", () => {
    const f = fixture();
    const meshes = f.scene.children.filter((object) => object instanceof Mesh);
    f.select("scatter");
    const calibration = f.scene.getObjectByName("fog-calibration");
    expect(calibration).toBeInstanceOf(Mesh);
    expect((calibration as Mesh).material).toBeInstanceOf(MeshBasicMaterial);
    expect(((calibration as Mesh).material as MeshBasicMaterial).allowOverride).toBe(false);
    expect(calibration?.castShadow).toBe(false);
    expect(calibration?.visible).toBe(true);
    expect(f.scene.overrideMaterial).toBeInstanceOf(MeshBasicMaterial);
    expect((f.scene.overrideMaterial as MeshBasicMaterial).color.getHex()).toBe(0);
    expect((f.scene.background as Color).getHex()).toBe(0);
    expect(meshes.every((mesh) => mesh.castShadow && mesh.visible)).toBe(true);
    f.select("scatterSunOff");
    expect(f.sun.intensity).toBe(0);
    expect(f.scene.children.find((object) => object instanceof PointLight)?.intensity).toBe(30);
    f.select("scatterPointOff");
    expect(f.sun.intensity).toBe(3);
    expect(f.scene.children.find((object) => object instanceof PointLight)?.intensity).toBe(0);
    f.select("blackOff");
    expect(f.state.getState().targets).toBe(0);
    expect((f.scene.background as Color).getHex()).toBe(0);
    f.select("fog");
    expect(f.scene.overrideMaterial).toBeNull();
    expect((f.scene.background as Color).getHex()).toBe(0x131e2a);
    f.probe.exit();
  });
  it("observes actual target/material release events across rebuild and off", () => {
    const f = fixture();
    for (const mode of ["fog", "inside", "off", "fog", "rebuild", "off"]) f.select(mode);
    expect(f.state.getState()).toMatchObject({
      createdTargets: 4,
      releasedTargets: 4,
      releasedMaterials: 4,
      liveTargets: 0,
      targets: 0,
    });
    f.probe.exit();
  });
});
