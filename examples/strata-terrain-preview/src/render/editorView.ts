import { type ICtx, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import {
  type ITerrainState,
  applyPlacementOverrides,
  bakeMesh,
  sampleHeight,
} from "@threenative/terrain";
import {
  type IEditorView,
  type IFocusBounds,
  type IFocusOutcome,
  type IFocusRequest,
  type ISavedCamera,
  type IViewCamera,
  type IViewerPose,
  type TerrainEditorController,
  focusCamera,
} from "@threenative/terrain/editor";
import type { IAuthoringDocument } from "@threenative/terrain/editor/server";
import {
  type IWorldGLBExport,
  type IWorldGLBInput,
  exportWorldGLB,
} from "@threenative/terrain/export";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
  Vector2,
  Vector3,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { landformPose } from "./landforms.js";
import { createOcean, createWaterMesh } from "./ocean.js";
import { terrainPalette } from "./palette.js";
import { createPropSurfaces } from "./propMaterials.js";
import {
  type PropGroundQuery,
  buildPropVariants,
  createProps,
  preparePropTransform,
  readPropTransform,
  writePropTransform,
} from "./props.js";
import { createPropSelection } from "./selection.js";
import { createTerrain } from "./terrain.js";

/** A landmark frames the ground it sits on, not the height of a building. */
const LANDMARK_RADIUS = 0.5;

const initialState = {
  renderedRevision: "",
  renderedCount: 0,
  renderedFrames: 0,
  vertexCount: 0,
  heightSum: 0,
  evaluationMs: 0,
  propCount: 0,
  propTriangles: 0,
};
type EditorState = typeof initialState;

export async function createEditorView(
  host: HTMLElement,
  controller: TerrainEditorController,
): Promise<
  IEditorView & {
    noteRevision(revision: string, ms: number): void;
    inspect(): EditorState;
    inspectProps(): {
      id: string;
      transform: ReturnType<typeof readPropTransform>;
      clearance: number | null;
    }[];
    inspectSelection(): ReturnType<ReturnType<typeof createPropSelection>["inspect"]>;
    projectPlacement(id: string): [number, number] | undefined;
    inspectHandles(): ReturnType<ReturnType<typeof createPropSelection>["handles"]>;
    exportCurrentWorld(
      material: MeshStandardMaterial,
      water?: IWorldGLBInput["water"],
    ): Promise<IWorldGLBExport>;
  }
> {
  let ctx!: ICtx<EditorState>;
  let controls!: OrbitControls;
  let mesh: Mesh<BufferGeometry, MeshStandardMaterial> | undefined;
  let terrain: ITerrainState | undefined;
  let sea: ReturnType<typeof createOcean> | undefined;
  let water: Mesh | undefined;
  let props: ReturnType<typeof createProps> | undefined;
  // The loop's settling frame can tick before the surfaces exist; the view answers when it can.
  // biome-ignore lint/style/useConst: the settling frame reads this before the line that assigns it.
  let propSurfaces: Awaited<ReturnType<typeof createPropSurfaces>> | undefined;
  let authoring: IAuthoringDocument | undefined;
  let renderedRecipe: string | undefined;
  let groundAt: PropGroundQuery | undefined;
  let elapsed = 0;
  let first = true;
  let mode = "lit";
  let requestedRevision = "";
  let evaluationMs = 0;
  let seen = "";
  // Live observation-camera state. The engine owns one PerspectiveCamera, so an orthographic
  // bookmark is written into it as an orthographic projection matrix each frame.
  let cameraSignature = "";
  let activeCamera: string | null = null;
  let orthographic = false;
  let orthoExtent = 0;
  let orthoZoom = 1;
  const brush = new Line(
    new BufferGeometry().setFromPoints(
      Array.from(
        { length: 65 },
        (_, i) =>
          new Vector3(Math.cos((i / 64) * Math.PI * 2), 0, Math.sin((i / 64) * Math.PI * 2)),
      ),
    ),
    new LineBasicMaterial({ color: 0xe1f4bb, depthTest: false }),
  );
  brush.visible = false; // engine-override: this target-dependent Line is not a mesh handled by prewarm.
  const spline = new Line(
    new BufferGeometry(),
    new LineBasicMaterial({ color: 0xd9efb9, depthTest: false }),
  );
  function clearWater(): void {
    if (!water) return;
    ctx.scene.remove(water);
    water.geometry.dispose();
    const materials = Array.isArray(water.material) ? water.material : [water.material];
    for (const material of materials) material.dispose();
    water = undefined;
  }
  function readPose(): IViewerPose {
    // The engine camera is configured perspective at start; its planes are the live ones.
    const live = ctx.camera as PerspectiveCamera;
    return {
      position: ctx.camera.position.toArray() as [number, number, number],
      target: controls.target.toArray() as [number, number, number],
      up: ctx.camera.up.toArray() as [number, number, number],
      projection: orthographic ? "orthographic" : "perspective",
      fov: orthographic ? null : (ctx.camera as PerspectiveCamera).fov,
      extent: orthographic ? orthoExtent : null,
      zoom: orthographic ? orthoZoom : null,
      near: live.near,
      far: live.far,
      aspect: ctx.viewport.size.aspect,
      activeCamera,
    };
  }
  function applySaved(next: ISavedCamera | null): void {
    if (!next) {
      // The ordinary editor camera is not a bookmark: framing the terrain is what it does.
      orthographic = false;
      frame();
      return;
    }
    controls.target.fromArray(next.target);
    ctx.camera.position.fromArray(next.position);
    ctx.camera.up.fromArray(next.up);
    const live = ctx.camera as PerspectiveCamera;
    live.near = next.near;
    live.far = next.far;
    if (next.projection === "orthographic") {
      orthographic = true;
      orthoExtent = next.extent;
      orthoZoom = next.zoom;
    } else {
      orthographic = false;
      live.fov = next.fov;
      live.updateProjectionMatrix();
    }
    controls.update();
  }
  /** The real world bounds of one prop placement, never of the batch that shares its mesh. */
  function propBounds(id: string): IFocusBounds | undefined {
    const instance = props?.byId.get(id);
    if (!instance) return undefined;
    const box = new Box3();
    const world = new Matrix4();
    for (const part of instance.parts) {
      part.mesh.updateWorldMatrix(true, false);
      part.mesh.geometry.computeBoundingBox();
      const local = part.mesh.geometry.boundingBox;
      if (!local) continue;
      // One instance matrix, so a nonuniformly scaled prop frames its own geometry.
      world.multiplyMatrices(
        part.mesh.matrixWorld,
        new Matrix4().fromArray(part.mesh.instanceMatrix.array, part.index * 16),
      );
      box.union(local.clone().applyMatrix4(world));
    }
    return box.isEmpty()
      ? undefined
      : {
          min: box.min.toArray() as [number, number, number],
          max: box.max.toArray() as [number, number, number],
        };
  }
  /** A registered landmark is a saved spatial control point; its elevation comes from the terrain
   * already in memory, never from a fresh evaluation. */
  function landmarkBounds(id: string): IFocusBounds | undefined {
    const control = (authoring?.references ?? [])
      .flatMap((reference) => reference.controls)
      .find((entry) => entry.id === id);
    if (!control || !terrain) return undefined;
    const [x, z] = control.world;
    const y = sampleHeight(terrain, x, z);
    return {
      min: [x - LANDMARK_RADIUS, y - LANDMARK_RADIUS, z - LANDMARK_RADIUS],
      max: [x + LANDMARK_RADIUS, y + LANDMARK_RADIUS, z + LANDMARK_RADIUS],
    };
  }
  /** A region is the whole evaluated extent, the placements of one layer, or a landform footprint. */
  function regionBounds(id: string): IFocusBounds | undefined {
    if (!terrain) return undefined;
    if (id !== "terrain") {
      const placed = [...(props?.byId.values() ?? [])].filter(
        (instance) => instance.placement.layer === id,
      );
      if (!placed.length) {
        const layer = authoring?.recipe.layers.find((entry) => entry.id === id);
        const pose = layer ? landformPose(layer, terrain.size) : undefined;
        if (!pose) return undefined;
        const size = new Vector3(...pose.scale);
        const centre = new Vector3(...pose.position);
        return {
          min: centre.clone().sub(size).toArray() as [number, number, number],
          max: centre.clone().add(size).toArray() as [number, number, number],
        };
      }
      const box = new Box3();
      for (const instance of placed) {
        const bounds = propBounds(instance.placement.id);
        if (bounds) box.union(new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max)));
      }
      return box.isEmpty()
        ? undefined
        : {
            min: box.min.toArray() as [number, number, number],
            max: box.max.toArray() as [number, number, number],
          };
    }
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const height of terrain.height) {
      low = Math.min(low, height);
      high = Math.max(high, height);
    }
    if (!Number.isFinite(low)) return undefined;
    const half = terrain.size / 2;
    return { min: [-half, low, -half], max: [half, high, half] };
  }
  function resolveTarget(target: {
    kind: "prop" | "landmark" | "region";
    id: string;
  }): IFocusBounds | undefined {
    if (target.kind === "prop") return propBounds(target.id);
    if (target.kind === "landmark") return landmarkBounds(target.id);
    return regionBounds(target.id);
  }
  function measure(bounds: IFocusBounds): { x: number; y: number; z: boolean } {
    ctx.camera.updateMatrixWorld(true);
    const box = new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max));
    let x = 0;
    let y = 0;
    let inside = true;
    for (let index = 0; index < 8; index++) {
      const corner = new Vector3(
        box.min.x + (index & 1 ? box.max.x - box.min.x : 0),
        box.min.y + ((index >> 1) & 1 ? box.max.y - box.min.y : 0),
        box.min.z + ((index >> 2) & 1 ? box.max.z - box.min.z : 0),
      );
      const clip = corner.project(ctx.camera);
      x = Math.max(x, Math.abs(clip.x));
      y = Math.max(y, Math.abs(clip.y));
      inside &&= clip.z > -1 && clip.z < 1;
    }
    return { x, y, z: inside };
  }
  const cameras: IViewCamera = {
    read: readPose,
    apply: applySaved,
    resolve: resolveTarget,
    measure,
    focus(request: Omit<IFocusRequest, "aspect">): IFocusOutcome {
      const pose = readPose();
      const current: ISavedCamera =
        pose.projection === "orthographic"
          ? {
              id: pose.activeCamera ?? "viewer",
              name: "Viewer",
              position: pose.position,
              target: pose.target,
              up: pose.up,
              near: pose.near,
              far: pose.far,
              projection: "orthographic",
              extent: pose.extent ?? 1,
              zoom: pose.zoom ?? 1,
            }
          : {
              id: pose.activeCamera ?? "viewer",
              name: "Viewer",
              position: pose.position,
              target: pose.target,
              up: pose.up,
              near: pose.near,
              far: pose.far,
              projection: "perspective",
              fov: pose.fov ?? 60,
            };
      const outcome = focusCamera(
        current,
        {
          ...request,
          aspect: ctx.viewport.size.aspect,
          direction: [
            pose.position[0] - pose.target[0],
            pose.position[1] - pose.target[1],
            pose.position[2] - pose.target[2],
          ],
        },
        resolveTarget,
      );
      // A failed focus keeps the last valid camera; only a real framing moves the view.
      if (outcome.camera) applySaved(outcome.camera);
      return outcome;
    },
  };
  function frame(): void {
    if (!mesh) return;
    mesh.geometry.computeBoundingSphere();
    const sphere = mesh.geometry.boundingSphere;
    if (!sphere) throw new Error("Terrain bounds unavailable");
    controls.target.copy(sphere.center);
    const distance =
      (sphere.radius / Math.sin(((ctx.camera as PerspectiveCamera).fov * Math.PI) / 360)) * 1.15;
    ctx.camera.position
      .copy(sphere.center)
      .add(new Vector3(0.7, 0.65, 1).normalize().multiplyScalar(distance));
    ctx.camera.up.set(0, 1, 0);
    controls.update();
  }
  class EditorScene extends Scene<EditorState> {
    static override readonly initialState = initialState;
    override enter(context: ICtx<EditorState>): void {
      ctx = context;
      ctx.add(ctx.camera);
      ctx.scene.background = new Color(0x9dc2d2);
      ctx.scene.fog = new FogExp2(0x9dc2d2, 0.0008);
      ctx.add(new HemisphereLight(0xd6e9ef, 0x403c2e, 1.2));
      const sun = ctx.add(new DirectionalLight(0xffedd4, 2.8));
      sun.position.set(-180, 240, 120);
      ctx.add(brush);
      ctx.add(spline);
      ctx.renderer.domElement.classList.add("render-canvas");
      controls = new OrbitControls(ctx.camera, ctx.renderer.domElement);
      controls.enableDamping = true;
      controls.enableRotate = true;
      controls.mouseButtons.LEFT = null; // Left drag authors terrain; right drag navigates.
      ctx.beforeRender(() => {
        if (!mesh) return;
        ctx.state.set({
          propCount: props?.meshes.reduce((count, prop) => count + prop.count, 0) ?? 0,
          propTriangles:
            props?.meshes.reduce(
              (count, prop) =>
                count +
                (prop.count *
                  (prop.geometry.index?.count ?? prop.geometry.getAttribute("position").count)) /
                  3,
              0,
            ) ?? 0,
        });
        ctx.state.set({ renderedFrames: ctx.state.getState().renderedFrames + 1 });
        if (!requestedRevision || seen === requestedRevision) return;
        seen = requestedRevision;
        mesh.userData.revision = seen;
        ctx.state.set({ renderedRevision: seen });
        ctx.state.set({ renderedCount: ctx.state.getState().renderedCount + 1 });
        ctx.state.set({ evaluationMs });
      });
      ctx.entities.add("terrain-editor", {
        debug: () => ({
          ...ctx.state.getState(),
          terrainVertices: mesh?.geometry.getAttribute("position").count ?? 0,
        }),
      });
    }
    override update(_context: ICtx<EditorState>, dt: number): void {
      elapsed += dt;
      propSurfaces?.advance(elapsed);
      sea?.advance(elapsed);
      controls.update();
    }
  }
  const game = defineGame<EditorState>({
    container: host,
    camera: { projection: "perspective", fov: 60, far: 5000 },
    initialState,
    plugins: [playtest()],
    render: { preferWebGPU: true },
    scenes: { editor: EditorScene },
    start: "editor",
  });
  await game.start();
  // One variant set and one surface set for the editor's whole life: the shapes and the maps do not
  // change when the terrain is edited, and rebuilding them per revision would recompile every
  // material on every brush stroke.
  const propParts = buildPropVariants();
  propSurfaces = await createPropSurfaces(ctx.assets);
  const selection = createPropSelection(
    ctx,
    controls,
    controller,
    () => props?.byId,
    () => groundAt,
    (x, y) => {
      if (!props || !mesh) return undefined;
      const box = ctx.renderer.domElement.getBoundingClientRect();
      const hit = ctx.raycast({
        screen: new Vector2(x - box.left, y - box.top),
        targets: [mesh, ...props.meshes],
      });
      if (hit?.instanceId === undefined) return undefined;
      const id = hit.object.userData.placementIds?.[hit.instanceId];
      return typeof id === "string" ? id : undefined;
    },
    (x, z) => {
      if (!mesh) return undefined;
      mesh.geometry.computeBoundingBox();
      const top = mesh.geometry.boundingBox?.max.y;
      if (top === undefined) return undefined;
      return ctx.raycast({
        origin: new Vector3(x, top + 1, z),
        direction: new Vector3(0, -1, 0),
        targets: [mesh],
      })?.point.y;
    },
    (target) => cameras.focus({ target }),
  );
  return {
    get backend(): string {
      return `ThreeNative · ${ctx.renderer.kind}`;
    },
    setDocument(next, revision): void {
      // Only a changed camera definition moves the view: a terrain rebake must not reset an orbit.
      const signature = JSON.stringify([next.cameras ?? [], next.activeCamera ?? null]);
      if (signature !== cameraSignature) {
        cameraSignature = signature;
        activeCamera = next.activeCamera ?? null;
        applySaved(next.cameras?.find((camera) => camera.id === activeCamera) ?? null);
      }
      const sameRecipe = renderedRecipe === JSON.stringify(next.recipe);
      if (sameRecipe && props && groundAt) {
        const keys = new Set([
          ...Object.keys(authoring?.placementOverrides ?? {}),
          ...Object.keys(next.placementOverrides ?? {}),
        ]);
        const changes = [...keys].flatMap((key) => {
          const instance = props?.byId.get(key);
          if (
            !instance ||
            !groundAt ||
            JSON.stringify(authoring?.placementOverrides?.[key]) ===
              JSON.stringify(next.placementOverrides?.[key])
          )
            return [];
          return [
            {
              instance,
              prepared: preparePropTransform(instance, next.placementOverrides?.[key], groundAt),
            },
          ];
        });
        for (const change of changes) writePropTransform(change.instance, change.prepared);
        requestedRevision = revision;
      }
      authoring = next;
      selection.sync({ document: next, revision, diagnostic: null }, sameRecipe);
      selection.refresh();
    },
    update(state): ITerrainState {
      const resolved = applyPlacementOverrides(state, authoring?.placementOverrides ?? {});
      const baked = bakeMesh(state, { palette: terrainPalette });
      if (!baked.colors) throw new Error("Editor surface colours missing");
      const data = {
        size: state.size,
        resolution: state.resolution,
        heights: Array.from(state.height),
        colors: Array.from(baked.colors),
        waterLevel: state.waters.find((w) => w.kind === "ocean")?.level ?? null,
      };
      const next = createTerrain(data).mesh as Mesh<BufferGeometry, MeshStandardMaterial>;
      next.material.wireframe = mode === "wire";
      next.updateMatrixWorld(true);
      next.geometry.computeBoundingBox();
      const top = next.geometry.boundingBox?.max.y;
      if (top === undefined) throw new Error("Terrain bounds unavailable for prop grounding");
      let nextProps: ReturnType<typeof createProps>;
      try {
        const nextGround: PropGroundQuery = (placement, at) => {
          const [x, , z] = at;
          const hit = ctx.raycast({
            origin: new Vector3(x, top + 1, z),
            direction: new Vector3(0, -1, 0),
            targets: [next],
          });
          const [originalX, originalY, originalZ] = placement.position;
          return {
            height: hit?.point.y ?? null,
            offset: originalY - sampleHeight(state, originalX, originalZ),
          };
        };
        if (!propSurfaces) throw new Error("Prop surfaces are not loaded yet");
        nextProps = createProps(resolved.instances, nextGround, propParts, propSurfaces.materials);
        groundAt = nextGround;
      } catch (error) {
        next.geometry.dispose();
        next.material.dispose();
        throw error;
      }
      if (data.waterLevel !== null && !sea) sea = ctx.add(createOcean());
      const nextWater = data.waterLevel === null || !sea ? undefined : createWaterMesh(sea, data);
      if (mesh) {
        ctx.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      clearWater();
      if (props) {
        ctx.scene.remove(props.object);
        props.dispose();
      }
      props = nextProps;
      ctx.add(props.object);
      mesh = next;
      ctx.add(mesh);
      terrain = state;
      if (nextWater) {
        water = nextWater;
        ctx.add(water);
      }
      ctx.state.set({ vertexCount: mesh.geometry.getAttribute("position").count });
      const positions = mesh.geometry.getAttribute("position");
      let heightSum = 0;
      for (let i = 0; i < positions.count; i++) heightSum += positions.getY(i);
      ctx.state.set({ heightSum });
      renderedRecipe = authoring ? JSON.stringify(authoring.recipe) : undefined;
      if (first) {
        first = false;
        frame();
      }
      selection.refresh();
      return resolved;
    },
    pick(clientX, clientY) {
      if (!mesh) return null;
      const box = ctx.renderer.domElement.getBoundingClientRect();
      const hit = ctx.raycast({
        screen: new Vector2(clientX - box.left, clientY - box.top),
        targets: [mesh],
      });
      return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
    },
    setMode(value): void {
      mode = value;
      if (mesh) mesh.material.wireframe = value === "wire";
    },
    setBrush(value): void {
      brush.visible = !!value && !!terrain;
      if (!value || !terrain) return;
      const hit = ctx.raycast({
        origin: new Vector3(value.at[0], 10000, value.at[1]),
        direction: new Vector3(0, -1, 0),
        targets: mesh ? [mesh] : [],
      });
      if (!hit) {
        brush.visible = false; // engine-override: no terrain target exists; prewarm handles meshes, not this Line. // engine-override: this target-dependent Line is not a mesh handled by prewarm.
        return;
      }
      brush.position.set(value.at[0], hit.point.y + 0.2, value.at[1]);
      brush.scale.setScalar(value.radius);
    },
    showSpline(points): void {
      spline.geometry.dispose();
      spline.geometry = new BufferGeometry().setFromPoints(
        points.map((p) => new Vector3(p[0], p[1] + 0.3, p[2])),
      );
    },
    setNavigation(enabled): void {
      controls.mouseButtons.LEFT = enabled ? 0 : null;
    },
    setSelection(enabled): void {
      selection.setActive(enabled);
    },
    selectLayer(id): void {
      selection.selectLayer(id);
    },
    setView(value): void {
      if (!mesh) return;
      frame();
      if (value === "top") {
        const distance = ctx.camera.position.distanceTo(controls.target);
        ctx.camera.position.copy(controls.target).add(new Vector3(0, distance, 0));
        ctx.camera.up.set(0, 0, -1);
      }
      controls.update();
    },
    frame,
    cameras: () => cameras,
    inspect(): EditorState {
      return { ...ctx.state.getState() };
    },
    inspectProps() {
      return [...(props?.byId ?? [])].map(([id, instance]) => ({
        id,
        transform: readPropTransform(instance),
        clearance: instance.clearance,
      }));
    },
    inspectSelection() {
      return selection.inspect();
    },
    projectPlacement(id) {
      return selection.project(id);
    },
    inspectHandles() {
      return selection.handles();
    },
    async exportCurrentWorld(material, waterSnapshots) {
      const accepted = await controller.snapshot();
      if (
        !terrain ||
        !mesh ||
        !props ||
        !authoring ||
        accepted.diagnostic ||
        accepted.revision !== ctx.state.getState().renderedRevision ||
        JSON.stringify(accepted.document) !== JSON.stringify(authoring) ||
        renderedRecipe !== JSON.stringify(authoring.recipe)
      )
        throw new Error("World export needs the accepted rendered revision");
      const assets = new Map<string, Object3D>();
      const transforms = new Map<string, Matrix4>();
      for (const instance of props.byId.values()) {
        if (!assets.has(instance.placement.asset)) {
          const model = new Mesh(instance.mesh.geometry, instance.mesh.material);
          model.name = instance.placement.asset;
          assets.set(instance.placement.asset, model);
        }
        instance.mesh.updateWorldMatrix(true, false);
        const matrix = new Matrix4();
        instance.mesh.getMatrixAt(instance.index, matrix);
        transforms.set(instance.placement.id, matrix.premultiply(instance.mesh.matrixWorld));
      }
      const geometry = mesh.geometry.clone();
      geometry.setAttribute("uv", new BufferAttribute(bakeMesh(terrain).uvs, 2));
      try {
        return await exportWorldGLB({
          revision: accepted.revision,
          snapshotTime: elapsed,
          state: applyPlacementOverrides(terrain, accepted.document.placementOverrides ?? {}),
          terrain: new Mesh(geometry, material),
          assets,
          transforms,
          ...(waterSnapshots ? { water: waterSnapshots } : {}),
        });
      } finally {
        geometry.dispose();
      }
    },
    noteRevision(revision, ms): void {
      requestedRevision = revision;
      evaluationMs = ms;
    },
    dispose(): void {
      selection.dispose();
      propSurfaces?.dispose();
      for (const parts of propParts.values()) for (const part of parts) part.geometry.dispose();
      clearWater();
      props?.dispose();
      mesh?.geometry.dispose();
      mesh?.material.dispose();
      brush.geometry.dispose();
      brush.material.dispose();
      spline.geometry.dispose();
      spline.material.dispose();
      controls.dispose();
      game.stop();
    },
  };
}
