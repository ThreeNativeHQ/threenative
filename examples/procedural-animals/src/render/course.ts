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

export function course<TState extends Record<string, unknown>>(ctx: ICtx<TState, IPhysicsContext>) {
  if (!(ctx.renderer.raw instanceof WebGPURenderer)) throw new Error("TN_ANIMAL_WEBGPU_REQUIRED");
  ctx.renderer.raw.shadowMap.enabled = true;
  ctx.world.background = new Color(0xc7d4df);
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
  ctx.add(ambient, sun, sun.target, floor, wall);
  const bodies = [floor, wall].map(
    (object, index) =>
      new RigidBody3D({
        object,
        physics: ctx.physics,
        shape: CollisionShape3D.fromMesh(object),
        type: "fixed",
        collisionLayer: index === 0 ? 1 : 4,
        collisionMask: 0xffff,
      }),
  );
  return () => {
    for (const body of bodies) body.dispose();
    floor.geometry.dispose();
    wall.geometry.dispose();
    (floor.material as MeshStandardMaterial).dispose();
    (wall.material as MeshStandardMaterial).dispose();
    sun.dispose();
  };
}
