import {
  BoxGeometry,
  Euler,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Sphere,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import { fitWorkloadCamera } from "../../../examples/native-cpu-load-test/src/workload-camera.js";
import {
  boundedWorkloadTransform,
  createWorkload,
  isObjectCulled,
} from "../../../scripts/native-cpu-profile/workload.js";

const PROFILE_ASPECT = 1280 / 720;
const LOCAL_SPHERE_RADIUS = Math.sqrt(3) * 0.4;

function workloadCamera(objectCount: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(55, PROFILE_ASPECT, 0.1, 20_000);
  fitWorkloadCamera(camera, objectCount);
  camera.updateMatrixWorld();
  return camera;
}

function visiblePopulation(
  objectCount: number,
  visibility: "all-visible" | "mostly-culled" | "alternating" = "all-visible",
): number {
  const workload = createWorkload({
    dirtyRatio: 0,
    hierarchy: "flat",
    objectCount,
    seed: 90210,
    visibility,
  });
  const camera = workloadCamera(objectCount);
  const projectionView = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const frustum = new Frustum().setFromProjectionMatrix(projectionView);
  const localSphere = new Sphere(new Vector3(), LOCAL_SPHERE_RADIUS);
  const worldSphere = new Sphere();
  const rotation = new Euler();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const matrix = new Matrix4();

  return workload.objects.reduce((count, object) => {
    position.set(...object.transform.position);
    rotation.set(...object.transform.rotation);
    quaternion.setFromEuler(rotation);
    scale.set(...object.transform.scale);
    matrix.compose(position, quaternion, scale);
    worldSphere.copy(localSphere).applyMatrix4(matrix);
    return count + (frustum.intersectsSphere(worldSphere) ? 1 : 0);
  }, 0);
}

function visiblePopulationAfterDeepMutations(
  visibility: "all-visible" | "mostly-culled",
  ticks: number,
): number {
  const workload = createWorkload({
    dirtyRatio: 1,
    hierarchy: "deep",
    objectCount: 4_000,
    seed: 90210,
    visibility,
  });
  const root = new Group();
  const geometry = new BoxGeometry(0.8, 0.8, 0.8);
  const material = new MeshBasicMaterial();
  const meshes: Mesh[] = [];

  for (const object of workload.objects) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...object.transform.position);
    mesh.rotation.set(...object.transform.rotation);
    mesh.scale.set(...object.transform.scale);
    const parent = object.parentId === null ? root : meshes[object.parentId];
    if (parent === undefined) throw new Error(`missing parent ${object.parentId}`);
    parent.attach(mesh);
    meshes.push(mesh);
  }

  const camera = workloadCamera(workload.config.objectCount);
  const projectionView = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const frustum = new Frustum().setFromProjectionMatrix(projectionView);
  const localSphere = new Sphere(new Vector3(), LOCAL_SPHERE_RADIUS);
  const worldSphere = new Sphere();
  const authoredLocalTransforms = meshes.map((mesh) => ({
    position: [mesh.position.x, mesh.position.y, mesh.position.z] as const,
    rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as const,
    scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z] as const,
  }));
  root.updateMatrixWorld(true);

  for (let tick = 1; tick <= ticks; tick += 1) {
    for (const id of workload.dirtyIds) {
      const mesh = meshes[id];
      if (!mesh) throw new Error(`missing mesh ${id}`);
      const authoredTransform = authoredLocalTransforms[id];
      if (!authoredTransform) throw new Error(`missing authored transform ${id}`);
      const transform = boundedWorkloadTransform(
        authoredTransform,
        id,
        tick,
      );
      mesh.rotation.y = transform.rotation[1];
      mesh.position.z = transform.position[2];
      mesh.matrixWorldNeedsUpdate = true;
    }
    root.updateMatrixWorld(true);
  }

  return meshes.reduce((count, mesh) => {
    worldSphere.copy(localSphere).applyMatrix4(mesh.matrixWorld);
    return count + (frustum.intersectsSphere(worldSphere) ? 1 : 0);
  }, 0);
}

describe("native CPU workload population guard", () => {
  it.each([
    [500, 500],
    [1_000, 1_000],
    [2_000, 2_000],
    [4_000, 4_000],
    [10_000, 10_000],
  ])(
    "keeps the %d-object all-visible workload inside the guard frustum",
    (objectCount, expected) => {
      expect(visiblePopulation(objectCount)).toBe(expected);
    },
  );

  it.each([500, 1_000, 2_000, 4_000])(
    "keeps the existing camera framing for the %d-object workload",
    (objectCount) => {
      expect(workloadCamera(objectCount).position.z).toBe(135);
    },
  );

  it("keeps visibility semantics for the 10k workload", () => {
    expect(visiblePopulation(10_000, "mostly-culled")).toBe(1_000);
    expect(visiblePopulation(10_000, "alternating")).toBe(5_000);
    expect(isObjectCulled(9_999, "mostly-culled")).toBe(true);
  });

  it.each([
    ["all-visible", 4_000],
    ["mostly-culled", 400],
  ] as const)(
    "preserves the deep 4k %s population after a fully dirty warm-up",
    (visibility, expected) => {
      expect(visiblePopulationAfterDeepMutations(visibility, 120)).toBe(expected);
    },
  );
});
