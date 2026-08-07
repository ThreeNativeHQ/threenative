import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { Group, MathUtils, Vector3 } from "three";
import { palette } from "../render/materials.js";
import { ball, capsule, cone, roundedBox } from "../render/shapes.js";

export class Player {
  readonly mesh = new Group();
  readonly body: CharacterBody3D;
  private jumpBuffer = 0;
  private coyote = 0;
  private squash = 0;
  private facing = Math.PI;
  private lastGrounded = false;

  constructor(physics: PhysicsContext, spawn: Vector3) {
    const torso = capsule(0.5, 0.48, palette.blue);
    torso.position.y = 0.05;
    this.mesh.add(torso);
    const belly = ball(0.34, palette.blueLight);
    belly.scale.z = 0.28;
    belly.position.set(0, 0.04, -0.45);
    this.mesh.add(belly);
    const head = ball(0.52, palette.cream);
    head.position.y = 0.85;
    this.mesh.add(head);
    for (const x of [-0.27, 0.27]) {
      const ear = cone(0.2, 0.55, palette.red);
      ear.position.set(x, 1.35, 0);
      ear.rotation.z = x < 0 ? 0.16 : -0.16;
      this.mesh.add(ear);
      const eye = ball(0.065, 0x17263a);
      eye.position.set(x * 0.65, 0.94, -0.47);
      this.mesh.add(eye);
    }
    const nose = ball(0.085, 0x2c3340);
    nose.position.set(0, 0.78, -0.52);
    this.mesh.add(nose);
    for (const x of [-0.34, 0.34]) {
      const foot = roundedBox(0.34, 0.22, 0.55, 0xffffff, 0.11);
      foot.position.set(x, -0.75, -0.08);
      this.mesh.add(foot);
    }
    this.mesh.position.copy(spawn);
    this.body = new CharacterBody3D({
      object: this.mesh,
      physics,
      shape: CollisionShape3D.capsule(0.58, 0.43),
      gravity: -24,
      maxFallSpeed: 24,
      snapToGround: 0.18,
      autostep: { maxHeight: 0.3, minWidth: 0.2 },
    });
  }

  update(dt: number, moveX: number, moveZ: number, jumpPressed: boolean): void {
    this.jumpBuffer = jumpPressed ? 0.13 : Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.body.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    const length = Math.hypot(moveX, moveZ);
    const speed = length > 0.05 ? 6.1 / Math.max(1, length) : 0;
    this.body.velocity.x = moveX * speed;
    this.body.velocity.z = moveZ * speed;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.body.velocity.y = 9.4;
      this.jumpBuffer = 0;
      this.coyote = 0;
    }
    this.body.moveAndSlide(dt);

    if (length > 0.05) this.facing = Math.atan2(moveX, moveZ);
    this.mesh.rotation.y = MathUtils.lerp(this.mesh.rotation.y, this.facing, 1 - Math.exp(-dt * 14));
    if (this.body.grounded && !this.lastGrounded) this.squash = 1;
    this.squash = Math.max(0, this.squash - dt * 6);
    this.mesh.scale.set(1 + this.squash * 0.12, 1 - this.squash * 0.14, 1 + this.squash * 0.12);
    this.lastGrounded = this.body.grounded;
  }

  teleport(position: Vector3): void {
    this.body.teleport(position);
    this.body.velocity.set(0, 0, 0);
  }

  debug(): Record<string, unknown> {
    return {
      position: this.mesh.position.toArray(),
      velocity: this.body.velocity.toArray(),
      grounded: this.body.grounded,
      tags: ["player"],
    };
  }

  dispose(): void {
    this.body.dispose();
  }
}
