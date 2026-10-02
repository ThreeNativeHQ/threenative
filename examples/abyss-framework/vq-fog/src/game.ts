import {
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  PointLight,
  Vector3,
} from "three";
import { Scene as GameScene, type ICtx, defineGame } from "../../../../packages/core/src/index.js";
import { playtest } from "../../../../packages/core/src/playtest.js";
import { createVolumetricFog } from "../../../../packages/create-threenative/templates/starter/src/render/volumetricFog.js";
import { WorldEnvironment } from "../../../../packages/create-threenative/templates/starter/src/render/worldEnvironment.js";

const initialState = {
  mode: "off",
  ready: false,
  builds: 0,
  disposedGraphs: 0,
  targets: 0,
  pixels: 0,
  steps: 0,
  inside: false,
  sun: true,
  point: true,
  overlaps: false,
};
type FogState = typeof initialState;
type FogCtx = ICtx<FogState>;
const modes = [
  "fog",
  "off",
  "zero",
  "inside",
  "sunOff",
  "pointOff",
  "overlap",
  "half",
  "wallOff",
] as const;
type Mode = (typeof modes)[number];

class FogProbe extends GameScene<FogState> {
  static override readonly initialState = initialState;
  #geometry = new BoxGeometry();
  #material = new MeshStandardMaterial({ color: 0x7c8a91, roughness: 0.85 });
  #sun = new DirectionalLight(0xffedce, 3);
  #point = new PointLight(0xffad60, 30, 8);
  #wall: Mesh | undefined;
  #fog: ReturnType<typeof createVolumetricFog>;
  #release: (() => void) | undefined;
  #mode: Mode = "off";
  #applied: Mode | undefined;
  #builds = 0;
  #disposedGraphs = 0;

  override enter(ctx: FogCtx): void {
    ctx.scene.background = new Color(0x131e2a);
    ctx.scene.fog = null;
    const box = (position: Vector3, scale: Vector3): Mesh => {
      const mesh = new Mesh(this.#geometry, this.#material);
      mesh.position.copy(position);
      mesh.scale.copy(scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      ctx.add(mesh);
      return mesh;
    };
    box(new Vector3(0, -0.2, -3), new Vector3(14, 0.4, 18));
    box(new Vector3(0, 2, -10), new Vector3(10, 4, 0.3));
    box(new Vector3(-5, 2, -5), new Vector3(0.3, 4, 10));
    box(new Vector3(-2.9, 4, -5), new Vector3(4, 0.3, 10));
    box(new Vector3(3.6, 4, -5), new Vector3(2.8, 0.3, 10));
    box(new Vector3(-1.4, 1, -5), new Vector3(1, 2, 1));
    this.#wall = box(new Vector3(0.4, 1.6, 3.6), new Vector3(2, 3.2, 0.4));
    this.#sun.position.set(-3, 7, 1);
    this.#sun.target.position.set(0, 0, -5);
    this.#sun.castShadow = true;
    Object.assign(this.#sun.shadow.camera, {
      left: -9,
      right: 9,
      top: 9,
      bottom: -9,
      near: 0.1,
      far: 30,
    });
    this.#sun.shadow.mapSize.set(512, 512);
    this.#sun.shadow.bias = -0.0002;
    this.#point.position.set(2, 1.3, -3);
    ctx.add(this.#sun);
    ctx.add(this.#sun.target);
    ctx.add(this.#point);
    ctx.add(new HemisphereLight(0xb3cced, 0x201d1a, 0.35));
    const raw = ctx.renderer.raw as { shadowMap: { enabled: boolean } };
    raw.shadowMap.enabled = true;
    ctx.entities.add("fog", { object: new Group(), debug: () => ({ ...ctx.state.getState() }) });
    this.#positionCamera(ctx);
  }

  override update(ctx: FogCtx): void {
    for (const mode of modes) if (ctx.input.justPressed(mode)) this.#mode = mode;
    if (ctx.input.justPressed("rebuild")) this.#applied = undefined;
    this.#positionCamera(ctx);
    this.#sun.intensity = this.#mode === "sunOff" ? 0 : 3;
    this.#point.intensity = this.#mode === "pointOff" ? 0 : 30;
    if (this.#wall !== undefined) this.#wall.visible = this.#mode !== "wallOff";
    // Warm the ordinary directional shadow map with the first real scene frame before composing.
    if (this.#applied !== this.#mode && this.#sun.shadow.map !== null) this.#compose(ctx);
    const observation = this.#fog?.diagnostics();
    ctx.state.set({
      mode: this.#mode,
      ready: this.#applied === this.#mode,
      builds: this.#builds,
      disposedGraphs: this.#disposedGraphs,
      targets: observation?.renderTargets ?? 0,
      pixels: observation?.pixels ?? 0,
      steps: observation?.steps ?? 0,
      inside: this.#mode === "inside",
      sun: this.#sun.intensity > 0,
      point: this.#point.intensity > 0,
      overlaps: this.#mode === "overlap",
    });
  }

  #positionCamera(ctx: FogCtx): void {
    if (this.#mode === "inside") ctx.camera.position.set(0, 1.5, -1);
    else ctx.camera.position.set(6.5, 3, 11);
    ctx.camera.lookAt(0, 1.4, -5);
  }

  #compose(ctx: FogCtx): void {
    this.#disposeGraph();
    const volumes = [
      {
        bounds: new Box3(new Vector3(-4.5, 0, -9.5), new Vector3(4.5, 4, 3)),
        density: this.#mode === "zero" ? 0 : 0.18,
        baseHeight: 0.5,
        heightFalloff: 0.35,
      },
    ];
    if (this.#mode === "overlap")
      volumes.push({
        bounds: new Box3(new Vector3(-2, 0, -7), new Vector3(3, 2.5, 1)),
        density: 0.14,
        baseHeight: 0.5,
        heightFalloff: 0.6,
      });
    const raw = ctx.renderer.raw as {
      logarithmicDepthBuffer?: boolean;
      reversedDepthBuffer?: boolean;
    };
    const fog = createVolumetricFog(ctx.camera as PerspectiveCamera, {
      enabled: this.#mode !== "off",
      renderer: ctx.renderer.kind,
      logarithmicDepth: raw.logarithmicDepthBuffer,
      reversedDepth: raw.reversedDepthBuffer,
      steps: 48,
      resolutionScale: this.#mode === "half" ? 0.5 : 1,
      volumes,
      albedo: new Color(0.86, 0.9, 0.95),
      ambient: new Color(0.055, 0.075, 0.11),
      anisotropy: 0.35,
      sun: this.#sun,
      points: [this.#point],
      environment: { aerialPerspective: false, godRays: false, sceneFog: false },
    });
    const world = new WorldEnvironment({
      bloomEnabled: false,
      screenSpaceAA: "disabled",
      tonemapMode: "neutral",
      exposure: 1,
    });
    const applied = world.apply(
      ctx.renderer,
      ctx.scene,
      ctx.camera,
      fog === undefined ? {} : { baseColour: (scenePass) => fog.compose(scenePass) },
    );
    this.#fog = fog;
    this.#release = () => {
      applied.dispose?.();
      fog?.dispose();
    };
    this.#builds += 1;
    this.#applied = this.#mode;
  }

  #disposeGraph(): void {
    if (this.#release === undefined) return;
    this.#release();
    this.#release = undefined;
    this.#fog = undefined;
    this.#disposedGraphs += 1;
  }
  override exit(): void {
    this.#disposeGraph();
    this.#geometry.dispose();
    this.#material.dispose();
    this.#sun.dispose();
    this.#point.dispose();
  }
}

export default defineGame<FogState>({
  camera: { far: 80, near: 0.1, fov: 52, projection: "perspective" },
  initialState,
  input: {
    fog: { keys: ["KeyF"] },
    off: { keys: ["KeyO"] },
    zero: { keys: ["KeyZ"] },
    inside: { keys: ["KeyI"] },
    sunOff: { keys: ["KeyS"] },
    pointOff: { keys: ["KeyP"] },
    overlap: { keys: ["KeyB"] },
    half: { keys: ["KeyH"] },
    wallOff: { keys: ["KeyW"] },
    rebuild: { keys: ["KeyC"] },
  },
  plugins: [playtest<FogState>()],
  renderer: { preferWebGPU: true, resolutionScale: 1, pixelRatio: 1 },
  scenes: { fog: FogProbe },
  seed: 20261002,
  start: "fog",
});
