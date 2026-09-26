import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  type Light,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  REVISION,
  RenderTarget,
  Scene,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { type ICullCapture, cullCapture } from "./cull-harness.js";
import { sha256 } from "./identity.js";
import {
  type ILightsFixture,
  type ILightsMesh,
  LIGHTS_TOLERANCE,
  LIGHTS_VIEWPORT,
  lightsAccum,
  lightsCellAxisX,
  lightsCellWorld,
  lightsElapsedFrames,
  lightsEnergy,
  lightsMeshBufferBytes,
  lightsMeshChannels,
  lightsRotations,
} from "./lights-fixture.js";

/**
 * The counterpart arm's scene for `godot-lights-meshes`. It renders the same hierarchy the pinned
 * source does — a mesh grid and a light grid under two `Rotater`s that turn opposite ways, with each
 * light's energy and visibility recomputed per frame by the pinned `Lighter` rule — built from the
 * fixture's own bytes and driven by the same advance-then-render clock, so frame `k` is one workload
 * state in both arms.
 *
 * A sampled state is read off the object the renderer will actually draw, and the closed form in
 * `lights-fixture.ts` is checked against that read: a scene the oracle does not agree with is a
 * scene that is not the fixture's, and it fails here rather than in a comparison after a minute of
 * GPU time.
 */

export interface ILightsLightProbe {
  readonly accum: number;
  readonly axisX: readonly [number, number, number];
  readonly energy: number;
  readonly index: number;
  readonly origin: readonly [number, number, number];
  readonly visible: boolean;
}

export interface ILightsMeshProbe {
  readonly axisX: readonly [number, number, number];
  readonly index: number;
  readonly origin: readonly [number, number, number];
}

export interface ILightsState {
  readonly elapsedFrames: number;
  readonly frameId: number;
  readonly lightProbes: readonly ILightsLightProbe[];
  readonly lightsVisible: number;
  readonly lightRotationY: number;
  readonly meshProbes: readonly ILightsMeshProbe[];
  readonly meshRotationY: number;
}

export interface ILightsScene {
  /** The digest this arm re-derived from the arrays it uploaded, not the one the fixture claims. */
  readonly bufferSha256: string;
  readonly camera: PerspectiveCamera;
  readonly lightCount: { omni: number; requested: number; spot: number };
  readonly lights: Light[];
  dispose(): void;
  renderRoot: Object3D;
  scene: Scene;
  setLightsVisible(visible: boolean): void;
  state(frame: number): ILightsState;
  step(frame: number): void;
}

/**
 * The geometry is the pinned scene's own buffer bytes, not a `BoxGeometry` built from a matching
 * name, and the digest is re-derived from the arrays that reached the GPU so a channel-order or
 * decode mistake cannot pass as agreement.
 */
async function geometryFor(
  mesh: ILightsMesh,
): Promise<{ geometry: BufferGeometry; sha256: string }> {
  const channels = lightsMeshChannels(mesh);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(channels.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(channels.normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(channels.uvs, 2));
  geometry.setIndex(new BufferAttribute(channels.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  // Read back what the attributes actually hold rather than what the fixture said they hold, so a
  // channel-order or decode mistake cannot pass as agreement.
  const uploaded = {
    indices: (geometry.getIndex()?.array as Uint32Array) ?? new Uint32Array(0),
    normals: geometry.getAttribute("normal").array as Float32Array,
    positions: geometry.getAttribute("position").array as Float32Array,
    uvs: geometry.getAttribute("uv").array as Float32Array,
  };
  const observed = await sha256(lightsMeshBufferBytes(mesh, uploaded));
  if (observed !== mesh.bufferSha256)
    throw new Error(
      `TN_BENCH_LIGHTS_BUFFER_HASH_MISMATCH:${mesh.kind} uploaded ${observed} fixture ${mesh.bufferSha256}`,
    );
  return { geometry, sha256: observed };
}

export async function buildLightsScene(
  fixture: ILightsFixture,
  meshProbes: readonly number[],
  lightProbes: readonly number[],
): Promise<ILightsScene> {
  const scene = new Scene();
  // The pinned project sets `background_mode` to BG_COLOR with a white colour and never installs a
  // Sky, so the background is the exported colour and nothing else reaches the frame behind it.
  scene.background = new Color(
    ...(fixture.environment.backgroundColor as unknown as [number, number, number]),
  );
  const camera = new PerspectiveCamera(
    fixture.camera.fovDegrees,
    LIGHTS_VIEWPORT.width / LIGHTS_VIEWPORT.height,
    fixture.camera.near,
    fixture.camera.far,
  );
  // The camera's world matrix travels as its three basis columns, so this orients the identical
  // camera without re-deriving Godot's `rotate_x` convention or guessing a look-at target.
  const world = new Matrix4()
    .makeBasis(
      new Vector3(...(fixture.camera.basisX as unknown as [number, number, number])),
      new Vector3(...(fixture.camera.basisY as unknown as [number, number, number])),
      new Vector3(...(fixture.camera.basisZ as unknown as [number, number, number])),
    )
    .setPosition(new Vector3(...(fixture.camera.position as unknown as [number, number, number])));
  camera.position.setFromMatrixPosition(world);
  camera.quaternion.setFromRotationMatrix(world);

  const built = await geometryFor(fixture.meshes[0] as ILightsMesh);
  // A `StandardMaterial`, not `Basic`: this cell is about light falling on meshes, so an unlit
  // counterpart would not be running the workload at all. The pinned source leaves the material at
  // Godot's default — white albedo, full roughness, no metalness — and so does this.
  const material: Material = new MeshStandardMaterial({
    color: new Color(1, 1, 1),
    metalness: 0,
    roughness: 1,
  });

  const meshRotater = new Object3D();
  const meshGrid = new Object3D();
  const models: Mesh[] = [];
  for (const cell of fixture.meshGrid.cells) {
    const node = new Object3D();
    node.position.set(
      cell.position[0] as number,
      cell.position[1] as number,
      cell.position[2] as number,
    );
    node.scale.set(cell.scale[0] as number, cell.scale[1] as number, cell.scale[2] as number);
    const model = new Mesh(built.geometry, material);
    model.position.set(
      fixture.meshModel.position[0] as number,
      fixture.meshModel.position[1] as number,
      fixture.meshModel.position[2] as number,
    );
    model.scale.set(
      fixture.meshModel.scale[0] as number,
      fixture.meshModel.scale[1] as number,
      fixture.meshModel.scale[2] as number,
    );
    node.add(model);
    meshGrid.add(node);
    models.push(model);
  }
  meshRotater.add(meshGrid);
  scene.add(meshRotater);

  const lightRotater = new Object3D();
  const lightGrid = new Object3D();
  const lights: PointLight[] = [];
  for (const cell of fixture.lightGrid.cells) {
    const node = new Object3D();
    node.position.set(
      cell.position[0] as number,
      cell.position[1] as number,
      cell.position[2] as number,
    );
    node.scale.set(cell.scale[0] as number, cell.scale[1] as number, cell.scale[2] as number);
    // `omni_attenuation` is three's punctual-light decay exponent and `omni_range` is its distance:
    // both engines use `pow(clamp(1 - d/range, 0, 1), k)`, so the falloff curve is the same function
    // rather than an approximation of it, and `light_energy` is `intensity` directly.
    const light = new PointLight(
      new Color(...(fixture.lights.color as unknown as [number, number, number])),
      fixture.lights.openingEnergy,
      fixture.lights.range,
      fixture.lights.attenuation,
    );
    light.castShadow = fixture.lights.shadowEnabled;
    light.position.set(
      fixture.lights.localPosition[0] as number,
      fixture.lights.localPosition[1] as number,
      fixture.lights.localPosition[2] as number,
    );
    node.add(light);
    lightGrid.add(node);
    lights.push(light);
  }
  lightRotater.add(lightGrid);
  scene.add(lightRotater);
  // The pinned source sets `ambient_light_source` to AMBIENT_SOURCE_COLOR and leaves the colour at
  // Godot's default, which is black. The exported value decides: this cell's ambient contributes
  // nothing, and it is not faked into a hemisphere light the competitor does not have.
  if (fixture.environment.ambientColor.some((channel) => channel !== 0))
    scene.add(
      new AmbientLight(
        new Color(...(fixture.environment.ambientColor as unknown as [number, number, number])),
        fixture.environment.ambientEnergy,
      ),
    );

  const step = (frame: number): void => {
    const rotations = lightsRotations(fixture, frame);
    meshRotater.rotation.set(0, rotations.meshRotationY, 0);
    lightRotater.rotation.set(0, rotations.lightRotationY, 0);
    for (let index = 0; index < lights.length; index++) {
      // The pinned `Lighter` sets the flag from the sine and writes an energy only while the light is
      // on, so a hidden light keeps whatever energy it last had. Modelling that exactly is what lets
      // the two arms' energy fields be compared and not only their flags.
      const { energy, visible } = lightsEnergy(fixture, index, frame);
      const light = lights[index] as PointLight;
      light.visible = visible;
      if (visible) light.intensity = energy;
    }
  };
  step(0);
  scene.updateMatrixWorld(true);
  return {
    bufferSha256: built.sha256,
    camera,
    dispose: () => {
      built.geometry.dispose();
      material.dispose();
    },
    lightCount: {
      omni: fixture.lights.actual,
      requested: fixture.lights.requested,
      spot: 0,
    },
    lights,
    renderRoot: scene,
    scene,
    setLightsVisible: (visible) => {
      for (const light of lights) light.visible = visible;
    },
    state: (frame) => {
      step(frame);
      scene.updateMatrixWorld(true);
      const rotations = lightsRotations(fixture, frame);
      let visible = 0;
      for (const light of lights) if (light.visible) visible += 1;
      return {
        elapsedFrames: lightsElapsedFrames(frame),
        frameId: frame,
        lightProbes: lightProbes.map((index) => {
          const light = lights[index] as PointLight;
          return {
            accum: lightsAccum(fixture, index, frame),
            axisX: worldAxisX(light, "light", fixture, index, frame),
            energy: light.intensity,
            index,
            origin: worldOrigin(light, "light", fixture, index, frame),
            visible: light.visible,
          };
        }),
        lightsVisible: visible,
        lightRotationY: rotations.lightRotationY,
        meshProbes: meshProbes.map((index) => {
          const model = models[index];
          if (model === undefined) throw new Error(`TN_BENCH_LIGHTS_PROBE_MISSING:mesh-${index}`);
          return {
            axisX: worldAxisX(model, "mesh", fixture, index, frame),
            index,
            origin: worldOrigin(model, "mesh", fixture, index, frame),
          };
        }),
        meshRotationY: rotations.meshRotationY,
      };
    },
    step,
  };
}

/**
 * The world origin of the object the renderer will draw, column-major `matrixWorld` elements 12-14.
 * The closed form is checked against it rather than preferred to it: a scene graph that does not
 * evaluate to the pinned source's own formula is a scene that is not this fixture's.
 */
function worldOrigin(
  node: Object3D,
  grid: "light" | "mesh",
  fixture: ILightsFixture,
  index: number,
  frame: number,
): readonly [number, number, number] {
  const elements = node.matrixWorld.elements;
  const origin = [elements[12] as number, elements[13] as number, elements[14] as number] as const;
  for (let axis = 0; axis < 3; axis++) {
    const delta = Math.abs(
      (origin[axis] as number) - lightsCellWorld(fixture, grid, index, frame)[axis],
    );
    if (delta > LIGHTS_TOLERANCE.originAbsoluteMetres)
      throw new Error(
        `TN_BENCH_LIGHTS_ORACLE_DISAGREEMENT:${grid}-${index} axis ${axis} scene ${origin[axis]} oracle ${lightsCellWorld(fixture, grid, index, frame)[axis]}`,
      );
  }
  return origin;
}

/** The world `X` column, matrix elements 0-2. One term, so a scale or a rotation sense cannot hide. */
function worldAxisX(
  node: Object3D,
  grid: "light" | "mesh",
  fixture: ILightsFixture,
  index: number,
  frame: number,
): readonly [number, number, number] {
  const elements = node.matrixWorld.elements;
  const axis = [elements[0] as number, elements[1] as number, elements[2] as number] as const;
  const expected = lightsCellAxisX(fixture, grid, index, frame);
  for (let component = 0; component < 3; component++)
    if (Math.abs((axis[component] as number) - (expected[component] as number)) > 1e-6)
      throw new Error(
        `TN_BENCH_LIGHTS_ORACLE_DISAGREEMENT:${grid}-${index} axisX ${component} scene ${axis[component]} oracle ${expected[component]}`,
      );
  return axis;
}

export interface ILightsAdapterIdentity {
  readonly architecture: string | null;
  readonly description: string | null;
  readonly device: string | null;
  readonly vendor: string | null;
}

export interface ILightsHarness extends ILightsScene {
  readonly adapter: ILightsAdapterIdentity;
  readonly threeRevision: string;
  capture(): Promise<{ capture: ICullCapture; png: Uint8Array | null }>;
  drain(): Promise<void>;
  render(): Promise<void>;
  stats(): { drawCalls: number; triangles: number };
}

/** Read from the adapter the runtime actually handed out, field by field: a bare stringify is `{}`. */
async function describeAdapter(): Promise<ILightsAdapterIdentity> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu === undefined) throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  const adapter = (await gpu.requestAdapter()) as {
    info?: Record<string, string | undefined>;
  } | null;
  const info = adapter?.info;
  if (info === undefined || info === null) throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  const read = (value: string | undefined): string | null =>
    value === undefined || value.length === 0 ? null : value;
  const identity: ILightsAdapterIdentity = {
    architecture: read(info.architecture),
    description: read(info.description),
    device: read(info.device),
    vendor: read(info.vendor),
  };
  if (Object.values(identity).every((value) => value === null))
    throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  return identity;
}

export async function createLightsHarness(
  canvas: HTMLCanvasElement,
  fixture: ILightsFixture,
  meshProbes: readonly number[],
  lightProbes: readonly number[],
): Promise<ILightsHarness> {
  const renderer = new WebGPURenderer({ antialias: false, canvas });
  renderer.setPixelRatio(1);
  renderer.setSize(LIGHTS_VIEWPORT.width, LIGHTS_VIEWPORT.height, false);
  await renderer.init();
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = true;
  const built = await buildLightsScene(fixture, meshProbes, lightProbes);
  const backend = renderer.backend as unknown as {
    device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } };
  };
  const adapter = await describeAdapter();
  let previous: Float32Array | null = null;
  const renderTo = async (target: unknown): Promise<void> => {
    renderer.info.reset();
    (renderer as unknown as { setRenderTarget(target: unknown): void }).setRenderTarget(target);
    await renderer.render(built.renderRoot, built.camera);
    (renderer as unknown as { setRenderTarget(target: unknown): void }).setRenderTarget(null);
  };
  return {
    ...built,
    adapter,
    capture: async () => {
      // Two renders of one untimed frame: the canvas keeps the presented image, the target is what
      // the coverage numbers are read from, so both describe the same state.
      await renderTo(null);
      const readTarget = renderer as unknown as {
        readRenderTargetPixelsAsync(
          target: unknown,
          x: number,
          y: number,
          width: number,
          height: number,
        ): Promise<Uint8Array>;
      };
      if (typeof readTarget.readRenderTargetPixelsAsync !== "function")
        throw new Error("TN_BENCH_LIGHTS_READBACK_UNAVAILABLE");
      const renderTarget = new RenderTarget(LIGHTS_VIEWPORT.width, LIGHTS_VIEWPORT.height);
      await renderTo(renderTarget);
      const pixels = await readTarget.readRenderTargetPixelsAsync(
        renderTarget,
        0,
        0,
        LIGHTS_VIEWPORT.width,
        LIGHTS_VIEWPORT.height,
      );
      renderTarget.dispose();
      // The pinned arm's background reference is its own corner pixel, so this measures against this
      // frame's corner pixel: the modal luma of a tiled plane is a box, and a modal reference here
      // would count the background slivers instead of the silhouette.
      const corner =
        (0.2126 * (pixels[0] as number) +
          0.7152 * (pixels[1] as number) +
          0.0722 * (pixels[2] as number)) /
        255;
      const capture = cullCapture(
        pixels,
        LIGHTS_VIEWPORT.width,
        LIGHTS_VIEWPORT.height,
        previous,
        corner,
      );
      previous = capture.luma;
      let png: Uint8Array | null = null;
      const convert = (
        canvas as unknown as {
          convertToBlob?: () => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
        }
      ).convertToBlob;
      if (typeof convert === "function") {
        const blob = await (convert as () => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>).call(
          canvas,
        );
        png = new Uint8Array(await blob.arrayBuffer());
      }
      return { capture, png };
    },
    dispose: () => {
      built.dispose();
      renderer.dispose();
    },
    drain: async () => {
      if (backend.device?.queue?.onSubmittedWorkDone === undefined)
        throw new Error("TN_BENCH_GPU_COMPLETION_UNAVAILABLE");
      await backend.device.queue.onSubmittedWorkDone();
    },
    render: () => renderTo(null),
    stats: () => ({
      drawCalls: renderer.info.render.drawCalls,
      triangles: renderer.info.render.triangles,
    }),
    threeRevision: REVISION,
  };
}
