import {
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { formatProjectionWindow } from "../src/projection-marker.js";
import {
  DEFAULT_MINIMUM_PROJECTED_PIXELS,
  RenderCameraCull,
  alwaysRender,
} from "../src/render-camera-cull.js";

/**
 * The projected-size gate.
 *
 * These prove the decision the shipped game had to discover by hand: an object the render camera
 * cannot resolve is not submitted, the decision is per camera rather than per player distance, and
 * nothing a multi-camera frame still needs is dropped. They are behaviour tests, not a pixel
 * ladder — the ladder needs a browser and lives in the in-game verification lane.
 */

const vector3Allocations = vi.hoisted(() => ({ count: 0 }));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return {
    ...actual,
    Vector3: class CountingVector3 extends actual.Vector3 {
      constructor(...args: ConstructorParameters<typeof actual.Vector3>) {
        super(...args);
        vector3Allocations.count += 1;
      }
    },
  };
});

/** A perspective camera at the origin looking down -Z, matching the default Three camera. */
function camera(fov = 60): PerspectiveCamera {
  const result = new PerspectiveCamera(fov, 1, 0.1, 1_000_000);
  result.updateMatrixWorld();
  return result;
}

function sphere(radius: number): SphereGeometry {
  const geometry = new SphereGeometry(radius, 8, 6);
  geometry.computeBoundingSphere();
  return geometry;
}

/** A mesh whose bounding sphere is exactly `radius`, placed at `z`. */
function ball(radius: number, z: number): Mesh {
  const mesh = new Mesh(sphere(radius), new MeshBasicMaterial());
  mesh.position.set(0, 0, z);
  mesh.updateMatrixWorld();
  return mesh;
}

function sceneWith(...objects: Object3D[]): Scene {
  const scene = new Scene();
  for (const object of objects) scene.add(object);
  scene.updateMatrixWorld();
  return scene;
}

describe("render camera cull", () => {
  it("does not submit an object below the threshold and submits one above it", () => {
    const tiny = ball(0.1, -1_000);
    const large = ball(1, -100);
    const scene = sceneWith(tiny, large);
    const cull = new RenderCameraCull();

    cull.apply(scene, camera(), 720);

    expect(tiny.visible).toBe(false);
    expect(large.visible).toBe(true);
    expect(cull.report.considered).toBe(2);
    expect(cull.report.culled).toBe(1);
  });

  it("decides per render camera, not from a player-relative range", () => {
    const far = ball(1, -1_000);
    const scene = sceneWith(far);
    const cull = new RenderCameraCull({ minimumPixels: 5 });

    const distant = camera();
    cull.apply(scene, distant, 720);
    expect(far.visible).toBe(false);
    const afterDistant = cull.report.culled;

    // The same object, same player, but a camera that has moved 900 units closer resolves it.
    const near = camera();
    near.position.set(0, 0, -900);
    near.updateMatrixWorld();
    cull.apply(scene, near, 720);

    expect(far.visible).toBe(true);
    expect(afterDistant).toBe(1);
    expect(cull.report.culled).toBe(0);
  });

  it("keeps a shadow caster that is off the main camera", () => {
    const caster = ball(0.01, -1_000);
    caster.position.set(100_000, 0, -1_000);
    caster.updateMatrixWorld();
    caster.castShadow = true;
    const scene = sceneWith(caster);
    const cull = new RenderCameraCull();

    cull.apply(scene, camera(), 720);

    expect(caster.visible).toBe(true);
    expect(cull.report.culled).toBe(0);
    expect(cull.report.exemptShadowCasters).toBe(1);
  });

  it("culls a shadow caster the main camera can see but cannot resolve", () => {
    const caster = ball(0.01, -1_000);
    caster.castShadow = true;
    const scene = sceneWith(caster);
    const cull = new RenderCameraCull();

    cull.apply(scene, camera(), 720);

    expect(caster.visible).toBe(false);
    expect(cull.report.culled).toBe(1);
    expect(cull.report.exemptShadowCasters).toBe(0);
  });

  it("keeps an object marked with the named override, and reports it", () => {
    const marked = ball(0.01, -1_000);
    alwaysRender(marked);
    const scene = sceneWith(marked);
    const cull = new RenderCameraCull();

    cull.apply(scene, camera(), 720);

    expect(marked.visible).toBe(true);
    expect(cull.report.culled).toBe(0);
    expect(cull.report.exemptMarked).toBe(1);

    alwaysRender(marked, false);
    cull.apply(scene, camera(), 720);
    expect(marked.visible).toBe(false);
  });

  it("keeps an object attached to the render camera", () => {
    const cockpit = ball(0.01, -1_000);
    const view = camera();
    view.add(cockpit);
    const scene = sceneWith(view);
    const cull = new RenderCameraCull();

    cull.apply(scene, view, 720);

    expect(cockpit.visible).toBe(true);
    expect(cull.report.exemptCameraAttached).toBe(1);
  });

  it("honours a game-supplied threshold over the default", () => {
    const mesh = ball(1, -100);
    const scene = sceneWith(mesh);

    const byDefault = new RenderCameraCull();
    byDefault.apply(scene, camera(), 720);
    expect(mesh.visible).toBe(true);

    const widened = new RenderCameraCull({ minimumPixels: 40 });
    widened.apply(scene, camera(), 720);
    expect(mesh.visible).toBe(false);
  });

  it("with nothing configured uses the stated default and still measures when disabled", () => {
    const mesh = ball(1, -100);
    const scene = sceneWith(mesh);

    const byDefault = new RenderCameraCull();
    expect(byDefault.report.thresholdPixels).toBe(DEFAULT_MINIMUM_PROJECTED_PIXELS);
    expect(DEFAULT_MINIMUM_PROJECTED_PIXELS).toBe(0.5);

    const disabled = new RenderCameraCull({ minimumPixels: false });
    disabled.apply(scene, camera(), 720);
    expect(mesh.visible).toBe(true);
    expect(disabled.report.enabled).toBe(false);
    expect(disabled.report.considered).toBe(1);
    expect(disabled.report.culled).toBe(0);
  });

  it("restores what it hid so the authored scene is left as the game made it", () => {
    const tiny = ball(0.1, -1_000);
    const scene = sceneWith(tiny);
    const cull = new RenderCameraCull();

    cull.apply(scene, camera(), 720);
    expect(tiny.visible).toBe(false);
    cull.restore();
    expect(tiny.visible).toBe(true);
  });

  it("leaves an orthographic camera uncullied rather than guessing a distance term", () => {
    const tiny = ball(0.001, -100);
    const scene = sceneWith(tiny);
    const cull = new RenderCameraCull();
    const orthographic = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    orthographic.updateMatrixWorld();

    cull.apply(scene, orthographic, 720);

    expect(tiny.visible).toBe(true);
    expect(cull.report.cameraResolved).toBe(false);
  });

  it("reports how many objects it skipped on the existing projection window", () => {
    const tiny = ball(0.1, -1_000);
    const large = ball(1, -100);
    const scene = sceneWith(tiny, large);
    const cull = new RenderCameraCull();
    cull.apply(scene, camera(), 720);

    const line = formatProjectionWindow(
      {
        schemaVersion: 1,
        projecting: false,
        reasonCode: "belowMeshFloor",
        sourceRenderables: 2,
        resultDrawCandidates: 2,
        projectedObjects: 0,
        batches: 0,
        instancedBatches: 0,
        materialBatches: 0,
        exactObjects: 0,
        exact: {},
        drawsPlanned: 2,
        timings: { compileMs: 0, reconcileMs: 0, lastReconcileMs: 0, maxReconcileMs: 0 },
      },
      7,
      2,
      cull.report,
    );

    const payload = JSON.parse(line.slice("TN_PROJECTION:".length)) as {
      cull: { culled: number; considered: number; thresholdPixels: number; enabled: boolean };
    };
    expect(payload.cull).toMatchObject({
      culled: 1,
      considered: 2,
      enabled: true,
      thresholdPixels: 0.5,
    });
  });

  it("rejects a threshold that is not false or a positive finite number", () => {
    expect(() => new RenderCameraCull({ minimumPixels: 0 })).toThrow(/minimumProjectedPixels/);
    expect(() => new RenderCameraCull({ minimumPixels: -1 })).toThrow(/minimumProjectedPixels/);
    expect(() => new RenderCameraCull({ minimumPixels: Number.NaN })).toThrow(
      /minimumProjectedPixels/,
    );
  });

  it("does not allocate per object per frame", () => {
    const scene = new Scene();
    const group = new Group();
    scene.add(group);
    for (let index = 0; index < 300; index += 1) group.add(ball(1, -100 - index));

    const cull = new RenderCameraCull();
    const view = camera();
    cull.apply(scene, view, 720);
    cull.restore();
    const afterWarmup = vector3Allocations.count;

    for (let frame = 0; frame < 100; frame += 1) {
      cull.apply(scene, view, 720);
      cull.restore();
    }

    expect(vector3Allocations.count).toBe(afterWarmup);
  });
});
