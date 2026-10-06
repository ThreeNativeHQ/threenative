import type { ICtx } from "@threenative/core";
import { CollisionShape3D, RigidBody3D } from "@threenative/physics";
import type { IPhysicsContext } from "@threenative/physics";
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
} from "three";
import { WebGPURenderer } from "three/webgpu";
import { releaseAll } from "../cleanup.js";

export function course<TState extends Record<string, unknown>>(
  ctx: ICtx<TState, IPhysicsContext>,
  warmShadow = false,
) {
  if (!(ctx.renderer.raw instanceof WebGPURenderer)) throw new Error("TN_ANIMAL_WEBGPU_REQUIRED");
  ctx.renderer.raw.shadowMap.enabled = true;
  ctx.scene.background = new Color(0xc7d4df);
  const camera = ctx.camera as PerspectiveCamera;
  camera.position.set(15, 13, 23);
  camera.lookAt(0, 0, -3);
  const ambient = new AmbientLight(0xffffff, 1.2);
  const sun = new DirectionalLight(0xffefd7, 3);
  sun.position.set(8, 15, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -24,
    right: 24,
    top: 24,
    bottom: -24,
    near: 0.1,
    far: 80,
  });
  const floor = new Mesh(
    new BoxGeometry(40, 0.5, 40),
    new MeshStandardMaterial({ color: 0x667463, roughness: 1 }),
  );
  floor.name = "sloped-floor";
  floor.position.set(0, -0.25, -2);
  floor.rotation.z = Math.atan(0.1);
  floor.receiveShadow = true;
  const wall = new Mesh(
    new BoxGeometry(24, 3, 0.5),
    new MeshStandardMaterial({ color: 0x858d96, roughness: 0.9 }),
  );
  wall.name = "stop-wall";
  wall.position.set(0, 1.3, -10);
  wall.receiveShadow = true;
  wall.castShadow = warmShadow; // Lifecycle baseline draws the shared shadow target before animals exist.
  const releases = [
    () => ambient.removeFromParent(),
    () => sun.removeFromParent(),
    () => sun.target.removeFromParent(),
    () => floor.removeFromParent(),
    () => wall.removeFromParent(),
    () => floor.geometry.dispose(),
    () => wall.geometry.dispose(),
    () => (floor.material as MeshStandardMaterial).dispose(),
    () => (wall.material as MeshStandardMaterial).dispose(),
    () => sun.dispose(),
  ];
  const cleanup = () => releaseAll(releases.splice(0).reverse());
  try {
    for (const object of [ambient, sun, sun.target, floor, wall]) ctx.add(object);
    for (const [index, object] of [floor, wall].entries()) {
      const body = new RigidBody3D({
        object,
        physics: ctx.physics,
        shape: CollisionShape3D.fromMesh(object),
        type: "fixed",
        collisionLayer: index === 0 ? 1 : 4,
        collisionMask: 0xffff,
      });
      releases.push(() => body.dispose());
    }
  } catch (error) {
    try {
      cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "TN_ANIMAL_COURSE_FAILED");
    }
    throw error;
  }
  return cleanup;
}
