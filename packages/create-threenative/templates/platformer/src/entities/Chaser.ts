import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, Mesh, SphereGeometry, Vector3 } from "three";
import { createMaterials } from "../render/materials.js";
import type { Character } from "./Character.js";
type GameCtx = ICtx<Record<string, unknown>, IPhysicsContext>;
const SPEED = 3.4;
const STOP_DISTANCE = 0.7;
export class Chaser {
  readonly mesh: Group;
  readonly body: CharacterBody3D;
  readonly tags = ["enemy", "chaser"];
  readonly #direction = new Vector3();
  readonly #player: Character;
  readonly #route: Vector3[];
  readonly #separation = new Vector3();
  #routeIndex = 0;
  constructor(ctx: GameCtx, player: Character, spawn: Vector3) {
    this.#player = player;
    const side = spawn.z >= 0.35 ? 3.05 : -3.05;
    this.#route = [new Vector3(4.15, spawn.y, side), new Vector3(2.65, spawn.y, side)];
    this.mesh = new Group();
    this.mesh.position.copy(spawn);
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
    const target = this.#player.mesh.position;
    const waypoint = this.#route[this.#routeIndex];
    if (waypoint !== undefined && position.distanceToSquared(waypoint) < 0.12) {
      this.#routeIndex += 1;
    }
    const goal = this.#route[this.#routeIndex] ?? target;
    const targetDistance = position.distanceTo(target);
    if (this.#routeIndex === this.#route.length && targetDistance <= STOP_DISTANCE) {
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
    const targetDistance = this.mesh.position.distanceTo(this.#player.mesh.position);
    return {
      position: this.mesh.position.toArray(),
      routeComplete: this.#routeIndex === this.#route.length,
      separation: this.mesh.position.distanceTo(peer?.position ?? this.mesh.position),
      steeringFinished: targetDistance <= STOP_DISTANCE,
      targetDistance,
    };
  }
  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
