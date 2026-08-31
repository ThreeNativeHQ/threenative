import {
  type ICtx,
  type IProbeVolumeObservation,
  ProbeVolume,
  Scene,
  type SceneFrame,
  defineGame,
} from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import {
  Box3,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene as ThreeScene,
  Vector3,
} from "three";
import { color, normalWorld, positionWorld } from "three/tsl";
import { FloatType, MeshBasicNodeMaterial, NearestFilter, RenderTarget } from "three/webgpu";

const BOUNDS = new Box3(new Vector3(-1, -1, -0.8), new Vector3(1, 1, 0.8));

export interface IProbeVolumeFixtureState extends Record<string, unknown> {
  probe: {
    atlasBytes: number;
    bakeCostMs: number;
    bakeFrames: number;
    completed: number;
    fraction: number;
    probeCount: number;
    sampleNodeInstalled: boolean;
    sampleHueRatio: number;
    sampleRed: number;
    stale: boolean;
    status: string;
  };
  volumeEnabled: boolean;
}

const initialState: IProbeVolumeFixtureState = {
  probe: {
    atlasBytes: 0,
    bakeCostMs: 0,
    bakeFrames: 0,
    completed: 0,
    fraction: 0,
    probeCount: 0,
    sampleNodeInstalled: false,
    sampleHueRatio: 0,
    sampleRed: 0,
    stale: true,
    status: "off",
  },
  volumeEnabled: false,
};

function volumeIsEnabled(): boolean {
  return new URLSearchParams(globalThis.location?.search ?? "").get("volume") !== "off";
}

class ProbeVolumeFixture extends Scene<IProbeVolumeFixtureState> {
  static override readonly initialState = initialState;
  #sampleReadback: (() => void) | undefined;

  override enter(ctx: ICtx<IProbeVolumeFixtureState>): SceneFrame<IProbeVolumeFixtureState> {
    const volumeEnabled = volumeIsEnabled();
    const volume = volumeEnabled
      ? new ProbeVolume({
          bounds: BOUNDS,
          bakeBudgetMs: 16,
          cubemapSize: 8,
          density: 0.5,
          maxWorkItemsPerFrame: 1,
        })
      : undefined;
    if (volume !== undefined) ctx.add(volume);

    ctx.camera.position.set(0, 0.05, 3.8);
    ctx.camera.lookAt(0, 0, -0.35);

    const wallMaterial = new MeshBasicNodeMaterial();
    const sampleNodeInstalled = volume !== undefined;
    wallMaterial.colorNode =
      volume?.sampleNode(positionWorld, normalWorld).mul(8) ?? color(0x202020);
    const wall = new Mesh(new PlaneGeometry(1.8, 1.45), wallMaterial);
    wall.name = "neutral-wall-inside-frustum";
    wall.position.set(0, 0, -0.35);

    const emitterMaterial = new MeshBasicNodeMaterial();
    emitterMaterial.colorNode = color(0xff0030).mul(12);
    const emitter = new Mesh(new BoxGeometry(0.8, 1.45, 0.8), emitterMaterial);
    emitter.name = "off-screen-emitter";
    emitter.position.set(4.2, 0, 1.8);

    const floor = new Mesh(new PlaneGeometry(5.5, 4.5), new MeshBasicMaterial({ color: 0x11182a }));
    floor.name = "fixture-floor";
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.76, -0.35);
    const side = new Mesh(
      new BoxGeometry(0.08, 1.7, 1.8),
      new MeshBasicMaterial({ color: 0x28334d }),
    );
    side.name = "fixture-side-marker";
    side.position.set(-1.15, 0, -0.35);
    ctx.add(wall);
    ctx.add(emitter);
    ctx.add(floor);
    ctx.add(side);

    const bake = volume === undefined ? undefined : volume.requestBake(ctx.scene);
    if (volume !== undefined) {
      const sampleScene = new ThreeScene();
      const sampleCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 4);
      sampleCamera.position.z = 2;
      const sampleMaterial = new MeshBasicNodeMaterial();
      sampleMaterial.colorNode = volume.sampleNode(positionWorld, normalWorld);
      const samplePlane = new Mesh(new PlaneGeometry(2, 2), sampleMaterial);
      samplePlane.position.z = -0.35;
      sampleScene.add(samplePlane);
      const sampleTarget = new RenderTarget(1, 1, {
        depthBuffer: false,
        magFilter: NearestFilter,
        minFilter: NearestFilter,
        type: FloatType,
      });
      let sampleReadbackStarted = false;
      this.#sampleReadback = () => {
        if (sampleReadbackStarted || volume.observation.status !== "ready") return;
        sampleReadbackStarted = true;
        void readSampleIrradiance(ctx.renderer.raw, sampleScene, sampleCamera, sampleTarget)
          .then(({ hueRatio, red }) => {
            ctx.state.set((state) => ({
              probe: { ...state.probe, sampleHueRatio: hueRatio, sampleRed: red },
            }));
            ctx.state.flush();
          })
          .catch((error: unknown) => {
            console.log(`TN_PROBE_SAMPLE_ERROR:${String(error)}`);
          });
      };
    }
    let bakeFrames = 0;
    return (frameCtx) => {
      if (volume?.observation.status === "baking") bakeFrames += 1;
      const observation = volume?.observation;
      frameCtx.state.set({
        probe: fixtureProbeState(
          observation,
          sampleNodeInstalled,
          bakeFrames,
          ctx.state.getState().probe,
        ),
        volumeEnabled: observation?.status === "ready" && volumeEnabled,
      });
      if (bake !== undefined && observation?.status === "ready") frameCtx.state.flush();
    };
  }

  override render(_ctx: ICtx<IProbeVolumeFixtureState>): void {
    this.#sampleReadback?.();
  }
}

function fixtureProbeState(
  observation: IProbeVolumeObservation | undefined,
  sampleNodeInstalled: boolean,
  bakeFrames: number,
  sample: IProbeVolumeFixtureState["probe"],
): IProbeVolumeFixtureState["probe"] {
  const exposed = observation?.status === "ready";
  return {
    atlasBytes: exposed ? (observation?.atlasBytes ?? 0) : 0,
    bakeCostMs: observation?.bakeCostMs ?? 0,
    bakeFrames,
    completed: observation?.bakeProgress.completed ?? 0,
    fraction: observation?.bakeProgress.fraction ?? 0,
    probeCount: observation?.probeCount ?? 0,
    sampleNodeInstalled: exposed && sampleNodeInstalled,
    sampleHueRatio: sample.sampleHueRatio,
    sampleRed: sample.sampleRed,
    stale: observation?.stale ?? true,
    status: observation?.status ?? "off",
  };
}

interface IProbeReadbackRenderer {
  readonly readRenderTargetPixelsAsync?: (
    target: RenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    textureIndex?: number,
    faceIndex?: number,
  ) => Promise<ArrayLike<number>>;
  readonly render: (scene: ThreeScene, camera: OrthographicCamera) => void;
  readonly setRenderTarget: (target: RenderTarget | null) => void;
}

async function readSampleIrradiance(
  rendererValue: unknown,
  sampleScene: ThreeScene,
  sampleCamera: OrthographicCamera,
  sampleTarget: RenderTarget,
): Promise<{ readonly hueRatio: number; readonly red: number }> {
  const renderer = rendererValue as IProbeReadbackRenderer;
  if (renderer.readRenderTargetPixelsAsync === undefined) {
    throw new Error("WebGPU render-target readback is unavailable.");
  }
  renderer.setRenderTarget(sampleTarget);
  try {
    renderer.render(sampleScene, sampleCamera);
    const pixels = await renderer.readRenderTargetPixelsAsync(sampleTarget, 0, 0, 1, 1);
    const red = Math.max(0, pixels[0] ?? 0);
    const green = Math.max(0, pixels[1] ?? 0);
    const blue = Math.max(0, pixels[2] ?? 0);
    const hueRatio = red / Math.max(green, blue, 0.000001);
    console.log(
      `TN_PROBE_SAMPLE:${JSON.stringify({
        hueRatio,
        sample: [red, green, blue],
      })}`,
    );
    return { hueRatio, red };
  } finally {
    renderer.setRenderTarget(null);
    sampleTarget.dispose();
  }
}

const game = defineGame<IProbeVolumeFixtureState>({
  plugins: [playtest()],
  render: { preferWebGPU: true },
  scenes: { probeVolume: ProbeVolumeFixture },
  start: "probeVolume",
});

export default game;
