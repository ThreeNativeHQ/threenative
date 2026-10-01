import { type ICtx, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import {
  type ITerrainState,
  applyPlacementOverrides,
  bakeMesh,
  sampleHeight,
} from "@threenative/terrain";
import type { IEditorView, TerrainEditorController } from "@threenative/terrain/editor";
import type { IAuthoringDocument } from "@threenative/terrain/editor/server";
import {
  BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineLoop,
  type Mesh,
  type MeshStandardMaterial,
  type PerspectiveCamera,
  Vector2,
  Vector3,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createOcean, createWaterMesh } from "./ocean.js";
import { terrainPalette } from "./palette.js";
import {
  type PropGroundQuery,
  createProps,
  preparePropTransform,
  readPropTransform,
  writePropTransform,
} from "./props.js";
import { createPropSelection } from "./selection.js";
import { createTerrain } from "./terrain.js";

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
  }
> {
  let ctx!: ICtx<EditorState>;
  let controls!: OrbitControls;
  let mesh: Mesh<BufferGeometry, MeshStandardMaterial> | undefined;
  let terrain: ITerrainState | undefined;
  let sea: ReturnType<typeof createOcean> | undefined;
  let water: Mesh | undefined;
  let props: ReturnType<typeof createProps> | undefined;
  let authoring: IAuthoringDocument | undefined;
  let renderedRecipe: string | undefined;
  let groundAt: PropGroundQuery | undefined;
  let elapsed = 0;
  let first = true;
  let mode = "lit";
  let requestedRevision = "";
  let evaluationMs = 0;
  let seen = "";
  const brush = new LineLoop(
    new BufferGeometry().setFromPoints(
      Array.from(
        { length: 65 },
        (_, i) =>
          new Vector3(Math.cos((i / 64) * Math.PI * 2), 0, Math.sin((i / 64) * Math.PI * 2)),
      ),
    ),
    new LineBasicMaterial({ color: 0xe1f4bb, depthTest: false }),
  );
  brush.visible = false; // engine-override: this target-dependent LineLoop is not a mesh handled by prewarm.
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
  );
  return {
    get backend(): string {
      return `ThreeNative · ${ctx.renderer.kind}`;
    },
    setDocument(next, revision): void {
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
        nextProps = createProps(resolved.instances, nextGround);
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
        brush.visible = false; // engine-override: no terrain target exists; prewarm handles meshes, not this LineLoop. // engine-override: this target-dependent LineLoop is not a mesh handled by prewarm.
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
    noteRevision(revision, ms): void {
      requestedRevision = revision;
      evaluationMs = ms;
    },
    dispose(): void {
      selection.dispose();
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
