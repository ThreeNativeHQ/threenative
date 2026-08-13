import { type ICtx, PathFollow3D } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, Mesh, SphereGeometry, Vector3 } from "three";
import { createMaterials } from "../render/materials.js";
import { PLAYER_LAYER } from "./Character.js";

type GameCtx = ICtx<Record<string, unknown>, IPhysicsContext>;

const SPEED = 3.4;
const ROUTE_REACH_DISTANCE = 0.35;
const STOP_DISTANCE = 0.7;
const NO_TARGET_DISTANCE = 1_000_000;

export class Chaser {
  readonly mesh: Group;
  readonly body: CharacterBody3D;
  readonly tags = ["enemy", "chaser"];
  readonly #direction = new Vector3();
  readonly #space: IPhysicsContext["directSpaceState"];
  readonly #targetShape = CollisionShape3D.sphere(64);
  readonly #route: PathFollow3D;
  readonly #separation = new Vector3();
  #targetDistance = NO_TARGET_DISTANCE;

  constructor(ctx: GameCtx, spawn: Vector3);
  constructor(
    ctx: GameCtx,
    player: { readonly mesh: { readonly position: Vector3 } },
    spawn: Vector3,
  );
  constructor(
    ctx: GameCtx,
    playerOrSpawn: Vector3 | { readonly mesh: { readonly position: Vector3 } },
    spawn?: Vector3,
  ) {
    const start = spawn ?? (playerOrSpawn as Vector3);
    this.#space = ctx.physics.directSpaceState;
    const side = start.z >= 0.35 ? 3.05 : -3.05;
    this.#route = new PathFollow3D({
      points: [
        new Vector3(4.15, start.y, side),
        new Vector3(3.4, start.y, side),
        new Vector3(2.65, start.y, side),
      ],
      speed: SPEED,
    });
    this.mesh = new Group();
    this.mesh.position.copy(start);
    const visual = new Mesh(new SphereGeometry(0.44, 12, 8), createMaterials().accent);
    visual.scale.y = 0.8;
    visual.castShadow = true;
    ctx.add(this.mesh.add(visual));
    this.body = new CharacterBody3D({
      collisionLayer: 4,
      collisionMask: 0xfffc,
      gravity: 0,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.35, 0.3).setSensor(true),
    });
  }

  update(dt: number): void {
    const position = this.mesh.position;
    const targetHit = this.#space
      .intersectShape({
        collisionMask: PLAYER_LAYER,
        maxResults: 16,
        position,
        shape: this.#targetShape,
      })
      .find((hit) => hit.entity === "player");
    const target = targetHit?.position;
    const routeSample = this.#route.sample();
    if (!this.#route.completed && position.distanceTo(routeSample.point) <= ROUTE_REACH_DISTANCE)
      this.#route.progressTo(this.#route.progress + SPEED * dt);
    const goal = this.#route.completed ? (target ?? position) : this.#route.sample().point;
    this.#targetDistance =
      target === undefined
        ? NO_TARGET_DISTANCE
        : Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z);
    if (this.#route.completed && this.#targetDistance <= STOP_DISTANCE) {
      this.body.velocity.set(0, this.body.velocity.y, 0);
      this.body.moveAndSlide(dt);
      return;
    }
    this.#direction.subVectors(goal, position).setY(0);
    const peer = this.mesh.userData.peer;
    if (peer !== undefined) {
      const separation = this.#separation.subVectors(position, peer.position).setY(0);
      const distance = separation.length();
      if (distance > 0.001 && distance < 1.1) {
        this.#direction.addScaledVector(separation.normalize(), (1.1 - distance) * 2);
      }
    }
    if (this.#direction.lengthSq() > 0.0001) this.#direction.normalize().multiplyScalar(SPEED);
    this.body.velocity.set(this.#direction.x, this.body.velocity.y, this.#direction.z);
    this.body.moveAndSlide(dt);
  }

  debug(): Record<string, unknown> {
    const peer = this.mesh.userData.peer;
    return {
      position: this.mesh.position.toArray(),
      routeDistance: this.#route.progress,
      routeComplete: this.#route.completed,
      routeSample: this.#route.sample().point.toArray(),
      separation: this.mesh.position.distanceTo(peer?.position ?? this.mesh.position),
      steeringFinished: this.#targetDistance <= STOP_DISTANCE,
      targetDistance: this.#targetDistance,
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
