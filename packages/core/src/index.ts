/**
 * The version this library reports.
 *
 * It read `0.1.0` while the package published `0.2.0`, and `__tests__/build.spec.ts` asserted the
 * stale literal, so the test held the bug in place rather than catching it. A literal is
 * unavoidable here — core is bundled for browsers and cannot read `package.json` at runtime — so
 * the spec now asserts this equals the manifest instead of asserting a number somebody typed.
 */
export const version = "0.3.0";

/**
 * Play a skinned or sprite animation from game code.
 *
 * A locomotion clip's playback rate is matched to the ground the body actually covers, so feet
 * do not skate or spin — on by default, `strideSync: false` to keep the authored rate, and
 * `player.stride` reports the measurement either way. Name the body a game moves as
 * `strideRoot` when the rig is a child of it. Clips authored **in place** — every ActorX and
 * Unreal export, every Mixamo "in place" clip, every stock animal pack — are matched too: their
 * stride is read off the ground a planted foot sweeps, and `stride.inPlace` says so.
 * @situation play an animation on a character
 * @situation switch a character between idle and attack clips
 * @situation stop a walking character's feet from sliding or spinning
 * @situation match a walk or run cycle to how fast a character is moving
 * @situation match an in-place walk cycle with no root motion to the body's speed
 * @situation find out what speed an animation clip was authored for
 * @constraint name the body a game moves as strideRoot when the animated rig is a child of it
 * @constraint a one-shot clip always plays at its authored rate; the matched rate re-times loops only
 * @constraint the matched rate is held inside 0.15x-3x; a speed outside what the clip's own stride supports is clamped, and `stride.rate` says so
 * @override strideSync controls whether the matched rate is applied while stride is still measured
 * @example const player = new AnimationPlayer({ clips, root: rig, strideRoot: body });
 */
export { AnimationPlayer } from "./animation.js";
export type {
  IAnimationPlayerOptions,
  IAnimationPlayOptions,
  IStrideReport,
} from "./animation.js";
/**
 * Face a game-owned object toward a perspective or orthographic camera.
 * @situation keep a world-space marker or nameplate facing the camera
 * @situation billboard a tree, label, or effect under a rotated parent
 * @constraint call update from the owning scene; no global scene scan is installed
 * @constraint orthographic cameras use their forward direction, and lockAxis restricts world rotation
 * @example const billboard = new Billboard3D(label, { camera });
 * billboard.update();
 */
export { Billboard3D } from "./billboard.js";
export type { BillboardLockAxis, IBillboard3DOptions } from "./billboard.js";
/**
 * Produce a game-authored camera shake offset for a template-owned camera rig.
 * @situation add a hit, explosion, or landing shake to a camera
 * @situation compose a transient camera offset after camera damping
 * @constraint amplitude, rotationAmplitude, frequency, decay, and curve are required game choices
 * @constraint update returns an offset and never writes to a camera
 * @example const shake = new CameraShake({ amplitude, rotationAmplitude, frequency, decay, curve });
 */
export { CameraShake } from "./camera-shake.js";
export type { CameraShakeCurve, ICameraShakeOffset, ICameraShakeOptions } from "./camera-shake.js";
/**
 * Create the portable asset loader a scene also receives as `ctx.assets`.
 * @situation preload models, textures, or audio before a scene enters
 * @situation load assets from a nonstandard base path or a compiled asset manifest
 * @constraint reuse the loader handed to scenes as `ctx.assets` instead of building parallel caches
 * @example const assets = createAssetLoader({ basePath: "/assets" });
 * const rock = await assets.texture("rock.png");
 */
export { createAssetLoader } from "./assets.js";
export type { IAssetLoader, IAssetLoaderOptions } from "./assets.js";
export type { IAudioBusOptions, IAudioPlayOptions } from "./audio.js";
/**
 * Route effects through a named audio bus.
 * @situation play a sound effect with a volume bus
 * @situation mute or adjust a category of game audio
 * @situation keep a gunshot audible at 20 metres by tuning positional falloff
 * @situation play cannon, wave, and ship sound effects
 * @constraint create buses before playing clips and dispose them with the game
 * @constraint refDistance and rolloffFactor tune positional falloff and apply to playAt only
 * @supersedes new Audio(
 * @example const effects = new AudioBus({ camera });
 */
export { AudioBus } from "./audio.js";
/**
 * Manage a camera or screen-facing canvas layer.
 * @situation place a HUD layer above the Three.js scene
 * @situation attach a canvas layer to a camera
 * @example const hud = new CanvasLayer(ctx.viewport);
 */
export { CanvasLayer } from "./canvas-layer.js";
export type {
  IThreeNativeBootSplash,
  IThreeNativeConfig,
  IThreeNativeIconVariants,
  IThreeNativeTexturesConfig,
  ThreeNativeBackgroundMode,
  ThreeNativeOrientation,
  ThreeNativeUiRenderer,
} from "./config.js";
/**
 * Create a deterministic random source for portable gameplay.
 * @situation seed enemy patrol choices
 * @situation reproduce the same procedural level in a playtest
 * @constraint use the returned source instead of Math.random for replayable behavior
 * @supersedes Math.random(
 * @example const random = createRandom(42);
 */
export { createRandom } from "./random.js";
export type { IRandom } from "./random.js";
/**
 * Define the portable game entry shared by web and native.
 * @situation start a ThreeNative game from src/game.ts
 * @situation register physics and gameplay plugins
 * @situation let the player zoom the camera with a wheel, pinch, or gamepad axis
 * @constraint keep DOM and React mounting in src/main.ts
 * @constraint bind scroll or pinch and read the intent with ctx.input.axis(name); do not add a window wheel listener
 * @constraint scroll: true uses the DOM wheel sign on browser and native: negative deltaY toward the user is positive intent
 * @example const game = defineGame({ input: { zoom: { scroll: true, pinch: true } }, scenes: { Play }, start: "Play" });
 */
export { defineGame } from "./game.js";
export {
  ATMOSPHERE_LUT_RESOLUTIONS,
  Atmosphere,
  AtmosphereLuts,
  LUT_RESOLUTIONS,
  directionFromSolarPosition,
  directionalTransmittance,
  resolveAtmosphereLutResolutions,
  resolveAtmosphereParameters,
  solarPosition,
  solarPositionAt,
  updateAtmosphereParameters,
  zenithTransmittance,
} from "./atmosphere/index.js";
export type {
  AtmosphereDirection,
  AtmosphereRgb,
  IAtmosphereLutResolution,
  IAtmosphereLutResolutions,
  IAtmosphereOptions,
  IAtmosphereParameterPatch,
  IAtmosphereParameters,
  IAtmosphereScenePass,
  IResolvedAtmosphereParameters,
  ISolarPosition,
  ISolarPositionInput,
} from "./atmosphere/index.js";
/**
 * Register game-owned IComputeDriven objects with the shared compute lifetime.
 * @situation use IComputeDriven for a cloth, fluid, boid, or other GPU simulation
 * @situation run a cloth or fluid simulation with ordered GPU passes
 * @situation keep IComputeDriven kernels warm before the first visible frame
 * @constraint add the object through ctx.add so it attaches, dispatches, and releases with its scene
 * @example const registry = new ComputeDrivenRegistry(); registry.add(cloth, ctx.renderer.raw);
 */
export { ComputeDrivenRegistry } from "./compute-driven.js";
export type { IComputeDriven } from "./compute-driven.js";
export { SoftBody3D } from "./softbody.js";
export type { ISoftBody3DOptions, ISoftBodyCollision } from "./softbody.js";
/**
 * Pack a selected static scene into TSL storage nodes for an upstream BVH ray query.
 * @situation trace thousands of scene rays inside a TSL kernel
 * @situation build a contact-occlusion or visibility query over loaded meshes
 * @constraint call rebuild() after a scene transform or geometry change; the snapshot is static by default
 * @constraint rebuild() is an explicit CPU SAH build proportional to selected triangles; process() is a no-op, and the game pays upstream traversal per shader ray
 * @example const bvh = ctx.add(new GPUSceneBVH(ctx.scene, { include: (object) => object.userData.traceable === true }));
 */
export { GPUSceneBVH, bvhIntersectFirstHit, rayStruct } from "./gpu-scene-bvh.js";
export type {
  GPUSceneBVHTraceFunction,
  IGPUSceneBVHMaterialGroup,
  IGPUSceneBVHOptions,
} from "./gpu-scene-bvh.js";
/**
 * Collapse many copies of one game-authored shape into a single draw, without counting them first.
 *
 * `new InstancedMesh(geometry, material, count)` needs the count before anything is placed, so a
 * procedural builder ends up walking its layout twice or over-allocating. Place as you go and
 * `build()` once; the shape, the surface and every transform stay the game's, and the built mesh
 * is returned so instances can still be animated by the index `place` and `span` hand back.
 * @situation draw hundreds of repeated props without hundreds of draw calls
 * @situation draw thousands of identical instanced blocks or obstacles in one mesh
 * @situation place repeated props when the count is not known until the layout has been walked
 * @situation build a chain, railing, cable, or tie rod out of point-to-point segments
 * @constraint geometry and material are required and come from the game; the batch chooses neither
 * @constraint span stretches along +Y, so its geometry must be unit-height and centred on the origin
 * @constraint placing after build() throws, and build() returns undefined when nothing was placed
 * @override castShadow and receiveShadow pass through to the built mesh and default to Three.js's own false
 * @example const curbs = new InstancedBatch({ geometry: new BoxGeometry(1, 1, 1), material });
 * curbs.place({ position: [x, 0.08, z], rotation: [0, angle, 0], scale: [length, 0.18, 0.42] });
 * curbs.build({ castShadow: true, name: "curbs", parent: ctx.scene });
 */
export { InstancedBatch } from "./instanced-batch.js";
export type {
  IInstancedBatchBuildOptions,
  IInstancedBatchOptions,
  IInstancedPlacement,
} from "./instanced-batch.js";
/**
 * Draw a model too detailed for the screen to resolve, without submitting the part it cannot.
 *
 * **This is on, and a game does not call it.** Any primitive of 65,536 triangles or more bakes to a
 * cluster DAG in the asset pipeline, the loader returns a `ClusteredMesh` for it, and the engine
 * takes the cut every frame before it renders. Each frame the mesh submits one draw holding only
 * the clusters whose error projects to fewer than `errorPixels` screen pixels; a mesh nothing has
 * cut yet draws in full, so the worst case is an ordinary `Mesh`. Geometry, surface and every
 * appearance parameter stay the game's.
 *
 * @situation draw a model too detailed for the screen to resolve
 * @situation import a scanned or sculpted mesh of millions of triangles and still hold the frame
 * @situation stop a dense rock face or terrain body from costing its full triangle count up close
 * @constraint the bake happens in the asset pipeline, never at run time — there is no runtime flag
 * @constraint the payload costs about 3-4x a baked primitive's bytes; `assets.models.virtual: "none"` opts out and `minSourceTriangles` moves the 65,536 line
 * @constraint needs a perspective camera; a screen-space error has no meaning without one
 * @constraint one shadow cut is chosen at load and does not follow a shadow camera
 * @override errorPixels sets the screen-space error budget, default 1 pixel
 * @override recutDistance sets how far the camera moves before the cut is retaken, default a thousandth of the mesh's radius
 * @example
 * // Nothing to call: the loader returns one of these and the engine cuts it every frame.
 * const face = await ctx.assets.model("quarry-face.glb");
 * ctx.scene.add(face.scene);
 */
export { ClusteredMesh } from "./clustered-mesh.js";
/**
 * Draw many copies of one over-detailed body, each at the detail its own distance earns.
 *
 * `InstancedBatch` collapses repeated props into one draw and gives every copy the same triangles.
 * This gives a copy two hundred metres away a coarser cut than one twelve metres away, and still
 * submits one draw per distance group rather than one per copy — which is what makes four hundred
 * scanned boulders affordable. The shape, the surface and every transform stay the game's.
 *
 * @situation draw hundreds of copies of a scanned or sculpted body without hundreds of draw calls
 * @situation stop distant copies of a dense prop from costing their full triangle count
 * @constraint the body's geometry must carry a cluster table from `assets.models.virtual`
 * @constraint every copy is placed before build(); place() after build() throws
 * @override distanceRatio sets how wide one distance group is, default 1.25
 * @override errorPixels sets the screen-space error budget, default 1 pixel
 * @example
 * const boulders = new ClusteredBatch({ geometry, material, table });
 * boulders.place({ position: [x, y, z], rotation: [0, angle, 0] });
 * boulders.build({ name: "boulders", parent: ctx.scene });
 * // in the scene's update, before the render:
 * boulders.update(ctx.camera, ctx.renderer.domElement.height);
 */
export { ClusteredBatch } from "./clustered-batch.js";
export type {
  IClusteredBatchBuildOptions,
  IClusteredBatchOptions,
  IClusteredPlacement,
} from "./clustered-batch.js";
/**
 * Take every clustered mesh under a root through this frame's cut, before the render.
 *
 * The engine already does this for the scene it renders; reach for it only to cut a subtree the
 * engine does not render, such as one staged for a camera of your own.
 *
 * @situation cut a virtual-geometry subtree the engine does not render itself
 * @example updateClusteredMeshes(stagedRoot, myCamera, ctx.renderer.domElement.height);
 */
export { updateClusteredMeshes } from "./clustered-mesh.js";
// `VirtualGeometryPlugin`, `selectClusterCut` and `pixelsPerUnit` are deliberately not exported: the
// loader registers the plugin itself, and the other two are the rule's internals — a game that had
// to call them would be re-implementing the cut rather than using it.
export type { IClusteredMeshOptions, IClusterTable } from "./clustered-mesh.js";
/**
 * Read where the frame's milliseconds went, per presented frame, on any platform.
 * @situation find out why a game runs slowly on a phone
 * @situation attribute a frame to present wait, simulation, three.js render, or overlay
 * @constraint on by default and printed as TN_FRAME_BUDGET; defineGame({ frameBudget: false }) silences the marker, not the measurement
 * @example defineGame({ frameBudget: { reportEvery: 120 }, scenes: { Play } });
 */
export {
  FRAME_BUDGET_MARKER,
  FRAME_BUDGET_PHASES,
  FRAME_HITCH_MARKER,
  FrameBudget,
} from "./frame-budget.js";
export type {
  FrameBudgetPhase,
  IFrameBudgetOptions,
  IFrameBudgetSummary,
  IFrameBudgetWindow,
  IFramePhaseSample,
} from "./frame-budget.js";
/**
 * Register work that reads a body or camera after physics has moved it and before this frame draws.
 * The engine owns the phase ordering; a callback cannot be misplaced by plugin-array order.
 * @situation read a body after physics has moved it
 * @situation place a camera or aim from the solved character transform
 * @constraint register from a scene context; callbacks are cleared when that scene exits
 * @example afterPhysics(ctx, (dt) => camera.position.copy(player.mesh.position));
 */
export { afterPhysics } from "./loop.js";
export type { AfterPhysicsCallback } from "./loop.js";
/**
 * Compose game-provided render nodes in a measured, fail-closed chain. Authored stages use an
 * opaque id and anchor before or after a built-in or another supplied stage; the engine does not
 * need to know the effect's visual vocabulary.
 * @situation compose screen-space effects in a canonical order
 * @situation insert a game-authored post stage into the measured render chain
 * @situation report which render tier and velocity route actually ran
 * @constraint stage factories own colour, strength, and all other appearance choices
 * @constraint authored stages declare exactly one before or after anchor
 * @example const chain = new RenderChain(renderer, { input: colour, stages, request: { stages: ["bloom"], tier: "auto" } });
 */
export {
  RENDER_CHAIN_MARKER,
  RENDER_CHAIN_STAGE_ORDER,
  RENDER_CHAIN_TIERS,
  RenderChain,
  readRenderChainObservation,
  readRenderChainReport,
} from "./render/chain.js";
export type {
  IRenderChainApplied,
  IRenderChainBudgetWindow,
  IRenderChainDroppedStage,
  IRenderChainOptions,
  IRenderChainRenderer,
  IRenderChainRequest,
  IRenderChainStage,
  IRenderChainStageContext,
  IRenderChainVelocityMeasurement,
  IRenderChainVelocityResult,
  IRenderChainVelocityReport,
  IRenderChainVelocityRequest,
  RenderChainSource,
  RenderChainStageId,
  RenderChainStageName,
  RenderChainTier,
  RenderChainTierRequest,
  RenderChainVelocitySource,
} from "./render/chain.js";
/**
 * Bake static diffuse irradiance that reaches surfaces from outside the camera view.
 * @situation light bouncing from a room I cannot see
 * @situation light a wall with an off-screen emitter
 * @constraint request a bake after static geometry and lights are authored; this is static-lighting-first, not fully dynamic relighting
 * @constraint add the volume with ctx.add() so its incremental work is measured in the render phase
 * @constraint call sample() or sampleNode() from a game-owned material before screen-space GI; the volume owns no light, material, or colour
 * @override density, bounds, bakeBudgetMs, and bounces are game-owned choices
 * @example const probes = new ProbeVolume({ bounds, density: 0.5 }); ctx.add(probes); void probes.requestBake(scene);
 */
export {
  ATLAS_PADDING,
  PROBE_VOLUME_MARKER,
  ProbeVolume,
  readProbeVolumeObservation,
} from "./render/probe-volume.js";
export type {
  IProbeVolumeBakeProgress,
  IProbeVolumeCoefficient,
  IProbeVolumeObservation,
  IProbeVolumeOptions,
  ProbeVolumeDensity,
} from "./render/probe-volume.js";
/**
 * Provision screen-space motion data for temporal nodes and keep per-instance history at the
 * frame boundary.
 * @situation keep a skinned character or instanced crowd stable in a temporal stage
 * @situation add the velocity output to a Three.js scene pass
 * @constraint call `VelocityTracker.update()` before the render and `commit()` after it
 * @constraint a pass is only given a velocity target when a temporal stage consumes it
 * @example
 * const scenePass = pass(scene, camera);
 * ensureVelocityOutput(scenePass);
 * renderer.setOutputNode(scenePass);
 * const tracker = new VelocityTracker();
 * tracker.update(scene);
 * renderer.render(scene, camera);
 * tracker.commit(scene);
 */
export {
  VELOCITY_OUTPUT_NAME,
  VELOCITY_PREVIOUS_BONE_MATRICES,
  VELOCITY_PREVIOUS_INSTANCE_MATRICES,
  VELOCITY_PREVIOUS_WORLD_MATRIX,
  VelocityTracker,
  ensureVelocityOutput,
  readVelocityPreviousBoneMatrices,
  readVelocityPreviousMatrices,
  readVelocityPreviousWorldMatrix,
  velocityTexture,
  withVelocityContext,
} from "./render/velocity.js";
export type { IVelocityRenderPass } from "./render/velocity.js";
/**
 * One directional shadow for a whole open world: camera-centred clip levels, each snapped to its
 * own texel grid and re-rendered only when its window moves. Tracked casters draw into a
 * per-level mover map every frame, so animated casters do not invalidate the cached levels after
 * the one refresh caused by tracking or untracking them.
 * Plugs into three's own `light.shadow.shadowNode` slot, so every material receives it.
 * @situation crisp shadows close to the player across a large outdoor level
 * @situation shadow map too coarse over a big terrain
 * @situation one directional light shadow for a whole open world
 * @situation shadows shimmer when the camera moves
 * @constraint the light must be a DirectionalLight with `castShadow` and a target in the scene
 * @constraint clipExtents are half-widths in world units, finest first, strictly increasing
 * @constraint call `trackCaster(object)` for movers; it enables layer `VIRTUAL_SHADOW_MOVER_LAYER` on the object and its descendants, tracking or untracking refreshes cached levels once, and subsequent mover movement refreshes only when a window moves
 * @override bias, biasNode, normalBias, intensity, radius, blurSamples, mapType and filterNode stay on `light.shadow`; mapSize and the other options here have defaults, and `marker: false` silences the TN_VIRTUAL_SHADOW line, not the measurement
 * @example
 * const sun = new DirectionalLight(0xffffff, 3);
 * sun.castShadow = true;
 * sun.shadow.shadowNode = new VirtualShadowNode(sun, { clipExtents: [12, 40, 120] });
 */
export {
  VIRTUAL_SHADOW_MARKER,
  VIRTUAL_SHADOW_MOVER_LAYER,
  VirtualShadowNode,
} from "./render/virtual-shadow.js";
export { readVirtualShadowMarker } from "./render/virtual-shadow.js";
export type { IVirtualShadowOptions, IVirtualShadowStats } from "./render/virtual-shadow.js";
/**
 * Attach hundreds of built objects to the scene in slices, presenting a frame between each.
 * @situation add hundreds of built objects to the scene without one multi-second frame
 * @situation stream a detail tier in behind a loading curtain without the page looking hung
 * @constraint the objects, and where each one goes, stay the game's; this decides only when each joins the graph
 * @constraint input order is the attach order and cannot be changed
 * @constraint a false `while` stops the run and is reported as `stopped`, never thrown
 * @override sliceSize defaults to 256; `marker: false` silences the TN_ADD_SLICES line, not the report
 * @example const report = await addInSlices(objects, (object) => ctx.add(object), {
 *   onProgress: ({ added, total }) => setProgress(added / total),
 *   while: () => generation.live,
 * });
 */
export { addInSlices } from "./streaming.js";
export type {
  IAddInSlicesOptions,
  IAddInSlicesProgress,
  IAddInSlicesReport,
} from "./streaming.js";
/**
 * Load a list with bounded concurrency, returning results in the input's order.
 * @situation load many models or textures in parallel instead of one at a time
 * @situation keep a loading screen moving while a list of assets downloads
 * @constraint results are written to each item's own index and never appended, so a positional lookup finds the same asset on every load
 * @constraint the first rejection rejects the call and no lane starts a load it had not begun
 * @override concurrency defaults to 6; `marker: false` silences the TN_LOAD_ALL line, not onProgress
 * @example const species = await loadAll(names, (name) => ctx.assets.model(`flora/${name}.glb`));
 */
export { loadAll } from "./streaming.js";
export type { ILoadAllOptions, ILoadAllProgress } from "./streaming.js";
export { warmUpScene } from "./warmup.js";
export type {
  IWarmUpOptions,
  IWarmUpProgress,
  IWarmUpRenderer,
  IWarmUpReport,
} from "./warmup.js";
export type {
  IGame,
  IGameObservationContribution,
  IGameObservationSampleRequest,
  IGamePluginHooks,
  IGamePluginRuntime,
  IGamePlatformSource,
} from "./game.js";
/**
 * Simulate a spectral ocean — cascaded wave spectra inverse-transformed on the GPU each frame.
 * @situation make an ocean whose surface is the view rather than a background
 * @situation float a boat on waves the GPU is drawing
 * @situation drive a water material from a wave simulation without writing an FFT
 * @situation sail a ship on simulated ocean waves with buoyancy
 * @constraint it draws nothing; the game supplies the mesh, the material and every colour
 * @constraint CPU height is a throttled copy carrying staleFrames, never this frame and never exact
 * @constraint an exact free CPU height needs an analytic wave field instead; that is a different contract
 * @constraint cascades are ordered largest patchSize first and every tuning number is required
 * @example const sea = ctx.add(new SpectralOcean(oceanOptions));
 */
export { SpectralOcean } from "./ocean/spectral.js";
export type {
  ISpectralOceanCascade,
  ISpectralOceanHeight,
  ISpectralOceanOptions,
} from "./ocean/spectral.js";
/**
 * Copy a GPU buffer back to the CPU on a throttle, and report how old each sample is.
 * @situation read a GPU simulation on the CPU without stalling the frame
 * @situation float a body on a wave field whose height only exists on the GPU
 * @situation count GPU-side survivors for a diagnostic without blocking drawing
 * @situation keep a ship floating on simulated ocean waves
 * @constraint the copy is asynchronous, so every sample carries staleFrames and is never this frame
 * @constraint WebGPU only; the seam throws on a WebGL2 renderer rather than returning nothing
 * @constraint one copy is in flight at a time and requests made during one are dropped, not queued
 * @example const heights = new GPUReadback({ attribute: field.value, everyFrames: 4 });
 */
export { GPUReadback } from "./gpu-readback.js";
export type { IGPUReadbackOptions, IGPUReadbackSample } from "./gpu-readback.js";
/**
 * Dispatch a game-owned particle surface and process function through a pooled system.
 * @situation emit sparks, smoke, or other transient effects
 * @situation update many small visual particles
 * @situation trail dust, exhaust, or spray behind a moving object
 * @situation emit cannon smoke and muzzle flash particles
 * @situation fire a cannonball projectile with cannon smoke particles
 * @constraint geometry, color, and timing remain supplied by the game
 * @example const particles = new GPUParticles3D(particleOptions);
 */
export { GPUParticles3D } from "./particles.js";
/**
 * Simulate a deterministic 2D velocity-and-dye field on the GPU while exposing its data to game-owned rendering.
 * @situation simulate smoke, fire, fog, wind, or fluid response on a grid
 * @situation inject a touch, pointer, or gameplay impulse into a fluid field
 * @situation sample fluid dye or velocity in a game-owned render node
 * @situation simulate ocean currents and wind affecting a sailing ship
 * @situation simulate ocean fluid dynamics and currents that affect a ship
 * @constraint add the field through `ctx.add` so renderer attachment, fixed-step dispatch, and release are automatic
 * @constraint `dye` and `velocity` are numeric samplers; appearance stays in the game's `src/render/` code
 * @constraint the conformance sample measures mean absolute velocity divergence at 0.001732 after four 32² steps with pressureIterations 2, below the 0.0025 threshold
 * @override pressureIterations, viscosity, vorticity, and splatRadius tune the solver without changing its pass order
 * @example const field = new FluidField2D({ resolution: 256, pressureIterations: 20 });
 * ctx.add(field);
 * field.splat({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0 }, 1);
 */
export { FluidField2D } from "./fluid-field.js";
export type { IFluidFieldOptions, IFluidFieldSampler, IFluidFieldVector2 } from "./fluid-field.js";
/**
 * Evaluate analytic waves on CPU and displace game-owned vertices with the matching TSL graph.
 * @situation float a boat on waves
 * @situation make water move
 * @situation find the water surface height at a point
 * @constraint supply every wave amplitude, wavelength, direction, speed and warp value
 * @constraint call setTime for the default graph clock when the game advances its own time
 * @example const field = new WaveField({ waves });
 * const { height, normal } = field.sample(x, z, elapsed);
 */
export { WaveField } from "./wave-field.js";
export type {
  IWaveFieldDomainWarp,
  IWaveFieldGraphOptions,
  IWaveFieldOptions,
  IWaveFieldSample,
  IWaveFieldWave,
  WaveDirection,
} from "./wave-field.js";
/**
 * Give a horizontal water surface the world mirrored in it, the world beneath it, and the metres
 * of water between them.
 * @situation reflect the sky and the shoreline in a lake, pond or river
 * @situation see the bed through the water and have the shallows fade at the shore
 * @situation know how deep the water is under a pixel without a second render pass
 * @situation stop a water surface repeating in visible bands or stripes
 * @constraint it draws nothing; the game supplies the mesh, the material and every colour
 * @constraint the material must be transparent so the frame beneath it is already drawn
 * @constraint thickness is metres, saturating at maxThickness; sky behind the surface reads deep
 * @constraint one reflection is a second draw of the world, so resolutionScale is the whole cost
 * @constraint the mirror plane is level, from level alone; do not parent target to a scaled mesh
 * @example const surface = new WaterSurface3D({ level: 0, maxThickness: 3, reflection: { resolutionScale: 0.5 } });
 * material.colorNode = mix(surface.refractionAt(offset), surface.reflectionAt(offset), fresnel);
 */
export { WaterSurface3D } from "./water-surface.js";
export type { IWaterReflectionOptions, IWaterSurfaceOptions } from "./water-surface.js";
/**
 * Build a soft round sprite as pixel data instead of painting a canvas.
 * @situation give smoke, flash, or glow sprites a radial alpha falloff
 * @situation generate sprite images that render identically under every backend
 * @constraint canvas-painted images sample black under WebGPURenderer; write sprites as pixel data there
 * @example const puff = softCircleDataTexture(64, 0.25);
 */
export { softCircleDataTexture } from "./textures.js";
/**
 * Pool travelling bullet-streak meshes for hitscan shots.
 * @situation show where a hitscan round went
 * @situation draw incoming fire without spawning projectiles
 * @constraint the surface comes from the game; pooling, travel, and fading belong to the engine
 * @constraint update once per frame and dispose with the owning scene
 * @example const tracers = new TracerPool3D(ctx.scene, tracerOptions);
 * tracers.spawn(muzzle, shotDirection, hit.distance);
 */
export { TracerPool3D } from "./tracers.js";
export type { ITracerPool3DOptions, ITracerSpawnOptions } from "./tracers.js";
/**
 * Move an object along a Three.js curve with Godot-style path following.
 * @situation move an enemy or prop along a patrol path
 * @situation sample a racing line from a curve
 * @example const follower = new PathFollow3D({ points: patrolPoints, loop: true, speed: 3 });
 */
export { PathFollow3D } from "./path-follow.js";
/**
 * Keep a rendered model's feet on a surface while preserving an auditable override.
 * @situation keep a character's feet on the floor
 * @situation correct visual grounding after an animation update
 * @constraint import from `@threenative/core`; this moves the rendered model, not its physics collider
 * @override enabled controls whether correction is applied while clearance is still measured
 * @example import { GroundSnap } from "@threenative/core";
 * const snap = new GroundSnap(character, { enabled: true });
 */
export { GroundSnap } from "./grounding.js";
export type { IGroundSnapOptions } from "./grounding.js";
/**
 * Measure a Three.js pose for grounded or attachment-aware checks.
 * @situation inspect a skinned model's posed bounds
 * @situation verify a character's visual pose
 * @constraint precise per-vertex measurement is opt-in and not for frame loops
 * @example const measurement = measureThreePose(model);
 */
export { measureThreePose, posedBounds } from "./pose-measure.js";
export type {
  IMeasureThreePoseOptions,
  IThreePoseBounds,
  IThreePoseMeasurement,
  ThreePoseQuaternion,
  ThreePoseVector,
} from "./pose-measure.js";
export type {
  IPathFollow3DOptions,
  IPathFollow3DProjection,
  IPathFollow3DSample,
} from "./path-follow.js";
/**
 * Dispatch portable pointer events from the game surface to registered Three.js objects.
 * @situation let the player click on a thing in the world
 * @situation show a 3D object while a pointer hovers over it
 * @situation handle touch and mouse taps on a loaded model without naming its child meshes
 * @situation drag a crate or prop with the mouse or a finger
 * @constraint listeners are side-table registrations; Three.js prototypes are never patched
 * @constraint one raycast serves each active pointer and no raycast runs when nothing is registered
 * @example ctx.pointer.on(tile, "tapped", (event) => place(event.point));
 */
export { PointerEvents3D } from "./pointer-events.js";
export type {
  IPointerDragHandle,
  IPointerEvent3D,
  IPointerEvents3D,
  IPointerEvents3DOptions,
  IPointerEvents3DPicker,
  IPointerState,
  PointerEvent3DListener,
  PointerEvent3DType,
} from "./pointer-events.js";
/**
 * Read the host platform without reaching for browser globals.
 * @situation branch a portable game on web or native
 * @situation choose touch controls for a mobile device
 * @situation can I raytrace on native
 * @constraint only use the returned platform facts; native globals are host-owned
 * @constraint ray tracing is unavailable on native until buffer-to-texture copy-out interop exists; `mystralRT.traceRays` refuses instead of resolving success without a readable result
 * @example if (isMobile()) showTouchControls();
 */
export { getPlatform, isMobile, isNative, isTouchscreenAvailable, isWeb } from "./platform.js";
export type {
  IPlatformInfo,
  PlatformFormFactor,
  PlatformOS,
  PlatformRuntime,
} from "./platform.js";
/**
 * Raycast the game scene using the framework's picker.
 * @situation select an object under the pointer
 * @situation interact with the first collider or mesh hit
 * @supersedes new Raycaster(
 * @example const picker = new ScenePicker({ camera: ctx.camera, scene: ctx.scene, pointer: () => ctx.input.raw.pointer, viewport: ctx.viewport });
 */
export { ScenePicker } from "./picking.js";
export type { IRaycastOptions, IScenePickerOptions } from "./picking.js";
/**
 * Record or replay deterministic game input and state.
 * @situation reproduce a gameplay bug from recorded input
 * @situation run a deterministic replay in a playtest
 * @constraint use a seeded random source and fixed-step simulation for meaningful replays
 * @example const driver = createReplayDriver(recording, ctx.renderer.domElement);
 */
export { createReplayDriver, replay } from "./replay.js";
export type { IReplayOptions, Recording } from "./replay.js";
/**
 * Validate and parse a replay recording file.
 * @situation validate a recording before replaying it in another host
 * @constraint recordings are version 1; the parser fails closed with TN_REPLAY_* codes
 * @example const recording = parseReplayRecording(rawRecording);
 */
export { parseReplayRecording } from "./replay-protocol.js";
export type {
  IReplayRecording,
  IReplayRecordingSample,
  ReplayPointer,
} from "./replay-protocol.js";
/**
 * Schedule delayed and repeating callbacks or tween numeric properties with game-owned cleanup.
 * @situation delay an enemy patrol transition
 * @situation run a callback every simulation tick
 * @situation tween a numeric property with a game-owned curve
 * @constraint dispose returned handles when the owning scene exits
 * @constraint ease receives progress in the range 0 to 1 and its return value is the interpolation factor
 * @example const door = { y: 0 };
 * await ctx.tween(door, { y: 2.4 }, 0.5, { ease: (t) => 1 - (1 - t) ** 3 });
 */
export { Scheduler } from "./schedule.js";
export type { ITweenOptions, ScheduleHandle } from "./schedule.js";
/**
 * Implement a portable Godot-shaped game scene lifecycle.
 * @situation add a playable level or menu scene
 * @situation move scene setup and per-frame gameplay out of the entry point
 * @constraint scene code must stay portable across web and native
 * @example class Play extends Scene { update(ctx, dt) {} }
 */
export { Scene } from "./scene.js";
export type { ICtx, SceneFrame } from "./scene.js";
/**
 * Advance a game-owned non-uniform sprite atlas on the fixed step.
 * @situation play an animated pickup or sprite-sheet effect
 * @situation sequence atlas frames with different authored durations
 * @constraint the game supplies the atlas texture, surface, filtering, layout, and every frame duration
 * @constraint update is driven by the scene fixed step; no wall clock or default frame rate is used
 * @example const animator = new SpriteAnimator3D({ texture: atlas, frames, mode: "pingPong" });
 */
export { SpriteAnimator3D } from "./sprite-animator.js";
export type {
  ISpriteAnimator3DOptions,
  ISpriteFrame3D,
  SpritePlaybackMode,
} from "./sprite-animator.js";
/**
 * Keep transient render surfaces in the renderer's pipeline cache before first use.
 * @situation prewarm a projectile, tracer, particle, or other transient effect
 * @situation avoid a long first-use frame for a newly visible effect
 * @constraint keep the surface visible with zero opacity; do not hide it with `visible = false`
 * @supersedes .visible = false
 * @example prewarm(tracerPool);
 */
export { prewarm } from "./renderer.js";
/**
 * Scale an asset to a real-world measurement and return the applied factor.
 * @situation make a character exactly 1.8 metres tall
 * @situation normalize a prop or weapon to a known longest axis
 * @constraint skinned height uses a crown bone; game-specific asset expectations stay in render code
 * @supersedes new Box3().setFromObject(
 * @example normaliseToMetres(character, { metres: 1.8, axis: "height" });
 */
export { normaliseToMetres } from "./scale.js";
export type { INormaliseToMetresOptions, NormaliseAxis } from "./scale.js";
/**
 * Repair an exported rig whose animation clips are z-mirrored against its own bind pose.
 * @situation find out why a skinned character renders deformed
 * @situation repair an imported character that walks backwards with its spine folded
 * @situation load a rigged GLB through a custom loader and keep the framework's repair
 * @constraint the model loader already applies this automatically; only a game loading GLBs around it needs the call
 * @constraint detection votes per tracked bone and converts only on an overwhelming signature; a file that does not carry it is left byte-identical
 * @example import { reconcileMirroredClips } from "@threenative/core";
 * if (reconcileMirroredClips(gltf.scene, gltf.animations)) console.info("clips were z-mirrored; repaired");
 */
export { reconcileMirroredClips } from "./assets.js";
/**
 * Attach a game-owned object to a named skeleton bone.
 * @situation put a weapon in a character's hand
 * @situation hold a rifle in a character's right hand
 * @situation add an enemy that patrols the level, chases the player when it sees them, and holds a rifle in its right hand
 * @situation attach an accessory to a skinned model
 * @situation equip crew with swords and pistols
 * @situation put a sword or pistol in a crew member's hand
 * @constraint when a request is to hold or attach a weapon to a hand, import and call `attachToBone` from `@threenative/core`; do not manually parent, position, or rotate the rifle
 * @constraint if a stock visual has no skeleton, add a portable Three.js Bone named `RightHand` under the character, then call `attachToBone`; do not replace the helper with manual parenting
 * @example import { attachToBone } from "@threenative/core";
 * attachToBone(character, "RightHand", rifle);
 */
export { attachToBone } from "./skeleton.js";
/**
 * List the names of every bone in a character hierarchy.
 * @situation inspect the available bones before attaching a game-owned object
 * @situation debug a missing skeleton bone name
 * @example import { skeletonBones } from "@threenative/core";
 * const bones = skeletonBones(character);
 */
export { skeletonBones } from "./skeleton.js";
/**
 * Measure whether a named bone reaches the object it is supposed to be touching, in metres.
 * @situation check that a seated character's hands reach the keyboard
 * @situation check that a character's hips meet the chair it is sitting on
 * @situation turn "the character is not touching the prop" into a number a scenario can assert
 * @constraint this walks the target's vertices; call it on a check or a debug sample, not every frame
 * @example import { boneContact } from "@threenative/core";
 * const contact = boneContact(worker, "hand_r", keyboard);
 */
export { boneContact } from "./skeleton.js";
export type { IBoneContactReport } from "./skeleton.js";
/**
 * Score a retargeted clip against the source it came from, per bone, in degrees.
 * @situation find out why a retargeted animation looks wrong on a character
 * @situation tell a fixed retarget from one that merely moved
 * @situation catch a retarget that rolled every limb about its own axis
 * @constraint each bone is compared as a whole quaternion relative to its own rig's bind pose, so the two rigs never have to share a bind convention; a bone-direction check reports zero on the roll this catches
 * @constraint both rigs must face the same way in world space, and both are driven and then restored to the transforms they arrived with
 * @override bones maps one rig's bone names onto the other's when they differ; samples sets how many poses are compared
 * @example import { clipPoseError } from "@threenative/core";
 * const report = clipPoseError({ root: rig, clip: retargeted }, { root: source, clip: original });
 */
export { clipPoseError } from "./clip-audit.js";
/**
 * Report which of a clip's tracks bind to nothing on a character.
 * @situation find out why a character plays its bind pose instead of the animation
 * @situation check that a loaded clip actually drives the model it was written for
 * @constraint the reason is Three.js's own, captured off its console hook so a scenario's console assertions stay clean
 * @example import { clipTrackBindings } from "@threenative/core";
 * const bindings = clipTrackBindings(character, clip);
 */
export { clipTrackBindings } from "./clip-audit.js";
/**
 * Report which bones of a character a clip does not drive.
 * @situation find out why a character keeps the previous animation's hand shape
 * @situation check how much of a rig a clip covers before shipping it
 * @constraint a track that binds nothing counts as driving nothing
 * @example import { clipBoneCoverage } from "@threenative/core";
 * const coverage = clipBoneCoverage(character, clip);
 */
export { clipBoneCoverage } from "./clip-audit.js";
export type {
  IBonePoseError,
  IClipBindingReport,
  IClipCoverageReport,
  IClipPoseErrorOptions,
  IClipPoseErrorReport,
  IClipPoseSubject,
  IClipTrackBinding,
} from "./clip-audit.js";
/**
 * Measure a rig's parent→child bone distances, in world space, as it stands right now.
 * @situation capture a rig's bind-pose bone lengths before any clip plays
 * @situation measure a skeleton for the bone-length invariance check
 * @constraint the baseline and the later comparison must come from the same rig under the same ancestor transform, so a uniform scale cancels
 * @example import { boneLengths } from "@threenative/core";
 * const baseline = boneLengths(character);
 */
export { boneLengths } from "./bone-lengths.js";
/**
 * Compare a rig's bone distances now against a captured snapshot and name every bone that moved.
 * @situation find out why a skinned character renders deformed
 * @situation check that an animated pose keeps the skeleton rigid
 * @situation name the bone that breaks a posed skeleton without taking a screenshot
 * @constraint a rigid skeleton preserves every parent→child distance under any pose; a named bone is a defect with an address
 * @constraint this is a diagnostic — it reports numbers and names; it moves nothing and decides no appearance
 * @example import { boneLengths, boneLengthDeviations } from "@threenative/core";
 * const report = boneLengthDeviations(character, boneLengths(character));
 * if (!report.rigid && report.worst !== null) console.log(report.worst.bone, report.worst.ratio);
 */
export { boneLengthDeviations } from "./bone-lengths.js";
export type {
  IBoneLengthDeviation,
  IBoneLengthDeviationReport,
  IBoneLengthDeviationsOptions,
  IBoneLengthSnapshot,
} from "./bone-lengths.js";
export type {
  ContextMenuPolicy,
  IInputAction,
  IInputGamepad,
  InputBindings,
  InputPlatformSource,
  IRawInputPointer,
  IRawInputPointerEdge,
  IRawInputState,
} from "./input.js";
