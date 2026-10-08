import {
  BackSide,
  BoxGeometry,
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshLambertNodeMaterial,
  PointLight,
  RenderPipeline,
  RenderTarget,
  SRGBColorSpace,
  Scene,
  Vector3,
} from "three";
import {
  Fn,
  float,
  instanceIndex,
  instancedArray,
  length,
  mx_noise_float,
  mx_worley_noise_vec2,
  normalViewGeometry,
  normalWorld,
  normalize,
  pass,
  pmremTexture,
  positionLocal,
  positionWorld,
  screenUV,
  sin,
  uint,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { FluidParticles3D } from "/core/fluid-particles.js";
/**
 * The TSL programs a render fixture's `tsl` op applies, authored in upstream TSL. Each has a C++
 * twin of the same name in runtime-native/tests/native-engine/fixture/tsl_programs.h, authored with
 * the native TSL builder; the fixture's golden is what this one draws.
 */
import { GPUParticles3D } from "/core/particles.js";

/**
 * PRD-513: a post pass over the scene texture: a 2-texel chromatic split (texel centres, so the
 * sampler's filter cannot matter) and a radial vignette, before the output transform.
 */
function chromatic(renderer, scene, camera) {
  const pipeline = new RenderPipeline(renderer);
  const color = pass(scene, camera).getTextureNode();
  const offset = vec2(2 / 320, 0);
  const r = color.sample(screenUV.add(offset)).x;
  const g = color.sample(screenUV).y;
  const b = color.sample(screenUV.sub(offset)).z;
  const vignette = float(1).sub(length(screenUV.sub(0.5)).mul(0.6));
  pipeline.outputNode = vec4(vec3(r, g, b).mul(vignette), 1);
  return pipeline;
}

export const GRID_COUNT = 10_000;

const PARTICLE_COUNT = 12;
const PARTICLE_STEPS = 10;

// Game-owned appearance deliberately varies over UVs; the native twin consumes this same graph.
function particleMaterial(material) {
  material.colorNode = vec4(uv(), 0.35, 1);
  material.opacityNode = float(0.8);
}
function replaceSprite(target, sprite, scene) {
  sprite.position.copy(target.position);
  sprite.quaternion.copy(target.quaternion);
  sprite.scale.copy(target.scale);
  sprite.center.copy(target.center);
  sprite.frustumCulled = false;
  scene.remove(target);
  scene.add(sprite);
}

/** Drive the shipped game API, never an ordinary directional shadow disguised as VSM. */
async function virtualShadow({ target, renderer, scene, camera }, cut = false) {
  const { VirtualShadowNode } = await import("/core/virtual-shadow.js");
  target.shadow.shadowNode = new VirtualShadowNode(target, {
    clipExtents: [8, 24],
    mapSize: 256,
    lightDistance: 20,
    depthRange: 40,
    selectionGuard: 0.9,
    refreshStep: 0,
    invalidationDelay: 0,
    adaptiveRefresh: false,
    adaptiveCasterGate: false,
    minCasterTexels: 0,
    followViewFocus: false,
    receiverPlaneBias: true,
    shadowLodBias: false,
    marker: false,
  });
  // Warm both levels at the capture's eye position: a rotation cut must reuse these page keys.
  for (let i = 0; i < 2; ++i) {
    renderer.render(scene, camera);
    await renderer.backend.device.queue.onSubmittedWorkDone();
  }
  if (cut) {
    // Index-only edits leave caster bounds/position versions intact. Cached maps still hold
    // the wide box; a fresh map sees only degenerate triangles, leaving the floor unshadowed.
    const geometry = scene.getObjectByName("cutCaster").geometry;
    geometry.setIndex(new Array(geometry.index.count).fill(0));
    camera.lookAt(0, 0.4, 0);
    camera.updateMatrixWorld(true);
    target.shadow.shadowNode.invalidateAll();
  }
}

/** Real static captures and material sampling through the game's shipped ProbeVolume API. */
async function probeLighting({ renderer, scene, camera, width, height }, mode) {
  const { ProbeVolume } = await import("/core/probe-volume.js");
  const captureCounts = new WeakMap();
  const raw = new Proxy(renderer, {
    get(target, key) {
      if (key === "render")
        return (capture, view) => {
          captureCounts.set(capture, (captureCounts.get(capture) ?? 0) + 1);
          return target.render(capture, view);
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set: (target, key, value) => Reflect.set(target, key, value, target),
  });
  const attached = {
    kind: "webgpu",
    raw,
    compileAsync: (capture, view) => renderer.compileAsync(capture, view),
  };
  const volume = () =>
    new ProbeVolume({
      bounds: { min: new Vector3(-0.5, -0.5, -0.5), max: new Vector3(0.5, 0.5, 0.5) },
      density: 1,
      cubemapSize: 8,
      near: 0.1,
      far: 20,
      bounces: 1,
      bakeBudgetMs: 1000,
      maxWorkItemsPerFrame: 1,
      report: () => {},
    });
  const capture = (probes) => {
    const captureScene = new Scene();
    const material = new MeshLambertNodeMaterial({ color: 0xffffff, side: BackSide });
    material.emissiveNode = probes.sample().div(Math.PI);
    captureScene.add(new Mesh(new BoxGeometry(6, 6, 6), material));
    const light = new PointLight(0xffffff, 32, 0, 2);
    light.color.setRGB(0.2, 0.8, 1);
    light.position.set(-1, 0, 1);
    captureScene.add(light);
    captureScene.updateMatrixWorld(true);
    return { scene: captureScene, light };
  };
  const bind = (probes, name, center) => {
    scene.getObjectByName(name).material.emissiveNode = probes
      .sampleNode(positionWorld.sub(vec3(center, 0, 0)), normalWorld)
      .div(Math.PI);
  };
  const converge = async (probes, pending) => {
    for (let frame = 0; frame < 1000 && probes.observation.status !== "ready"; ++frame) {
      probes.process(attached);
      await renderer.backend.device.queue.onSubmittedWorkDone();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (probes.observation.status !== "ready") throw new Error("probe fixture did not converge");
    await pending;
  };
  const snapshot = async () => {
    const snapshotTarget = new RenderTarget(width, height);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(snapshotTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
    const pixels = await renderer.readRenderTargetPixelsAsync(snapshotTarget, 0, 0, width, height);
    snapshotTarget.dispose();
    return pixels;
  };
  const requireSignal = (pixels) => {
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 8) lit += 1;
    if (lit <= width * height * 0.02)
      throw new Error("probe fixture has no discriminating irradiance");
  };
  const affected = volume();
  const unaffected = volume();
  bind(affected, "probeReceiver", -1.1);
  bind(unaffected, "unaffectedReceiver", 1.1);
  if (mode === "baked") {
    for (const probes of [affected, unaffected]) {
      for (let iz = 0; iz < 2; ++iz)
        for (let iy = 0; iy < 2; ++iy)
          for (let ix = 0; ix < 2; ++ix) {
            const coefficients = [{ r: 0.4 + 0.2 * ix, g: 1.2 + 0.2 * iy, b: 2 + 0.2 * iz }];
            for (let i = 1; i < 9; ++i)
              coefficients.push({
                r: 0.03 * i * (ix ? 1 : -1),
                g: 0.02 * i * (iy ? 1 : -1),
                b: 0.01 * i * (iz ? 1 : -1),
              });
            probes.setProbeCoefficients(ix, iy, iz, coefficients);
          }
    }
    // No attachRenderer/requestBake: the cooked CPU atlas is sampled without scene recapture.
    requireSignal(await snapshot());
    return;
  }
  const affectedCapture = capture(affected);
  const unaffectedCapture = capture(unaffected);
  for (const [probes, captured] of [
    [affected, affectedCapture],
    [unaffected, unaffectedCapture],
  ]) {
    probes.attachRenderer(attached);
    await converge(probes, probes.requestBake(captured.scene));
  }
  for (const captured of [affectedCapture, unaffectedCapture])
    if (captureCounts.get(captured.scene) !== 96)
      throw new Error("probe fixture did not capture two complete passes");
  const before = await snapshot();
  requireSignal(before);
  if (mode !== "relight") return;
  const unaffectedBefore = captureCounts.get(unaffectedCapture.scene);
  affectedCapture.light.position.set(1, 0, 1);
  affectedCapture.light.color.setRGB(1, 0.25, 0.05);
  affectedCapture.scene.updateMatrixWorld(true);
  const pending = affected.requestBake(affectedCapture.scene);
  if (!affected.observation.samplingIsolated || affected.observation.bakeProgress.completed !== 0)
    throw new Error("rebake did not isolate the previous atlas immediately");
  const isolated = await snapshot();
  for (let y = 42; y < height - 42; ++y)
    for (let x = 43; x < 277; ++x) {
      if (x >= 151 && x < 169) continue;
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; ++channel) {
        if (x < 151 && isolated[offset + channel] !== 0)
          throw new Error("first frame after rebake contains stale probe light");
        if (x >= 169 && isolated[offset + channel] !== before[offset + channel])
          throw new Error("rebake modified the unrelated receiver");
      }
    }
  await converge(affected, pending);
  if (captureCounts.get(unaffectedCapture.scene) !== unaffectedBefore)
    throw new Error("rebake scheduled work for the unrelated volume");
  const after = await snapshot();
  let changed = 0;
  for (let pixel = 0; pixel < width * height; ++pixel)
    if (
      [0, 1, 2].some(
        (channel) => Math.abs(after[pixel * 4 + channel] - before[pixel * 4 + channel]) > 8,
      )
    )
      changed += 1;
  if (changed <= width * height * 0.02) throw new Error("light move did not change probe lighting");
}

// Dense pattern keeps old colours inside the 3x3 variance box after the cut; flat colours
// would be clamped away and let a broken reset pass. Small rigid motion exercises reprojection.
async function temporalFixture({ renderer, scene, camera, traaDump }, firstCutFrame) {
  const { traa } = await import("/addons/tsl/display/TRAANode.js");
  const { mrt, output, velocity } = await import("three/tsl");
  const mesh = scene.getObjectByName("temporalPattern");
  const phase = uniform(0);
  const pattern = sin(uv().x.mul(900).add(phase)).mul(sin(uv().y.mul(700)));
  mesh.material.colorNode = vec4(vec3(pattern.mul(0.45).add(0.5)), 1);
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, velocity }));
  const effect = traa(
    scenePass.getTextureNode("output"),
    scenePass.getTextureNode("depth"),
    scenePass.getTextureNode("velocity"),
    camera,
  );
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = effect;
  // Compile with upstream's own initialization: depth is allocated by the resolve before
  // TRAANode copies it. Build first so the first beauty frame receives jitter index 0, too.
  pipeline._update();
  await renderer.compileAsync(pipeline._quadMesh, pipeline._quadMesh.camera);
  // TRAANode exposes resize restart, but no cut API. Restart its own colour history and
  // sample current depth on the reset frame, matching the native graph's seeded depth.
  let reset = true;
  let resolves = 0;
  const updateBefore = effect.updateBefore;
  effect.updateBefore = function (frame) {
    if (reset) {
      this.setSize(1, 1);
      this._previousDepthNode.value = this.depthNode.value;
      this._cameraWorldMatrix.value.copy(camera.matrixWorld);
      this._cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      reset = false;
    }
    updateBefore.call(this, frame);
    resolves += 1;
  };
  // Debug only: enqueue copies at the resolve boundary, after restart seeding and before the
  // upstream history copy. Readback submits immediately; awaiting it happens outside render().
  let dump;
  if (traaDump && !firstCutFrame) {
    let pending = [];
    let jitter;
    let lastFrame;
    const setViewOffset = effect.setViewOffset;
    effect.setViewOffset = function (width, height) {
      setViewOffset.call(this, width, height);
      jitter = {
        jitterIndex: this._jitterIndex,
        jitterPixels: [camera.view.offsetX, camera.view.offsetY],
        projectionMatrix: [...camera.projectionMatrix.elements],
      };
    };
    const read = async (name, target, textureIndex = 0) => {
      const { width, height } = target;
      const texture = target.textures[textureIndex];
      const data = await renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        width,
        height,
        textureIndex,
      );
      const channels = 4;
      const rowElements =
        Math.ceil((width * channels * data.BYTES_PER_ELEMENT) / 256) *
        (256 / data.BYTES_PER_ELEMENT);
      const values = [];
      for (let y = 0; y < height; ++y)
        for (let x = 0; x < width * channels; ++x) {
          const value = data[y * rowElements + x];
          values.push(data instanceof Uint16Array ? DataUtils.fromHalfFloat(value) : value);
        }
      await globalThis.__tnTraaDump(
        name,
        {
          width,
          height,
          channels,
          dtype: "float32",
          byteOrder: "little",
          origin: "top-left",
          sourceType: texture.type,
        },
        values,
      );
    };
    const setRenderTarget = renderer.setRenderTarget;
    renderer.setRenderTarget = function (target, ...args) {
      if (target === effect._resolveRenderTarget) {
        lastFrame = {
          frame: resolves,
          frameCount: resolves + 1,
          indexBase: 0,
          ...jitter,
        };
        if (resolves >= 18 && resolves <= 23) {
          const prefix = `frame-${resolves}`;
          pending.push(globalThis.__tnTraaDump(prefix, lastFrame));
          pending.push(read(`${prefix}-beauty`, scenePass.renderTarget));
          pending.push(
            read(
              `${prefix}-velocity`,
              scenePass.renderTarget,
              scenePass.renderTarget.textures.indexOf(effect.velocityNode.value),
            ),
          );
          pending.push(read(`${prefix}-history`, effect._historyRenderTarget));
        }
      }
      return setRenderTarget.call(this, target, ...args);
    };
    dump = async () => {
      if (lastFrame.frame >= 18 && lastFrame.frame <= 23)
        pending.push(read(`frame-${lastFrame.frame}-resolved`, effect._resolveRenderTarget));
      await Promise.all(pending);
      pending = [];
      await globalThis.__tnTraaDump("capture", lastFrame);
    };
  }
  const draw = async () => {
    // FRAME nodes advance on the renderer's animation tick, not queue completion.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const before = resolves;
    pipeline.render();
    if (resolves !== before + 1) throw new Error("TRAA frame did not advance before capture");
    await renderer.backend.device.queue.onSubmittedWorkDone();
    if (dump) await dump();
  };
  for (let i = 0; i < 20; ++i) {
    mesh.position.x = i * 0.002;
    await draw();
  }
  camera.position.z = 5.01;
  camera.updateMatrixWorld(true);
  phase.value = Math.PI; // complementary pre/post views at the same pixels
  reset = true;
  const steps = firstCutFrame ? 0 : 3;
  for (let i = 0; i < steps; ++i) {
    mesh.position.x = (20 + i) * 0.002;
    await draw();
  }
  mesh.position.x = (20 + steps) * 0.002;
  return { render: draw };
}

/** Asymmetric bands reveal handedness, horizon, rotation, sRGB decode and intensity. */
function equirectSky() {
  const width = 128;
  const height = 64;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; ++y)
    for (let x = 0; x < width; ++x) {
      const at = (y * width + x) * 4;
      pixels[at] = 20 + ((x * 160) % 220);
      pixels[at + 1] = 30 + Math.floor((y * 180) / height);
      pixels[at + 2] = 220 - Math.floor((x * 150) / width);
      pixels[at + 3] = 255;
    }
  const sky = new DataTexture(pixels, width, height);
  sky.mapping = EquirectangularReflectionMapping;
  sky.colorSpace = SRGBColorSpace;
  sky.magFilter = LinearFilter;
  sky.minFilter = LinearMipmapLinearFilter;
  sky.needsUpdate = true;
  return sky;
}

export const programs = {
  "sky-equirect"({ target }) {
    const sky = equirectSky();
    target.background = target.environment = sky;
    target.backgroundIntensity = target.environmentIntensity = 2.5;
    target.backgroundRotation.set(0.1, 0.4, 0);
    target.environmentRotation.set(0.1, 0.4, 0);
  },
  async "traa-history"(context) {
    return temporalFixture(context, false);
  },
  async "history-cut"(context) {
    return temporalFixture(context, true);
  },
  async probes(context) {
    await probeLighting(context, "live");
  },
  async "probes-baked"(context) {
    await probeLighting(context, "baked");
  },
  async "probes-relight"(context) {
    await probeLighting(context, "relight");
  },
  async "vsm-basic"(context) {
    await virtualShadow(context);
  },
  async "vsm-cut"(context) {
    await virtualShadow(context, true);
  },
  async "vsm-deformation"({ target }) {
    target.positionNode = positionLocal.add(vec3(0, 0, sin(positionLocal.x.mul(2)).mul(0.4)));
  },
  async "particles-sprite"({ target, scene, renderer }) {
    const material = target.material;
    particleMaterial(material);
    const particles = new GPUParticles3D({
      amount: PARTICLE_COUNT,
      material,
      start: (buffers) =>
        Fn(() => {
          const row = instanceIndex.div(uint(4));
          const col = instanceIndex.sub(row.mul(uint(4)));
          buffers.positions.element(instanceIndex).assign(
            vec3(
              float(col).sub(1.5).mul(1.1),
              float(row).sub(1).mul(0.85),
              float(instanceIndex.mod(uint(3)))
                .sub(1)
                .mul(0.2),
            ),
          );
          buffers.velocities.element(instanceIndex).assign(vec3(0.1, 0.25, -0.08));
        })().compute(PARTICLE_COUNT),
      process: (buffers) =>
        Fn(() => {
          const velocity = buffers.velocities.element(instanceIndex);
          buffers.positions
            .element(instanceIndex)
            .assign(buffers.positions.element(instanceIndex).add(velocity.mul(1 / 60)));
          velocity.assign(velocity.add(vec3(0, -1.2 / 60, 0)));
        })().compute(PARTICLE_COUNT),
    });
    replaceSprite(target, particles, scene);
    particles.attachRenderer(renderer);
    for (let i = 0; i < PARTICLE_STEPS; ++i) particles.process(renderer);
    await renderer.backend.device.queue.onSubmittedWorkDone();
  },
  async "fluid-particles"({ target, scene, renderer }) {
    if (renderer.backend.isWebGPUBackend !== true) throw new Error("fluid fixture needs WebGPU");
    // IRendererLike uses kind/compute/readback; Three's raw renderer does not implement kind.
    const attached = {
      kind: "webgpu",
      compute: (node) => renderer.compute(node),
      readback: (attribute) => renderer.getArrayBufferAsync(attribute),
    };
    const fluid = new FluidParticles3D({
      capacity: PARTICLE_COUNT,
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      voxelSize: 0.25,
    });
    particleMaterial(target.material);
    target.material.positionNode = fluid.positions.toAttribute().xyz;
    target.count = PARTICLE_COUNT;
    target.frustumCulled = false;
    scene.add(fluid);
    fluid.attachRenderer(attached);
    for (let i = 0; i < PARTICLE_COUNT; ++i) {
      if (
        !fluid.emit(
          [
            ((i % 3) - 1) * 0.1,
            ((Math.floor(i / 3) % 2) - 0.5) * 0.1,
            (Math.floor(i / 6) - 0.5) * 0.1,
          ],
          [0.1 + (i % 3) * 0.07, 0.25, -0.08 + Math.floor(i / 6) * 0.1],
        )
      )
        throw new Error("fluid fixture emission refused");
    }
    for (let i = 0; i < PARTICLE_STEPS; ++i) fluid.process();
    await renderer.backend.device.queue.onSubmittedWorkDone();
  },
  async "nodemat-color-uv"({ target }) {
    target.colorNode = vec4(uv(), uniform(0.35).setName("nodeTint"), 1);
  },
  /** MaterialX noise: 3D and 2D Perlin through mx_noise_float, 2D and 3D Worley cells. */
  async "materialx-noise"({ target }) {
    const perlin3 = mx_noise_float(positionWorld.mul(1.8)).mul(0.5).add(0.5);
    const perlin2 = mx_noise_float(uv().mul(6), 0.8, 0.1);
    const cells = mx_worley_noise_vec2(uv().mul(5), 0.9);
    const cells3 = mx_worley_noise_vec2(positionWorld.mul(2));
    target.colorNode = vec4(
      perlin3,
      perlin2.add(cells.x.mul(0.3)),
      cells.y.add(cells3.x).mul(0.4),
      1,
    );
  },
  async "pmrem-texture"({ target }) {
    target.colorNode = vec4(
      pmremTexture(equirectSky(), normalize(positionWorld), uv().x.mul(0.9)),
      1,
    );
  },
  async "nodemat-standard-nodes"({ target }) {
    target.roughnessNode = uv().x.mul(0.7).add(0.2);
    target.metalnessNode = uv().y.mul(0.8);
    target.emissiveNode = vec3(sin(uv().x.mul(8)).mul(0.15).add(0.15), 0, 0);
  },
  async "nodemat-normal-opacity"({ target }) {
    target.normalNode = normalize(
      normalViewGeometry.add(vec3(sin(uv().x.mul(10)).mul(0.35), 0, 0)),
    );
    target.opacityNode = uv().y.mul(0.6).add(0.2);
  },
  /**
   * PRD-513: a compute pass writes 10,000 instance positions on a 100 x 100 grid with a wave, and
   * the material's positionNode places each instance at its own entry.
   */
  async "storage-instances"({ target, renderer }) {
    const positions = instancedArray(GRID_COUNT, "vec4").setName("positions");
    const time = uniform(0.75);
    const kernel = Fn(() => {
      const row = instanceIndex.div(uint(100));
      const column = float(instanceIndex.sub(row.mul(uint(100))));
      positions
        .element(instanceIndex)
        .assign(vec4(column.mul(0.5), sin(column.mul(0.25).add(time)), float(row).mul(0.5), 1));
    })().compute(GRID_COUNT);
    await renderer.computeAsync(kernel);
    target.positionNode = positionLocal.add(positions.element(instanceIndex).xyz);
  },

  async "post-chromatic"({ renderer, scene, camera }) {
    const pipeline = chromatic(renderer, scene, camera);
    return { render: () => pipeline.render() };
  },

  /** The same pass, drawn once at 200 x 150 first: the captured frame is the one after a resize. */
  async "post-chromatic-resized"({ renderer, scene, camera, width, height }) {
    const pipeline = chromatic(renderer, scene, camera);
    renderer.setSize(200, 150, false);
    pipeline.render();
    await renderer.backend.device.queue.onSubmittedWorkDone();
    renderer.setSize(width, height, false);
    return { render: () => pipeline.render() };
  },

  /** PRD-512: a plane bent by a sine wave along its own z, which its shadow must follow. */
  async "wave-plane"({ target }) {
    target.positionNode = positionLocal.add(vec3(0, 0, sin(positionLocal.x.mul(2)).mul(0.4)));
  },
};
